#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';

const JANITOR_DISCORD_CHANNEL_ID = '1475309759300239380';
const LINEAR_TEAM_SLUG = 'gamehubber';

function parseArgs(argv) {
  const out = {
    runLog: 'logs/janitor/last-run.json',
    output: null,
    format: 'markdown'
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--run-log') out.runLog = argv[++i];
    else if (a === '--output') out.output = argv[++i];
    else if (a === '--format') out.format = argv[++i];
    else if (a === '-h' || a === '--help') {
      console.log('Usage: node scripts/janitor/render-drift-report.mjs --run-log <path> [--output <path>]');
      process.exit(0);
    }
  }
  return out;
}

function linearUrl(identifier) {
  return `https://linear.app/${LINEAR_TEAM_SLUG}/issue/${identifier.toLowerCase()}`;
}

function asList(v) {
  return Array.isArray(v) ? v : [];
}

function extractAllFindings(stepArtifacts) {
  const out = [];
  for (const step of stepArtifacts) {
    const results = asList(step?.results);
    for (const r of results) {
      out.push({ ...r, _step: step._stepId });
    }

    // include reconcile changes as warn entries for operator visibility
    for (const c of asList(step?.changes)) {
      out.push({
        checkId: 'plan_status_drift',
        severity: 'warn',
        status: 'fixed',
        target: { planId: c.planId },
        message: `Plan ${c.planId} status reconciled`,
        evidence: [
          `before=${JSON.stringify(c.before)}`,
          `after=${JSON.stringify(c.after)}`
        ],
        _step: step._stepId
      });
    }
  }
  return out;
}

function gatherLinks(finding) {
  const links = [];
  const t = finding.target || {};
  if (t.issueIdentifier) links.push(linearUrl(t.issueIdentifier));
  if (t.planId) links.push(`data/planning/plans.json#${t.planId}`);
  if (t.path) links.push(t.path);

  for (const ev of asList(finding.evidence)) {
    if (typeof ev !== 'string') continue;
    const m = ev.match(/\b([A-Z]+-\d+)\b/);
    if (m) links.push(linearUrl(m[1]));
    const c = ev.match(/\b[0-9a-f]{7,40}\b/i);
    if (c) links.push(`commit:${c[0]}`);
  }

  return Array.from(new Set(links));
}

function groupFindings(findings) {
  const sevOrder = ['blocker', 'warn', 'info'];
  const grouped = new Map();
  for (const sev of sevOrder) grouped.set(sev, new Map());

  for (const f of findings) {
    const sev = sevOrder.includes(f.severity) ? f.severity : 'info';
    const type = f.checkId || 'unknown';
    if (!grouped.get(sev).has(type)) grouped.get(sev).set(type, []);
    grouped.get(sev).get(type).push(f);
  }

  return grouped;
}

function renderMarkdown(runLog, findings) {
  const grouped = groupFindings(findings);

  const lines = [];
  lines.push(`# Janitor Drift Report`);
  lines.push('');
  lines.push(`- Run ID: ${runLog.runId}`);
  lines.push(`- Timestamp: ${runLog.timestamp}`);
  lines.push(`- Status: ${runLog.status}`);
  lines.push(`- Checks: ${runLog.summary?.checks ?? 0}`);
  lines.push(`- Fixes: ${runLog.summary?.fixes ?? 0}`);
  lines.push(`- Warns: ${runLog.summary?.warns ?? 0}`);
  lines.push(`- Blockers: ${runLog.summary?.blockers ?? 0}`);
  lines.push(`- Reporting channel (required): ${JANITOR_DISCORD_CHANNEL_ID}`);
  lines.push('');

  for (const sev of ['blocker', 'warn', 'info']) {
    const types = grouped.get(sev);
    if (!types || types.size === 0) continue;
    lines.push(`## ${sev.toUpperCase()}`);
    for (const [type, items] of types.entries()) {
      lines.push(`### ${type} (${items.length})`);
      for (const item of items) {
        const target = item.target?.issueIdentifier || item.target?.planId || item.target?.issueId || 'unknown-target';
        lines.push(`- [${item.status}] ${target}: ${item.message}`);
        const links = gatherLinks(item);
        if (links.length) lines.push(`  - Links: ${links.join(' | ')}`);
      }
    }
    lines.push('');
  }

  lines.push('## Operator actions');
  lines.push('1. Resolve blocker findings first (state/label conflicts, unsafe drifts).');
  lines.push('2. Review warned findings and approve/reject pending auto-fix policy updates.');
  lines.push('3. Confirm plan status reconciliations in data/planning/plans.json when present.');
  lines.push(`4. Post concise summary to Discord channel ${JANITOR_DISCORD_CHANNEL_ID} only.`);

  return lines.join('\n') + '\n';
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const runLogPath = path.resolve(process.cwd(), args.runLog);
  const runLog = JSON.parse(await fs.readFile(runLogPath, 'utf8'));

  const stepArtifacts = [];
  for (const step of asList(runLog.steps)) {
    if (!step.artifact) continue;
    const p = path.resolve(process.cwd(), step.artifact);
    try {
      const data = JSON.parse(await fs.readFile(p, 'utf8'));
      data._stepId = step.id;
      stepArtifacts.push(data);
    } catch {
      // ignore parse/read issues
    }
  }

  const findings = extractAllFindings(stepArtifacts);
  const markdown = renderMarkdown(runLog, findings);

  const payload = {
    runId: runLog.runId,
    timestamp: runLog.timestamp,
    reportChannelId: JANITOR_DISCORD_CHANNEL_ID,
    summary: runLog.summary,
    findingsCount: findings.length,
    markdown
  };

  if (args.output) {
    const outPath = path.resolve(process.cwd(), args.output);
    await fs.mkdir(path.dirname(outPath), { recursive: true });
    await fs.writeFile(outPath, JSON.stringify(payload, null, 2) + '\n', 'utf8');
  }

  process.stderr.write(`[render-drift-report] findings=${findings.length} channel=${JANITOR_DISCORD_CHANNEL_ID}\n`);
  process.stdout.write(JSON.stringify(payload, null, 2) + '\n');
}

main().catch((err) => {
  process.stderr.write(`[render-drift-report] fatal: ${err.message}\n`);
  process.exit(1);
});
