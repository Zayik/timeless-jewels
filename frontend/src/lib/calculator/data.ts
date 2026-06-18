// Data loader - replaces Go WASM data package.
// Fetches 10 JSON.gz files from <base>/data/, decompresses them, builds lookup maps.

import { base as basePath } from '$app/paths';
import type {
  PassiveSkill,
  AlternatePassiveSkill,
  AlternatePassiveAddition,
  AlternateTreeVersion,
  Stat,
  TimelessJewelConqueror,
  Range
} from './types';
import { PassiveSkillType } from './types';

// ---- Module-level storage (populated by initializeData) ----

let _passiveSkills: PassiveSkill[] = [];
let _alternatePassiveSkills: AlternatePassiveSkill[] = [];
let _alternatePassiveAdditions: AlternatePassiveAddition[] = [];
let _alternateTreeVersions: AlternateTreeVersion[] = [];
let _stats: Stat[] = [];

let _skillTreeJSON = '';
let _statTranslationsJSON = '';
let _passiveSkillStatTranslationsJSON = '';
let _passiveSkillAuraStatTranslationsJSON = '';
let _possibleStatsJSON = '';

// ---- Derived lookup maps ----

export const treeToPassive: Record<number, PassiveSkill> = {};
export const idToPassiveSkill: Record<number, PassiveSkill> = {};
export const idToAlternatePassiveSkill: Record<number, AlternatePassiveSkill> = {};
export const idToAlternatePassiveAddition: Record<number, AlternatePassiveAddition> = {};
export const idToAlternateTreeVersion: Record<number, AlternateTreeVersion> = {};
export const idToStat: Record<number, Stat> = {};

// reverseAlternatePassiveSkills[passiveType][alternateTreeVersionsKey] = AlternatePassiveSkill[]
export const reverseAlternatePassiveSkills: Map<PassiveSkillType, Map<number, AlternatePassiveSkill[]>> = new Map();
// reverseAlternatePassiveAdditions[passiveType][alternateTreeVersionsKey] = AlternatePassiveAddition[]
export const reverseAlternatePassiveAdditions: Map<
  PassiveSkillType,
  Map<number, AlternatePassiveAddition[]>
> = new Map();

export let alternateTreeVersions: AlternateTreeVersion[] = [];

// ---- Static jewel data (from data/jewels.go) ----

export const JewelType = {
  GloriousVanity: 1,
  LethalPride: 2,
  BrutalRestraint: 3,
  MilitantFaith: 4,
  ElegantHubris: 5,
  HeroicTragedy: 6
} as const;

const TIMELESS_JEWELS: Record<number, string> = {
  1: 'Glorious Vanity',
  2: 'Lethal Pride',
  3: 'Brutal Restraint',
  4: 'Militant Faith',
  5: 'Elegant Hubris',
  6: 'Heroic Tragedy'
};

// Matches data/jewels.go TimelessJewelConquerors exactly
const TIMELESS_JEWEL_CONQUERORS: Record<number, Record<string, TimelessJewelConqueror>> = {
  // GloriousVanity = 1
  1: {
    Xibaqua: { Index: 1, Version: 0 },
    Zerphi: { Index: 2, Version: 0 },
    Ahuana: { Index: 2, Version: 1 },
    Doryani: { Index: 3, Version: 0 }
  },
  // LethalPride = 2
  2: {
    Kaom: { Index: 1, Version: 0 },
    Rakiata: { Index: 2, Version: 0 },
    Kiloava: { Index: 3, Version: 0 },
    Akoya: { Index: 3, Version: 1 }
  },
  // BrutalRestraint = 3
  3: {
    Deshret: { Index: 1, Version: 0 },
    Balbala: { Index: 1, Version: 1 },
    Asenath: { Index: 2, Version: 0 },
    Nasima: { Index: 3, Version: 0 }
  },
  // MilitantFaith = 4
  4: {
    Venarius: { Index: 1, Version: 0 },
    Maxarius: { Index: 1, Version: 1 },
    Dominus: { Index: 2, Version: 0 },
    Avarius: { Index: 3, Version: 0 }
  },
  // ElegantHubris = 5
  5: {
    Cadiro: { Index: 1, Version: 0 },
    Victario: { Index: 2, Version: 0 },
    Chitus: { Index: 3, Version: 0 },
    Caspiro: { Index: 3, Version: 1 }
  },
  // HeroicTragedy = 6
  6: {
    Vorana: { Index: 1, Version: 0 },
    Uhtred: { Index: 2, Version: 0 },
    Medved: { Index: 3, Version: 0 }
  }
};

