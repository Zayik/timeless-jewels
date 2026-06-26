// Extracts a compact per-socket dataset from the full PoE2 tree export so the
// overlay can project affected nodes without bundling the 3.4MB data.json.
//
// For each jewel socket it records the socket's tree coords plus every notable
// (and keystone) within R_tree of it — each with skill id, tree x/y, and name.
// The overlay turns these into screen positions at runtime via the ring transform.
//
// Run: node scripts/extract_tree.mjs   (writes src/poe2_sockets.json)

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const DATA = join(here, '..', '..', 'frontend', 'static', 'data', 'poe2', 'data.json');
const OUT = join(here, '..', 'src', 'poe2_sockets.json');

// Keep in sync with POE2_JEWEL_RADIUS in frontend/src/lib/poe2/skill_tree_adapter.ts.
// Authoritative PoE2 "Very Large" jewel radius: base 1500 × the 1.2
// PassiveTreeJewelDistanceMultiplier = 1800 tree units (PoB-PoE2 src/Modules/Data.lua
// + src/Data/Misc.lua), in the same units as GGG's node x/y. 1765 was an under-estimate
// that dropped rim notables (e.g. Expendable Army @1775, Well of Power @1787).
const R_TREE = 1800;

const tree = JSON.parse(readFileSync(DATA, 'utf8'));
const nodes = tree.nodes;

const isRenderable = (n) =>
  n && typeof n.x === 'number' && typeof n.y === 'number' && !n.isProxy && !n.isMastery;

// Druid-Oracle-only nodes (the Ascendancy "The Unseen Path", skill 5571, lets a Druid Oracle
// allocate them) are physically on the main tree, so they fall inside jewel radii — but a
// non-Oracle character can't allocate or even see them. Flag them so the overlay can skip them
// for players who aren't a Druid Oracle (it would otherwise show targets they can never capture).
const UNSEEN_PATH_SKILL = 5571;
const isOracleOnly = (n) =>
  Array.isArray(n.unlockConstraint?.nodes) && n.unlockConstraint.nodes.includes(UNSEEN_PATH_SKILL);

const sockets = [];
for (const [key, n] of Object.entries(nodes)) {
  if (key === 'root' || !n?.isJewelSocket || typeof n.x !== 'number') continue;
  // Only real timeless-jewel sockets, whose ids are "jewel_slot####". Other isJewelSocket
  // nodes — the "voices_jewel_slot*" Sinister cluster sockets, Zarokh's Gift
  // (DeliriumAnoint_ZarokhsGift_), and ascendancy sockets (AscendancyWitch*) — can't take a
  // timeless jewel and must not be detection candidates or they get matched by mistake.
  if (typeof n.id !== 'string' || !n.id.startsWith('jewel_slot')) continue;

  const affected = [];
  for (const [k2, m] of Object.entries(nodes)) {
    if (k2 === 'root' || !isRenderable(m) || m.isJewelSocket) continue;
    const d = Math.hypot(m.x - n.x, m.y - n.y);
    if (d > R_TREE) continue;
    // Only notables are recorded. Keystones never change under a PoE2 jewel
    // regardless of seed, so there's nothing to capture for them.
    if (!m.isNotable) continue;
    affected.push({
      skill: m.skill,
      // String node id (e.g. "Sprint10") — the community DB's tree_notables.node_id and
      // the identifier the overlay submits for an observation. Distinct from the numeric
      // graph `skill`. The website maps node_id -> skill on read.
      id: m.id ?? '',
      x: Math.round(m.x * 10) / 10,
      y: Math.round(m.y * 10) / 10,
      name: m.name ?? '',
      kind: 'notable',
      // Present (true) only for Druid-Oracle-only nodes; omitted otherwise to keep the JSON small.
      ...(isOracleOnly(m) ? { oracleOnly: true } : {})
    });
  }
  affected.sort((a, b) => Math.hypot(a.x - n.x, a.y - n.y) - Math.hypot(b.x - n.x, b.y - n.y));
  sockets.push({
    socketId: n.skill,
    id: n.id ?? String(n.skill),
    x: Math.round(n.x * 10) / 10,
    y: Math.round(n.y * 10) / 10,
    notables: affected
  });
}

sockets.sort((a, b) => a.x - b.x || a.y - b.y);
const out = { rTree: R_TREE, sockets };
writeFileSync(OUT, JSON.stringify(out, null, 0));
console.log(
  `wrote ${OUT}: ${sockets.length} sockets, ` +
    `${sockets.reduce((s, x) => s + x.notables.length, 0)} notable links, R_tree=${R_TREE}`
);
