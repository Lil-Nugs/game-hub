#!/usr/bin/env node

import { readFile } from 'node:fs/promises';
import path from 'node:path';

const cwd = process.cwd();
const credentialsPath = process.env.SUPABASE_CREDENTIALS_PATH || path.join(process.env.HOME || '', '.openclaw/credentials/supabase.json');
const manifestPath = process.env.GAMES_MANIFEST_PATH || path.join(cwd, 'games.json');
const dryRun = process.argv.includes('--dry-run');

async function main() {
  const credentials = JSON.parse(await readFile(credentialsPath, 'utf8'));
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const games = Array.isArray(manifest) ? manifest : (manifest.games || []);

  const payload = games.map((game) => ({
    slug: game.slug,
    title: game.title,
    description: game.description || '',
    creator: game.creator || 'unknown',
    model: game.model,
    archived: Boolean(game.archived),
    created_at: game.date || new Date().toISOString(),
  }));

  if (dryRun) {
    console.log(`Dry run: ${payload.length} games would be upserted to Supabase.`);
    return;
  }

  const response = await fetch(`${credentials.url.replace(/\/$/, '')}/rest/v1/games?on_conflict=slug`, {
    method: 'POST',
    headers: {
      apikey: credentials.secretKey,
      Authorization: `Bearer ${credentials.secretKey}`,
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates,return=minimal',
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const raw = await response.text();
    throw new Error(`Failed to sync games (${response.status}): ${raw}`);
  }

  console.log(`Synced ${payload.length} games from ${manifestPath}.`);
}

main().catch((err) => {
  console.error(err.message);
  process.exitCode = 1;
});
