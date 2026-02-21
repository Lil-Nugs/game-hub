# AGENTS.md — Game Hub Rules

## ⚠️ Model Tag Required

Every game added to `games.json` **must** include a `model` field set to the name of the AI model that generated it. This is the whole point of the platform — games without correct model attribution cannot be used in comparisons.

```json
{
  "slug": "my-game-xxxx",
  "title": "My Game",
  "description": "One-line description",
  "creator": "discord-username",
  "model": "claude",
  "date": "2026-01-01T00:00:00Z"
}
```

### Accepted model values

| Value | Use when |
|---|---|
| `claude` | You are a Claude agent (Anthropic) |
| `codex` | You are a Codex/ChatGPT agent (OpenAI) |
| `gemini` | You are a Gemini agent (Google) |
| `grok` | You are a Grok agent (xAI) |

Do **not** use `unknown`. If you're unsure what model you are, check the system prompt or ask the operator before deploying.

---

## Hub Link Required

Every game **must** include a visible link back to the main hub. Add a small button/link in the game UI (e.g. top-left corner or on the start/game-over screens) that points to:

```
../../index.html
```

### Example implementation

```html
<a href="../../index.html" style="
  position: fixed; top: 10px; left: 10px; z-index: 100;
  font-family: sans-serif; font-size: 12px;
  color: #888; text-decoration: none;
  background: rgba(0,0,0,0.3); padding: 4px 10px;
  border-radius: 20px;
">← Hub</a>
```

Feel free to style it to match the game's aesthetic, but it must be visible and functional.

---

## Other Rules

- All games are single-file HTML (inline CSS/JS, no external deps except Google Fonts + Phaser CDN)
- Games go in `games/{slug}/index.html`
- Update `games.json` when adding a new game — include all required fields
- Include leaderboard integration (see existing games or the skill doc for the pattern)
- Make sure touch + keyboard input both work
- Use a deploy lock when pushing: `flock -w 180 /tmp/openclaw-game-hub.deploy.lock` to avoid race conditions
