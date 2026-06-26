<script lang="ts">
  // PoE2 page — intentionally the SAME shell as the PoE1 page (routes/+page.svelte):
  // identical SkillTree canvas, side panel, and buttons, but driven by the PoE2
  // tree/jewels (loaded into the shared singletons by the PoE2 boot in +layout).
  // Search is backed by the community DB (Neon, via the Worker) through lib/poe2/search:
  // notable/socket searches hit /api/poe2/search, seed searches hit /api/poe2/consensus.
  // The notable search defaults to verified-only (>= 2 distinct contributors); the
  // "include unverified" toggle relaxes that so single-source records (e.g. your own
  // freshly-recorded ones) also show. PoE2 has no PRNG, so the seed preview is empty.
  import SkillTree from '../../lib/components/SkillTree.svelte';
  import Select from 'svelte-select';
  import { page } from '$app/stores';
  import { goto } from '$app/navigation';
  import type { Node } from '../../lib/skill_tree_types';
  import { getAffectedNodes, skillTree, translateStat } from '../../lib/skill_tree';
  import { openTrade } from '../../lib/trade';
  import type { StatConfig, MassSearchResults, SearchResults as SearchResultsData } from '../../lib/skill_tree';
  import type { AlternatePassiveSkillInformation } from '../../lib/calculator/types';
  import ResultsPanel from '../../lib/components/ResultsPanel.svelte';
  import MarketPanel from '../../lib/components/MarketPanel.svelte';
  import SearchConfigPanel from '../../lib/components/SearchConfigPanel.svelte';
  import { data } from '../../lib/types';
  import { onMount } from 'svelte';
  import {
    getGroupResults,
    setGroupResults,
    getPlatform,
    setPlatform,
    getLeague,
    setLeague
  } from '../../lib/storageManager';
  import type { MarketJewel } from '$lib/market_cache';
  import { SvelteSet } from 'svelte/reactivity';
  import {
    searchSocket,
    searchAllSockets,
    searchSeed,
    getSeedTransforms,
    type Poe2Transform
  } from '../../lib/poe2/search';
  import { workerBase } from '../../lib/poe2/config';

  // The conqueror/variant doesn't affect the (variant-agnostic) DB search — it only
  // picks which keystone you want and which variant the Trade link filters for. "Any"
  // (value '') trades across all variants; a specific one narrows it.
  const ANY_CONQUEROR = { value: '', label: 'Any conqueror' };

  const searchParams = $page.url.searchParams;

  const jewels = Object.keys(data.TimelessJewels).map((k) => ({
    value: parseInt(k),
    label: data.TimelessJewels[k]
  }));

  let selectedJewel = $state(
    searchParams.has('jewel') ? jewels.find((j) => j.value == searchParams.get('jewel')) : undefined
  );

  const conquerors = $derived(
    selectedJewel
      ? [
          ANY_CONQUEROR,
          ...Object.keys(data.TimelessJewelConquerors[selectedJewel.value]).map((k) => ({
            value: k,
            label: k
          }))
        ]
      : []
  );

  let selectedConqueror = $state(
    searchParams.has('conqueror')
      ? {
          value: searchParams.get('conqueror'),
          label: searchParams.get('conqueror')
        }
      : ANY_CONQUEROR
  );

  // Default to "Any conqueror"; only fall back to it if the current pick isn't valid
  // for the chosen jewel (e.g. after switching jewels).
  $effect(() => {
    if (selectedJewel && conquerors.length > 0) {
      const valid = conquerors.some((c) => c.value === selectedConqueror?.value);
      if (!valid) {
        selectedConqueror = ANY_CONQUEROR;
      }
    }
  });

  let seed = $state<number>(searchParams.has('seed') ? parseInt(searchParams.get('seed')) : 0);

  let circledNode = $state<number | undefined>(
    searchParams.has('location') ? parseInt(searchParams.get('location')) : undefined
  );

  const affectedNodes = $derived(
    circledNode ? getAffectedNodes(skillTree.nodes[circledNode]).filter((n) => !n.isJewelSocket && !n.isMastery) : []
  );

  // PoE2 has no deterministic PRNG — the live seed preview is not available.
  // The DB lookup will replace this later.
  const seedResults: { node: number; result: AlternatePassiveSkillInformation }[] = [];

  let selectedStats = $state<Record<number, StatConfig>>({});
  if (searchParams.has('stat')) {
    searchParams.getAll('stat').forEach((s) => {
      const nStat = parseInt(s);
      selectedStats[nStat] = {
        weight: 1,
        min: 0,
        id: nStat
      };
    });
  }

  let mode = $state(searchParams.has('mode') ? searchParams.get('mode') : '');

  // SvelteSet so add/delete/clear are reactive (a plain Set is NOT proxied by $state,
  // so mutations wouldn't re-render the tree / dim nodes). Wrapped in $state so the
  // `disabled={[...disabled]}` prop expression stays in a tracked context and isn't
  // hoisted as a constant — the spread then re-runs on every SvelteSet mutation.
  let disabled = $state(new SvelteSet<number>());

  const updateUrl = () => {
    const url = new URL(window.location.origin + window.location.pathname);
    selectedJewel && url.searchParams.append('jewel', selectedJewel.value.toString());
    // 'Any' (value '') isn't worth persisting — leaving it out keeps Any the default.
    selectedConqueror && selectedConqueror.value && url.searchParams.append('conqueror', selectedConqueror.value);
    seed && url.searchParams.append('seed', seed.toString());
    circledNode && url.searchParams.append('location', circledNode.toString());
    mode && url.searchParams.append('mode', mode);
    disabled.forEach((d) => url.searchParams.append('disabled', d.toString()));

    Object.keys(selectedStats).forEach((s) => {
      url.searchParams.append('stat', s.toString());
    });

    goto(url.toString());
  };

  if (searchParams.has('disabled')) {
    searchParams.getAll('disabled').forEach((d) => {
      disabled.add(parseInt(d));
    });
  }

  const clickNode = (node: Node) => {
    if (node.isJewelSocket) {
      circledNode = node.skill;
      updateUrl();
    } else if (!node.isMastery) {
      if (disabled.has(node.skill)) {
        disabled.delete(node.skill);
      } else {
        disabled.add(node.skill);
      }
      updateUrl();
    }
  };

  const allPossibleStats: { [key: string]: { [key: string]: number } } = JSON.parse(data.PossibleStats);

  const availableStats = $derived(!selectedJewel ? [] : Object.keys(allPossibleStats[selectedJewel.value] ?? {}));
  const statItems = $derived(
    availableStats
      .map((statId) => {
        const id = parseInt(statId);
        return {
          label: translateStat(id),
          value: id
        };
      })
      .filter((s) => !(s.value in selectedStats))
  );

  const changeJewel = () => {
    selectedStats = {};
    updateUrl();
  };

  let results = $state(false);
  let minTotalWeight = $state(0);
  let searching = $state(false);
  let seedsProcessed = $state(0);
  let activeSocketsCount = $state(1);
  let searchJewel = $state(1);
  let searchConqueror = $state('');
  let massSearchResults = $state<MassSearchResults | undefined>(undefined);

  const totalSeeds = () => {
    const jewelId = searchJewel || selectedJewel?.value || 0;
    const range = data.TimelessJewelSeedRanges[jewelId];
    if (!range) {
      return 0;
    }
    let count = range.Max - range.Min + 1;
    if (range.Special) {
      count = Math.floor((range.Max - range.Min) / 20) + 1;
    }
    return count * activeSocketsCount;
  };

  let searchResults = $state<SearchResultsData | undefined>(undefined);
  // Notable/socket searches are verified-only by default (>= 2 distinct contributors).
  // Toggle this on to also surface single-source records — e.g. ones you just recorded
  // yourself that nobody else has confirmed yet. (Seed search always shows everything.)
  let includeUnverified = $state(true);

  const tradeResults = $derived.by<{ seed: number }[]>(() => {
    if (searchResults) {
      return searchResults.raw;
    }
    if (massSearchResults) {
      const seen = new Set<number>();
      const out: { seed: number }[] = [];
      for (const socket of Object.values(massSearchResults.resultsBySocket)) {
        for (const r of socket.raw) {
          if (!seen.has(r.seed)) {
            seen.add(r.seed);
            out.push(r);
          }
        }
      }
      return out;
    }
    return [];
  });

  const buildSocketToNodes = (): { [key: number]: number[] } => {
    const allSockets = Object.keys(skillTree.nodes)
      .map((k) => parseInt(k))
      .filter((k) => skillTree.nodes[k]?.isJewelSocket);
    const map: { [key: number]: number[] } = {};
    allSockets.forEach((socketId) => {
      const affected = getAffectedNodes(skillTree.nodes[socketId]).filter((n) => n && !n.isJewelSocket && !n.isMastery);
      map[socketId] = affected
        .map((n) => data.TreeToPassive[n.skill])
        .filter(Boolean)
        .map((n) => n.Index);
    });
    return map;
  };

  // The DB jewel_type is the jewel's name; selectedJewel.label already holds it.
  const affectedSkills = (): number[] => affectedNodes.filter((n) => !disabled.has(n.skill)).map((n) => n.skill);

  const search = async () => {
    if (!circledNode || !selectedJewel || !selectedConqueror) {
      return;
    }
    searchJewel = selectedJewel.value;
    searchConqueror = selectedConqueror.value;
    searching = true;
    try {
      searchResults = await searchSocket(
        selectedJewel.label,
        Object.values(selectedStats),
        affectedSkills(),
        minTotalWeight,
        undefined,
        !includeUnverified
      );
      massSearchResults = undefined;
      results = true;
    } finally {
      searching = false;
    }
  };

  const massSearch = async () => {
    if (!selectedJewel || !selectedConqueror) {
      return;
    }
    searchJewel = selectedJewel.value;
    searchConqueror = selectedConqueror.value;
    searching = true;
    try {
      massSearchResults = await searchAllSockets(
        selectedJewel.label,
        Object.values(selectedStats),
        buildSocketToNodes(),
        minTotalWeight,
        undefined,
        !includeUnverified
      );
      searchResults = undefined;
      results = true;
    } finally {
      searching = false;
    }
  };

  let highlighted = $state<number[]>([]);
  const highlight = (newSeed: number, passives: number[]) => {
    seed = newSeed;
    highlighted = passives;
    updateUrl();
  };

  // Every affected notable's recorded transform for the selected seed, fed to the tree so its
  // tooltip shows what each node becomes — not just the searched stat. Refetched whenever the
  // seed or jewel changes (covers result clicks, seed search, and URL restore). Empty until a
  // seed is picked, and for seeds nobody has recorded.
  let seedTransforms = $state<Map<number, Poe2Transform>>(new Map());
  $effect(() => {
    const activeSeed = seed;
    const jewel = selectedJewel;
    if (!activeSeed || !jewel) {
      seedTransforms = new Map();
      return;
    }
    let cancelled = false;
    getSeedTransforms(jewel.label, jewel.value, activeSeed)
      .then((m) => {
        if (!cancelled) {
          seedTransforms = m;
        }
      })
      .catch(() => {
        if (!cancelled) {
          seedTransforms = new Map();
        }
      });
    return () => {
      cancelled = true;
    };
  });

  const selectAll = () => {
    disabled.clear();
  };

  const selectAllNotables = () => {
    affectedNodes.forEach((n) => {
      if (n.isNotable) {
        disabled.delete(n.skill);
      }
    });
  };

  const selectAllPassives = () => {
    affectedNodes.forEach((n) => {
      if (!n.isNotable) {
        disabled.delete(n.skill);
      }
    });
  };

  const deselectAll = () => {
    affectedNodes.filter((n) => !n.isJewelSocket && !n.isMastery).forEach((n) => disabled.add(n.skill));
  };

  let groupResults = $state(getGroupResults(true));
  $effect(() => {
    setGroupResults(groupResults);
  });

  const onPaste = (event: ClipboardEvent) => {
    if (event.type !== 'paste') {
      return;
    }

    const paste = (event.clipboardData || window.clipboardData).getData('text');
    const lines = paste.split('\n');

    if (lines.length < 14) {
      return;
    }

    const jewel = jewels.find((j) => j.label === lines[2]);
    if (!jewel) {
      return;
    }

    let newSeed: number | undefined;
    let conqueror: string | undefined;
    for (let i = 10; i < lines.length; i++) {
      conqueror = Object.keys(data.TimelessJewelConquerors[jewel.value]).find((k) => lines[i].indexOf(k) >= 0);
      if (conqueror) {
        const matches = /(\d+)/.exec(lines[i]);
        if (matches.length === 0) {
          continue;
        }
        newSeed = parseInt(matches[1]);
        break;
      }
    }

    if (!conqueror || !newSeed) {
      return;
    }

    results = false;
    mode = 'seed';
    seed = newSeed;
    selectedJewel = jewel;
    selectedConqueror = { label: conqueror, value: conqueror };
    updateUrl();
  };

  let collapsed = $state(false);

  const platforms = [
    { value: 'PC', label: 'PC' },
    { value: 'Xbox', label: 'Xbox' },
    { value: 'Playstation', label: 'Playstation' }
  ];

  let platform = $state(platforms.find((p) => p.value === getPlatform()) || platforms[0]);
  $effect(() => {
    setPlatform(platform.value);
  });

  let leagues = $state<{ value: string; label: string }[]>([]);
  let league = $state<{ value: string; label: string } | undefined>(undefined);
  const getLeagues = async () => {
    // PoE2 leagues (realm 'poe2'), via the trade2 API through the Worker proxy — the
    // PoE1 poe.watch list would produce invalid /trade2 URLs.
    const response = await fetch(`${workerBase()}/api/trade2/data/leagues`);
    const responseJson = (await response.json()) as { result: { id: string; text: string }[] };

    leagues = responseJson.result.map((l) => ({ value: l.id, label: l.text }));

    const defaultLeague =
      leagues.find((l) => !/Standard|Hardcore|^HC /.test(l.value)) ||
      leagues.find((l) => l.value === 'Standard') ||
      leagues[0];

    league = leagues.find((l) => l.value === getLeague()) || defaultLeague;
  };

  $effect(() => {
    if (league) {
      setLeague(league.value);
    }
  });

  let skillTreeComponent: SkillTree;

  onMount(() => {
    getLeagues();
  });

  // Market state (bindable into MarketPanel)
  let poeSessId = $state('');
  let showMarketPanel = $state(true);
  let showMarketSettings = $state(false);
  let cachedJewels = $state<MarketJewel[]>([]);
  let filteredMarketJewels = $state<MarketJewel[]>([]);

  // Live feed state (stubbed for PoE2)
  let liveFeedAllActive = $state(false);
  let liveFeedSocketActive = $state(false);
  let liveFeedStatus = $state('');

  const stopLiveFeed = () => {
    liveFeedAllActive = false;
    liveFeedSocketActive = false;
    liveFeedStatus = 'Live feed stopped.';
  };

  const startLiveFeed = () => {
    // PoE2 has no live trade feed yet — the dataset is community-recorded, not traded. Surface
    // that instead of silently doing nothing.
    liveFeedAllActive = false;
    liveFeedSocketActive = false;
    liveFeedStatus = 'Live trade feed is not available for PoE2.';
    searching = false;
  };

  const marketSearchAllSockets = async () => {
    if (!selectedJewel) {
      return;
    }
    searchJewel = selectedJewel.value;
    if (selectedConqueror) {
      searchConqueror = selectedConqueror.value;
    }
    searching = true;
    try {
      massSearchResults = await searchAllSockets(
        selectedJewel.label,
        Object.values(selectedStats),
        buildSocketToNodes(),
        minTotalWeight,
        filteredMarketJewels.map((j) => j.seed),
        !includeUnverified
      );
      searchResults = undefined;
      results = true;
    } finally {
      searching = false;
    }
  };

  const marketSearchCurrentSocket = async () => {
    if (!selectedJewel || !circledNode) {
      return;
    }
    searchJewel = selectedJewel.value;
    if (selectedConqueror) {
      searchConqueror = selectedConqueror.value;
    }
    searching = true;
    try {
      searchResults = await searchSocket(
        selectedJewel.label,
        Object.values(selectedStats),
        affectedSkills(),
        minTotalWeight,
        filteredMarketJewels.map((j) => j.seed),
        !includeUnverified
      );
      massSearchResults = undefined;
      results = true;
    } finally {
      searching = false;
    }
  };

  let seedSearchInput = $state<number>(0);

  const searchBySeed = async () => {
    if (!selectedJewel || !selectedConqueror || !seedSearchInput) {
      return;
    }
    searchJewel = selectedJewel.value;
    searchConqueror = selectedConqueror.value;
    searching = true;
    try {
      searchResults = await searchSeed(selectedJewel.label, seedSearchInput);
      massSearchResults = undefined;
      results = true;
    } finally {
      searching = false;
    }
  };
