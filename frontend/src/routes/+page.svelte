<script lang="ts">
  import SkillTree from '../lib/components/SkillTree.svelte';
  import Select from 'svelte-select';
  import { page } from '$app/stores';
  import { goto } from '$app/navigation';
  import type { Node } from '../lib/skill_tree_types';
  import { getAffectedNodes, skillTree, translateStat, openTrade } from '../lib/skill_tree';
  import { syncWrap } from '../lib/worker';
  import { proxy } from 'comlink';
  import type { ReverseSearchConfig, StatConfig, MassReverseSearchConfig, MassSearchResults } from '../lib/skill_tree';
  import SearchResults from '../lib/components/SearchResults.svelte';
  import { statValues } from '../lib/values';
  import { data, calculator } from '../lib/types';
  import { onMount } from 'svelte';

  const searchParams = $page.url.searchParams;

  const jewels = Object.keys(data.TimelessJewels).map((k) => ({
    value: parseInt(k),
    label: data.TimelessJewels[k]
  }));

  let selectedJewel = searchParams.has('jewel') ? jewels.find((j) => j.value == searchParams.get('jewel')) : undefined;

  $: conquerors = selectedJewel
    ? Object.keys(data.TimelessJewelConquerors[selectedJewel.value]).map((k) => ({
        value: k,
        label: k
      }))
    : [];

  let selectedConqueror = searchParams.has('conqueror')
    ? {
        value: searchParams.get('conqueror'),
        label: searchParams.get('conqueror')
      }
    : undefined;

  let seed: number = searchParams.has('seed') ? parseInt(searchParams.get('seed')) : 0;

  let circledNode: number | undefined = searchParams.has('location')
    ? parseInt(searchParams.get('location'))
    : undefined;

  $: affectedNodes = circledNode
    ? getAffectedNodes(skillTree.nodes[circledNode]).filter((n) => !n.isJewelSocket && !n.isMastery)
    : [];

  $: seedResults =
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
          }));

  let selectedStats: Record<number, StatConfig> = {};
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

  let mode = searchParams.has('mode') ? searchParams.get('mode') : '';

  let disabled = new Set<number>();

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

  const setMode = (newMode: string) => {
    mode = newMode;
    updateUrl();
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
      // Re-assign to update svelte
      disabled = disabled;
      updateUrl();
    }
  };

  const allPossibleStats: { [key: string]: { [key: string]: number } } = JSON.parse(data.PossibleStats);

  $: availableStats = !selectedJewel ? [] : Object.keys(allPossibleStats[selectedJewel.value]);
  $: statItems = availableStats
    .map((statId) => {
      const id = parseInt(statId);
      return {
        label: translateStat(id),
        value: id
      };
    })
    .filter((s) => !(s.value in selectedStats));

  let statSelector: Select;
  const selectStat = (stat: CustomEvent) => {
    selectedStats[stat.detail.value] = {
      weight: 1,
      min: 0,
      id: stat.detail.value
    };
    selectedStats = selectedStats;
    statSelector.handleClear();
    updateUrl();
  };

  const removeStat = (id: number) => {
    delete selectedStats[id];
    // Re-assign to update svelte
    selectedStats = selectedStats;
    updateUrl();
  };

  const changeJewel = () => {
    selectedStats = {};
    updateUrl();
  };

  let results = false;
  let minTotalWeight = 0;
  let searching = false;
  let currentSeed = 0;
  let seedsProcessed = 0;
  let activeSocketsCount = 1;

  const totalSeeds = () => {
    const jewelId = searchJewel || selectedJewel?.value || 0;
    const range = data.TimelessJewelSeedRanges[jewelId];
    if (!range) return 0;
    
    let count = (range.Max - range.Min) + 1;
    if (range.Special) {
      count = Math.floor((range.Max - range.Min) / 20) + 1;
    }
    
    return count * activeSocketsCount;
  };

  let searchResults: SearchResults;
  let searchJewel = 1;
  let searchConqueror = '';
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
      stats: Object.keys(selectedStats).map((stat) => selectedStats[stat]),
      minTotalWeight
    };

    syncWrap
      .search(
        query,
        proxy((s) => { currentSeed = s; seedsProcessed += 100; })
      )
      .then((result) => {
        searchResults = result;
        searching = false;
        results = true;
      });
  };
  let massSearchResults: MassSearchResults | undefined;
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
    const allSockets = Object.keys(skillTree.nodes).filter(k => {
      const node = skillTree.nodes[parseInt(k)];
      return node && node.isJewelSocket;
    }).map(k => parseInt(k));
    const socketToNodes: { [socketId: number]: number[] } = {};
    allSockets.forEach(socketId => {
      const affected = getAffectedNodes(skillTree.nodes[socketId]).filter((n) => n && !n.isJewelSocket && !n.isMastery);
      const validIndices = affected.map(n => data.TreeToPassive[n.skill]).filter(n => !!n).map(n => n.Index);
      socketToNodes[socketId] = validIndices;
    });

    const query: MassReverseSearchConfig = {
      jewel: selectedJewel.value,
      conqueror: selectedConqueror.value,
      socketToNodes,
      stats: Object.keys(selectedStats).map(stat => selectedStats[stat]),
      minTotalWeight
    };

    activeSocketsCount = Object.keys(socketToNodes).length;
    seedsProcessed = 0; syncWrap.massSearch(query, proxy((s) => { seedsProcessed += (100 * activeSocketsCount); })).then((result) => {
      massSearchResults = result; console.log('MAIN THREAD massSearch result: ', JSON.stringify(result, null, 2));
      searching = false;
      results = true;
    });
  };
  let highlighted: number[] = [];
  const highlight = (newSeed: number, passives: number[]) => {
    seed = newSeed;
    highlighted = passives;
    updateUrl();
  };

  const selectAll = () => {
    disabled.clear();
    // Re-assign to update svelte
    disabled = disabled;
  };

  const selectAllNotables = () => {
    affectedNodes.forEach((n) => {
      if (n.isNotable) {
        disabled.delete(n.skill);
      }
    });
    // Re-assign to update svelte
    disabled = disabled;
  };

  const selectAllPassives = () => {
    affectedNodes.forEach((n) => {
      if (!n.isNotable) {
        disabled.delete(n.skill);
      }
    });
    // Re-assign to update svelte
    disabled = disabled;
  };

  const deselectAll = () => {
    affectedNodes.filter((n) => !n.isJewelSocket && !n.isMastery).forEach((n) => disabled.add(n.skill));
    // Re-assign to update svelte
    disabled = disabled;
  };

  let groupResults =
    localStorage.getItem('groupResults') === null ? true : localStorage.getItem('groupResults') === 'true';
  $: localStorage.setItem('groupResults', groupResults ? 'true' : 'false');

  type CombinedResult = {
    id: string;
    rawStat: string;
    stat: string;
    passives: number[];
  };

  export const colorKeys = {
    physical: '#c79d93',
    cast: '#b3f8fe',
    fire: '#ff9a77',
    cold: '#93d8ff',
    lightning: '#f8cb76',
    attack: '#da814d',
    life: '#c96e6e',
    chaos: '#d8a7d3',
    unique: '#af6025',
    critical: '#b2a7d6'
  };

  const colorMessage = (message: string): string => {
    Object.keys(colorKeys).forEach((key) => {
      const value = colorKeys[key];
      message = message.replace(
        new RegExp(`(${key}(?:$|\\s))|((?:^|\\s)${key})`, 'gi'),
        `<span style='color: ${value}; font-weight: bold'>$1$2</span>`
      );
    });

    return message;
  };

  const combineResults = (
    rawResults: { result: data.AlternatePassiveSkillInformation; node: number }[],
    withColors: boolean,
    only: 'notables' | 'passives' | 'all'
  ): CombinedResult[] => {
    const mappedStats: { [key: number]: number[] } = {};
    rawResults.forEach((r) => {
      if (skillTree.nodes[r.node].isKeystone) {
        return;
      }

      if (only !== 'all') {
        if (only === 'notables' && !skillTree.nodes[r.node].isNotable) {
          return;
        }

        if (only === 'passives' && skillTree.nodes[r.node].isNotable) {
          return;
        }
      }

      if (r.result.AlternatePassiveSkill && r.result.AlternatePassiveSkill.StatsKeys) {
        r.result.AlternatePassiveSkill.StatsKeys.forEach((key) => {
          mappedStats[key] = [...(mappedStats[key] || []), r.node];
        });
      }

      if (r.result.AlternatePassiveAdditionInformations) {
        r.result.AlternatePassiveAdditionInformations.forEach((info) => {
          if (info.AlternatePassiveAddition.StatsKeys) {
            info.AlternatePassiveAddition.StatsKeys.forEach((key) => {
              mappedStats[key] = [...(mappedStats[key] || []), r.node];
            });
          }
        });
      }
    });

    return Object.keys(mappedStats).map((statID) => {
      const translated = translateStat(parseInt(statID));
      return {
        stat: withColors ? colorMessage(translated) : translated,
        rawStat: translated,
        id: statID,
        passives: mappedStats[statID]
      };
    });
  };

  const sortCombined = (
    combinedResults: CombinedResult[],
    order: 'count' | 'alphabet' | 'rarity' | 'value'
  ): CombinedResult[] => {
    switch (order) {
      case 'alphabet':
        return combinedResults.sort((a, b) =>
          a.rawStat
            .replace(/[#+%]/gi, '')
            .trim()
            .toLowerCase()
            .localeCompare(b.rawStat.replace(/[#+%]/gi, '').trim().toLowerCase())
        );
      case 'count':
        return combinedResults.sort((a, b) => b.passives.length - a.passives.length);
      case 'rarity':
        return combinedResults.sort(
          (a, b) => allPossibleStats[selectedJewel.value][a.id] - allPossibleStats[selectedJewel.value][b.id]
        );
      case 'value':
        return combinedResults.sort((a, b) => {
          const aValue = statValues[a.id] || 0;
          const bValue = statValues[b.id] || 0;
          if (aValue != bValue) {
            return bValue - aValue;
          }
          return allPossibleStats[selectedJewel.value][a.id] - allPossibleStats[selectedJewel.value][b.id];
        });
    }

    return combinedResults;
  };

  const sortResults = [
    {
      label: 'Count',
      value: 'count'
    },
    {
      label: 'Alphabetical',
      value: 'alphabet'
    },
    {
      label: 'Rarity',
      value: 'rarity'
    },
    {
      label: 'Value',
      value: 'value'
    }
  ] as const;

  let sortOrder = sortResults.find((r) => r.value === (localStorage.getItem('sortOrder') || 'count'));
  $: localStorage.setItem('sortOrder', sortOrder.value);

  let colored = localStorage.getItem('colored') === null ? true : localStorage.getItem('colored') === 'true';
  $: localStorage.setItem('colored', colored ? 'true' : 'false');

  let split = localStorage.getItem('split') === null ? true : localStorage.getItem('split') === 'true';
  $: localStorage.setItem('split', split ? 'true' : 'false');

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

  let collapsed = false;

  const platforms = [
  {
    value: 'PC',
    label: 'PC'
  }, {
    value: 'Xbox',
    label: 'Xbox'
  }, {
    value: 'Playstation',
    label: 'Playstation'
  }
  ];

  let platform = platforms.find((p) => p.value === localStorage.getItem('platform')) || platforms[0];
  $: localStorage.setItem('platform', platform.value);

  let leagues: { value: string; label: string }[] = [];
  let league: { value: string; label: string } | undefined;
  const getLeagues = async () => {
    const response = await fetch('https://api.poe.watch/leagues');
    const responseJson = await response.json();
    
    // Sort leagues by start date descending so the newest leagues are first
    const sortedLeagues = responseJson.sort((a: any, b: any) => new Date(b.start_date).getTime() - new Date(a.start_date).getTime());
    
    leagues = sortedLeagues.map((l: { name: string }) => ({ value: l.name, label: l.name }));
    
    // The main active challenge league is the newest one that isn't HC, SSF, or Ruthless
    let defaultLeague = leagues.find((l) => !l.value.includes('Ruthless') && !l.value.includes('Self-Found') && !l.value.includes('Hardcore') && !l.value.includes('Standard')) 
                        || leagues.find(l => l.value === 'Standard') 
                        || leagues[0];
                        
    league = leagues.find((l) => l.value === localStorage.getItem('league')) || defaultLeague;
  };

  $: league && localStorage.setItem('league', league.value);

  let skillTreeComponent: SkillTree;

  onMount(() => {  
    getLeagues();
  });
  import { fetchMarketJewels, pruneStaleMarketJewels, openLiveSearch } from '$lib/trade_api';
  import { getCachedJewels, getCacheTime, setCachedJewels, clearCachedJewels } from '$lib/market_cache';
  import type { MarketJewel } from '$lib/market_cache';

  // Market state
  let poeSessId = '';
  let showSessionHelp = false;
  let showMarketSettings = false;
  let showMarketPanel = localStorage.getItem('showMarketPanel') !== 'false';
  $: localStorage.setItem('showMarketPanel', showMarketPanel ? 'true' : 'false');
  let fetchingMarket = false;
  let marketProgress = '';
  let cachedJewels: MarketJewel[] = [];
  let cacheTime: Date | null = null;
  let marketConquerorFilter = 'All';
  let marketSort: 'price' | 'seed' | 'date' = 'price';

  // Live feed state
  let liveFeeds: Array<() => void> = [];
  let liveFeedAllActive = false;
  let liveFeedSocketActive = false;
  let liveAccumulator: MassSearchResults = { resultsBySocket: {} };
  let liveFeedStatus = '';

  const CURRENCY_TIER: Record<string, number> = { divine: 1000, div: 1000, exalted: 100, ex: 100, chaos: 1 };
  const parsePrice = (price: string): number => {
    const parts = price.trim().split(' ');
    const amount = parseFloat(parts[0]) || 0;
    const currency = parts.slice(1).join(' ').toLowerCase().replace('orb of ', '').trim();
    return amount * (CURRENCY_TIER[currency] ?? 0.01);
  };
  const comparePrices = (a: MarketJewel, b: MarketJewel) => parsePrice(a.price) - parsePrice(b.price);

  $: filteredMarketJewels = cachedJewels
    .filter(j => marketConquerorFilter === 'All' || j.worshipper.toLowerCase() === marketConquerorFilter.toLowerCase())
    .sort((a, b) =>
      marketSort === 'seed' ? a.seed - b.seed :
      marketSort === 'date' ? new Date(b.listedAt).getTime() - new Date(a.listedAt).getTime() :
      comparePrices(a, b)
    );
  
  onMount(() => {
    poeSessId = localStorage.getItem('poesessid') || '';
  });

  $: if (poeSessId) localStorage.setItem('poesessid', poeSessId);

  $: if (selectedJewel && league) {
     cachedJewels = getCachedJewels(selectedJewel.value, league.value);
     cacheTime = getCacheTime(selectedJewel.value, league.value);
  }

    const syncMarket = async () => {
    if (!selectedJewel) return;
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
            if (j.id) jewelMap.set(j.id, j);
            else jewelMap.set(`${j.seed}_${j.worshipper}`, j);
          }
          for (const j of chunk) {
            if (j.id) jewelMap.set(j.id, j);
            else jewelMap.set(`${j.seed}_${j.worshipper}`, j);
          }
          const merged = Array.from(jewelMap.values());
          setCachedJewels(selectedJewel.value, league?.value || 'Standard', merged);
          cachedJewels = merged;
        },
        lastSyncStr
      );
      cacheTime = getCacheTime(selectedJewel.value, league?.value || 'Standard');
    } catch (e: any) {
      alert(e.message || 'Failed to sync');
    } finally {
      fetchingMarket = false;
      marketProgress = '';
    }
  };

  const clearMarketCache = () => {
    if (!selectedJewel) return;
    if (!confirm(`Clear all cached market data for ${selectedJewel.label} (${league?.value || 'Standard'})?`)) return;
    clearCachedJewels(selectedJewel.value, league?.value || 'Standard');
    cachedJewels = [];
    cacheTime = null;
  };

  const pruneMarketCache = async () => {
    if (!selectedJewel || cachedJewels.length === 0) return;
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
    } catch (e: any) {
      alert(e.message || 'Failed to prune cache');
    } finally {
      fetchingMarket = false;
      marketProgress = '';
    }
  };

  const buildSocketToNodes = (): { [key: number]: number[] } => {
    const allSockets = Object.keys(skillTree.nodes)
      .map(k => parseInt(k))
      .filter(k => skillTree.nodes[k]?.isJewelSocket);
    const map: { [key: number]: number[] } = {};
    allSockets.forEach(socketId => {
      const affected = getAffectedNodes(skillTree.nodes[socketId]).filter(n => n && !n.isJewelSocket && !n.isMastery);
      map[socketId] = affected.map(n => data.TreeToPassive[n.skill]).filter(Boolean).map(n => n.Index);
    });
    return map;
  };

  const stopLiveFeed = () => {
    liveFeeds.forEach(fn => fn());
    liveFeeds = [];
    liveFeedAllActive = false;
    liveFeedSocketActive = false;
    liveFeedStatus = 'Live feed stopped.';
  };

  const startLiveFeed = async (allSockets: boolean) => {
    if (!selectedJewel || !selectedConqueror || Object.keys(selectedStats).length === 0) return;
    if (!allSockets && !circledNode) return;

    if (allSockets) liveFeedAllActive = true;
    else liveFeedSocketActive = true;

    liveAccumulator = { resultsBySocket: {} };
    massSearchResults = undefined;
    searchResults = undefined;
    results = true;

    const socketToNodes = allSockets
      ? buildSocketToNodes()
      : { [circledNode]: affectedNodes
          .filter(n => !disabled.has(n.skill))
          .map(n => data.TreeToPassive[n.skill])
          .filter(Boolean)
          .map(n => n.Index) };

    const handleNewJewels = async (jewels: MarketJewel[]) => {
      const jewelMap = new Map(cachedJewels.filter(j => j.id).map(j => [j.id, j]));
      for (const j of jewels) { if (j.id) jewelMap.set(j.id, j); }
      cachedJewels = [...jewelMap.values(), ...cachedJewels.filter(j => !j.id)];
      setCachedJewels(selectedJewel.value, league?.value || 'Standard', cachedJewels);

      const partial = await syncWrap.targetedMassSearch(
        {
          jewel: selectedJewel.value,
          seeds: jewels.map(j => j.seed),
          conquerors: jewels.map(j => j.worshipper),
          prices: jewels.map(j => j.price),
          listedAts: jewels.map(j => j.listedAt),
          socketToNodes,
          stats: Object.values(selectedStats).filter(s => s.weight > 0),
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
        (msg) => { liveFeedStatus = msg; }
      );
      liveFeeds = [cleanup];
    } catch (e: any) {
      alert(e.message || 'Failed to start live feed');
      liveFeedAllActive = false;
      liveFeedSocketActive = false;
    }
  };

  const marketSearchAllSockets = async () => {
    if (!selectedJewel) return;
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
      .map(k => parseInt(k))
      .filter(k => skillTree.nodes[k]?.isJewelSocket);
    const reqNodes: { [key: number]: number[] } = {};
    allSockets.forEach(socketId => {
      const affected = getAffectedNodes(skillTree.nodes[socketId]).filter(n => n && !n.isJewelSocket && !n.isMastery);
      reqNodes[socketId] = affected.map(n => data.TreeToPassive[n.skill]).filter(Boolean).map(n => n.Index);
    });
    activeSocketsCount = allSockets.length;

    const seeds = filteredMarketJewels.map(j => j.seed);
    const conquerors = filteredMarketJewels.map(j => j.worshipper);
    const prices = filteredMarketJewels.map(j => j.price);

    seedsProcessed = 0;

    const res = await syncWrap.targetedMassSearch(
      {
        jewel: selectedJewel.value,
        seeds,
        conquerors,
        prices,
        socketToNodes: reqNodes,
        stats: Object.values(selectedStats).filter((s) => s.weight > 0),
        minTotalWeight
      },
      proxy(async () => { seedsProcessed++; })
    );

    massSearchResults = res;
    searching = false;
    results = true;
  };

  let seedSearchInput: number = 0;

  const searchBySeed = async () => {
    if (!selectedJewel || !selectedConqueror || !seedSearchInput) return;

    searchJewel = selectedJewel.value;
    searchConqueror = selectedConqueror.value;
    searching = true;
    massSearchResults = undefined;
    searchResults = undefined;
    seedsProcessed = 0;

    const allSockets = Object.keys(skillTree.nodes)
      .map(k => parseInt(k))
      .filter(k => skillTree.nodes[k]?.isJewelSocket);
    const socketToNodes: { [key: number]: number[] } = {};
    allSockets.forEach(socketId => {
      const affected = getAffectedNodes(skillTree.nodes[socketId]).filter(n => n && !n.isJewelSocket && !n.isMastery);
      socketToNodes[socketId] = affected.map(n => data.TreeToPassive[n.skill]).filter(Boolean).map(n => n.Index);
    });
    activeSocketsCount = allSockets.length;

    const res = await syncWrap.targetedMassSearch(
      {
        jewel: selectedJewel.value,
        seeds: [seedSearchInput],
        conquerors: [selectedConqueror.value],
        socketToNodes,
        stats: Object.values(selectedStats).filter(s => s.weight > 0),
        minTotalWeight
      },
      proxy(async () => { seedsProcessed++; })
    );

    massSearchResults = res;
    searching = false;
    results = true;
  };

  const marketSearchCurrentSocket = async () => {
    if (!selectedJewel || !circledNode) return;
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
        .filter(n => !disabled.has(n.skill))
        .map(n => data.TreeToPassive[n.skill])
        .filter(Boolean)
        .map(n => n.Index)
    };

    const res = await syncWrap.targetedMassSearch(
      {
        jewel: selectedJewel.value,
        seeds: filteredMarketJewels.map(j => j.seed),
        conquerors: filteredMarketJewels.map(j => j.worshipper),
        prices: filteredMarketJewels.map(j => j.price),
        socketToNodes,
        stats: Object.values(selectedStats).filter(s => s.weight > 0),
        minTotalWeight
      },
      proxy(async () => { seedsProcessed++; })
    );

    massSearchResults = res;
    searching = false;
    results = true;
  };

