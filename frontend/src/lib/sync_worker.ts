import { expose } from 'comlink';
import '../wasm_exec.js';
import { loadSkillTree, passiveToTree } from './skill_tree';
import type { SearchWithSeed, ReverseSearchConfig, SearchResults, MassReverseSearchConfig, MassSearchResults } from './skill_tree';
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
          stats: searchResult[seed][skillID]
        };
      });

      const len = Object.keys(searchResult[seed]).length;
      searchGrouped[len] = [
        ...(searchGrouped[len] || []),
        {
          skills: skills,
          seed,
          weight,
          statCounts
        }
      ];
    });

    Object.keys(searchGrouped).forEach((len) => {
      const nLen = parseInt(len);
      searchGrouped[nLen] = searchGrouped[nLen].filter((g) => {
        if (g.weight < args.minTotalWeight) {
          return false;
        }

        for (const stat of args.stats) {
          if ((g.statCounts[stat.id] === undefined && stat.min > 0) || g.statCounts[stat.id] < stat.min) {
            return false;
          }
        }

        return true;
      });

      if (Object.keys(searchGrouped[nLen]).length == 0) {
        delete searchGrouped[nLen];
      } else {
        searchGrouped[nLen] = searchGrouped[nLen].sort((a, b) => b.weight - a.weight);
      }
    });

    return {
      grouped: searchGrouped,
      raw: Object.keys(searchGrouped)
        .map((x) => searchGrouped[parseInt(x)])
        .flat()
        .sort((a, b) => b.weight - a.weight)
    };
  },
  async massSearch(args: MassReverseSearchConfig, callback: (seed: number) => Promise<void>): Promise<MassSearchResults> {
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
      if (!socketSearchResult) continue;

      const searchGrouped: { [key: number]: SearchWithSeed[] } = {};
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
            stats: socketSearchResult[seed]![skillID]!
          };
        });

        const len = Object.keys(socketSearchResult[seed]!).length;
        searchGrouped[len] = [
          ...(searchGrouped[len] || []),
          {
            skills: skills,
            seed,
            weight,
            statCounts
          }
        ];
      });

      Object.keys(searchGrouped).forEach((len) => {
        const nLen = parseInt(len);
        searchGrouped[nLen] = searchGrouped[nLen].filter((g) => {
          if (g.weight < args.minTotalWeight) {
            return false;
          }

          for (const stat of args.stats) {
            if ((g.statCounts[stat.id] === undefined && stat.min > 0) || g.statCounts[stat.id] < stat.min) {
              return false;
            }
          }

          return true;
        });

        if (Object.keys(searchGrouped[nLen]).length == 0) {
          delete searchGrouped[nLen];
        } else {
          searchGrouped[nLen] = searchGrouped[nLen].sort((a, b) => b.weight - a.weight);
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

    return { resultsBySocket: massResults };
  }
} as const;

expose(obj);

export type WorkerType = typeof obj;
