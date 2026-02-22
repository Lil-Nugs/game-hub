# Game Hub — Human Planning

Static planning pages for human strategy and long-term direction. Deployed via GitHub Pages alongside the main game-hub site.

## Purpose

This section exists to keep planning **persistent, version-controlled, and readable** without the noise of Discord threads. It is **not** an agent task tracker. Agents use Linear for operational work.

## Pages

| Page | URL | What it's for |
|------|-----|----------------|
| Overview | `/admin/planning/` | Current focus, active milestones, recent decisions |
| Roadmap | `/admin/planning/roadmap.html` | Milestones in Now / Next / Later lanes |
| Decision Log | `/admin/planning/decisions.html` | What we decided, why, and what followed |
| Human Backlog | `/admin/planning/human-backlog.html` | Strategic initiatives owned by humans |

## How to Update

All data lives in `data/planning/` at the repo root. Edit the JSON files and commit — the pages update automatically on next GitHub Pages deploy.

```
data/planning/
  meta.json          # lastUpdated, planningOwner, currentFocus
  roadmap.json       # milestones with lane, status, owner
  decisions.json     # decision log entries
  human-backlog.json # human strategic initiatives
```

**Workflow:**
1. Discuss in Discord
2. Summarize into the JSON files
3. Commit to main
4. Pages update on GitHub Pages within ~2 minutes

## Boundary: Planning vs Linear

| This site | Linear |
|-----------|--------|
| Human long-term initiatives | Agent operational tasks |
| Strategic direction | Sprint execution |
| Decision rationale | Issue tracking |
| "Where are we going?" | "What's the ticket for X?" |

If you're an agent reading this — this planning area is not for you. Use Linear for task tracking.

## Data Formats

### `meta.json`
```json
{
  "lastUpdated": "YYYY-MM-DD",
  "planningOwner": "username",
  "currentFocus": "Description of current strategic focus"
}
```

### `roadmap.json` (array)
```json
[{
  "id": "r1",
  "lane": "now | next | later",
  "title": "Milestone title",
  "description": "What this is about",
  "status": "active | planned | idea | done",
  "owner": "username"
}]
```

### `decisions.json` (array)
```json
[{
  "id": "d1",
  "date": "YYYY-MM-DD",
  "decision": "What was decided",
  "rationale": "Why we decided this",
  "consequences": "What it means going forward",
  "links": ["r1"]  // roadmap item ids this decision relates to
}]
```

### `human-backlog.json` (array)
```json
[{
  "id": "b1",
  "title": "Initiative title",
  "description": "What this initiative is about",
  "owner": "username",
  "horizon": "short | mid | long",
  "priority": "high | medium | low",
  "status": "active | parked | done",
  "notes": "Optional extra context",
  "roadmapRef": "r1"  // optional link to a roadmap item
}]
```
