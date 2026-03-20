import type { MarketJewel } from './market_cache';
import { data } from './types';

const MAX_FETCH_SIZE = 10;
const SEARCH_PAGE_SIZE = 100;
const STALE_THRESHOLD_MS = 7 * 24 * 60 * 60 * 1000;

const INDEXED_WINDOWS: Array<{ option: string; ms: number }> = [
  { option: '1hour', ms: 1 * 60 * 60 * 1000 },
  { option: '3hours', ms: 3 * 60 * 60 * 1000 },
  { option: '12hours', ms: 12 * 60 * 60 * 1000 },
  { option: '1day', ms: 1 * 24 * 60 * 60 * 1000 },
  { option: '3days', ms: 3 * 24 * 60 * 60 * 1000 },
  { option: '1week', ms: 7 * 24 * 60 * 60 * 1000 }
];

const pickIndexedWindow = (lastSyncDate: string): string => {
  const elapsed = Date.now() - new Date(lastSyncDate).getTime();
  // Add a 20% buffer so we don't clip listings right at the boundary
  const needed = elapsed * 1.2;
  return (INDEXED_WINDOWS.find((w) => w.ms >= needed) ?? INDEXED_WINDOWS[INDEXED_WINDOWS.length - 1]).option;
};
// Max seed gap between two cached seeds before we split them into separate range queries
const SEED_CLUSTER_GAP = 50;

const JEWEL_CONQUERORS: Record<number, string[]> = {
  1: ['xibaqua', 'zerphi', 'ahuana', 'doryani'],
  2: ['kaom', 'rakiata', 'kiloava', 'akoya'],
  3: ['deshret', 'balbala', 'asenath', 'nasima'],
  4: ['venarius', 'maxarius', 'dominus', 'avarius'],
  5: ['cadiro', 'victario', 'chitus', 'caspiro'],
  6: ['vorana', 'uhtred', 'medved']
};

export { JEWEL_CONQUERORS };

const delay = (ms: number) => new Promise((res) => setTimeout(res, ms));

type RateLimitHeaders = {
  ipState: string | null;
  ip: string | null;
  accountState: string | null;
  account: string | null;
};

const extractRateLimitHeaders = (res: Response): RateLimitHeaders => ({
  ipState: res.headers.get('x-rate-limit-ip-state'),
  ip: res.headers.get('x-rate-limit-ip'),
  accountState: res.headers.get('x-rate-limit-account-state'),
  account: res.headers.get('x-rate-limit-account')
});

/**
 * Given a state/limit header pair (e.g. "5:4:60,12:10:60"), returns the ms to
 * wait based on the most constrained window that's close to its limit.
 */
const computeWaitFromPair = (stateStr: string | null, limitStr: string | null): number => {
  if (!stateStr || !limitStr) {
    return 0;
  }
  const stateWindows = stateStr.split(',').map((w) => w.split(':').map(Number));
  const limitWindows = limitStr.split(',').map((w) => w.split(':').map(Number));
  let waitMs = 0;
  for (let i = 0; i < limitWindows.length; i++) {
    const [limitHits, period] = limitWindows[i];
    const stateHits = stateWindows[i]?.[0] ?? 0;
    if (stateHits >= limitHits - 1) {
      // At or near the limit for this window — wait out the full period
      waitMs = Math.max(waitMs, period * 1000 + 1000);
    } else {
      // Space out calls evenly across the window
      waitMs = Math.max(waitMs, (period * 1000) / limitHits + 500);
    }
  }
  return waitMs;
};

const computeRateLimitWait = (rl: RateLimitHeaders, minimumDelayMs: number): number =>
  Math.max(minimumDelayMs, computeWaitFromPair(rl.ipState, rl.ip), computeWaitFromPair(rl.accountState, rl.account));

const waitForRateLimit = async (rl: RateLimitHeaders, minimumDelayMs: number) => {
  await delay(computeRateLimitWait(rl, minimumDelayMs));
};

const delayWithProgress = async (ms: number, messagePrefix: string, onProgress: (msg: string) => void) => {
  let remaining = Math.ceil(ms / 1000);
  while (remaining > 0) {
    onProgress(`${messagePrefix} Pausing for ${remaining}s...`);
    await delay(1000);
    remaining--;
  }
};

type SearchPageResult = {
  queryId: string;
  hashes: string[];
  total: number;
  rl: RateLimitHeaders;
};

