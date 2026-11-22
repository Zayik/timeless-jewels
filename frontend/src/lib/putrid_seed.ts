// Putrid Seed (Mycelium Core) planner.
//
// A Putrid Seed is anointed with three oils and grows up to four notables. Unlike the
// timeless jewels there is no seed number: the outcome is rolled on the server. What we
// can model is the pool the notables are drawn from. In David's anoint log (50 seeds,
// Clear+Sepia+Amber in two orders) every grown notable was one whose normal anoint
// recipe uses only the chosen oils, all 10 such notables showed up, and nothing outside
// them did. That rule is only confirmed for that one oil set; everything here is built on
// it, and the UI says so.

import type { SkillTreeData } from './skill_tree_types';

export interface Oil {
  id: string; // game id used in the tree data's node.recipe, e.g. "ClearOil"
  name: string;
  color: string;
  tier: number; // 1 = cheapest; follows the usual market order
}

export const OILS: Oil[] = [
  { id: 'ClearOil', name: 'Clear', color: '#d9d9d9', tier: 1 },
  { id: 'SepiaOil', name: 'Sepia', color: '#a0794f', tier: 2 },
  { id: 'AmberOil', name: 'Amber', color: '#f0a030', tier: 3 },
  { id: 'VerdantOil', name: 'Verdant', color: '#4caf50', tier: 4 },
  { id: 'TealOil', name: 'Teal', color: '#26a69a', tier: 5 },
  { id: 'AzureOil', name: 'Azure', color: '#42a5f5', tier: 6 },
  { id: 'IndigoOil', name: 'Indigo', color: '#7986cb', tier: 7 },
  { id: 'VioletOil', name: 'Violet', color: '#ba68c8', tier: 8 },
  { id: 'CrimsonOil', name: 'Crimson', color: '#e53935', tier: 9 },
  { id: 'BlackOil', name: 'Black', color: '#8d8d8d', tier: 10 },
  { id: 'OpalescentOil', name: 'Opalescent', color: '#e6dcff', tier: 11 },
  { id: 'SilverOil', name: 'Silver', color: '#b0bec5', tier: 12 },
  { id: 'GoldenOil', name: 'Golden', color: '#ffd54f', tier: 13 },
  { id: 'PrismaticOil', name: 'Prismatic', color: '#f48fb1', tier: 14 }
];

export const OIL_BY_ID: Record<string, Oil> = Object.fromEntries(OILS.map((o) => [o.id, o]));

const OIL_BIT: Record<string, number> = Object.fromEntries(OILS.map((o, i) => [o.id, 1 << i]));
export const oilMask = (oils: Iterable<string>): number => {
  let m = 0;
  for (const o of oils) {
    m |= OIL_BIT[o] ?? 1 << 30;
  }
  return m;
};

export interface PutridNotable {
  name: string;
  icon?: string; // sprite key, e.g. "Art/2DArt/SkillIcons/passives/MindPact.png"
  stats: string[];
  recipe: string[]; // as listed in the tree, may repeat an oil
  oils: string[]; // distinct oils in the recipe, cheapest first
  mask: number; // bit per oil (OILS index), for fast pool checks
  blighted: boolean; // anoint-only notable that is not on the normal tree
  categories: string[];
  searchText: string; // lowercased name + stats, for filtering
}

// Tree stat lines carry link markup like "[TransfigurationOfMind|Transfiguration of Mind]".
export const cleanStat = (s: string): string =>
  s.replace(/\[(?:[^|\]]*\|)?([^\]]*)\]/g, '$1').replace(/\s*\n\s*/g, ' ');

// ---- Categories ----
//
// Keyword rules over each stat line. A notable joins a category when any of its stat lines
// matches `match` and that same line does not match `exclude` (so "Totems have 30%
// increased Life" counts for Totems, not Life).

export interface Category {
  name: string;
  group: string;
  match: RegExp;
  exclude?: RegExp;
}

// Lines about minions, totems or enemies rather than you.
const NOT_PLAYER = /\b(minions?|totems?|golems?)\b/i;
const NOT_SELF = /\b(minions?|totems?|enem(?:y|ies)|allies|golems?|skeletons?|zombies?|spectres?|banners?)\b/i;

