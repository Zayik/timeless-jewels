// Extracts per-socket LOCAL SUBGRAPHS (nodes + edges) from the full PoE2 tree
// export, for socket identification by graph/constellation matching.
//
// Unlike extract_tree.mjs (which keeps only notables for highlighting), this keeps
// EVERY renderable node within R_tree of each jewel socket plus the edges among
// them. Node icon art changes under a timeless jewel, but node POSITIONS and the
// connector EDGES do not — that stable geometry is what we match against a screen
// capture to decide which of the 12 jewel sockets a detected ring belongs to.
//
// Run: node scripts/extract_graphs.mjs   (writes src/poe2_socket_graphs.json)

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const DATA = join(here, '..', '..', 'frontend', 'static', 'data', 'poe2', 'data.json');
const OUT = join(here, '..', 'src', 'poe2_socket_graphs.json');

// Keep in sync with R_TREE in extract_tree.mjs / POE2_JEWEL_RADIUS.
// 1800 = PoE2 "Very Large" radius (1500 base × 1.2), in GGG tree units.
const R_TREE = 1800;
// Include nodes slightly past the ring so edges crossing the rim are kept; far
// endpoints get clipped at scoring time anyway.
const MARGIN = 1.15;

const tree = JSON.parse(readFileSync(DATA, 'utf8'));
const nodes = tree.nodes;

const isRenderable = (n) =>
  n && typeof n.x === 'number' && typeof n.y === 'number' && !n.isProxy && !n.isMastery;

const round = (v) => Math.round(v * 10) / 10;

const sockets = [];
for (const [key, n] of Object.entries(nodes)) {
  if (key === 'root' || !n?.isJewelSocket || typeof n.x !== 'number') continue;
  // Only real timeless-jewel sockets ("jewel_slot####"). Excludes the "voices_jewel_slot*"
  // Sinister cluster sockets, Zarokh's Gift (DeliriumAnoint_ZarokhsGift_), and ascendancy
  // sockets (AscendancyWitch*) — none can hold a timeless jewel, and leaving them in made the
  // detector lock onto e.g. Zarokh's Gift instead of the real socket.
  if (typeof n.id !== 'string' || !n.id.startsWith('jewel_slot')) continue;

  const reach = R_TREE * MARGIN;
  // Collect in-reach renderable nodes (exclude the socket itself & other sockets,
  // which render as empty frames, not constellation discs).
  const local = new Map(); // skill -> {x,y}
  for (const [k2, m] of Object.entries(nodes)) {
    if (k2 === 'root' || !isRenderable(m) || m.isJewelSocket) continue;
    if (Math.hypot(m.x - n.x, m.y - n.y) > reach) continue;
    local.set(String(m.skill), { x: round(m.x), y: round(m.y) });
  }

  // Edges among in-reach nodes, from each node's adjacency (out). Dedupe undirected.
  const seen = new Set();
  const edges = [];
  for (const skill of local.keys()) {
    const m = nodes[skill];
    for (const to of m.out ?? []) {
      if (!local.has(String(to))) continue;
      const a = Number(skill);
      const b = Number(to);
      const ek = a < b ? `${a}_${b}` : `${b}_${a}`;
      if (seen.has(ek)) continue;
      seen.add(ek);
      const p = local.get(skill);
      const q = local.get(String(to));
      edges.push([p.x, p.y, q.x, q.y]);
    }
  }

  // Node positions as a flat list (positions are the constellation; identity drops out).
  const pts = [...local.values()].map((p) => [p.x, p.y]);

  sockets.push({
    socketId: n.skill,
    id: n.id ?? String(n.skill),
    x: round(n.x),
    y: round(n.y),
    nodes: pts,
    edges
  });
}

sockets.sort((a, b) => a.x - b.x || a.y - b.y);
const out = { rTree: R_TREE, sockets };
writeFileSync(OUT, JSON.stringify(out, null, 0));
console.log(
  `wrote ${OUT}: ${sockets.length} sockets, ` +
    `${sockets.reduce((s, x) => s + x.nodes.length, 0)} nodes, ` +
    `${sockets.reduce((s, x) => s + x.edges.length, 0)} edges, R_tree=${R_TREE}`
);
