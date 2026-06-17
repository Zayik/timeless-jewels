<script lang="ts">
  import SearchResults from './SearchResults.svelte';
  import type { SearchResults as SearchResultsData, MassSearchResults } from '$lib/skill_tree';
  import { skillTree } from '$lib/skill_tree';

  type Props = {
    searchResults?: SearchResultsData;
    massSearchResults?: MassSearchResults;
    groupResults: boolean;
    jewel: number;
    conqueror: string;
    platform: string;
    league: string;
    onHighlight: (seed: number, passives: number[]) => void;
    onMassSelect: (socketId: number, seed: number, passives: number[]) => void;
    onSocketFocus: (socketId: number) => void;
  };

  let {
    searchResults,
    massSearchResults,
    groupResults,
    jewel,
    conqueror,
    platform,
    league,
    onHighlight,
    onMassSelect,
    onSocketFocus
  }: Props = $props();

  const socketName = (socketId: string) => skillTree?.nodes?.[parseInt(socketId)]?.name || 'Jewel Socket';

  // Distinct match counts across every socket, highest first.
  const massMatchCounts = $derived(
    massSearchResults
      ? [...new Set(Object.values(massSearchResults.resultsBySocket).flatMap((s) => Object.keys(s.grouped)))].sort(
          (a, b) => parseInt(b) - parseInt(a)
        )
      : []
  );

  const hasMassResults = $derived(
    !!massSearchResults && Object.values(massSearchResults.resultsBySocket).some((s) => s.raw.length > 0)
  );
</script>

{#if searchResults}
  <SearchResults {searchResults} {groupResults} highlight={onHighlight} {jewel} {conqueror} {platform} {league} />
{/if}

{#if massSearchResults}
  {#if !hasMassResults}
    <div class="mt-8 text-center text-lg text-neutral-300">No results found.</div>
  {:else}
    <div class="mt-4 flex flex-col overflow-auto">
      {#each massMatchCounts as matchCount}
        <section class="mt-4">
          <h3 class="mb-2 text-2xl font-bold text-white">
            {matchCount} <span class="text-lg font-normal text-neutral-400">Matches</span>
          </h3>
          {#each Object.keys(massSearchResults.resultsBySocket) as socketId}
            {#if massSearchResults.resultsBySocket[socketId].grouped[matchCount]?.length}
              <div class="mt-2 rounded-lg border border-white/10 bg-white/5 p-2">
                <button
                  type="button"
                  class="mb-2 text-left text-xl font-bold text-orange-400 hover:text-orange-300"
                  title="Center the tree on this jewel socket"
                  onclick={() => onSocketFocus(parseInt(socketId))}>
                  {socketName(socketId)} <span class="text-sm font-normal text-neutral-400">({socketId})</span>
                </button>
                <SearchResults
                  searchResults={{
                    grouped: { [matchCount]: massSearchResults.resultsBySocket[socketId].grouped[matchCount] },
                    raw: massSearchResults.resultsBySocket[socketId].grouped[matchCount]
                  }}
                  highlight={(seed, passives) => onMassSelect(parseInt(socketId), seed, passives)}
                  groupResults={true}
                  {jewel}
                  {conqueror}
                  {platform}
                  {league} />
              </div>
            {/if}
          {/each}
        </section>
      {/each}
    </div>
  {/if}
{/if}