export const CATEGORIES: Category[] = [
  // Defence
  { group: 'Defence', name: 'Life', match: /\blife\b/i, exclude: NOT_SELF },
  { group: 'Defence', name: 'Energy Shield', match: /energy shield/i, exclude: NOT_SELF },
  { group: 'Defence', name: 'Mana', match: /\bmana\b(?! (?:cost|reservation))/i, exclude: NOT_SELF },
  { group: 'Defence', name: 'Armour', match: /\barmour\b|defences from equipped/i, exclude: NOT_PLAYER },
  { group: 'Defence', name: 'Evasion', match: /evasion|\bevade|elusive/i, exclude: NOT_PLAYER },
  { group: 'Defence', name: 'Block', match: /\bblock/i, exclude: NOT_PLAYER },
  { group: 'Defence', name: 'Spell Suppression', match: /suppress/i },
  { group: 'Defence', name: 'Resistances', match: /resistance/i, exclude: NOT_SELF },
  {
    group: 'Defence',
    name: 'Damage Reduction',
    match:
      /damage taken|you take|take \d+% (?:reduced|less)|less damage|physical damage reduction|taken as|extra damage from critical/i,
    exclude: /enem(?:y|ies) take|minions?|totems?/i
  },
  {
    group: 'Defence',
    name: 'Recovery & Leech',
    match: /regenerat|leech|recover|recoup|recharge|life gain|gain \d+ life|on hit/i,
    exclude: /enem(?:y|ies)|cannot recharge/i
  },
  {
    group: 'Defence',
    name: 'Ailment & Stun Defence',
    match:
      /avoid|immun|effect of (?:chill|shock|curses?) on you|duration on you|cannot be (?:stunned|frozen|ignited|shocked|chilled|poisoned)|stun threshold|stun and block recovery|remove (?:bleed|curse|ignite|chill|shock|elemental|corrupted)|debuffs on you/i
  },
  // Offence
  {
    group: 'Offence',
    name: 'Spell Damage',
    match: /spell|arcane surge/i,
    exclude: /block spell|suppress(?:ed)? spell|leeched as|mark spell|curse spell/i
  },
  {
    group: 'Offence',
    name: 'Attack Damage',
    match:
      /attack damage|attacks? (?:deal|have)|attack skills deal|melee (?:physical )?damage|(?:axe|sword|mace|staff|bow|dagger|claw|wand|sceptre) attacks|damage with (?:axes|swords|maces|staves|bows|daggers|claws|wands|one handed|two handed)|strike skills|impale|onslaught/i,
    exclude: /block attack|totems?|minions?/i
  },
  { group: 'Offence', name: 'Critical Strikes', match: /critical(?:ly)? strike/i, exclude: /damage from critical/i },
  { group: 'Offence', name: 'Cast Speed', match: /cast speed|arcane surge/i },
  { group: 'Offence', name: 'Attack Speed', match: /attack speed|onslaught/i, exclude: /minions?/i },
  { group: 'Offence', name: 'Area of Effect', match: /area of effect|area damage/i, exclude: /aura skills/i },
  { group: 'Offence', name: 'Projectiles', match: /projectile|chain/i },
  { group: 'Offence', name: 'Physical', match: /physical|impale|bleed/i, exclude: NOT_SELF },
  { group: 'Offence', name: 'Fire', match: /\bfire\b|ignite|burning/i, exclude: /resistance|on you/i },
  { group: 'Offence', name: 'Cold', match: /\bcold\b|chill|freez|frozen/i, exclude: /resistance|on you/i },
  { group: 'Offence', name: 'Lightning', match: /lightning|shock/i, exclude: /resistance|on you/i },
  { group: 'Offence', name: 'Chaos', match: /\bchaos\b|wither/i, exclude: /resistance/i },
  {
    group: 'Offence',
    name: 'Elemental',
    match: /elemental (?:damage|ailments?(?! duration on you))|exposure|penetrat/i
  },
  {
    group: 'Offence',
    name: 'Damage over Time',
    match: /damage over time|poison|bleed|ignite|damage with ailments|damaging ailments deal/i,
    exclude: /on you|remove/i
  },
  { group: 'Offence', name: 'Accuracy', match: /accuracy/i },
  {
    group: 'Offence',
    name: 'Stun & Knockback',
    match: /\bstun(?! threshold| and block| recovery)|knockback|knock back|culling/i,
    exclude: /when stunned|stunned while|you've been stunned/i
  },
  // Skills and mechanics
  { group: 'Skills', name: 'Minions', match: /minion|golem|skeleton|zombie|spectre|raised|offering/i },
  { group: 'Skills', name: 'Totems', match: /totem/i },
  { group: 'Skills', name: 'Traps & Mines', match: /\btraps?\b|\bmines?\b/i },
  { group: 'Skills', name: 'Brands', match: /\bbrands?\b/i },
  { group: 'Skills', name: 'Auras & Reservation', match: /\bauras?\b|reservation|herald/i },
  { group: 'Skills', name: 'Curses & Marks', match: /\bcurse|\bhex|\bmarks?\b|marked/i },
  { group: 'Skills', name: 'Warcries & Rage', match: /warcr|\brage\b|banner|valour/i },
  { group: 'Skills', name: 'Retaliation & Guard', match: /retaliation|guard skill/i },
  { group: 'Skills', name: 'Flasks', match: /flask/i },
  { group: 'Skills', name: 'Charges', match: /(?:endurance|frenzy|power) charge/i },
  { group: 'Skills', name: 'Skill Duration', match: /skill effect duration|increased duration|totem duration/i },
  { group: 'Skills', name: 'Mana Cost', match: /\bcosts?\b|cost efficiency/i },
  { group: 'Skills', name: 'Ground Effects', match: /\bground\b|covered in ash/i },
  { group: 'Skills', name: 'Movement', match: /movement speed|travel skill|blink|dash|phasing/i },
  // Weapons
  { group: 'Weapons', name: 'Shields', match: /(?<!energy )\bshields?\b/i },
  { group: 'Weapons', name: 'Dual Wielding', match: /dual wield/i },
  { group: 'Weapons', name: 'Two-Handed & Staves', match: /two hand|\bstaff\b|staves/i },
  { group: 'Weapons', name: 'Bows', match: /\bbows?\b|arrow/i },
  { group: 'Weapons', name: 'Wands', match: /\bwands?\b/i },
  { group: 'Weapons', name: 'Axes & Swords', match: /\baxes?\b|\bswords?\b/i },
  { group: 'Weapons', name: 'Maces & Sceptres', match: /\bmaces?\b|sceptre/i },
  { group: 'Weapons', name: 'Daggers & Claws', match: /\bdaggers?\b|\bclaws?\b/i },
  // Other
  { group: 'Other', name: 'Attributes', match: /strength|dexterity|intelligence|all attributes/i },
  { group: 'Other', name: 'Link Skills', match: /\blink/i }
];

