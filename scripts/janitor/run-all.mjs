#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';

function parseArgs(argv) {
  const out = {
    logsDir: 'logs/janitor',
    artifactsDir: 'logs/janitor/artifacts',
    fixSafe: false,
    writePlans: false,
    quiet: false,
    injectFailStep: false,
    escalateWrite: false,
    writeDependencies: false
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--logs-dir') out.logsDir = argv[++i];
    else if (a === '--artifacts-dir') out.artifactsDir = argv[++i];
    else if (a === '--fix-safe') out.fixSafe = true;
    else if (a === '--write-plans') out.writePlans = true;
    else if (a === '--quiet') out.quiet = true;
    else if (a === '--inject-fail-step') out.injectFailStep = true;
    else if (a === '--escalate-write') out.escalateWrite = true;
    else if (a === '--write-dependencies') out.writeDependencies = true;
    else if (a === '-h' || a === '--help') {
      help();
      process.exit(0);
    }
  }
  return out;
}

function help() {
  console.log(`Usage: node scripts/janitor/run-all.mjs [options]

Options:
  --fix-safe              Pass safe-fix mode to linear drift checker
  --write-plans           Enable plans.json write mode in reconciler
  --logs-dir <path>       Log directory (default: logs/janitor)
  --artifacts-dir <path>  Artifact directory (default: logs/janitor/artifacts)
  --quiet                 Suppress per-step stdout forwarding
  --inject-fail-step      Add an intentional failing step (for failure-path validation)
  --escalate-write        Allow escalation hook to create/update Linear issue on blockers
  --write-dependencies    Persist dependency backfill + dep label updates to Linear
`);
}

function runNodeScript(scriptRelPath, args = [], { cwd, quiet = false } = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [scriptRelPath, ...args], { cwd });
    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (d) => {
      const s = d.toString();
      stdout += s;
      if (!quiet) process.stdout.write(s);
    });
    child.stderr.on('data', (d) => {
      const s = d.toString();
      stderr += s;
      if (!quiet) process.stderr.write(s);
    });

    child.on('close', (code) => resolve({ code: code ?? 1, stdout, stderr }));
    child.on('error', (err) => resolve({ code: 1, stdout, stderr: `${stderr}\n${err.message}` }));
  });
}

