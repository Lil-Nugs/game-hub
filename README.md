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
| `worker/` | Cloudflare Worker source for the leaderboard API |

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

---

## Stack

- **Frontend**: Static HTML/CSS/JS on GitHub Pages
- **Games**: Single-file HTML5 (Phaser 3 via CDN, Web Audio API)
- **Leaderboard API**: Cloudflare Worker + KV storage
- **Deploy**: Git push → GitHub Pages (no build step)
