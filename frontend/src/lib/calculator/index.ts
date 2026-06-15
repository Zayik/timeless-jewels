// Calculator - ported from calculator/main.go
// Main calculation engine: Calculate, ReverseSearch, MassReverseSearch, etc.

import { NumberGenerator } from './random';
import {
  TIMELESS_JEWEL_SEED_RANGES,
  TIMELESS_JEWEL_CONQUERORS,
  isPassiveSkillValidForAlteration,
  idToPassiveSkill,
  alternateTreeVersions
} from './data';
import type { PassiveSkill, AlternatePassiveSkillInformation } from './types';
import { isPassiveSkillReplaced, replacePassiveSkill, augmentPassiveSkill } from './tree_manager';

// Cache structure: conqueror -> jewelType -> realSeed -> passiveIndex -> result
const calculationCache = new Map<string, Map<number, Map<number, Map<number, AlternatePassiveSkillInformation>>>>();

// ElegantHubris jewelType value
const ELEGANT_HUBRIS = 5;

function getSeed(seed: number, jewelType: number): number {
  // Go: TimelessJewel.GetSeed() divides by 20 for ElegantHubris
  if (jewelType === ELEGANT_HUBRIS) {
    return (seed / 20) | 0;
  }
  return seed;
}

function Calculate(
  passiveID: number,
  seed: number,
  timelessJewelType: number,
  conqueror: string
): AlternatePassiveSkillInformation {
  const ps = idToPassiveSkill[passiveID];
  if (!isPassiveSkillValidForAlteration(ps)) {
    return {};
  }

  // Go: GetAlternateTreeVersionIndex(uint32(timelessJewelType))
  const treeVersion = alternateTreeVersions.find((v) => v.Index === timelessJewelType);
  if (!treeVersion) {
    return {};
  }

  const conquerorInfo = TIMELESS_JEWEL_CONQUERORS[timelessJewelType]?.[conqueror];
  if (!conquerorInfo) {
    return {};
  }

  // ElegantHubris uses seed/20 for RNG
  const rngSeed = getSeed(seed, timelessJewelType);

  const rng = new NumberGenerator();

  if (isPassiveSkillReplaced(rng, ps, timelessJewelType, rngSeed, ps.PassiveSkillGraphID)) {
    return replacePassiveSkill(
      rng,
      ps,
      timelessJewelType,
      conquerorInfo.Index,
      conquerorInfo.Version,
      rngSeed,
      ps.PassiveSkillGraphID
    );
  }

  return augmentPassiveSkill(rng, ps, timelessJewelType, rngSeed, ps.PassiveSkillGraphID);
}

function computeForSkill(
  rng: NumberGenerator,
  ps: PassiveSkill,
  treeVersionIndex: number,
  conquerorIndex: number,
  conquerorVersion: number,
  rngSeed: number
): AlternatePassiveSkillInformation {
  if (isPassiveSkillReplaced(rng, ps, treeVersionIndex, rngSeed, ps.PassiveSkillGraphID)) {
    return replacePassiveSkill(
      rng,
      ps,
      treeVersionIndex,
      conquerorIndex,
      conquerorVersion,
      rngSeed,
      ps.PassiveSkillGraphID
    );
  }
  return augmentPassiveSkill(rng, ps, treeVersionIndex, rngSeed, ps.PassiveSkillGraphID);
}

