-- Mission Launch presence and administrator disconnect support.
-- This script is idempotent and mirrors the schema already applied to Supabase.

alter table public.profiles
  add column if not exists launcher_access_version bigint not null default 0,
  add column if not exists last_launcher_kick_at timestamptz;

create or replace function public.launcher_heartbeat(
  p_access_version bigint,
  p_presence text
)
returns table(force_logout boolean, server_time timestamptz)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_current_version bigint;
  v_now timestamptz := now();
begin
  if v_user_id is null then
    raise exception 'Authentication is required' using errcode = '42501';
  end if;

  if p_presence not in ('online', 'idle', 'offline') then
    raise exception 'Invalid presence value' using errcode = '22023';
  end if;

  select p.launcher_access_version
    into v_current_version
    from public.profiles p
   where p.id = v_user_id;

  if not found then
    raise exception 'Player profile was not found' using errcode = 'P0002';
  end if;

  if coalesce(p_access_version, -1) <> v_current_version then
    return query select true, v_now;
    return;
  end if;

  update public.profiles
     set presence = p_presence,
         last_seen_at = v_now,
         updated_at = v_now
   where id = v_user_id;

  return query select false, v_now;
end;
$$;

revoke all on function public.launcher_heartbeat(bigint, text) from public, anon;
grant execute on function public.launcher_heartbeat(bigint, text) to authenticated;
grant select (launcher_access_version, last_launcher_kick_at) on public.profiles to authenticated;
