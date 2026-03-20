import { browser } from '$app/environment';
import SyncWorker from './sync_worker?worker';
import * as Comlink from 'comlink';
import type { WorkerType } from './sync_worker';
import type {
  SearchWithSeed,
  ReverseSearchConfig,
  SearchResults,
  MassReverseSearchConfig,
  MassSearchResults,
  TargetedMassMarketSearchConfig
} from './skill_tree';

interface WorkerData {
  syncWorker: Worker;
  syncWrap: Comlink.Remote<WorkerType>;
}

function getWorkerPool(): WorkerData[] {
  console.log('Creating sync worker pool');
  const poolSize = navigator.hardwareConcurrency || 4;
  const pool: WorkerData[] = [];
  for (let i = 0; i < poolSize; i++) {
    const theWorker = new SyncWorker();
    const obj = Comlink.wrap<WorkerType>(theWorker);
    pool.push({ syncWorker: theWorker, syncWrap: obj });
  }
  return pool;
}

const pool: WorkerData[] = browser ? getWorkerPool() : [];

function mergeAndTrimSocketResults(
  target: { [socketId: number]: SearchResults },
  source: { [socketId: number]: SearchResults }
): void {
  for (const socketIdStr in source) {
    const socketId = parseInt(socketIdStr);
    if (!target[socketId]) {
      target[socketId] = { grouped: {}, raw: [] };
    }
    const tGrouped = target[socketId].grouped;
    const sGrouped = source[socketId].grouped;
    for (const key of Object.keys(sGrouped)) {
      const n = parseInt(key);
      tGrouped[n] = [...(tGrouped[n] || []), ...sGrouped[n]];
    }
    const maxLen = Math.max(0, ...Object.keys(tGrouped).map((x) => parseInt(x) || 0));
    for (const key of Object.keys(tGrouped)) {
      const n = parseInt(key);
      tGrouped[n] = tGrouped[n].sort((a, b) => b.weight - a.weight);
      let limit = 100;
      if (maxLen - n >= 3) {
        limit = 0;
      } else if (maxLen - n === 2) {
        limit = 5;
      } else if (maxLen - n === 1) {
        limit = 20;
      }
      if (limit === 0) {
        delete tGrouped[n];
      } else {
        tGrouped[n] = tGrouped[n].slice(0, limit);
      }
    }
    target[socketId].raw = Object.values(target[socketId].grouped)
      .flat()
      .sort((a, b) => b.weight - a.weight);
  }
}

