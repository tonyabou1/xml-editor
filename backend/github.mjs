import crypto from "node:crypto";
import { query } from "./db.mjs";
import "./env.mjs";

const oauthStates = new Map();
const githubApiBase = "https://api.github.com";
const githubClientId = process.env.GITHUB_CLIENT_ID || "";
const githubClientSecret = process.env.GITHUB_CLIENT_SECRET || "";
const githubOAuthCallbackUrl = process.env.GITHUB_OAUTH_CALLBACK_URL || "http://127.0.0.1:3174/api/github/callback";

export function getGitHubConfigStatus() {
  return {
    configured: Boolean(githubClientId && githubClientSecret),
    callbackUrl: githubOAuthCallbackUrl,
  };
}

export function createGitHubAuthorizeUrl({ userId, returnTo }) {
  if (!githubClientId || !githubClientSecret) {
    throw Object.assign(new Error("GitHub OAuth is not configured. Set GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET."), {
      statusCode: 503,
    });
  }

  const state = crypto.randomUUID();
  oauthStates.set(state, {
    userId,
    returnTo: returnTo || "http://localhost:5175/",
    expiresAt: Date.now() + 10 * 60 * 1000,
  });

  const authorizeUrl = new URL("https://github.com/login/oauth/authorize");
  authorizeUrl.searchParams.set("client_id", githubClientId);
  authorizeUrl.searchParams.set("redirect_uri", githubOAuthCallbackUrl);
  authorizeUrl.searchParams.set("scope", "repo read:user");
  authorizeUrl.searchParams.set("state", state);

  return authorizeUrl.toString();
}

export async function completeGitHubOAuth({ code, state }) {
  const stateEntry = oauthStates.get(state);
  oauthStates.delete(state);

  if (!stateEntry || stateEntry.expiresAt < Date.now()) {
    throw Object.assign(new Error("GitHub connection expired. Please start again."), { statusCode: 400 });
  }

  const tokenResponse = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      client_id: githubClientId,
      client_secret: githubClientSecret,
      code,
      redirect_uri: githubOAuthCallbackUrl,
    }),
  });
  const tokenBody = await tokenResponse.json();

  if (!tokenResponse.ok || tokenBody.error || !tokenBody.access_token) {
    throw Object.assign(new Error(tokenBody.error_description || tokenBody.error || "GitHub did not return an access token."), {
      statusCode: 502,
    });
  }

  const githubUser = await fetchGitHubJson("/user", tokenBody.access_token);
  await query(
    `
      insert into github_connections (
        user_id,
        github_user_id,
        github_login,
        access_token,
        scope,
        token_type
      )
      values ($1, $2, $3, $4, $5, $6)
      on conflict (user_id)
      do update set
        github_user_id = excluded.github_user_id,
        github_login = excluded.github_login,
        access_token = excluded.access_token,
        scope = excluded.scope,
        token_type = excluded.token_type,
        updated_at = now()
    `,
    [
      stateEntry.userId,
      githubUser.id,
      githubUser.login,
      tokenBody.access_token,
      tokenBody.scope || "",
      tokenBody.token_type || "bearer",
    ],
  );

  return {
    returnTo: stateEntry.returnTo,
    githubLogin: githubUser.login,
  };
}

export async function getGitHubStatus(userId) {
  const connectionResult = await query(
    `
      select id, github_user_id, github_login, scope, connected_at, updated_at
      from github_connections
      where user_id = $1
    `,
    [userId],
  );
  const repositoryResult = await query(
    `
      select id, full_name, owner_login, name, default_branch, selected_branch, private, html_url, selected_at
      from github_repositories
      where user_id = $1
      order by selected_at desc
      limit 1
    `,
    [userId],
  );

  return {
    configured: getGitHubConfigStatus().configured,
    connected: connectionResult.rowCount > 0,
    connection: connectionResult.rows[0] || null,
    selectedRepository: repositoryResult.rows[0] || null,
  };
}

export async function listGitHubRepositories(userId) {
  const connection = await getConnectionWithToken(userId);
  const repositories = await fetchGitHubJson(
    "/user/repos?sort=updated&per_page=100&affiliation=owner,collaborator,organization_member",
    connection.access_token,
  );

  return repositories.map((repository) => ({
    githubRepositoryId: repository.id,
    fullName: repository.full_name,
    ownerLogin: repository.owner?.login || repository.full_name.split("/")[0],
    name: repository.name,
    defaultBranch: repository.default_branch || "main",
    private: Boolean(repository.private),
    htmlUrl: repository.html_url,
    pushedAt: repository.pushed_at,
    updatedAt: repository.updated_at,
  }));
}

