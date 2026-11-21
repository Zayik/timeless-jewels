// Abyss jewel conquest walks, ported from upstream calculator/abyss_region.go and
// calculator/abyss_ascendancy.go (Vilsol/timeless-jewels), which are themselves ported from
// abyssRegion / abyssAscendancyNotable and scripts/build-abyss-*.mjs in
// https://github.com/Parazeya/abyss-jewels, used under the MIT License:
//
// Copyright (c) 2026 poeqol.com
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.
//
// Unlike legion jewels, Abyss jewels do not conquer a fixed radius. The four socket-keyed
// jewels (Tecrod, Ulaman, Kurgal, Amanamu) conquer a seed-dependent region grown outward from
// the socket; Zorath (Reclaimed Malevolence) conquers one ascendancy notable. Each conquered
// node's modification is then the ordinary Calculate on that node's passive skill.

import { NumberGenerator } from './random';
import { JewelType, TIMELESS_JEWEL_SEED_RANGES } from './data';

// The subset of the skill tree export's node shape these walks read.
export interface AbyssTreeNode {
  skill?: number;
  in?: string[];
  out?: string[];
  stats?: string[];
  isMastery?: boolean;
  classStartIndex?: number;
  isJewelSocket?: boolean;
  isNotable?: boolean;
  isProxy?: boolean;
  expansionJewel?: { parent?: string };
  ascendancyName?: string;
  isAscendancyStart?: boolean;
  isMultipleChoice?: boolean;
  isMultipleChoiceOption?: boolean;
}

export type AbyssTreeNodes = Record<string, AbyssTreeNode>;

interface AbyssRegionNode {
  links: number[];
  weight: number;
  conquerable: boolean;
}

interface AbyssRegionGraph {
  nodes: Map<number, AbyssRegionNode>;
  sockets: Set<number>;
}

interface AbyssAscendancyNode {
  ascendancy: string; // "" for a class start
  links: number[];
  collectable: boolean;
}

interface AbyssAscendancyGraph {
  rootEdges: number[];
  classStart: Map<string, number>;
  nodes: Map<number, AbyssAscendancyNode>;
}

// ---- Shared helpers ----

// In-edges then out-edges, in the tree's own order: the draw indexes the frontier.
function links(n: AbyssTreeNode): number[] {
  return [...parseGraphIDs(n.in ?? []), ...parseGraphIDs(n.out ?? [])];
}

function parseGraphIDs(ids: string[]): number[] {
  return ids.map((s) => {
    const v = Number(s);
    if (!Number.isInteger(v) || v < 0 || v > 0xffffffff) {
      throw new Error(`timeless-jewels: bad skill tree edge ${JSON.stringify(s)}`);
    }
    return v;
  });
}

function bySkillID(treeNodes: AbyssTreeNodes): Map<number, AbyssTreeNode> {
  const bySkill = new Map<number, AbyssTreeNode>();
  for (const n of Object.values(treeNodes)) {
    if (n.skill !== undefined && n.skill !== null) {
      bySkill.set(n.skill, n);
    }
  }
  return bySkill;
}

// Both graphs are rebuilt only when a different tree object is passed in.
let cachedTree: AbyssTreeNodes | undefined;
let cachedRegion: AbyssRegionGraph | undefined;
let cachedAscendancy: AbyssAscendancyGraph | undefined;

function ensureTree(treeNodes: AbyssTreeNodes) {
  if (cachedTree !== treeNodes) {
    cachedTree = treeNodes;
    cachedRegion = undefined;
    cachedAscendancy = undefined;
  }
}

// ---- Socket-keyed region (Tecrod, Ulaman, Kurgal, Amanamu) ----

// Attempts, not conquered passives: the jewel's passive_tree_abyss_size, which PoB's ABYS
// header also stores.
const ABYSS_REGION_SIZE = 60;

const ABYSS_WEIGHT_NOTABLE = 25;
const ABYSS_WEIGHT_ATTRIBUTE = 1;
const ABYSS_WEIGHT_OTHER = 5;

// A small passive whose only stat is +N to one attribute.
const ABYSS_ATTRIBUTE_STAT = /^\+\d+ to (Strength|Dexterity|Intelligence)$/;

// The hidden cluster-jewel structure: walkable, never conquerable. An attempt that lands on it
// is spent, which is what cuts the six sockets bordering it short.
function abyssScaffolding(n: AbyssTreeNode): boolean {
  return (
    !!n.isProxy || (!!n.expansionJewel && n.expansionJewel.parent !== undefined && n.expansionJewel.parent !== null)
  );
}

