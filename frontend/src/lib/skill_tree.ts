import type { Translation, Node, SkillTreeData, Group, Sprite, TranslationFile } from './skill_tree_types';
import type { PassiveSkill } from './calculator/types';
import { data } from './types';
import { treeToPassive } from './calculator/data';
import {
  buildPoe2Tree,
  POE2_JEWEL_RADIUS,
  POE2_SPRITE_DRAW_SCALE,
  type Poe2Connection,
  type Poe2EffectNode
} from './poe2/skill_tree_adapter';

const SPRITE_SCALE = '0.3835';

export let skillTree: SkillTreeData;

export const drawnGroups: Record<number, Group> = {};
export const drawnNodes: Record<number, Node> = {};

export const inverseSprites: Record<string, Sprite> = {};
export const inverseSpritesActive: Record<string, Sprite> = {};

export const inverseTranslations: Record<string, Translation> = {};

export const passiveToTree: Record<number, number> = {};

// `let` (not const) so the PoE2 loader can widen the radius for PoE2's jewels.
export let baseJewelRadius = 1800;

// Display scale applied to sprite source rects in SkillTree.svelte's drawSprite.
// PoE1 default is 2.6; the PoE2 loader retunes it for PoE2 atlas/spacing.
export let spriteDrawScale = 2.6;

// PoE2 skill icons are opaque square images (the art has a square background), so
// they must be clipped to a circle to read as round nodes (PoE1 icons are
// transparent glyphs and don't need this). The PoE2 loader turns this on.
export let clipNodeIcons = false;

// PoE2 connector list (from the export's edge data). When non-empty the renderer
// drives connections from this (authoritative arc/line info) instead of PoE1's
// node.out + group/orbit geometry. Empty for PoE1.
export let connections: Poe2Connection[] = [];

// When true, the node tooltip appends raw node data (id, group, orbit, …) for
// debugging the PoE2 tree. Off for PoE1.
export let debugNodeInfo = false;

// PoE2 effect-backdrop nodes (decorative): masteries + themed notables/smalls, each
// with activeEffectImage = a pattern drawn behind it. Lit when one of its governing
// notables is in the jewel radius and enabled, dim when all are disabled or out of
// radius (see Poe2EffectNode). Empty for PoE1.
export let effectNodes: Poe2EffectNode[] = [];

function indexSprites(sprite: Sprite, map: Record<string, Sprite>): void {
  Object.keys(sprite.coords).forEach((c) => (map[c] = sprite));
}

export const loadSkillTree = () => {
  skillTree = JSON.parse(data.SkillTree);
  console.log('Loaded skill tree', skillTree);

  Object.keys(skillTree.groups).forEach((groupId) => {
    const group = skillTree.groups[groupId];
    group.nodes.forEach((nodeId) => {
      const node = skillTree.nodes[nodeId];

      // Do not care about proxy passives
      if (node.isProxy) {
        return;
      }

      // Do not care about class starting nodes
      if ('classStartIndex' in node) {
        return;
      }

      // Do not care about cluster jewels
      if (node.expansionJewel) {
        if (node.expansionJewel.parent) {
          return;
        }
      }

      // Do not care about blighted nodes
      if (node.isBlighted) {
        return;
      }

      // Do not care about ascendancies
      if (node.ascendancyName) {
        return;
      }

      drawnGroups[parseInt(groupId)] = group;
      drawnNodes[parseInt(nodeId)] = node;
    });
  });

  indexSprites(skillTree.sprites.keystoneInactive[SPRITE_SCALE], inverseSprites);
  indexSprites(skillTree.sprites.notableInactive[SPRITE_SCALE], inverseSprites);
  indexSprites(skillTree.sprites.normalInactive[SPRITE_SCALE], inverseSprites);
  indexSprites(skillTree.sprites.masteryInactive[SPRITE_SCALE], inverseSprites);

  indexSprites(skillTree.sprites.keystoneActive[SPRITE_SCALE], inverseSpritesActive);
  indexSprites(skillTree.sprites.notableActive[SPRITE_SCALE], inverseSpritesActive);
  indexSprites(skillTree.sprites.normalActive[SPRITE_SCALE], inverseSpritesActive);
  indexSprites(skillTree.sprites.masteryInactive[SPRITE_SCALE], inverseSpritesActive);

  indexSprites(skillTree.sprites.groupBackground[SPRITE_SCALE], inverseSprites);
  indexSprites(skillTree.sprites.frame[SPRITE_SCALE], inverseSprites);

  const translationFiles = [
    data.StatTranslationsJSON,
    data.PassiveSkillStatTranslationsJSON,
    data.PassiveSkillAuraStatTranslationsJSON
  ];

  translationFiles.forEach((f) => {
    const translations: TranslationFile = JSON.parse(f);

    translations.descriptors.forEach((t) => {
      t.ids.forEach((id) => {
        if (!(id in inverseTranslations)) {
          inverseTranslations[id] = t;
        }
      });
    });
  });

  Object.keys(data.TreeToPassive).forEach((k) => {
    passiveToTree[data.TreeToPassive[parseInt(k)].Index] = parseInt(k);
  });
};

