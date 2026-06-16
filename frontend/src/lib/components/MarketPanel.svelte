<script lang="ts">
  import { onMount } from 'svelte';
  import Select from 'svelte-select';
  import { fetchMarketJewels, pruneStaleMarketJewels } from '$lib/trade_api';
  import { getCachedJewels, getCacheTime, setCachedJewels, clearCachedJewels } from '$lib/market_cache';
  import type { MarketJewel } from '$lib/market_cache';
  import { data } from '$lib/types';
  import { getAlternatePassiveSkillKeyStone } from '$lib/calculator/data';
  import { getPoeSessionId, setPoeSessionId, getShowMarketPanel, setShowMarketPanel } from '$lib/storageManager';

  type Props = {
    selectedJewel: { value: number; label: string };
    leagues: { value: string; label: string }[];
    conquerors: { value: string; label: string }[];
    selectedConqueror?: { value: string; label: string };
    league?: { value: string; label: string };
    cachedJewels?: MarketJewel[];
    poeSessId?: string;
    showMarketPanel?: boolean;
    showMarketSettings?: boolean;
    filteredMarketJewels?: MarketJewel[];
    onConquerorChange?: () => void;
    onseedselect?: (detail: { seed: number; worshipper: string }) => void;
  };

  let {
    selectedJewel,
    leagues,
    conquerors,
    selectedConqueror = $bindable<{ value: string; label: string } | undefined>(),
    league = $bindable<{ value: string; label: string } | undefined>(),
    cachedJewels = $bindable([]),
    poeSessId = $bindable(''),
    showMarketPanel = $bindable(false),
    showMarketSettings = $bindable(false),
    filteredMarketJewels = $bindable([]),
    onConquerorChange,
    onseedselect
  }: Props = $props();

  // What each conqueror does: the only thing a conqueror changes is the keystone
  // its jewel grants (notables/small passives are conqueror-independent). The
  // keystone name is the meaningful descriptor — its alt-passive "stat" is just
  // the keystone itself, so there's no extra effect text to surface here.
  const conquerorKeystones = $derived(
    conquerors.map((c) => {
      const info = data.TimelessJewelConquerors[selectedJewel.value]?.[c.value];
      const ks = info ? getAlternatePassiveSkillKeyStone(selectedJewel.value, info.Index, info.Version) : undefined;
      return { name: c.value, keystone: ks?.Name };
    })
  );

  // Internal state
  let showSessionHelp = $state(false);
  let fetchingMarket = $state(false);
  let marketProgress = $state('');
  let cacheTime = $state<Date | null>(null);
  let marketConquerorFilter = $state('All');
  let marketSort = $state<'price' | 'seed' | 'date'>('price');

  const CURRENCY_TIER: Record<string, number> = { divine: 1000, div: 1000, exalted: 100, ex: 100, chaos: 1 };

  const parsePrice = (price: string): number => {
    const parts = price.trim().split(' ');
    const amount = parseFloat(parts[0]) || 0;
    const currency = parts.slice(1).join(' ').toLowerCase().replace('orb of ', '').trim();
    return amount * (CURRENCY_TIER[currency] ?? 0.01);
  };

  const comparePrices = (a: MarketJewel, b: MarketJewel) => parsePrice(a.price) - parsePrice(b.price);

  onMount(() => {
    poeSessId = getPoeSessionId();
    showMarketPanel = getShowMarketPanel(false);
  });

  $effect(() => {
    if (poeSessId) {
      setPoeSessionId(poeSessId);
    }
  });

  $effect(() => {
    setShowMarketPanel(showMarketPanel);
  });

  $effect(() => {
    if (selectedJewel && league) {
      cachedJewels = getCachedJewels(selectedJewel.value, league.value);
      cacheTime = getCacheTime(selectedJewel.value, league.value);
    }
  });

  $effect(() => {
    filteredMarketJewels = cachedJewels
      .filter(
        (j) => marketConquerorFilter === 'All' || j.worshipper.toLowerCase() === marketConquerorFilter.toLowerCase()
      )
      .sort((a, b) =>
        marketSort === 'seed'
          ? a.seed - b.seed
          : marketSort === 'date'
            ? new Date(b.listedAt).getTime() - new Date(a.listedAt).getTime()
            : comparePrices(a, b)
      );
  });

  const syncMarket = async () => {
    if (!selectedJewel) {
      return;
    }
    fetchingMarket = true;
    try {
      const lastSyncStr = cacheTime ? cacheTime.toISOString() : undefined;
      await fetchMarketJewels(
        selectedJewel.value,
        league?.value || 'Standard',
        poeSessId,
        (msg) => (marketProgress = msg),
        (chunk) => {
          const jewelMap = new Map();
          for (const j of cachedJewels) {
            if (j.id) {
              jewelMap.set(j.id, j);
            } else {
              jewelMap.set(`${j.seed}_${j.worshipper}`, j);
            }
          }
          for (const j of chunk) {
            if (j.id) {
              jewelMap.set(j.id, j);
            } else {
              jewelMap.set(`${j.seed}_${j.worshipper}`, j);
            }
          }
          const merged = Array.from(jewelMap.values());
          setCachedJewels(selectedJewel.value, league?.value || 'Standard', merged);
          cachedJewels = merged;
        },
        lastSyncStr
      );
      cacheTime = getCacheTime(selectedJewel.value, league?.value || 'Standard');
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Failed to sync');
    } finally {
      fetchingMarket = false;
      marketProgress = '';
    }
  };

  const clearMarketCache = () => {
    if (!selectedJewel) {
      return;
    }
    if (!confirm(`Clear all cached market data for ${selectedJewel.label} (${league?.value || 'Standard'})?`)) {
      return;
    }
    clearCachedJewels(selectedJewel.value, league?.value || 'Standard');
    cachedJewels = [];
    cacheTime = null;
  };

  const pruneMarketCache = async () => {
    if (!selectedJewel || cachedJewels.length === 0) {
      return;
    }
    fetchingMarket = true;
    try {
      const pruned = await pruneStaleMarketJewels(
        selectedJewel.value,
        league?.value || 'Standard',
        poeSessId,
        cachedJewels,
        (msg) => (marketProgress = msg)
      );
      setCachedJewels(selectedJewel.value, league?.value || 'Standard', pruned);
      cachedJewels = pruned;
      cacheTime = getCacheTime(selectedJewel.value, league?.value || 'Standard');
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Failed to prune cache');
    } finally {
      fetchingMarket = false;
      marketProgress = '';
    }
  };