export const CATEGORY_GROUPS = [...new Set(CATEGORIES.map((c) => c.group))];

export const categorize = (stats: string[]): string[] =>
  CATEGORIES.filter((c) => stats.some((s) => c.match.test(s) && !(c.exclude && c.exclude.test(s)))).map((c) => c.name);

// ---- Notables ----

const tierOf = (oil: string) => OIL_BY_ID[oil]?.tier ?? 99;

export const loadPutridNotables = (tree: Pick<SkillTreeData, 'nodes'>): PutridNotable[] => {
  const byName = new Map<string, PutridNotable>();
  for (const node of Object.values(tree.nodes)) {
    if (!node?.recipe?.length || !node.name || byName.has(node.name)) {
      continue;
    }
    const stats = (node.stats ?? []).map(cleanStat);
    byName.set(node.name, {
      name: node.name,
      icon: node.icon,
      stats,
      recipe: [...node.recipe].sort((a, b) => tierOf(a) - tierOf(b)),
      oils: [...new Set(node.recipe)].sort((a, b) => tierOf(a) - tierOf(b)),
      mask: oilMask(node.recipe),
      blighted: !!node.isBlighted,
      categories: categorize(stats),
      searchText: (node.name + '\n' + stats.join('\n')).toLowerCase()
    });
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
};

// Oils summed by tier: lower means the recipe leans on cheaper oils. In the anoint log the
// cheap-oil recipes grew more often (Clear x3 on ~76% of seeds), so this is a rough hint
// at relative likelihood, not a measured weight.
export const recipeCost = (n: PutridNotable): number => n.recipe.reduce((s, o) => s + tierOf(o), 0);

// The pool rule: a notable can grow when every oil in its recipe is one of the chosen oils.
export const inPool = (n: PutridNotable, mask: number): boolean => (n.mask & ~mask) === 0;

export const poolFor = (notables: PutridNotable[], oils: Iterable<string>): PutridNotable[] => {
  const mask = oilMask(oils);
  return notables.filter((n) => inPool(n, mask));
};

// Distinct oil sets to rank. Three different oils gives 364 sets. With repeats allowed
// (e.g. Clear+Clear+Sepia), a combination behaves as its set of distinct oils, which adds
// the 91 two-oil and 14 one-oil sets. Whether the game accepts repeated oils in a Putrid
// Seed is untested.
export const oilSets = (allowRepeats: boolean): string[][] => {
  const ids = OILS.map((o) => o.id);
  const out: string[][] = [];
  for (let i = 0; i < ids.length; i++) {
    if (allowRepeats) {
      out.push([ids[i]]);
    }
    for (let j = i + 1; j < ids.length; j++) {
      if (allowRepeats) {
        out.push([ids[i], ids[j]]);
      }
      for (let k = j + 1; k < ids.length; k++) {
        out.push([ids[i], ids[j], ids[k]]);
      }
    }
  }
  return out;
};

export const GROWN_DRAWS = 4;

export interface ComboRank {
  oils: string[];
  pool: PutridNotable[];
  hits: PutridNotable[];
  share: number; // hits / pool size
  // Expected number of distinct wishlist notables among 4 draws if every pool notable were
  // equally likely (draws repeat, so duplicates merge). Real draws are weighted.
  expectedHits: number;
  // Chance at least one wishlist notable grows, under the same even-odds assumption.
  chanceAny: number;
}

export const rankCombos = (
  notables: PutridNotable[],
  wishlist: ReadonlySet<string>,
  allowRepeats: boolean
): ComboRank[] => {
  const ranks: ComboRank[] = [];
  const wanted = notables.filter((n) => wishlist.has(n.name));
  for (const oils of oilSets(allowRepeats)) {
    const mask = oilMask(oils);
    const hits = wanted.filter((n) => inPool(n, mask));
    if (hits.length === 0) {
      continue;
    }
    const pool = notables.filter((n) => inPool(n, mask));
    const share = hits.length / pool.length;
    const missOne = 1 - 1 / pool.length;
    ranks.push({
      oils,
      pool,
      hits,
      share,
      expectedHits: hits.length * (1 - Math.pow(missOne, GROWN_DRAWS)),
      chanceAny: 1 - Math.pow(1 - share, GROWN_DRAWS)
    });
  }
  return ranks;
};

export type RankSort = 'count' | 'share' | 'expected';

export const sortRanks = (ranks: ComboRank[], by: RankSort): ComboRank[] => {
  const key = (r: ComboRank) => (by === 'count' ? r.hits.length : by === 'share' ? r.share : r.expectedHits);
  return [...ranks].sort(
    (a, b) => key(b) - key(a) || b.hits.length - a.hits.length || b.share - a.share || a.pool.length - b.pool.length
  );
};

// ---- Icons ----

export interface NotableIcon {
  url: string;
  x: number;
  y: number;
  w: number;
  h: number;
  sheetW: number;
  sheetH: number;
}

type SpriteSheets = Record<
  string,
  { filename: string; w: number; h: number; coords: Record<string, { x: number; y: number; w: number; h: number }> }
>;

// Looks a notable's icon up in the tree's notable sprite sheet, at the largest zoom.
export const notableIconLookup = (sheets: SpriteSheets | undefined) => {
  const zoom = Object.keys(sheets ?? {}).sort((a, b) => parseFloat(b) - parseFloat(a))[0];
  const sheet = zoom ? sheets?.[zoom] : undefined;
  return (icon: string | undefined): NotableIcon | undefined => {
    const c = icon && sheet ? sheet.coords[icon] : undefined;
    return c && sheet ? { url: sheet.filename, ...c, sheetW: sheet.w, sheetH: sheet.h } : undefined;
  };
};
