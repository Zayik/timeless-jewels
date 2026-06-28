// PoE2 reverse search. PoE1 brute-forces seeds with a PRNG; PoE2 has no PRNG, so the
// answer comes from the community-recorded dataset (Neon, via the Worker). This module
// queries the DB for the desired result notables and maps the rows into the SAME
// SearchResults / MassSearchResults shapes the PoE1 result components already render —
// so ResultsPanel / SearchResult(s) / the trade URL builder all work unchanged.
//
// Key id translations:
//   - The UI's "stat" is a synthesized id per result notable; poe2NotableVocabId maps
//     it to the notable's wiki id, which is exactly vocab_notables.id in the DB.
//   - The DB stores nodes by their string id ("Sprint10"); the tree/components use the
//     numeric graph id (node.skill). We translate between them via the loaded tree.

import { skillTree } from '../skill_tree';
import type { StatConfig, SearchResults, SearchWithSeed, MassSearchResults } from '../skill_tree';
import type { Node } from '../skill_tree_types';
import { poe2NotableVocabId } from '../calculator/data';
import { getPoe2Notables } from './jewel_data';
import { reverseSearch, getConsensus } from './api';
import type { ReverseSearchRow } from './types';

// ── id translation maps (built lazily once the PoE2 tree is loaded) ────────────────

// DB node id (string, e.g. "Sprint10") -> tree graph id (number, node.skill).
let nodeIdToSkill: Map<string, number> | undefined;
const getNodeIdToSkill = (): Map<string, number> => {
  if (!nodeIdToSkill || nodeIdToSkill.size === 0) {
    const m = new Map<string, number>();
    for (const node of Object.values(skillTree.nodes)) {
      const n = node as Node & { id?: string };
      if (typeof n.skill === 'number' && typeof n.id === 'string') {
        m.set(n.id, n.skill);
      }
    }
    nodeIdToSkill = m;
  }
  return nodeIdToSkill;
};

// vocab notable id (wiki id, e.g. "kalguur_notable19") -> synthetic UI stat id.
let vocabToStatId: Map<string, number> | undefined;
const getVocabToStatId = (): Map<string, number> => {
  if (!vocabToStatId || vocabToStatId.size === 0) {
    const m = new Map<string, number>();
    for (const key of Object.keys(poe2NotableVocabId)) {
      m.set(poe2NotableVocabId[Number(key)], Number(key));
    }
    vocabToStatId = m;
  }
  return vocabToStatId;
};

/** Resolve selected stats (one per notable) to their DB vocab ids, deduped. */
const resolveVocabIds = (stats: StatConfig[]): string[] => {
  const set = new Set<string>();
  for (const s of stats) {
    const vocab = poe2NotableVocabId[s.id];
    if (vocab) {
      set.add(vocab);
    }
  }
  return [...set];
};

// ── scoring (mirrors sync_worker.ts grouping/trimming so the UI matches PoE1) ──────

/** Apply the PoE1 max-length trim and flatten to `raw`. Mutates/consumes `grouped`. */
const finalize = (grouped: { [key: number]: SearchWithSeed[] }): SearchResults => {
  const maxLen = Math.max(0, ...Object.keys(grouped).map((x) => parseInt(x) || 0));
  for (const lenStr of Object.keys(grouped)) {
    const nLen = parseInt(lenStr);
    grouped[nLen].sort((a, b) => b.weight - a.weight);

    let limit = 100;
    if (maxLen - nLen >= 3) {
      limit = 0;
    } else if (maxLen - nLen === 2) {
      limit = 5;
    } else if (maxLen - nLen === 1) {
      limit = 20;
    }

    if (limit === 0) {
      delete grouped[nLen];
    } else {
      grouped[nLen] = grouped[nLen].slice(0, limit);
    }
  }

  return {
    grouped,
    raw: Object.keys(grouped)
      .map((x) => grouped[parseInt(x)])
      .flat()
      .sort((a, b) => b.weight - a.weight)
  };
};

/**
 * Turn reverse-search rows into a SearchResults for one socket: keep rows whose node
 * is in the socket's affected set and whose notable was requested, group by seed,
 * score by the selected weights, and apply the same min/grouping/trim rules as PoE1.
 */
