<script lang="ts">
  // Note: svelte-tiny-virtual-list is not compatible with Svelte 5 (requires Svelte ^4.2.19).
  // Replaced with a simple scrollable {#each} container. Result sets are typically < 1000 items
  // so virtual scrolling is not critical for correctness.
  import type { SearchResults } from '../skill_tree';
  import SearchResult from './SearchResult.svelte';

  type Props = {
    searchResults: SearchResults;
    highlight: (newSeed: number, passives: number[]) => void;
    groupResults?: boolean;
    jewel: number;
    conqueror: string;
    platform: string;
    league: string;
    isLegacyTradersMode?: boolean;
  };

  const {
    searchResults,
    highlight,
    groupResults = true,
    jewel,
    conqueror,
    platform,
    league,
    isLegacyTradersMode = false
  }: Props = $props();

  let expandedGroup = $state<string | number>('');
</script>

{#if searchResults.raw.length === 0}
  <div class="mt-8 text-center text-lg text-neutral-300">No results found.</div>
{:else if groupResults}
  <div class="flex flex-col overflow-auto">
    {#each Object.keys(searchResults.grouped)
      .map((x) => parseInt(x))
      .sort((a, b) => a - b)
      .reverse() as k}
      <button
        class="text-lg w-full p-2 px-4 bg-neutral-500/30 rounded flex flex-row justify-between mb-2"
        onclick={() => (expandedGroup = expandedGroup === k ? '' : k)}>
        <span>
          {k} Match{k > 1 ? 'es' : ''} [{searchResults.grouped[k].length}]
        </span>
        <span>
          {expandedGroup === k ? '^' : 'V'}
        </span>
      </button>

      {#if expandedGroup === k}
        <div class="flex flex-col overflow-auto max-h-[600px] min-h-[200px] mb-2">
          {#each searchResults.grouped[k] as item}
            <SearchResult set={item} {highlight} {jewel} {conqueror} {platform} {league} {isLegacyTradersMode} />
          {/each}
        </div>
      {/if}
    {/each}
  </div>
{:else}
  <div class="mt-4 flex flex-col overflow-auto max-h-[600px]">
    {#each searchResults.raw as item}
      <SearchResult set={item} {highlight} {jewel} {conqueror} {platform} {league} {isLegacyTradersMode} />
    {/each}
  </div>
{/if}