const searchTradePage = async (
  baseUrl: string,
  league: string,
  headers: Record<string, string>,
  payload: unknown,
  offset: number,
  onProgress: (msg: string) => void,
  rateLimitLabel: string
): Promise<SearchPageResult> => {
  for (;;) {
    let searchRes: Response;
    try {
      const searchUrl = `${baseUrl}/api/trade/search/${league}${offset > 0 ? `?offset=${offset}` : ''}`;
      searchRes = await fetch(searchUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload)
      });
    } catch (e) {
      throw new Error('Network error. Please ensure you have a CORS Unblock extension enabled.');
    }

    if (searchRes.status === 403) {
      throw new Error('403 Forbidden. Cloudflare block or invalid POESESSID.');
    }

    if (searchRes.status === 429) {
      const retryAfter = searchRes.headers.get('retry-after');
      const waitTime = retryAfter ? parseInt(retryAfter) * 1000 + 1000 : 30000;
      await delayWithProgress(waitTime, `${rateLimitLabel} `, onProgress);
      continue;
    }

    if (!searchRes.ok) {
      await delay(2000);
      continue;
    }

    const searchData = await searchRes.json();
    return {
      queryId: searchData.id,
      hashes: searchData.result || [],
      total: typeof searchData.total === 'number' ? searchData.total : (searchData.result || []).length,
      rl: extractRateLimitHeaders(searchRes)
    };
  }
};

const safeFetchJewelDetails = async (
  hashes: string[],
  queryId: string,
  baseUrl: string,
  headers: Record<string, string>,
  onProgress: (msg: string) => void,
  onChunk: (chunk: MarketJewel[]) => void,
  totalFound: number,
  knownConqueror: string,
  lastSyncDate?: string,
  stopAtLastSyncDate = false
): Promise<{ fetchedCount: number; reachedOldItem: boolean }> => {
  let fetchedCount = 0;
  let reachedOldItem = false;

  for (let i = 0; i < hashes.length; i += MAX_FETCH_SIZE) {
    if (reachedOldItem) {
      break;
    }

    const chunk = hashes.slice(i, i + MAX_FETCH_SIZE);
    const fetchUrl = `${baseUrl}/api/trade/fetch/${chunk.join(',')}?query=${queryId}`;
    const fetchRes = await fetch(fetchUrl, { headers });

    if (fetchRes.status === 429) {
      const retryAfter = fetchRes.headers.get('retry-after');
      const waitTime = retryAfter ? parseInt(retryAfter) * 1000 + 1000 : 30000;
      await delayWithProgress(waitTime, `Rate limited on fetch (${totalFound + fetchedCount} total). `, onProgress);
      i -= MAX_FETCH_SIZE; // retry same chunk
      continue;
    }

    if (!fetchRes.ok) {
      await delay(2000);
      continue;
    }

    const rl = extractRateLimitHeaders(fetchRes);
    const fetchData = await fetchRes.json();

    const chunkJewels: MarketJewel[] = [];
    if (fetchData.result) {
      for (const item of fetchData.result) {
        const itemDate = item.listing?.indexed || new Date().toISOString();

        if (stopAtLastSyncDate && lastSyncDate && new Date(itemDate) < new Date(lastSyncDate)) {
          reachedOldItem = true;
          break;
        }

        let priceStr = '';
        if (item.listing && item.listing.price) {
          priceStr = `${item.listing.price.amount} ${item.listing.price.currency}`;
        }

        let seed = 0;
        const worshipper = knownConqueror.charAt(0).toUpperCase() + knownConqueror.slice(1);
        const mods = [...(item.item.explicitMods || [])];
        for (const mod of mods) {
          const match = mod.match(/(\d+)/);
          if (match && match[1]) {
            seed = parseInt(match[1]);
            break;
          }
        }

        if (seed > 0) {
          chunkJewels.push({ id: item.id, seed, worshipper, price: priceStr, listedAt: itemDate });
        }
      }
      if (chunkJewels.length > 0) {
        onChunk(chunkJewels);
      }
    }

    fetchedCount += chunkJewels.length;
    await waitForRateLimit(rl, 2000);
  }
  return { fetchedCount, reachedOldItem };
};

