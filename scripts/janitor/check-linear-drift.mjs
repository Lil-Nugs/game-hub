#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';

const REQUIRED_NAMESPACES = ['source', 'lane', 'kind', 'exec'];

const DEFAULTS_BY_LANE = {
  ops: { source: 'source:automation', agent: 'agent:ops' },
  core: { source: 'source:automation', agent: 'agent:core' },
  gamegen: { source: 'source:automation', agent: 'agent:gamegen' }
};

function parseArgs(argv) {
  const out = {
    input: 'scripts/janitor/fixtures/linear-issues.sample.json',
    fixSafe: false,
    writeFixed: null
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--input') out.input = argv[++i];
    else if (arg === '--fix-safe') out.fixSafe = true;
    else if (arg === '--write-fixed') out.writeFixed = argv[++i];
    else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    }
  }
  return out;
}

function printHelp() {
  console.log(`Usage: node scripts/janitor/check-linear-drift.mjs [options]

Options:
  --input <path>       Input fixture/payload JSON file (default: scripts/janitor/fixtures/linear-issues.sample.json)
  --fix-safe           Apply deterministic safe fixes in-memory
  --write-fixed <path> Write fixed payload to file (requires --fix-safe)
  -h, --help           Show help

Notes:
  - Dry-run is default.
  - Outputs machine-readable JSON report to stdout.
  - Outputs concise human summary to stderr.
`);
}

function toLabelGroups(labels = []) {
  const groups = new Map();
  for (const label of labels) {
    const [ns] = String(label).split(':');
    if (!groups.has(ns)) groups.set(ns, []);
    groups.get(ns).push(label);
  }
  return groups;
}

function issueStateType(issue) {
  return issue?.state?.type || 'unknown';
}

function applyParentState(issue, next) {
  issue.state = {
    ...issue.state,
    name: next.name,
    type: next.type
  };
}

function findChildren(parent, issuesById) {
  const childIds = parent.childIds || [];
  return childIds.map((id) => issuesById.get(id)).filter(Boolean);
}

function hasActiveChildren(children) {
  return children.some((c) => ['started', 'unstarted', 'backlog'].includes(issueStateType(c)));
}

function allChildrenDone(children) {
  return children.length > 0 && children.every((c) => issueStateType(c) === 'completed');
}

function checkParentChild(issues, issuesById, fixSafe, fixes) {
  const results = [];

  for (const issue of issues) {
    if (!issue.childIds?.length) continue;

    const children = findChildren(issue, issuesById);
    if (!children.length) continue;

    const parentType = issueStateType(issue);

    if (allChildrenDone(children) && parentType !== 'completed') {
      const result = {
        checkId: 'parent_children_complete',
        reasonCode: 'PARENT_NOT_DONE_ALL_CHILDREN_DONE',
        severity: 'warn',
        status: 'drift',
        target: { issueIdentifier: issue.identifier, issueId: issue.id },
        message: `${issue.identifier} is ${issue.state?.name || parentType} while all children are Done`,
        evidence: children.map((c) => `${c.identifier}:${c.state?.name || issueStateType(c)}`)
      };

      if (fixSafe) {
        const before = { ...issue.state };
        applyParentState(issue, { name: 'Done', type: 'completed' });
        result.status = 'fixed';
        result.fix = {
          applied: true,
          action: 'set_parent_done',
          before,
          after: issue.state
        };
        fixes.push(result.fix);
      }

      results.push(result);
      continue;
    }

    if (parentType === 'completed' && hasActiveChildren(children)) {
      results.push({
        checkId: 'parent_done_child_open',
        reasonCode: 'PARENT_DONE_HAS_ACTIVE_CHILD',
        severity: 'warn',
        status: 'escalated',
        target: { issueIdentifier: issue.identifier, issueId: issue.id },
        message: `${issue.identifier} is Done with active child issues`,
        evidence: children.map((c) => `${c.identifier}:${c.state?.name || issueStateType(c)}`)
      });
      continue;
    }

    if (['backlog', 'unstarted'].includes(parentType) && children.some((c) => issueStateType(c) === 'started')) {
      const result = {
        checkId: 'parent_started_child',
        reasonCode: 'PARENT_NOT_STARTED_CHILD_IN_PROGRESS',
        severity: 'warn',
        status: 'drift',
        target: { issueIdentifier: issue.identifier, issueId: issue.id },
        message: `${issue.identifier} is ${issue.state?.name || parentType} while at least one child is In Progress`,
        evidence: children.map((c) => `${c.identifier}:${c.state?.name || issueStateType(c)}`)
      };

      if (fixSafe) {
        const before = { ...issue.state };
        applyParentState(issue, { name: 'In Progress', type: 'started' });
        result.status = 'fixed';
        result.fix = {
          applied: true,
          action: 'set_parent_in_progress',
          before,
          after: issue.state
        };
        fixes.push(result.fix);
      }

      results.push(result);
    }
  }

  return results;
}

