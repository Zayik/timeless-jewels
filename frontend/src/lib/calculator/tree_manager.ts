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
import { PassiveSkillType } from './types';
import {
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

  if (ps.IsNotable) {
    const notableWeight = treeVersion.NotableReplacementSpawnWeight;
    if (notableWeight >= 100) {
      return true;
    }
    if (notableWeight === 0) {
      return false;
    }
    rng.Reset(graphID, seed);
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

  const applicableSkills = getApplicableAlternatePassiveSkills(ps, treeVersionIndex);

  rng.Reset(graphID, seed);

  if (getPassiveSkillType(ps) === PassiveSkillType.Notable) {
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

  const minAdditions = treeVersion.MinimumAdditions + rolledSkill.RandomMin;
  const maxAdditions = treeVersion.MaximumAdditions + rolledSkill.RandomMax;

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

  rng.Reset(graphID, seed);

  if (getPassiveSkillType(ps) === PassiveSkillType.Notable) {
    rng.Generate(0, 100);
  }

  return {
    AlternatePassiveAdditionInformations: rollAdditions(
      treeVersion.MinimumAdditions,
      treeVersion.MaximumAdditions,
      rng,
      ps,
      treeVersionIndex
    )
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