export async function selectGitHubRepository(userId, fullName) {
  const repositories = await listGitHubRepositories(userId);
  const repository = repositories.find((candidate) => candidate.fullName === fullName);

  if (!repository) {
    throw Object.assign(new Error("Selected repository is not available to this GitHub connection."), {
      statusCode: 404,
    });
  }

  const connection = await getConnectionWithToken(userId);
  const result = await query(
    `
      insert into github_repositories (
        connection_id,
        user_id,
        github_repository_id,
        full_name,
        owner_login,
        name,
        default_branch,
        selected_branch,
        private,
        html_url
      )
      values ($1, $2, $3, $4, $5, $6, $7, $7, $8, $9)
      on conflict (user_id, github_repository_id)
      do update set
        connection_id = excluded.connection_id,
        full_name = excluded.full_name,
        owner_login = excluded.owner_login,
        name = excluded.name,
        default_branch = excluded.default_branch,
        selected_branch = coalesce(github_repositories.selected_branch, excluded.selected_branch),
        private = excluded.private,
        html_url = excluded.html_url,
        selected_at = now(),
        updated_at = now()
      returning id, full_name, owner_login, name, default_branch, selected_branch, private, html_url, selected_at
    `,
    [
      connection.id,
      userId,
      repository.githubRepositoryId,
      repository.fullName,
      repository.ownerLogin,
      repository.name,
      repository.defaultBranch,
      repository.private,
      repository.htmlUrl,
    ],
  );

  return result.rows[0];
}

export async function getGitHubRepositoryTree(userId) {
  const { connection, repository } = await getSelectedRepositoryContext(userId);
  const branch = repository.selected_branch || repository.default_branch;
  const tree = await fetchGitHubJson(
    `/repos/${encodeRepositoryFullName(repository.full_name)}/git/trees/${encodeURIComponent(branch)}?recursive=1`,
    connection.access_token,
  );
  const entries = (tree.tree || [])
    .filter((entry) => entry.type === "tree" || entry.type === "blob")
    .map((entry) => ({
      path: entry.path,
      type: entry.type === "tree" ? "folder" : "file",
      sha: entry.sha,
      size: entry.size || 0,
    }));
  const sync = await syncGitHubTreeMetadata(userId, repository, entries);

  return {
    repository,
    truncated: Boolean(tree.truncated),
    entries,
    sync,
  };
}

export async function getGitHubFileContent(userId, filePath) {
  return getGitHubFileContentAtRef(userId, {
    filePath,
  });
}

export async function getGitHubFileContentAtRef(userId, { filePath, ref } = {}) {
  const normalizedPath = normalizeGitHubPath(filePath);
  if (!normalizedPath) {
    throw Object.assign(new Error("A GitHub file path is required."), { statusCode: 400 });
  }

  const { connection, repository } = await getSelectedRepositoryContext(userId);
  const resolvedRef = String(ref || "").trim() || repository.selected_branch || repository.default_branch;
  const content = await fetchGitHubJson(
    `/repos/${encodeRepositoryFullName(repository.full_name)}/contents/${encodeGitHubPath(normalizedPath)}?ref=${encodeURIComponent(resolvedRef)}`,
    connection.access_token,
  );

  if (Array.isArray(content) || content.type !== "file") {
    throw Object.assign(new Error("The selected GitHub path is not a file."), { statusCode: 400 });
  }

  const base64 = String(content.content || "").replace(/\s/g, "");
  const extension = normalizedPath.split(".").pop()?.toLowerCase() || "";
  const mimeType = getMimeType(extension);
  const isText = isTextExtension(extension);
  const decodedText = isText ? Buffer.from(base64, "base64").toString("utf8") : "";

  return {
    path: normalizedPath,
    name: content.name,
    sha: content.sha,
    size: content.size || 0,
    encoding: content.encoding || "base64",
    mimeType,
    downloadUrl: content.download_url || "",
    content: decodedText,
    contentHash: isText ? hashContent(decodedText) : "",
    contentBase64: isText ? "" : base64,
    ref: resolvedRef,
  };
}

function hashContent(value) {
  return crypto.createHash("sha256").update(String(value ?? ""), "utf8").digest("hex");
}

export async function listGitHubBranches(userId) {
  const { connection, repository } = await getSelectedRepositoryContext(userId);
  const branches = await fetchGitHubJson(
    `/repos/${encodeRepositoryFullName(repository.full_name)}/branches?per_page=100`,
    connection.access_token,
  );
  const activeBranch = repository.selected_branch || repository.default_branch;

  return {
    repository,
    branches: branches.map((branch) => ({
      name: branch.name,
      sha: branch.commit?.sha || "",
      protected: Boolean(branch.protected),
      active: branch.name === activeBranch,
    })),
  };
}