function ReverseSearch(
  passiveIDs: number[] | undefined,
  statIDs: number[] | undefined,
  timelessJewelType: number,
  conqueror: string,
  workerID: number,
  numWorkers: number,
  updates: (n: number) => void
): Promise<Record<number, Record<number, Record<number, number> | undefined> | undefined> | undefined> {
  const passiveSkills = new Map<number, PassiveSkill>();
  for (const id of passiveIDs ?? []) {
    const skill = idToPassiveSkill[id];
    if (isPassiveSkillValidForAlteration(skill)) {
      passiveSkills.set(id, skill);
    }
  }

  const treeVersion = alternateTreeVersions.find((v) => v.Index === timelessJewelType);
  if (!treeVersion) {
    return Promise.resolve(undefined);
  }

  const conquerorInfo = TIMELESS_JEWEL_CONQUERORS[timelessJewelType]?.[conqueror];
  if (!conquerorInfo) {
    return Promise.resolve(undefined);
  }

  const statMap = new Set<number>(statIDs ?? []);

  const range = TIMELESS_JEWEL_SEED_RANGES[timelessJewelType];
  const special = range?.Special ?? false;

  let seedMin = range?.Min ?? 0;
  let seedMax = range?.Max ?? 0;

  if (special) {
    seedMin = (seedMin / 20) | 0;
    seedMax = (seedMax / 20) | 0;
  }

  const actualNumWorkers = numWorkers > 0 ? numWorkers : 1;
  const seedRange = seedMax - seedMin + 1;
  const chunkSize = (seedRange / actualNumWorkers) | 0;

  const startSeed = seedMin + workerID * chunkSize;
  let endSeed = startSeed + chunkSize - 1;
  if (workerID === actualNumWorkers - 1) {
    endSeed = seedMax;
  }

  // Get or create cache for this conqueror/jewelType
  let conquerorCache = calculationCache.get(conqueror);
  if (!conquerorCache) {
    conquerorCache = new Map();
    calculationCache.set(conqueror, conquerorCache);
  }
  let jewelCache = conquerorCache.get(timelessJewelType);
  if (!jewelCache) {
    jewelCache = new Map();
    conquerorCache.set(timelessJewelType, jewelCache);
  }

  const results: Record<number, Record<number, Record<number, number>>> = {};
  const rng = new NumberGenerator();

  return (async () => {
    for (let seed = startSeed; seed <= endSeed; seed++) {
      const realSeed = special ? seed * 20 : seed;

      if (seed % 100 === 0 && updates) {
        updates(realSeed);
      }

      const rngSeed = special ? seed : realSeed;

      let seedCache = jewelCache!.get(realSeed);
      if (!seedCache) {
        seedCache = new Map();
        jewelCache!.set(realSeed, seedCache);
      }

      for (const [, skill] of passiveSkills) {
        let result: AlternatePassiveSkillInformation;
        if (seedCache.has(skill.Index)) {
          result = seedCache.get(skill.Index)!;
        } else {
          result = computeForSkill(rng, skill, timelessJewelType, conquerorInfo.Index, conquerorInfo.Version, rngSeed);
          seedCache.set(skill.Index, result);
        }

        let skillResults: Record<number, number> | undefined;

        if (result.AlternatePassiveSkill) {
          const statsKeys = result.AlternatePassiveSkill.StatsKeys ?? [];
          const statRolls = result.StatRolls ?? {};
          for (let i = 0; i < statsKeys.length; i++) {
            const key = statsKeys[i];
            if (statMap.has(key)) {
              if (!skillResults) {
                if (!results[realSeed]) {
                  results[realSeed] = {};
                }
                if (!results[realSeed][skill.Index]) {
                  results[realSeed][skill.Index] = {};
                }
                skillResults = results[realSeed][skill.Index];
              }
              skillResults[key] = statRolls[i] ?? 0;
            }
          }
        }

        for (const augment of result.AlternatePassiveAdditionInformations ?? []) {
          if (augment.AlternatePassiveAddition) {
            const statsKeys = augment.AlternatePassiveAddition.StatsKeys ?? [];
            const statRolls = augment.StatRolls ?? {};
            for (let i = 0; i < statsKeys.length; i++) {
              const key = statsKeys[i];
              if (statMap.has(key)) {
                if (!skillResults) {
                  if (!results[realSeed]) {
                    results[realSeed] = {};
                  }
                  if (!results[realSeed][skill.Index]) {
                    results[realSeed][skill.Index] = {};
                  }
                  skillResults = results[realSeed][skill.Index];
                }
                skillResults[key] = statRolls[i] ?? 0;
              }
            }
          }
        }
      }
    }

    return results as Record<number, Record<number, Record<number, number> | undefined> | undefined>;
  })();
}

