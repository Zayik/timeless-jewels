const fs = require('fs');
let content = fs.readFileSync('src/routes/+page.svelte', 'utf-8');

const target =     try {
      const jewels = await fetchMarketJewels(
         selectedJewel.value,
         league?.value || 'Standard',
         poeSessId,
         syncType,
         (msg) => marketProgress = msg
      );;

const refactored =     try {
      let finalJewels: typeof cachedJewels = [];
      let isFirstChunk = true;
      const jewels = await fetchMarketJewels(
         selectedJewel.value,
         league?.value || 'Standard',
         poeSessId,
         syncType,
         (msg) => marketProgress = msg,
         (chunk) => {
             if (isFirstChunk && syncType === 'full') {
                 finalJewels = [...chunk];
                 isFirstChunk = false;
             } else {
                 if (isFirstChunk && syncType === 'incremental') {
                     finalJewels = getCachedJewels(selectedJewel!.value);
                     isFirstChunk = false;
                 }
                 const jewelMap = new Map();
                 for (const j of finalJewels) {
                     if (j.id) jewelMap.set(j.id, j);
                     else jewelMap.set(\\_\\, j);
                 }
                 for (const j of chunk) {
                     if (j.id) jewelMap.set(j.id, j);
                     else jewelMap.set(\\_\\, j);
                 }
                 finalJewels = Array.from(jewelMap.values());
             }
             setCachedJewels(selectedJewel!.value, finalJewels);
             cachedJewels = finalJewels;
             cacheTime = new Date();
         }
      );;

content = content.replace(target, refactored);

const oldMerge =       let finalJewels = jewels;
      if (syncType === 'incremental') {
          // Merge with old jewels, using 'id' to deduplicate if present        
          const oldJewels = getCachedJewels(selectedJewel.value);
          const jewelMap = new Map();

          for (const j of oldJewels) {
              if (j.id) jewelMap.set(j.id, j);
              else jewelMap.set(\\_\\, j); // fallback deduplication
          }

          for (const j of jewels) {
              if (j.id) jewelMap.set(j.id, j);
              else jewelMap.set(\\_\\, j);
          }
          finalJewels = Array.from(jewelMap.values());
      }

      setCachedJewels(selectedJewel.value, finalJewels);
      cachedJewels = finalJewels;
      cacheTime = new Date();;

content = content.replace(oldMerge,       // final sanity check incase
      if (jewels.length > 0 && finalJewels.length === 0) {
          finalJewels = jewels;
          setCachedJewels(selectedJewel.value, finalJewels);
          cachedJewels = finalJewels;
          cacheTime = new Date();
      });

fs.writeFileSync('src/routes/+page.svelte', content);