// Matches data/jewels.go TimelessJewelSeedRanges exactly
const TIMELESS_JEWEL_SEED_RANGES: Record<number, Range> = {
  1: { Min: 100, Max: 8000, Special: false }, // GloriousVanity
  2: { Min: 10000, Max: 18000, Special: false }, // LethalPride
  3: { Min: 500, Max: 8000, Special: false }, // BrutalRestraint
  4: { Min: 2000, Max: 10000, Special: false }, // MilitantFaith
  5: { Min: 2000, Max: 160000, Special: true }, // ElegantHubris
  6: { Min: 100, Max: 8000, Special: false } // HeroicTragedy
};

// ---- Helper functions (from data/manager.go) ----

export function isSmallAttribute(stat: number): boolean {
  // Go: bitPosition = (stat + 1) - 574; if bitPosition <= 6 && (0x49 & (1 << bitPosition)) != 0
  const bitPosition = stat + 1 - 574;
  if (bitPosition < 0 || bitPosition > 6) {
    return false;
  }
  return (0x49 & (1 << bitPosition)) !== 0;
}

export function getPassiveSkillType(ps: PassiveSkill): PassiveSkillType {
  if (ps.IsJewelSocket) {
    return PassiveSkillType.JewelSocket;
  }
  if (ps.IsKeystone) {
    return PassiveSkillType.KeyStone;
  }
  if (ps.IsNotable) {
    return PassiveSkillType.Notable;
  }
  // Go: len(StatIndices) == 1 && IsSmallAttribute(StatIndices[0])
  if (ps.StatIndices && ps.StatIndices.length === 1 && isSmallAttribute(ps.StatIndices[0])) {
    return PassiveSkillType.SmallAttribute;
  }
  return PassiveSkillType.SmallNormal;
}

export function isPassiveSkillValidForAlteration(ps: PassiveSkill | undefined): ps is PassiveSkill {
  if (!ps) {
    return false;
  }
  const t = getPassiveSkillType(ps);
  return t !== PassiveSkillType.None && t !== PassiveSkillType.JewelSocket;
}

// Lookup functions used by tree_manager
export function getApplicableAlternatePassiveSkills(
  ps: PassiveSkill,
  treeVersionIndex: number
): AlternatePassiveSkill[] {
  const psType = getPassiveSkillType(ps);
  return reverseAlternatePassiveSkills.get(psType)?.get(treeVersionIndex) ?? [];
}

export function getApplicableAlternatePassiveAdditions(
  ps: PassiveSkill,
  treeVersionIndex: number
): AlternatePassiveAddition[] {
  const psType = getPassiveSkillType(ps);
  return reverseAlternatePassiveAdditions.get(psType)?.get(treeVersionIndex) ?? [];
}

export function getAlternatePassiveSkillKeyStone(
  treeVersionIndex: number,
  conquerorIndex: number,
  conquerorVersion: number
): AlternatePassiveSkill | undefined {
  // Go finds the FIRST skill matching all three conditions, stores it, then breaks.
  // Then checks if that skill has KeyStone in PassiveType.
  let found: AlternatePassiveSkill | undefined;
  for (const skill of _alternatePassiveSkills) {
    if (skill.AlternateTreeVersionsKey !== treeVersionIndex) {
      continue;
    }
    if (skill.ConquerorIndex !== conquerorIndex) {
      continue;
    }
    if (skill.ConquerorVersion !== conquerorVersion) {
      continue;
    }
    found = skill;
    break;
  }
  if (!found) {
    return undefined;
  }
  if (found.PassiveType && found.PassiveType.includes(PassiveSkillType.KeyStone)) {
    return found;
  }
  return undefined;
}

// ---- Fetch and decompress helper ----

async function decompressIfNeeded(buffer: ArrayBuffer): Promise<ArrayBuffer> {
  const bytes = new Uint8Array(buffer);
  // If browser already decoded Content-Encoding: gzip (e.g. Vite dev server), skip decompression
  if (bytes[0] !== 0x1f || bytes[1] !== 0x8b) {
    return buffer;
  }
  const ds = new DecompressionStream('gzip');
  const writer = ds.writable.getWriter();
  writer.write(bytes);
  writer.close();
  return new Response(ds.readable).arrayBuffer();
}

