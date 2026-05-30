create table if not exists team_design_tokens (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  team_id uuid not null references teams(id) on delete cascade,
  token_key text not null,
  token_type text not null check (
    token_type in ('color', 'space', 'radius', 'border', 'shadow', 'font', 'typography', 'number', 'asset')
  ),
  token_value text not null,
  description text not null default '',
  created_by uuid references app_users(id) on delete set null,
  updated_by uuid references app_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (team_id, token_key)
);

create index if not exists idx_team_design_tokens_team
  on team_design_tokens(team_id, token_type, token_key);

create table if not exists team_style_classes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  team_id uuid not null references teams(id) on delete cascade,
  class_key text not null,
  display_name text not null,
  description text not null default '',
  applies_to text not null default 'both' check (applies_to in ('container', 'slot', 'dita', 'both')),
  style_json jsonb not null default '{}'::jsonb,
  text_style_json jsonb not null default '{}'::jsonb,
  created_by uuid references app_users(id) on delete set null,
  updated_by uuid references app_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (team_id, class_key)
);

create index if not exists idx_team_style_classes_team
  on team_style_classes(team_id, applies_to, class_key);
