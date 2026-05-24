create extension if not exists pgcrypto;

create table organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table teams (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  name text not null,
  slug text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, slug)
);

create table app_users (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  display_name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table roles (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references organizations(id) on delete cascade,
  name text not null,
  description text not null default '',
  is_system boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, name)
);

create table permissions (
  key text primary key,
  description text not null default ''
);

create table role_permissions (
  role_id uuid not null references roles(id) on delete cascade,
  permission_key text not null references permissions(key) on delete cascade,
  primary key (role_id, permission_key)
);

create table team_members (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references teams(id) on delete cascade,
  user_id uuid not null references app_users(id) on delete cascade,
  role_id uuid references roles(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (team_id, user_id)
);

create table projects (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  team_id uuid references teams(id) on delete set null,
  name text not null,
  slug text not null,
  repository_url text,
  default_branch text not null default 'main',
  created_by uuid references app_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, slug)
);

create table project_files (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  parent_id uuid references project_files(id) on delete cascade,
  path text not null,
  name text not null,
  kind text not null check (kind in ('folder', 'file')),
  dita_type text,
  mime_type text,
  github_sha text,
  size_bytes bigint,
  created_by uuid references app_users(id) on delete set null,
  updated_by uuid references app_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, path)
);

create table file_locks (
  file_id uuid primary key references project_files(id) on delete cascade,
  user_id uuid not null references app_users(id) on delete cascade,
  locked_at timestamptz not null default now(),
  expires_at timestamptz
);

create table file_versions (
  id uuid primary key default gen_random_uuid(),
  file_id uuid not null references project_files(id) on delete cascade,
  version_number integer not null,
  source text not null check (source in ('github', 'database', 'validation', 'checkin')),
  github_sha text,
  content_text text,
  content_ref text,
  created_by uuid references app_users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (file_id, version_number)
);

create table schema_versions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  name text not null,
  dita_version text not null default '1.3',
  status text not null default 'draft' check (status in ('draft', 'valid', 'invalid', 'published', 'archived')),
  uploaded_by uuid references app_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, name)
);

create table schema_profiles (
  id uuid primary key default gen_random_uuid(),
  schema_version_id uuid not null references schema_versions(id) on delete cascade,
  document_type text not null,
  profile_json jsonb not null,
  generated_at timestamptz not null default now(),
  unique (schema_version_id, document_type)
);

create table specialization_definitions (
  id uuid primary key default gen_random_uuid(),
  schema_version_id uuid not null references schema_versions(id) on delete cascade,
  organization_id uuid not null references organizations(id) on delete cascade,
  kind text not null check (kind in ('element', 'documentType')),
  name text not null,
  base_name text not null,
  module_name text not null,
  class_chain text,
  definition_json jsonb not null default '{}'::jsonb,
  status text not null default 'draft' check (status in ('draft', 'valid', 'invalid', 'published')),
  created_by uuid references app_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (schema_version_id, kind, name)
);

create table validation_runs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references projects(id) on delete cascade,
  file_id uuid references project_files(id) on delete set null,
  schema_version_id uuid references schema_versions(id) on delete set null,
  requested_by uuid references app_users(id) on delete set null,
  status text not null check (status in ('valid', 'invalid', 'error')),
  report text not null default '',
  issues_json jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

insert into permissions (key, description) values
  ('organization.manage', 'Manage organization settings and membership'),
  ('team.manage', 'Manage teams and team membership'),
  ('project.read', 'View projects and files'),
  ('project.write', 'Create, edit, rename, move, and delete project files'),
  ('project.checkin', 'Check files back into source control'),
  ('schema.manage', 'Upload schemas and manage specialization definitions'),
  ('validation.run', 'Run DITA validation')
on conflict (key) do nothing;

create index teams_organization_id_idx on teams(organization_id);
create index team_members_user_id_idx on team_members(user_id);
create index projects_organization_id_idx on projects(organization_id);
create index project_files_project_id_idx on project_files(project_id);
create index project_files_parent_id_idx on project_files(parent_id);
create index file_versions_file_id_idx on file_versions(file_id);
create index schema_versions_organization_id_idx on schema_versions(organization_id);
create index specialization_definitions_schema_version_id_idx on specialization_definitions(schema_version_id);
create index validation_runs_project_id_idx on validation_runs(project_id);