async function fetchAndDecompress<T>(path: string): Promise<T> {
  const response = await fetch(path);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${path}: ${response.statusText}`);
  }
  const buffer = await decompressIfNeeded(await response.arrayBuffer());
  return JSON.parse(new TextDecoder().decode(buffer)) as T;
}

async function fetchAndDecompressText(path: string): Promise<string> {
  const response = await fetch(path);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${path}: ${response.statusText}`);
  }
  const buffer = await decompressIfNeeded(await response.arrayBuffer());
  return new TextDecoder().decode(buffer);
}

// ---- AddGetStatMinMax helpers ----

function addApsGetStatMinMax(aps: Omit<AlternatePassiveSkill, 'GetStatMinMax'>): AlternatePassiveSkill {
  return {
    ...aps,
    GetStatMinMax(isMin: boolean, idx: number): number {
      if (isMin) {
        switch (idx) {
          case 0:
            return this.Stat1Min;
          case 1:
            return this.Stat2Min;
          case 2:
            return this.Stat3Min;
          case 3:
            return this.Stat4Min;
        }
      } else {
        switch (idx) {
          case 0:
            return this.Stat1Max;
          case 1:
            return this.Stat2Max;
          case 2:
            return this.Stat3Max;
          case 3:
            return this.Stat4Max;
        }
      }
      return 0;
    }
  } as AlternatePassiveSkill;
}

function addApaGetStatMinMax(apa: Omit<AlternatePassiveAddition, 'GetStatMinMax'>): AlternatePassiveAddition {
  return {
    ...apa,
    GetStatMinMax(isMin: boolean, idx: number): number {
      if (isMin) {
        switch (idx) {
          case 0:
            return this.Stat1Min;
          case 1:
            return this.Stat2Min;
        }
      } else {
        switch (idx) {
          case 0:
            return this.Stat1Max;
          case 1:
            return this.Stat2Max;
        }
      }
      return 0;
    }
  } as AlternatePassiveAddition;
}

// ---- JSON field name mappings ----
// Go structs use json tags that differ from field names.
// The JSON files use the json tag names as keys.
// We need to remap: Var9->Stat3Min, Var10->Stat3Max, Var11->Stat4Min, Var12->Stat4Max,
//                   Var18->ConquerorIndex, Var24->ConquerorVersion,
//                   AlternateTreeVersionsKey (already correct in json tag?), etc.
// Actually the json tags ARE the JSON keys. Let's check what the actual JSON contains.
// Go struct AlternatePassiveSkill:
//   AlternateTreeVersionsKey uint32 `json:"AlternateTreeVersionsKey"` -> key in json
//   Stat3Min int32 `json:"Var9"` -> key in json is "Var9"
//   Stat3Max int32 `json:"Var10"` -> "Var10"
//   Stat4Min int32 `json:"Var11"` -> "Var11"
//   Stat4Max int32 `json:"Var12"` -> "Var12"
//   ConquerorIndex uint32 `json:"Var18"` -> "Var18"
//   ConquerorVersion uint32 `json:"Var24"` -> "Var24"
// AlternateTreeVersion:
//   AreSmallAttributePassiveSkillsReplaced bool `json:"Var1"`
//   AreSmallNormalPassiveSkillsReplaced bool `json:"Var2"`
//   MinimumAdditions uint32 `json:"Var5"`
//   MaximumAdditions uint32 `json:"Var6"`
//   NotableReplacementSpawnWeight uint32 `json:"Var9"`
// AlternatePassiveAddition:
//   Stat2Min int32 `json:"Var6"`
//   Stat2Max int32 `json:"Var7"`
// PassiveSkill:
//   StatIndices []uint32 `json:"Stats"`
//   PassiveSkillGraphID uint32 `json:"PassiveSkillGraphId"`

// Raw JSON types (matching json tag names)
interface RawAlternatePassiveSkill {
  _key: number;
  Id: string;
  AlternateTreeVersionsKey: number;
  Name: string;
  PassiveType?: number[];
  StatsKeys?: number[];
  Stat1Min: number;
  Stat1Max: number;
  Stat2Min: number;
  Stat2Max: number;
  Var9: number; // Stat3Min
  Var10: number; // Stat3Max
  Var11: number; // Stat4Min
  Var12: number; // Stat4Max
  SpawnWeight: number;
  Var18: number; // ConquerorIndex
  RandomMin: number;
  RandomMax: number;
  Var24: number; // ConquerorVersion
}

interface RawAlternatePassiveAddition {
  _key: number;
  Id: string;
  AlternateTreeVersionsKey: number;
  SpawnWeight: number;
  StatsKeys?: number[];
  Stat1Min: number;
  Stat1Max: number;
  Var6: number; // Stat2Min
  Var7: number; // Stat2Max
  PassiveType?: number[];
}

