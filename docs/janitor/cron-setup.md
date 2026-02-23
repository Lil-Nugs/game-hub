# Janitor Cron Setup

Issue: GAM-36  
Updated: 2026-02-22

## Entrypoint

Run the full janitor pipeline with:

```bash
cd /home/mattc/projects/game-hub
node scripts/janitor/run-all.mjs
```

Optional modes:

- `--fix-safe` → enable deterministic safe fixes in linear drift checks
- `--write-plans` → allow plans reconciler to persist `plans.json` updates

---

## Cron cadence (30 min)

Recommended: every 30 minutes.

```cron
*/30 * * * * cd /home/mattc/projects/game-hub && /usr/bin/node scripts/janitor/run-all.mjs --fix-safe --write-plans >> /home/mattc/projects/game-hub/logs/janitor/cron.log 2>&1
```

Install with `crontab -e` for the service user.

---

## Logging + artifacts

### Log location

- Per-run JSON logs: `logs/janitor/<timestamp>.json`
- Last run snapshot: `logs/janitor/last-run.json`
- Step artifacts: `logs/janitor/artifacts/<timestamp>-<step>.json`
- Optional cron stdout/stderr log: `logs/janitor/cron.log`

### Retention policy

- Keep most recent **50** per-run JSON logs
- `last-run.json` always points at the latest run summary
- Artifacts are retained unless external cleanup policy is added

---

## Failure behavior

`run-all.mjs` exits non-zero when any pipeline step fails.

This guarantees cron job failure visibility and prevents false green runs.

---

## Last-run artifact contract

`logs/janitor/last-run.json` includes at minimum:

- run id + timestamp
- per-step status + exit codes
- total check counts
- total fix counts
- warn/blocker counts
- overall run status (`ok`/`failed`)

This file is the canonical machine-readable operational status snapshot for the latest janitor run.
