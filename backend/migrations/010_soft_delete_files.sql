alter table project_files
  add column if not exists deleted_at timestamptz;

alter table github_file_drafts
  add column if not exists deleted_at timestamptz;

alter table github_file_drafts
  add column if not exists change_type text not null default 'upsert';

alter table github_local_commit_files
  add column if not exists change_type text not null default 'upsert';

create index if not exists project_files_deleted_at_idx
  on project_files(project_id, deleted_at);

create index if not exists github_file_drafts_deleted_at_idx
  on github_file_drafts(github_repository_id, user_id, deleted_at);
