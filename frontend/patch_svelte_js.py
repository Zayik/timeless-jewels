import re
with open("D:/GitHub/timeless-jewels/frontend/src/routes/+page.svelte", "r", encoding="utf-8") as f:
    text = f.read()

old_script = """  const syncMarket = async () => {
    if (!selectedJewel) return;
    fetchingMarket = true;
    try {
      const jewels = await fetchMarketJewels(
         selectedJewel.value,
         league?.value || 'Standard',
         poeSessId,
         (msg) => marketProgress = msg
      );
      setCachedJewels(selectedJewel.value, jewels);
      cachedJewels = jewels;
      cacheTime = new Date();
    } catch(e: any) {
      alert(e.message || "Failed to sync");
    } finally {
      fetchingMarket = false;
      marketProgress = '';
    }
  };"""

new_script = """  const syncMarket = async (syncType: 'full' | 'incremental') => {
    if (!selectedJewel) return;
    fetchingMarket = true;
    try {
      const jewels = await fetchMarketJewels(
         selectedJewel.value,
         league?.value || 'Standard',
         poeSessId,
         syncType,
         (msg) => marketProgress = msg
      );
      
      let finalJewels = jewels;
      if (syncType === 'incremental') {
          // Merge with old jewels, using 'id' to deduplicate if present
          const oldJewels = getCachedJewels(selectedJewel.value);
          const jewelMap = new Map();
          
          for (const j of oldJewels) {
              if (j.id) jewelMap.set(j.id, j);
              else jewelMap.set(`${j.seed}_${j.worshipper}`, j); // fallback deduplication
          }
          
          for (const j of jewels) {
              if (j.id) jewelMap.set(j.id, j);
              else jewelMap.set(`${j.seed}_${j.worshipper}`, j);
          }
          finalJewels = Array.from(jewelMap.values());
      }
      
      setCachedJewels(selectedJewel.value, finalJewels);
      cachedJewels = finalJewels;
      cacheTime = new Date();
    } catch(e: any) {
      alert(e.message || "Failed to sync");
    } finally {
      fetchingMarket = false;
      marketProgress = '';
    }
  };"""

# Sometimes spaces differ, so I'll just use regex over the interior
text = re.sub(
    r"const syncMarket = async \(\) => \{\s*if \(\!selectedJewel\) return;\s*fetchingMarket = true;\s*try \{\s*const jewels = await fetchMarketJewels\(\s*selectedJewel\.value,\s*league\?\.value \|\| 'Standard',\s*poeSessId,\s*\(msg\) => marketProgress = msg\s*\);\s*setCachedJewels\(selectedJewel\.value, jewels\);\s*cachedJewels = jewels;\s*cacheTime = new Date\(\);\s*\} catch\(e: any\) \{\s*alert\(e\.message \|\| \"Failed to sync\"\);\s*\} finally \{\s*fetchingMarket = false;\s*marketProgress = '';\s*\}\s*\};",
    new_script,
    text
)

old_buttons = """                          <div class="flex flex-col space-y-2 mb-2">
                              <button
                                class="p-2 px-3 w-full bg-orange-600/60 rounded hover:bg-orange-600 disabled:bg-gray-600 font-bold"
                                on:click={syncMarket} disabled={fetchingMarket}>
                                {fetchingMarket ? 'Syncing...' : 'Sync Market Cache'}
                              </button>
                              {#if marketProgress}
                                <div class="text-xs text-blue-300 mt-1">{marketProgress}</div>
                              {/if}
                          </div>"""

new_buttons = """                          <div class="flex flex-col space-y-2 mb-2">
                              <div class="flex flex-row space-x-2">
                                <button
                                  class="p-2 w-full bg-orange-600/60 rounded hover:bg-orange-600 disabled:bg-gray-600 font-bold text-sm"
                                  on:click={() => syncMarket('incremental')} disabled={fetchingMarket}
                                  title="Appends newly listed items without dropping old cached ones">
                                  {fetchingMarket ? 'Syncing...' : 'Update Sync (Fast)'}
                                </button>
                                <button
                                  class="p-2 w-full bg-red-800/60 rounded hover:bg-red-700 disabled:bg-gray-600 font-bold text-sm"
                                  on:click={() => syncMarket('full')} disabled={fetchingMarket}
                                  title="Clears cache and grabs all currently listed or buyout items">
                                  {fetchingMarket ? 'Syncing...' : 'Full Sync'}
                                </button>
                              </div>
                              {#if marketProgress}
                                <div class="text-xs text-blue-300 mt-1 text-center">{marketProgress}</div>
                              {/if}
                          </div>"""

text = re.sub(
    r'<div class="flex flex-col space-y-2 mb-2">\s*<button\s*class="p-2 px-3 w-full bg-orange-600/60 rounded hover:bg-orange-600 disabled:bg-gray-600 font-bold"\s*on:click=\{syncMarket\} disabled=\{fetchingMarket\}>\s*\{fetchingMarket \? \'Syncing\.\.\.\' : \'Sync Market Cache\'\}\s*</button>\s*\{#if marketProgress\}\s*<div class="text-xs text-blue-300 mt-1">\{marketProgress\}</div>\s*\{/if\}\s*</div>',
    new_buttons,
    text
)

with open("D:/GitHub/timeless-jewels/frontend/src/routes/+page.svelte", "w", encoding="utf-8") as f:
    f.write(text)
print("done svelte")
