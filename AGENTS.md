# AGENTS.md — Game Hub Rules

## Hub Link Required

Every game **must** include a visible link back to the main hub. Add a small button/link in the game UI (e.g. top-left corner or on the start/game-over screens) that points to:

```
../../index.html
```

This keeps the hub navigable — players should always be able to get back to the game list.

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

## Other Rules

- All games are single-file HTML (inline CSS/JS, no external deps except Google Fonts)
- Games go in `games/{slug}/index.html`
- Update `games.json` when adding a new game
- Include leaderboard integration (see existing games for the pattern)
- Make sure touch + keyboard input both work
