# Janitor Escalation Workflow

Issue: GAM-37  
Updated: 2026-02-22

## Purpose

Define the human escalation path when janitor finds unresolved blocker drift or unsafe auto-fix scenarios.

## Report output path

- Renderer: `scripts/janitor/render-drift-report.mjs`
- Output artifact: `logs/janitor/drift-report.json`
- Includes:
  - grouped findings by severity + check type
  - direct links to affected Linear issues/plans/commit evidence when available
  - explicit operator action list

## Required reporting channel (hard constraint)

All janitor user-facing summaries must go to Discord channel:

- `1475309759300239380`

No fallback channel is allowed.

## Escalation hook

- Script: `scripts/janitor/escalate-drift-to-linear.mjs`
- Behavior:
  1. Read `drift-report.json`
  2. If blocker count is zero: no escalation
  3. If blocker count > 0:
     - Reuse existing open issue with title prefix `[Janitor Drift] Unresolved blocker drift`
     - Else create a new issue in team `GAM`

## Operator mention / routing rules

- Escalation issue title prefix: `[Janitor Drift]`
- Route to ops lane labels/ownership conventions in Linear
- Required operator actions in issue body:
  1. Resolve blocker conflicts first
  2. Validate safe-fix policy before rerun
  3. Post concise status to Discord janitor channel

## Integration in pipeline

`run-all.mjs` now includes:

1. `check-linear-drift`
2. `reconcile-plans-status`
3. `render-drift-report`
4. `escalate-drift-to-linear`

Escalation runs in dry-run mode by default. Use `--escalate-write` to allow create/update actions in Linear.