</script>

<svelte:window onpaste={onPaste} />

<SkillTree
  bind:this={skillTreeComponent}
  {clickNode}
  {circledNode}
  selectedJewel={selectedJewel?.value}
  {highlighted}
  {seed}
  poe2Transforms={seedTransforms}
  highlightJewels={!circledNode}
  disabled={[...disabled]}>
  {#if !collapsed}
    <div
      class="w-screen md:w-10/12 lg:w-2/3 xl:w-1/2 2xl:w-5/12 3xl:w-1/3 4xl:w-1/4 lg:min-w-[820px] max-w-full absolute top-0 left-0 bg-black/80 backdrop-blur-sm themed rounded-br-lg max-h-screen">
      <div class="p-4 max-h-screen flex flex-col">
        <div class="flex flex-row flex-wrap justify-between items-center gap-2 mb-2">
          <div class="flex flex-row flex-wrap items-center gap-2">
            <button class="burger-menu" aria-label="Collapse panel" onclick={() => (collapsed = true)}>
              <div></div>
              <div></div>
              <div></div>
            </button>

            <h3>
              {#if results}
                <span>Results</span>
              {:else}
                <span>Timeless Jewel (PoE2)</span>
              {/if}
            </h3>

            {#if (searchResults || massSearchResults) && results}
              <div class="w-36 shrink-0">
                <Select items={leagues} bind:value={league} on:change={updateUrl} clearable={false} />
              </div>
              <div class="w-28 shrink-0">
                <Select items={platforms} bind:value={platform} on:change={updateUrl} clearable={false} />
              </div>
              <button
                class="p-1 px-3 bg-blue-500/40 rounded disabled:bg-blue-900/40 disabled:cursor-not-allowed"
                disabled={tradeResults.length === 0}
                title="Open the trade site prefilled with all matching jewels"
                onclick={() => openTrade(searchJewel, searchConqueror, tradeResults, platform.value, league.value)}>
                Trade
              </button>
            {/if}
          </div>
          {#if searchResults || massSearchResults}
            <div class="flex flex-row items-center gap-2">
              {#if results && searchResults}
                <button
                  class="p-1 px-3 bg-blue-500/40 rounded disabled:bg-blue-900/40"
                  class:grouped={groupResults}
                  onclick={() => (groupResults = !groupResults)}>
                  Grouped
                </button>
              {/if}
              <button class="bg-neutral-100/20 px-4 p-1 rounded" onclick={() => (results = !results)}>
                {results ? 'Config' : 'Results'}
              </button>
            </div>
          {/if}
        </div>

        {#if !results}
          <Select items={jewels} bind:value={selectedJewel} on:change={changeJewel} />

          {#if selectedJewel}
            <label
              class="mb-2 flex cursor-pointer select-none items-center gap-2 text-sm text-gray-300"
              title="Community records need 2 independent contributors to be 'verified'. Enable this to also show single-source records — including ones you just recorded yourself.">
              <input type="checkbox" bind:checked={includeUnverified} />
              Include unverified (single-source) records
            </label>
            <SearchConfigPanel
              {selectedJewel}
              bind:selectedConqueror
              bind:mode
              bind:seed
              {affectedNodes}
              {circledNode}
              bind:disabled
              {seedResults}
              {allPossibleStats}
              bind:selectedStats
              {statItems}
              bind:minTotalWeight
              {searching}
              {seedsProcessed}
              {totalSeeds}
              {cachedJewels}
              {filteredMarketJewels}
              {liveFeedAllActive}
              {liveFeedSocketActive}
              {liveFeedStatus}
              {searchResults}
              {massSearchResults}
              bind:seedSearchInput
              onSearch={search}
              onMassSearch={massSearch}
              onMarketSearchCurrentSocket={marketSearchCurrentSocket}
              onMarketSearchAllSockets={marketSearchAllSockets}
              onSearchBySeed={searchBySeed}
              onStartLiveFeed={startLiveFeed}
              onStopLiveFeed={stopLiveFeed}
              onSelectAll={selectAll}
              onSelectAllNotables={selectAllNotables}
              onSelectAllPassives={selectAllPassives}
              onDeselectAll={deselectAll}
              onHighlight={highlight}
              onUpdateUrl={updateUrl} />

            <MarketPanel
              {selectedJewel}
              {leagues}
              {conquerors}
              bind:selectedConqueror
              bind:league
              bind:cachedJewels
              bind:poeSessId
              bind:showMarketPanel
              bind:showMarketSettings
              bind:filteredMarketJewels
              onConquerorChange={updateUrl}
              onseedselect={({ seed: s, worshipper }) => {
                seed = s;
                selectedConqueror = { value: worshipper, label: worshipper };
                mode = 'seed';
                updateUrl();
              }} />
          {/if}
        {/if}

        {#if results}
          <ResultsPanel
            {searchResults}
            {massSearchResults}
            {groupResults}
            jewel={searchJewel}
            conqueror={searchConqueror}
            platform={platform.value}
            league={league.value}
            onHighlight={highlight}
            onMassSelect={(socketId, resultSeed, passives) => {
              circledNode = socketId;
              highlight(resultSeed, passives);
              skillTreeComponent.centerOnNode(socketId);
            }}
            onSocketFocus={(socketId) => {
              circledNode = socketId;
              skillTreeComponent.centerOnNode(socketId);
              updateUrl();
            }} />
        {/if}
      </div>
    </div>
  {:else}
    <button
      class="burger-menu absolute top-0 left-0 bg-black/80 backdrop-blur-sm rounded-br-lg p-4 pt-5"
      aria-label="Expand panel"
      onclick={() => (collapsed = false)}>
      <div></div>
      <div></div>
      <div></div>
    </button>
  {/if}

  <div class="text-orange-500 absolute bottom-0 right-0 m-2">
    <a href="https://github.com/Vilsol/timeless-jewels" target="_blank" rel="noopener">Source (Github)</a>
  </div>
</SkillTree>

<style lang="postcss">
  .grouped {
    @apply bg-pink-500/40 disabled:bg-pink-900/40;
  }
</style>
