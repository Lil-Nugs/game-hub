---
name: game-generator
description: Generate playable browser games from user prompts. When someone asks to make, create, or build a game, this skill generates a single-file HTML/JS game, deploys it to GitHub Pages, and shares the playable link. Games include leaderboards so anyone can compete.
metadata: { "openclaw": { "emoji": "🎮", "requires": { "bins": ["git", "node"], "env": ["GITHUB_TOKEN"] } } }
---

# Game Generator Skill

You generate complete, playable HTML5 Canvas games from user prompts and deploy them to GitHub Pages.

## Configuration

Read `config.json` from this skill's directory to get:
- `GITHUB_REPO_OWNER` — GitHub username
- `GITHUB_REPO_NAME` — repo name (`game-hub`)
- `GITHUB_PAGES_URL` — base URL for published games
- `LEADERBOARD_API_URL` — Cloudflare Worker URL for scores

## Workflow

### 1. Parse the game concept
Extract the core game idea from the user's message. Identify the theme, mechanics, and any specific requests.

### 2. Generate a slug
Create a URL-safe slug from the game concept + 4-char random hex suffix.
Example: `crab-racing-a1b2`, `piano-dodge-f3e9`

### 3. Generate the game HTML
Create a **COMPLETE single-file HTML game** with ALL of the following:

**Technical requirements:**
- All CSS and JS inline — NO external dependencies (Google Fonts via `<link>` are OK)
- HTML5 Canvas (2d context) for game rendering
- `requestAnimationFrame` game loop
- Responsive: support both keyboard AND touch input
- Mobile-friendly viewport and scaling

**Game structure:**
- Title/start screen with game name and "Press any key / Tap to start"
- Core gameplay with scoring
- Game over state with final score display
- Leaderboard integration (see below)

**Visual quality:**
- Use vibrant colors, particle effects, smooth animations
- NOT a gray box — make it visually appealing and polished
- Include a background (gradient, stars, pattern, etc.)
- Use emoji or simple shapes for game objects — NO external images

**Bake these constants at the top of the `<script>` tag:**
```javascript
const GAME_ID = '{slug}';
const LEADERBOARD_API = '{LEADERBOARD_API_URL from config}';
```

**Include these leaderboard functions:**
```javascript
async function submitScore(playerName, score) {
  try {
    const res = await fetch(`${LEADERBOARD_API}/api/scores`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ gameId: GAME_ID, playerName, score })
    });
    return await res.json();
  } catch (e) {
    console.warn('Leaderboard unavailable:', e);
    return null;
  }
}

async function getLeaderboard(limit = 10) {
  try {
    const res = await fetch(`${LEADERBOARD_API}/api/scores?gameId=${GAME_ID}&limit=${limit}`);
    const data = await res.json();
    return data.scores || [];
  } catch (e) {
    console.warn('Leaderboard unavailable:', e);
    return [];
  }
}
```

**Game over flow (IMPORTANT — use this exact sequence):**
1. Show the player's final score
2. Show an HTML `<input>` field (NOT `prompt()`) for the player's name
3. Show a "Submit Score" button
4. On submit: call `submitScore()`, then call `getLeaderboard()` and display top 10
5. Show a "Play Again" button that resets the game

### 4. Deploy to GitHub Pages

```bash
# Create a temp directory
TMPDIR=$(mktemp -d)

# Clone the hub repo
git clone "https://github.com/{GITHUB_REPO_OWNER}/{GITHUB_REPO_NAME}.git" "$TMPDIR/repo"
cd "$TMPDIR/repo"

# Create the game directory
mkdir -p "games/{slug}"

# Copy the game file
cp /path/to/generated/game.html "games/{slug}/index.html"

# Update games.json — add the new entry to the array
# Read the existing games.json, add new entry:
# {
#   "slug": "{slug}",
#   "title": "{Game Title}",
#   "description": "{Brief description}",
#   "creator": "{discord username who requested it}",
#   "date": "{ISO date string}"
# }
# Write back games.json with the new entry appended

# Commit and push
git add .
git commit -m "Add game: {Game Title}"
git push origin main

# Clean up
rm -rf "$TMPDIR"
```

### 5. Reply in Discord
Send a message with:
- The game title
- A brief description of how to play
- The playable link: `{GITHUB_PAGES_URL}/games/{slug}/index.html`
- Mention that it has a leaderboard

## Quality checklist
Before deploying, verify the generated game:
- [ ] Has a start screen
- [ ] Has actual gameplay (not just a static screen)
- [ ] Score increases based on gameplay
- [ ] Game over triggers correctly
- [ ] Leaderboard name input is an HTML element, not prompt()
- [ ] Leaderboard submit/display works (with try/catch fallback)
- [ ] Play again button works
- [ ] Touch controls work alongside keyboard
- [ ] No external dependencies (except Google Fonts)
- [ ] All code is in a single HTML file
