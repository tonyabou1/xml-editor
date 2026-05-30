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

function getStorageProjectPath(path = "") {
  const normalizedPath = normalizeProjectPath(path);
  return normalizedPath.startsWith("content/")
    ? normalizedPath.slice("content/".length)
    : normalizedPath;
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

export async function saveCurrentProjectFolder(userId, rawPath) {
  const normalizedPath = normalizeProjectPath(rawPath);
  if (!normalizedPath) {
    throw Object.assign(new Error("A project folder path is required."), { statusCode: 400 });
  }

  const repositoryResult = await query(
    `
      select id, full_name, html_url, default_branch
      from github_repositories
      where user_id = $1
      order by selected_at desc
      limit 1
    `,
    [userId],
  );

  if (!repositoryResult.rowCount) {
    throw Object.assign(new Error("Select a GitHub repository before creating folders."), { statusCode: 409 });
  }

  const membership = await getPrimaryMembership(userId);
  if (!membership) {
    throw Object.assign(new Error("Join a team before creating project folders."), { statusCode: 409 });
  }

  const repository = repositoryResult.rows[0];
  const project = await upsertCurrentGitHubProject(userId, membership, repository);
  const folder = await upsertProjectFolderWithParents({
    projectId: project.id,
    folderPath: normalizedPath,
    userId,
  });

  return {
    repository,
    project,
    folder,
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

export async function moveCurrentProjectPath(userId, { oldPath: rawOldPath, newPath: rawNewPath } = {}) {
  const oldPath = getStorageProjectPath(rawOldPath);
  const newPath = getStorageProjectPath(rawNewPath);

  if (!oldPath || !newPath) {
    throw Object.assign(new Error("Both source and destination project paths are required."), { statusCode: 400 });
  }

  if (oldPath === newPath) {
    return {
      movedDrafts: 0,
      movedProjectFiles: 0,
      oldPath,
      newPath,
    };
  }

  if (newPath.startsWith(`${oldPath}/`)) {
    throw Object.assign(new Error("A folder cannot be moved into itself."), { statusCode: 400 });
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
    throw Object.assign(new Error("Select a GitHub repository before moving files."), { statusCode: 409 });
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
      movedDrafts: 0,
      movedProjectFiles: 0,
      oldPath,
      newPath,
      repository,
    };
  }

  const project = projectResult.rows[0];
  const conflictResult = await query(
    `
      select 1
      from project_files
      where project_id = $1
        and path = $2
      limit 1
    `,
    [project.id, newPath],
  );

  if (conflictResult.rowCount) {
    throw Object.assign(new Error("A file or folder already exists at the destination."), { statusCode: 409 });
  }

  const draftConflictResult = await query(
    `
      select 1
      from github_file_drafts
      where github_repository_id = $1
        and user_id = $2
        and file_path = $3
      limit 1
    `,
    [repository.id, userId, newPath],
  );

  if (draftConflictResult.rowCount) {
    throw Object.assign(new Error("A saved draft already exists at the destination."), { statusCode: 409 });
  }

  const filesResult = await query(
    `
      with moved as (
        update project_files
        set path = $3 || substring(path from length($2) + 1),
            name = regexp_replace($3 || substring(path from length($2) + 1), '^.*/', ''),
            updated_at = now()
        where project_id = $1
          and deleted_at is null
          and (
            path = $2
            or path like $2 || '/%'
          )
        returning id
      )
      select count(*)::int as count
      from moved
    `,
    [project.id, oldPath, newPath],
  );

  const draftsResult = await query(
    `
      with moved as (
        update github_file_drafts
        set file_path = $4 || substring(file_path from length($3) + 1),
            updated_at = now(),
            saved_at = now()
        where github_repository_id = $1
          and user_id = $2
          and (
            file_path = $3
            or file_path like $3 || '/%'
          )
        returning id
      )
      select count(*)::int as count
      from moved
    `,
    [repository.id, userId, oldPath, newPath],
  );

  return {
    movedDrafts: Number(draftsResult.rows[0]?.count || 0),
    movedProjectFiles: Number(filesResult.rows[0]?.count || 0),
    oldPath,
    newPath,
    repository,
  };
}

async function getPrimaryMembership(userId) {
  const result = await query(
    `
      select
        teams.organization_id,
        team_members.team_id
      from team_members
      join teams on teams.id = team_members.team_id
      where team_members.user_id = $1
      order by team_members.created_at asc
      limit 1
    `,
    [userId],
  );

  return result.rows[0] || null;
}

async function upsertCurrentGitHubProject(userId, membership, repository) {
  const slug = `github-${slugify(repository.full_name)}`;
  const result = await query(
    `
      insert into projects (
        organization_id,
        team_id,
        name,
        slug,
        repository_url,
        default_branch,
        created_by
      )
      values ($1, $2, $3, $4, $5, $6, $7)
      on conflict (organization_id, slug)
      do update set
        team_id = excluded.team_id,
        name = excluded.name,
        repository_url = excluded.repository_url,
        default_branch = excluded.default_branch,
        updated_at = now()
      returning id, name, slug
    `,
    [
      membership.organization_id,
      membership.team_id,
      repository.full_name,
      slug,
      repository.html_url || repository.full_name,
      repository.default_branch || "main",
      userId,
    ],
  );

  return result.rows[0];
}

async function upsertProjectFolderWithParents({ projectId, folderPath, userId }) {
  const parts = normalizeProjectPath(folderPath).split("/").filter(Boolean);
  let parentId = null;
  let folder = null;

  for (let index = 0; index < parts.length; index += 1) {
    const currentPath = parts.slice(0, index + 1).join("/");
    folder = await upsertProjectFile({
      projectId,
      parentId,
      path: currentPath,
      name: parts[index],
      kind: "folder",
      ditaType: null,
      mimeType: null,
      githubSha: null,
      sizeBytes: null,
      userId,
    });
    parentId = folder.id;
  }

  return folder;
}

async function upsertProjectFile(file) {
  const result = await query(
    `
      insert into project_files (
        project_id,
        parent_id,
        path,
        name,
        kind,
        dita_type,
        mime_type,
        github_sha,
        size_bytes,
        created_by,
        updated_by
      )
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10)
      on conflict (project_id, path)
      do update set
        parent_id = excluded.parent_id,
        name = excluded.name,
        kind = excluded.kind,
        dita_type = excluded.dita_type,
        mime_type = excluded.mime_type,
        github_sha = excluded.github_sha,
        size_bytes = excluded.size_bytes,
        deleted_at = null,
        updated_by = excluded.updated_by,
        updated_at = now()
      returning id, path, kind
    `,
    [
      file.projectId,
      file.parentId,
      file.path,
      file.name,
      file.kind,
      file.ditaType,
      file.mimeType,
      file.githubSha,
      file.sizeBytes,
      file.userId,
    ],
  );

  return result.rows[0];
}

function slugify(value) {
  return String(value || "repository")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80) || "repository";
}