</script>

<svelte:window on:paste={onPaste} />

<SkillTree
  bind:this={skillTreeComponent}
  {clickNode}
  {circledNode}
  selectedJewel={selectedJewel?.value}
  selectedConqueror={selectedConqueror?.value}
  {highlighted}
  {seed}
  highlightJewels={!circledNode}
  disabled={[...disabled]}>
  {#if !collapsed}
    <div
      class="w-screen md:w-10/12 lg:w-2/3 xl:w-1/2 2xl:w-5/12 3xl:w-1/3 4xl:w-1/4 min-w-[820px] absolute top-0 left-0 bg-black/80 backdrop-blur-sm themed rounded-br-lg max-h-screen">
      <div class="p-4 max-h-screen flex flex-col">
        <div class="flex flex-row justify-between mb-2">
          <div class="flex flex-row items-center">
            <button class="burger-menu mr-3" on:click={() => (collapsed = true)}>
              <div />
              <div />
              <div />
            </button>

            <h3 class="flex-grow">
              {#if results}
                <span>Results</span>
              {:else}
                <span>Timeless Jewel</span>
              {/if}
            </h3>
          </div>
          {#if searchResults || massSearchResults}
            <div class="flex flex-row gap-2">
              {#if results}
                <Select items={leagues} bind:value={league} on:change={updateUrl} clearable={false} />
                <Select items={platforms} bind:value={platform} on:change={updateUrl} clearable={false} />
                {#if searchResults}
                  <button
                    class="p-1 px-3 bg-blue-500/40 rounded disabled:bg-blue-900/40"
                    on:click={() => openTrade(searchJewel, searchConqueror, searchResults.raw, platform.value, league.value)}>
                    Trade
                  </button>
                  <button
                    class="p-1 px-3 bg-blue-500/40 rounded disabled:bg-blue-900/40"
                    class:grouped={groupResults}
                    on:click={() => (groupResults = !groupResults)}>
                    Grouped
                  </button>
                {/if}
              {/if}
              <button class="bg-neutral-100/20 px-4 p-1 rounded" on:click={() => (results = !results)}>
                {results ? 'Config' : 'Results'}
              </button>
            </div>
          {/if}
        </div>

        {#if !results}
          <Select items={jewels} bind:value={selectedJewel} on:change={changeJewel} />

          {#if selectedJewel}
            <!-- ── Market Panel ─────────────────────────────────────── -->
            <div class="mt-4 rounded ring-1 ring-gray-600 bg-gray-800/50">
              <button
                class="w-full flex flex-row justify-between items-center p-2 px-3 text-left"
                on:click={() => (showMarketPanel = !showMarketPanel)}>
                <span class="font-bold text-orange-400 text-sm">Market</span>
                <span class="text-xs text-gray-400">{showMarketPanel ? '▲' : '▼'} {cachedJewels.length} jewels{cacheTime ? ' · ' + cacheTime.toLocaleTimeString() : ''}</span>
              </button>

              {#if showMarketPanel}
                <div class="p-2 pt-0 flex flex-col space-y-2 text-sm">
                  <!-- Settings (collapsible) -->
                  <div class="border-t border-gray-700 pt-2">
                    <button class="text-xs text-gray-400 hover:text-white underline mb-2" on:click={() => (showMarketSettings = !showMarketSettings)}>
                      {showMarketSettings ? '▲' : '▼'} Settings
                    </button>
                    {#if showMarketSettings}
                      <div class="flex flex-col space-y-2 bg-gray-900 rounded p-2">
                        <Select items={leagues} bind:value={league} clearable={false} />
                        <label class="flex flex-col">
                          <span class="text-xs text-gray-400 mb-1">POESESSID (optional) <button type="button" class="ml-1 text-blue-400 hover:text-blue-300 underline" on:click={() => (showSessionHelp = !showSessionHelp)}>(?)</button></span>
                          <input type="password" autocomplete="new-password" bind:value={poeSessId} class="bg-gray-700 rounded p-1 text-white text-xs" placeholder="Enter session id..." />
                        </label>
                        {#if showSessionHelp}
                          <div class="bg-gray-800 border border-gray-600 p-2 rounded text-xs text-gray-300">
                            <p class="font-bold mb-1 text-white">How to get your POESESSID:</p>
                            <ol class="list-decimal list-inside space-y-1 ml-1">
                              <li>Go to <a href="https://www.pathofexile.com/trade" target="_blank" class="text-blue-400 hover:underline">pathofexile.com/trade</a> and log in.</li>
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
                            on:click={syncMarket} disabled={fetchingMarket}
                            title="Fetches newly listed items; full fetch if cache missing or older than 7 days">
                            {fetchingMarket ? 'Syncing...' : 'Sync'}
                          </button>
                          <button
                            class="p-1 w-full bg-yellow-700/60 rounded hover:bg-yellow-700 disabled:bg-gray-600 font-bold text-xs"
                            on:click={pruneMarketCache} disabled={fetchingMarket || cachedJewels.length === 0}
                            title="Remove sold/delisted listings from cache">
                            {fetchingMarket ? 'Pruning...' : 'Prune Sold'}
                          </button>
                        </div>
                        <button
                          class="text-xs text-red-400 hover:text-red-300 underline self-end disabled:text-gray-600"
                          on:click={clearMarketCache} disabled={fetchingMarket || cachedJewels.length === 0}>
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
                              on:click={() => {
                                seed = j.seed;
                                selectedConqueror = { value: j.worshipper, label: j.worshipper };
                                mode = 'seed';
                                updateUrl();
                              }}>
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

            <div class="mt-4">
              <h3 class="mb-2">Conqueror</h3>
              <Select items={conquerors} bind:value={selectedConqueror} on:change={updateUrl} />
            </div>

            {#if selectedConqueror && Object.keys(data.TimelessJewelConquerors[selectedJewel.value]).indexOf(selectedConqueror.value) >= 0}
              <div class="mt-4 w-full flex flex-row">
                <button class="selection-button" class:selected={mode === 'seed'} on:click={() => setMode('seed')}>
                  Enter Seed
                </button>
                <button class="selection-button" class:selected={mode === 'stats'} on:click={() => setMode('stats')}>
                  Select Stats
                </button>
              </div>

              {#if mode === 'seed'}
                <div class="mt-4">
                  <h3 class="mb-2">Seed</h3>
                  <input
                    type="number"
                    bind:value={seed}
                    on:blur={updateUrl}
                    min={data.TimelessJewelSeedRanges[selectedJewel.value].Min}
                    max={data.TimelessJewelSeedRanges[selectedJewel.value].Max} />
                  {#if seed < data.TimelessJewelSeedRanges[selectedJewel.value].Min || seed > data.TimelessJewelSeedRanges[selectedJewel.value].Max}
                    <div class="mt-2">
                      Seed must be between {data.TimelessJewelSeedRanges[selectedJewel.value].Min}
                      and {data.TimelessJewelSeedRanges[selectedJewel.value].Max}
                    </div>
                  {/if}
                </div>

                {#if seed >= data.TimelessJewelSeedRanges[selectedJewel.value].Min && seed <= data.TimelessJewelSeedRanges[selectedJewel.value].Max}
                  <div class="flex flex-row mt-4 items-end">
                    <div class="flex-grow">
                      <h3 class="mb-2">Sort Order</h3>
                      <Select items={sortResults} bind:value={sortOrder} />
                    </div>
                    <div class="ml-2">
                      <button
                        class="bg-neutral-500/20 p-2 px-4 rounded"
                        class:selected={colored}
                        on:click={() => (colored = !colored)}>
                        Colors
                      </button>
                    </div>
                    <div class="ml-2">
                      <button
                        class="bg-neutral-500/20 p-2 px-4 rounded"
                        class:selected={split}
                        on:click={() => (split = !split)}>
                        Split
                      </button>
                    </div>
                  </div>

                  {#if !split}
                    <ul class="mt-4 overflow-auto" class:rainbow={colored}>
                      {#each sortCombined(combineResults(seedResults, colored, 'all'), sortOrder.value) as r}
                        <li>
                          <div class="cursor-pointer" role="button" tabindex="0" on:keydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); highlight(seed, r.passives); } }} on:click={() => highlight(seed, r.passives)}>
                            <span class="font-bold" class:text-white={(statValues[r.id] || 0) < 3}
                              >({r.passives.length})</span>
                            <span class="text-white">{@html r.stat}</span>
                          </div>
                        </li>
                      {/each}
                    </ul>
                  {:else}
                    <div class="overflow-auto mt-4">
                      <h3>Notables</h3>
                      <ul class="mt-1" class:rainbow={colored}>
                        {#each sortCombined(combineResults(seedResults, colored, 'notables'), sortOrder.value) as r}
                          <li>
                            <div class="cursor-pointer" role="button" tabindex="0" on:keydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); highlight(seed, r.passives); } }} on:click={() => highlight(seed, r.passives)}>
                              <span class="font-bold" class:text-white={(statValues[r.id] || 0) < 3}
                                >({r.passives.length})</span>
                              <span class="text-white">{@html r.stat}</span>
                            </div>
                          </li>
                        {/each}
                      </ul>

                      <h3 class="mt-2">Smalls</h3>
                      <ul class="mt-1" class:rainbow={colored}>
                        {#each sortCombined(combineResults(seedResults, colored, 'passives'), sortOrder.value) as r}
                          <li>
                            <div class="cursor-pointer" role="button" tabindex="0" on:keydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); highlight(seed, r.passives); } }} on:click={() => highlight(seed, r.passives)}>
                              <span class="font-bold" class:text-white={(statValues[r.id] || 0) < 3}
                                >({r.passives.length})</span>
                              <span class="text-white">{@html r.stat}</span>
                            </div>
                          </li>
                        {/each}
                      </ul>
                    </div>
                  {/if}
                {/if}
              {:else if mode === 'stats'}
                <div class="mt-4">
                  <h3 class="mb-2">Add Stat</h3>
                  <Select items={statItems} on:change={selectStat} bind:this={statSelector} />
                </div>
                {#if Object.keys(selectedStats).length > 0}
                  <div class="mt-4 flex flex-col overflow-auto min-h-[100px]">
                    {#each Object.keys(selectedStats) as s}
                      <div class="mb-4 flex flex-row items-start flex-col border-neutral-100/40 border-b pb-4">
                        <div>
                          <button
                            class="p-2 px-4 bg-red-500/40 rounded mr-2"
                            on:click={() => removeStat(selectedStats[s].id)}>
                            -
                          </button>
                          <span>{translateStat(selectedStats[s].id)}</span>
                        </div>
                        <div class="mt-2 flex flex-row">
                          <div class="mr-4 flex flex-row items-center">
                            <div class="mr-2">Min:</div>
                            <input type="number" min="0" bind:value={selectedStats[s].min} />
                          </div>
                          <div class="flex flex-row items-center">
                            <div class="mr-2">Weight:</div>
                            <input type="number" min="0" bind:value={selectedStats[s].weight} />
                          </div>
                        </div>
                      </div>
                    {/each}
                  </div>
                  <div class="flex flex-col mt-2">
                    <div class="flex flex-row items-center">
                      <div class="mr-2 min-w-fit">Min Total Weight:</div>
                      <input type="number" min="0" bind:value={minTotalWeight} />
                    </div>
                  </div>
                  <div class="flex flex-col mt-4">
                    <div class="flex flex-row">
                      <button
                        class="p-2 px-2 bg-yellow-500/40 rounded disabled:bg-yellow-900/40 mr-2"
                        on:click={selectAll}
                        disabled={searching || disabled.size == 0}>
                        Select All
                      </button>
                      <button
                        class="p-2 px-2 bg-yellow-500/40 rounded disabled:bg-yellow-900/40 mr-2"
                        on:click={selectAllNotables}
                        disabled={searching || disabled.size == 0}>
                        Notables
                      </button>
                      <button
                        class="p-2 px-2 bg-yellow-500/40 rounded disabled:bg-yellow-900/40 mr-2"
                        on:click={selectAllPassives}
                        disabled={searching || disabled.size == 0}>
                        Passives
                      </button>
                      <button
                        class="p-2 px-2 bg-yellow-500/40 rounded disabled:bg-yellow-900/40 flex-grow"
                        on:click={deselectAll}
                        disabled={searching || disabled.size >= affectedNodes.length}>
                        Deselect
                      </button>
                    </div>
                    <div class="flex flex-row mt-2 space-x-2">
                      <button
                        class="p-2 px-3 bg-green-500/40 rounded disabled:bg-green-900/40 w-1/2"
                        on:click={() => search()}
                        disabled={searching || Object.keys(selectedStats).length === 0}>
                        {#if searching && !massSearchResults && searchResults === undefined}
                          {Math.min(seedsProcessed, totalSeeds())} / {totalSeeds()}
                        {:else}
                          Search
                        {/if}
                      </button>
                      <button
                        class="p-2 px-3 bg-blue-500/40 rounded disabled:bg-blue-900/40 w-1/2"
                        on:click={() => massSearch()}
                        disabled={searching || Object.keys(selectedStats).length === 0}>
                        {#if searching && !searchResults && massSearchResults === undefined}
                          {Math.min(seedsProcessed, totalSeeds())} / {totalSeeds()}
                        {:else}
                          Search All Sockets
                        {/if}
                      </button>
                    </div>
                    {#if cachedJewels.length > 0}
                      <div class="flex flex-row mt-2 space-x-2">
                        <button
                          class="p-2 px-3 bg-orange-500/40 rounded disabled:bg-orange-900/40 w-1/2"
                          on:click={marketSearchCurrentSocket}
                          disabled={searching || Object.keys(selectedStats).length === 0 || filteredMarketJewels.length === 0 || !circledNode}
                          title="Search market seeds against the currently selected jewel socket">
                          {#if searching && massSearchResults === undefined && searchResults === undefined}
                            {seedsProcessed} / {filteredMarketJewels.length}
                          {:else}
                            Market: This Socket
                          {/if}
                        </button>
                        <button
                          class="p-2 px-3 bg-orange-600/40 rounded disabled:bg-orange-900/40 w-1/2"
                          on:click={marketSearchAllSockets}
                          disabled={searching || Object.keys(selectedStats).length === 0 || filteredMarketJewels.length === 0}
                          title="Search market seeds against all jewel sockets">
                          {#if searching && massSearchResults === undefined && searchResults === undefined}
                            {seedsProcessed} / {filteredMarketJewels.length}
                          {:else}
                            Market: All Sockets
                          {/if}
                        </button>
                      </div>
                    {/if}
                    <div class="flex flex-row mt-2 space-x-2">
                      <button
                        class="p-2 px-3 w-1/2 rounded disabled:opacity-40"
                        class:bg-emerald-600={!liveFeedSocketActive}
                        class:bg-red-600={liveFeedSocketActive}
                        class:animate-pulse={liveFeedSocketActive}
                        on:click={() => liveFeedSocketActive ? stopLiveFeed() : startLiveFeed(false)}
                        disabled={searching || Object.keys(selectedStats).length === 0 || !selectedJewel || !circledNode}>
                        {liveFeedSocketActive ? '■ Stop Live' : 'Live Market: This Socket'}
                      </button>
                      <button
                        class="p-2 px-3 w-1/2 rounded disabled:opacity-40"
                        class:bg-emerald-600={!liveFeedAllActive}
                        class:bg-red-600={liveFeedAllActive}
                        class:animate-pulse={liveFeedAllActive}
                        on:click={() => liveFeedAllActive ? stopLiveFeed() : startLiveFeed(true)}
                        disabled={searching || Object.keys(selectedStats).length === 0 || !selectedJewel}>
                        {liveFeedAllActive ? '■ Stop Live' : 'Live Market: All Sockets'}
                      </button>
                    </div>
                    {#if liveFeedStatus}
                      <div class="text-xs text-gray-400 mt-1">{liveFeedStatus}</div>
                    {/if}
                    <div class="flex flex-row mt-2 space-x-2 items-center">
                      <input
                        type="number"
                        class="p-2 bg-gray-700 rounded text-white w-32 min-w-0"
                        placeholder="Seed"
                        min="0"
                        bind:value={seedSearchInput} />
                      <button
                        class="p-2 px-3 bg-purple-500/40 rounded disabled:bg-purple-900/40 flex-1"
                        on:click={searchBySeed}
                        disabled={searching || Object.keys(selectedStats).length === 0 || !seedSearchInput || !selectedConqueror}
                        title="Search this specific seed across all jewel sockets">
                        {#if searching && massSearchResults === undefined && searchResults === undefined}
                          Searching...
                        {:else}
                          Seed: All Sockets
                        {/if}
                      </button>
                    </div>
                  </div>
                {/if}
              {/if}

              {#if !circledNode}
                <h2 class="mt-4">Click on a jewel socket</h2>
              {/if}
            {/if}
          {/if}
        {/if}

        {#if searchResults && results}
          <SearchResults {searchResults} {groupResults} {highlight} jewel={searchJewel} conqueror={searchConqueror} platform={platform.value} league={league.value} />
        {/if}

        
        {#if massSearchResults && results}
          <div class="mt-4 flex flex-col overflow-auto">
            {#each Object.keys(massSearchResults.resultsBySocket).flatMap(s => Object.keys(massSearchResults.resultsBySocket[s].grouped)).filter((v, i, a) => a.indexOf(v) === i).sort((a, b) => parseInt(b) - parseInt(a)) as matchCount}
              <div class="mt-4">
                <h3 class="text-2xl font-bold mb-2 text-white">{matchCount} Matches</h3>
                {#each Object.keys(massSearchResults.resultsBySocket) as socketId}
                  {#if massSearchResults.resultsBySocket[socketId].grouped[matchCount] && massSearchResults.resultsBySocket[socketId].grouped[matchCount].length > 0}
                    <div class="mt-2 border-t pt-2 border-white/20">
                      <h4 class="text-xl font-bold text-orange-400 cursor-pointer mb-2" tabindex="0" role="button" on:keydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); circledNode = parseInt(socketId); skillTreeComponent.centerOnNode(parseInt(socketId)); updateUrl(); } }} on:click={() => { circledNode = parseInt(socketId); skillTreeComponent.centerOnNode(parseInt(socketId)); updateUrl(); }}>
                          {skillTree.nodes[parseInt(socketId)]?.name || 'Jewel Socket'} ({socketId})
                      </h4>
                      <SearchResults searchResults={{ grouped: { [matchCount]: massSearchResults.resultsBySocket[socketId].grouped[matchCount] }, raw: massSearchResults.resultsBySocket[socketId].grouped[matchCount] }} highlight={(seed, passives) => { circledNode = parseInt(socketId); highlight(seed, passives); skillTreeComponent.centerOnNode(parseInt(socketId)); }} groupResults={true} jewel={searchJewel} conqueror={searchConqueror} platform={platform.value} league={league.value} />
                    </div>
                  {/if}
                {/each}
              </div>
            {/each}
          </div>
        {/if}

      </div>
    </div>
  {:else}
    <button
      class="burger-menu absolute top-0 left-0 bg-black/80 backdrop-blur-sm rounded-br-lg p-4 pt-5"
      on:click={() => (collapsed = false)}>
      <div />
      <div />
      <div />
    </button>
  {/if}

  <div class="text-orange-500 absolute bottom-0 right-0 m-2">
    <a href="https://github.com/Vilsol/timeless-jewels" target="_blank" rel="noopener">Source (Github)</a>
  </div>
</SkillTree>

<style lang="postcss">
  .selection-button {
    @apply bg-neutral-500/20 p-2 px-4 flex-grow;
  }

  .selection-button:first-child {
    @apply rounded-l border-r-2 border-black;
  }

  .selection-button:last-child {
    @apply rounded-r;
  }

  .selected {
    @apply bg-neutral-100/20;
  }

  .grouped {
    @apply bg-pink-500/40 disabled:bg-pink-900/40;
  }

  .rainbow {
    animation: colorRotate 2s linear 0s infinite;
  }

  @keyframes colorRotate {
    from {
      color: hsl(0, 100%, 50%);
    }
    25% {
      color: hsl(90, 100%, 50%);
    }
    50% {
      color: hsl(180, 100%, 50%);
    }
    75% {
      color: hsl(270, 100%, 50%);
    }
    100% {
      color: hsl(359, 100%, 50%);
    }
  }
</style>