function MassReverseSearch(
  scion: Record<number, number[] | undefined> | undefined,
  statIDs: number[] | undefined,
  timelessJewelType: number,
  conqueror: string,
  workerID: number,
  numWorkers: number,
  updates?: (n: number) => void
): Promise<
  Record<number, Record<number, Record<number, Record<number, number> | undefined> | undefined> | undefined> | undefined
> {
  const uniquePassives = new Map<number, PassiveSkill>();
  const passiveToSockets = new Map<number, number[]>();

  for (const [socketIDStr, passives] of Object.entries(scion ?? {})) {
    const socketID = parseInt(socketIDStr);
    for (const id of passives ?? []) {
      if (!uniquePassives.has(id)) {
        const skill = idToPassiveSkill[id];
        if (isPassiveSkillValidForAlteration(skill)) {
          uniquePassives.set(id, skill);
        }
      }
      if (uniquePassives.has(id)) {
        const sockets = passiveToSockets.get(id) ?? [];
        sockets.push(socketID);
        passiveToSockets.set(id, sockets);
      }
    }
  }

  const treeVersion = alternateTreeVersions.find((v) => v.Index === timelessJewelType);
  if (!treeVersion) {
    return Promise.resolve(undefined);
  }

  const conquerorInfo = TIMELESS_JEWEL_CONQUERORS[timelessJewelType]?.[conqueror];
  if (!conquerorInfo) {
    return Promise.resolve(undefined);
  }

  const statMap = new Set<number>(statIDs ?? []);

  const range = TIMELESS_JEWEL_SEED_RANGES[timelessJewelType];
  const special = range?.Special ?? false;

  let seedMin = range?.Min ?? 0;
  let seedMax = range?.Max ?? 0;

  if (special) {
    seedMin = (seedMin / 20) | 0;
    seedMax = (seedMax / 20) | 0;
  }

  const actualNumWorkers = numWorkers > 0 ? numWorkers : 1;
  const seedRange = seedMax - seedMin + 1;
  const chunkSize = (seedRange / actualNumWorkers) | 0;

  const startSeed = seedMin + workerID * chunkSize;
  let endSeed = startSeed + chunkSize - 1;
  if (workerID === actualNumWorkers - 1) {
    endSeed = seedMax;
  }

  const results: Record<number, Record<number, Record<number, Record<number, number>>>> = {};
  const rng = new NumberGenerator();

  return (async () => {
    for (let seed = startSeed; seed <= endSeed; seed++) {
      const realSeed = special ? seed * 20 : seed;

      if (seed % 100 === 0 && updates) {
        updates(realSeed);
      }

      const rngSeed = special ? seed : realSeed;

      for (const [, skill] of uniquePassives) {
        const result = computeForSkill(
          rng,
          skill,
          timelessJewelType,
          conquerorInfo.Index,
          conquerorInfo.Version,
          rngSeed
        );
        const sockets = passiveToSockets.get(skill.Index) ?? [];

        if (result.AlternatePassiveSkill) {
          const statsKeys = result.AlternatePassiveSkill.StatsKeys ?? [];
          const statRolls = result.StatRolls ?? {};
          for (let i = 0; i < statsKeys.length; i++) {
            const key = statsKeys[i];
            if (statMap.has(key)) {
              for (const socketID of sockets) {
                if (!results[socketID]) {
                  results[socketID] = {};
                }
                if (!results[socketID][realSeed]) {
                  results[socketID][realSeed] = {};
                }
                if (!results[socketID][realSeed][skill.Index]) {
                  results[socketID][realSeed][skill.Index] = {};
                }
                results[socketID][realSeed][skill.Index][key] = statRolls[i] ?? 0;
              }
            }
          }
        }

        for (const augment of result.AlternatePassiveAdditionInformations ?? []) {
          if (augment.AlternatePassiveAddition) {
            const statsKeys = augment.AlternatePassiveAddition.StatsKeys ?? [];
            const statRolls = augment.StatRolls ?? {};
            for (let i = 0; i < statsKeys.length; i++) {
              const key = statsKeys[i];
              if (statMap.has(key)) {
                for (const socketID of sockets) {
                  if (!results[socketID]) {
                    results[socketID] = {};
                  }
                  if (!results[socketID][realSeed]) {
                    results[socketID][realSeed] = {};
                  }
                  if (!results[socketID][realSeed][skill.Index]) {
                    results[socketID][realSeed][skill.Index] = {};
                  }
                  results[socketID][realSeed][skill.Index][key] = statRolls[i] ?? 0;
                }
              }
            }
          }
        }
      }
    }

    return results as Record<
      number,
      Record<number, Record<number, Record<number, number> | undefined> | undefined> | undefined
    >;
  })();
}

