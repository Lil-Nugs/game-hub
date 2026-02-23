#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';

const TEAM_KEY = 'GAM';
const DEFAULT_TITLE = '[Janitor Drift] Unresolved blocker drift';

function parseArgs(argv) {
  const out = {
    report: 'logs/janitor/drift-report.json',
    credentials: '/home/mattc/.openclaw/credentials/linear.json',
    dryRun: true
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--report') out.report = argv[++i];
    else if (a === '--credentials') out.credentials = argv[++i];
    else if (a === '--write') out.dryRun = false;
    else if (a === '--dry-run') out.dryRun = true;
    else if (a === '-h' || a === '--help') {
      console.log('Usage: node scripts/janitor/escalate-drift-to-linear.mjs --report <path> [--write]');
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

async function findTeamAndOpenIssues(token) {
  const teamQ = `query($key:String!){ teams(filter:{key:{eq:$key}}){ nodes { id key name } } }`;
  const teamData = await gql(token, teamQ, { key: TEAM_KEY });
  const team = teamData.teams.nodes[0];
  if (!team) throw new Error(`Team not found: ${TEAM_KEY}`);

  const issuesQ = `query($key:String!){ issues(filter:{team:{key:{eq:$key}}, state:{type:{nin:[\"completed\",\"canceled\"]}}}, first:100){ nodes { id identifier title url state { name type } } } }`;
  const issuesData = await gql(token, issuesQ, { key: TEAM_KEY });
  return { ...team, issues: { nodes: issuesData.issues.nodes || [] } };
}

function extractBlockers(report) {
  const md = String(report.markdown || '');
  // fallback: use summary blocker count if detailed parse not available
  const blockerCount = Number(report.summary?.blockers || 0);
  const lines = md.split('\n').filter((l) => l.trim().startsWith('- [') || l.includes('Links:'));
  return { blockerCount, lines };
}

function buildBody(report, blockers) {
  return [
    `Automated escalation from janitor run ${report.runId}.`,
    '',
    `Blocker count: ${blockers.blockerCount}`,
    '',
    'Operator actions:',
    '1) Review blocker findings and resolve conflicting labels/state drift.',
    '2) Confirm fix-safety before rerunning with write modes.',
    '3) Post concise summary to janitor Discord channel 1475309759300239380.',
    '',
    'Report excerpt:',
    ...blockers.lines.slice(0, 40)
  ].join('\n');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const report = JSON.parse(await fs.readFile(path.resolve(process.cwd(), args.report), 'utf8'));
  const blockers = extractBlockers(report);

  if (blockers.blockerCount <= 0) {
    const res = { escalated: false, reason: 'no-blockers', blockerCount: blockers.blockerCount };
    process.stderr.write('[escalate-drift-to-linear] no blockers; no escalation needed\n');
    process.stdout.write(JSON.stringify(res, null, 2) + '\n');
    return;
  }

  const cred = JSON.parse(await fs.readFile(args.credentials, 'utf8'));
  const token = cred.apiKey;
  if (!token) throw new Error('Missing apiKey in credentials file');

  const team = await findTeamAndOpenIssues(token);
  const existing = (team.issues.nodes || []).find((i) => i.title.startsWith(DEFAULT_TITLE));
  const body = buildBody(report, blockers);

  if (args.dryRun) {
    const res = {
      escalated: true,
      dryRun: true,
      action: existing ? 'would-update-existing' : 'would-create-new',
      existingIssueIdentifier: existing?.identifier || null,
      blockerCount: blockers.blockerCount,
      title: DEFAULT_TITLE
    };
    process.stderr.write(`[escalate-drift-to-linear] dry-run ${res.action}\n`);
    process.stdout.write(JSON.stringify(res, null, 2) + '\n');
    return;
  }

  if (existing) {
    const mutation = `mutation($id:String!,$body:String!){ commentCreate(input:{issueId:$id, body:$body}){ success comment { id url } } }`;
    const data = await gql(token, mutation, { id: existing.id, body });
    const res = {
      escalated: true,
      dryRun: false,
      action: 'updated-existing',
      issueIdentifier: existing.identifier,
      issueUrl: existing.url,
      commentUrl: data.commentCreate.comment.url,
      blockerCount: blockers.blockerCount
    };
    process.stderr.write(`[escalate-drift-to-linear] updated ${existing.identifier}\n`);
    process.stdout.write(JSON.stringify(res, null, 2) + '\n');
    return;
  }

  const create = `mutation($teamId:String!,$title:String!,$description:String!){ issueCreate(input:{teamId:$teamId,title:$title,description:$description}){ success issue { id identifier url } } }`;
  const data = await gql(token, create, { teamId: team.id, title: DEFAULT_TITLE, description: body });
  const res = {
    escalated: true,
    dryRun: false,
    action: 'created-new',
    issueIdentifier: data.issueCreate.issue.identifier,
    issueUrl: data.issueCreate.issue.url,
    blockerCount: blockers.blockerCount
  };
  process.stderr.write(`[escalate-drift-to-linear] created ${res.issueIdentifier}\n`);
  process.stdout.write(JSON.stringify(res, null, 2) + '\n');
}

main().catch((err) => {
  process.stderr.write(`[escalate-drift-to-linear] fatal: ${err.message}\n`);
  process.exit(1);
});
