// HTTP smoke test for POST /api/poe2/observations.
//   WORKER_URL=http://localhost:8799 node test-observations.mjs
// Exits non-zero on any failed assertion. Assumes the reference tables are seeded.

const BASE = process.env.WORKER_URL ?? 'http://localhost:8799';
let fails = 0;
const ok = (name, cond, extra = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? ` — ${extra}` : ''}`);
  if (!cond) fails++;
};
const post = (body, origin) =>
  fetch(`${BASE}/api/poe2/observations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(origin ? { Origin: origin } : {}) },
    body: JSON.stringify(body)
  });

const client = `test-${Date.now()}`;
const valid = {
  client_id: client,
  observations: [
    { jewel_type: 'Heroic Tragedy', conqueror: 'Vorana', seed: 6001, node_id: 'fire75', result_notable_id: 'kalguur_notable19', source_socket: 55190 },
    { jewel_type: 'Heroic Tragedy', conqueror: null, seed: 6001, node_id: 'accuracy16', result_notable_id: 'kalguur_notable15', source_socket: 61834 }
  ]
};

// 1) valid batch accepted
let r = await post(valid);
let j = await r.json().catch(() => ({}));
ok('valid batch -> 200', r.status === 200, `status ${r.status} ${JSON.stringify(j)}`);
ok('reports accepted=2', j.accepted === 2, JSON.stringify(j));

// 2) idempotent: same batch again, still accepted (upsert), no error
r = await post(valid);
ok('re-submit -> 200 (idempotent)', r.status === 200);

// 3) invalid node_id -> rejected 400 (FK)
r = await post({ client_id: client, observations: [{ jewel_type: 'Heroic Tragedy', seed: 6001, node_id: 'NOT_A_REAL_NODE', result_notable_id: 'kalguur_notable19' }] });
ok('bad node_id -> 400', r.status === 400, `status ${r.status}`);

// 4) result not in the jewel's vocab -> rejected 400 (composite FK)
r = await post({ client_id: client, observations: [{ jewel_type: 'Heroic Tragedy', seed: 6001, node_id: 'fire75', result_notable_id: 'abyss_notable1' }] });
ok('wrong-jewel result -> 400', r.status === 400, `status ${r.status}`);

// 5) seed out of range -> rejected 400 (trigger PT400)
r = await post({ client_id: client, observations: [{ jewel_type: 'Heroic Tragedy', seed: 999999, node_id: 'fire75', result_notable_id: 'kalguur_notable19' }] });
ok('seed out of range -> 400', r.status === 400, `status ${r.status}`);

// 6) malformed payloads -> 400
r = await post({ observations: [] });
ok('empty observations -> 400', r.status === 400);
r = await post({ client_id: client });
ok('missing observations -> 400', r.status === 400);

// 7) OPTIONS preflight from an allowed origin returns CORS headers
r = await fetch(`${BASE}/api/poe2/observations`, { method: 'OPTIONS', headers: { Origin: 'http://localhost:5173' } });
ok('OPTIONS -> 204', r.status === 204, `status ${r.status}`);
ok('OPTIONS allows localhost:5173', r.headers.get('access-control-allow-origin') === 'http://localhost:5173');

console.log(`\n${fails === 0 ? 'ALL PASS' : `${fails} FAILED`}`);
process.exit(fails ? 1 : 0);
