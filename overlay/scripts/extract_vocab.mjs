// Extracts the per-jewel RESULT-notable vocabulary the overlay matches OCR'd
// tooltip names against. The transformed node's tooltip header is one of a small,
// known set of names per jewel, so a closed-set fuzzy match resolves it even from
// noisy OCR — and the matched id (e.g. "kalguur_notable19") is exactly the DB's
// vocab_notables.id used for the eventual submission.
//
// Reads notables.json (keyed by jewel id) + jewels.json (id -> name) and writes
// src/poe2_vocab.json keyed by jewel NAME, matching the jewel string parsed from
// the in-game clipboard (JewelInfo.jewel).
//
// Run: node scripts/extract_vocab.mjs   (writes src/poe2_vocab.json)

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const DATA = join(here, '..', '..', 'frontend', 'static', 'data', 'poe2');
const NOTABLES = join(DATA, 'notables.json');
const JEWELS = join(DATA, 'jewels.json');
const OUT = join(here, '..', 'src', 'poe2_vocab.json');

const notablesById = JSON.parse(readFileSync(NOTABLES, 'utf8'));
const jewels = JSON.parse(readFileSync(JEWELS, 'utf8'));

const vocab = {};
for (const jewel of jewels) {
  const pool = notablesById[String(jewel.id)] ?? [];
  // Keep only id + name — stats aren't matched (name-only by design).
  vocab[jewel.name] = pool.map((n) => ({ id: n.id, name: n.name }));
}

writeFileSync(OUT, JSON.stringify(vocab, null, 0));
const counts = Object.entries(vocab)
  .map(([k, v]) => `${k}=${v.length}`)
  .join(', ');
console.log(`wrote ${OUT}: ${counts}`);