function TargetedMarketSearch(
  passiveIDs: number[] | undefined,
  statIDs: number[] | undefined,
  timelessJewelType: number,
  seeds: number[] | undefined,
  conquerors: string[] | undefined,
  updates: (n: number) => void
): Promise<Record<number, Record<number, Record<number, number> | undefined> | undefined> | undefined> {
  const passiveSkills = new Map<number, PassiveSkill>();
  for (const id of passiveIDs ?? []) {
    const skill = idToPassiveSkill[id];
    if (isPassiveSkillValidForAlteration(skill)) {
      passiveSkills.set(id, skill);
    }
  }

  const treeVersion = alternateTreeVersions.find((v) => v.Index === timelessJewelType);
  if (!treeVersion) {
    return Promise.resolve(undefined);
  }

  const statMap = new Set<number>(statIDs ?? []);
  const special = TIMELESS_JEWEL_SEED_RANGES[timelessJewelType]?.Special ?? false;

  const results: Record<number, Record<number, Record<number, number>>> = {};
  const rng = new NumberGenerator();

  return (async () => {
    const seedList = seeds ?? [];
    const conquerorList = conquerors ?? [];

    for (let i = 0; i < seedList.length; i++) {
      const seed = seedList[i];
      const conqueror = conquerorList[i];

      const realSeed = special ? seed * 20 : seed;
      const rngSeed = special ? seed : realSeed;

      if (i % 100 === 0 && updates) {
        updates(realSeed);
      }

      const conquerorInfo = TIMELESS_JEWEL_CONQUERORS[timelessJewelType]?.[conqueror];
      if (!conquerorInfo) {
        continue;
      }

      for (const [, skill] of passiveSkills) {
        const result = computeForSkill(
          rng,
          skill,
          timelessJewelType,
          conquerorInfo.Index,
          conquerorInfo.Version,
          rngSeed
        );

        if (result.AlternatePassiveSkill) {
          const statsKeys = result.AlternatePassiveSkill.StatsKeys ?? [];
          const statRolls = result.StatRolls ?? {};
          for (let j = 0; j < statsKeys.length; j++) {
            const key = statsKeys[j];
            if (statMap.has(key)) {
              if (!results[realSeed]) {
                results[realSeed] = {};
              }
              if (!results[realSeed][skill.Index]) {
                results[realSeed][skill.Index] = {};
              }
              results[realSeed][skill.Index][key] = statRolls[j] ?? 0;
            }
          }
        }

        for (const augment of result.AlternatePassiveAdditionInformations ?? []) {
          if (augment.AlternatePassiveAddition) {
            const statsKeys = augment.AlternatePassiveAddition.StatsKeys ?? [];
            const statRolls = augment.StatRolls ?? {};
            for (let j = 0; j < statsKeys.length; j++) {
              const key = statsKeys[j];
              if (statMap.has(key)) {
                if (!results[realSeed]) {
                  results[realSeed] = {};
                }
                if (!results[realSeed][skill.Index]) {
                  results[realSeed][skill.Index] = {};
                }
                results[realSeed][skill.Index][key] = statRolls[j] ?? 0;
              }
            }
          }
        }
      }
    }

    return results as Record<number, Record<number, Record<number, number> | undefined> | undefined>;
  })();
}

function TargetedMassMarketSearch(
  scion: Record<number, number[] | undefined> | undefined,
  statIDs: number[] | undefined,
  timelessJewelType: number,
  seeds: number[] | undefined,
  conquerors: string[] | undefined,
  updates: (n: number) => void
): Promise<
  Record<number, Record<number, Record<number, Record<number, number> | undefined> | undefined> | undefined> | undefined
