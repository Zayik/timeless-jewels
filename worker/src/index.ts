import { neon } from '@neondatabase/serverless';

interface Env {
  // Neon connection string (owner role). Set via `wrangler secret put DATABASE_URL`
  // for production and worker/.dev.vars for `wrangler dev`. Used only for read-only
  // SELECTs against public PoE2 reference tables and the catalog_consensus view.
  DATABASE_URL: string;
}

const POE_BASE = 'https://www.pathofexile.com';

const ALLOWED_ORIGINS = new Set([
  'https://zayik.github.io',
  'http://localhost:5173',
  'http://localhost:4173'
]);

function corsHeaders(origin: string): Record<string, string> {
  const allowedOrigin = ALLOWED_ORIGINS.has(origin) ? origin : '';
  return {
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Accept, X-Poe-Session',
    'Access-Control-Expose-Headers': [
      'x-rate-limit-ip',
      'x-rate-limit-ip-state',
      'x-rate-limit-account',
      'x-rate-limit-account-state',
      'retry-after'
    ].join(', ')
  };
}

function buildHttpHeaders(request: Request): Headers {
  const headers = new Headers();
  headers.set('Accept', request.headers.get('Accept') ?? 'application/json');
  headers.set('Content-Type', request.headers.get('Content-Type') ?? 'application/json');
  headers.set('Origin', POE_BASE);
  headers.set('Referer', `${POE_BASE}/`);
  headers.set('User-Agent', 'OAuth timeless-jewels/1.0 (contact: github.com/zayik/timeless-jewels)');
  const poeSession = request.headers.get('X-Poe-Session');
  if (poeSession) headers.set('Cookie', `POESESSID=${poeSession}`);
  return headers;
}

function buildWsHeaders(poeSession: string | null): Headers {
  const headers = new Headers();
  headers.set('Origin', POE_BASE);
  headers.set('Referer', `${POE_BASE}/`);
  headers.set('User-Agent', 'OAuth timeless-jewels/1.0 (contact: github.com/zayik/timeless-jewels)');
  headers.set('Upgrade', 'websocket');
  if (poeSession) headers.set('Cookie', `POESESSID=${poeSession}`);
  return headers;
}

// ── PoE trade API proxy (HTTP + WebSocket) ─────────────────────────────────────
async function handleTrade(request: Request, url: URL, cors: Record<string, string>): Promise<Response> {
  const targetUrl = `${POE_BASE}${url.pathname}${url.search}`;

  // ── WebSocket proxy ──────────────────────────────────────────────────────
  if (request.headers.get('Upgrade') === 'websocket') {
    console.log('[WS] upgrade request for', url.pathname);

    // Browser WebSocket API can't send custom headers; accept session via query param.
    // Strip it before forwarding to PoE so it doesn't appear in their URL.
    const poeSession = request.headers.get('X-Poe-Session') ?? url.searchParams.get('session');
    const cleanParams = new URLSearchParams(url.search);
    cleanParams.delete('session');
    const cleanSearch = [...cleanParams.keys()].length > 0 ? `?${cleanParams}` : '';
    const wsTargetUrl = `${POE_BASE}${url.pathname}${cleanSearch}`;

    let originResp: Response;
    try {
      originResp = await fetch(wsTargetUrl, { headers: buildWsHeaders(poeSession) });
    } catch (err) {
      console.error('[WS] fetch to PoE origin failed:', err);
      return new Response(`WebSocket fetch error: ${err}`, { status: 502 });
    }

    console.log('[WS] origin response status:', originResp.status);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const originWs = (originResp as any).webSocket as WebSocket | null | undefined;
    if (!originWs) {
      const body = await originResp.text().catch(() => '(unreadable)');
      console.error('[WS] no webSocket on response — status:', originResp.status, 'body:', body);
      return new Response(
        `PoE did not upgrade to WebSocket (HTTP ${originResp.status}): ${body}`,
        { status: 502 }
      );
    }

    originWs.accept();

    const [clientWs, serverWs] = Object.values(new WebSocketPair());
    serverWs.accept();

    // origin → browser
    originWs.addEventListener('message', (event) => {
      try { serverWs.send((event as MessageEvent).data); } catch { /* browser closed */ }
    });
    originWs.addEventListener('close', (event) => {
      const e = event as CloseEvent;
      try { serverWs.close(e.code, e.reason); } catch { /* already closed */ }
    });

    // browser → origin (PoE live search is read-only, but bridge it anyway)
    serverWs.addEventListener('message', (event) => {
      try { originWs.send((event as MessageEvent).data); } catch { /* origin closed */ }
    });
    serverWs.addEventListener('close', (event) => {
      const e = event as CloseEvent;
      try { originWs.close(e.code, e.reason); } catch { /* already closed */ }
    });

    console.log('[WS] bridge established');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return new Response(null, { status: 101, webSocket: clientWs } as any);
  }

  // ── HTTP proxy ────────────────────────────────────────────────────────────
  const response = await fetch(targetUrl, {
    method: request.method,
    headers: buildHttpHeaders(request),
    body: request.method !== 'GET' && request.method !== 'HEAD' ? request.body : undefined
  });

  const respHeaders = new Headers(response.headers);
  for (const [k, v] of Object.entries(cors)) {
    respHeaders.set(k, v);
  }
  respHeaders.delete('content-encoding');

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: respHeaders
  });
}