/** Group sorted seed values into contiguous clusters to minimise search queries. */
const clusterSeeds = (seeds: number[]): Array<{ min: number; max: number }> => {
  if (seeds.length === 0) {
    return [];
  }
  const sorted = [...seeds].sort((a, b) => a - b);
  const clusters: Array<{ min: number; max: number }> = [];
  let clusterMin = sorted[0];
  let clusterMax = sorted[0];
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i] - clusterMax <= SEED_CLUSTER_GAP) {
      clusterMax = sorted[i];
    } else {
      clusters.push({ min: clusterMin, max: clusterMax });
      clusterMin = sorted[i];
      clusterMax = sorted[i];
    }
  }
  clusters.push({ min: clusterMin, max: clusterMax });
  return clusters;
};

/**
 * Searches the trade API for all currently listed item hashes within a given
 * seed range for one conqueror. Returns the full set of active listing hashes.
 */
const fetchActiveHashesForRange = async (
  baseUrl: string,
  league: string,
  headers: Record<string, string>,
  baseName: string,
  conqueror: string,
  range: { min: number; max: number },
  onProgress: (msg: string) => void
): Promise<Set<string>> => {
  const payload = {
    query: {
      status: { option: 'any' },
      name: baseName,
      type: 'Timeless Jewel',
      stats: [
        {
          type: 'and',
          filters: [
            {
              id: `explicit.pseudo_timeless_jewel_${conqueror}`,
              value: { min: range.min, max: range.max }
            }
          ]
        }
      ]
    }
  };

  const active = new Set<string>();
  const firstPage = await searchTradePage(
    baseUrl,
    league,
    headers,
    payload,
    0,
    onProgress,
    `Rate limited during prune scan (${conqueror} ${range.min}-${range.max}).`
  );

  firstPage.hashes.forEach((h) => active.add(h));

  if (firstPage.total > SEARCH_PAGE_SIZE) {
    const pageCount = Math.min(Math.ceil(firstPage.total / SEARCH_PAGE_SIZE), 100); // API cap
    for (let pageIndex = 1; pageIndex < pageCount; pageIndex++) {
      const page = await searchTradePage(
        baseUrl,
        league,
        headers,
        payload,
        pageIndex * SEARCH_PAGE_SIZE,
        onProgress,
        `Rate limited during prune scan page ${pageIndex + 1} (${conqueror} ${range.min}-${range.max}).`
      );
      if (page.hashes.length === 0) {
        break;
      }
      page.hashes.forEach((h) => active.add(h));
      await waitForRateLimit(page.rl, 3000);
    }
  } else {
    await waitForRateLimit(firstPage.rl, 3000);
  }

  return active;
};

/**
 * Searches for each cached seed (grouped into tight ranges) to find which
 * listings are no longer on the trade site, then returns the pruned list.
 * Items without an `id` are left untouched since they can't be matched by hash.
 */
export const pruneStaleMarketJewels = async (
  jewelId: number,
  league: string,
  poesessid: string,
  cachedJewels: MarketJewel[],
  onProgress: (msg: string) => void
): Promise<MarketJewel[]> => {
  const baseName = data.TimelessJewels ? data.TimelessJewels[jewelId] : 'Timeless Jewel';
  const baseUrl =
    typeof window !== 'undefined' && window.location.hostname === 'localhost' ? '' : 'https://www.pathofexile.com';

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json'
  };
  if (poesessid) {
    headers['X-Poe-Session'] = poesessid;
  }

  // Separate items with IDs (can validate) from those without (keep as-is)
  const withId = cachedJewels.filter((j) => j.id);
  const withoutId = cachedJewels.filter((j) => !j.id);

  if (withId.length === 0) {
    onProgress('No items with trade IDs in cache; nothing to prune.');
    return cachedJewels;
  }

  // Group by conqueror, collect unique seeds per conqueror
  const byConqueror = new Map<string, MarketJewel[]>();
  for (const j of withId) {
    const key = j.worshipper.toLowerCase();
    if (!byConqueror.has(key)) {
      byConqueror.set(key, []);
    }
    byConqueror.get(key)!.push(j);
  }

  const activeIds = new Set<string>();
  let rangesChecked = 0;

  for (const [conqueror, jewels] of byConqueror) {
    const seeds = [...new Set(jewels.map((j) => j.seed))];
    const clusters = clusterSeeds(seeds);
    onProgress(`Pruning ${conqueror}: checking ${seeds.length} seeds across ${clusters.length} range(s)...`);

    for (const cluster of clusters) {
      const hashes = await fetchActiveHashesForRange(
        baseUrl,
        league,
        headers,
        baseName,
        conqueror,
        cluster,
        onProgress
      );
      hashes.forEach((h) => activeIds.add(h));
      rangesChecked++;
    }
  }

  const before = withId.length;
  const surviving = withId.filter((j) => activeIds.has(j.id!));
  const removed = before - surviving.length;
  onProgress(`Prune complete: removed ${removed} sold/delisted listings (checked ${rangesChecked} ranges).`);

  return [...surviving, ...withoutId];
};