export const syncWrap = browser
  ? {
      boot: (wasm: ArrayBuffer) => Promise.all(pool.map((w) => w.syncWrap.boot(wasm))),
      search: async (args: ReverseSearchConfig, callback: (seed: number) => Promise<void>): Promise<SearchResults> => {
        const numWorkers = pool.length;

        // We run the searches in parallel
        const promises = pool.map(
          async (workerData, index) =>
            await workerData.syncWrap.search(
              {
                ...args,
                workerId: index,
                numWorkers: numWorkers
              },
              callback
            )
        );

        const results = await Promise.all(promises);

        // Merge grouped results
        const searchGrouped: { [key: number]: SearchWithSeed[] } = {};
        for (const res of results) {
          for (const key of Object.keys(res.grouped)) {
            const numKey = parseInt(key);
            searchGrouped[numKey] = [...(searchGrouped[numKey] || []), ...res.grouped[numKey]];
          }
        }

        // Sort grouped lists
        const maxLen = Math.max(0, ...Object.keys(searchGrouped).map((x) => parseInt(x) || 0));

        Object.keys(searchGrouped).forEach((key) => {
          const numKey = parseInt(key);
          searchGrouped[numKey] = searchGrouped[numKey].sort((a, b) => b.weight - a.weight);

          let limit = 100;
          if (maxLen - numKey >= 3) {
            limit = 0;
          } else if (maxLen - numKey === 2) {
            limit = 5;
          } else if (maxLen - numKey === 1) {
            limit = 20;
          }

          if (limit === 0) {
            delete searchGrouped[numKey];
          } else {
            searchGrouped[numKey] = searchGrouped[numKey].slice(0, limit);
          }
        });

        // Merge and sort raw results
        const raw = Object.values(searchGrouped)
          .flat()
          .sort((a, b) => b.weight - a.weight);

        return { raw, grouped: searchGrouped };
      },
      massSearch: async (
        args: MassReverseSearchConfig,
        callback: (seed: number) => Promise<void>
      ): Promise<MassSearchResults> => {
        const numWorkers = pool.length;

        // We run the searches in parallel
        const promises = pool.map(
          async (workerData, index) =>
            await workerData.syncWrap.massSearch(
              {
                ...args,
                workerId: index,
                numWorkers: numWorkers
              },
              callback
            )
        );

        const results = await Promise.all(promises);

        const massResults: { [socketId: number]: SearchResults } = {};

        for (const res of results) {
          for (const socketIdStr in res.resultsBySocket) {
            const socketId = parseInt(socketIdStr);
            if (!massResults[socketId]) {
              massResults[socketId] = { grouped: {}, raw: [] };
            }

            const socketGrouped = massResults[socketId].grouped;
            const resSocketGrouped = res.resultsBySocket[socketId].grouped;

            for (const key of Object.keys(resSocketGrouped)) {
              const numKey = parseInt(key);
              socketGrouped[numKey] = [...(socketGrouped[numKey] || []), ...resSocketGrouped[numKey]];
            }
          }
        }

        // Sort grouped lists and construct raw lists for each socket
        for (const socketIdStr in massResults) {
          const socketId = parseInt(socketIdStr);
          const maxLen = Math.max(0, ...Object.keys(massResults[socketId].grouped).map((x) => parseInt(x) || 0));

          Object.keys(massResults[socketId].grouped).forEach((key) => {
            const numKey = parseInt(key);
            massResults[socketId].grouped[numKey] = massResults[socketId].grouped[numKey].sort(
              (a, b) => b.weight - a.weight
            );

            let limit = 100;
            if (maxLen - numKey >= 3) {
              limit = 0;
            } else if (maxLen - numKey === 2) {
              limit = 5;
            } else if (maxLen - numKey === 1) {
              limit = 20;
            }

            if (limit === 0) {
              delete massResults[socketId].grouped[numKey];
            } else {
              massResults[socketId].grouped[numKey] = massResults[socketId].grouped[numKey].slice(0, limit);
            }
          });

          massResults[socketId].raw = Object.values(massResults[socketId].grouped)
            .flat()
            .sort((a, b) => b.weight - a.weight);
        }

        return { resultsBySocket: massResults };
      },
      targetedMassSearch: async (
        args: TargetedMassMarketSearchConfig,
        callback: (seed: number) => Promise<void>
      ): Promise<MassSearchResults> => {
        const numWorkers = pool.length;
        const chunkSize = Math.ceil(args.seeds.length / numWorkers);

        const promises = pool.map(async (workerData, index) => {
          const start = index * chunkSize;
          const end = Math.min(start + chunkSize, args.seeds.length);
          if (start >= args.seeds.length) {
            return { resultsBySocket: {} };
          }
          return await workerData.syncWrap.targetedMassSearch(
            {
              ...args,
              seeds: args.seeds.slice(start, end),
              conquerors: args.conquerors.slice(start, end),
              prices: args.prices?.slice(start, end)
            },
            callback
          );
        });

        const results = await Promise.all(promises);

        const massResults: { [socketId: number]: SearchResults } = {};

        for (const res of results) {
          for (const socketIdStr in res.resultsBySocket) {
            const socketId = parseInt(socketIdStr);
            if (!massResults[socketId]) {
              massResults[socketId] = { grouped: {}, raw: [] };
            }
            const socketGrouped = massResults[socketId].grouped;
            const resSocketGrouped = res.resultsBySocket[socketId].grouped;
            for (const key of Object.keys(resSocketGrouped)) {
              const numKey = parseInt(key);
              socketGrouped[numKey] = [...(socketGrouped[numKey] || []), ...resSocketGrouped[numKey]];
            }
          }
        }

        for (const socketIdStr in massResults) {
          const socketId = parseInt(socketIdStr);
          const maxLen = Math.max(0, ...Object.keys(massResults[socketId].grouped).map((x) => parseInt(x) || 0));

          Object.keys(massResults[socketId].grouped).forEach((key) => {
            const numKey = parseInt(key);
            massResults[socketId].grouped[numKey] = massResults[socketId].grouped[numKey].sort(
              (a, b) => b.weight - a.weight
            );

            let limit = 100;
            if (maxLen - numKey >= 3) {
              limit = 0;
            } else if (maxLen - numKey === 2) {
              limit = 5;
            } else if (maxLen - numKey === 1) {
              limit = 20;
            }

            if (limit === 0) {
              delete massResults[socketId].grouped[numKey];
            } else {
              massResults[socketId].grouped[numKey] = massResults[socketId].grouped[numKey].slice(0, limit);
            }
          });

          massResults[socketId].raw = Object.values(massResults[socketId].grouped)
            .flat()
            .sort((a, b) => b.weight - a.weight);
        }

        return { resultsBySocket: massResults };
      },
      mergeMassResults: (a: MassSearchResults, b: MassSearchResults): MassSearchResults => {
        const merged: { [socketId: number]: SearchResults } = {};
        for (const socketIdStr in a.resultsBySocket) {
          const socketId = parseInt(socketIdStr);
          const src = a.resultsBySocket[socketId];
          merged[socketId] = {
            grouped: Object.fromEntries(Object.entries(src.grouped).map(([k, v]) => [k, [...v]])),
            raw: [...src.raw]
          };
        }
        mergeAndTrimSocketResults(merged, b.resultsBySocket);
        return { resultsBySocket: merged };
      }
    }
  : null;

export const syncWorker = pool.length > 0 ? pool[0].syncWorker : null;
