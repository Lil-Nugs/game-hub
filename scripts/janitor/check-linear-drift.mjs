#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';

const REQUIRED_NAMESPACES = ['source', 'lane', 'kind', 'exec'];
const DEP_LABELS = ['dep:ready', 'dep:blocked'];

const DEFAULTS_BY_LANE = {
  ops: { source: 'source:automation', agent: 'agent:ops' },
  core: { source: 'source:automation', agent: 'agent:core' },
  gamegen: { source: 'source:automation', agent: 'agent:gamegen' }
};

function parseArgs(argv) {
  const out = {
    input: null,
    teamKey: 'GAM',
    credentials: '/home/mattc/.openclaw/credentials/linear.json',
    fixSafe: false,
    writeFixed: null
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--input') out.input = argv[++i];
    else if (arg === '--team-key') out.teamKey = argv[++i];
    else if (arg === '--credentials') out.credentials = argv[++i];
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
  --input <path>       Optional fixture/payload JSON file (if omitted, fetches live from Linear)
  --team-key <key>     Linear team key for live mode (default: GAM)
  --credentials <path> Linear credential JSON path (apiKey field)
  --fix-safe           Apply deterministic safe fixes
  --write-fixed <path> Write fixed payload snapshot to file (requires --fix-safe)
  -h, --help           Show help

Notes:
  - Dry-run is default.
  - Live mode is default to prevent fixture-only false reports.
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

function hasActiveChildren(children) {
  return children.some((c) => ['started', 'unstarted', 'backlog'].includes(issueStateType(c)));
}

function allChildrenDone(children) {
  return children.length > 0 && children.every((c) => issueStateType(c) === 'completed');
}

function checkParentChild(issues, fixSafe, fixes) {
  const results = [];

  for (const issue of issues) {
    const children = issue.children || [];
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

function unresolvedBlockerCount(issue) {
  const incoming = issue.inverseRelations || [];
  const blockers = incoming
    .filter((r) => r.type === 'blocks')
    .map((r) => r.issue)
    .filter(Boolean)
    .filter((i) => !['completed', 'canceled'].includes(i.state?.type || 'unknown'));
  return { count: blockers.length, blockers };
}

function checkDependencyFrontier(issues, fixSafe, fixes) {
  const results = [];

  for (const issue of issues) {
    const labels = issue.labels || [];
    const depLabels = labels.filter((l) => DEP_LABELS.includes(l));
    const { count, blockers } = unresolvedBlockerCount(issue);
    const expected = count === 0 ? 'dep:ready' : 'dep:blocked';

    if (depLabels.length > 1) {
      results.push({
        checkId: 'dependency_label_conflict',
        reasonCode: 'CONFLICTING_DEPENDENCY_LABELS',
        severity: 'blocker',
        status: 'escalated',
        target: { issueIdentifier: issue.identifier, issueId: issue.id },
        message: `${issue.identifier} has conflicting dependency labels`,
        evidence: depLabels
      });
      continue;
    }

    if (depLabels[0] !== expected) {
      const result = {
        checkId: 'dependency_frontier_label',
        reasonCode: 'DEPENDENCY_LABEL_MISMATCH',
        severity: 'warn',
        status: 'drift',
        target: { issueIdentifier: issue.identifier, issueId: issue.id },
        message: `${issue.identifier} expected ${expected} from blocked-by in-degree=${count}`,
        evidence: blockers.map((b) => `${b.identifier}:${b.state?.name || b.state?.type || 'unknown'}`)
      };

      if (fixSafe) {
        const before = [...labels];
        const withoutDep = labels.filter((l) => !DEP_LABELS.includes(l));
        issue.labels = Array.from(new Set([...withoutDep, expected]));
        result.status = 'fixed';
        result.fix = {
          applied: true,
          action: 'set_dependency_label_by_indegree',
          before,
          after: issue.labels,
          indegree: count,
          expected
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

function normalizeIssue(node) {
  return {
    id: node.id,
    identifier: node.identifier,
    title: node.title,
    url: node.url,
    state: node.state,
    labels: (node.labels?.nodes || []).map((l) => l.name),
    parentId: node.parent?.id || null,
    childIds: (node.children?.nodes || []).map((c) => c.id),
    children: node.children?.nodes || [],
    relations: (node.relations?.nodes || []).map((r) => ({ type: r.type, relatedIssue: r.relatedIssue })),
    inverseRelations: (node.inverseRelations?.nodes || []).map((r) => ({ type: r.type, issue: r.issue }))
  };
}

async function fetchLiveIssues(teamKey, credentialsPath) {
  const cred = JSON.parse(await fs.readFile(credentialsPath, 'utf8'));
  const token = cred.apiKey;
  if (!token) throw new Error('Missing apiKey in credentials file');

  const query = `query($teamKey:String!){
    issues(filter:{team:{key:{eq:$teamKey}}, state:{type:{nin:[\"completed\",\"canceled\"]}}}, first:250){
      nodes {
        id
        identifier
        title
        url
        state { name type }
        labels(first:100) { nodes { id name } }
        parent { id identifier }
        children(first:50) { nodes { id identifier state { name type } } }
        relations(first:100) { nodes { type relatedIssue { id identifier state { name type } } } }
        inverseRelations(first:100) { nodes { type issue { id identifier state { name type } } } }
      }
    }
  }`;

  const res = await fetch('https://api.linear.app/graphql', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: token },
    body: JSON.stringify({ query, variables: { teamKey } })
  });
  const body = await res.json();
  if (body.errors?.length) throw new Error(body.errors[0].message);
  return (body.data?.issues?.nodes || []).map(normalizeIssue);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  let payload;
  if (args.input) {
    const inputPath = path.resolve(process.cwd(), args.input);
    payload = JSON.parse(await fs.readFile(inputPath, 'utf8'));
  } else {
    const liveIssues = await fetchLiveIssues(args.teamKey, args.credentials);
    payload = { source: 'linear-api', teamKey: args.teamKey, issues: liveIssues };
  }

  const issues = payload.issues || [];

  const fixes = [];
  const results = [
    ...checkParentChild(issues, args.fixSafe, fixes),
    ...checkDependencyFrontier(issues, args.fixSafe, fixes),
    ...checkRequiredLabels(issues, args.fixSafe, fixes)
  ];

  const report = {
    runId: `janitor-linear-${Date.now()}`,
    timestamp: new Date().toISOString(),
    mode: args.fixSafe ? 'fix-safe' : 'dry-run',
    input: args.input || 'linear-api',
    teamKey: args.teamKey,
    summary: makeSummary(results),
    results
  };

  if (args.fixSafe && args.writeFixed) {
    const outPath = path.resolve(process.cwd(), args.writeFixed);
    await fs.mkdir(path.dirname(outPath), { recursive: true });
    await fs.writeFile(outPath, JSON.stringify(payload, null, 2) + '\n', 'utf8');
  }

  process.stderr.write(
    `[check-linear-drift] source=${args.input ? 'fixture' : 'linear-api'} mode=${report.mode} findings=${report.summary.totalFindings} ` +
    `warn=${report.summary.warns} blocker=${report.summary.blockers} fixed=${report.summary.autoFixesApplied}\n`
  );
  process.stdout.write(JSON.stringify(report, null, 2) + '\n');
}

main().catch((err) => {
  console.error(`[check-linear-drift] fatal: ${err.message}`);
  process.exit(1);
});
