alter table public.profiles add column if not exists last_login_at timestamptz;

create table if not exists public.title_definitions (
  id uuid primary key default gen_random_uuid(),
  key text not null unique check (key ~ '^[a-z0-9_]+$'),
  label text not null unique check (char_length(label) between 1 and 40),
  description text not null default '',
  can_manage_tournaments boolean not null default false,
  is_system boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.player_titles (
  player_id uuid not null references public.profiles(id) on delete cascade,
  title_id uuid not null references public.title_definitions(id) on delete cascade,
  assigned_at timestamptz not null default now(),
  assigned_by uuid references public.profiles(id) on delete set null,
  source text not null default 'admin' check (source in ('starter','admin','earned','store')),
  primary key (player_id, title_id)
);

alter table public.profiles add column if not exists active_title_id uuid references public.title_definitions(id) on delete set null;

insert into public.title_definitions(key,label,description,can_manage_tournaments,is_system) values
  ('admin','Admin','League administrator',true,true),
  ('tourney_holder','Tourney Holder','May schedule and manage tournaments',true,true),
  ('fisherman','Fisherman','Starter title',false,true),
  ('fisherwoman','Fisherwoman','Starter title',false,true),
  ('fish','Fish','Starter title',false,true)
on conflict (key) do update set
  label=excluded.label,
  description=excluded.description,
  can_manage_tournaments=excluded.can_manage_tournaments,
  is_system=excluded.is_system;

insert into public.player_titles(player_id,title_id,source)
select p.id,t.id,'starter'
from public.profiles p
cross join public.title_definitions t
where t.key in ('fisherman','fisherwoman','fish')
on conflict do nothing;

insert into public.player_titles(player_id,title_id,source)
select a.user_id,t.id,'admin'
from public.league_admins a
join public.title_definitions t on t.key='admin'
on conflict do nothing;

create or replace function private.create_profile_companions()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
begin
  insert into public.profile_rewards(player_id) values (new.id) on conflict (player_id) do nothing;
  insert into public.player_stats(player_id) values (new.id) on conflict (player_id) do nothing;
  insert into public.player_titles(player_id,title_id,source)
    select new.id,t.id,'starter' from public.title_definitions t
    where t.key in ('fisherman','fisherwoman','fish')
    on conflict do nothing;
  return new;
end;
$$;

create or replace function private.validate_active_title()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
begin
  if new.active_title_id is not null and not exists (
    select 1 from public.player_titles pt
    where pt.player_id=new.id and pt.title_id=new.active_title_id
  ) then
    raise exception 'Active title must be assigned to this player';
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_validate_active_title on public.profiles;
create trigger profiles_validate_active_title
before insert or update of active_title_id on public.profiles
for each row execute function private.validate_active_title();

create or replace function private.sync_profile_last_login()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
begin
  if new.last_sign_in_at is distinct from old.last_sign_in_at then
    update public.profiles set last_login_at=new.last_sign_in_at where id=new.id;
  end if;
  return new;
end;
$$;

drop trigger if exists auth_user_sync_profile_last_login on auth.users;
create trigger auth_user_sync_profile_last_login
after update of last_sign_in_at on auth.users
for each row execute function private.sync_profile_last_login();

update public.profiles p set last_login_at=u.last_sign_in_at
from auth.users u where u.id=p.id and p.last_login_at is null;

alter table public.tournaments add column if not exists created_by uuid references public.profiles(id) on delete set null;
alter table public.tournaments add column if not exists timezone text not null default 'America/New_York';
alter table public.tournaments drop constraint if exists tournaments_metric_check;
alter table public.tournaments add constraint tournaments_metric_check check (metric in ('xp','fish_caught','shiny_fish_caught','quests_completed','fish_sold','money_earned','orbs_clicked','consumables_used'));
alter table public.tournaments drop constraint if exists tournaments_dates_check;
alter table public.tournaments add constraint tournaments_dates_check check (ends_at > starts_at);

create table if not exists public.tournament_entries (
  tournament_id uuid not null references public.tournaments(id) on delete cascade,
  player_id uuid not null references public.profiles(id) on delete cascade,
  state text not null default 'rsvp' check (state in ('rsvp','competing','retired')),
  baseline_value bigint,
  score_value bigint not null default 0 check (score_value >= 0),
  joined_at timestamptz not null default now(),
  retired_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (tournament_id, player_id)
);

create index if not exists tournament_entries_player_idx on public.tournament_entries(player_id);
create index if not exists tournaments_window_idx on public.tournaments(starts_at,ends_at);
create index if not exists player_titles_title_idx on public.player_titles(title_id);

create or replace function private.update_live_tournament_scores()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
begin
  update public.tournament_entries e
  set score_value=greatest((case t.metric
      when 'xp' then new.xp
      when 'fish_caught' then new.fish_caught
      when 'shiny_fish_caught' then new.shiny_fish_caught
      when 'quests_completed' then new.quests_completed
      when 'fish_sold' then new.fish_sold
      when 'money_earned' then new.money_earned
      when 'orbs_clicked' then new.orbs_clicked
      when 'consumables_used' then new.consumables_used
      else 0 end) - coalesce(e.baseline_value,0),0),
      updated_at=now()
  from public.tournaments t
  where e.tournament_id=t.id and e.player_id=new.player_id
    and e.state='competing' and now() between t.starts_at and t.ends_at;
  return new;
end;
$$;

drop trigger if exists player_stats_update_tournament_scores on public.player_stats;
create trigger player_stats_update_tournament_scores
after update on public.player_stats
for each row execute function private.update_live_tournament_scores();

alter table public.title_definitions enable row level security;
alter table public.player_titles enable row level security;
alter table public.tournament_entries enable row level security;

drop policy if exists title_definitions_read on public.title_definitions;
create policy title_definitions_read on public.title_definitions for select to authenticated using (true);
drop policy if exists player_titles_read on public.player_titles;
create policy player_titles_read on public.player_titles for select to authenticated using (true);
drop policy if exists tournament_entries_read on public.tournament_entries;
create policy tournament_entries_read on public.tournament_entries for select to authenticated using (true);

drop policy if exists tournaments_write_admin on public.tournaments;

grant select on public.title_definitions, public.player_titles, public.tournament_entries to authenticated;
revoke insert,update,delete on public.title_definitions, public.player_titles, public.tournament_entries from anon,authenticated;
revoke insert,update,delete on public.tournaments from anon,authenticated;
revoke all on function private.validate_active_title() from public,anon,authenticated;
revoke all on function private.sync_profile_last_login() from public,anon,authenticated;
revoke all on function private.update_live_tournament_scores() from public,anon,authenticated;

