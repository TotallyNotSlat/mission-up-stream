alter table public.launcher_releases rename to launcher_releases_legacy;

create table public.launcher_releases (
  id uuid primary key default gen_random_uuid(),
  version_label text not null check (char_length(version_label) between 1 and 40),
  file_path text not null unique,
  file_name text not null,
  release_notes text not null default '' check (char_length(release_notes) <= 1000),
  file_size bigint not null default 0 check (file_size >= 0),
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.launcher_releases (
  version_label, file_path, file_name, release_notes, file_size,
  updated_by, created_at, updated_at
)
select
  version_label, file_path, file_name, release_notes, file_size,
  updated_by, updated_at, updated_at
from public.launcher_releases_legacy;

drop table public.launcher_releases_legacy;

alter table public.launcher_releases enable row level security;

create policy launcher_releases_read
on public.launcher_releases for select
to authenticated
using (true);

grant select on public.launcher_releases to authenticated;
revoke insert, update, delete on public.launcher_releases from anon, authenticated;

create index launcher_releases_created_idx
on public.launcher_releases(created_at desc);

create index launcher_releases_updated_by_idx
on public.launcher_releases(updated_by);

create or replace function private.update_live_tournament_scores()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.tournament_entries e
  set baseline_value = case t.metric
      when 'xp' then new.xp
      when 'fish_caught' then new.fish_caught
      when 'shiny_fish_caught' then new.shiny_fish_caught
      when 'quests_completed' then new.quests_completed
      when 'fish_sold' then new.fish_sold
      when 'money_earned' then new.money_earned
      when 'orbs_clicked' then new.orbs_clicked
      when 'consumables_used' then new.consumables_used
      else 0 end,
      updated_at = now()
  from public.tournaments t
  where e.tournament_id = t.id
    and e.player_id = new.player_id
    and e.state = 'rsvp'
    and now() < t.starts_at;

  update public.tournament_entries e
  set state = 'competing',
      baseline_value = coalesce(e.baseline_value, case t.metric
        when 'xp' then new.xp
        when 'fish_caught' then new.fish_caught
        when 'shiny_fish_caught' then new.shiny_fish_caught
        when 'quests_completed' then new.quests_completed
        when 'fish_sold' then new.fish_sold
        when 'money_earned' then new.money_earned
        when 'orbs_clicked' then new.orbs_clicked
        when 'consumables_used' then new.consumables_used
        else 0 end),
      score_value = greatest((case t.metric
        when 'xp' then new.xp
        when 'fish_caught' then new.fish_caught
        when 'shiny_fish_caught' then new.shiny_fish_caught
        when 'quests_completed' then new.quests_completed
        when 'fish_sold' then new.fish_sold
        when 'money_earned' then new.money_earned
        when 'orbs_clicked' then new.orbs_clicked
        when 'consumables_used' then new.consumables_used
        else 0 end) - coalesce(e.baseline_value, case t.metric
        when 'xp' then new.xp
        when 'fish_caught' then new.fish_caught
        when 'shiny_fish_caught' then new.shiny_fish_caught
        when 'quests_completed' then new.quests_completed
        when 'fish_sold' then new.fish_sold
        when 'money_earned' then new.money_earned
        when 'orbs_clicked' then new.orbs_clicked
        when 'consumables_used' then new.consumables_used
        else 0 end), 0),
      updated_at = now()
  from public.tournaments t
  where e.tournament_id = t.id
    and e.player_id = new.player_id
    and e.state in ('rsvp', 'competing')
    and now() between t.starts_at and t.ends_at;

  return new;
end;
$$;

revoke all on function private.update_live_tournament_scores() from public, anon, authenticated;
