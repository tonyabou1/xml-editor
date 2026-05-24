alter table github_repositories
  add column if not exists selected_branch text;

update github_repositories
set selected_branch = default_branch
where selected_branch is null;
