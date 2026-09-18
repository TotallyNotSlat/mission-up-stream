revoke update on public.profiles from authenticated;
grant update (bio,status_text,presence,last_seen_at,avatar_path,updated_at) on public.profiles to authenticated;
