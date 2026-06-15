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
}

export interface AlternateTreeVersion {
  Index: number;
  ID: string;
  AreSmallAttributePassiveSkillsReplaced: boolean;
  AreSmallNormalPassiveSkillsReplaced: boolean;
  MinimumAdditions: number;
  MaximumAdditions: number;
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
