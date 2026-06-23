// Validate the Worker's write path against a Neon branch using the SAME driver/queries
// the Worker uses: set the jwt claim (anonymous contributor uuid) + bulk unnest upsert in
// one transaction, and confirm the trigger stamps client_id from the claim.
//
// Run: DATABASE_URL=postgres://... node scripts/test_write.mjs

import { neon } from '@neondatabase/serverless';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL required');
const sql = neon(url);

async function submit(clientId, obs) {
  const claims = JSON.stringify({ sub: clientId });
  const jewelType = obs.map((o) => o.jewel_type);
  const conqueror = obs.map((o) => o.conqueror ?? null);
  const seed = obs.map((o) => o.seed);
  const nodeId = obs.map((o) => o.node_id);
  const resultId = obs.map((o) => o.result_notable_id);
  const sourceSocket = obs.map((o) => o.source_socket ?? null);
  const source = obs.map(() => 'capture');
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
      RETURNING id, client_id, node_id
    `
  ]);
  return results[1];
}

const obs = [
  { jewel_type: 'Heroic Tragedy', conqueror: 'Vorana', seed: 5123, node_id: 'fire75', result_notable_id: 'kalguur_notable19', source_socket: 55190 },
  { jewel_type: 'Heroic Tragedy', conqueror: 'Vorana', seed: 5123, node_id: 'lightning68', result_notable_id: 'kalguur_notable15', source_socket: 55190 }
];

const r1 = await submit('client-ccc', obs);
console.log('client-ccc inserted:', JSON.stringify(r1));
const r2 = await submit('client-ddd', [obs[0]]);
console.log('client-ddd inserted:', JSON.stringify(r2));
const r3 = await submit('client-ccc', [obs[0]]); // idempotent re-record
console.log('client-ccc re-record (same id expected):', JSON.stringify(r3));

const consensus = await sql`
  SELECT node_id, result_notable_id, confirmations, verified
  FROM catalog_consensus WHERE seed = 5123 ORDER BY node_id`;
console.log('consensus seed 5123:', JSON.stringify(consensus));
