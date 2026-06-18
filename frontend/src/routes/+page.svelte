<script lang="ts">
  import SkillTree from '../lib/components/SkillTree.svelte';
  import Select from 'svelte-select';
  import { page } from '$app/stores';
  import { goto } from '$app/navigation';
  import type { Node } from '../lib/skill_tree_types';
  import { getAffectedNodes, skillTree, translateStat } from '../lib/skill_tree';
  import { openTrade } from '../lib/trade';
  import { syncWrap } from '../lib/worker';
  import { proxy } from 'comlink';
  import type {
    ReverseSearchConfig,
    StatConfig,
    MassReverseSearchConfig,
    MassSearchResults,
    SearchResults as SearchResultsData
  } from '../lib/skill_tree';
  import ResultsPanel from '../lib/components/ResultsPanel.svelte';
  import MarketPanel from '../lib/components/MarketPanel.svelte';
  import SearchConfigPanel from '../lib/components/SearchConfigPanel.svelte';
  import { data, calculator } from '../lib/types';
  import { onMount } from 'svelte';
  import {
    getGroupResults,
    setGroupResults,
    getPlatform,
    setPlatform,
    getLeague,
    setLeague
  } from '../lib/storageManager';
  import { openLiveSearch } from '$lib/trade_api';
  import { setCachedJewels } from '$lib/market_cache';
  import type { MarketJewel } from '$lib/market_cache';

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
      ? Object.keys(data.TimelessJewelConquerors[selectedJewel.value]).map((k) => ({
          value: k,
          label: k
        }))
      : []
  );

  let selectedConqueror = $state(
    searchParams.has('conqueror')
      ? {
          value: searchParams.get('conqueror'),
          label: searchParams.get('conqueror')
        }
      : undefined
  );

  // Conqueror is de-emphasized (its picker lives under the Market section), so
  // keep a sensible default selected for the chosen jewel. This keeps search,
  // trade URLs, and the seed preview working without the user opening Market.
  $effect(() => {
    if (selectedJewel && conquerors.length > 0) {
      const valid = conquerors.some((c) => c.value === selectedConqueror?.value);
      if (!valid) {
        selectedConqueror = conquerors[0];
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

  const seedResults = $derived(
    !seed ||
      !selectedJewel ||
      !selectedConqueror ||
      Object.keys(data.TimelessJewelConquerors[selectedJewel.value]).indexOf(selectedConqueror.value) < 0
      ? []
      : affectedNodes
          .filter((n) => !!data.TreeToPassive[n.skill])
          .map((n) => ({
            node: n.skill,
            result: calculator.Calculate(
              data.TreeToPassive[n.skill].Index,
              seed,
              selectedJewel.value,
              selectedConqueror.value
            )
          }))
  );

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

  // $state(new Set()) makes all mutations (add/delete/clear) reactive automatically.
  let disabled = $state(new Set<number>());

  const updateUrl = () => {
    const url = new URL(window.location.origin + window.location.pathname);
    selectedJewel && url.searchParams.append('jewel', selectedJewel.value.toString());
    selectedConqueror && url.searchParams.append('conqueror', selectedConqueror.value);
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

  const availableStats = $derived(!selectedJewel ? [] : Object.keys(allPossibleStats[selectedJewel.value]));
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

  // All matching seeds for the current search, for the "Trade all results" button.
  // Single search → its raw list; mass search → every socket's seeds, deduped.
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

  const search = () => {
    if (!circledNode) {
      return;
    }

    searchJewel = selectedJewel.value;
    searchConqueror = selectedConqueror.value;
    searching = true;
    searchResults = undefined;
    massSearchResults = undefined;
    activeSocketsCount = 1;
    seedsProcessed = 0;

    const query: ReverseSearchConfig = {
      jewel: selectedJewel.value,
      conqueror: selectedConqueror.value,
      nodes: affectedNodes
        .filter((n) => !disabled.has(n.skill))
        .map((n) => data.TreeToPassive[n.skill])
        .filter((n) => !!n)
        .map((n) => n.Index),
      stats: Object.keys(selectedStats).map((stat) => ({ ...selectedStats[parseInt(stat)] })),
      minTotalWeight
    };

    syncWrap
      .search(
        query,
        proxy(() => {
          seedsProcessed += 100;
        })
      )
      .then((result) => {
        searchResults = result;
        searching = false;
        results = true;
      });
  };

  const massSearch = () => {
    if (!selectedJewel || !selectedConqueror) {
      return;
    }

    searchJewel = selectedJewel.value;
    searchConqueror = selectedConqueror.value;
    searching = true;
    massSearchResults = undefined;
    searchResults = undefined;

    // We ignore disables for Mass Search to keep it uniform and simple across all jewels.
    const allSockets = Object.keys(skillTree.nodes)
      .filter((k) => {
        const node = skillTree.nodes[parseInt(k)];
        return node && node.isJewelSocket;
      })
      .map((k) => parseInt(k));
    const socketToNodes: { [socketId: number]: number[] } = {};
    allSockets.forEach((socketId) => {
      const affected = getAffectedNodes(skillTree.nodes[socketId]).filter((n) => n && !n.isJewelSocket && !n.isMastery);
      const validIndices = affected
        .map((n) => data.TreeToPassive[n.skill])
        .filter((n) => !!n)
        .map((n) => n.Index);
      socketToNodes[socketId] = validIndices;
    });

    const query: MassReverseSearchConfig = {
      jewel: selectedJewel.value,
      conqueror: selectedConqueror.value,
      socketToNodes,
      stats: Object.keys(selectedStats).map((stat) => ({ ...selectedStats[parseInt(stat)] })),
      minTotalWeight
    };

    activeSocketsCount = Object.keys(socketToNodes).length;
    seedsProcessed = 0;
    syncWrap
      .massSearch(
        query,
        proxy(() => {
          // Each update covers one seed-batch across every socket simultaneously
          // (passives are shared across sockets), so advance by the socket count.
          seedsProcessed += 100 * activeSocketsCount;
        })
      )
      .then((result) => {
        massSearchResults = result;
        searching = false;
        results = true;
      })
      .catch((err: unknown) => {
        console.error('[massSearch] error:', err);
        searching = false;
      });
  };

  let highlighted = $state<number[]>([]);
  const highlight = (newSeed: number, passives: number[]) => {
    seed = newSeed;
    highlighted = passives;
    updateUrl();
  };

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
    const response = await fetch('https://api.poe.watch/leagues');
    const responseJson = await response.json();

    // Sort leagues by start date descending so the newest leagues are first
    const sortedLeagues = (responseJson as { start_date: string; name: string }[]).sort(
      (a, b) => new Date(b.start_date).getTime() - new Date(a.start_date).getTime()
    );

    leagues = sortedLeagues.map((l) => ({ value: l.name, label: l.name }));

    // The main active challenge league is the newest one that isn't HC, SSF, or Ruthless
    const defaultLeague =
      leagues.find(
        (l) =>
          !l.value.includes('Ruthless') &&
          !l.value.includes('Self-Found') &&
          !l.value.includes('Hardcore') &&
          !l.value.includes('Standard')
      ) ||
      leagues.find((l) => l.value === 'Standard') ||
      leagues[0];

    league = leagues.find((l) => l.value === getLeague()) || defaultLeague;
  };

  $effect(() => {
    if (league) {
      setLeague(league.value);
    }
  });

  // SkillTree is kept in legacy mode (Svelte 4) so bind:this + centerOnNode still work.
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

  // Live feed state
  let liveFeeds = $state<Array<() => void>>([]);
  let liveFeedAllActive = $state(false);
  let liveFeedSocketActive = $state(false);
  let liveAccumulator = $state<MassSearchResults>({ resultsBySocket: {} });
  let liveFeedStatus = $state('');

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

  const stopLiveFeed = () => {
    liveFeeds.forEach((fn) => fn());
    liveFeeds = [];
    liveFeedAllActive = false;
    liveFeedSocketActive = false;
    liveFeedStatus = 'Live feed stopped.';
  };

  const startLiveFeed = async (allSockets: boolean) => {
    if (!selectedJewel || !selectedConqueror || Object.keys(selectedStats).length === 0) {
      return;
    }
    if (!allSockets && !circledNode) {
      return;
    }

    if (!poeSessId) {
      showMarketPanel = true;
      showMarketSettings = true;
      liveFeedStatus = 'auth-required';
      return;
    }

    if (allSockets) {
      liveFeedAllActive = true;
    } else {
      liveFeedSocketActive = true;
    }

    liveAccumulator = { resultsBySocket: {} };
    massSearchResults = undefined;
    searchResults = undefined;
    results = true;

    const socketToNodes = allSockets
      ? buildSocketToNodes()
      : {
          [circledNode]: affectedNodes
            .filter((n) => !disabled.has(n.skill))
            .map((n) => data.TreeToPassive[n.skill])
            .filter(Boolean)
            .map((n) => n.Index)
        };

    const handleNewJewels = async (newJewels: MarketJewel[]) => {
      const jewelMap = new Map(cachedJewels.filter((j) => j.id).map((j) => [j.id, j]));
      for (const j of newJewels) {
        if (j.id) {
          jewelMap.set(j.id, j);
        }
      }
      cachedJewels = [...jewelMap.values(), ...cachedJewels.filter((j) => !j.id)];
      setCachedJewels(selectedJewel.value, league?.value || 'Standard', cachedJewels);

      const partial = await syncWrap.targetedMassSearch(
        {
          jewel: selectedJewel.value,
          seeds: newJewels.map((j) => j.seed),
          conquerors: newJewels.map((j) => j.worshipper),
          prices: newJewels.map((j) => j.price),
          listedAts: newJewels.map((j) => j.listedAt),
          socketToNodes,
          stats: Object.values(selectedStats)
            .filter((s) => s.weight > 0)
            .map((s) => ({ ...s })),
          minTotalWeight
        },
        proxy(async () => {})
      );

      liveAccumulator = syncWrap.mergeMassResults(liveAccumulator, partial);
      massSearchResults = liveAccumulator;
    };

    try {
      const cleanup = await openLiveSearch(
        selectedJewel.value,
        league?.value || 'Standard',
        poeSessId,
        handleNewJewels,
        (msg) => {
          liveFeedStatus = msg;
          if (msg.toLowerCase().includes('error') || msg.toLowerCase().includes('failed')) {
            showMarketPanel = true;
            showMarketSettings = true;
          }
        }
      );
      liveFeeds = [cleanup];
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Failed to start live feed');
      liveFeedAllActive = false;
      liveFeedSocketActive = false;
    }
  };

  const marketSearchAllSockets = async () => {
    if (!selectedJewel) {
      return;
    }
    if (filteredMarketJewels.length === 0) {
      alert('No jewels in market cache for the selected conqueror filter.');
      return;
    }

    searchJewel = selectedJewel.value;
    searching = true;
    massSearchResults = undefined;
    searchResults = undefined;
    seedsProcessed = 0;

    const allSockets = Object.keys(skillTree.nodes)
      .map((k) => parseInt(k))
      .filter((k) => skillTree.nodes[k]?.isJewelSocket);
    const reqNodes: { [key: number]: number[] } = {};
    allSockets.forEach((socketId) => {
      const affected = getAffectedNodes(skillTree.nodes[socketId]).filter((n) => n && !n.isJewelSocket && !n.isMastery);
      reqNodes[socketId] = affected
        .map((n) => data.TreeToPassive[n.skill])
        .filter(Boolean)
        .map((n) => n.Index);
    });
    activeSocketsCount = allSockets.length;

    const seeds = filteredMarketJewels.map((j) => j.seed);
    const marketConquerors = filteredMarketJewels.map((j) => j.worshipper);
    const prices = filteredMarketJewels.map((j) => j.price);

    seedsProcessed = 0;

    const res = await syncWrap.targetedMassSearch(
      {
        jewel: selectedJewel.value,
        seeds,
        conquerors: marketConquerors,
        prices,
        socketToNodes: reqNodes,
        stats: Object.values(selectedStats)
          .filter((s) => s.weight > 0)
          .map((s) => ({ ...s })),
        minTotalWeight
      },
      proxy(async () => {
        seedsProcessed++;
      })
    );

    massSearchResults = res;
    searching = false;
    results = true;
  };

  let seedSearchInput = $state<number>(0);

  const searchBySeed = async () => {
    if (!selectedJewel || !selectedConqueror || !seedSearchInput) {
      return;
    }

    searchJewel = selectedJewel.value;
    searchConqueror = selectedConqueror.value;
    searching = true;
    massSearchResults = undefined;
    searchResults = undefined;
    seedsProcessed = 0;

    const allSockets = Object.keys(skillTree.nodes)
      .map((k) => parseInt(k))
      .filter((k) => skillTree.nodes[k]?.isJewelSocket);
    const socketToNodes: { [key: number]: number[] } = {};
    allSockets.forEach((socketId) => {
      const affected = getAffectedNodes(skillTree.nodes[socketId]).filter((n) => n && !n.isJewelSocket && !n.isMastery);
      socketToNodes[socketId] = affected
        .map((n) => data.TreeToPassive[n.skill])
        .filter(Boolean)
        .map((n) => n.Index);
    });
    activeSocketsCount = allSockets.length;

    const res = await syncWrap.targetedMassSearch(
      {
        jewel: selectedJewel.value,
        seeds: [seedSearchInput],
        conquerors: [selectedConqueror.value],
        socketToNodes,
        stats: Object.values(selectedStats)
          .filter((s) => s.weight > 0)
          .map((s) => ({ ...s })),
        minTotalWeight
      },
      proxy(async () => {
        seedsProcessed++;
      })
    );

    massSearchResults = res;
    searching = false;
    results = true;
  };

  const marketSearchCurrentSocket = async () => {
    if (!selectedJewel || !circledNode) {
      return;
    }
    if (filteredMarketJewels.length === 0) {
      alert('No jewels in market cache for the selected conqueror filter.');
      return;
    }

    searching = true;
    massSearchResults = undefined;
    searchResults = undefined;
    seedsProcessed = 0;

    const socketToNodes = {
      [circledNode]: affectedNodes
        .filter((n) => !disabled.has(n.skill))
        .map((n) => data.TreeToPassive[n.skill])
        .filter(Boolean)
        .map((n) => n.Index)
    };

    const res = await syncWrap.targetedMassSearch(
      {
        jewel: selectedJewel.value,
        seeds: filteredMarketJewels.map((j) => j.seed),
        conquerors: filteredMarketJewels.map((j) => j.worshipper),
        prices: filteredMarketJewels.map((j) => j.price),
        socketToNodes,
        stats: Object.values(selectedStats)
          .filter((s) => s.weight > 0)
          .map((s) => ({ ...s })),
        minTotalWeight
      },
      proxy(async () => {
        seedsProcessed++;
      })
    );

    massSearchResults = res;
    searching = false;
    results = true;
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
                <span>Timeless Jewel</span>
              {/if}
            </h3>

            {#if (searchResults || massSearchResults) && results}
              <Select items={leagues} bind:value={league} on:change={updateUrl} clearable={false} />
              <Select items={platforms} bind:value={platform} on:change={updateUrl} clearable={false} />
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
