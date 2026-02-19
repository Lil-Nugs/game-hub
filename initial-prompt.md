I need you to set up a Discord game generator project. This has 3 pieces: a GitHub Pages site, a Cloudflare Worker, and an OpenClaw skill. I'll walk you through what each piece is and then I need you to create everything, deploy what you can, and tell me what manual steps remain.

## Context

I run an OpenClaw agent connected to my Discord server. I want a skill where people in Discord say "make a game about X" and the agent generates a playable single-file HTML5 canvas game, deploys it to GitHub Pages, and shares the link. Every game has a leaderboard powered by a Cloudflare Worker + KV.

## Piece 1: GitHub Pages Hub Repo

Create a new public GitHub repo called `game-hub` (use `gh` CLI if available, otherwise walk me through it). Push this structure:

```
game-hub/
  index.html        # Gallery page
  games.json         # {"games": []}
  games/.gitkeep
  README.md
```

The `index.html` is a dark-themed gallery that fetches `games.json` and renders game cards with title, description, date, creator, and a "PLAY" link. Style it nicely — Space Mono for headings, DM Sans for body, dark background (#0a0a0f), purple accent (#6c5ce7), cards with hover glow effects. Games should show newest first.

After pushing, enable GitHub Pages on the main branch (use `gh api` if possible, otherwise tell me the manual step).

## Piece 2: Cloudflare Worker Leaderboard API

Create and deploy a Cloudflare Worker called `game-leaderboard` with a KV namespace called `SCORES`. Use `wrangler` CLI.

The Worker has these routes:
- `POST /api/scores` — body: `{gameId, playerName, score}`. Stores scores in KV under key `scores:{gameId}` as a sorted JSON array (descending by score, capped at top 100). Sanitize playerName to 20 chars, strip `<>`. Returns `{ok, rank, totalScores}`.
- `GET /api/scores?gameId=xxx&limit=10` — returns the top N scores for that game.
- `GET /api/games` — lists all gameIds that have scores (from KV key prefix scan).
- `GET /health` — returns `{status: "ok"}`.

All routes need CORS headers. Set `ALLOWED_ORIGIN` as a Wrangler secret — I'll give you my GitHub Pages URL for it.

After deploying, test the health endpoint and a round-trip score submit + fetch.

## Piece 3: OpenClaw Skill

Create the skill folder in my OpenClaw workspace at `~/YOUR_WORKSPACE/skills/game-generator/` (find my OpenClaw workspace first — check `~/.openclaw/openclaw.json` for the workspace path, or look for a `~/clawd/`, `~/openclaw/`, or similar directory with SOUL.md / AGENTS.md).

The skill is a `SKILL.md` file with YAML frontmatter:

```yaml
---
name: game-generator
description: Generate playable browser games from user prompts. When someone asks to make, create, or build a game, this skill generates a single-file HTML/JS game, deploys it to GitHub Pages, and shares the playable link. Games include leaderboards so anyone can compete.
metadata: { "openclaw": { "emoji": "🎮", "requires": { "bins": ["git", "node"], "env": ["GITHUB_TOKEN"] } } }
---
```

The body of SKILL.md should instruct the agent to:

1. Parse the game concept from the user's message
2. Generate a URL-safe slug + 4-char random hex suffix (e.g., `crab-racing-a1b2`)
3. Generate a COMPLETE single-file HTML game with:
   - All CSS/JS inline, no external deps (Google Fonts ok)
   - HTML5 Canvas (2d) game rendering
   - Responsive (keyboard + touch input)
   - requestAnimationFrame game loop
   - Title/start screen, scoring, game over state
   - Leaderboard integration (submit score on game over, show top 10)
   - Actually fun and visually polished — not a gray box
4. Bake in these constants at the top of the script:
   ```javascript
   const GAME_ID = '{slug}';
   const LEADERBOARD_API = '{worker_url}';
   ```
5. Include leaderboard functions (submitScore, getLeaderboard) with try/catch so games work even if the API is down
6. Game over flow: show score → prompt for name (HTML input, not prompt()) → submit → show leaderboard → play again button
7. Save to temp dir, git clone the hub repo, copy game in, update games.json manifest, commit, push
8. Reply in Discord with the game URL

Also create a `config.json` in the skill folder with:
```json
{
  "GITHUB_REPO_OWNER": "<fill after repo creation>",
  "GITHUB_REPO_NAME": "game-hub",
  "GITHUB_PAGES_URL": "<fill after pages enabled>",
  "LEADERBOARD_API_URL": "<fill after worker deployed>"
}
```

And configure the GITHUB_TOKEN in `~/.openclaw/openclaw.json` under `skills.entries.game-generator.env.GITHUB_TOKEN`. If the file already has content, merge into it — don't overwrite. I'll need a GitHub PAT with `repo` scope — create one via `gh auth token` or tell me how to make one.

## Order of Operations

1. Create and push the game-hub repo (need this URL first)
2. Deploy the Cloudflare Worker (need the hub URL for CORS)
3. Fill in config.json with both URLs
4. Install the OpenClaw skill
5. Test the worker with a curl round-trip
6. Tell me to test in Discord: "make a game about a cat dodging falling pianos"

## Important Notes

- Check what tools are available before starting (`gh`, `wrangler`, `git`, `node`). Install what's missing via brew/npm.
- If `wrangler` isn't logged in, walk me through `wrangler login`.
- If `gh` isn't authed, walk me through `gh auth login`.
- Don't ask me questions for things you can figure out — just do it and tell me what you did.
- For things that truly require my input (secrets, auth), batch them together and ask once.