const replaceRecord = <T>(target: Record<string | number, T>, source: Record<string | number, T>): void => {
  for (const k of Object.keys(target)) {
    delete target[k];
  }
  Object.assign(target, source);
};

/**
 * PoE2 equivalent of loadSkillTree(): builds the singletons the canvas renderer
 * reads (skillTree, drawnNodes/Groups, inverseSprites) from the adapted PoE2
 * export. No translations/passive maps — PoE2 nodes carry their own stat strings
 * and search is not wired yet.
 */
export const loadSkillTreePoe2 = async (basePath = ''): Promise<void> => {
  const bundle = await buildPoe2Tree(basePath);
  skillTree = bundle.skillTree;
  replaceRecord(drawnNodes, bundle.drawnNodes);
  replaceRecord(drawnGroups, bundle.drawnGroups);
  replaceRecord(inverseSprites, bundle.inverseSprites);
  replaceRecord(inverseSpritesActive, bundle.inverseSpritesActive);
  baseJewelRadius = POE2_JEWEL_RADIUS;
  spriteDrawScale = POE2_SPRITE_DRAW_SCALE;
  clipNodeIcons = true;
  connections = bundle.connections;
  debugNodeInfo = true;
  effectNodes = bundle.effectNodes;

  // The shared page/components look passives up via data.TreeToPassive[node.skill]
  // and use the .Index when building search queries. PoE2 has no go-pob-data, so
  // provide identity-style PassiveSkill stubs keyed by the node's graph id.
  replaceRecord(
    treeToPassive,
    Object.fromEntries(
      Object.values(bundle.skillTree.nodes)
        .filter((n): n is Node & { skill: number } => typeof n.skill === 'number')
        .map((n) => [
          n.skill,
          {
            Index: n.skill,
            ID: n.id ?? String(n.skill),
            StatIndices: [],
            PassiveSkillGraphID: n.skill,
            Name: n.name ?? '',
            IsKeystone: !!n.isKeystone,
            IsNotable: !!n.isNotable,
            IsJewelSocket: !!n.isJewelSocket
          } as PassiveSkill
        ])
    )
  );

  console.log('Loaded PoE2 skill tree', skillTree);
};

