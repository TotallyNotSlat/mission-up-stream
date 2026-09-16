# Mission Up Stream

Mission Up Stream is the live leaderboard and player-profile site for the fishing league. It reads public, Row Level Security-protected data from the existing Supabase tables `profiles`, `player_stats`, and `profile_rewards`, refreshing every 15 seconds.

## Render deployment

- Service type: Static Site
- Build command: `pnpm install --frozen-lockfile && pnpm run build:render`
- Publish directory: `out`
- Primary domain: `missionup.stream`
- Environment variables: `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`

Only the public Supabase URL and publishable key belong in the client build. Never add a service-role or secret key.

The `render.yaml` Blueprint contains the matching configuration and an SPA fallback rewrite for direct browser navigation.

## Local development

Run `pnpm dev`. Production-equivalent output can be checked with `pnpm run build:render`.
