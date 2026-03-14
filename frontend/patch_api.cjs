const fs = require('fs');

const fileContent = `import type { MarketJewel } from './market_cache';
import { data } from './types';

const MAX_FETCH_SIZE = 10;
const LIMIT_PER_PERIOD = 5;

const JEWEL_CONQUERORS: Record<number, string[]> = {
  1: ['xibaqua', 'zerphi', 'ahuana', 'doryani'],
  2: ['kaom', 'rakiata', 'kiloava', 'akoya'],
  3: ['deshret', 'balbala', 'asenath', 'nasima'],
  4: ['venarius', 'maxarius', 'dominus', 'avarius'],
  5: ['cadiro', 'victario', 'chitus', 'caspiro'],
  6: ['vorana', 'uhtred', 'medved']
};

const delay = (ms: number) => new Promise((res) => setTimeout(res, ms));

const parseRateLimitHeader = (header: string | null) => {
  if (!header) return null;
  const parts = header.split(',');
  if (parts.length > 0) {
    const primary = parts[0].split(':');
    return { hits: parseInt(primary[0]), period: parseInt(primary[1]), state: parseInt(primary[2]) };
  }
  return null;
};

const delayWithProgress = async (ms: number, messagePrefix: string, onProgress: (msg: string) => void) => {
  let remaining = Math.ceil(ms / 1000);
  while (remaining > 0) {
    onProgress(\`\${messagePrefix} Pausing for \${remaining}s...\`);
    await delay(1000);
    remaining--;
  }
};

const safeFetchJewelDetails = async (
  hashes: string[],
  queryId: string,
  baseUrl: string,
  headers: Record<string, string>,
  onProgress: (msg: string) => void,
  onChunk: (chunk: MarketJewel[]) => void,
  baseName: string,
  totalFound: number
): Promise<number> => {
  let fetchedCount = 0;
  for (let i = 0; i < hashes.length; i += MAX_FETCH_SIZE) {
    const chunk = hashes.slice(i, i + MAX_FETCH_SIZE);
    const fetchUrl = \`\${baseUrl}/api/trade/fetch/\${chunk.join(',')}?query=\${queryId}\`;
    const fetchRes = await fetch(fetchUrl, { headers });

    if (fetchRes.status === 429) {
      const retryAfter = fetchRes.headers.get('retry-after');
      const waitTime = retryAfter ? parseInt(retryAfter) * 1000 + 1000 : 30000;
      await delayWithProgress(waitTime, \`Rate limited on fetch (\${totalFound} total). \`, onProgress);
      i -= MAX_FETCH_SIZE; // retry
      continue;
    }

    if (!fetchRes.ok) {
      await delay(2000);
      continue;
    }

    const stateLimitStr = fetchRes.headers.get('x-rate-limit-ip-state');
    const limitStr = fetchRes.headers.get('x-rate-limit-ip');
    const fetchData = await fetchRes.json();

    const chunkJewels: MarketJewel[] = [];
    if (fetchData.result) {
      for (const item of fetchData.result) {
        let priceStr = '';
        if (item.listing && item.listing.price) {
          priceStr = \`\${item.listing.price.amount} \${item.listing.price.currency}\`;
        }

        let seed = 0;
        let worshipper = '';
        const mods = [...(item.item.explicitMods || [])];
        for (const mod of mods) {
          const match = mod.match(/(\\d+).*(under|name of|by|to|line of) ([A-Za-z]+)/);
          if (match && match[1] && match[3]) {
            seed = parseInt(match[1]);
            worshipper = match[3];
            break;
          }
        }

        if (seed > 0) {
          chunkJewels.push({ id: item.id, seed, worshipper, price: priceStr, listedAt: item.listing?.indexed || new Date().toISOString() });
        }
      }
      if (chunkJewels.length > 0) {
        onChunk(chunkJewels);
      }
    }

    fetchedCount += chunk.length;
    
    let sleepTime = 2000;
    if (stateLimitStr && limitStr) {
      const state = parseRateLimitHeader(stateLimitStr);
      const limit = parseRateLimitHeader(limitStr);
      if (state && limit && state.hits >= limit.hits - 1) {
        sleepTime = limit.period * 1000 + 1000;
      } else if (state && limit) {
         sleepTime = Math.max(2000, limit.period * 1000 / limit.hits + 500);
      }
    }
    await delay(sleepTime);
  }
  return fetchedCount;
};

export const fetchMarketJewels = async (
  jewelId: number,
  league: string,
  poesessid: string,
  syncType: 'full' | 'incremental',
  onProgress: (msg: string) => void,
  onChunk: (chunk: MarketJewel[]) => void
): Promise<MarketJewel[]> => {
  onProgress('Searching market by Conquerors...');
  const baseName = data.TimelessJewels ? data.TimelessJewels[jewelId] : 'Timeless Jewel';
  const baseUrl = (typeof window !== 'undefined' && window.location.hostname === 'localhost') ? '' : 'https://www.pathofexile.com';

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json'
  };

  if (poesessid) {
    headers['X-Poe-Session'] = poesessid;
  }

  let totalFound = 0;

  for (const conqueror of JEWEL_CONQUERORS[jewelId] || []) {
      const queue = [{ min: 0, max: 200000 }];

      while (queue.length > 0) {
          const range = queue.shift();
          if (!range) break;

          const payload: any = {
            query: {
              status: { option: 'any' },
              name: baseName,
              type: 'Timeless Jewel',
              stats: [{ type: 'and', filters: [{ id: \`explicit.pseudo_timeless_jewel_\${conqueror}\`, value: { min: range.min, max: range.max } }] }]
            },
            sort: { indexed: 'desc' }
          };

          if (syncType === 'incremental') {
              payload.query.filters = { trade_filters: { filters: { indexed: { option: '1week' } } } };
          }

          let searchRes;
          try {
            searchRes = await fetch(\`\${baseUrl}/api/trade/search/\${league}\`, {
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
              await delayWithProgress(waitTime, \`Rate limited on \${conqueror} search (\${totalFound} loaded).\`, onProgress);
              queue.unshift(range);
              continue; 
          }

          if (!searchRes.ok) {
              await delay(2000);
              continue; 
          }

          const searchData = await searchRes.json();
          const resultHashes: string[] = searchData.result || [];
          const queryId = searchData.id;

          if (resultHashes.length >= 100 && range.min < range.max) {
              const mid = Math.floor((range.min + range.max) / 2);
              if (mid === range.min) {
                  queue.push({ min: range.min, max: range.min });
                  queue.push({ min: range.max, max: range.max });
              } else {
                  queue.push({ min: range.min, max: mid });
                  queue.push({ min: mid + 1, max: range.max });
              }
          } else if (resultHashes.length > 0) {
              onProgress(\`Fetching \${resultHashes.length} items [\${range.min}-\${range.max}] (\${totalFound} total)\`);
              await safeFetchJewelDetails(resultHashes, queryId, baseUrl, headers, onProgress, onChunk, baseName, totalFound);
              totalFound += resultHashes.length;
          }

          const stateLimitStr = searchRes.headers.get('x-rate-limit-ip-state');
          const limitStr = searchRes.headers.get('x-rate-limit-ip');
          let sleepTime = 3000;
          if (stateLimitStr && limitStr) {
            const state = parseRateLimitHeader(stateLimitStr);
            const limit = parseRateLimitHeader(limitStr);
            if (state && limit && state.hits >= limit.hits - 1) {
              sleepTime = limit.period * 1000 + 1000;
            } else if (state && limit) {
              sleepTime = Math.max(3000, limit.period * 1000 / limit.hits + 500);
            }
          }
          await delay(sleepTime);
      }
  }

  onProgress(\`Complete. Interleaved total cached: \${totalFound} jewels.\`);
  return []; // We return empty array because chunker handled all merges interactively
};
`
fs.writeFileSync('src/lib/trade_api.ts', fileContent);