const indexHandlers: Record<string, number> = {
  negate: -1,
  times_twenty: 1 / 20,
  canonical_stat: 1,
  per_minute_to_per_second: 60,
  milliseconds_to_seconds: 1000,
  display_indexable_support: 1,
  divide_by_one_hundred: 100,
  milliseconds_to_seconds_2dp_if_required: 1000,
  deciseconds_to_seconds: 10,
  old_leech_percent: 1,
  old_leech_permyriad: 10000,
  times_one_point_five: 1 / 1.5,
  '30%_of_value': 100 / 30,
  divide_by_one_thousand: 1000,
  divide_by_twelve: 12,
  divide_by_six: 6,
  per_minute_to_per_second_2dp_if_required: 60,
  '60%_of_value': 100 / 60,
  double: 1 / 2,
  negate_and_double: 1 / -2,
  multiply_by_four: 1 / 4,
  per_minute_to_per_second_0dp: 60,
  milliseconds_to_seconds_0dp: 1000,
  mod_value_to_item_class: 1,
  milliseconds_to_seconds_2dp: 1000,
  multiplicative_damage_modifier: 1,
  divide_by_one_hundred_2dp: 100,
  per_minute_to_per_second_1dp: 60,
  divide_by_one_hundred_2dp_if_required: 100,
  divide_by_ten_1dp_if_required: 10,
  milliseconds_to_seconds_1dp: 1000,
  divide_by_fifty: 50,
  per_minute_to_per_second_2dp: 60,
  divide_by_ten_0dp: 10,
  divide_by_one_hundred_and_negate: -100,
  tree_expansion_jewel_passive: 1,
  passive_hash: 1,
  divide_by_ten_1dp: 10,
  affliction_reward_type: 1,
  divide_by_five: 5,
  metamorphosis_reward_description: 1,
  divide_by_two_0dp: 2,
  divide_by_fifteen_0dp: 15,
  divide_by_three: 3,
  divide_by_twenty_then_double_0dp: 10,
  divide_by_four: 4
};

export type Point = {
  x: number;
  y: number;
};

export const toCanvasCoords = (x: number, y: number, offsetX: number, offsetY: number, scaling: number): Point => ({
  x: (Math.abs(skillTree.min_x) + x + offsetX) / scaling,
  y: (Math.abs(skillTree.min_y) + y + offsetY) / scaling
});

export const rotateAroundPoint = (center: Point, target: Point, angle: number): Point => {
  const radians = (Math.PI / 180) * angle;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const nx = cos * (target.x - center.x) + sin * (target.y - center.y) + center.x;
  const ny = cos * (target.y - center.y) - sin * (target.x - center.x) + center.y;
  return {
    x: nx,
    y: ny
  };
};

export const orbit16Angles = [0, 30, 45, 60, 90, 120, 135, 150, 180, 210, 225, 240, 270, 300, 315, 330];
export const orbit40Angles = [
  0, 10, 20, 30, 40, 45, 50, 60, 70, 80, 90, 100, 110, 120, 130, 135, 140, 150, 160, 170, 180, 190, 200, 210, 220, 225,
  230, 240, 250, 260, 270, 280, 290, 300, 310, 315, 320, 330, 340, 350
];

export const orbitAngleAt = (orbit: number, index: number): number => {
  const nodesInOrbit = skillTree.constants.skillsPerOrbit[orbit];
  if (nodesInOrbit == 16) {
    return orbit16Angles[orbit16Angles.length - index] || 0;
  } else if (nodesInOrbit == 40) {
    return orbit40Angles[orbit40Angles.length - index] || 0;
  } else {
    return 360 - (360 / nodesInOrbit) * index;
  }
};

export const calculateNodePos = (node: Node, offsetX: number, offsetY: number, scaling: number): Point => {
  // PoE2 nodes carry absolute coordinates — use them directly and skip the
  // group/orbit math. PoE1 nodes have no x/y, so this branch never triggers there.
  if (node.x !== undefined && node.y !== undefined) {
    return toCanvasCoords(node.x, node.y, offsetX, offsetY, scaling);
  }

  if (node.group === undefined || node.orbit === undefined || node.orbitIndex === undefined) {
    return { x: 0, y: 0 };
  }

  const targetGroup = skillTree.groups[node.group];
  const targetAngle = orbitAngleAt(node.orbit, node.orbitIndex);

  const targetGroupPos = toCanvasCoords(targetGroup.x, targetGroup.y, offsetX, offsetY, scaling);
  const targetNodePos = toCanvasCoords(
    targetGroup.x,
    targetGroup.y - skillTree.constants.orbitRadii[node.orbit],
    offsetX,
    offsetY,
    scaling
  );
  return rotateAroundPoint(targetGroupPos, targetNodePos, targetAngle);
};

export const distance = (p1: Point, p2: Point): number =>
  Math.sqrt(Math.pow(p1.x - p2.x, 2) + Math.pow(p1.y - p2.y, 2));

