alter table public.league_settings
  add column if not exists home_headline text not null default 'The stream is lively today.',
  add column if not exists home_copy text not null default 'Track the rivalry, chase today''s challenge, and inspect every suspiciously impressive catch.';

alter table public.league_settings
  drop constraint if exists league_settings_home_headline_length,
  add constraint league_settings_home_headline_length check (char_length(home_headline) between 1 and 100),
  drop constraint if exists league_settings_home_copy_length,
  add constraint league_settings_home_copy_length check (char_length(home_copy) between 1 and 300);
