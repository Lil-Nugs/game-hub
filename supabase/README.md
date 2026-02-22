# Supabase Migration

This directory contains the SQL migration used to replace the Cloudflare Worker/KV leaderboard backend with Supabase.

## Credential source

Use `~/.openclaw/credentials/supabase.json` as the source of truth:

- `url`: Supabase project URL (frontend + scripts)
- `publishableKey`: anon publishable key (frontend only)
- `secretKey`: service role key (scripts/admin only)
- `dbUrl`: Postgres connection string (SQL migrations)

## Apply migration

```bash
psql "$(jq -r '.dbUrl' ~/.openclaw/credentials/supabase.json)" \
  -f supabase/migrations/20260222_000001_game_hub_schema.sql
```

## Sync game catalog into `games` table

```bash
node scripts/supabase/sync-games-from-games-json.mjs
```

Dry run:

```bash
node scripts/supabase/sync-games-from-games-json.mjs --dry-run
```
