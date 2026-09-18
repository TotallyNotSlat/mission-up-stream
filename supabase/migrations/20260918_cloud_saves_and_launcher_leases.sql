create table if not exists public.cloud_saves (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references public.profiles(id) on delete cascade,
  storage_path text not null unique,
  file_sha256 text not null check (file_sha256 ~ '^[0-9a-f]{64}$'),
  file_size bigint not null check (file_size > 0 and file_size <= 1048576),
  player_xp bigint not null default 0 check (player_xp >= 0),
  player_level integer check (player_level is null or player_level >= 0),
  current_cash bigint not null default 0,
  total_fish bigint not null default 0 check (total_fish >= 0),
  custom_nickname text check (custom_nickname is null or char_length(custom_nickname) between 1 and 60),
  notes text not null default '' check (char_length(notes) <= 500),
  is_locked boolean not null default false,
  source text not null default 'automatic' check (source in ('automatic','manual','admin')),
  uploaded_by uuid references auth.users(id) on delete set null,
  uploaded_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists cloud_saves_player_uploaded_idx
  on public.cloud_saves (player_id, uploaded_at desc);
create index if not exists cloud_saves_player_locked_idx
  on public.cloud_saves (player_id, is_locked, uploaded_at desc);
create index if not exists cloud_saves_uploaded_by_idx
  on public.cloud_saves (uploaded_by);

alter table public.cloud_saves enable row level security;
revoke all on table public.cloud_saves from public, anon, authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('cloud-saves', 'cloud-saves', false, 1048576, array['application/octet-stream','text/plain'])
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

create table if not exists public.launcher_leases (
  player_id uuid primary key references public.profiles(id) on delete cascade,
  lease_id uuid not null,
  device_id text not null check (char_length(device_id) between 8 and 200),
  launcher_version text not null check (char_length(launcher_version) between 1 and 30),
  acquired_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  expires_at timestamptz not null
);

create index if not exists launcher_leases_expiry_idx on public.launcher_leases (expires_at);
alter table public.launcher_leases enable row level security;
revoke all on table public.launcher_leases from public, anon, authenticated;

create or replace function public.acquire_launcher_lease(
  p_lease_id uuid,
  p_device_id text,
  p_launcher_version text
)
returns table(acquired boolean, reason text, expires_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_now timestamptz := now();
  v_expiry timestamptz := v_now + interval '6 minutes';
  v_row public.launcher_leases%rowtype;
begin
  if v_user_id is null then
    raise exception 'Authentication is required' using errcode = '42501';
  end if;
  if p_lease_id is null or nullif(btrim(p_device_id), '') is null or nullif(btrim(p_launcher_version), '') is null then
    raise exception 'Launcher lease details are required' using errcode = '22023';
  end if;

  insert into public.launcher_leases (
    player_id, lease_id, device_id, launcher_version, acquired_at, last_seen_at, expires_at
  ) values (
    v_user_id, p_lease_id, left(p_device_id, 200), left(p_launcher_version, 30), v_now, v_now, v_expiry
  )
  on conflict (player_id) do update
    set lease_id = excluded.lease_id,
        device_id = excluded.device_id,
        launcher_version = excluded.launcher_version,
        acquired_at = excluded.acquired_at,
        last_seen_at = excluded.last_seen_at,
        expires_at = excluded.expires_at
  where public.launcher_leases.expires_at <= v_now
     or public.launcher_leases.lease_id = excluded.lease_id;

  select * into v_row from public.launcher_leases where player_id = v_user_id;
  if v_row.lease_id = p_lease_id then
    return query select true, 'acquired'::text, v_row.expires_at;
  else
    return query select false, 'another_launcher_is_active'::text, v_row.expires_at;
  end if;
end;
$$;

create or replace function public.launcher_heartbeat_v2(
  p_access_version bigint,
  p_presence text,
  p_lease_id uuid
)
returns table(force_logout boolean, reason text, server_time timestamptz, lease_expires_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_current_version bigint;
  v_now timestamptz := now();
  v_new_expiry timestamptz := v_now + interval '6 minutes';
begin
  if v_user_id is null then
    raise exception 'Authentication is required' using errcode = '42501';
  end if;
  if p_presence not in ('online','idle','offline') then
    raise exception 'Invalid presence value' using errcode = '22023';
  end if;

  select launcher_access_version into v_current_version
  from public.profiles where id = v_user_id;
  if not found then
    raise exception 'Player profile was not found' using errcode = 'P0002';
  end if;
  if coalesce(p_access_version, -1) <> v_current_version then
    return query select true, 'administrator_disconnect'::text, v_now, null::timestamptz;
    return;
  end if;

  update public.launcher_leases
     set last_seen_at = v_now,
         expires_at = v_new_expiry,
         launcher_version = coalesce(nullif(launcher_version, ''), 'unknown')
   where player_id = v_user_id
     and lease_id = p_lease_id
     and expires_at > v_now;
  if not found then
    return query select true, 'launcher_lease_expired_or_replaced'::text, v_now, null::timestamptz;
    return;
  end if;

  update public.profiles
     set presence = p_presence,
         last_seen_at = v_now,
         updated_at = v_now
   where id = v_user_id;

  return query select false, 'ok'::text, v_now, v_new_expiry;
end;
$$;

create or replace function public.release_launcher_lease(p_lease_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_deleted integer;
begin
  if v_user_id is null then
    raise exception 'Authentication is required' using errcode = '42501';
  end if;
  delete from public.launcher_leases
   where player_id = v_user_id and lease_id = p_lease_id;
  get diagnostics v_deleted = row_count;
  return v_deleted > 0;
end;
$$;

revoke all on function public.acquire_launcher_lease(uuid, text, text) from public, anon;
revoke all on function public.launcher_heartbeat_v2(bigint, text, uuid) from public, anon;
revoke all on function public.release_launcher_lease(uuid) from public, anon;
grant execute on function public.acquire_launcher_lease(uuid, text, text) to authenticated;
grant execute on function public.launcher_heartbeat_v2(bigint, text, uuid) to authenticated;
grant execute on function public.release_launcher_lease(uuid) to authenticated;
