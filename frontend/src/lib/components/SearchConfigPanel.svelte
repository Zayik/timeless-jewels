<script lang="ts">
  import Select from 'svelte-select';
  import type { Node } from '$lib/skill_tree_types';
  import { skillTree, translateStat } from '$lib/skill_tree';
  import type { StatConfig, SearchResults, MassSearchResults } from '$lib/skill_tree';
  import type { AlternatePassiveSkillInformation, AlternatePassiveAdditionInformation } from '$lib/calculator/types';
  import { statValues } from '$lib/values';
  import { data } from '$lib/types';
  import type { MarketJewel } from '$lib/market_cache';
  import { getSortOrder, setSortOrder, getColored, setColored, getSplit, setSplit } from '$lib/storageManager';

  type Props = {
    selectedJewel: { value: number; label: string };
    affectedNodes: Node[];
    circledNode: number | undefined;
    seedResults: { node: number; result: AlternatePassiveSkillInformation }[];
    allPossibleStats: { [key: string]: { [key: string]: number } };
    statItems: { label: string; value: number }[];
    searching: boolean;
    seedsProcessed: number;
    totalSeeds: () => number;
    cachedJewels: MarketJewel[];
    filteredMarketJewels: MarketJewel[];
    liveFeedAllActive: boolean;
    liveFeedSocketActive: boolean;
    liveFeedStatus: string;
    searchResults: SearchResults | undefined;
    massSearchResults: MassSearchResults | undefined;
    selectedConqueror?: { value: string; label: string };
    mode?: string;
    seed?: number;
    disabled?: Set<number>;
    selectedStats?: Record<number, StatConfig>;
    minTotalWeight?: number;
    seedSearchInput?: number;
    onSearch: () => void;
    onMassSearch: () => void;
    onMarketSearchCurrentSocket: () => void;
    onMarketSearchAllSockets: () => void;
    onSearchBySeed: () => void;
    onStartLiveFeed: (allSockets: boolean) => void;
    onStopLiveFeed: () => void;
    onSelectAll: () => void;
    onSelectAllNotables: () => void;
    onSelectAllPassives: () => void;
    onDeselectAll: () => void;
    onHighlight: (seed: number, passives: number[]) => void;
    onUpdateUrl: () => void;
  };

  let {
    selectedJewel,
    affectedNodes,
    circledNode,
    seedResults,
    allPossibleStats,
    statItems,
    searching,
    seedsProcessed,
    totalSeeds,
    cachedJewels,
    filteredMarketJewels,
    liveFeedAllActive,
    liveFeedSocketActive,
    liveFeedStatus,
    searchResults,
    massSearchResults,
    selectedConqueror = $bindable<{ value: string; label: string } | undefined>(),
    mode = $bindable(''),
    seed = $bindable(0),
    disabled = $bindable(new Set<number>()),
    selectedStats = $bindable({}),
    minTotalWeight = $bindable(0),
    seedSearchInput = $bindable(0),
    onSearch,
    onMassSearch,
    onMarketSearchCurrentSocket,
    onMarketSearchAllSockets,
    onSearchBySeed,
    onStartLiveFeed,
    onStopLiveFeed,
    onSelectAll,
    onSelectAllNotables,
    onSelectAllPassives,
    onDeselectAll,
    onHighlight,
    onUpdateUrl
  }: Props = $props();

  // Internal state
  const sortResults = [
    { label: 'Count', value: 'count' },
    { label: 'Alphabetical', value: 'alphabet' },
    { label: 'Rarity', value: 'rarity' },
    { label: 'Value', value: 'value' }
  ] as const;

  let sortOrder = $state(sortResults.find((r) => r.value === getSortOrder('count')));
  let colored = $state(getColored(true));
  let split = $state(getSplit(true));
  let statSelector = $state<Select>(undefined);

  $effect(() => {
    setSortOrder(sortOrder.value);
  });

  $effect(() => {
    setColored(colored);
  });

  $effect(() => {
    setSplit(split);
  });

  const validConqueror = $derived(
    selectedConqueror &&
      Object.keys(data.TimelessJewelConquerors[selectedJewel.value]).indexOf(selectedConqueror.value) >= 0
  );

  // Color keys and helpers
  const colorKeys = {
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
      const value = colorKeys[key as keyof typeof colorKeys];
      message = message.replace(
        new RegExp(`(${key}(?:$|\\s))|((?:^|\\s)${key})`, 'gi'),
        `<span style='color: ${value}; font-weight: bold'>$1$2</span>`
      );
    });
    return message;
  };

  type CombinedResult = {
    id: string;
    rawStat: string;
    stat: string;
    passives: number[];
  };

  const combineResults = (
    rawResults: { result: AlternatePassiveSkillInformation; node: number }[],
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
        r.result.AlternatePassiveSkill.StatsKeys.forEach((key: number) => {
          mappedStats[key] = [...(mappedStats[key] || []), r.node];
        });
      }

      if (r.result.AlternatePassiveAdditionInformations) {
        r.result.AlternatePassiveAdditionInformations.forEach((info: AlternatePassiveAdditionInformation) => {
          if (info.AlternatePassiveAddition.StatsKeys) {
            info.AlternatePassiveAddition.StatsKeys.forEach((key: number) => {
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
        passives: mappedStats[parseInt(statID)]
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

  const selectStat = (stat: CustomEvent) => {
    selectedStats[stat.detail.value] = {
      weight: 1,
      min: 0,
      id: stat.detail.value
    };
    selectedStats = selectedStats;
    statSelector.handleClear();
    onUpdateUrl();
  };

  const removeStat = (id: number) => {
    delete selectedStats[id];
    selectedStats = selectedStats;
    onUpdateUrl();
  };
</script>

{#if validConqueror}
  <div class="mt-4 w-full flex flex-row">
    <button
      class="selection-button"
      class:selected={mode === 'seed'}
      onclick={() => {
        mode = 'seed';
        onUpdateUrl();
      }}>
      Enter Seed
    </button>
    <button
      class="selection-button"
      class:selected={mode === 'stats'}
      onclick={() => {
        mode = 'stats';
        onUpdateUrl();
      }}>
      Select Stats
    </button>
  </div>

  {#if mode === 'seed'}
    <div class="mt-4">
      <h3 class="mb-2">Seed</h3>
      <input
        type="number"
        bind:value={seed}
        onblur={onUpdateUrl}
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
            onclick={() => (colored = !colored)}>
            Colors
          </button>
        </div>
        <div class="ml-2">
          <button class="bg-neutral-500/20 p-2 px-4 rounded" class:selected={split} onclick={() => (split = !split)}>
            Split
          </button>
        </div>
      </div>

      {#if !split}
        <ul class="mt-4 overflow-auto" class:rainbow={colored}>
          {#each sortCombined(combineResults(seedResults, colored, 'all'), sortOrder.value) as r}
            <li>
              <div
                class="cursor-pointer"
                role="button"
                tabindex="0"
                onkeydown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onHighlight(seed, r.passives);
                  }
                }}
                onclick={() => onHighlight(seed, r.passives)}>
                <span class="font-bold" class:text-white={(statValues[r.id] || 0) < 3}>({r.passives.length})</span>
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
                <div
                  class="cursor-pointer"
                  role="button"
                  tabindex="0"
                  onkeydown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      onHighlight(seed, r.passives);
                    }
                  }}
                  onclick={() => onHighlight(seed, r.passives)}>
                  <span class="font-bold" class:text-white={(statValues[r.id] || 0) < 3}>({r.passives.length})</span>
                  <span class="text-white">{@html r.stat}</span>
                </div>
              </li>
            {/each}
          </ul>

          <h3 class="mt-2">Smalls</h3>
          <ul class="mt-1" class:rainbow={colored}>
            {#each sortCombined(combineResults(seedResults, colored, 'passives'), sortOrder.value) as r}
              <li>
                <div
                  class="cursor-pointer"
                  role="button"
                  tabindex="0"
                  onkeydown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      onHighlight(seed, r.passives);
                    }
                  }}
                  onclick={() => onHighlight(seed, r.passives)}>
                  <span class="font-bold" class:text-white={(statValues[r.id] || 0) < 3}>({r.passives.length})</span>
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
                onclick={() => removeStat(selectedStats[parseInt(s)].id)}>
                -
              </button>
              <span>{translateStat(selectedStats[parseInt(s)].id)}</span>
            </div>
            <div class="mt-2 flex flex-row">
              <div class="mr-4 flex flex-row items-center">
                <div class="mr-2">Min:</div>
                <input type="number" min="0" bind:value={selectedStats[parseInt(s)].min} />
              </div>
              <div class="flex flex-row items-center">
                <div class="mr-2">Weight:</div>
                <input type="number" min="0" bind:value={selectedStats[parseInt(s)].weight} />
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
            onclick={onSelectAll}
            disabled={searching || disabled.size == 0}>
            Select All
          </button>
          <button
            class="p-2 px-2 bg-yellow-500/40 rounded disabled:bg-yellow-900/40 mr-2"
            onclick={onSelectAllNotables}
            disabled={searching || disabled.size == 0}>
            Notables
          </button>
          <button
            class="p-2 px-2 bg-yellow-500/40 rounded disabled:bg-yellow-900/40 mr-2"
            onclick={onSelectAllPassives}
            disabled={searching || disabled.size == 0}>
            Passives
          </button>
          <button
            class="p-2 px-2 bg-yellow-500/40 rounded disabled:bg-yellow-900/40 flex-grow"
            onclick={onDeselectAll}
            disabled={searching || disabled.size >= affectedNodes.length}>
            Deselect
          </button>
        </div>
        <div class="flex flex-row mt-2 space-x-2">
          <button
            class="p-2 px-3 bg-green-500/40 rounded disabled:bg-green-900/40 w-1/2"
            onclick={() => onSearch()}
            disabled={searching || Object.keys(selectedStats).length === 0}>
            {#if searching && !massSearchResults && searchResults === undefined}
              {Math.min(seedsProcessed, totalSeeds())} / {totalSeeds()}
            {:else}
              Search
            {/if}
          </button>
          <button
            class="p-2 px-3 bg-blue-500/40 rounded disabled:bg-blue-900/40 w-1/2"
            onclick={() => onMassSearch()}
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
              onclick={onMarketSearchCurrentSocket}
              disabled={searching ||
                Object.keys(selectedStats).length === 0 ||
                filteredMarketJewels.length === 0 ||
                !circledNode}
              title="Search market seeds against the currently selected jewel socket">
              {#if searching && massSearchResults === undefined && searchResults === undefined}
                {seedsProcessed} / {filteredMarketJewels.length}
              {:else}
                Market: This Socket
              {/if}
            </button>
            <button
              class="p-2 px-3 bg-orange-600/40 rounded disabled:bg-orange-900/40 w-1/2"
              onclick={onMarketSearchAllSockets}
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
            onclick={() => (liveFeedSocketActive ? onStopLiveFeed() : onStartLiveFeed(false))}
            disabled={searching || Object.keys(selectedStats).length === 0 || !selectedJewel || !circledNode}>
            {liveFeedSocketActive ? '■ Stop Live' : 'Live Market: This Socket'}
          </button>
          <button
            class="p-2 px-3 w-1/2 rounded disabled:opacity-40"
            class:bg-emerald-600={!liveFeedAllActive}
            class:bg-red-600={liveFeedAllActive}
            class:animate-pulse={liveFeedAllActive}
            onclick={() => (liveFeedAllActive ? onStopLiveFeed() : onStartLiveFeed(true))}
            disabled={searching || Object.keys(selectedStats).length === 0 || !selectedJewel}>
            {liveFeedAllActive ? '■ Stop Live' : 'Live Market: All Sockets'}
          </button>
        </div>
        {#if liveFeedStatus}
          <div
            class="text-xs mt-1"
            class:text-orange-400={liveFeedStatus === 'auth-required'}
            class:text-red-400={liveFeedStatus !== 'auth-required' &&
              (liveFeedStatus.toLowerCase().includes('error') || liveFeedStatus.toLowerCase().includes('failed'))}
            class:text-gray-400={liveFeedStatus !== 'auth-required' &&
              !liveFeedStatus.toLowerCase().includes('error') &&
              !liveFeedStatus.toLowerCase().includes('failed')}>
            {liveFeedStatus === 'auth-required'
              ? 'Enter your POESESSID in Market → Settings above to use the live feed.'
              : liveFeedStatus}
          </div>
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
            onclick={onSearchBySeed}
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
