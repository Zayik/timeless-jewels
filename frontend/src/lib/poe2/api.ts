// PoE2 read API. Fetches the community dataset through the Cloudflare Worker
// (cached, no auth). Writes live in submit.ts; this file is read-only.

import { workerBase } from './config';
import type { Poe2Jewel, Poe2Reference, ConsensusResult, ReverseSearchResponse } from './types';

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${workerBase()}${path}`);
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = (await res.json()) as { error?: string };
      if (body?.error) {
        detail = body.error;
      }
    } catch {
      /* non-JSON error body */
    }
    throw new Error(`Request failed (${res.status}): ${detail}`);
  }
  return (await res.json()) as T;
}

/** All PoE2 jewel types with seed ranges and conqueror lists. */
export async function getJewels(): Promise<Poe2Jewel[]> {
  const { jewels } = await getJson<{ jewels: Poe2Jewel[] }>('/api/poe2/jewels');
  return jewels;
}

/** Reference data (base tree notables + result vocabulary) for one jewel. */
export async function getReference(jewelId: string): Promise<Poe2Reference> {
  return getJson<Poe2Reference>(`/api/poe2/reference?jewel=${encodeURIComponent(jewelId)}`);
}

/** Recorded consensus transforms for a (jewel, seed). Empty when nothing is recorded yet. */
export async function getConsensus(jewelId: string, seed: number): Promise<ConsensusResult> {
  return getJson<ConsensusResult>(`/api/poe2/consensus?jewel=${encodeURIComponent(jewelId)}&seed=${seed}`);
}

/**
 * Reverse search: every recorded seed that turns some node into one of `notableIds`
 * (the notables' wiki ids = vocab_notables.id). Conqueror-agnostic. Defaults to
 * verified-only (>= 2 distinct clients); pass verifiedOnly=false to include the rest.
 */
export async function reverseSearch(
  jewelId: string,
  notableIds: string[],
  verifiedOnly = true
): Promise<ReverseSearchResponse> {
  const params = new URLSearchParams({ jewel: jewelId, notables: notableIds.join(',') });
  if (!verifiedOnly) {
    params.set('verified', '0');
  }
  return getJson<ReverseSearchResponse>(`/api/poe2/search?${params.toString()}`);
}
