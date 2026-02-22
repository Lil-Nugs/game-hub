(function () {
  const config = window.GAME_HUB_SUPABASE_CONFIG || {};
  const supabaseUrl = String(config.url || '').replace(/\/$/, '');
  const publishableKey = String(config.publishableKey || '');

  const COMPAT_API_BASE = 'https://game-hub-supabase.local';
  const FINGERPRINT_STORAGE_KEY = 'gamehub.client-fingerprint.v1';

  window.GAME_HUB_API_BASE = COMPAT_API_BASE;

  function hasConfig() {
    return Boolean(supabaseUrl && publishableKey);
  }

  function createFingerprint() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') {
      return window.crypto.randomUUID();
    }
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
  }

  function getClientFingerprint() {
    try {
      const existing = window.localStorage.getItem(FINGERPRINT_STORAGE_KEY);
      if (existing) {
        return existing;
      }
      const created = createFingerprint();
      window.localStorage.setItem(FINGERPRINT_STORAGE_KEY, created);
      return created;
    } catch (_err) {
      return createFingerprint();
    }
  }

  function sanitizePlayerName(playerName) {
    const cleaned = String(playerName || '').replace(/[<>]/g, '').trim();
    return cleaned.slice(0, 20) || 'Anonymous';
  }

  function toPositiveInt(value, fallback, max) {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed) || parsed < 1) {
      return fallback;
    }
    return Math.min(parsed, max);
  }

  function buildHeaders(extraHeaders) {
    return {
      apikey: publishableKey,
      Authorization: `Bearer ${publishableKey}`,
      'Content-Type': 'application/json',
      ...extraHeaders,
    };
  }

  async function requestRest(path, options) {
    if (!hasConfig()) {
      throw new Error('Missing Supabase config (url/publishableKey).');
    }

    const method = options?.method || 'GET';
    const headers = buildHeaders(options?.headers);
    if (options?.prefer) {
      headers.Prefer = options.prefer;
    }

    const response = await fetch(`${supabaseUrl}/rest/v1${path}`, {
      method,
      headers,
      body: options?.body ? JSON.stringify(options.body) : undefined,
    });

    const raw = await response.text();
    const data = raw ? safeJson(raw) : null;

    if (!response.ok) {
      const message =
        (data && (data.message || data.error_description || data.error || data.hint)) ||
        `Supabase request failed (${response.status})`;
      throw new Error(message);
    }

    return data;
  }

  async function callRpc(name, body) {
    return requestRest(`/rpc/${encodeURIComponent(name)}`, {
      method: 'POST',
      body,
    });
  }

  function safeJson(raw) {
    try {
      return JSON.parse(raw);
    } catch (_err) {
      return null;
    }
  }

  async function submitScore(gameId, playerName, score) {
    const scoreValue = Number(score);
    if (!Number.isFinite(scoreValue)) {
      throw new Error('Score must be numeric.');
    }

    const cleanGameId = String(gameId || '').trim();
    if (!cleanGameId) {
      throw new Error('Missing gameId.');
    }

    const cleanPlayerName = sanitizePlayerName(playerName);

    await requestRest('/leaderboard_scores', {
      method: 'POST',
      prefer: 'return=minimal',
      body: {
        game_slug: cleanGameId,
        player_name: cleanPlayerName,
        score: Math.round(scoreValue),
        client_fingerprint: getClientFingerprint(),
      },
    });

    const scores = await getLeaderboard(cleanGameId, 100);
    const rank = scores.findIndex((row) => row.playerName === cleanPlayerName && row.score === Math.round(scoreValue)) + 1;

    return {
      ok: true,
      rank: rank > 0 ? rank : null,
      totalScores: scores.length,
    };
  }

  async function getLeaderboard(gameId, limit) {
    const cleanGameId = String(gameId || '').trim();
    if (!cleanGameId) {
      return [];
    }

    const rows = await callRpc('get_game_leaderboard', {
      p_game_slug: cleanGameId,
      p_limit: toPositiveInt(limit, 10, 100),
    });

    return (rows || []).map((row) => ({
      playerName: row.player_name,
      score: Number(row.score) || 0,
      date: row.created_at,
    }));
  }

  async function getGlobalLeaderboard(limit) {
    const rows = await callRpc('get_global_leaderboard', {
      p_limit: toPositiveInt(limit, 50, 250),
    });

    return (rows || []).map((row) => ({
      rank: Number(row.rank) || 0,
      gameSlug: row.game_slug,
      gameTitle: row.game_title,
      playerName: row.player_name,
      score: Number(row.score) || 0,
      date: row.created_at,
    }));
  }

  async function upsertRating(gameId, rating) {
    const cleanGameId = String(gameId || '').trim();
    const ratingValue = Number.parseInt(String(rating), 10);

    if (!cleanGameId) {
      throw new Error('Missing gameId.');
    }

    if (!Number.isInteger(ratingValue) || ratingValue < 1 || ratingValue > 5) {
      throw new Error('Rating must be an integer between 1 and 5.');
    }

    const rows = await callRpc('upsert_game_rating', {
      p_game_slug: cleanGameId,
      p_client_fingerprint: getClientFingerprint(),
      p_rating: ratingValue,
    });

    return Array.isArray(rows) ? rows[0] || null : rows;
  }

  async function getRatingSummary(gameId) {
    const cleanGameId = String(gameId || '').trim();
    if (!cleanGameId) {
      return null;
    }

    const rows = await callRpc('get_game_rating_summary', {
      p_game_slug: cleanGameId,
    });

    return Array.isArray(rows) ? rows[0] || null : rows;
  }

  function makeJsonResponse(data, status) {
    return new Response(JSON.stringify(data), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  async function parseRequestBody(input, init) {
    if (init && typeof init.body === 'string') {
      return safeJson(init.body) || {};
    }

    if (init && init.body && typeof init.body !== 'string') {
      try {
        return safeJson(String(init.body)) || {};
      } catch (_err) {
        return {};
      }
    }

    if (typeof Request !== 'undefined' && input instanceof Request) {
      try {
        return await input.clone().json();
      } catch (_err) {
        return {};
      }
    }

    return {};
  }

  async function handleCompatRequest(url, input, init) {
    const method = String(
      init?.method ||
      (typeof Request !== 'undefined' && input instanceof Request ? input.method : 'GET')
    ).toUpperCase();

    if (!hasConfig()) {
      return makeJsonResponse({ error: 'Supabase is not configured in this build.' }, 503);
    }

    if (url.pathname === '/api/scores' && method === 'GET') {
      const gameId = String(url.searchParams.get('gameId') || '').trim();
      if (!gameId) {
        return makeJsonResponse({ error: 'Missing gameId parameter' }, 400);
      }

      try {
        const scores = await getLeaderboard(gameId, toPositiveInt(url.searchParams.get('limit'), 10, 100));
        return makeJsonResponse({ gameId, scores }, 200);
      } catch (err) {
        return makeJsonResponse({ error: err.message || 'Unable to load scores' }, 500);
      }
    }

    if (url.pathname === '/api/scores' && method === 'POST') {
      const body = await parseRequestBody(input, init);
      const gameId = body?.gameId;
      const playerName = body?.playerName;
      const score = body?.score;

      if (!gameId || score === undefined) {
        return makeJsonResponse({ error: 'Missing gameId, playerName, or score' }, 400);
      }

      try {
        const result = await submitScore(gameId, playerName, score);
        return makeJsonResponse(result, 200);
      } catch (err) {
        return makeJsonResponse({ error: err.message || 'Unable to submit score' }, 500);
      }
    }

    if (url.pathname === '/api/games' && method === 'GET') {
      try {
        const games = await requestRest('/games?select=slug&archived=eq.false&order=slug.asc', {
          method: 'GET',
        });
        return makeJsonResponse({ games: (games || []).map((row) => row.slug) }, 200);
      } catch (err) {
        return makeJsonResponse({ error: err.message || 'Unable to load games' }, 500);
      }
    }

    return makeJsonResponse({ error: 'Not found' }, 404);
  }

  const nativeFetch = window.fetch.bind(window);
  window.fetch = async function patchedFetch(input, init) {
    let url;
    try {
      const requestUrl = typeof input === 'string' ? input : input.url;
      url = new URL(requestUrl, window.location.href);
    } catch (_err) {
      return nativeFetch(input, init);
    }

    if (url.origin === COMPAT_API_BASE) {
      return handleCompatRequest(url, input, init);
    }

    return nativeFetch(input, init);
  };

  window.GameHubSupabase = {
    isConfigured: hasConfig,
    getClientFingerprint,
    submitScore,
    getLeaderboard,
    getGlobalLeaderboard,
    upsertRating,
    getRatingSummary,
  };
})();
