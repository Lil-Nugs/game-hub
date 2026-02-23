# 🎮 Game Hub — AI Model Showdown

A benchmarking platform for comparing how well different AI language models generate playable browser games.

Each game is built entirely by an AI agent — no human coding — and tagged with the model that made it. Players compete on leaderboards, and we use the results to evaluate and improve AI game generation quality.

---

## What This Is

We ask multiple AI agents to generate games from the same prompts. Each agent:

- Generates a complete single-file HTML5 game (Phaser 3 + Web Audio)
- Tags the game with its model name
- Deploys it here automatically

The site lets you **filter by model** so you can compare outputs side by side, and **compete on leaderboards** to see which games are actually fun.

---

## How Games Are Evaluated

We look at:
- **Playability** — does it run without crashing?
- **Fun / game feel** — difficulty curve, juice, fairness
- **Leaderboard engagement** — do people actually play it more than once?
- **Code quality** — structure, comments, correctness

After a batch of games is generated, we analyze patterns and feed improvements back into the agent prompts.

---

## Site Structure

| File/Dir | Purpose |
|---|---|
| `index.html` | Main gallery — filter by model, browse active games |
| `leaderboard.html` | Top scores across all active games |
| `games.json` | Game manifest — title, slug, creator, model, date, archived flag |
| `games/{slug}/index.html` | Individual game files |
| `shared/` | Shared frontend Supabase config/client utilities |
| `supabase/migrations/` | SQL schema and policy migrations |
| `scripts/supabase/` | Admin sync scripts (service role only) |
| `worker/` | Legacy Cloudflare Worker backend (kept for reference) |

---

## games.json Schema

```json
{
  "games": [
    {
      "slug": "game-name-xxxx",
      "title": "Game Title",
      "description": "One-line description",
      "creator": "discord-username",
      "model": "claude",
      "date": "2026-01-01T00:00:00Z",
      "archived": false
    }
  ]
}
```

### `model` field values

| Value | Agent |
|---|---|
| `claude` | Claude (Anthropic) |
| `codex` | Codex / ChatGPT (OpenAI) |
| `gemini` | Gemini (Google) |
| `grok` | Grok (xAI) |

**Always set `model` when adding a game.** Games without a correct model tag cannot be used in comparisons.

### `archived` field

Set `"archived": true` for games that shouldn't appear in the main gallery. Archived games are still accessible via the Archive section on the site and their direct URLs. Use this for pre-study games, test games, or anything that can't be properly attributed to a model.

---

## Adding a Game (for AI Agents)

1. Generate your game HTML
2. Save to `games/{slug}/index.html`
3. Add an entry to `games.json` with your `model` field set correctly
4. Commit and push

Agents must include the Hub back-link in every game:
```html
<a href="../../index.html" style="position:fixed;top:10px;left:10px;z-index:100;
  font-family:sans-serif;font-size:12px;color:#888;text-decoration:none;
  background:rgba(0,0,0,.3);padding:4px 10px;border-radius:20px">← Hub</a>
```

See `AGENTS.md` for the full game generation spec.

### Agent routing note (important)

If your task is **game generation** (create/update a playable game), you can ignore janitor internals.

- Use: `AGENTS.md`, `games.json`, `games/{slug}/index.html`, `shared/` (if needed for ratings/leaderboard integration)
- Ignore unless explicitly asked: `scripts/janitor/`, `docs/janitor/`, and janitor plan sync details in `data/planning/`

Janitor exists for planning/task-state reconciliation and operational reporting — it is not part of normal game creation flow.

---

## Stack

- **Frontend**: Static HTML/CSS/JS on GitHub Pages
- **Games**: Single-file HTML5 (Phaser 3 via CDN, Web Audio API)
- **Leaderboard + Ratings**: Supabase Postgres + RLS + PostgREST RPC
- **Deploy**: Git push → GitHub Pages (no build step)

---

## Supabase Migration

Supabase credentials live at:

`~/.openclaw/credentials/supabase.json`

Expected keys:

- `url` (Supabase project URL)
- `publishableKey` (frontend anon key)
- `secretKey` (service role key for admin scripts only)
- `dbUrl` (direct Postgres connection string)

### Frontend key usage (GitHub Pages safe)

- `shared/supabase-config.js` contains only `url` and `publishableKey`
- `shared/supabase-client.js` provides shared frontend integration:
  - Worker-compatible `/api/scores` shim for existing game code
  - Per-game leaderboard reads/writes
  - Global leaderboard query
  - Rating upsert + summary helpers

### Apply SQL migration

```bash
psql "$(jq -r '.dbUrl' ~/.openclaw/credentials/supabase.json)" \
  -f supabase/migrations/20260222_000001_game_hub_schema.sql
```

### Sync `games.json` into Supabase `games` table

```bash
node scripts/supabase/sync-games-from-games-json.mjs
```

Dry-run:

```bash
node scripts/supabase/sync-games-from-games-json.mjs --dry-run
```

### Security checks

Verify no `secretKey` value appears in client-delivered files:

```bash
SECRET_KEY="$(jq -r '.secretKey' ~/.openclaw/credentials/supabase.json)"
rg -n --fixed-strings "$SECRET_KEY" index.html leaderboard.html games shared
```

`secretKey` must only be used in local admin workflows/scripts, never in shipped frontend assets.
