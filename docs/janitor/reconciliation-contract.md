# Janitor Reconciliation Contract (v1)

Last updated: 2026-02-22  
Issue: GAM-33

## Purpose

Define deterministic rules for janitor-sync to detect and resolve drift across:

1. Linear operational issue states + labels
2. Repo planning metadata (`data/planning/plans.json`)
3. Git/repo delivery evidence (commits/PR references when available)

This contract is intentionally implementation-agnostic (policy/spec only).

---

## Canonical Data Sources + Precedence

### Sources

- **Linear API**: issue graph, state, labels, parent/child relationships, comments.
- **Repo planning**: `data/planning/plans.json` fields (`implementationStatus`, `taskTrackerStatus`, sections).
- **Git evidence**: commit history, changed files, references to issue IDs.

### Precedence by domain

- **Issue workflow truth**: Linear is canonical.
- **Plan status truth**: `plans.json` is canonical, but must be reconciled from Linear signals.
- **Delivery evidence truth**: Git is canonical for what landed in repo.

### Conflict resolution principles

1. Prefer deterministic, reversible changes.
2. Auto-fix only when one interpretation is unambiguous.
3. Escalate anything requiring semantic judgment (owner intent, ambiguous scope, contradictory labels).

---

## Severity Levels

- **info**: Drift found, no immediate risk; no auto-fix required.
- **warn**: Action needed soon; may be auto-fixable if deterministic.
- **blocker**: Unsafe inconsistency; stop automation for affected issue/plan and escalate.

Severity is attached per check result, not per run.

---

## Parent/Child State Logic (Required)

### Definitions

- **Parent**: issue with children/sub-issues.
- **Child aggregate state**:
  - `all_completed`: every child `type=completed`
  - `any_started`: at least one child `type=started`
  - `all_unstarted`: every child in `backlog|unstarted`
  - `mixed_with_canceled`: contains canceled + other active states

### Reconciliation rules

1. If parent is not completed and child aggregate is `all_completed`:
   - Auto-fix candidate: move parent to completed state (`Done`) if no blocker label present.
2. If parent is completed and at least one child is `started|unstarted|backlog`:
   - `warn` by default; auto-reopen parent only when parent was auto-closed by janitor in prior run and within rollback window.
   - Otherwise escalate (human intent may differ).
3. If parent `backlog|unstarted` and `any_started` children exist:
   - Auto-fix candidate: move parent to `In Progress`.
4. If all children are canceled:
   - Escalate-only (requires product intent; do not auto-cancel parent).

---

## Dependency Graph Scheduling Rule (Required)

Treat task dependencies as a DAG over Linear issue relations (`blocked by` edges into a node).

- **in-degree** for an issue = count of unresolved blockers (`blocked by` issues not in completed state).
- A task is **schedulable** only when:
  1) `in-degree = 0`, and
  2) dependency label is `dep:ready` (or no dependency label exists yet and rule-based inference marks it ready).
- If `in-degree > 0`, task must be labeled `dep:blocked` and must not move to In Progress.
- Optional `dep:critical-path` can prioritize among multiple `in-degree=0` tasks.

Reconciliation requirement:
- Janitor must compute `in-degree` from current Linear relations each run and correct label drift (`dep:ready`/`dep:blocked`) when deterministic.

## Required Label Policy (Required)

### Required schema (operational issues)

At least one label from each namespace:

- `source:*`
- `lane:*`
- `kind:*`
- `exec:*`
- `agent:*` (required when `exec:agent` or `exec:hybrid`)

### Missing-label handling

1. If exactly one deterministic default exists from project/team mapping, janitor may auto-apply missing label(s).
2. If multiple possible defaults exist, escalate-only with suggested options.
3. If conflicting labels in same namespace (e.g., both `lane:ops` and `lane:core`), never auto-remove; escalate as `blocker`.

### Unknown labels

- Non-schema labels are allowed and ignored unless they conflict with required namespace semantics.

---

## Plan Status Reconciliation Rules (Required)

Target file: `data/planning/plans.json`

### Fields

- `implementationStatus` in `{not-started, in-progress, completed, blocked}`
- `taskTrackerStatus` in `{not-converted, in-progress, completed, blocked}`

### Signals

- Mapped Linear issues for plan (from explicit execution mapping section or configured mapping table).
- Aggregate workflow over mapped issues.

### Deterministic mapping

Given mapped issues set `S`:

- If `S` empty: no mutation; report `info`.
- If any issue in blocked-equivalent state: set both statuses to `blocked` (unless explicitly human-pinned; see escalation).
- Else if all issues completed: set both statuses to `completed`.
- Else if any issue started/completed: set both to `in-progress`.
- Else (all backlog/unstarted):
  - `implementationStatus=not-started`
  - `taskTrackerStatus=in-progress` if converted/mapped, else `not-converted`.