export async function listGitHubCommits(userId, { branch, limit } = {}) {
  const { connection, repository } = await getSelectedRepositoryContext(userId);
  const activeBranch = normalizeBranchName(branch) || repository.selected_branch || repository.default_branch;
  const perPage = Math.max(1, Math.min(Number(limit) || 30, 100));
  const commits = await fetchGitHubJson(
    `/repos/${encodeRepositoryFullName(repository.full_name)}/commits?sha=${encodeURIComponent(activeBranch)}&per_page=${perPage}`,
    connection.access_token,
  );

  return {
    repository,
    branch: activeBranch,
    commits: commits.map((commit) => ({
      sha: commit.sha,
      shortSha: String(commit.sha || "").slice(0, 7),
      message: commit.commit?.message || "",
      headline: String(commit.commit?.message || "").split(/\r?\n/)[0] || "(no commit message)",
      authorName: commit.commit?.author?.name || commit.author?.login || "Unknown author",
      authorLogin: commit.author?.login || "",
      authoredAt: commit.commit?.author?.date || "",
      committerName: commit.commit?.committer?.name || commit.committer?.login || "",
      committedAt: commit.commit?.committer?.date || commit.commit?.author?.date || "",
      htmlUrl: commit.html_url || "",
    })),
  };
}

export async function listGitHubFileCommits(userId, { filePath, branch, limit } = {}) {
  const normalizedPath = normalizeGitHubPath(filePath);
  if (!normalizedPath) {
    throw Object.assign(new Error("A GitHub file path is required."), { statusCode: 400 });
  }

  const { connection, repository } = await getSelectedRepositoryContext(userId);
  const activeBranch = normalizeBranchName(branch) || repository.selected_branch || repository.default_branch;
  const perPage = Math.max(1, Math.min(Number(limit) || 30, 100));
  const commits = await fetchGitHubJson(
    `/repos/${encodeRepositoryFullName(repository.full_name)}/commits?sha=${encodeURIComponent(activeBranch)}&path=${encodeGitHubPath(normalizedPath)}&per_page=${perPage}`,
    connection.access_token,
  );

  return {
    repository,
    branch: activeBranch,
    filePath: normalizedPath,
    commits: commits.map((commit) => ({
      sha: commit.sha,
      shortSha: String(commit.sha || "").slice(0, 7),
      message: commit.commit?.message || "",
      headline: String(commit.commit?.message || "").split(/\r?\n/)[0] || "(no commit message)",
      authorName: commit.commit?.author?.name || commit.author?.login || "Unknown author",
      authorLogin: commit.author?.login || "",
      authoredAt: commit.commit?.author?.date || "",
      committerName: commit.commit?.committer?.name || commit.committer?.login || "",
      committedAt: commit.commit?.committer?.date || commit.commit?.author?.date || "",
      htmlUrl: commit.html_url || "",
    })),
  };
}

export async function checkoutGitHubBranch(userId, branchName) {
  const normalizedBranch = normalizeBranchName(branchName);
  if (!normalizedBranch) {
    throw Object.assign(new Error("Branch name is required."), { statusCode: 400 });
  }

  const { connection, repository } = await getSelectedRepositoryContext(userId);
  const branches = await fetchGitHubJson(
    `/repos/${encodeRepositoryFullName(repository.full_name)}/branches?per_page=100`,
    connection.access_token,
  );
  if (!branches.some((branch) => branch.name === normalizedBranch)) {
    throw Object.assign(new Error(`Branch '${normalizedBranch}' was not found in GitHub.`), { statusCode: 404 });
  }

  const result = await query(
    `
      update github_repositories
      set selected_branch = $3,
          updated_at = now()
      where id = $1
        and user_id = $2
      returning id, full_name, default_branch, selected_branch
    `,
    [repository.id, userId, normalizedBranch],
  );

  return { repository: result.rows[0] };
}

export async function createGitHubBranch(userId, branchName, baseBranch) {
  const normalizedBranch = normalizeBranchName(branchName);
  const normalizedBase = normalizeBranchName(baseBranch);
  if (!normalizedBranch) {
    throw Object.assign(new Error("New branch name is required."), { statusCode: 400 });
  }

  const { connection, repository } = await getSelectedRepositoryContext(userId);
  const actualBase = normalizedBase || repository.selected_branch || repository.default_branch;
  const baseRef = await fetchGitHubJson(
    `/repos/${encodeRepositoryFullName(repository.full_name)}/git/ref/heads/${encodeGitHubPath(actualBase)}`,
    connection.access_token,
  );
  const createdRef = await fetchGitHubJson(
    `/repos/${encodeRepositoryFullName(repository.full_name)}/git/refs`,
    connection.access_token,
    {
      method: "POST",
      body: {
        ref: `refs/heads/${normalizedBranch}`,
        sha: baseRef.object?.sha,
      },
    },
  );

  await query(
    `
      update github_repositories
      set selected_branch = $3,
          updated_at = now()
      where id = $1
        and user_id = $2
    `,
    [repository.id, userId, normalizedBranch],
  );

  return {
    branch: {
      name: normalizedBranch,
      sha: createdRef.object?.sha || baseRef.object?.sha || "",
      protected: false,
      active: true,
    },
  };
}

