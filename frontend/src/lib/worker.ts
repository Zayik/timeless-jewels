import { browser } from '$app/environment';
import { base } from '$app/paths';
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

const POOL_KEY = '__timeless_worker_pool__';

// Cap the worker pool. Each worker independently downloads, decompresses, and
// JSON.parses all game data (including the multi-MB SkillTree.json), so the
// pool size directly multiplies boot-time network/CPU and steady-state RAM.
// On high-core machines an uncapped pool (e.g. 24) creates a thundering herd of
// concurrent requests that chokes the dev server and exhausts memory. A modest
// cap keeps real parallelism for the seed search while bounding that cost.
const MAX_POOL_SIZE = 8;

function getWorkerPool(): WorkerData[] {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const existing = (globalThis as any)[POOL_KEY] as WorkerData[] | undefined;
  if (existing) {
    return existing;
  }

  const poolSize = Math.min(navigator.hardwareConcurrency || 4, MAX_POOL_SIZE);
  const pool: WorkerData[] = [];
  for (let i = 0; i < poolSize; i++) {
    const theWorker = new SyncWorker();
    const obj = Comlink.wrap<WorkerType>(theWorker);
    pool.push({ syncWorker: theWorker, syncWrap: obj });
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any)[POOL_KEY] = pool;
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
      boot: async () => {
        // Boot workers in small batches so they don't all fire their data
        // downloads at the same instant (which overwhelms the dev server and
        // spikes memory). Each batch finishes loading before the next starts.
        const BATCH_SIZE = 2;
        for (let i = 0; i < pool.length; i += BATCH_SIZE) {
          const batch = pool.slice(i, i + BATCH_SIZE);
          await Promise.all(batch.map((w) => w.syncWrap.boot(base)));
        }
      },
      search: async (args: ReverseSearchConfig, callback: (seed: number) => void): Promise<SearchResults> => {
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
        callback?: (seed: number) => void
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
        callback: (seed: number) => void
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
