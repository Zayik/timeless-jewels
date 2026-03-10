import { browser } from "$app/environment";
import SyncWorker from "./sync_worker?worker";
import * as Comlink from "comlink";
import type { WorkerType } from "./sync_worker";
import type { SearchWithSeed, ReverseSearchConfig, SearchResults, MassReverseSearchConfig, MassSearchResults } from "./skill_tree";

interface WorkerData {
  syncWorker: Worker;
  syncWrap: Comlink.Remote<WorkerType>;
}

function getWorkerPool(): WorkerData[] {
  console.log("Creating sync worker pool");
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

export const syncWrap = browser ? {
  boot: (wasm: ArrayBuffer) => {
    return Promise.all(pool.map(w => w.syncWrap.boot(wasm)));
  },
  search: async (args: ReverseSearchConfig, callback: (seed: number) => Promise<void>): Promise<SearchResults> => {
    const numWorkers = pool.length;
    
    // We run the searches in parallel
    const promises = pool.map(async (workerData, index) => {
      return await workerData.syncWrap.search({
        ...args,
        workerId: index,
        numWorkers: numWorkers
      }, callback);
    });

    const results = await Promise.all(promises);

    // Merge grouped results
    const searchGrouped: { [key: number]: SearchWithSeed[] } = {};
    for (const res of results) {
      for (const key of Object.keys(res.grouped)) {
        const numKey = parseInt(key);
        searchGrouped[numKey] = [
          ...(searchGrouped[numKey] || []),
          ...res.grouped[numKey]
        ];
      }
    }

    // Sort grouped lists
    Object.keys(searchGrouped).forEach((key) => {
      const numKey = parseInt(key);
      searchGrouped[numKey] = searchGrouped[numKey].sort((a, b) => b.weight - a.weight);
    });

    // Merge and sort raw results
    const raw = results
      .map(r => r.raw)
      .flat()
      .sort((a, b) => b.weight - a.weight);

    return { raw, grouped: searchGrouped };
  },
  massSearch: async (args: MassReverseSearchConfig, callback: (seed: number) => Promise<void>): Promise<MassSearchResults> => {
    const numWorkers = pool.length;
    
    // We run the searches in parallel
    const promises = pool.map(async (workerData, index) => {
      return await workerData.syncWrap.massSearch({
        ...args,
        workerId: index,
        numWorkers: numWorkers
      }, callback);
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
          socketGrouped[numKey] = [
            ...(socketGrouped[numKey] || []),
            ...resSocketGrouped[numKey]
          ];
        }
      }
    }

    // Sort grouped lists and construct raw lists for each socket
    for (const socketIdStr in massResults) {
      const socketId = parseInt(socketIdStr);
      Object.keys(massResults[socketId].grouped).forEach((key) => {
        const numKey = parseInt(key);
        massResults[socketId].grouped[numKey] = massResults[socketId].grouped[numKey].sort((a, b) => b.weight - a.weight);
      });
      
      massResults[socketId].raw = Object.values(massResults[socketId].grouped)
        .flat()
        .sort((a, b) => b.weight - a.weight);
    }

    return { resultsBySocket: massResults };
  }
} : null;

export const syncWorker = pool.length > 0 ? pool[0].syncWorker : null;
