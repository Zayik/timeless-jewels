// Ported from calculator/tree_manager.go
// Implements passive skill transformation logic using TinyMT32 RNG.

import { NumberGenerator } from './random';
import type {
  PassiveSkill,
  AlternatePassiveSkill,
  AlternatePassiveAddition,
  AlternatePassiveSkillInformation,
  AlternatePassiveAdditionInformation
} from './types';
import type { AlternateTreeVersion } from './types';
import { PassiveSkillType, isAscendancyPassive } from './types';
import {
  FIRST_ABYSS_JEWEL_TYPE,
  getAlternatePassiveSkillsOfType,
  getPassiveSkillType,
  getApplicableAlternatePassiveSkills,
  getApplicableAlternatePassiveAdditions,
  getAlternatePassiveSkillKeyStone,
  alternateTreeVersions
} from './data';

// Convert StatRolls array index to Record<number, number> shape used by the API
function makeStatRolls(arr: number[]): Record<number, number> {
  const result: Record<number, number> = {};
  for (let i = 0; i < arr.length; i++) {
    result[i] = arr[i];
  }
  return result;
}

// Abyss tree versions draw bounded values with MSVC rejection sampling; legion ones use modulo.
function usesMsvcDraw(treeVersionIndex: number): boolean {
  return treeVersionIndex >= FIRST_ABYSS_JEWEL_TYPE;
}

// The candidates for an ascendancy notable, or undefined when the tree version has none. The
// game tags Zorath's special ascendancy notables with PassiveType JewelSocket (5); no legion
// version carries that type, so legion ascendancy nodes are untouched. Graded against Path of
// Building's Zorath LUT: these roll with no notable pre-roll.
function ascendancyAlternatePassiveSkills(
  ps: PassiveSkill,
  treeVersionIndex: number
): AlternatePassiveSkill[] | undefined {
  if (!ps.IsNotable || !isAscendancyPassive(ps)) {
    return undefined;
  }
  return getAlternatePassiveSkillsOfType(PassiveSkillType.JewelSocket, treeVersionIndex);
}

// The addition count range for this passive's type; see AlternateTreeVersion.
function additionRange(ps: PassiveSkill, treeVersion: AlternateTreeVersion): [number, number] {
  switch (getPassiveSkillType(ps)) {
    case PassiveSkillType.SmallAttribute:
      return [treeVersion.MinimumAdditionsSmallAttribute, treeVersion.MaximumAdditionsSmallAttribute];
    case PassiveSkillType.Notable:
      return [treeVersion.MinimumAdditionsNotable, treeVersion.MaximumAdditionsNotable];
    default:
      return [treeVersion.MinimumAdditions, treeVersion.MaximumAdditions];
  }
}

export function isPassiveSkillReplaced(
  rng: NumberGenerator,
  ps: PassiveSkill,
  treeVersionIndex: number,
  seed: number,
  graphID: number
): boolean {
  const treeVersion = alternateTreeVersions.find((v) => v.Index === treeVersionIndex);
  if (!treeVersion) {
    return false;
  }

  if (ps.IsKeystone) {
    return true;
  }

  if (ascendancyAlternatePassiveSkills(ps, treeVersionIndex)) {
    return true;
  }

  if (ps.IsNotable) {
    const notableWeight = treeVersion.NotableReplacementSpawnWeight;
    if (notableWeight >= 100) {
      return true;
    }
    if (notableWeight === 0) {
      return false;
    }
    rng.Reset(graphID, seed, usesMsvcDraw(treeVersionIndex));
    return rng.Generate(0, 100) < notableWeight;
  }

  // Small attribute check: exactly 1 stat index and it is a small-attribute stat
  if (ps.StatIndices && ps.StatIndices.length === 1 && getPassiveSkillType(ps) === PassiveSkillType.SmallAttribute) {
    return treeVersion.AreSmallAttributePassiveSkillsReplaced;
  }

  return treeVersion.AreSmallNormalPassiveSkillsReplaced;
}