> {
  const uniquePassives = new Map<number, PassiveSkill>();
  const passiveToSockets = new Map<number, number[]>();

  for (const [socketIDStr, passives] of Object.entries(scion ?? {})) {
    const socketID = parseInt(socketIDStr);
    for (const id of passives ?? []) {
      if (!uniquePassives.has(id)) {
        const skill = idToPassiveSkill[id];
        if (isPassiveSkillValidForAlteration(skill)) {
          uniquePassives.set(id, skill);
        }
      }
      if (uniquePassives.has(id)) {
        const sockets = passiveToSockets.get(id) ?? [];
        sockets.push(socketID);
        passiveToSockets.set(id, sockets);
      }
    }
  }

  const treeVersion = alternateTreeVersions.find((v) => v.Index === timelessJewelType);
  if (!treeVersion) {
    return Promise.resolve(undefined);
  }

  const statMap = new Set<number>(statIDs ?? []);
  const special = TIMELESS_JEWEL_SEED_RANGES[timelessJewelType]?.Special ?? false;

  const results: Record<number, Record<number, Record<number, Record<number, number>>>> = {};
  const rng = new NumberGenerator();

  return (async () => {
    const seedList = seeds ?? [];
    const conquerorList = conquerors ?? [];

    for (let i = 0; i < seedList.length; i++) {
      const seed = seedList[i];
      const conqueror = conquerorList[i];

      const realSeed = special ? seed * 20 : seed;
      const rngSeed = special ? seed : realSeed;

      if (i % 100 === 0 && updates) {
        updates(realSeed);
      }

      const conquerorInfo = TIMELESS_JEWEL_CONQUERORS[timelessJewelType]?.[conqueror];
      if (!conquerorInfo) {
        continue;
      }

      for (const [, skill] of uniquePassives) {
        const result = computeForSkill(
          rng,
          skill,
          timelessJewelType,
          conquerorInfo.Index,
          conquerorInfo.Version,
          rngSeed
        );
        const sockets = passiveToSockets.get(skill.Index) ?? [];

        if (result.AlternatePassiveSkill) {
          const statsKeys = result.AlternatePassiveSkill.StatsKeys ?? [];
          const statRolls = result.StatRolls ?? {};
          for (let j = 0; j < statsKeys.length; j++) {
            const key = statsKeys[j];
            if (statMap.has(key)) {
              for (const socketID of sockets) {
                if (!results[socketID]) {
                  results[socketID] = {};
                }
                if (!results[socketID][realSeed]) {
                  results[socketID][realSeed] = {};
                }
                if (!results[socketID][realSeed][skill.Index]) {
                  results[socketID][realSeed][skill.Index] = {};
                }
                results[socketID][realSeed][skill.Index][key] = statRolls[j] ?? 0;
              }
            }
          }
        }

        for (const augment of result.AlternatePassiveAdditionInformations ?? []) {
          if (augment.AlternatePassiveAddition) {
            const statsKeys = augment.AlternatePassiveAddition.StatsKeys ?? [];
            const statRolls = augment.StatRolls ?? {};
            for (let j = 0; j < statsKeys.length; j++) {
              const key = statsKeys[j];
              if (statMap.has(key)) {
                for (const socketID of sockets) {
                  if (!results[socketID]) {
                    results[socketID] = {};
                  }
                  if (!results[socketID][realSeed]) {
                    results[socketID][realSeed] = {};
                  }
                  if (!results[socketID][realSeed][skill.Index]) {
                    results[socketID][realSeed][skill.Index] = {};
                  }
                  results[socketID][realSeed][skill.Index][key] = statRolls[j] ?? 0;
                }
              }
            }
          }
        }
      }
    }

    return results as Record<
      number,
      Record<number, Record<number, Record<number, number> | undefined> | undefined> | undefined
    >;
  })();
}

function ClearCache(): void {
  calculationCache.clear();
}

export const calculator = {
  Calculate,
  ClearCache,
  MassReverseSearch,
  ReverseSearch,
  TargetedMarketSearch,
  TargetedMassMarketSearch
};
