#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';

function parseArgs(argv) {
  const out = {
    plans: 'data/planning/plans.json',
    mapping: 'scripts/janitor/config/plan-linear-mapping.json',
    credentials: '/home/mattc/.openclaw/credentials/linear.json',
    write: false,
    allowDowngradeCompleted: false,
    linearInput: null
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--plans') out.plans = argv[++i];
    else if (arg === '--mapping') out.mapping = argv[++i];
    else if (arg === '--credentials') out.credentials = argv[++i];
    else if (arg === '--linear-input') out.linearInput = argv[++i];
    else if (arg === '--write') out.write = true;
    else if (arg === '--allow-downgrade-completed') out.allowDowngradeCompleted = true;
    else if (arg === '-h' || arg === '--help') {
      printHelp();
      process.exit(0);
    }
  }
  return out;
}

function printHelp() {
  console.log(`Usage: node scripts/janitor/reconcile-plans-status.mjs [options]

Options:
  --plans <path>                     Path to plans.json (default: data/planning/plans.json)
  --mapping <path>                   Path to plan/Linear mapping config
  --credentials <path>               Linear credential JSON path (apiKey field)
  --linear-input <path>              Use local JSON issue snapshot instead of API
  --write                            Persist changes to plans.json (dry-run by default)
  --allow-downgrade-completed        Allow completed -> non-completed transitions
  -h, --help                         Show help
`);
}

function parseIdentifier(identifier) {
  const m = /^([A-Z]+)-(\d+)$/.exec(identifier || '');
  if (!m) throw new Error(`Invalid Linear identifier: ${identifier}`);
  return { teamKey: m[1], number: Number(m[2]) };
}

async function fetchIssueByIdentifier(token, identifier) {
  const { teamKey, number } = parseIdentifier(identifier);
  const query = `query($teamKey:String!,$number:Float!){ issues(filter:{team:{key:{eq:$teamKey}}, number:{eq:$number}}){ nodes { id identifier state { name type } url } } }`;
  const variables = { teamKey, number };

  const res = await fetch('https://api.linear.app/graphql', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: token
    },
    body: JSON.stringify({ query, variables })
  });

  const body = await res.json();
  if (body.errors?.length) throw new Error(`Linear API error for ${identifier}: ${body.errors[0].message}`);
  const node = body.data?.issues?.nodes?.[0];
  if (!node) throw new Error(`Linear issue not found: ${identifier}`);
  return node;
}

function computeStatuses(issues, converted) {
  if (!issues.length) return null;

  const types = issues.map((i) => i.state?.type || 'unknown');
  if (types.some((t) => t === 'canceled')) {
    return { implementationStatus: 'blocked', taskTrackerStatus: 'blocked' };
  }
  if (types.every((t) => t === 'completed')) {
    return { implementationStatus: 'completed', taskTrackerStatus: 'completed' };
  }
  if (types.some((t) => t === 'started' || t === 'completed')) {
    return { implementationStatus: 'in-progress', taskTrackerStatus: 'in-progress' };
  }
  return {
    implementationStatus: 'not-started',
    taskTrackerStatus: converted ? 'in-progress' : 'not-converted'
  };
}

function statusRank(s) {
  return ({ 'not-started': 0, 'not-converted': 0, 'in-progress': 1, blocked: 2, completed: 3 })[s] ?? -1;
}

function downgradeCompletedBlocked(before, after, allowDowngradeCompleted) {
  if (allowDowngradeCompleted) return false;
  return before === 'completed' && after !== 'completed';
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const plansPath = path.resolve(process.cwd(), args.plans);
  const mappingPath = path.resolve(process.cwd(), args.mapping);

  const plans = JSON.parse(await fs.readFile(plansPath, 'utf8'));
  const mapping = JSON.parse(await fs.readFile(mappingPath, 'utf8'));
  const planMap = new Map((mapping.plans || []).map((p) => [p.planId, p]));

  let issuesByIdentifier = new Map();
  if (args.linearInput) {
    const issueList = JSON.parse(await fs.readFile(path.resolve(process.cwd(), args.linearInput), 'utf8'));
    issuesByIdentifier = new Map(issueList.map((i) => [i.identifier, i]));
  } else {
    const cred = JSON.parse(await fs.readFile(args.credentials, 'utf8'));
    const token = cred.apiKey;
    if (!token) throw new Error('Missing apiKey in credentials file');

    const needed = new Set();
    for (const m of mapping.plans || []) for (const id of m.linearIssueIdentifiers || []) needed.add(id);
    for (const identifier of needed) {
      const node = await fetchIssueByIdentifier(token, identifier);
      issuesByIdentifier.set(identifier, node);
    }
  }

  const changes = [];
  const skipped = [];

  for (const plan of plans) {
    const cfg = planMap.get(plan.id);
    if (!cfg) continue;

    const issueIds = cfg.linearIssueIdentifiers || [];
    const issues = issueIds.map((id) => issuesByIdentifier.get(id)).filter(Boolean);
    if (!issues.length) {
      skipped.push({ planId: plan.id, reason: 'no-mapped-issues-resolved' });
      continue;
    }

    const next = computeStatuses(issues, Boolean(cfg.converted));
    if (!next) {
      skipped.push({ planId: plan.id, reason: 'no-computed-status' });
      continue;
    }

    const current = {
      implementationStatus: plan.implementationStatus,
      taskTrackerStatus: plan.taskTrackerStatus
    };

    const blockedByNoDowngrade =
      downgradeCompletedBlocked(current.implementationStatus, next.implementationStatus, args.allowDowngradeCompleted) ||
      downgradeCompletedBlocked(current.taskTrackerStatus, next.taskTrackerStatus, args.allowDowngradeCompleted);

    if (blockedByNoDowngrade) {
      skipped.push({
        planId: plan.id,
        reason: 'prevented-completed-downgrade',
        current,
        proposed: next
      });
      continue;
    }

    if (current.implementationStatus !== next.implementationStatus || current.taskTrackerStatus !== next.taskTrackerStatus) {
      changes.push({
        planId: plan.id,
        before: current,
        after: next,
        linearEvidence: issues.map((i) => ({ identifier: i.identifier, state: i.state }))
      });

      plan.implementationStatus = next.implementationStatus;
      plan.taskTrackerStatus = next.taskTrackerStatus;
    }
  }

  if (args.write && changes.length > 0) {
    await fs.writeFile(plansPath, JSON.stringify(plans, null, 2) + '\n', 'utf8');
  }

  const report = {
    runId: `reconcile-plans-${Date.now()}`,
    timestamp: new Date().toISOString(),
    mode: args.write ? 'write' : 'dry-run',
    plansPath: args.plans,
    mappingPath: args.mapping,
    summary: {
      plansMapped: (mapping.plans || []).length,
      changes: changes.length,
      skipped: skipped.length,
      wroteFile: args.write && changes.length > 0
    },
    changes,
    skipped
  };

  console.error(`[reconcile-plans-status] mode=${report.mode} changes=${changes.length} skipped=${skipped.length}`);
  process.stdout.write(JSON.stringify(report, null, 2) + '\n');
}

main().catch((err) => {
  console.error(`[reconcile-plans-status] fatal: ${err.message}`);
  process.exit(1);
});
