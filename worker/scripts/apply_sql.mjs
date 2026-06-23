// Apply a .sql file to a Neon database. Used to seed the reference tables from
// reference_seed.sql. Uses the WebSocket Client (simple query protocol) so the whole
// multi-statement file runs in one round trip.
//
// Run: DATABASE_URL=postgres://... node scripts/apply_sql.mjs scripts/reference_seed.sql

import { Client, neonConfig } from '@neondatabase/serverless';
import ws from 'ws';
import { readFileSync } from 'node:fs';

neonConfig.webSocketConstructor = ws;

const url = process.env.DATABASE_URL;
const file = process.argv[2];
if (!url) throw new Error('DATABASE_URL env var is required');
if (!file) throw new Error('usage: node scripts/apply_sql.mjs <file.sql>');

const sql = readFileSync(file, 'utf8');
const client = new Client(url);
await client.connect();
try {
  await client.query(sql);
  console.log(`applied ${file}`);
} finally {
  await client.end();
}
