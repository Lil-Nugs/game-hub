#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';

const CREDENTIALS_DEFAULT = '/home/mattc/.openclaw/credentials/linear.json';
const DEP_READY = 'dep:ready';
const DEP_BLOCKED = 'dep:blocked';

function parseArgs(argv) {
  const out = {
    config: 'scripts/janitor/config/dependency-backfill.json',
    credentials: CREDENTIALS_DEFAULT,
    write: false
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--config') out.config = argv[++i];
    else if (a === '--credentials') out.credentials = argv[++i];
    else if (a === '--write') out.write = true;
    else if (a === '-h' || a === '--help') {
      console.log('Usage: node scripts/janitor/backfill-dependencies.mjs [--config <path>] [--write]');
      process.exit(0);
    }
  }
  return out;
}

async function gql(token, query, variables = {}) {
  const res = await fetch('https://api.linear.app/graphql', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: token },
    body: JSON.stringify({ query, variables })
  });
  const json = await res.json();
  if (json.errors?.length) throw new Error(json.errors[0].message);
  return json.data;
}

async function fetchTeamAndIssues(token, teamKey) {
  const qTeam = `query($teamKey:String!){ teams(filter:{key:{eq:$teamKey}}){ nodes { id key } } }`;
  const qDepLabels = `query($teamKey:String!){ issueLabels(filter:{team:{key:{eq:$teamKey}}, name:{in:[\"dep:ready\",\"dep:blocked\"]}}, first:10){ nodes { id name } } }`;
  const qIssues = `query($teamKey:String!){ issues(filter:{team:{key:{eq:$teamKey}}, state:{type:{nin:[\"completed\",\"canceled\"]}}}, first:40){ nodes { id identifier state { name type } labels(first:10){ nodes { id name } } } } }`;
  const teamData = await gql(token, qTeam, { teamKey });
  const depLabelData = await gql(token, qDepLabels, { teamKey });
  const issuesData = await gql(token, qIssues, { teamKey });
  const team = teamData.teams.nodes[0];
  if (!team) throw new Error(`Team not found: ${teamKey}`);
  team.labels = { nodes: depLabelData.issueLabels.nodes || [] };
  const issues = issuesData.issues.nodes || [];

  const relQuery = `query($id:String!){ issue(id:$id){
    relations(first:100){ nodes { type relatedIssue { id identifier } } }
    inverseRelations(first:100){ nodes { type issue { id identifier state { type name } } } }
  } }`;

  for (const issue of issues) {
    const rel = await gql(token, relQuery, { id: issue.id });
    issue.relations = rel.issue?.relations?.nodes || [];
    issue.inverseRelations = rel.issue?.inverseRelations?.nodes || [];
  }

  return { team, issues };
}

function unresolvedInDegree(issue) {
  return (issue.inverseRelations || [])
    .filter((r) => r.type === 'blocks')
    .map((r) => r.issue)
    .filter(Boolean)
    .filter((i) => !['completed', 'canceled'].includes(i.state?.type || 'unknown')).length;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const cfg = JSON.parse(await fs.readFile(path.resolve(process.cwd(), args.config), 'utf8'));
  const cred = JSON.parse(await fs.readFile(args.credentials, 'utf8'));
  const token = cred.apiKey;
  if (!token) throw new Error('Missing apiKey in credentials file');

  const teamKey = cfg.teamKey || 'GAM';
  const { team, issues } = await fetchTeamAndIssues(token, teamKey);

  const byIdentifier = new Map(issues.map((i) => [i.identifier, i]));
  const labelByName = new Map((team.labels.nodes || []).map((l) => [l.name, l]));
  const depReady = labelByName.get(DEP_READY);
  const depBlocked = labelByName.get(DEP_BLOCKED);
  if (!depReady || !depBlocked) throw new Error('Required labels missing in team: dep:ready and dep:blocked');

  const relationCreates = [];
  const relationSkips = [];
  for (const edge of cfg.edges || []) {
    const blocker = byIdentifier.get(edge.blocker);
    const blocked = byIdentifier.get(edge.blocked);
    if (!blocker || !blocked) {
      relationSkips.push({ edge, reason: 'issue-not-found' });
      continue;
    }

    const exists = (blocker.relations || []).some((r) => r.type === 'blocks' && r.relatedIssue?.id === blocked.id);
    if (exists) {
      relationSkips.push({ edge, reason: 'already-exists' });
      continue;
    }

    relationCreates.push({ blocker: blocker.identifier, blocked: blocked.identifier, blockerId: blocker.id, blockedId: blocked.id });

    if (args.write) {
      const m = `mutation($input:IssueRelationCreateInput!){ issueRelationCreate(input:$input){ success issueRelation { id type } } }`;
      await gql(token, m, { input: { type: 'blocks', issueId: blocker.id, relatedIssueId: blocked.id } });
    }
  }

  const labelChanges = [];
  for (const issue of issues) {
    const indegree = unresolvedInDegree(issue);
    const expected = indegree === 0 ? DEP_READY : DEP_BLOCKED;
    const currentNames = (issue.labels.nodes || []).map((l) => l.name);
    const hasExpected = currentNames.includes(expected);
    const opposite = expected === DEP_READY ? DEP_BLOCKED : DEP_READY;
    const hasOther = currentNames.includes(opposite);

    if (hasExpected && !hasOther) continue;

    const toAdd = hasExpected ? [] : [expected];
    const toRemove = hasOther ? [opposite] : [];

    labelChanges.push({ identifier: issue.identifier, indegree, expected, add: toAdd, remove: toRemove });

    if (args.write && (toAdd.length || toRemove.length)) {
      const addIds = toAdd.map((n) => labelByName.get(n)?.id).filter(Boolean);
      const removeIds = toRemove.map((n) => labelByName.get(n)?.id).filter(Boolean);
      const mu = `mutation($id:String!,$input:IssueUpdateInput!){ issueUpdate(id:$id,input:$input){ success issue { id identifier } } }`;
      await gql(token, mu, { id: issue.id, input: { addedLabelIds: addIds, removedLabelIds: removeIds } });
    }
  }

  const report = {
    runId: `dependency-backfill-${Date.now()}`,
    mode: args.write ? 'write' : 'dry-run',
    teamKey,
    summary: {
      issuesEvaluated: issues.length,
      relationCreates: relationCreates.length,
      relationSkips: relationSkips.length,
      labelChanges: labelChanges.length
    },
    relationCreates,
    relationSkips,
    labelChanges
  };

  process.stderr.write(`[backfill-dependencies] mode=${report.mode} issues=${issues.length} relationCreates=${relationCreates.length} labelChanges=${labelChanges.length}\n`);
  process.stdout.write(JSON.stringify(report, null, 2) + '\n');
}

main().catch((err) => {
  process.stderr.write(`[backfill-dependencies] fatal: ${err.message}\n`);
  process.exit(1);
});
