// Adapts GGG's PoE2 passive-tree export into the in-memory shapes the (PoE1)
// SkillTree renderer consumes, so the canvas component is reused unchanged.
//
// PoE2's export (static/data/poe2/data.json + assets/*.{webp,json}) differs from
// PoE1's SkillTree.json:
//   - nodes carry ABSOLUTE x/y coordinates (no orbit math needed for placement),
//   - sprites live in TexturePacker-style atlases ("frames": {"cat:icon": {frame}})
//     split across skills(.json/.webp), skills-disabled, frame, group-background,
//   - there is no `sprites`/`constants`/`assets` block.
// This module fetches those files and produces: a SkillTreeData-shaped object plus
// inverseSprites / inverseSpritesActive maps keyed exactly how drawSprite() looks
// sprites up (by node.icon path and by named frame).

import type { Node, Group, Sprite, SkillTreeData, Coord } from '../skill_tree_types';

interface AtlasFrame {
  frame: Coord;
}
interface Atlas {
  frames: Record<string, AtlasFrame>;
  meta: { image: string; scale: string; size: { w: number; h: number } };
}

// A raw edge from the PoE2 export. `orbitX`/`orbitY` (present only on curved
// connections) give the centre of the arc the connector follows; their absence
// means a straight line. This is authoritative — connector shape must NOT be
// re-derived from the two nodes' group/orbit (arcs routinely cross groups).
interface RawEdge {
  from: number | string;
  to: number | string;
  orbit?: number;
  orbitX?: number;
  orbitY?: number;
}

/** A renderable connection. `cx`/`cy` = arc centre (tree coords); absent = line. */
export interface Poe2Connection {
  from: number;
  to: number;
  cx?: number;
  cy?: number;
}

/**
 * A decorative effect backdrop to draw, plus the notables whose enabled state
 * decides whether it shows its lit or disabled graphic. For a mastery these are
 * the notables it is wired to (its `in`/`out` edge targets); for a notable that
 * carries its own pattern (e.g. Overexposure) it is just that notable itself.
 * The backdrop is lit when ANY governing notable is enabled, dim when ALL are
 * disabled.
 */
export interface Poe2EffectNode {
  node: Node;
  notableSkills: number[];
}

export interface Poe2TreeBundle {
  skillTree: SkillTreeData;
  drawnNodes: Record<number, Node>;
  drawnGroups: Record<number, Group>;
  connections: Poe2Connection[];
  // Nodes that carry a decorative effect backdrop (activeEffectImage = a
  // MasteryXxxPattern): standalone masteries AND notables/smalls that sit in a
  // themed cluster. Drawn as a glow behind the node (notables also still render
  // their normal icon/frame from drawnNodes). Each carries the notables that
  // govern its lit/dim state (see Poe2EffectNode).
  effectNodes: Poe2EffectNode[];
  inverseSprites: Record<string, Sprite>;
  inverseSpritesActive: Record<string, Sprite>;
}

// Median PoE2 node spacing is ~264 tree units; frames are 51px (small) / 76px
// (notable) / 109px (keystone). At 2.8 the notable/keystone frames ran ~0.8-1.2x
// the spacing and overlapped neighbours (and obscured the short orbit arcs between
// them). 2.3 keeps notables ~0.66x spacing with clear gaps; the GGG frame size
// ratio (kept intact) makes smalls correspondingly smaller, as in the real tree.
export const POE2_SPRITE_DRAW_SCALE = 2.3;
// Per-type fine-tuning on top of the global scale (matched against poeplanner.com/poe2):
// notables read a touch large at the GGG frame ratio, masteries' effect backdrop a
// touch small, so nudge them. 1 = no change. Applied to the notable icon+frame and to
// the mastery effect backdrop respectively in SkillTree.svelte.
export const POE2_NOTABLE_DRAW_SCALE = 0.9;
export const POE2_MASTERY_EFFECT_SCALE = 1.15;
// Empty jewel-socket frame art (static/data/Jewel/JewelSocket_*.png — the beveled ring
// with 8 studs, hollow centre). Drawn for ALL jewel sockets in place of the generic 76px
// JewelFrame. Multiplier on top of the global draw scale, applied to the jewel-socket
// frame sprite in pixi_tree.ts. Sized so the socket renders ~the same diameter as a
// notable: the PNG's opaque content is ~139px vs the notable frame's 76px (×0.9 notable
// scale), so 139·s ≈ 76·0.9 → s ≈ 0.49. 1 = no change.
export const POE2_SOCKET_DRAW_SCALE = 0.49;
// Sprite keys for the empty-socket frames, mapped to their PNG file. The selected
// (allocated) socket uses the gold variant; every other socket uses the dim one.
export const POE2_SOCKET_FRAME_UNALLOCATED = 'JewelSocket_Unallocated';
export const POE2_SOCKET_FRAME_ALLOCATED = 'JewelSocket_Allocated';
const POE2_SOCKET_FRAME_FILES: Record<string, string> = {
  [POE2_SOCKET_FRAME_UNALLOCATED]: 'JewelSocket_Unallocated.png',
  [POE2_SOCKET_FRAME_ALLOCATED]: 'JewelSocket_Allocated.png'
};
const POE2_SOCKET_FRAME_SIZE = { w: 152, h: 156 };
// PoE2 timeless jewel radius, in tree-coordinate units. This is the authoritative
// "Very Large" radius: base 1500 × the 1.2 PassiveTreeJewelDistanceMultiplier = 1800,
// per PoB-PoE2 (src/Modules/Data.lua + src/Data/Misc.lua), in the same units as GGG's
// node x/y. Matches the in-game ring calibration (Heroic Tragedy measured ~1798). The
// earlier 1765 estimate was slightly too small and dropped rim notables (e.g. Expendable
// Army @1775, Well of Power @1787); the prior 2800 guess over-included ~3x.
export const POE2_JEWEL_RADIUS = 1800;

