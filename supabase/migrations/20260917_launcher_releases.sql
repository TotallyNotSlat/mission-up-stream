create table if not exists public.launcher_releases (
  singleton boolean primary key default true check (singleton),
  version_label text not null default '',
  file_path text not null,
  file_name text not null,
  release_notes text not null default '',
  file_size bigint not null default 0 check (file_size >= 0),
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);

alter table public.launcher_releases enable row level security;

drop policy if exists launcher_releases_read on public.launcher_releases;
create policy launcher_releases_read
on public.launcher_releases for select
to authenticated
using (true);

grant select on public.launcher_releases to authenticated;
revoke insert, update, delete on public.launcher_releases from anon, authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'launcher-releases',
  'launcher-releases',
  false,
  262144000,
  array['application/zip', 'application/x-zip-compressed', 'application/octet-stream']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists launcher_release_download on storage.objects;
create policy launcher_release_download
on storage.objects for select
to authenticated
using (bucket_id = 'launcher-releases');

drop policy if exists launcher_release_admin_insert on storage.objects;
create policy launcher_release_admin_insert
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'launcher-releases'
  and exists (select 1 from public.league_admins where user_id = (select auth.uid()))
);

drop policy if exists launcher_release_admin_update on storage.objects;
create policy launcher_release_admin_update
on storage.objects for update
to authenticated
using (
  bucket_id = 'launcher-releases'
  and exists (select 1 from public.league_admins where user_id = (select auth.uid()))
)
with check (
  bucket_id = 'launcher-releases'
  and exists (select 1 from public.league_admins where user_id = (select auth.uid()))
);

drop policy if exists launcher_release_admin_delete on storage.objects;
create policy launcher_release_admin_delete
on storage.objects for delete
to authenticated
using (
  bucket_id = 'launcher-releases'
  and exists (select 1 from public.league_admins where user_id = (select auth.uid()))
);

create or replace function public.wipe_player_competitive_data_internal(p_player_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  daily_count integer;
  tournament_count integer;
  shiny_count integer;
  trophy_count integer;
begin
  if not exists (select 1 from public.profiles where id = p_player_id) then
    raise exception 'Player not found';
  end if;

  update public.player_stats set
    cash = 0,
    xp = 0,
    fish_caught = 0,
    shiny_fish_caught = 0,
    quests_completed = 0,
    fish_sold = 0,
    money_earned = 0,
    money_spent = 0,
    orbs_clicked = 0,
    consumables_used = 0,
    playtime_seconds = 0,
    updated_at = now()
  where player_id = p_player_id;

  insert into public.player_stats(player_id)
  values (p_player_id)
  on conflict (player_id) do nothing;

  insert into public.profile_rewards(player_id, daily_medals, tournament_trophies, updated_at)
  values (p_player_id, 0, 0, now())
  on conflict (player_id) do update set
    daily_medals = 0,
    tournament_trophies = 0,
    updated_at = now();

  delete from public.daily_scores where player_id = p_player_id;
  get diagnostics daily_count = row_count;
  delete from public.tournament_entries where player_id = p_player_id;
  get diagnostics tournament_count = row_count;
  delete from public.shiny_catch_events where player_id = p_player_id;
  get diagnostics shiny_count = row_count;
  delete from public.trophies where player_id = p_player_id;
  get diagnostics trophy_count = row_count;

  return jsonb_build_object(
    'daily_scores_removed', daily_count,
    'tournament_entries_removed', tournament_count,
    'shiny_events_removed', shiny_count,
    'trophies_removed', trophy_count
  );
end;
$$;

revoke all on function public.wipe_player_competitive_data_internal(uuid) from public, anon, authenticated;
grant execute on function public.wipe_player_competitive_data_internal(uuid) to service_role;