export const fetchMarketJewels = async (
  jewelId: number,
  league: string,
  poesessid: string,
  onProgress: (msg: string) => void,
  onChunk: (chunk: MarketJewel[]) => void,
  lastSyncDate?: string
): Promise<void> => {
  const isStale = !lastSyncDate || Date.now() - new Date(lastSyncDate).getTime() >= STALE_THRESHOLD_MS;
  const isIncremental = !isStale;
  const indexedWindow = isIncremental ? pickIndexedWindow(lastSyncDate!) : null;

  onProgress(
    isIncremental
      ? `Incremental sync: fetching items listed in the last ${indexedWindow}...`
      : 'Full sync: no recent cache or cache is stale, fetching all listed items...'
  );

  const baseName = data.TimelessJewels ? data.TimelessJewels[jewelId] : 'Timeless Jewel';
  const baseUrl =
    typeof window !== 'undefined' && window.location.hostname === 'localhost' ? '' : 'https://www.pathofexile.com';

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json'
  };
  if (poesessid) {
    headers['X-Poe-Session'] = poesessid;
  }

  let totalFound = 0;

  for (const conqueror of JEWEL_CONQUERORS[jewelId] || []) {
    onProgress(
      isIncremental
        ? `Scanning ${conqueror}: date-sorted search; will stop once cached timestamp is reached.`
        : `Scanning ${conqueror}: searching all seeds, paging when possible and splitting seed ranges only if the API cap is hit.`
    );
    const queue = [{ min: 0, max: 200000 }];
    let reachedCachedTimestamp = false;

    while (queue.length > 0) {
      const range = queue.shift();
      if (!range) {
        break;
      }

      const query: Record<string, unknown> = {
        status: { option: 'any' },
        name: baseName,
        type: 'Timeless Jewel',
        stats: [
          {
            type: 'and',
            filters: [
              {
                id: `explicit.pseudo_timeless_jewel_${conqueror}`,
                value: { min: range.min, max: range.max }
              }
            ]
          }
        ]
      };

      if (isIncremental && indexedWindow) {
        query.filters = { trade_filters: { filters: { indexed: { option: indexedWindow } } } };
      }

      const payload: Record<string, unknown> = {
        query,
        ...(isIncremental ? { sort: { indexed: 'desc' } } : {})
      };

      const firstPage = await searchTradePage(
        baseUrl,
        league,
        headers,
        payload,
        0,
        onProgress,
        `Rate limited on ${conqueror} search (${totalFound} loaded).`
      );

      // The trade API returns at most SEARCH_PAGE_SIZE hashes per POST — pagination
      // via ?offset is not supported. If we got a full page, there are likely more
      // results in this range; split and re-query each half instead.
      if (firstPage.hashes.length >= SEARCH_PAGE_SIZE && range.min < range.max) {
        const mid = Math.floor((range.min + range.max) / 2);
        onProgress(
          `${conqueror}: ${firstPage.total} matches in [${range.min}-${range.max}], splitting into [${range.min}-${mid}] and [${mid + 1}-${range.max}].`
        );
        if (mid === range.min) {
          queue.push({ min: range.min, max: range.min });
          queue.push({ min: range.max, max: range.max });
        } else {
          queue.push({ min: range.min, max: mid });
          queue.push({ min: mid + 1, max: range.max });
        }
      } else if (firstPage.hashes.length > 0) {
        onProgress(`Fetching ${firstPage.hashes.length} items [${range.min}-${range.max}] (${totalFound} total)`);
        const fetchResult = await safeFetchJewelDetails(
          firstPage.hashes,
          firstPage.queryId,
          baseUrl,
          headers,
          onProgress,
          onChunk,
          totalFound,
          conqueror,
          lastSyncDate,
          isIncremental
        );
        totalFound += fetchResult.fetchedCount;

        if (isIncremental && fetchResult.reachedOldItem) {
          onProgress(`${conqueror}: reached cached timestamp; moving to next conqueror.`);
          reachedCachedTimestamp = true;
        }
      }

      if (reachedCachedTimestamp) {
        break;
      }

      await waitForRateLimit(firstPage.rl, 3000);
    }
  }

  onProgress(`Complete. Total synced: ${totalFound} jewels.`);
};