// ── PoE2 community dataset: cached, public, read-only ───────────────────────────
//
// Reads from the Neon project Poe2-Timeless-Jewel. The frontend never holds DB
// credentials — it browses through here without a login. Contribution (writes)
// goes straight to the Neon Data API with a Neon Auth JWT, governed by RLS, and
// does NOT pass through this Worker.
//
// Responses are edge-cached (caches.default) keyed by URL. Reference data
// (jewels / notable vocabulary) changes rarely and is cached for an hour;
// consensus reflects fresh community votes and is cached briefly.
const REFERENCE_MAX_AGE = 3600;
const CONSENSUS_MAX_AGE = 60;

function jsonResponse(body: unknown, cors: Record<string, string>, maxAge: number): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {
      ...cors,
      'Content-Type': 'application/json',
      'Cache-Control': `public, max-age=${maxAge}`
    }
  });
}

function errorResponse(message: string, status: number, cors: Record<string, string>): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' }
  });
}

// ── PoE2 contribution: anonymous, validated, idempotent ─────────────────────────
//
// The overlay tool POSTs observed transforms here. The Worker holds the DB credential
// (the client never does), so writes are anonymous-but-identified by a client-supplied
// stable UUID. The DB foreign keys guarantee the data is real (jewel/node/conqueror
// exist, and the result notable belongs to the jewel); the unique index
// (jewel_type, seed, node_id, client_id) makes a re-record overwrite the same client's
// vote rather than inflate the confirmation count.
const MAX_OBSERVATIONS = 1000;

function noStoreJson(body: unknown, status: number, cors: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
  });
}