function buildAbyssRegionGraph(treeNodes: AbyssTreeNodes): AbyssRegionGraph {
  const bySkill = bySkillID(treeNodes);

  // Masteries and class starts are never pushed onto the frontier, so leaving them out of the
  // lists is the same as filtering them during the walk.
  const walkable = (id: number): boolean => {
    const n = bySkill.get(id);
    return !!n && !n.isMastery && (n.classStartIndex === undefined || n.classStartIndex === null);
  };

  const graph: AbyssRegionGraph = { nodes: new Map(), sockets: new Set() };
  for (const [id, n] of bySkill) {
    if (!walkable(id)) {
      continue;
    }
    const notAscendancy = n.ascendancyName === undefined || n.ascendancyName === null;
    let weight = ABYSS_WEIGHT_OTHER;
    if (n.isNotable) {
      weight = ABYSS_WEIGHT_NOTABLE;
    } else if (n.stats && n.stats.length === 1 && ABYSS_ATTRIBUTE_STAT.test(n.stats[0])) {
      weight = ABYSS_WEIGHT_ATTRIBUTE;
    }
    graph.nodes.set(id, {
      links: links(n).filter(walkable),
      weight,
      conquerable: !n.isJewelSocket && !abyssScaffolding(n) && notAscendancy
    });

    if (n.isJewelSocket && !abyssScaffolding(n) && notAscendancy) {
      graph.sockets.add(id);
    }
  }
  return graph;
}

/**
 * The graph ids of the passives a socket-keyed Abyss jewel (Tecrod through Amanamu) conquers
 * for a seed, in the order the game draws them, which is also PoB's record order. Returns
 * undefined when the jewel type, seed or socket has no region. The region does not depend on
 * which of the four jewels it is.
 *
 * Each node's modification is Calculate on that node's passive skill, and Calculate takes the
 * passive's Index, not its graph id: map through TreeToPassive first.
 */
export function abyssConqueredNodes(
  treeNodes: AbyssTreeNodes,
  socketID: number,
  seed: number,
  jewelType: number
): number[] | undefined {
  if (jewelType < JewelType.AbyssTecrod || jewelType > JewelType.AbyssAmanamu) {
    return undefined;
  }
  const seeds = TIMELESS_JEWEL_SEED_RANGES[jewelType];
  if (!seeds || seed < seeds.Min || seed > seeds.Max) {
    return undefined;
  }
  ensureTree(treeNodes);
  if (!cachedRegion) {
    cachedRegion = buildAbyssRegionGraph(treeNodes);
  }
  const graph = cachedRegion;
  if (!graph.sockets.has(socketID)) {
    return undefined;
  }

  const rng = new NumberGenerator();
  rng.ResetAbyss(socketID, seed);

  // The socket is never marked visited: from the second draw it is an ordinary neighbour
  // again, and can come back and be drawn twice.
  const visited = new Set<number>();
  const frontier: { id: number; weight: number }[] = [{ id: socketID, weight: 1 }];
  let total = 1;
  const conquered: number[] = [];

  for (let attempt = 0; attempt < ABYSS_REGION_SIZE && frontier.length > 0; attempt++) {
    let roll = rng.GenerateSingle(total);
    let i = 0;
    for (; i < frontier.length - 1; i++) {
      if (frontier[i].weight > roll) {
        break;
      }
      roll -= frontier[i].weight;
    }
    const picked = frontier[i];
    total -= picked.weight;
    // In place: the order of the rest is what the next draw indexes.
    frontier.splice(i, 1);

    const pickedNode = graph.nodes.get(picked.id)!;
    for (const o of pickedNode.links) {
      if (visited.has(o)) {
        continue;
      }
      visited.add(o);
      const w = graph.nodes.get(o)!.weight;
      total += w;
      frontier.push({ id: o, weight: w });
    }

    // A socket or the cluster-jewel scaffolding still spends the attempt.
    if (pickedNode.conquerable) {
      conquered.push(picked.id);
    }
  }
  return conquered;
}

// ---- Zorath's ascendancy notable (Reclaimed Malevolence) ----

// Notables costing this many ascendancy points or more are walked through, never taken, which
// is why Ascendant (every notable costs five) loses nothing.
const ABYSS_ASCENDANCY_MAX_COST = 4;

