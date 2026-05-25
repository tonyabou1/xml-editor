import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { closePool, query } from "../db.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const sampleFolderName = "visual_templates";
const sampleFolderPath = path.join(repoRoot, sampleFolderName);

function hashContent(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

function inferDitaType(fileName, xml) {
  const rootName = xml.match(/<([a-zA-Z][\w.-]*)(\s|>)/)?.[1] || "";
  if (rootName === "map") return "map";
  if (["concept", "task", "reference", "topic"].includes(rootName)) return rootName;
  if (fileName.endsWith(".ditamap")) return "map";
  return rootName || "topic";
}

async function getSeedContext() {
  const result = await query(`
    select
      app_users.id as user_id,
      github_repositories.id as repository_id,
      github_repositories.full_name,
      projects.id as project_id,
      teams.id as team_id,
      teams.organization_id
    from app_users
    join github_repositories
      on github_repositories.user_id = app_users.id
    join projects
      on projects.name = github_repositories.full_name
    left join team_members
      on team_members.user_id = app_users.id
    left join teams
      on teams.id = team_members.team_id
    order by github_repositories.selected_at desc nulls last, team_members.created_at asc nulls last
    limit 1
  `);

  if (!result.rowCount) {
    throw new Error("No selected GitHub-backed project was found. Connect/select a repository first.");
  }

  return result.rows[0];
}

async function upsertFolder({ projectId, userId }) {
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
      values ($1, null, $2, $3, 'folder', null, null, null, null, $4, $4)
      on conflict (project_id, path)
      do update set
        name = excluded.name,
        kind = 'folder',
        deleted_at = null,
        updated_by = excluded.updated_by,
        updated_at = now()
      returning id
    `,
    [projectId, sampleFolderName, sampleFolderName, userId],
  );

  return result.rows[0].id;
}

async function upsertSampleFile({ context, parentId, fileName }) {
  const absolutePath = path.join(sampleFolderPath, fileName);
  const content = fs.readFileSync(absolutePath, "utf8");
  const filePath = `${sampleFolderName}/${fileName}`;
  const contentHash = hashContent(content);
  const ditaType = inferDitaType(fileName, content);
  const sizeBytes = Buffer.byteLength(content, "utf8");

  await query(
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
      values ($1, $2, $3, $4, 'file', $5, 'xml', null, $6, $7, $7)
      on conflict (project_id, path)
      do update set
        parent_id = excluded.parent_id,
        name = excluded.name,
        kind = 'file',
        dita_type = excluded.dita_type,
        mime_type = 'xml',
        github_sha = null,
        size_bytes = excluded.size_bytes,
        deleted_at = null,
        updated_by = excluded.updated_by,
        updated_at = now()
    `,
    [context.project_id, parentId, filePath, fileName, ditaType, sizeBytes, context.user_id],
  );

  await query(
    `
      insert into github_file_drafts (
        github_repository_id,
        user_id,
        organization_id,
        team_id,
        file_path,
        github_sha,
        content_format,
        content_text,
        dirty,
        source_content_hash,
        draft_content_hash,
        change_type,
        deleted_at
      )
      values ($1, $2, $3, $4, $5, null, 'xml', $6, true, null, $7, 'upsert', null)
      on conflict (github_repository_id, user_id, file_path)
      do update set
        organization_id = excluded.organization_id,
        team_id = excluded.team_id,
        github_sha = null,
        content_format = 'xml',
        content_text = excluded.content_text,
        dirty = true,
        source_content_hash = null,
        draft_content_hash = excluded.draft_content_hash,
        change_type = 'upsert',
        deleted_at = null,
        saved_at = now(),
        updated_at = now()
    `,
    [
      context.repository_id,
      context.user_id,
      context.organization_id,
      context.team_id,
      filePath,
      content,
      contentHash,
    ],
  );

  return { filePath, ditaType };
}

try {
  const context = await getSeedContext();
  const fileNames = fs.readdirSync(sampleFolderPath)
    .filter((fileName) => /\.dita(map)?$/.test(fileName))
    .sort();

  await query("begin");
  const parentId = await upsertFolder({
    projectId: context.project_id,
    userId: context.user_id,
  });

  const inserted = [];
  for (const fileName of fileNames) {
    inserted.push(await upsertSampleFile({ context, parentId, fileName }));
  }
  await query("commit");

  console.log(`Seeded ${inserted.length} visual template sample files into ${context.full_name}:`);
  inserted.forEach((file) => console.log(`- ${file.filePath} (${file.ditaType})`));
} catch (error) {
  await query("rollback").catch(() => {});
  console.error(error);
  process.exitCode = 1;
} finally {
  await closePool();
}