/**
 * Opens a single PoE Trade live search WebSocket covering all conquerors for
 * a jewel type. Conqueror is detected from each item's explicit mod text.
 * Calls onJewels each time new listings arrive. Returns a cleanup function.
 */
export const openLiveSearch = async (
  jewelId: number,
  league: string,
  poesessid: string,
  onJewels: (jewels: MarketJewel[]) => void,
  onStatus: (msg: string) => void
): Promise<() => void> => {
  const baseName = data.TimelessJewels ? data.TimelessJewels[jewelId] : 'Timeless Jewel';
  const baseUrl =
    typeof window !== 'undefined' && window.location.hostname === 'localhost' ? '' : 'https://www.pathofexile.com';

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json'
  };
  if (poesessid) {
    headers['X-Poe-Session'] = poesessid;
  }

  // No stat filter — matches all conquerors for this jewel type in one query
  const payload = {
    query: {
      status: { option: 'online' },
      name: baseName,
      type: 'Timeless Jewel'
    },
    sort: { indexed: 'desc' }
  };

  let searchRes: Response;
  try {
    searchRes = await fetch(`${baseUrl}/api/trade/search/${league}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload)
    });
  } catch {
    throw new Error('Network error starting live search. Ensure your CORS Unblock extension is active.');
  }

  if (!searchRes.ok) {
    throw new Error(`Trade search failed (${searchRes.status}). Check your POESESSID and CORS extension.`);
  }

  const { id: queryId } = await searchRes.json();
  onStatus(`Live feed ready for all ${baseName} conquerors (${league})`);

  // On localhost the Vite proxy handles the WebSocket (ws: true in vite.config.js).
  // In production, connect directly to pathofexile.com.
  const isLocal = typeof window !== 'undefined' && window.location.hostname === 'localhost';
  const wsUrl = isLocal
    ? `ws://${window.location.host}/api/trade/live/${league}/${queryId}`
    : `wss://www.pathofexile.com/api/trade/live/${league}/${queryId}`;
  const ws = new WebSocket(wsUrl);

  // Build lowercase conqueror name list for detection from mod text
  const knownConquerors = JEWEL_CONQUERORS[jewelId] || [];

  ws.onopen = () => onStatus(`Watching for new ${baseName} listings...`);
  ws.onerror = () => onStatus('WebSocket error — check your CORS Unblock extension.');
  ws.onclose = () => onStatus('Live feed closed.');

  ws.onmessage = async (event) => {
    let msg: { new?: string[] };
    try {
      msg = JSON.parse(event.data);
    } catch {
      return;
    }
    if (!msg.new || msg.new.length === 0) {
      return;
    }

    const chunk = msg.new.slice(0, MAX_FETCH_SIZE);
    const fetchUrl = `${baseUrl}/api/trade/fetch/${chunk.join(',')}?query=${queryId}`;
    let fetchRes: Response;
    try {
      fetchRes = await fetch(fetchUrl, { headers });
    } catch {
      return;
    }
    if (!fetchRes.ok) {
      return;
    }

    const fetchData = await fetchRes.json();
    const jewels: MarketJewel[] = [];

    for (const item of fetchData.result || []) {
      const modText = (item.item?.explicitMods || []).join(' ').toLowerCase();

      let seed = 0;
      for (const mod of item.item?.explicitMods || []) {
        const match = mod.match(/(\d+)/);
        if (match) {
          seed = parseInt(match[1]);
          break;
        }
      }
      if (seed <= 0) {
        continue;
      }

      const matched = knownConquerors.find((c) => modText.includes(c));
      if (!matched) {
        continue;
      }
      const worshipper = matched.charAt(0).toUpperCase() + matched.slice(1);

      const price = item.listing?.price ? `${item.listing.price.amount} ${item.listing.price.currency}` : '';
      const listedAt = item.listing?.indexed || new Date().toISOString();
      jewels.push({ id: item.id, seed, worshipper, price, listedAt });
    }

    if (jewels.length > 0) {
      onJewels(jewels);
    }
  };

  return () => ws.close();
};
