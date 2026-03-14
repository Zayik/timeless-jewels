import re
with open("D:/GitHub/timeless-jewels/frontend/src/lib/trade_api.ts", "r", encoding="utf-8") as f:
    text = f.read()

replacement = """  // 1. Initial Search Request
  onProgress('Searching market by Conquerors...');
  const baseName = data.TimelessJewels ? data.TimelessJewels[jewelId] : 'Timeless Jewel';
  const baseUrl = (typeof window !== 'undefined' && window.location.hostname === 'localhost') ? '' : 'https://www.pathofexile.com';
  const searchUrl = `${baseUrl}/api/trade/search/${league}`;
  
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json'
  };

  if (poesessid) {
    headers['Cookie'] = `POESESSID=${poesessid}`;
  }

  // We need to collect all hashes from multiple searches safely
  let allHashesToFetch: {hash: string, queryId: string}[] = [];
  let totalFound = 0;

  for (const conqueror of CONQUERORS) {
      const payload = {
        query: {
          status: { option: 'online' },
          name: baseName,
          type: 'Timeless Jewel',
          stats: [{ type: 'and', filters: [{ id: `explicit.pseudo_timeless_jewel_${conqueror}` }] }]
        },
        sort: { price: 'asc' }
      };

      let searchRes;
      try {
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
          onProgress(`Rate limited on search! Pausing...`);
          await delay(15000);
          continue; // just skip if we get 429'd on the master search
      }

      if (!searchRes.ok) {
          continue; // likely baseName doesn't have this conqueror, ignore and move on
      }

      const searchData = await searchRes.json();
      const resultHashes: string[] = searchData.result || [];
      const queryId = searchData.id;

      if (resultHashes.length > 0) {
          totalFound += searchData.total || resultHashes.length;
          // Trade api limits to first 10,000 hashes max
          const maxHashesForConq = Math.min(resultHashes.length, 1000); 
          for (const hash of resultHashes.slice(0, maxHashesForConq)) {
              allHashesToFetch.push({ hash, queryId });
          }
      }

      const stateLimitStr = searchRes.headers.get('x-rate-limit-ip-state');
      const limitStr = searchRes.headers.get('x-rate-limit-ip');
      let sleepTime = 2000;
      if (stateLimitStr && limitStr) {
        const state = parseRateLimitHeader(stateLimitStr);
        const limit = parseRateLimitHeader(limitStr);
        if (state && limit && state.hits >= limit.hits - 1) {
          sleepTime = limit.period * 1000 + 500;
        }
      }
      await delay(sleepTime);
  }

  if (allHashesToFetch.length === 0) {
      return [];
  }

  const marketJewels: MarketJewel[] = [];
  
  // Group by queryId to minimize fetch calls mismatching queries though trade api allows mixed queries sometimes, better be safe
  const groupedQueries: Record<string, string[]> = {};
  for (const item of allHashesToFetch) {
      if (!groupedQueries[item.queryId]) groupedQueries[item.queryId] = [];
      groupedQueries[item.queryId].push(item.hash);
  }

  let totalFetched = 0;
  for (const queryId in groupedQueries) {
      const hashes = groupedQueries[queryId];
      
      onProgress(`Fetching details for ${hashes.length} ${baseName} jewels... (${totalFetched}/${allHashesToFetch.length})`);
      
      for (let i = 0; i < hashes.length; i += MAX_FETCH_SIZE) {
        const chunk = hashes.slice(i, i + MAX_FETCH_SIZE);
        const fetchUrl = `${baseUrl}/api/trade/fetch/${chunk.join(',')}?query=${queryId}`;
        const fetchRes = await fetch(fetchUrl, { headers });

        if (fetchRes.status === 429) {
          onProgress(`Rate limited! Pausing for 15 seconds...`);
          await delay(15000);
          i -= MAX_FETCH_SIZE;
          continue;
        }

        if (!fetchRes.ok) {
          await delay(2000);
          continue;
        }

        const stateLimitStr = fetchRes.headers.get('x-rate-limit-ip-state');
        const limitStr = fetchRes.headers.get('x-rate-limit-ip');
        const fetchData = await fetchRes.json();

        if (fetchData.result) {
          for (const item of fetchData.result) {
            let priceStr = '';
            if (item.listing && item.listing.price) {
              priceStr = `${item.listing.price.amount} ${item.listing.price.currency}`;
            }

            let seed = 0;
            let worshipper = '';
            const mods = [...(item.item.explicitMods || [])];
            for (const mod of mods) {
              const match = mod.match(/(\d+).*(under|name of|by|to) ([A-Za-z]+)/);
              if (match && match[1] && match[3]) {
                seed = parseInt(match[1]);
                worshipper = match[3];
                break;
              }
            }

            if (seed > 0) {
              marketJewels.push({ seed, worshipper, price: priceStr, listedAt: item.listing?.indexed || new Date().toISOString() });
            }
          }
        }

        totalFetched += chunk.length;
        if (totalFetched % 50 === 0) onProgress(`Fetched ${totalFetched} / ${allHashesToFetch.length} items...`);

        let sleepTime = 1500;
        if (stateLimitStr && limitStr) {
          const state = parseRateLimitHeader(stateLimitStr);
          const limit = parseRateLimitHeader(limitStr);
          if (state && limit && state.hits >= limit.hits - 1) {
            sleepTime = limit.period * 1000 + 500;
          }
        }
        await delay(sleepTime);
      }
  }

  onProgress(`Complete. Cached ${marketJewels.length} unique market jewels.`);
  return marketJewels;
};
"""

text = re.sub(
    r"  // 1\. Initial Search Request(.*?)return marketJewels;\n\};",
    replacement.replace('\\', '\\\\'),
    text,
    flags=re.DOTALL
)

with open("D:/GitHub/timeless-jewels/frontend/src/lib/trade_api.ts", "w", encoding="utf-8") as f:
    f.write(text)
print("done")
