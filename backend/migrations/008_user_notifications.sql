create table user_notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references app_users(id) on delete cascade,
  organization_id uuid references organizations(id) on delete set null,
  team_id uuid references teams(id) on delete set null,
  severity text not null check (severity in ('info', 'warning', 'error')),
  title text not null,
  body text not null,
  source text,
  dismissed_at timestamptz,
  created_at timestamptz not null default now()
);

create index user_notifications_user_created_idx
  on user_notifications(user_id, created_at desc);
