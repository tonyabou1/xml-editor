alter table github_file_drafts
  add column if not exists source_content_hash text,
  add column if not exists draft_content_hash text;

create index if not exists github_file_drafts_dirty_hash_idx
  on github_file_drafts(github_repository_id, user_id, file_path, source_content_hash, draft_content_hash);
