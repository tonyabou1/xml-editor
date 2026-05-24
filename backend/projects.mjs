import { query } from "./db.mjs";

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
        github_file_drafts.source_content_hash,
        github_file_drafts.draft_content_hash,
        case
          when github_file_drafts.id is null then false
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
      sourceContentHash: row.source_content_hash || "",
      draftContentHash: row.draft_content_hash || "",
    })),
  };
}
