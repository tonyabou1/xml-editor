create table github_file_drafts (
  id uuid primary key default gen_random_uuid(),
  github_repository_id uuid not null references github_repositories(id) on delete cascade,
  user_id uuid not null references app_users(id) on delete cascade,
  organization_id uuid references organizations(id) on delete set null,
  team_id uuid references teams(id) on delete set null,
  file_path text not null,
  github_sha text,
  content_format text not null default 'xml',
  content_text text not null default '',
  dirty boolean not null default true,
  saved_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (github_repository_id, user_id, file_path)
);

create index github_file_drafts_user_id_idx on github_file_drafts(user_id);
create index github_file_drafts_repository_id_idx on github_file_drafts(github_repository_id);