### Escalation conditions

- Plan explicitly marked manual override in section metadata.
- Ambiguous or missing mapping between plan and issues.
- Conflicting issue sets across multiple epics.

---

## Safe Auto-fix vs Escalate-only Matrix

| check_id | input | logic | autofix | escalation trigger |
|---|---|---|---|---|
| `parent_children_complete` | parent + children states | parent not completed AND all children completed | set parent -> Done | parent has blocker label / workflow mismatch |
| `parent_started_child` | parent + children states | parent backlog/unstarted AND any child started | set parent -> In Progress | ambiguous workflow config |
| `parent_done_child_open` | parent done + child open | parent completed but child not completed | none by default | human intent unclear |
| `required_labels_missing` | issue labels + defaults map | one/more required namespace missing | add deterministic missing labels | multiple candidate defaults |
| `required_labels_conflict` | issue labels | >1 label in same required namespace | none | mark blocker + comment |
| `plan_status_drift` | plans.json + mapped Linear set | computed status != stored status | update plan statuses | mapping ambiguous/manual override |
| `done_without_evidence` | issue done + git refs | completed issue has no recent delivery reference where required | none | escalate warn/blocker by policy |
| `stale_in_progress` | issue state age + activity | in progress older than timeout with no activity | optional add blocker/comment | timeout policy missing |

---

## janitor-report.json Schema (Required)

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://gamehub.local/schemas/janitor-report.schema.json",
  "title": "JanitorReconciliationReport",
  "type": "object",
  "required": ["runId", "timestamp", "summary", "results"],
  "properties": {
    "runId": { "type": "string", "minLength": 1 },
    "timestamp": { "type": "string", "format": "date-time" },
    "durationMs": { "type": "integer", "minimum": 0 },
    "summary": {
      "type": "object",
      "required": ["totalChecks", "infos", "warns", "blockers", "autoFixesApplied"],
      "properties": {
        "totalChecks": { "type": "integer", "minimum": 0 },
        "infos": { "type": "integer", "minimum": 0 },
        "warns": { "type": "integer", "minimum": 0 },
        "blockers": { "type": "integer", "minimum": 0 },
        "autoFixesApplied": { "type": "integer", "minimum": 0 }
      },
      "additionalProperties": false
    },
    "results": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["checkId", "severity", "status", "target", "message"],
        "properties": {
          "checkId": { "type": "string" },
          "severity": { "type": "string", "enum": ["info", "warn", "blocker"] },
          "status": { "type": "string", "enum": ["ok", "drift", "fixed", "escalated"] },
          "target": {
            "type": "object",
            "properties": {
              "issueId": { "type": "string" },
              "issueIdentifier": { "type": "string" },
              "planId": { "type": "string" },
              "path": { "type": "string" }
            },
            "additionalProperties": false
          },
          "message": { "type": "string" },
          "evidence": {
            "type": "array",
            "items": { "type": "string" }
          },
          "fix": {
            "type": "object",
            "properties": {
              "applied": { "type": "boolean" },
              "action": { "type": "string" },
              "before": {},
              "after": {}
            },
            "additionalProperties": true
          }
        },
        "additionalProperties": false
      }
    }
  },
  "additionalProperties": false
}
```

---

## Concrete Examples (before/after)

### Example 1 — Parent auto-closes when children complete

- Before: parent `In Progress`, children `[Done, Done, Done]`
- Rule: `parent_children_complete`
- After: parent -> `Done`, report status `fixed`, severity `warn`

### Example 2 — Parent auto-starts when child starts

- Before: parent `Backlog`, children `[In Progress, Backlog]`
- Rule: `parent_started_child`
- After: parent -> `In Progress`, report status `fixed`, severity `warn`

### Example 3 — Missing required label with deterministic default

- Before: labels `[lane:ops, kind:task, exec:agent, agent:ops]` (missing `source:*`)
- Defaults map says lane `ops` => source `source:automation`
- After: add `source:automation`, report `fixed`

### Example 4 — Label namespace conflict escalates

- Before: labels include both `lane:ops` and `lane:core`
- Rule: `required_labels_conflict`
- After: no mutation; report `escalated`, severity `blocker`, human action required

### Example 5 — plans.json status reconciliation

- Before: plan statuses `not-started/not-converted`; mapped issues `[Done, In Progress, Backlog]`
- Aggregate indicates active execution
- After: set `implementationStatus=in-progress`, `taskTrackerStatus=in-progress`

### Example 6 — Completed parent with open child (no automatic reopen)

- Before: parent `Done`, children `[Done, In Progress]`
- Rule: `parent_done_child_open`
- After: escalate `warn`; no state mutation unless prior janitor auto-close rollback condition is met

---

## Non-Goals (v1)

- Defining runtime scheduler mechanics.
- Defining Discord notification formatting.
- Implementing scripts; this file is policy/contract only.
