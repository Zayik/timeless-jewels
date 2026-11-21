// PassiveSkillType enum - matches Go internal_types.go iota order exactly:
// None=0, SmallAttribute=1, SmallNormal=2, Notable=3, KeyStone=4, JewelSocket=5
export const enum PassiveSkillType {
  None = 0,
  SmallAttribute = 1,
  SmallNormal = 2,
  Notable = 3,
  KeyStone = 4,
  JewelSocket = 5
}

export interface Stat {
  Index: number;
  ID: string;
  Text: string;
  Category?: number;
}

export interface PassiveSkill {
  Index: number;
  ID: string;
  StatIndices?: number[];
  PassiveSkillGraphID: number;
  Name: string;
  IsKeystone: boolean;
  IsNotable: boolean;
  IsJewelSocket: boolean;
  AscendancyKey?: number | null;
  DescendancyKey?: number | null;
}

// Covers bloodline (descendancy) nodes too; Zorath conquers both.
export function isAscendancyPassive(ps: PassiveSkill): boolean {
  return (ps.AscendancyKey ?? null) !== null || (ps.DescendancyKey ?? null) !== null;
}

export interface AlternateTreeVersion {
  Index: number;
  ID: string;
  AreSmallAttributePassiveSkillsReplaced: boolean;
  AreSmallNormalPassiveSkillsReplaced: boolean;
  // Addition counts are per passive type: Var3/4 small attribute, Var5/6 small normal, Var7/8
  // notable. Templar and Kalguuran carry unequal pairs, but only in arms those jewels never
  // reach; Abyss (Var5/6 = 0, Var7/8 = 1) is the first where the split changes output.
  MinimumAdditionsSmallAttribute: number;
  MaximumAdditionsSmallAttribute: number;
  MinimumAdditions: number;
  MaximumAdditions: number;
  MinimumAdditionsNotable: number;
  MaximumAdditionsNotable: number;
  NotableReplacementSpawnWeight: number;
}

export interface AlternatePassiveSkill {
  Index: number;
  ID: string;
  AlternateTreeVersionsKey: number;
  Name: string;
  PassiveType?: number[];
  StatsKeys?: number[];
  Stat1Min: number;
  Stat1Max: number;
  Stat2Min: number;
  Stat2Max: number;
  Stat3Min: number;
  Stat3Max: number;
  Stat4Min: number;
  Stat4Max: number;
  SpawnWeight: number;
  ConquerorIndex: number;
  RandomMin: number;
  RandomMax: number;
  ConquerorVersion: number;
  GetStatMinMax(isMin: boolean, idx: number): number;
}

export interface AlternatePassiveAddition {
  Index: number;
  ID: string;
  AlternateTreeVersionsKey: number;
  SpawnWeight: number;
  StatsKeys?: number[];
  Stat1Min: number;
  Stat1Max: number;
  Stat2Min: number;
  Stat2Max: number;
  PassiveType?: number[];
  GetStatMinMax(isMin: boolean, idx: number): number;
}

export interface TimelessJewelConqueror {
  Index: number;
  Version: number;
}

export interface Range {
  Min: number;
  Max: number;
  Special: boolean;
}

// StatRolls is a 4-element array (indices 0-3)
export type StatRolls = [number, number, number, number];

export interface AlternatePassiveAdditionInformation {
  AlternatePassiveAddition?: AlternatePassiveAddition;
  StatRolls?: Record<number, number>;
}

export interface AlternatePassiveSkillInformation {
  AlternatePassiveSkill?: AlternatePassiveSkill;
  StatRolls?: Record<number, number>;
  AlternatePassiveAdditionInformations?: AlternatePassiveAdditionInformation[];
}
