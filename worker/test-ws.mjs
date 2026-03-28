/**
 * Usage:
 *   node test-ws.mjs                          # test local wrangler dev (port 8787)
 *   WORKER_URL=https://...workers.dev node test-ws.mjs   # test deployed worker
 *   LEAGUE=Standard node test-ws.mjs         # change league
 */
import WebSocket from 'ws';

const BASE = process.env.WORKER_URL ?? 'http://localhost:8787';
const WS_BASE = BASE.replace(/^http:\/\//, 'ws://').replace(/^https:\/\//, 'wss://');
const LEAGUE = process.env.LEAGUE ?? 'Standard';

console.log(`Worker base : ${BASE}`);
console.log(`League      : ${LEAGUE}`);
console.log('');

// 1. Get a query ID via search
console.log('Step 1: POST /api/trade/search/' + LEAGUE);
let queryId;
try {
  const resp = await fetch(`${BASE}/api/trade/search/${LEAGUE}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      query: { status: { option: 'online' }, type: 'Timeless Jewel' },
      sort: { indexed: 'desc' }
    })
  });
  const text = await resp.text();
  console.log(`  status: ${resp.status}`);
  if (!resp.ok) {
    console.error('  body:', text);
    process.exit(1);
  }
  const json = JSON.parse(text);
  queryId = json.id;
  console.log(`  query id: ${queryId}  (${json.total ?? '?'} results)`);
} catch (err) {
  console.error('Search request failed:', err.message);
  process.exit(1);
}

// 2. Connect WebSocket
const wsUrl = `${WS_BASE}/api/trade/live/${LEAGUE}/${queryId}`;
console.log('\nStep 2: WebSocket connect');
console.log(' ', wsUrl);

const ws = new WebSocket(wsUrl);

ws.on('open', () => console.log('  ✓ connected'));
ws.on('message', (data) => console.log('  message:', data.toString()));
ws.on('error', (err) => console.error('  ✗ error:', err.message));
ws.on('close', (code, reason) => console.log(`  closed: ${code} ${reason || '(no reason)'}`));

// Wait 20 seconds for any messages then exit
setTimeout(() => {
  console.log('\nDone (20s timeout). Closing.');
  ws.close();
  process.exit(0);
}, 20_000);
