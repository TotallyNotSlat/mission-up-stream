# Mission Up Stream

Mission Up Stream is the authenticated live leaderboard and player-profile site for the fishing league. It reads Row Level Security-protected data from Supabase, refreshing league, title, and tournament data every 15 seconds.

Player identity remains in `profiles`, game totals in `player_stats`, and reward totals in `profile_rewards`. Daily standings come from positive same-day deltas in `daily_scores`, so merely signing in never places a player on the board. Titles use the master `title_definitions` catalog and per-player `player_titles`; deleting a custom title cascades its assignments and clears it from active profiles. The editable home headline and description live in `league_settings`. Opt-in tournament participation uses `tournaments` and `tournament_entries`. Account creation and deletion, cosmetic-title management, title permissions, home-message editing, password resets, and irreversible tournament retirement run through JWT-protected Supabase Edge Functions. The service-role key is used only inside those functions and is never shipped to the browser.

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
