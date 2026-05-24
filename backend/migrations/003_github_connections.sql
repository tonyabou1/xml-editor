create table github_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references app_users(id) on delete cascade,
  github_user_id bigint,
  github_login text,
  access_token text not null,
  scope text,
  token_type text,
  connected_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id)
);

create table github_repositories (
  id uuid primary key default gen_random_uuid(),
  connection_id uuid not null references github_connections(id) on delete cascade,
  user_id uuid not null references app_users(id) on delete cascade,
  github_repository_id bigint not null,
  full_name text not null,
  owner_login text not null,
  name text not null,
  default_branch text not null default 'main',
  private boolean not null default false,
  html_url text not null,
  selected_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, github_repository_id)
);

create index github_repositories_user_id_idx on github_repositories(user_id);