</script>

<!-- ── Market Panel ─────────────────────────────────────── -->
<div class="mt-4 rounded ring-1 ring-gray-600 bg-gray-800/50">
  <button
    class="w-full flex flex-row justify-between items-center p-2 px-3 text-left"
    onclick={() => (showMarketPanel = !showMarketPanel)}>
    <span class="font-bold text-orange-400 text-sm">Market</span>
    <span class="text-xs text-gray-400"
      >{showMarketPanel ? '▲' : '▼'}
      {cachedJewels.length} jewels{cacheTime ? ' · ' + cacheTime.toLocaleTimeString() : ''}</span>
  </button>

  {#if showMarketPanel}
    <div class="p-2 pt-0 flex flex-col space-y-2 text-sm">
      <!-- Conqueror selector (only affects trade/market URLs and the seed preview's
           default; node tooltips show every conqueror regardless) -->
      <div class="border-t border-gray-700 pt-2">
        <span class="text-xs text-gray-400">Conqueror</span>
        <Select
          items={conquerors}
          bind:value={selectedConqueror}
          clearable={false}
          on:change={() => onConquerorChange?.()} />

        {#if conquerorKeystones.length > 0}
          <div class="mt-2 space-y-1 text-xs">
            <span class="text-gray-400">Each conqueror grants a keystone:</span>
            {#each conquerorKeystones as ck}
              <div class="flex flex-row justify-between rounded bg-gray-900/60 p-1.5">
                <span class="font-semibold text-orange-300">{ck.name}</span>
                {#if ck.keystone}
                  <span class="text-gray-200">{ck.keystone}</span>
                {/if}
              </div>
            {/each}
          </div>
        {/if}
      </div>

      <!-- Settings (collapsible) -->
      <div class="border-t border-gray-700 pt-2">
        <button
          class="text-xs text-gray-400 hover:text-white underline mb-2"
          onclick={() => (showMarketSettings = !showMarketSettings)}>
          {showMarketSettings ? '▲' : '▼'} Settings
        </button>
        {#if showMarketSettings}
          <div class="flex flex-col space-y-2 bg-gray-900 rounded p-2">
            <Select items={leagues} bind:value={league} clearable={false} />
            <label class="flex flex-col">
              <span class="text-xs text-gray-400 mb-1"
                >POESESSID (optional) <button
                  type="button"
                  class="ml-1 text-blue-400 hover:text-blue-300 underline"
                  onclick={() => (showSessionHelp = !showSessionHelp)}>(?)</button
                ></span>
              <input
                type="password"
                autocomplete="new-password"
                bind:value={poeSessId}
                class="bg-gray-700 rounded p-1 text-white text-xs"
                placeholder="Enter session id..." />
            </label>
            {#if !poeSessId}
              <div class="text-xs text-orange-300 bg-orange-900/40 border border-orange-600/50 rounded p-2">
                POESESSID is required to use Sync and Live Market features.
              </div>
            {/if}
            {#if showSessionHelp}
              <div class="bg-gray-800 border border-gray-600 p-2 rounded text-xs text-gray-300">
                <p class="font-bold mb-1 text-white">How to get your POESESSID:</p>
                <ol class="list-decimal list-inside space-y-1 ml-1">
                  <li>
                    Go to <a
                      href="https://www.pathofexile.com/trade"
                      target="_blank"
                      class="text-blue-400 hover:underline">pathofexile.com/trade</a> and log in.
                  </li>
                  <li>Press <strong>F12</strong> to open Developer Tools.</li>
                  <li>Go to <strong>Application</strong> tab → Cookies → pathofexile.com.</li>
                  <li>Find <strong>POESESSID</strong>, copy its value, paste here.</li>
                </ol>
                <p class="mt-2 text-orange-400 font-bold">Never share this ID with anyone!</p>
              </div>
            {/if}
            <div class="flex flex-row space-x-2">
              <button
                class="p-1 w-full bg-orange-600/60 rounded hover:bg-orange-600 disabled:bg-gray-600 font-bold text-xs"
                onclick={syncMarket}
                disabled={fetchingMarket}
                title="Fetches newly listed items; full fetch if cache missing or older than 7 days">
                {fetchingMarket ? 'Syncing...' : 'Sync'}
              </button>
              <button
                class="p-1 w-full bg-yellow-700/60 rounded hover:bg-yellow-700 disabled:bg-gray-600 font-bold text-xs"
                onclick={pruneMarketCache}
                disabled={fetchingMarket || cachedJewels.length === 0}
                title="Remove sold/delisted listings from cache">
                {fetchingMarket ? 'Pruning...' : 'Prune Sold'}
              </button>
            </div>
            <button
              class="text-xs text-red-400 hover:text-red-300 underline self-end disabled:text-gray-600"
              onclick={clearMarketCache}
              disabled={fetchingMarket || cachedJewels.length === 0}>
              Clear cache
            </button>
          </div>
        {/if}
        {#if marketProgress}
          <div class="text-xs text-blue-300 mt-1 text-center">{marketProgress}</div>
        {/if}
      </div>

      <!-- Filter + Sort -->
      <div class="flex flex-row space-x-2 items-center">
        <select bind:value={marketConquerorFilter} class="bg-gray-700 rounded p-1 text-xs text-white flex-1">
          <option value="All">All conquerors</option>
          {#each Object.keys(data.TimelessJewelConquerors[selectedJewel.value]) as conq}
            <option value={conq}>{conq}</option>
          {/each}
        </select>
        <select bind:value={marketSort} class="bg-gray-700 rounded p-1 text-xs text-white flex-1">
          <option value="price">Price ↑</option>
          <option value="seed">Seed ↑</option>
          <option value="date">Newest first</option>
        </select>
      </div>

      <!-- Seed list -->
      {#if filteredMarketJewels.length > 0}
        <div class="overflow-auto max-h-48 rounded border border-gray-700">
          <table class="w-full text-xs">
            <thead class="sticky top-0 bg-gray-900 text-gray-400">
              <tr>
                <th class="text-left p-1 pl-2">Seed</th>
                <th class="text-left p-1">Conqueror</th>
                <th class="text-left p-1">Price</th>
                <th class="p-1"></th>
              </tr>
            </thead>
            <tbody>
              {#each filteredMarketJewels as j}
                <tr
                  class="border-t border-gray-700/50 hover:bg-gray-700/40 cursor-pointer"
                  onclick={() => onseedselect?.({ seed: j.seed, worshipper: j.worshipper })}>
                  <td class="p-1 pl-2 font-mono">{j.seed}</td>
                  <td class="p-1 text-gray-300">{j.worshipper}</td>
                  <td class="p-1 text-yellow-300">{j.price || '—'}</td>
                  <td class="p-1 text-gray-500">→</td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      {:else}
        <div class="text-xs text-gray-500 text-center py-2">
          {cachedJewels.length === 0 ? 'No cached jewels. Click Sync to fetch.' : 'No jewels match the current filter.'}
        </div>
      {/if}
    </div>
  {/if}
</div>
<!-- ── End Market Panel ─────────────────────────────────── -->
