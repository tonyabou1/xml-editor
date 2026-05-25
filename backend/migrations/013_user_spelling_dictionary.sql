create table user_spelling_dictionary (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references app_users(id) on delete cascade,
  language text not null default 'en',
  word text not null,
  normalized_word text not null,
  created_at timestamptz not null default now(),
  unique (user_id, language, normalized_word)
);

create index user_spelling_dictionary_user_language_idx
  on user_spelling_dictionary(user_id, language);