export const formatStats = (translation: Translation, stat: number): string | undefined => {
  let selectedTranslation = -1;

  for (let i = 0; i < translation.list.length; i++) {
    const t = translation.list[i];

    let matches = true;
    if (t.conditions?.length > 0) {
      const first = t.conditions[0];
      if (first.min !== undefined) {
        if (stat < first.min) {
          matches = false;
        }
      }

      if (first.max !== undefined) {
        if (stat > first.max) {
          matches = false;
        }
      }

      if (first.negated) {
        matches = !matches;
      }
    }

    if (matches) {
      selectedTranslation = i;
      break;
    }
  }

  if (selectedTranslation == -1) {
    return undefined;
  }

  const datum = translation.list[selectedTranslation];

  let finalStat = stat;

  if (datum.index_handlers !== undefined) {
    if (Array.isArray(datum.index_handlers)) {
      if (datum.index_handlers?.length > 0) {
        datum.index_handlers[0].forEach((handler) => {
          finalStat = finalStat / (indexHandlers[handler] || 1);
        });
      }
    } else {
      Object.keys(datum.index_handlers).forEach((handler) => {
        finalStat = finalStat / (indexHandlers[handler] || 1);
      });
    }
  }

  return datum.string
    .replace(/\{0(?::(.*?)d(.*?))\}/, '$1' + finalStat.toString() + '$2')
    .replace(`{0}`, parseFloat(finalStat.toFixed(2)).toString());
};

export const getAffectedNodes = (socket: Node): Node[] => {
  const result: Node[] = [];

  const socketPos = calculateNodePos(socket, 0, 0, 1);
  for (const node of Object.values(drawnNodes)) {
    const nodePos = calculateNodePos(node, 0, 0, 1);

    if (distance(nodePos, socketPos) < baseJewelRadius) {
      result.push(node);
    }
  }

  return result;
};

type Stat = { Index: number; ID: string; Text: string };

const statCache: Record<number, Stat> = {};
export const getStat = (id: number | string): Stat => {
  const nId = typeof id === 'string' ? parseInt(id) : id;
  if (!(nId in statCache)) {
    statCache[nId] = data.GetStatByIndex(nId);
  }
  return statCache[nId];
};

export interface StatConfig {
  min: number;
  id: number;
  weight: number;
}

export interface ReverseSearchConfig {
  jewel: number;
  conqueror: string;
  nodes: number[];
  stats: StatConfig[];
  minTotalWeight: number;
  workerId?: number;
  numWorkers?: number;
}

export interface MassReverseSearchConfig {
  jewel: number;
  conqueror: string;
  socketToNodes: { [socketId: number]: number[] };
  stats: StatConfig[];
  minTotalWeight: number;
  workerId?: number;
  numWorkers?: number;
}

export interface SearchWithSeed {
  seed: number;
  conqueror?: string;
  price?: string;
  listedAt?: string;
  weight: number;
  statCounts: Record<number, number>;
  skills: {
    passive: number;
    stats: { [key: string]: number };
  }[];
}

export interface SearchResults {
  grouped: { [key: number]: SearchWithSeed[] };
  raw: SearchWithSeed[];
}

export interface MassSearchResults {
  resultsBySocket: { [socketId: number]: SearchResults };
}

export const translateStat = (id: number, roll?: number | undefined): string => {
  const stat = getStat(id);
  const translation = inverseTranslations[stat.ID];
  if (roll) {
    return formatStats(translation, roll) || stat.ID;
  }

  let translationText = stat.Text || stat.ID;
  if (translation && translation.list && translation.list.length) {
    translationText = translation.list[0].string;
    translationText = translationText.replace(/\{\d(?::(.*?)d(.*?))\}/, '$1#$2').replace(/\{\d\}/, '#');
  }
  return translationText;
};

export interface TargetedMassMarketSearchConfig {
  jewel: number;
  seeds: number[];
  conquerors: string[];
  prices?: string[];
  listedAts?: string[];
  socketToNodes: { [socketId: number]: number[] };
  stats: StatConfig[];
  minTotalWeight: number;
}