export async function commitGitHubDrafts(userId, { filePaths, message }) {
  const normalizedPaths = [...new Set((Array.isArray(filePaths) ? filePaths : [])
    .map(normalizeGitHubPath)
    .filter(Boolean))];
  const commitMessage = String(message || "").trim();

  if (!normalizedPaths.length) {
    throw Object.assign(new Error("Select at least one changed file to commit."), { statusCode: 400 });
  }
  if (!commitMessage) {
    throw Object.assign(new Error("Commit message is required."), { statusCode: 400 });
  }

  const { connection, repository } = await getSelectedRepositoryContext(userId);
  const branch = repository.selected_branch || repository.default_branch;
  const repositoryName = encodeRepositoryFullName(repository.full_name);
  const draftsResult = await query(
    `
      select
        file_path,
        github_sha,
        content_format,
        content_text,
        source_content_hash,
        draft_content_hash,
        case
          when source_content_hash is null then dirty
          else draft_content_hash is distinct from source_content_hash
        end as dirty
      from github_file_drafts
      where github_repository_id = $1
        and user_id = $2
        and file_path = any($3::text[])
    `,
    [repository.id, userId, normalizedPaths],
  );
  const draftsByPath = new Map(draftsResult.rows.map((draft) => [draft.file_path, draft]));
  const missingPaths = normalizedPaths.filter((filePath) => !draftsByPath.has(filePath));

  if (missingPaths.length) {
    throw Object.assign(new Error(`No saved draft exists for: ${missingPaths.join(", ")}`), { statusCode: 409 });
  }

  const ref = await fetchGitHubJson(
    `/repos/${repositoryName}/git/ref/heads/${encodeGitHubPath(branch)}`,
    connection.access_token,
  );
  const baseCommitSha = ref.object?.sha;
  if (!baseCommitSha) {
    throw Object.assign(new Error(`Could not resolve branch '${branch}'.`), { statusCode: 502 });
  }

  const baseCommit = await fetchGitHubJson(
    `/repos/${repositoryName}/git/commits/${encodeURIComponent(baseCommitSha)}`,
    connection.access_token,
  );
  const currentTree = await fetchGitHubJson(
    `/repos/${repositoryName}/git/trees/${encodeURIComponent(baseCommit.tree?.sha || branch)}?recursive=1`,
    connection.access_token,
  );
  const currentFilesByPath = new Map((currentTree.tree || [])
    .filter((entry) => entry.type === "blob")
    .map((entry) => [normalizeGitHubPath(entry.path), entry]));
  const conflicts = [];
  const tree = [];

  for (const filePath of normalizedPaths) {
    const draft = draftsByPath.get(filePath);
    const currentFile = currentFilesByPath.get(filePath);
    const knownSha = draft.github_sha || "";

    if (knownSha && currentFile?.sha && currentFile.sha !== knownSha) {
      conflicts.push(`${filePath} changed in GitHub since it was pulled`);
      continue;
    }
    if (!knownSha && currentFile?.sha) {
      conflicts.push(`${filePath} already exists in GitHub`);
      continue;
    }

    const blob = await fetchGitHubJson(
      `/repos/${repositoryName}/git/blobs`,
      connection.access_token,
      {
        method: "POST",
        body: {
          content: String(draft.content_text ?? ""),
          encoding: "utf-8",
        },
      },
    );

    tree.push({
      path: filePath,
      mode: "100644",
      type: "blob",
      sha: blob.sha,
      contentHash: hashContent(draft.content_text),
      contentFormat: draft.content_format || "xml",
      sizeBytes: Buffer.byteLength(String(draft.content_text ?? ""), "utf8"),
    });
  }

  if (conflicts.length) {
    throw Object.assign(new Error(`Commit blocked. ${conflicts.join("; ")}.`), {
      statusCode: 409,
      conflicts,
    });
  }

  const nextTree = await fetchGitHubJson(
    `/repos/${repositoryName}/git/trees`,
    connection.access_token,
    {
      method: "POST",
      body: {
        base_tree: baseCommit.tree?.sha,
        tree: tree.map((entry) => ({
          path: entry.path,
          mode: entry.mode,
          type: entry.type,
          sha: entry.sha,
        })),
      },
    },
  );
  const nextCommit = await fetchGitHubJson(
    `/repos/${repositoryName}/git/commits`,
    connection.access_token,
    {
      method: "POST",
      body: {
        message: commitMessage,
        tree: nextTree.sha,
        parents: [baseCommitSha],
      },
    },
  );

  await fetchGitHubJson(
    `/repos/${repositoryName}/git/refs/heads/${encodeGitHubPath(branch)}`,
    connection.access_token,
    {
      method: "PATCH",
      body: {
        sha: nextCommit.sha,
        force: false,
      },
    },
  );

  const membership = await getPrimaryMembership(userId);
  const project = membership ? await upsertGitHubProject(userId, membership, repository) : null;
  const committedFiles = [];

  for (const entry of tree) {
    await query(
      `
        update github_file_drafts
        set github_sha = $4,
            source_content_hash = $5,
            draft_content_hash = $5,
            dirty = false,
            saved_at = now(),
            updated_at = now()
        where github_repository_id = $1
          and user_id = $2
          and file_path = $3
      `,
      [repository.id, userId, entry.path, entry.sha, entry.contentHash],
    );

    if (project) {
      await upsertProjectFileWithParents({
        projectId: project.id,
        filePath: entry.path,
        contentFormat: entry.contentFormat,
        githubSha: entry.sha,
        sizeBytes: entry.sizeBytes,
        userId,
      });
    }

    committedFiles.push({
      path: entry.path,
      sha: entry.sha,
      contentHash: entry.contentHash,
    });
  }

  return {
    repository,
    branch,
    commit: {
      sha: nextCommit.sha,
      htmlUrl: nextCommit.html_url,
      message: commitMessage,
    },
    files: committedFiles,
  };
}