function checkRequiredLabels(issues, fixSafe, fixes) {
  const results = [];

  for (const issue of issues) {
    const labels = issue.labels || [];
    const groups = toLabelGroups(labels);

    // Conflicts in required namespaces
    for (const ns of [...REQUIRED_NAMESPACES, 'agent']) {
      const vals = groups.get(ns) || [];
      if (vals.length > 1) {
        results.push({
          checkId: 'required_labels_conflict',
          reasonCode: 'CONFLICTING_LABELS_IN_NAMESPACE',
          severity: 'blocker',
          status: 'escalated',
          target: { issueIdentifier: issue.identifier, issueId: issue.id },
          message: `${issue.identifier} has conflicting labels for namespace '${ns}'`,
          evidence: vals
        });
      }
    }

    // Missing required namespaces
    const missing = REQUIRED_NAMESPACES.filter((ns) => !(groups.get(ns) || []).length);
    const execLabels = groups.get('exec') || [];
    const needsAgent = execLabels.some((x) => x === 'exec:agent' || x === 'exec:hybrid');
    if (needsAgent && !(groups.get('agent') || []).length) missing.push('agent');

    if (!missing.length) continue;

    const laneLabel = (groups.get('lane') || [])[0] || null;
    const lane = laneLabel ? laneLabel.split(':')[1] : null;
    const defaults = lane && DEFAULTS_BY_LANE[lane] ? DEFAULTS_BY_LANE[lane] : null;

    const result = {
      checkId: 'required_labels_missing',
      reasonCode: 'MISSING_REQUIRED_LABEL_NAMESPACE',
      severity: 'warn',
      status: 'drift',
      target: { issueIdentifier: issue.identifier, issueId: issue.id },
      message: `${issue.identifier} missing required label namespace(s): ${missing.join(', ')}`,
      evidence: labels
    };

    if (fixSafe && defaults) {
      const add = [];
      for (const ns of missing) {
        if (ns === 'source' && defaults.source) add.push(defaults.source);
        else if (ns === 'agent' && defaults.agent) add.push(defaults.agent);
      }

      // do not fabricate kind/exec/lane defaults here; only deterministic approved defaults
      if (add.length) {
        issue.labels = Array.from(new Set([...labels, ...add]));
        result.status = 'fixed';
        result.fix = {
          applied: true,
          action: 'add_missing_required_labels',
          before: labels,
          after: issue.labels,
          added: add
        };
        fixes.push(result.fix);
      }
    }

    if (result.status === 'drift' && fixSafe) {
      result.status = 'escalated';
      result.severity = 'blocker';
      result.message += ' (no deterministic safe default available)';
    }

    results.push(result);
  }

  return results;
}

function makeSummary(results) {
  const counts = { info: 0, warn: 0, blocker: 0, fixed: 0 };
  for (const r of results) {
    counts[r.severity] = (counts[r.severity] || 0) + 1;
    if (r.status === 'fixed') counts.fixed += 1;
  }
  return {
    totalFindings: results.length,
    infos: counts.info,
    warns: counts.warn,
    blockers: counts.blocker,
    autoFixesApplied: counts.fixed
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const inputPath = path.resolve(process.cwd(), args.input);
  const payload = JSON.parse(await fs.readFile(inputPath, 'utf8'));
  const issues = payload.issues || [];
  const issuesById = new Map(issues.map((i) => [i.id, i]));

  const fixes = [];
  const results = [
    ...checkParentChild(issues, issuesById, args.fixSafe, fixes),
    ...checkRequiredLabels(issues, args.fixSafe, fixes)
  ];

  const report = {
    runId: `janitor-linear-${Date.now()}`,
    timestamp: new Date().toISOString(),
    mode: args.fixSafe ? 'fix-safe' : 'dry-run',
    input: args.input,
    summary: makeSummary(results),
    results
  };

  if (args.fixSafe && args.writeFixed) {
    const outPath = path.resolve(process.cwd(), args.writeFixed);
    await fs.mkdir(path.dirname(outPath), { recursive: true });
    await fs.writeFile(outPath, JSON.stringify(payload, null, 2) + '\n', 'utf8');
  }

  // concise human summary
  console.error(
    `[check-linear-drift] mode=${report.mode} findings=${report.summary.totalFindings} ` +
    `warn=${report.summary.warns} blocker=${report.summary.blockers} fixed=${report.summary.autoFixesApplied}`
  );

  // machine-readable output
  process.stdout.write(JSON.stringify(report, null, 2) + '\n');
}

main().catch((err) => {
  console.error(`[check-linear-drift] fatal: ${err.message}`);
  process.exit(1);
});