interface RawAlternateTreeVersion {
  _key: number;
  Id: string;
  Var1: boolean; // AreSmallAttributePassiveSkillsReplaced
  Var2: boolean; // AreSmallNormalPassiveSkillsReplaced
  Var5: number; // MinimumAdditions
  Var6: number; // MaximumAdditions
  Var9: number; // NotableReplacementSpawnWeight
}

interface RawPassiveSkill {
  _key: number;
  Id: string;
  Stats?: number[]; // StatIndices
  PassiveSkillGraphId: number;
  Name: string;
  IsKeystone: boolean;
  IsNotable: boolean;
  IsJewelSocket: boolean;
}

interface RawStat {
  _key: number;
  Id: string;
  Text: string;
  Category?: number;
}

// ---- Initialization ----

let _initPromise: Promise<void> | null = null;

export async function initializeData(): Promise<void> {
  if (_initPromise) {
    return _initPromise;
  }
  _initPromise = _doInitialize();
  return _initPromise;
}

async function _doInitialize(): Promise<void> {
  // Use SvelteKit's configured base path so data resolves correctly when the
  // site is served under a sub-path (e.g. GitHub Pages at /timeless-jewels/).
  // Works in both the main thread and the web workers that also load data.
  const base = `${basePath}/data`;

  const [
    rawAPS,
    rawAPA,
    rawATV,
    rawPS,
    rawStats,
    skillTreeText,
    statTransText,
    psStatTransText,
    psAuraStatTransText,
    possibleStatsText
  ] = await Promise.all([
    fetchAndDecompress<RawAlternatePassiveSkill[]>(`${base}/alternate_passive_skills.json.gz`),
    fetchAndDecompress<RawAlternatePassiveAddition[]>(`${base}/alternate_passive_additions.json.gz`),
    fetchAndDecompress<RawAlternateTreeVersion[]>(`${base}/alternate_tree_versions.json.gz`),
    fetchAndDecompress<RawPassiveSkill[]>(`${base}/passive_skills.json.gz`),
    fetchAndDecompress<RawStat[]>(`${base}/stats.json.gz`),
    fetchAndDecompressText(`${base}/SkillTree.json.gz`),
    fetchAndDecompressText(`${base}/stat_descriptions.json.gz`),
    fetchAndDecompressText(`${base}/passive_skill_stat_descriptions.json.gz`),
    fetchAndDecompressText(`${base}/passive_skill_aura_stat_descriptions.json.gz`),
    fetchAndDecompressText(`${base}/possible_stats.json.gz`)
  ]);

  // Map AlternatePassiveSkills
  _alternatePassiveSkills = rawAPS.map((r) =>
    addApsGetStatMinMax({
      Index: r._key,
      ID: r.Id,
      AlternateTreeVersionsKey: r.AlternateTreeVersionsKey,
      Name: r.Name,
      PassiveType: r.PassiveType,
      StatsKeys: r.StatsKeys,
      Stat1Min: r.Stat1Min,
      Stat1Max: r.Stat1Max,
      Stat2Min: r.Stat2Min,
      Stat2Max: r.Stat2Max,
      Stat3Min: r.Var9,
      Stat3Max: r.Var10,
      Stat4Min: r.Var11,
      Stat4Max: r.Var12,
      SpawnWeight: r.SpawnWeight,
      ConquerorIndex: r.Var18,
      RandomMin: r.RandomMin,
      RandomMax: r.RandomMax,
      ConquerorVersion: r.Var24
    })
  );

  for (const aps of _alternatePassiveSkills) {
    idToAlternatePassiveSkill[aps.Index] = aps;
    if (aps.PassiveType) {
      for (const pt of aps.PassiveType) {
        let byVersion = reverseAlternatePassiveSkills.get(pt);
        if (!byVersion) {
          byVersion = new Map();
          reverseAlternatePassiveSkills.set(pt, byVersion);
        }
        const list = byVersion.get(aps.AlternateTreeVersionsKey) ?? [];
        list.push(aps);
        byVersion.set(aps.AlternateTreeVersionsKey, list);
      }
    }
  }

  // Map AlternatePassiveAdditions
  _alternatePassiveAdditions = rawAPA.map((r) =>
    addApaGetStatMinMax({
      Index: r._key,
      ID: r.Id,
      AlternateTreeVersionsKey: r.AlternateTreeVersionsKey,
      SpawnWeight: r.SpawnWeight,
      StatsKeys: r.StatsKeys,
      Stat1Min: r.Stat1Min,
      Stat1Max: r.Stat1Max,
      Stat2Min: r.Var6,
      Stat2Max: r.Var7,
      PassiveType: r.PassiveType
    })
  );

  for (const apa of _alternatePassiveAdditions) {
    idToAlternatePassiveAddition[apa.Index] = apa;
    if (apa.PassiveType) {
      for (const pt of apa.PassiveType) {
        let byVersion = reverseAlternatePassiveAdditions.get(pt);
        if (!byVersion) {
          byVersion = new Map();
          reverseAlternatePassiveAdditions.set(pt, byVersion);
        }
        const list = byVersion.get(apa.AlternateTreeVersionsKey) ?? [];
        list.push(apa);
        byVersion.set(apa.AlternateTreeVersionsKey, list);
      }
    }
  }

  // Map AlternateTreeVersions
  _alternateTreeVersions = rawATV.map(
    (r): AlternateTreeVersion => ({
      Index: r._key,
      ID: r.Id,
      AreSmallAttributePassiveSkillsReplaced: r.Var1,
      AreSmallNormalPassiveSkillsReplaced: r.Var2,
      MinimumAdditions: r.Var5,
      MaximumAdditions: r.Var6,
      NotableReplacementSpawnWeight: r.Var9
    })
  );

  alternateTreeVersions = _alternateTreeVersions;

  for (const atv of _alternateTreeVersions) {
    idToAlternateTreeVersion[atv.Index] = atv;
  }

  // Map PassiveSkills
  _passiveSkills = rawPS.map(
    (r): PassiveSkill => ({
      Index: r._key,
      ID: r.Id,
      StatIndices: r.Stats,
      PassiveSkillGraphID: r.PassiveSkillGraphId,
      Name: r.Name,
      IsKeystone: r.IsKeystone,
      IsNotable: r.IsNotable,
      IsJewelSocket: r.IsJewelSocket
    })
  );

  for (const ps of _passiveSkills) {
    idToPassiveSkill[ps.Index] = ps;
    treeToPassive[ps.PassiveSkillGraphID] = ps;
  }

  // Map Stats
  _stats = rawStats.map(
    (r): Stat => ({
      Index: r._key,
      ID: r.Id,
      Text: r.Text,
      Category: r.Category
    })
  );

  for (const s of _stats) {
    idToStat[s.Index] = s;
  }

  _skillTreeJSON = skillTreeText;
  _statTranslationsJSON = statTransText;
  _passiveSkillStatTranslationsJSON = psStatTransText;
  _passiveSkillAuraStatTranslationsJSON = psAuraStatTransText;
  _possibleStatsJSON = possibleStatsText;
}