function buildAbyssAscendancyGraph(treeNodes: AbyssTreeNodes): AbyssAscendancyGraph {
  const bySkill = bySkillID(treeNodes);

  // An ordinary ascendancy start hangs off its class start; the alternate ones have no
  // in-edges. The tree's root lists only the class starts and the alternates, so the ordinary
  // starts are appended, in id order.
  const ordinaryStarts: number[] = [];
  for (const [id, n] of bySkill) {
    if (n.isAscendancyStart && (n.in?.length ?? 0) > 0) {
      ordinaryStarts.push(id);
    }
  }
  ordinaryStarts.sort((a, b) => a - b);

  const graph: AbyssAscendancyGraph = {
    rootEdges: [...parseGraphIDs(treeNodes.root?.out ?? []), ...ordinaryStarts],
    classStart: new Map(),
    nodes: new Map()
  };

  const keep = new Set<number>();
  for (const id of ordinaryStarts) {
    const n = bySkill.get(id)!;
    const bridge = parseGraphIDs(n.in!.slice(0, 1))[0];
    graph.classStart.set(n.ascendancyName!, bridge);
    keep.add(bridge);
  }
  for (const [id, n] of bySkill) {
    if (n.ascendancyName !== undefined && n.ascendancyName !== null) {
      keep.add(id);
    }
  }

  // Ascendancy points to allocate a node, counted from its own start.
  const cost = new Map<number, number>();
  for (const start of ordinaryStarts) {
    const name = bySkill.get(start)!.ascendancyName;
    cost.set(start, 0);
    const queue = [start];
    for (let head = 0; head < queue.length; head++) {
      for (const o of links(bySkill.get(queue[head])!)) {
        const t = bySkill.get(o);
        if (cost.has(o) || !t || t.ascendancyName === undefined || t.ascendancyName !== name) {
          continue;
        }
        cost.set(o, cost.get(queue[head])! + 1);
        queue.push(o);
      }
    }
  }

  for (const id of keep) {
    const n = bySkill.get(id);
    if (!n) {
      // Go reads a zero-value Node here; it has no links and is never collectable.
      graph.nodes.set(id, { ascendancy: '', links: [], collectable: false });
      continue;
    }
    const c = cost.get(id);
    graph.nodes.set(id, {
      ascendancy: n.ascendancyName ?? '',
      links: links(n),
      collectable:
        !!n.isNotable &&
        !n.isMultipleChoice &&
        !n.isMultipleChoiceOption &&
        !n.isAscendancyStart &&
        c !== undefined &&
        c < ABYSS_ASCENDANCY_MAX_COST
    });
  }
  return graph;
}

/**
 * The graph id of the ascendancy notable Reclaimed Malevolence (Abyss Zorath) conquers for a
 * seed, or undefined when it conquers none. `ascendancy` is the tree's internal name
 * ("Raider", not "Warden"). The socket plays no part. The replacement itself is Calculate on
 * that notable's passive skill.
 */
export function abyssAscendancyNotable(
  treeNodes: AbyssTreeNodes,
  seed: number,
  ascendancy: string
): number | undefined {
  if (!ascendancy) {
    return undefined;
  }
  ensureTree(treeNodes);
  if (!cachedAscendancy) {
    cachedAscendancy = buildAbyssAscendancyGraph(treeNodes);
  }
  const graph = cachedAscendancy;
  const bridge = graph.classStart.get(ascendancy);

  const rng = new NumberGenerator();
  rng.ResetSingle(seed);

  const ROOT = 0xffffffff;
  const visited = new Set<number>();
  const frontier: number[] = [ROOT];
  for (let guard = 0; guard < 500 && frontier.length > 0; guard++) {
    const i = rng.GenerateSingle(frontier.length);
    const g = frontier[i];
    frontier.splice(i, 1);

    const edges = g === ROOT ? graph.rootEdges : graph.nodes.get(g)!.links;
    for (const t of edges) {
      if (visited.has(t)) {
        continue;
      }
      visited.add(t);
      const node = graph.nodes.get(t);
      if (!node) {
        continue;
      }
      if (bridge !== undefined && t === bridge) {
        frontier.push(t);
        continue;
      }
      if (node.ascendancy !== ascendancy) {
        continue;
      }
      if (node.collectable) {
        return t;
      }
      frontier.push(t);
    }
  }
  return undefined;
}
