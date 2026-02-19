export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const corsHeaders = {
      'Access-Control-Allow-Origin': env.ALLOWED_ORIGIN || '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    try {
      if (url.pathname === '/health') {
        return json({ status: 'ok' }, corsHeaders);
      }

      if (url.pathname === '/api/scores' && request.method === 'POST') {
        return handlePostScore(request, env, corsHeaders);
      }

      if (url.pathname === '/api/scores' && request.method === 'GET') {
        return handleGetScores(url, env, corsHeaders);
      }

      if (url.pathname === '/api/games' && request.method === 'GET') {
        return handleGetGames(env, corsHeaders);
      }

      return json({ error: 'Not found' }, corsHeaders, 404);
    } catch (e) {
      return json({ error: 'Internal server error' }, corsHeaders, 500);
    }
  },
};

async function handlePostScore(request, env, corsHeaders) {
  const body = await request.json();
  const { gameId, playerName, score } = body;

  if (!gameId || !playerName || score === undefined) {
    return json({ error: 'Missing gameId, playerName, or score' }, corsHeaders, 400);
  }

  const sanitizedName = String(playerName).replace(/[<>]/g, '').slice(0, 20).trim();
  if (!sanitizedName) {
    return json({ error: 'Invalid playerName' }, corsHeaders, 400);
  }

  const numScore = Number(score);
  if (!Number.isFinite(numScore)) {
    return json({ error: 'Invalid score' }, corsHeaders, 400);
  }

  const key = `scores:${gameId}`;
  const existing = await env.SCORES.get(key, 'json') || [];

  existing.push({ playerName: sanitizedName, score: numScore, date: new Date().toISOString() });
  existing.sort((a, b) => b.score - a.score);
  const capped = existing.slice(0, 100);

  await env.SCORES.put(key, JSON.stringify(capped));

  const rank = capped.findIndex(e => e.playerName === sanitizedName && e.score === numScore) + 1;

  return json({ ok: true, rank, totalScores: capped.length }, corsHeaders);
}

async function handleGetScores(url, env, corsHeaders) {
  const gameId = url.searchParams.get('gameId');
  if (!gameId) {
    return json({ error: 'Missing gameId parameter' }, corsHeaders, 400);
  }

  const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit') || '10', 10), 1), 100);
  const key = `scores:${gameId}`;
  const scores = await env.SCORES.get(key, 'json') || [];

  return json({ gameId, scores: scores.slice(0, limit) }, corsHeaders);
}

async function handleGetGames(env, corsHeaders) {
  const list = await env.SCORES.list({ prefix: 'scores:' });
  const gameIds = list.keys.map(k => k.name.replace('scores:', ''));
  return json({ games: gameIds }, corsHeaders);
}

function json(data, corsHeaders, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders },
  });
}