function safeJsonParse(raw, fallback) {
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function extractCounts(report) {
  if (!report || typeof report !== 'object') return { checks: 0, fixes: 0, blockers: 0, warns: 0 };
  const summary = report.summary || {};
  return {
    checks: summary.totalFindings ?? summary.totalChecks ?? 0,
    fixes: summary.autoFixesApplied ?? 0,
    blockers: summary.blockers ?? 0,
    warns: summary.warns ?? 0
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const cwd = process.cwd();
  const start = Date.now();
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');

  const logsDir = path.resolve(cwd, args.logsDir);
  const artifactsDir = path.resolve(cwd, args.artifactsDir);
  await fs.mkdir(logsDir, { recursive: true });
  await fs.mkdir(artifactsDir, { recursive: true });

  const currentRunPath = path.join(logsDir, '_current-run.json');

  const steps = [
    {
      id: 'check-linear-drift',
      script: 'scripts/janitor/check-linear-drift.mjs',
      scriptArgs: [...(args.fixSafe ? ['--fix-safe'] : [])]
    },
    {
      id: 'backfill-dependencies',
      script: 'scripts/janitor/backfill-dependencies.mjs',
      scriptArgs: [...(args.writeDependencies ? ['--write'] : [])]
    },
    {
      id: 'reconcile-plans-status',
      script: 'scripts/janitor/reconcile-plans-status.mjs',
      scriptArgs: [...(args.writePlans ? ['--write'] : [])]
    },
    {
      id: 'render-drift-report',
      script: 'scripts/janitor/render-drift-report.mjs',
      scriptArgs: ['--run-log', 'logs/janitor/_current-run.json', '--output', 'logs/janitor/drift-report.json']
    },
    {
      id: 'escalate-drift-to-linear',
      script: 'scripts/janitor/escalate-drift-to-linear.mjs',
      scriptArgs: ['--report', 'logs/janitor/drift-report.json', ...(args.escalateWrite ? ['--write'] : ['--dry-run'])]
    },
    ...(args.injectFailStep
      ? [
          {
            id: 'intentional-failure',
            script: 'scripts/janitor/does-not-exist.mjs',
            scriptArgs: []
          }
        ]
      : [])
  ];

  const runLog = {
    runId: `janitor-run-${stamp}`,
    timestamp: new Date().toISOString(),
    mode: {
      fixSafe: args.fixSafe,
      writePlans: args.writePlans
    },
    steps: [],
    summary: {
      checks: 0,
      fixes: 0,
      warns: 0,
      blockers: 0,
      stepFailures: 0
    },
    durationMs: 0,
    status: 'ok'
  };

  await fs.writeFile(currentRunPath, JSON.stringify(runLog, null, 2) + '\n', 'utf8');

  for (const step of steps) {
    const result = await runNodeScript(step.script, step.scriptArgs, { cwd, quiet: args.quiet });
    const parsed = safeJsonParse(result.stdout, null);
    const counts = extractCounts(parsed);

    const artifactPath = path.join(artifactsDir, `${stamp}-${step.id}.json`);
    if (parsed) {
      await fs.writeFile(artifactPath, JSON.stringify(parsed, null, 2) + '\n', 'utf8');
    } else {
      await fs.writeFile(
        artifactPath,
        JSON.stringify({ parseError: true, stdout: result.stdout, stderr: result.stderr }, null, 2) + '\n',
        'utf8'
      );
    }

    runLog.steps.push({
      id: step.id,
      script: step.script,
      args: step.scriptArgs,
      exitCode: result.code,
      artifact: path.relative(cwd, artifactPath),
      counts
    });

    runLog.summary.checks += counts.checks;
    runLog.summary.fixes += counts.fixes;
    runLog.summary.warns += counts.warns;
    runLog.summary.blockers += counts.blockers;

    if (result.code !== 0) {
      runLog.summary.stepFailures += 1;
      runLog.status = 'failed';
    }

    await fs.writeFile(currentRunPath, JSON.stringify(runLog, null, 2) + '\n', 'utf8');
  }

  runLog.durationMs = Date.now() - start;

  const runLogPath = path.join(logsDir, `${stamp}.json`);
  const lastRunPath = path.join(logsDir, 'last-run.json');
  await fs.writeFile(runLogPath, JSON.stringify(runLog, null, 2) + '\n', 'utf8');
  await fs.writeFile(lastRunPath, JSON.stringify(runLog, null, 2) + '\n', 'utf8');
  await fs.rm(currentRunPath, { force: true });

  // retention: keep most recent 50 run logs
  const entries = (await fs.readdir(logsDir))
    .filter((n) => n.endsWith('.json') && n !== 'last-run.json')
    .sort();
  if (entries.length > 50) {
    const toDelete = entries.slice(0, entries.length - 50);
    await Promise.all(toDelete.map((f) => fs.rm(path.join(logsDir, f), { force: true })));
  }

  const concise = {
    runId: runLog.runId,
    status: runLog.status,
    checks: runLog.summary.checks,
    fixes: runLog.summary.fixes,
    warns: runLog.summary.warns,
    blockers: runLog.summary.blockers,
    stepFailures: runLog.summary.stepFailures,
    lastRunArtifact: path.relative(cwd, lastRunPath)
  };

  process.stderr.write(`[run-all] ${JSON.stringify(concise)}\n`);

  if (runLog.status !== 'ok') {
    process.stderr.write('[run-all] one or more steps failed\n');
    process.exit(1);
  }
}

main().catch((err) => {
  process.stderr.write(`[run-all] fatal: ${err.message}\n`);
  process.exit(1);
});
