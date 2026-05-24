alter table app_users
  add column if not exists auth_provider text not null default 'auth0',
  add column if not exists auth_subject text;

update app_users
set auth_subject = 'legacy:' || id::text
where auth_subject is null;

alter table app_users
  alter column auth_subject set not null;

create unique index if not exists app_users_auth_identity_idx
  on app_users(auth_provider, auth_subject);