export async function createGitHubLocalCommit(userId, { filePaths, message }) {
  const normalizedPaths = [...new Set((Array.isArray(filePaths) ? filePaths : [])
    .map(normalizeGitHubPath)
    .filter(Boolean))];
  const commitMessage = String(message || "").trim();

  if (!normalizedPaths.length) {
    throw Object.assign(new Error("Select at least one changed file to commit."), { statusCode: 400 });
  }
  if (!commitMessage) {
    throw Object.assign(new Error("Commit message is required."), { statusCode: 400 });
  }

  const { repository } = await getSelectedRepositoryContext(userId);
  const branch = repository.selected_branch || repository.default_branch;
  const membership = await getPrimaryMembership(userId);
  const draftsResult = await query(
    `
      select
        file_path,
        github_sha,
        content_format,
        content_text,
        source_content_hash,
        coalesce(draft_content_hash, encode(digest(content_text, 'sha256'), 'hex')) as draft_content_hash
      from github_file_drafts
      where github_repository_id = $1
        and user_id = $2
        and file_path = any($3::text[])
    `,
    [repository.id, userId, normalizedPaths],
  );
  const draftsByPath = new Map(draftsResult.rows.map((draft) => [draft.file_path, draft]));
  const missingPaths = normalizedPaths.filter((filePath) => !draftsByPath.has(filePath));

  if (missingPaths.length) {
    throw Object.assign(new Error(`No saved draft exists for: ${missingPaths.join(", ")}`), { statusCode: 409 });
  }

  const localCommitResult = await query(
    `
      insert into github_local_commits (
        github_repository_id,
        user_id,
        organization_id,
        team_id,
        branch_name,
        message
      )
      values ($1, $2, $3, $4, $5, $6)
      returning id, branch_name, message, status, created_at
    `,
    [
      repository.id,
      userId,
      membership?.organization_id || null,
      membership?.team_id || null,
      branch,
      commitMessage,
    ],
  );
  const localCommit = localCommitResult.rows[0];
  const files = [];

  for (const filePath of normalizedPaths) {
    const draft = draftsByPath.get(filePath);
    const contentText = String(draft.content_text ?? "");
    const sizeBytes = Buffer.byteLength(contentText, "utf8");

    const fileResult = await query(
      `
        insert into github_local_commit_files (
          local_commit_id,
          file_path,
          github_sha,
          source_content_hash,
          draft_content_hash,
          content_format,
          content_text,
          size_bytes
        )
        values ($1, $2, $3, $4, $5, $6, $7, $8)
        returning file_path, github_sha, source_content_hash, draft_content_hash, content_format, size_bytes
      `,
      [
        localCommit.id,
        filePath,
        draft.github_sha || null,
        draft.source_content_hash || null,
        draft.draft_content_hash || hashContent(contentText),
        draft.content_format || "xml",
        contentText,
        sizeBytes,
      ],
    );
    files.push(fileResult.rows[0]);
  }

  return {
    repository,
    branch,
    localCommit: {
      ...localCommit,
      files,
    },
  };
}

export async function listGitHubLocalCommits(userId, { branch } = {}) {
  const { repository } = await getSelectedRepositoryContext(userId);
  const activeBranch = normalizeBranchName(branch) || repository.selected_branch || repository.default_branch;
  const result = await query(
    `
      select
        github_local_commits.id,
        github_local_commits.branch_name,
        github_local_commits.message,
        github_local_commits.status,
        github_local_commits.github_commit_sha,
        github_local_commits.github_commit_url,
        github_local_commits.error_message,
        github_local_commits.created_at,
        github_local_commits.published_at,
        coalesce(
          json_agg(
            json_build_object(
              'filePath', github_local_commit_files.file_path,
              'githubSha', github_local_commit_files.github_sha,
              'draftContentHash', github_local_commit_files.draft_content_hash,
              'contentFormat', github_local_commit_files.content_format,
              'sizeBytes', github_local_commit_files.size_bytes
            )
            order by github_local_commit_files.file_path
          ) filter (where github_local_commit_files.id is not null),
          '[]'::json
        ) as files
      from github_local_commits
      left join github_local_commit_files
        on github_local_commit_files.local_commit_id = github_local_commits.id
      where github_local_commits.github_repository_id = $1
        and github_local_commits.user_id = $2
        and github_local_commits.branch_name = $3
        and github_local_commits.status = 'pending'
      group by github_local_commits.id
      order by github_local_commits.created_at asc
    `,
    [repository.id, userId, activeBranch],
  );

  return {
    repository,
    branch: activeBranch,
    localCommits: result.rows,
  };
}

