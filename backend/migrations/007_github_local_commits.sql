create table github_local_commits (
  id uuid primary key default gen_random_uuid(),
  github_repository_id uuid not null references github_repositories(id) on delete cascade,
  user_id uuid not null references app_users(id) on delete cascade,
  organization_id uuid references organizations(id) on delete set null,
  team_id uuid references teams(id) on delete set null,
  branch_name text not null,
  message text not null,
  status text not null default 'pending' check (status in ('pending', 'published', 'failed')),
  github_commit_sha text,
  github_commit_url text,
  error_message text,
  created_at timestamptz not null default now(),
  published_at timestamptz,
  updated_at timestamptz not null default now()
);

create table github_local_commit_files (
  id uuid primary key default gen_random_uuid(),
  local_commit_id uuid not null references github_local_commits(id) on delete cascade,
  file_path text not null,
  github_sha text,
  source_content_hash text,
  draft_content_hash text not null,
  content_format text not null default 'xml',
  content_text text not null default '',
  size_bytes bigint not null default 0,
  created_at timestamptz not null default now(),
  unique (local_commit_id, file_path)
);

create index github_local_commits_pending_idx
  on github_local_commits(github_repository_id, user_id, branch_name, status, created_at);

create index github_local_commit_files_commit_idx
  on github_local_commit_files(local_commit_id);
