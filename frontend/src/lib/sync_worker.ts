import { expose } from 'comlink';
import '../wasm_exec.js';
import { loadSkillTree, passiveToTree } from './skill_tree';
import type {
  SearchWithSeed,
  ReverseSearchConfig,
  SearchResults,
  MassReverseSearchConfig,
  MassSearchResults
} from './skill_tree';
import { calculator, initializeCrystalline } from './types';

const obj = {
  boot(wasm: ArrayBuffer) {
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    const go = new Go();
    WebAssembly.instantiate(wasm, go.importObject).then((result) => {
      go.run(result.instance);

      initializeCrystalline();

      loadSkillTree();
    });
  },
  async search(args: ReverseSearchConfig, callback: (seed: number) => Promise<void>): Promise<SearchResults> {
    const searchResult = await calculator.ReverseSearch(
      args.nodes,
      args.stats.map((s) => s.id),
      args.jewel,
      args.conqueror,
      args.workerId ?? 0,
      args.numWorkers ?? 1,
      callback
    );

    const searchGrouped: { [key: number]: SearchWithSeed[] } = {};
    Object.keys(searchResult).forEach((seedStr) => {
      const seed = parseInt(seedStr);

      let weight = 0;

      const statCounts: Record<number, number> = {};
      const skills = Object.keys(searchResult[seed]).map((skillIDStr) => {
        const skillID = parseInt(skillIDStr);
        Object.keys(searchResult[seed][skillID]).forEach((st) => {
          const n = parseInt(st);
          statCounts[n] = (statCounts[n] || 0) + 1;
          weight += args.stats.find((s) => s.id == n)?.weight || 0;
        });

        return {
          passive: passiveToTree[skillID],
          stats: searchResult[seed][skillID] as { [key: string]: number }
        };
      });

      if (weight < args.minTotalWeight) {
        delete searchResult[seedStr];
        return;
      }

      for (const stat of args.stats) {
        if ((statCounts[stat.id] === undefined && stat.min > 0) || statCounts[stat.id] < stat.min) {
          delete searchResult[seedStr];
          return;
        }
      }

      const len = Object.keys(searchResult[seed]).length;
      if (!searchGrouped[len]) {
        searchGrouped[len] = [];
      }
      searchGrouped[len].push({
        skills: skills,
        seed,
        weight,
        statCounts
      });

      delete searchResult[seedStr];
    });

    const maxLen = Math.max(0, ...Object.keys(searchGrouped).map((x) => parseInt(x) || 0));

    Object.keys(searchGrouped).forEach((len) => {
      const nLen = parseInt(len);
      searchGrouped[nLen] = searchGrouped[nLen].sort((a, b) => b.weight - a.weight);

      let limit = 100;
      if (maxLen - nLen >= 3) {
limit = 0;
} else if (maxLen - nLen === 2) {
limit = 5;
} else if (maxLen - nLen === 1) {
limit = 20;
}

      if (limit === 0) {
        delete searchGrouped[nLen];
      } else {
        searchGrouped[nLen] = searchGrouped[nLen].slice(0, limit);
      }
    });

    calculator.ClearCache();

    return {
      grouped: searchGrouped,
      raw: Object.keys(searchGrouped)
        .map((x) => searchGrouped[parseInt(x)])
        .flat()
        .sort((a, b) => b.weight - a.weight)
    };
  },
  async massSearch(
    args: MassReverseSearchConfig,
    callback: (seed: number) => Promise<void>
  ): Promise<MassSearchResults> {
    console.log('MASS SEARCH ARGS', args);
    const searchResult = await calculator.MassReverseSearch(
      args.socketToNodes,
      args.stats.map((s) => s.id),
      args.jewel,
      args.conqueror,
      args.workerId ?? 0,
      args.numWorkers ?? 1,
      callback
    );

    const massResults: { [socketId: number]: SearchResults } = {};

    for (const socketIdStr in searchResult) {
      const socketId = parseInt(socketIdStr);
      console.log('socket id:', socketIdStr, 'socketSearchResult:', searchResult[socketId]);
      const socketSearchResult = searchResult[socketId];
      if (!socketSearchResult) {
continue;
}

      const searchGrouped: { [key: number]: SearchWithSeed[] } = {};

      // Fast lookup maps
      const seedToConq = new Map<number, string>();
      const seedToPrice = new Map<number, string>();
      args.seeds?.forEach((s, i) => {
        seedToConq.set(s, args.conquerors[i]);
        if (args.prices && args.prices[i]) {
          seedToPrice.set(s, args.prices[i]);
        }
      });

      Object.keys(socketSearchResult).forEach((seedStr) => {
        const seed = parseInt(seedStr);

        let weight = 0;

        const statCounts: Record<number, number> = {};
        const skills = Object.keys(socketSearchResult[seed]!).map((skillIDStr) => {
          const skillID = parseInt(skillIDStr);
          Object.keys(socketSearchResult[seed]![skillID]!).forEach((st) => {
            const n = parseInt(st);
            statCounts[n] = (statCounts[n] || 0) + 1;
            weight += args.stats.find((s) => s.id == n)?.weight || 0;
          });

          return {
            passive: passiveToTree[skillID],
            stats: socketSearchResult[seed]![skillID]! as { [key: string]: number }
          };
        });

        if (weight < args.minTotalWeight) {
          delete socketSearchResult[seedStr];
          return;
        }

        for (const stat of args.stats) {
          if ((statCounts[stat.id] === undefined && stat.min > 0) || statCounts[stat.id] < stat.min) {
            delete socketSearchResult[seedStr];
            return;
          }
        }

        const len = Object.keys(socketSearchResult[seed]!).length;
        if (!searchGrouped[len]) {
          searchGrouped[len] = [];
        }
        searchGrouped[len].push({
          skills: skills,
          seed,
          weight,
          statCounts,
          conqueror: seedToConq.get(seed),
          price: seedToPrice.get(seed)
        });

        delete socketSearchResult[seedStr];
      });

      const maxLen = Math.max(0, ...Object.keys(searchGrouped).map((x) => parseInt(x) || 0));

      Object.keys(searchGrouped).forEach((len) => {
        const nLen = parseInt(len);
        searchGrouped[nLen] = searchGrouped[nLen].sort((a, b) => b.weight - a.weight);

        let limit = 100;
        if (maxLen - nLen >= 3) {
limit = 0;
} else if (maxLen - nLen === 2) {
limit = 5;
} else if (maxLen - nLen === 1) {
limit = 20;
}

        if (limit === 0) {
          delete searchGrouped[nLen];
        } else {
          searchGrouped[nLen] = searchGrouped[nLen].slice(0, limit);
        }
      });

      massResults[socketId] = {
        grouped: searchGrouped,
        raw: Object.keys(searchGrouped)
          .map((x) => searchGrouped[parseInt(x)])
          .flat()
          .sort((a, b) => b.weight - a.weight)
      };
    }
    calculator.ClearCache();
    return { resultsBySocket: massResults };
  },
  async targetedMassSearch(
    args: import('./skill_tree').TargetedMassMarketSearchConfig,
    callback: (seed: number) => Promise<void>
  ): Promise<MassSearchResults> {
    const searchResult = await calculator.TargetedMassMarketSearch(
      args.socketToNodes,
      args.stats.map((s) => s.id),
      args.jewel,
      args.seeds,
      args.conquerors,
      callback
    );

    const massResults: { [socketId: number]: SearchResults } = {};

    for (const socketIdStr in searchResult) {
      const socketId = parseInt(socketIdStr);
      const socketSearchResult = searchResult[socketId];
      if (!socketSearchResult) {
continue;
}

      const searchGrouped: { [key: number]: SearchWithSeed[] } = {};

      // Fast lookup maps
      const seedToConq = new Map<number, string>();
      const seedToPrice = new Map<number, string>();
      const seedToListedAt = new Map<number, string>();
      args.seeds.forEach((s, i) => {
        seedToConq.set(s, args.conquerors[i]);
        if (args.prices && args.prices[i]) {
          seedToPrice.set(s, args.prices[i]);
        }
        if (args.listedAts && args.listedAts[i]) {
          seedToListedAt.set(s, args.listedAts[i]);
        }
      });

      Object.keys(socketSearchResult).forEach((seedStr) => {
        const seed = parseInt(seedStr);
        let weight = 0;
        const statCounts: Record<number, number> = {};
        const skills = Object.keys(socketSearchResult[seed]!).map((skillIDStr) => {
          const skillID = parseInt(skillIDStr);
          Object.keys(socketSearchResult[seed]![skillID]!).forEach((st) => {
            const n = parseInt(st);
            statCounts[n] = (statCounts[n] || 0) + 1;
            weight += args.stats.find((s) => s.id == n)?.weight || 0;
          });

          return {
            passive: passiveToTree[skillID],
            stats: socketSearchResult[seed]![skillID]! as { [key: string]: number }
          };
        });

        if (weight < args.minTotalWeight) {
          delete socketSearchResult[seedStr];
          return;
        }

        for (const stat of args.stats) {
          if ((statCounts[stat.id] === undefined && stat.min > 0) || statCounts[stat.id] < stat.min) {
            delete socketSearchResult[seedStr];
            return;
          }
        }

        const len = Object.keys(socketSearchResult[seed]!).length;
        if (!searchGrouped[len]) {
          searchGrouped[len] = [];
        }
        searchGrouped[len].push({
          skills: skills,
          seed,
          weight,
          statCounts,
          conqueror: seedToConq.get(seed),
          price: seedToPrice.get(seed),
          listedAt: seedToListedAt.get(seed)
        });

        delete socketSearchResult[seedStr];
      });

      const maxLen = Math.max(0, ...Object.keys(searchGrouped).map((x) => parseInt(x) || 0));

      Object.keys(searchGrouped).forEach((len) => {
        const nLen = parseInt(len);
        searchGrouped[nLen] = searchGrouped[nLen].sort((a, b) => b.weight - a.weight);

        let limit = 100;
        if (maxLen - nLen >= 3) {
limit = 0;
} else if (maxLen - nLen === 2) {
limit = 5;
} else if (maxLen - nLen === 1) {
limit = 20;
}

        if (limit === 0) {
          delete searchGrouped[nLen];
        } else {
          searchGrouped[nLen] = searchGrouped[nLen].slice(0, limit);
        }
      });

      massResults[socketId] = {
        grouped: searchGrouped,
        raw: Object.keys(searchGrouped)
          .map((x) => searchGrouped[parseInt(x)])
          .flat()
          .sort((a, b) => b.weight - a.weight)
      };
    }
    calculator.ClearCache();
    return { resultsBySocket: massResults };
  }
} as const;

expose(obj);

export type WorkerType = typeof obj;