export async function publishGitHubLocalCommits(userId, { localCommitIds } = {}) {
  const { connection, repository } = await getSelectedRepositoryContext(userId);
  const branch = repository.selected_branch || repository.default_branch;
  const selectedIds = Array.isArray(localCommitIds)
    ? localCommitIds.map((id) => String(id || "").trim()).filter(Boolean)
    : [];
  const idFilter = selectedIds.length ? "and github_local_commits.id = any($4::uuid[])" : "";
  const params = selectedIds.length
    ? [repository.id, userId, branch, selectedIds]
    : [repository.id, userId, branch];
  const commitsResult = await query(
    `
      select id, message, branch_name, created_at
      from github_local_commits
      where github_repository_id = $1
        and user_id = $2
        and branch_name = $3
        and status = 'pending'
        ${idFilter}
      order by created_at asc
    `,
    params,
  );

  if (!commitsResult.rowCount) {
    throw Object.assign(new Error("There are no local commits ready to publish."), { statusCode: 400 });
  }

  const publishedCommits = [];
  const publishedFiles = [];
  const latestPublishedShaByPath = new Map();

  for (const localCommit of commitsResult.rows) {
    const filesResult = await query(
      `
        select
          file_path,
          github_sha,
          source_content_hash,
          draft_content_hash,
          content_format,
          content_text,
          size_bytes
        from github_local_commit_files
        where local_commit_id = $1
        order by file_path
      `,
      [localCommit.id],
    );
    const files = filesResult.rows.map((file) => {
      const filePath = normalizeGitHubPath(file.file_path);
      return {
        ...file,
        github_sha: latestPublishedShaByPath.get(filePath) || file.github_sha,
      };
    });

    try {
      const published = await publishGitHubSnapshots({
        userId,
        connection,
        repository,
        branch,
        message: localCommit.message,
        files,
      });

      await query(
        `
          update github_local_commits
          set status = 'published',
              github_commit_sha = $2,
              github_commit_url = $3,
              error_message = null,
              published_at = now(),
              updated_at = now()
          where id = $1
        `,
        [localCommit.id, published.commit.sha, published.commit.htmlUrl],
      );

      publishedCommits.push({
        id: localCommit.id,
        ...published.commit,
      });
      publishedFiles.push(...published.files);
      published.files.forEach((file) => {
        latestPublishedShaByPath.set(normalizeGitHubPath(file.path), file.sha);
      });
    } catch (error) {
      await query(
        `
          update github_local_commits
          set status = 'failed',
              error_message = $2,
              updated_at = now()
          where id = $1
        `,
        [localCommit.id, error.message],
      );
      throw error;
    }
  }

  return {
    repository,
    branch,
    commits: publishedCommits,
    files: publishedFiles,
  };
}