const scoreSocket = (
  rows: ReverseSearchRow[],
  affectedSkills: number[],
  stats: StatConfig[],
  minTotalWeight: number,
  seedFilter?: Set<number>
): SearchResults => {
  const affected = new Set(affectedSkills);
  const nodeMap = getNodeIdToSkill();

  // The selected notable behind each vocab id (weight/min live here).
  const statByVocab = new Map<string, StatConfig>();
  for (const s of stats) {
    const vocab = poe2NotableVocabId[s.id];
    if (vocab) {
      statByVocab.set(vocab, s);
    }
  }

  // seed -> (skill -> { statId: confirmations }).
  const bySeed = new Map<number, Map<number, Record<string, number>>>();
  for (const r of rows) {
    if (seedFilter && !seedFilter.has(r.seed)) {
      continue;
    }
    const stat = statByVocab.get(r.result_notable_id);
    if (!stat) {
      continue; // not one of the requested notables
    }
    const skill = nodeMap.get(r.node_id);
    if (skill === undefined || !affected.has(skill)) {
      continue; // node not in this socket's radius
    }
    let skillMap = bySeed.get(r.seed);
    if (!skillMap) {
      skillMap = new Map();
      bySeed.set(r.seed, skillMap);
    }
    const cur = skillMap.get(skill) ?? {};
    // A node rarely has two recorded notables; keep the higher confirmation count.
    // (Postgres bigint arrives as a string, so coerce.)
    cur[String(stat.id)] = Math.max(cur[String(stat.id)] ?? 0, Number(r.confirmations) || 0);
    skillMap.set(skill, cur);
  }

  const grouped: { [key: number]: SearchWithSeed[] } = {};
  for (const [seed, skillMap] of bySeed) {
    let weight = 0;
    const statCounts: Record<number, number> = {};
    const skills = [...skillMap].map(([skill, statRolls]) => {
      for (const statIdStr of Object.keys(statRolls)) {
        const statId = parseInt(statIdStr);
        statCounts[statId] = (statCounts[statId] || 0) + 1;
        weight += stats.find((s) => s.id === statId)?.weight || 0;
      }
      return { passive: skill, stats: statRolls };
    });

    if (weight < minTotalWeight) {
      continue;
    }
    // Same semantics as sync_worker: reject if a required stat is missing (min > 0)
    // or present below its min. (`undefined < min` is false, so undefined only fails
    // the first clause.)
    let ok = true;
    for (const stat of stats) {
      const count = statCounts[stat.id];
      if ((count === undefined && stat.min > 0) || (count as number) < stat.min) {
        ok = false;
        break;
      }
    }
    if (!ok) {
      continue;
    }

    const len = skills.length;
    (grouped[len] ??= []).push({ seed, weight, statCounts, skills });
  }

  return finalize(grouped);
};

// ── public API (consumed by routes/poe2/+page.svelte) ──────────────────────────────

/** Reverse search for one socket. `jewelName` is the DB jewel_type (the jewel's name). */
export async function searchSocket(
  jewelName: string,
  stats: StatConfig[],
  affectedSkills: number[],
  minTotalWeight: number,
  seedFilter?: number[]
): Promise<SearchResults> {
  const vocabIds = resolveVocabIds(stats);
  if (vocabIds.length === 0) {
    return { grouped: {}, raw: [] };
  }
  const { results } = await reverseSearch(jewelName, vocabIds);
  return scoreSocket(results, affectedSkills, stats, minTotalWeight, seedFilter && new Set(seedFilter));
}

/** Reverse search across many sockets with a single DB query, bucketed client-side. */
export async function searchAllSockets(
  jewelName: string,
  stats: StatConfig[],
  socketToNodes: { [socketId: number]: number[] },
  minTotalWeight: number,
  seedFilter?: number[]
): Promise<MassSearchResults> {
  const out: MassSearchResults = { resultsBySocket: {} };
  const vocabIds = resolveVocabIds(stats);
  if (vocabIds.length === 0) {
    return out;
  }
  const { results } = await reverseSearch(jewelName, vocabIds);
  const filter = seedFilter && new Set(seedFilter);
  for (const socketIdStr of Object.keys(socketToNodes)) {
    const socketId = parseInt(socketIdStr);
    out.resultsBySocket[socketId] = scoreSocket(results, socketToNodes[socketId], stats, minTotalWeight, filter);
  }
  return out;
}

/**
 * Forward lookup for a single seed: everything that seed is recorded to transform,
 * as a one-seed SearchResults (independent of the selected stats). Used by the
 * "search by seed" button and pasting a jewel.
 */
export async function searchSeed(jewelName: string, seed: number): Promise<SearchResults> {
  const { results } = await getConsensus(jewelName, seed);
  const nodeMap = getNodeIdToSkill();
  const vocabMap = getVocabToStatId();

  const skills: SearchWithSeed['skills'] = [];
  for (const r of results) {
    const skill = nodeMap.get(r.node_id);
    if (skill === undefined) {
      continue;
    }
    const statId = vocabMap.get(r.result_notable_id);
    skills.push({ passive: skill, stats: statId !== undefined ? { [statId]: Number(r.confirmations) || 0 } : {} });
  }

  if (skills.length === 0) {
    return { grouped: {}, raw: [] };
  }
  const one: SearchWithSeed = { seed, weight: skills.length, statCounts: {}, skills };
  return { grouped: { [skills.length]: [one] }, raw: [one] };
}

/** A node's recorded transform for one seed: the notable it becomes, its stat lines, and how
 *  well-confirmed the record is. */
export interface Poe2Transform {
  name: string;
  stats: string[];
  confirmations: number;
  verified: boolean;
}

/**
 * Every recorded transform for a seed, keyed by the tree's numeric graph id (node.skill) so
 * the tree/tooltip can look a node up directly. Resolves each result notable to its stat lines
 * from the loaded jewel data. Drives the PoE2 "show every affected notable transformed" display
 * when a seed is selected — independent of which stat was searched.
 */
export async function getSeedTransforms(
  jewelName: string,
  jewelId: number,
  seed: number
): Promise<Map<number, Poe2Transform>> {
  const { results } = await getConsensus(jewelName, seed);
  const nodeMap = getNodeIdToSkill();
  const statsById = new Map(getPoe2Notables(jewelId).map((n) => [n.id, n.stats]));

  const out = new Map<number, Poe2Transform>();
  for (const r of results) {
    const skill = nodeMap.get(r.node_id);
    if (skill === undefined) {
      continue;
    }
    out.set(skill, {
      name: r.result_notable_name,
      stats: statsById.get(r.result_notable_id) ?? [],
      confirmations: Number(r.confirmations) || 0,
      verified: r.verified
    });
  }
  return out;
}