// ---- Exported data object (matches index.d.ts API surface exactly) ----

export const data = {
  GetAlternatePassiveAdditionByIndex: (index: number): AlternatePassiveAddition | undefined =>
    idToAlternatePassiveAddition[index],
  GetAlternatePassiveSkillByIndex: (index: number): AlternatePassiveSkill | undefined =>
    idToAlternatePassiveSkill[index],
  GetPassiveSkillByIndex: (index: number): PassiveSkill | undefined => idToPassiveSkill[index],
  GetStatByIndex: (index: number): Stat | undefined => idToStat[index],
  get PassiveSkillAuraStatTranslationsJSON() {
    return _passiveSkillAuraStatTranslationsJSON;
  },
  get PassiveSkillStatTranslationsJSON() {
    return _passiveSkillStatTranslationsJSON;
  },
  get PassiveSkills(): PassiveSkill[] | undefined {
    return _passiveSkills.length > 0 ? _passiveSkills : undefined;
  },
  get PossibleStats() {
    return _possibleStatsJSON;
  },
  get SkillTree() {
    return _skillTreeJSON;
  },
  get StatTranslationsJSON() {
    return _statTranslationsJSON;
  },
  TimelessJewelConquerors: TIMELESS_JEWEL_CONQUERORS as Record<
    number,
    Record<string, TimelessJewelConqueror | undefined> | undefined
  >,
  TimelessJewelSeedRanges: TIMELESS_JEWEL_SEED_RANGES as Record<number, Range>,
  TimelessJewels: TIMELESS_JEWELS as Record<number, string>,
  get TreeToPassive(): Record<number, PassiveSkill> {
    return treeToPassive;
  }
};

export { TIMELESS_JEWEL_SEED_RANGES, TIMELESS_JEWEL_CONQUERORS };