async function handlePoe2Write(
  request: Request,
  env: Env,
  cors: Record<string, string>
): Promise<Response> {
  if (!env.DATABASE_URL) return errorResponse('database not configured', 500, cors);

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return errorResponse('invalid JSON body', 400, cors);
  }
  const p = payload as { client_id?: unknown; observations?: unknown };
  const clientId = typeof p.client_id === 'string' ? p.client_id.trim() : '';
  if (!clientId || clientId.length > 100) {
    return errorResponse('missing or invalid client_id', 400, cors);
  }
  if (!Array.isArray(p.observations) || p.observations.length === 0) {
    return errorResponse('observations must be a non-empty array', 400, cors);
  }
  if (p.observations.length > MAX_OBSERVATIONS) {
    return errorResponse(`too many observations (max ${MAX_OBSERVATIONS})`, 400, cors);
  }

  // Shape-validate into parallel arrays for a single bulk upsert. A bad row would abort
  // the whole batch, so reject the request early with a clear message; the DB FKs do the
  // game-data validity check (real node, result-in-vocab-for-jewel, valid conqueror).
  const jewelType: string[] = [];
  const conqueror: (string | null)[] = [];
  const seed: number[] = [];
  const nodeId: string[] = [];
  const resultId: string[] = [];
  const sourceSocket: (number | null)[] = [];
  const source: string[] = [];
  for (const o of p.observations as Array<Record<string, unknown>>) {
    if (
      typeof o.jewel_type !== 'string' ||
      typeof o.node_id !== 'string' ||
      typeof o.result_notable_id !== 'string' ||
      !Number.isInteger(o.seed)
    ) {
      return errorResponse('each observation needs jewel_type, seed, node_id, result_notable_id', 400, cors);
    }
    jewelType.push(o.jewel_type);
    conqueror.push(typeof o.conqueror === 'string' && o.conqueror ? o.conqueror : null);
    seed.push(o.seed as number);
    nodeId.push(o.node_id);
    resultId.push(o.result_notable_id);
    sourceSocket.push(Number.isInteger(o.source_socket) ? (o.source_socket as number) : null);
    source.push('capture');
  }

  // Identity is stamped server-side by the observations BEFORE-INSERT trigger from
  // app.current_client_id(), which reads the `sub` of request.jwt.claims. We don't run a
  // login, so we feed the anonymous contributor UUID as that claim for THIS transaction
  // (set_config local). The trigger then stamps client_id = our UUID and applies its
  // per-client throttle + seed-range check. client_id is therefore omitted from the insert.
  const sql = neon(env.DATABASE_URL);
  const claims = JSON.stringify({ sub: clientId });
  try {
    const results = await sql.transaction([
      sql`SELECT set_config('request.jwt.claims', ${claims}, true)`,
      sql`
        INSERT INTO observations
          (jewel_type, conqueror, seed, node_id, result_notable_id, source_socket, source)
        SELECT * FROM unnest(
          ${jewelType}::text[], ${conqueror}::text[], ${seed}::int[], ${nodeId}::text[],
          ${resultId}::text[], ${sourceSocket}::int[], ${source}::text[]
        )
        ON CONFLICT (jewel_type, seed, node_id, client_id) DO UPDATE
          SET result_notable_id = EXCLUDED.result_notable_id,
              conqueror = EXCLUDED.conqueror,
              source_socket = EXCLUDED.source_socket,
              source = EXCLUDED.source,
              created_at = now()
        RETURNING id
      `
    ]);
    const accepted = (results[1] as unknown[]).length;
    return noStoreJson({ ok: true, accepted }, 200, cors);
  } catch (e) {
    // FK violation (unknown node/result/conqueror), seed out of range, or throttle (the
    // trigger raises PT429). Surface it so the client decides drop (4xx) vs retry.
    return errorResponse(`insert rejected: ${e instanceof Error ? e.message : String(e)}`, 400, cors);
  }
}