const fetchJson = async <T>(url: string): Promise<T> => {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to load ${url}: ${res.statusText}`);
  }
  return res.json() as Promise<T>;
};

/**
 * Build one Sprite-sheet object from an atlas and index every frame into `target`.
 * `keyOf` maps an atlas frame key ("normalActive:Art/.../x.png") to the lookup key
 * drawSprite() will use (the bare icon path, or the bare frame name).
 */
const indexAtlas = (
  atlas: Atlas,
  filename: string,
  keyOf: (frameKey: string) => string | undefined,
  target: Record<string, Sprite>
): void => {
  const sheet: Sprite = { filename, coords: {} };
  for (const [frameKey, value] of Object.entries(atlas.frames)) {
    const key = keyOf(frameKey);
    if (key === undefined) {
      continue;
    }
    sheet.coords[key] = value.frame;
    target[key] = sheet;
  }
};

const afterColon = (s: string): string => {
  const i = s.indexOf(':');
  return i >= 0 ? s.slice(i + 1) : s;
};

const isRenderableNode = (node: Node): boolean => {
  if (node.x === undefined || node.y === undefined) {
    return false;
  }
  if (node.isProxy) {
    return false;
  }
  if ('classStartIndex' in node) {
    return false;
  }
  if (node.isAscendancyStart) {
    return false;
  }
  // PoE2 marks ascendancy nodes with ascendancyId; PoE1 used ascendancyName.
  if (node.ascendancyName || (node as { ascendancyId?: string }).ascendancyId) {
    return false;
  }
  // Masteries aren't transformed or searched by this tool, and their icons live in
  // a separate atlas we don't load — drawing them produced empty "+" line-crosses.
  // Dropping them also drops the connection lines that pointed at them.
  if (node.isMastery) {
    return false;
  }
  return true;
};

export async function buildPoe2Tree(basePath = ''): Promise<Poe2TreeBundle> {
  const dir = `${basePath}/data/poe2`;
  const assets = `${dir}/assets`;

  const [tree, skillsActive, skillsInactive, frame, groupBg, masteryActive, masteryDisabled] = await Promise.all([
    fetchJson<SkillTreeData>(`${dir}/data.json`),
    fetchJson<Atlas>(`${assets}/skills.json`),
    fetchJson<Atlas>(`${assets}/skills-disabled.json`),
    fetchJson<Atlas>(`${assets}/frame.json`),
    fetchJson<Atlas>(`${assets}/group-background.json`),
    fetchJson<Atlas>(`${assets}/mastery-effect-active.json`),
    fetchJson<Atlas>(`${assets}/mastery-effect-disabled.json`)
  ]);

  // Active node icons -> skills.webp; everything drawn with active=false
  // (inactive icons, frames, group backgrounds) -> the inactive map.
  const inverseSpritesActive: Record<string, Sprite> = {};
  const inverseSprites: Record<string, Sprite> = {};

  // Node icons: strip the "normalActive:"/"notableActive:"/"keystoneActive:" prefix
  // so the key is the bare node.icon path that drawSprite() passes.
  indexAtlas(skillsActive, `${assets}/skills.webp`, afterColon, inverseSpritesActive);
  indexAtlas(skillsInactive, `${assets}/skills-disabled.webp`, afterColon, inverseSprites);
  // Frames: "frame:KeystoneFrameAllocated" -> "KeystoneFrameAllocated".
  indexAtlas(frame, `${assets}/frame.webp`, afterColon, inverseSprites);
  // Group backgrounds: "startNode:MainCircle" -> "MainCircle" (PoE1's named
  // PSGroupBackground1/2/3 simply don't exist here; drawSprite skips missing ones).
  indexAtlas(groupBg, `${assets}/group-background.webp`, afterColon, inverseSprites);
  // Mastery effect backdrops, keyed by the node's activeEffectImage path. The lit
  // version goes in the active map, the dim version in the inactive map, so a single
  // drawSprite(path, active) picks the right one.
  indexAtlas(masteryActive, `${assets}/mastery-effect-active.webp`, afterColon, inverseSpritesActive);
  indexAtlas(masteryDisabled, `${assets}/mastery-effect-disabled.webp`, afterColon, inverseSprites);
  // Empty jewel-socket frames: each is a standalone PNG (no atlas), registered as a
  // single full-image "frame" so drawSprite/getTexture treat it like any other sprite.
  // Both go in the inactive map; the renderer picks allocated vs unallocated by socket.
  for (const [key, file] of Object.entries(POE2_SOCKET_FRAME_FILES)) {
    inverseSprites[key] = { filename: `${basePath}/data/Jewel/${file}`, coords: { [key]: { x: 0, y: 0, ...POE2_SOCKET_FRAME_SIZE } } };
  }

  // Constants: node positions come from absolute x/y so these only affect the
  // same-group/same-orbit connection arcs and orbit angle math. Provide generous
  // arrays so nothing is undefined/NaN.
  const skillTree: SkillTreeData = {
    ...tree,
    sprites: {} as SkillTreeData['sprites'],
    constants: {
      ...(tree.constants ?? {}),
      skillsPerOrbit: [1, 6, 16, 16, 40, 72, 72, 72, 72, 72],
      orbitRadii: [0, 82, 162, 335, 493, 662, 846, 1000, 1200, 1400]
    } as SkillTreeData['constants']
  };

  const drawnNodes: Record<number, Node> = {};
  const drawnGroups: Record<number, Group> = {};
  for (const [groupId, group] of Object.entries(tree.groups)) {
    let groupHasDrawn = false;
    for (const nodeId of group.nodes) {
      const node = tree.nodes[nodeId];
      if (!node || !isRenderableNode(node)) {
        continue;
      }
      drawnNodes[parseInt(nodeId)] = node;
      groupHasDrawn = true;
    }
    if (groupHasDrawn) {
      drawnGroups[parseInt(groupId)] = group;
    }
  }

  // Connections come straight from the export's edge list (authoritative arc info),
  // not re-derived from node geometry. Keep only edges between drawn nodes, deduped.
  const rawEdges = (tree as unknown as { edges?: RawEdge[] }).edges ?? [];
  const connections: Poe2Connection[] = [];
  const seenPair = new Set<string>();
  for (const e of rawEdges) {
    const from = typeof e.from === 'number' ? e.from : parseInt(e.from);
    const to = typeof e.to === 'number' ? e.to : parseInt(e.to);
    if (!Number.isFinite(from) || !Number.isFinite(to)) {
      continue; // skips the synthetic 'root' edges
    }
    if (!(from in drawnNodes) || !(to in drawnNodes)) {
      continue;
    }
    const key = from < to ? `${from}:${to}` : `${to}:${from}`;
    if (seenPair.has(key)) {
      continue;
    }
    seenPair.add(key);
    const conn: Poe2Connection = { from, to };
    if (typeof e.orbitX === 'number' && typeof e.orbitY === 'number') {
      // Explicit arc centre (used for arcs whose centre isn't the group centre,
      // e.g. cross-group arcs). Takes precedence — 271 of these differ from it.
      conn.cx = e.orbitX;
      conn.cy = e.orbitY;
    } else {
      // No explicit centre: the export omits it for "ordinary" arcs between two
      // nodes sharing a group AND orbit — those arc around their group centre.
      // Everything else is a straight line.
      const a = tree.nodes[String(from)];
      const b = tree.nodes[String(to)];
      if (a && b && a.group !== undefined && a.group === b.group && a.orbit !== undefined && a.orbit === b.orbit) {
        const g = tree.groups[String(a.group)];
        if (g) {
          conn.cx = g.x;
          conn.cy = g.y;
        }
      }
    }
    connections.push(conn);
  }

  // Effect backdrops: any node with an activeEffectImage (masteries + the themed
  // notables/smalls the export tags), excluding ascendancy areas we don't render.
  // Each backdrop's lit/dim state is governed by a set of notables: a mastery is
  // wired to its cluster's notables via in/out edges (e.g. Infusion Mastery's
  // in = [Everlasting Infusions, Empowering Infusions]); a notable that carries
  // its own pattern (e.g. Overexposure) governs only itself.
  const toSkill = (s: number | string): number => (typeof s === 'number' ? s : parseInt(s));
  const effectNodes: Poe2EffectNode[] = [];
  for (const node of Object.values(tree.nodes)) {
    const m = node as Node & {
      activeEffectImage?: string;
      ascendancyId?: string;
      unlockConstraint?: { ascendancy?: string };
    };
    if (
      !(
        m.activeEffectImage &&
        typeof m.x === 'number' &&
        typeof m.y === 'number' &&
        !m.ascendancyId &&
        !m.unlockConstraint?.ascendancy
      )
    ) {
      continue;
    }

    let notableSkills: number[];
    if (node.isMastery) {
      const connected = [...(node.in ?? []), ...(node.out ?? [])].map(toSkill);
      notableSkills = [...new Set(connected)].filter((s) => Number.isFinite(s) && tree.nodes[String(s)]?.isNotable);
    } else {
      notableSkills = typeof node.skill === 'number' ? [node.skill] : [];
    }

    effectNodes.push({ node, notableSkills });
  }

  return { skillTree, drawnNodes, drawnGroups, connections, effectNodes, inverseSprites, inverseSpritesActive };
}
