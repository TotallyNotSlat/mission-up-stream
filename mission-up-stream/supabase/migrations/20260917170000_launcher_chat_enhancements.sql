alter table public.profiles
  add column if not exists chat_name_color text not null default '#60DCFA';

alter table public.profiles
  drop constraint if exists profiles_chat_name_color_format;

alter table public.profiles
  add constraint profiles_chat_name_color_format
  check (chat_name_color ~ '^#[0-9A-Fa-f]{6}$');

revoke update (chat_name_color) on table public.profiles from authenticated;
