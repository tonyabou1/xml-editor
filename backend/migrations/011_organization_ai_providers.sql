create table organization_ai_providers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  provider text not null check (provider in ('openai', 'anthropic', 'azure_openai', 'other')),
  display_name text not null,
  encrypted_api_key text not null,
  key_last_four text,
  key_fingerprint text,
  default_model text not null,
  is_default boolean not null default false,
  disabled_at timestamptz,
  created_by uuid references app_users(id) on delete set null,
  updated_by uuid references app_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, provider, display_name)
);

create unique index organization_ai_providers_default_idx
  on organization_ai_providers(organization_id, provider)
  where is_default = true and disabled_at is null;

create index organization_ai_providers_org_idx
  on organization_ai_providers(organization_id, provider, disabled_at);

create table organization_ai_model_settings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  provider_id uuid not null references organization_ai_providers(id) on delete cascade,
  feature_key text not null,
  model_name text not null,
  temperature numeric(3, 2),
  max_tokens integer,
  settings_json jsonb not null default '{}'::jsonb,
  created_by uuid references app_users(id) on delete set null,
  updated_by uuid references app_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, feature_key)
);

create index organization_ai_model_settings_provider_idx
  on organization_ai_model_settings(provider_id);