async function publishGitHubSnapshots({ userId, connection, repository, branch, message, files }) {
  const repositoryName = encodeRepositoryFullName(repository.full_name);
  const ref = await fetchGitHubJson(
    `/repos/${repositoryName}/git/ref/heads/${encodeGitHubPath(branch)}`,
    connection.access_token,
  );
  const baseCommitSha = ref.object?.sha;
  if (!baseCommitSha) {
    throw Object.assign(new Error(`Could not resolve branch '${branch}'.`), { statusCode: 502 });
  }

  const baseCommit = await fetchGitHubJson(
    `/repos/${repositoryName}/git/commits/${encodeURIComponent(baseCommitSha)}`,
    connection.access_token,
  );
  const currentTree = await fetchGitHubJson(
    `/repos/${repositoryName}/git/trees/${encodeURIComponent(baseCommit.tree?.sha || branch)}?recursive=1`,
    connection.access_token,
  );
  const currentFilesByPath = new Map((currentTree.tree || [])
    .filter((entry) => entry.type === "blob")
    .map((entry) => [normalizeGitHubPath(entry.path), entry]));
  const conflicts = [];
  const tree = [];

  for (const file of files) {
    const filePath = normalizeGitHubPath(file.file_path);
    const currentFile = currentFilesByPath.get(filePath);
    const knownSha = file.github_sha || "";
    const contentText = String(file.content_text ?? "");

    if (knownSha && currentFile?.sha && currentFile.sha !== knownSha) {
      let remoteContent = "";
      try {
        const remoteBlob = await fetchGitHubJson(
          `/repos/${repositoryName}/git/blobs/${encodeURIComponent(currentFile.sha)}`,
          connection.access_token,
        );
        remoteContent = Buffer.from(String(remoteBlob.content || "").replace(/\s/g, ""), "base64").toString("utf8");
      } catch {
        remoteContent = "";
      }
      conflicts.push({
        filePath,
        baseSha: knownSha,
        currentSha: currentFile.sha,
        remoteContent,
        remoteContentHash: hashContent(remoteContent),
        localContent: contentText,
        localContentHash: hashContent(contentText),
        message: `${filePath} changed in GitHub since it was pulled.`,
      });
      continue;
    }
    if (!knownSha && currentFile?.sha) {
      conflicts.push({
        filePath,
        baseSha: "",
        currentSha: currentFile.sha,
        remoteContent: "",
        remoteContentHash: "",
        localContent: contentText,
        localContentHash: hashContent(contentText),
        message: `${filePath} already exists in GitHub.`,
      });
      continue;
    }

    const blob = await fetchGitHubJson(
      `/repos/${repositoryName}/git/blobs`,
      connection.access_token,
      {
        method: "POST",
        body: {
          content: contentText,
          encoding: "utf-8",
        },
      },
    );

    tree.push({
      path: filePath,
      mode: "100644",
      type: "blob",
      sha: blob.sha,
      contentHash: hashContent(contentText),
      contentFormat: file.content_format || "xml",
      sizeBytes: Number(file.size_bytes || Buffer.byteLength(contentText, "utf8")),
    });
  }

  if (conflicts.length) {
    throw Object.assign(new Error(`Publish blocked. ${conflicts.map((conflict) => conflict.message).join(" ")}`), {
      statusCode: 409,
      conflicts,
    });
  }

  const nextTree = await fetchGitHubJson(
    `/repos/${repositoryName}/git/trees`,
    connection.access_token,
    {
      method: "POST",
      body: {
        base_tree: baseCommit.tree?.sha,
        tree: tree.map((entry) => ({
          path: entry.path,
          mode: entry.mode,
          type: entry.type,
          sha: entry.sha,
        })),
      },
    },
  );
  const nextCommit = await fetchGitHubJson(
    `/repos/${repositoryName}/git/commits`,
    connection.access_token,
    {
      method: "POST",
      body: {
        message,
        tree: nextTree.sha,
        parents: [baseCommitSha],
      },
    },
  );

  await fetchGitHubJson(
    `/repos/${repositoryName}/git/refs/heads/${encodeGitHubPath(branch)}`,
    connection.access_token,
    {
      method: "PATCH",
      body: {
        sha: nextCommit.sha,
        force: false,
      },
    },
  );

  const membership = await getPrimaryMembership(userId);
  const project = membership ? await upsertGitHubProject(userId, membership, repository) : null;
  const committedFiles = [];

  for (const entry of tree) {
    await query(
      `
        update github_file_drafts
        set github_sha = $4,
            source_content_hash = $5,
            draft_content_hash = $5,
            dirty = false,
            saved_at = now(),
            updated_at = now()
        where github_repository_id = $1
          and user_id = $2
          and file_path = $3
      `,
      [repository.id, userId, entry.path, entry.sha, entry.contentHash],
    );

    if (project) {
      await upsertProjectFileWithParents({
        projectId: project.id,
        filePath: entry.path,
        contentFormat: entry.contentFormat,
        githubSha: entry.sha,
        sizeBytes: entry.sizeBytes,
        userId,
      });
    }

    committedFiles.push({
      path: entry.path,
      sha: entry.sha,
      contentHash: entry.contentHash,
    });
  }

  return {
    commit: {
      sha: nextCommit.sha,
      htmlUrl: nextCommit.html_url,
      message,
    },
    files: committedFiles,
  };
}