export function replacePassiveSkill(
  rng: NumberGenerator,
  ps: PassiveSkill,
  treeVersionIndex: number,
  conquerorIndex: number,
  conquerorVersion: number,
  seed: number,
  graphID: number
): AlternatePassiveSkillInformation {
  const treeVersion = alternateTreeVersions.find((v) => v.Index === treeVersionIndex);
  if (!treeVersion) {
    return {};
  }

  if (ps.IsKeystone) {
    const ks = getAlternatePassiveSkillKeyStone(treeVersionIndex, conquerorIndex, conquerorVersion);
    if (!ks) {
      return {};
    }
    return {
      AlternatePassiveSkill: ks,
      StatRolls: makeStatRolls([ks.Stat1Min])
    };
  }

  let applicableSkills = getApplicableAlternatePassiveSkills(ps, treeVersionIndex);
  let notablePreRoll = getPassiveSkillType(ps) === PassiveSkillType.Notable;
  const ascendancy = ascendancyAlternatePassiveSkills(ps, treeVersionIndex);
  if (ascendancy) {
    applicableSkills = ascendancy;
    notablePreRoll = false;
  }

  rng.Reset(graphID, seed, usesMsvcDraw(treeVersionIndex));

  if (notablePreRoll) {
    rng.Generate(0, 100);
  }

  let rolledSkill: AlternatePassiveSkill | undefined;
  let currentSpawnWeight = 0;

  for (const skill of applicableSkills) {
    currentSpawnWeight = (currentSpawnWeight + skill.SpawnWeight) >>> 0;
    if (rng.GenerateSingle(currentSpawnWeight) < skill.SpawnWeight) {
      rolledSkill = skill;
    }
  }

  if (!rolledSkill) {
    return {};
  }

  const elements = Math.min(rolledSkill.StatsKeys?.length ?? 0, 4);
  const statRollsArr: number[] = [];
  for (let i = 0; i < elements; i++) {
    const min = rolledSkill.GetStatMinMax(true, i);
    const max = rolledSkill.GetStatMinMax(false, i);
    if (max > min) {
      statRollsArr[i] = rng.GenerateSigned(min, max);
    } else {
      statRollsArr[i] = min;
    }
  }

  if (rolledSkill.RandomMin === 0 && rolledSkill.RandomMax === 0) {
    return {
      AlternatePassiveSkill: rolledSkill,
      StatRolls: makeStatRolls(statRollsArr)
    };
  }

  const [baseMin, baseMax] = additionRange(ps, treeVersion);
  const minAdditions = baseMin + rolledSkill.RandomMin;
  const maxAdditions = baseMax + rolledSkill.RandomMax;

  return {
    AlternatePassiveSkill: rolledSkill,
    StatRolls: makeStatRolls(statRollsArr),
    AlternatePassiveAdditionInformations: rollAdditions(minAdditions, maxAdditions, rng, ps, treeVersionIndex)
  };
}

export function augmentPassiveSkill(
  rng: NumberGenerator,
  ps: PassiveSkill,
  treeVersionIndex: number,
  seed: number,
  graphID: number
): AlternatePassiveSkillInformation {
  const treeVersion = alternateTreeVersions.find((v) => v.Index === treeVersionIndex);
  if (!treeVersion) {
    return {};
  }

  rng.Reset(graphID, seed, usesMsvcDraw(treeVersionIndex));

  if (getPassiveSkillType(ps) === PassiveSkillType.Notable) {
    rng.Generate(0, 100);
  }

  const [minAdditions, maxAdditions] = additionRange(ps, treeVersion);
  return {
    AlternatePassiveAdditionInformations: rollAdditions(minAdditions, maxAdditions, rng, ps, treeVersionIndex)
  };
}

function rollAdditions(
  minimumAdditions: number,
  maximumAdditions: number,
  rng: NumberGenerator,
  ps: PassiveSkill,
  treeVersionIndex: number
): AlternatePassiveAdditionInformation[] {
  let additionCount = minimumAdditions;

  if (maximumAdditions > minimumAdditions) {
    additionCount = rng.Generate(minimumAdditions, maximumAdditions);
  }

  const result: AlternatePassiveAdditionInformation[] = [];

  for (let n = 0; n < additionCount; n++) {
    // rollAlternatePassiveAddition only returns undefined when there are no
    // applicable additions (total spawn weight 0). Retrying cannot change that,
    // so stop rolling for this passive rather than looping forever. (The Go
    // original relies on the data always having additions here and would panic
    // on a zero total weight; this guard makes the port safe instead.)
    const rolled = rollAlternatePassiveAddition(rng, ps, treeVersionIndex);
    if (!rolled) {
      break;
    }

    const elements = Math.min(rolled.StatsKeys?.length ?? 0, 2);
    const statRollsArr: number[] = [];
    for (let j = 0; j < elements; j++) {
      const min = rolled.GetStatMinMax(true, j);
      const max = rolled.GetStatMinMax(false, j);
      if (max > min) {
        statRollsArr[j] = rng.GenerateSigned(min, max);
      } else {
        statRollsArr[j] = min;
      }
    }

    result.push({
      AlternatePassiveAddition: rolled,
      StatRolls: makeStatRolls(statRollsArr)
    });
  }

  return result;
}

function rollAlternatePassiveAddition(
  rng: NumberGenerator,
  ps: PassiveSkill,
  treeVersionIndex: number
): AlternatePassiveAddition | undefined {
  const applicableAdditions = getApplicableAlternatePassiveAdditions(ps, treeVersionIndex);

  let totalSpawnWeight = 0;
  for (const addition of applicableAdditions) {
    totalSpawnWeight = (totalSpawnWeight + addition.SpawnWeight) >>> 0;
  }

  let additionRoll = rng.GenerateSingle(totalSpawnWeight);

  for (const addition of applicableAdditions) {
    if (addition.SpawnWeight > additionRoll) {
      return addition;
    }
    additionRoll = (additionRoll - addition.SpawnWeight) >>> 0;
  }

  return undefined;
}
