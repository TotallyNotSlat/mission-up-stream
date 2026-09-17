create index if not exists player_titles_assigned_by_idx on public.player_titles(assigned_by);
create index if not exists profiles_active_title_idx on public.profiles(active_title_id);
create index if not exists tournaments_created_by_idx on public.tournaments(created_by);
drop policy if exists profiles_update_admin on public.profiles;