async function upsertProjectFileWithParents({ projectId, filePath, contentFormat, githubSha, sizeBytes, userId }) {
  const parts = normalizeGitHubPath(filePath).split("/").filter(Boolean);
  let parentId = null;

  for (let index = 0; index < parts.length - 1; index += 1) {
    const folderPath = parts.slice(0, index + 1).join("/");
    const folder = await upsertProjectFile({
      projectId,
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
    projectId,
    parentId,
    path: filePath,
    name: parts[parts.length - 1],
    kind: "file",
    ditaType: inferDitaType(filePath, contentFormat),
    mimeType: inferMimeType(filePath),
    githubSha,
    sizeBytes,
    userId,
  });
}

async function getConnectionWithToken(userId) {
  const result = await query(
    `
      select id, access_token
      from github_connections
      where user_id = $1
    `,
    [userId],
  );

  if (!result.rowCount) {
    throw Object.assign(new Error("GitHub is not connected for this user."), { statusCode: 409 });
  }

  return result.rows[0];
}

async function getSelectedRepositoryContext(userId) {
  const connection = await getConnectionWithToken(userId);
  const repositoryResult = await query(
    `
      select id, full_name, owner_login, name, default_branch, selected_branch, private, html_url, selected_at
      from github_repositories
      where user_id = $1
      order by selected_at desc
      limit 1
    `,
    [userId],
  );

  if (!repositoryResult.rowCount) {
    throw Object.assign(new Error("Select a GitHub repository before loading files."), { statusCode: 409 });
  }

  return {
    connection,
    repository: repositoryResult.rows[0],
  };
}

async function syncGitHubTreeMetadata(userId, repository, entries) {
  const membership = await getPrimaryMembership(userId);
  if (!membership) {
    return {
      persisted: false,
      reason: "User is not assigned to an organization/team.",
    };
  }

  const project = await upsertGitHubProject(userId, membership, repository);
  const sortedEntries = [...entries].sort((left, right) => {
    const leftDepth = normalizeGitHubPath(left.path).split("/").length;
    const rightDepth = normalizeGitHubPath(right.path).split("/").length;
    if (leftDepth !== rightDepth) return leftDepth - rightDepth;
    if (left.type !== right.type) return left.type === "folder" ? -1 : 1;
    return left.path.localeCompare(right.path);
  });
  const folderIds = new Map();
  const syncedPaths = [];

  for (const entry of sortedEntries) {
    const normalizedPath = normalizeGitHubPath(entry.path);
    if (!normalizedPath) continue;

    const parts = normalizedPath.split("/");
    const name = parts[parts.length - 1];
    const parentPath = parts.slice(0, -1).join("/");
    const parentId = parentPath ? folderIds.get(parentPath) || null : null;
    const file = await upsertProjectFile({
      projectId: project.id,
      parentId,
      path: normalizedPath,
      name,
      kind: entry.type === "folder" ? "folder" : "file",
      ditaType: entry.type === "file" ? inferDitaType(name) : null,
      mimeType: entry.type === "file" ? inferMimeType(name) : null,
      githubSha: entry.sha || null,
      sizeBytes: entry.type === "file" ? entry.size || null : null,
      userId,
    });

    if (entry.type === "folder") {
      folderIds.set(normalizedPath, file.id);
    }
    syncedPaths.push(normalizedPath);
  }

  if (syncedPaths.length) {
    await query(
      `
        delete from project_files
        where project_id = $1
          and path <> all($2::text[])
      `,
      [project.id, syncedPaths],
    );
  } else {
    await query("delete from project_files where project_id = $1", [project.id]);
  }

  return {
    persisted: true,
    projectId: project.id,
    fileCount: syncedPaths.length,
  };
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
      returning id, name, slug
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
      returning id
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

function slugify(value) {
  return String(value || "repository")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80) || "repository";
}

function inferDitaType(fileName) {
  const extension = fileName.split(".").pop()?.toLowerCase() || "";
  if (extension === "ditamap") return "map";
  if (extension === "dita" || extension === "xml") return "topic";
  if (/^(avif|gif|jpe?g|png|svg|webp)$/i.test(extension)) return "image";
  if (["html", "htm"].includes(extension)) return "html";
  return "text";
}

function inferMimeType(fileName) {
  const extension = fileName.split(".").pop()?.toLowerCase() || "";
  const mimeTypes = {
    avif: "image/avif",
    css: "text/css",
    dita: "application/dita+xml",
    ditamap: "application/ditamap+xml",
    gif: "image/gif",
    htm: "text/html",
    html: "text/html",
    jpeg: "image/jpeg",
    jpg: "image/jpeg",
    js: "text/javascript",
    json: "application/json",
    md: "text/markdown",
    png: "image/png",
    svg: "image/svg+xml",
    txt: "text/plain",
    webp: "image/webp",
    xml: "application/xml",
  };

  return mimeTypes[extension] || "application/octet-stream";
}

function encodeRepositoryFullName(fullName) {
  return String(fullName || "")
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");
}

function encodeGitHubPath(filePath) {
  return normalizeGitHubPath(filePath)
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");
}

function normalizeGitHubPath(value) {
  return String(value || "")
    .replace(/\\/g, "/")
    .split("/")
    .filter((part) => part && part !== "." && part !== "..")
    .join("/");
}

function normalizeBranchName(value) {
  return String(value || "")
    .trim()
    .replace(/^refs\/heads\//, "")
    .replace(/\\/g, "/")
    .split("/")
    .filter((part) => part && part !== "." && part !== "..")
    .join("/");
}

function isTextExtension(extension) {
  return [
    "css",
    "dita",
    "ditamap",
    "htm",
    "html",
    "js",
    "json",
    "md",
    "mjs",
    "svg",
    "ts",
    "tsx",
    "txt",
    "xml",
    "xsd",
    "xsl",
    "xslt",
    "yaml",
    "yml",
  ].includes(extension);
}

function getMimeType(extension) {
  const mimeTypes = {
    avif: "image/avif",
    gif: "image/gif",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    svg: "image/svg+xml",
    webp: "image/webp",
  };

  return mimeTypes[extension] || "application/octet-stream";
}

async function fetchGitHubJson(path, accessToken, options = {}) {
  const response = await fetch(`${githubApiBase}${path}`, {
    method: options.method || "GET",
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${accessToken}`,
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      "User-Agent": "xml-editor-local-poc",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const body = await response.json();

  if (!response.ok) {
    throw Object.assign(new Error(body.message || "GitHub API request failed."), {
      statusCode: response.status >= 500 ? 502 : response.status,
    });
  }

  return body;
}