async function handlePoe2(
  request: Request,
  url: URL,
  env: Env,
  cors: Record<string, string>,
  ctx: ExecutionContext
): Promise<Response> {
  if (request.method === 'POST' && url.pathname === '/api/poe2/observations') {
    return handlePoe2Write(request, env, cors);
  }
  if (request.method !== 'GET') {
    return errorResponse('method not allowed', 405, cors);
  }
  if (!env.DATABASE_URL) {
    return errorResponse('database not configured', 500, cors);
  }

  // Serve from edge cache when possible. Cache key ignores the Origin header so
  // all allowed origins share one cached payload; CORS headers are re-applied below.
  const cache = caches.default;
  const cacheKey = new Request(url.toString(), { method: 'GET' });
  const cached = await cache.match(cacheKey);
  if (cached) {
    const headers = new Headers(cached.headers);
    for (const [k, v] of Object.entries(cors)) headers.set(k, v);
    headers.set('X-Cache', 'HIT');
    return new Response(cached.body, { status: cached.status, headers });
  }

  const sql = neon(env.DATABASE_URL);
  let response: Response;

  if (url.pathname === '/api/poe2/jewels') {
    // Jewel registry with seed ranges and conqueror lists.
    const rows = await sql`
      SELECT j.id, j.name, j.seed_min, j.seed_max,
             COALESCE(
               array_agg(c.name ORDER BY c.name) FILTER (WHERE c.name IS NOT NULL),
               '{}'
             ) AS conquerors
      FROM jewel_types j
      LEFT JOIN conquerors c ON c.jewel_type = j.id
      GROUP BY j.id, j.name, j.seed_min, j.seed_max
      ORDER BY j.name
    `;
    response = jsonResponse({ jewels: rows }, cors, REFERENCE_MAX_AGE);
  } else if (url.pathname === '/api/poe2/reference') {
    // Dropdown data for the contribution form: every base tree notable plus the
    // result-notable vocabulary for the selected jewel.
    const jewel = url.searchParams.get('jewel');
    if (!jewel) return errorResponse('missing ?jewel', 400, cors);
    const [treeNotables, vocab] = await Promise.all([
      sql`SELECT node_id, name FROM tree_notables ORDER BY name`,
      sql`SELECT id, name FROM vocab_notables WHERE jewel_type = ${jewel} ORDER BY name`
    ]);
    if (vocab.length === 0) return errorResponse('unknown jewel', 404, cors);
    response = jsonResponse(
      { jewel, treeNotables, vocabNotables: vocab },
      cors,
      REFERENCE_MAX_AGE
    );
  } else if (url.pathname === '/api/poe2/consensus') {
    // The core lookup: every recorded transform for a (jewel, seed), with names
    // resolved and confirmation counts. catalog_consensus is conqueror-agnostic
    // (notables roll off seed + node, matching PoE mechanics).
    const jewel = url.searchParams.get('jewel');
    const seedRaw = url.searchParams.get('seed');
    if (!jewel || !seedRaw) return errorResponse('missing ?jewel and ?seed', 400, cors);
    const seed = Number(seedRaw);
    if (!Number.isInteger(seed)) return errorResponse('seed must be an integer', 400, cors);
    const rows = await sql`
      SELECT cc.node_id,
             tn.name AS node_name,
             cc.result_notable_id,
             vn.name AS result_notable_name,
             cc.confirmations,
             cc.verified,
             cc.last_seen
      FROM catalog_consensus cc
      JOIN tree_notables tn ON tn.node_id = cc.node_id
      JOIN vocab_notables vn ON vn.jewel_type = cc.jewel_type AND vn.id = cc.result_notable_id
      WHERE cc.jewel_type = ${jewel} AND cc.seed = ${seed}
      ORDER BY tn.name
    `;
    response = jsonResponse({ jewel, seed, results: rows }, cors, CONSENSUS_MAX_AGE);
  } else if (url.pathname === '/api/poe2/search') {
    // Reverse search: which recorded seeds turn some node into one of the desired
    // result notables. Conqueror-agnostic (catalog_consensus rolls off seed + node),
    // so we don't filter by conqueror here. The client filters the returned rows to
    // its socket's affected nodes and scores/ranks them. Returns every recorded seed by
    // default (the contributor pool is too small to gate on validation); pass verified=1
    // to filter to records confirmed by >= 2 distinct clients.
    const jewel = url.searchParams.get('jewel');
    const notablesRaw = url.searchParams.get('notables');
    if (!jewel || !notablesRaw) {
      return errorResponse('missing ?jewel and ?notables', 400, cors);
    }
    const notables = notablesRaw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (notables.length === 0) {
      return errorResponse('no notables given', 400, cors);
    }
    const verifiedOnly = url.searchParams.get('verified') === '1';
    // Fetch one extra row to detect (and flag) truncation rather than silently capping.
    const limit = 5000;
    const rows = verifiedOnly
      ? await sql`
          SELECT cc.seed, cc.node_id, cc.result_notable_id, cc.confirmations, cc.verified
          FROM catalog_consensus cc
          WHERE cc.jewel_type = ${jewel}
            AND cc.result_notable_id = ANY(${notables})
            AND cc.verified
          ORDER BY cc.confirmations DESC
          LIMIT ${limit + 1}
        `
      : await sql`
          SELECT cc.seed, cc.node_id, cc.result_notable_id, cc.confirmations, cc.verified
          FROM catalog_consensus cc
          WHERE cc.jewel_type = ${jewel}
            AND cc.result_notable_id = ANY(${notables})
          ORDER BY cc.confirmations DESC
          LIMIT ${limit + 1}
        `;
    const truncated = rows.length > limit;
    response = jsonResponse(
      { jewel, notables, results: truncated ? rows.slice(0, limit) : rows, truncated },
      cors,
      CONSENSUS_MAX_AGE
    );
  } else {
    return errorResponse('not found', 404, cors);
  }

  // Store a CORS-free copy in the edge cache; per-request CORS is added on the way out.
  ctx.waitUntil(cache.put(cacheKey, response.clone()));
  return response;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin') ?? '';
    const cors = corsHeaders(origin);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors });
    }

    // Covers both PoE1 (/api/trade/...) and PoE2 (/api/trade2/...) — same origin proxy.
    if (url.pathname.startsWith('/api/trade')) {
      return handleTrade(request, url, cors);
    }

    if (url.pathname.startsWith('/api/poe2/')) {
      return handlePoe2(request, url, env, cors, ctx);
    }

    return new Response('Not found', { status: 404, headers: cors });
  }
};
