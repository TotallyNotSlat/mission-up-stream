create table public.chat_messages (
  id bigint generated always as identity primary key,
  user_id uuid references public.profiles(id) on delete set null,
  kind text not null default 'user' check (kind in ('user','system')),
  body text not null check (char_length(body) between 1 and 280),
  fish_type text,
  fish_grade integer,
  map_name text,
  created_at timestamptz not null default now(),
  check (
    (kind = 'user' and fish_type is null and fish_grade is null and map_name is null)
    or
    (kind = 'system' and fish_type is not null and fish_grade is not null and map_name is not null)
  )
);

create table public.shiny_catch_events (
  player_id uuid not null references public.profiles(id) on delete cascade,
  catch_key text not null check (char_length(catch_key) between 3 and 120),
  fish_type text not null check (char_length(fish_type) between 1 and 80),
  fish_grade integer not null check (fish_grade between 0 and 10),
  map_name text not null check (char_length(map_name) between 1 and 80),
  caught_at timestamptz not null,
  created_at timestamptz not null default now(),
  primary key (player_id, catch_key)
);

create index chat_messages_created_idx on public.chat_messages(created_at desc);
create index chat_messages_user_idx on public.chat_messages(user_id);
create index shiny_catch_events_created_idx on public.shiny_catch_events(created_at desc);

create or replace function private.announce_shiny_catch()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  player_name text;
begin
  select p.username into player_name
  from public.profiles p
  where p.id = new.player_id;

  insert into public.chat_messages(user_id, kind, body, fish_type, fish_grade, map_name, created_at)
  values (
    new.player_id,
    'system',
    format('%s caught a Grade %s Shiny %s on %s!', coalesce(player_name, 'A player'), new.fish_grade, new.fish_type, new.map_name),
    new.fish_type,
    new.fish_grade,
    new.map_name,
    new.created_at
  );
  return new;
end;
$$;

create trigger shiny_catch_chat_announcement
after insert on public.shiny_catch_events
for each row execute function private.announce_shiny_catch();

alter table public.chat_messages enable row level security;
alter table public.shiny_catch_events enable row level security;

revoke all on public.chat_messages from anon, public;
revoke all on public.shiny_catch_events from anon, public;
revoke all on sequence public.chat_messages_id_seq from anon, public;

create policy chat_messages_read
on public.chat_messages for select
to authenticated
using (true);

create policy chat_messages_insert_own
on public.chat_messages for insert
to authenticated
with check ((select auth.uid()) = user_id and kind = 'user');

create policy shiny_catch_events_insert_own
on public.shiny_catch_events for insert
to authenticated
with check ((select auth.uid()) = player_id);

grant select on public.chat_messages to authenticated;
grant insert (user_id, kind, body) on public.chat_messages to authenticated;
grant usage, select on sequence public.chat_messages_id_seq to authenticated;
grant insert (player_id, catch_key, fish_type, fish_grade, map_name, caught_at)
  on public.shiny_catch_events to authenticated;

revoke update, delete on public.chat_messages from anon, authenticated;
revoke select, update, delete on public.shiny_catch_events from anon, authenticated;
revoke all on function private.announce_shiny_catch() from public, anon, authenticated;
