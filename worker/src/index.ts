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

function buildForwardHeaders(request: Request): Headers {
  const headers = new Headers();
  headers.set('Accept', request.headers.get('Accept') ?? 'application/json');
  headers.set('Content-Type', request.headers.get('Content-Type') ?? 'application/json');
  headers.set('Origin', POE_BASE);
  headers.set('Referer', `${POE_BASE}/`);
  headers.set('User-Agent', 'OAuth timeless-jewels/1.0 (contact: github.com/zayik/timeless-jewels)');

  const poeSession = request.headers.get('X-Poe-Session');
  if (poeSession) {
    headers.set('Cookie', `POESESSID=${poeSession}`);
  }

  return headers;
}

export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin') ?? '';
    const cors = corsHeaders(origin);

    if (!url.pathname.startsWith('/api/trade/')) {
      return new Response('Not found', { status: 404 });
    }

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors });
    }

    const targetUrl = `${POE_BASE}${url.pathname}${url.search}`;
    const fwdHeaders = buildForwardHeaders(request);

    // WebSocket upgrade — Cloudflare tunnels the connection to the origin automatically
    if (request.headers.get('Upgrade') === 'websocket') {
      const wsUrl = targetUrl.replace('https://', 'wss://');
      fwdHeaders.delete('Content-Type');
      return fetch(wsUrl, { headers: fwdHeaders });
    }

    const response = await fetch(targetUrl, {
      method: request.method,
      headers: fwdHeaders,
      body: request.method !== 'GET' && request.method !== 'HEAD' ? request.body : undefined
    });

    const respHeaders = new Headers(response.headers);
    for (const [k, v] of Object.entries(cors)) {
      respHeaders.set(k, v);
    }
    // Workers runtime decompresses automatically; remove to avoid double-decompression
    respHeaders.delete('content-encoding');

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: respHeaders
    });
  }
};
