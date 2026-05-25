alter table projects
  add column if not exists storage_provider text not null default 'github'
    check (storage_provider in ('none', 'github', 's3', 'local', 'other')),
  add column if not exists storage_config jsonb not null default '{}'::jsonb,
  add column if not exists updated_by uuid references app_users(id) on delete set null;

create table if not exists user_teams (
  user_id uuid not null references app_users(id) on delete cascade,
  team_id uuid not null references teams(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, team_id)
);

insert into user_teams (user_id, team_id, created_at)
select user_id, team_id, created_at
from team_members
on conflict (user_id, team_id) do nothing;

create table if not exists user_project_roles (
  user_id uuid not null references app_users(id) on delete cascade,
  project_id uuid not null references projects(id) on delete cascade,
  role_id uuid not null references roles(id) on delete cascade,
  granted_by uuid references app_users(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (user_id, project_id, role_id)
);

create index if not exists user_project_roles_project_idx
  on user_project_roles(project_id, role_id);

create table if not exists team_project_roles (
  team_id uuid not null references teams(id) on delete cascade,
  project_id uuid not null references projects(id) on delete cascade,
  role_id uuid not null references roles(id) on delete cascade,
  granted_by uuid references app_users(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (team_id, project_id, role_id)
);

create index if not exists team_project_roles_project_idx
  on team_project_roles(project_id, role_id);

create table if not exists project_storage_connections (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  provider text not null check (provider in ('github', 's3', 'local', 'other')),
  display_name text not null,
  config_json jsonb not null default '{}'::jsonb,
  encrypted_credentials text,
  is_default boolean not null default false,
  disabled_at timestamptz,
  created_by uuid references app_users(id) on delete set null,
  updated_by uuid references app_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, provider, display_name)
);

create unique index if not exists project_storage_connections_default_idx
  on project_storage_connections(project_id, provider)
  where is_default = true and disabled_at is null;

create table if not exists provider_file_sync_state (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  file_id uuid references project_files(id) on delete cascade,
  storage_connection_id uuid references project_storage_connections(id) on delete cascade,
  provider text not null check (provider in ('github', 's3', 'local', 'other')),
  branch_name text,
  provider_path text not null,
  provider_version text,
  provider_hash text,
  metadata_json jsonb not null default '{}'::jsonb,
  last_pulled_at timestamptz,
  last_published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists provider_file_sync_state_unique_idx
  on provider_file_sync_state(project_id, provider, coalesce(branch_name, ''), provider_path);

create index if not exists provider_file_sync_state_file_idx
  on provider_file_sync_state(file_id);

create table if not exists file_working_copies (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  file_id uuid references project_files(id) on delete set null,
  user_id uuid not null references app_users(id) on delete cascade,
  branch_name text not null default 'main',
  file_path text not null,
  content_format text not null default 'xml',
  content_text text not null default '',
  content_hash text,
  base_provider_hash text,
  base_provider_version text,
  dirty boolean not null default true,
  status text not null default 'draft' check (status in ('draft', 'checked_in', 'published', 'discarded')),
  change_type text not null default 'upsert' check (change_type in ('upsert', 'delete')),
  deleted_at timestamptz,
  expires_at timestamptz,
  saved_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, user_id, branch_name, file_path)
);

create index if not exists file_working_copies_project_user_idx
  on file_working_copies(project_id, user_id, branch_name, dirty);

create index if not exists file_working_copies_file_idx
  on file_working_copies(file_id);

create table if not exists local_change_sets (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  user_id uuid not null references app_users(id) on delete cascade,
  branch_name text not null default 'main',
  message text not null,
  status text not null default 'pending_publish'
    check (status in ('pending_publish', 'published', 'failed', 'discarded')),
  provider text check (provider in ('github', 's3', 'local', 'other')),
  provider_revision text,
  provider_url text,
  error_message text,
  created_at timestamptz not null default now(),
  published_at timestamptz,
  updated_at timestamptz not null default now()
);

create index if not exists local_change_sets_project_pending_idx
  on local_change_sets(project_id, user_id, branch_name, status, created_at);

create table if not exists local_change_set_files (
  id uuid primary key default gen_random_uuid(),
  change_set_id uuid not null references local_change_sets(id) on delete cascade,
  file_id uuid references project_files(id) on delete set null,
  file_path text not null,
  content_hash text,
  base_provider_hash text,
  base_provider_version text,
  content_format text not null default 'xml',
  content_text text not null default '',
  change_type text not null default 'upsert' check (change_type in ('upsert', 'delete')),
  size_bytes bigint not null default 0,
  created_at timestamptz not null default now(),
  unique (change_set_id, file_path)
);

create index if not exists local_change_set_files_file_idx
  on local_change_set_files(file_id);
