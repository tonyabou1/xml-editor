import { query } from "./db.mjs";

function normalizeProjectPath(path = "") {
  const parts = [];

  String(path).split("/").forEach((part) => {
    if (!part || part === ".") return;
    if (part === "..") {
      parts.pop();
      return;
    }

    parts.push(part);
  });

  return parts.join("/");
}

function getProjectPathCandidates(path = "") {
  const normalizedPath = normalizeProjectPath(path);
  const candidates = new Set([normalizedPath]);

  if (normalizedPath.startsWith("content/")) {
    candidates.add(normalizedPath.slice("content/".length));
  }

  return [...candidates].filter(Boolean);
}

export async function getCurrentProjectTree(userId) {
  const repositoryResult = await query(
    `
      select id, full_name
      from github_repositories
      where user_id = $1
      order by selected_at desc
      limit 1
    `,
    [userId],
  );

  if (!repositoryResult.rowCount) {
    return {
      repository: null,
      project: null,
      entries: [],
    };
  }

  const repository = repositoryResult.rows[0];
  const projectResult = await query(
    `
      select id, name, slug, repository_url, default_branch
      from projects
      where repository_url is not null
        and name = $1
      order by updated_at desc
      limit 1
    `,
    [repository.full_name],
  );

  if (!projectResult.rowCount) {
    return {
      repository,
      project: null,
      entries: [],
    };
  }

  const project = projectResult.rows[0];
  const filesResult = await query(
    `
      select
        project_files.path,
        project_files.kind,
        project_files.dita_type,
        project_files.github_sha,
        project_files.size_bytes,
        project_files.deleted_at as project_deleted_at,
        github_file_drafts.source_content_hash,
        github_file_drafts.draft_content_hash,
        github_file_drafts.deleted_at as draft_deleted_at,
        case
          when github_file_drafts.id is null then false
          when github_file_drafts.deleted_at is not null then true
          when project_files.deleted_at is not null then true
          when github_file_drafts.source_content_hash is null then github_file_drafts.dirty
          else github_file_drafts.draft_content_hash is distinct from github_file_drafts.source_content_hash
        end as draft_dirty,
        github_file_drafts.saved_at as draft_saved_at
      from project_files
      left join github_file_drafts
        on github_file_drafts.github_repository_id = $2
       and github_file_drafts.user_id = $3
       and github_file_drafts.file_path = project_files.path
      where project_files.project_id = $1
        and (
          project_files.deleted_at is null
          or github_file_drafts.dirty = true
        )
      order by project_files.path
    `,
    [project.id, repository.id, userId],
  );

  return {
    repository,
    project,
    entries: filesResult.rows.map((row) => ({
      path: row.path,
      type: row.kind === "folder" ? "folder" : "file",
      ditaType: row.dita_type,
      sha: row.github_sha || "",
      size: Number(row.size_bytes || 0),
      draftDirty: Boolean(row.draft_dirty),
      draftSavedAt: row.draft_saved_at || null,
      deletedAt: row.draft_deleted_at || row.project_deleted_at || null,
      sourceContentHash: row.source_content_hash || "",
      draftContentHash: row.draft_content_hash || "",
    })),
  };
}

export async function deleteCurrentProjectPath(userId, rawPath) {
  const normalizedPath = normalizeProjectPath(rawPath);
  const pathCandidates = getProjectPathCandidates(normalizedPath);
  if (!normalizedPath) {
    throw Object.assign(new Error("A project path is required."), { statusCode: 400 });
  }

  const repositoryResult = await query(
    `
      select id, full_name
      from github_repositories
      where user_id = $1
      order by selected_at desc
      limit 1
    `,
    [userId],
  );

  if (!repositoryResult.rowCount) {
    throw Object.assign(new Error("Select a GitHub repository before deleting files."), { statusCode: 409 });
  }

  const repository = repositoryResult.rows[0];
  const projectResult = await query(
    `
      select id
      from projects
      where repository_url is not null
        and name = $1
      order by updated_at desc
      limit 1
    `,
    [repository.full_name],
  );

  if (!projectResult.rowCount) {
    return {
      softDeletedDrafts: 0,
      softDeletedProjectFiles: 0,
      path: normalizedPath,
      repository,
    };
  }

  const project = projectResult.rows[0];

  const deletedAt = new Date().toISOString();
  const draftUpsertResult = await query(
    `
      insert into github_file_drafts (
        github_repository_id,
        user_id,
        organization_id,
        team_id,
        file_path,
        github_sha,
        source_content_hash,
        draft_content_hash,
        content_format,
        content_text,
        dirty,
        deleted_at,
        change_type
      )
      select
        $1,
        $2,
        projects.organization_id,
        projects.team_id,
        project_files.path,
        project_files.github_sha,
        null,
        null,
        coalesce(project_files.mime_type, 'xml'),
        '',
        true,
        $4,
        'delete'
      from project_files
      join projects on projects.id = project_files.project_id
      where project_files.project_id = $5
        and project_files.kind = 'file'
        and project_files.github_sha is not null
        and (
          project_files.path = any($3::text[])
          or exists (
            select 1
            from unnest($3::text[]) as candidate(path)
            where project_files.path like candidate.path || '/%'
          )
        )
      on conflict (github_repository_id, user_id, file_path)
      do update set
        organization_id = excluded.organization_id,
        team_id = excluded.team_id,
        github_sha = coalesce(github_file_drafts.github_sha, excluded.github_sha),
        dirty = true,
        deleted_at = excluded.deleted_at,
        change_type = 'delete',
        saved_at = now(),
        updated_at = now()
    `,
    [repository.id, userId, pathCandidates, deletedAt, project.id],
  );

  const draftDiscardResult = await query(
    `
      update github_file_drafts
      set dirty = false,
          deleted_at = $4,
          change_type = 'delete',
          saved_at = now(),
          updated_at = now()
      where github_repository_id = $1
        and user_id = $2
        and github_sha is null
        and (
          file_path = any($3::text[])
          or exists (
            select 1
            from unnest($3::text[]) as candidate(path)
            where file_path like candidate.path || '/%'
          )
        )
    `,
    [repository.id, userId, pathCandidates, deletedAt],
  );

  const filesResult = await query(
    `
      update project_files
      set deleted_at = $3,
          updated_at = now()
      where project_id = $1
        and (
          path = any($2::text[])
          or exists (
            select 1
            from unnest($2::text[]) as candidate(path)
            where project_files.path like candidate.path || '/%'
          )
        )
    `,
    [project.id, pathCandidates, deletedAt],
  );

  return {
    deletedAt,
    softDeletedDrafts: draftUpsertResult.rowCount,
    discardedDrafts: draftDiscardResult.rowCount,
    softDeletedProjectFiles: filesResult.rowCount,
    path: normalizedPath,
    repository,
  };
}
