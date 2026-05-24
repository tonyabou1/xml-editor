import crypto from "node:crypto";
import { query } from "./db.mjs";

export async function getGitHubFileDraft(userId, filePath) {
  const normalizedPath = normalizeDraftPath(filePath);
  if (!normalizedPath) {
    throw Object.assign(new Error("A draft file path is required."), { statusCode: 400 });
  }

  const repository = await getSelectedRepository(userId);
  const result = await query(
    `
      select
        id,
        file_path,
        github_sha,
        source_content_hash,
        draft_content_hash,
        content_format,
        content_text,
        case
          when source_content_hash is null then dirty
          else draft_content_hash is distinct from source_content_hash
        end as dirty,
        saved_at,
        updated_at
      from github_file_drafts
      where github_repository_id = $1
        and user_id = $2
        and file_path = $3
      limit 1
    `,
    [repository.id, userId, normalizedPath],
  );

  return {
    repository,
    draft: result.rows[0] || null,
  };
}

export async function saveGitHubFileDraft(userId, draft) {
  const normalizedPath = normalizeDraftPath(draft.filePath);
  if (!normalizedPath) {
    throw Object.assign(new Error("A draft file path is required."), { statusCode: 400 });
  }

  const repository = await getSelectedRepository(userId);
  const membership = await getPrimaryMembership(userId);
  const sourceContentHash = draft.sourceContentHash || null;
  const draftContentHash = hashContent(draft.content);
  const isDirty = sourceContentHash ? draftContentHash !== sourceContentHash : true;
  const projectFile = membership
    ? await upsertProjectFileMetadata({
        userId,
        membership,
        repository,
        filePath: normalizedPath,
        githubSha: draft.githubSha || null,
        contentFormat: draft.contentFormat || "xml",
        sizeBytes: Buffer.byteLength(String(draft.content ?? ""), "utf8"),
      })
    : null;
  const result = await query(
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
        dirty
      )
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      on conflict (github_repository_id, user_id, file_path)
      do update set
        organization_id = excluded.organization_id,
        team_id = excluded.team_id,
        github_sha = excluded.github_sha,
        source_content_hash = excluded.source_content_hash,
        draft_content_hash = excluded.draft_content_hash,
        content_format = excluded.content_format,
        content_text = excluded.content_text,
        dirty = excluded.dirty,
        saved_at = now(),
        updated_at = now()
      returning
        id,
        file_path,
        github_sha,
        source_content_hash,
        draft_content_hash,
        content_format,
        content_text,
        case
          when source_content_hash is null then dirty
          else draft_content_hash is distinct from source_content_hash
        end as dirty,
        saved_at,
        updated_at
    `,
    [
      repository.id,
      userId,
      membership?.organization_id || null,
      membership?.team_id || null,
      normalizedPath,
      draft.githubSha || null,
      sourceContentHash,
      draftContentHash,
      draft.contentFormat || "xml",
      String(draft.content ?? ""),
      isDirty,
    ],
  );

  return {
    repository,
    projectFile,
    draft: result.rows[0],
  };
}

function hashContent(value) {
  return crypto.createHash("sha256").update(String(value ?? ""), "utf8").digest("hex");
}

async function getSelectedRepository(userId) {
  const result = await query(
    `
      select id, full_name, default_branch, html_url
      from github_repositories
      where user_id = $1
      order by selected_at desc
      limit 1
    `,
    [userId],
  );

  if (!result.rowCount) {
    throw Object.assign(new Error("Select a GitHub repository before saving drafts."), { statusCode: 409 });
  }

  return result.rows[0];
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

async function upsertProjectFileMetadata({ userId, membership, repository, filePath, githubSha, contentFormat, sizeBytes }) {
  const project = await upsertGitHubProject(userId, membership, repository);
  const parts = filePath.split("/").filter(Boolean);
  let parentId = null;

  for (let index = 0; index < parts.length - 1; index += 1) {
    const folderPath = parts.slice(0, index + 1).join("/");
    const folder = await upsertProjectFile({
      projectId: project.id,
      parentId,
      path: folderPath,
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

  return upsertProjectFile({
    projectId: project.id,
    parentId,
    path: filePath,
    name: parts[parts.length - 1],
    kind: "file",
    ditaType: inferDitaType(filePath, contentFormat),
    mimeType: inferMimeType(filePath, contentFormat),
    githubSha,
    sizeBytes,
    userId,
  });
}

async function upsertGitHubProject(userId, membership, repository) {
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
      returning id
    `,
    [
      membership.organization_id,
      membership.team_id,
      repository.full_name,
      slug,
      repository.html_url,
      repository.default_branch || "main",
      userId,
    ],
  );

  return result.rows[0];
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

function inferDitaType(filePath, contentFormat) {
  const extension = filePath.split(".").pop()?.toLowerCase() || "";
  if (extension === "ditamap") return "map";
  if (extension === "dita" || extension === "xml") return contentFormat === "map" ? "map" : "topic";
  if (/^(avif|gif|jpe?g|png|svg|webp)$/i.test(extension)) return "image";
  if (["html", "htm"].includes(extension)) return "html";
  return contentFormat || "text";
}

function inferMimeType(filePath, contentFormat) {
  const extension = filePath.split(".").pop()?.toLowerCase() || "";
  const mimeTypes = {
    dita: "application/dita+xml",
    ditamap: "application/ditamap+xml",
    htm: "text/html",
    html: "text/html",
    txt: "text/plain",
    xml: "application/xml",
  };

  if (mimeTypes[extension]) return mimeTypes[extension];
  if (contentFormat === "html") return "text/html";
  if (contentFormat === "xml" || contentFormat === "topic" || contentFormat === "task" || contentFormat === "concept") return "application/dita+xml";
  return "text/plain";
}

function normalizeDraftPath(value) {
  return String(value || "")
    .replace(/\\/g, "/")
    .split("/")
    .filter((part) => part && part !== "." && part !== "..")
    .join("/");
}
