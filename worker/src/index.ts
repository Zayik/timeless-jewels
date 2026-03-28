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
};
