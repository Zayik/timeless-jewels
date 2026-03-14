const fs = require('fs');

let content = fs.readFileSync('frontend/src/routes/+page.svelte', 'utf8');

// Replace the fetchMarketJewels call
content = content.replace(
    const jewels = await fetchMarketJewels(
         selectedJewel.value,
         league?.value || 'Standard',
         poeSessId,
         syncType,
         (msg) => marketProgress = msg
      );,
    const lastSyncStr = cacheTime ? cacheTime.toISOString() : undefined;
      let streamedJewels: MarketJewel[] = [];
      const jewels = await fetchMarketJewels(
         selectedJewel.value,
         league?.value || 'Standard',
         poeSessId,
         syncType,
         (msg) => marketProgress = msg,
         (chunk) => {
             streamedJewels.push(...chunk);
             // we can also update cachedJewels live if we want, but doing it in bulk at the end of the chunk is safer
             const jewelMap = new Map();
             for (const j of cachedJewels) {
                 if (j.id) jewelMap.set(j.id, j);
                 else jewelMap.set(\\_\\, j);
             }
             for (const j of chunk) {
                 if (j.id) jewelMap.set(j.id, j);
                 else jewelMap.set(\\_\\, j);
             }
             const merged = Array.from(jewelMap.values());
             setCachedJewels(selectedJewel.value, merged);
             cachedJewels = merged;
         },
         syncType === 'incremental' ? lastSyncStr : undefined
      );
);

fs.writeFileSync('frontend/src/routes/+page.svelte', content);
console.log('+page.svelte patched');
