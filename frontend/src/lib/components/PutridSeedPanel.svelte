<script lang="ts">
  import { skillTree } from '../skill_tree';
  import {
    CATEGORIES,
    CATEGORY_GROUPS,
    OILS,
    OIL_BY_ID,
    GROWN_DRAWS,
    loadPutridNotables,
    poolFor,
    rankCombos,
    recipeCost,
    sortRanks
  } from '../putrid_seed';
  import type { ComboRank, PutridNotable, RankSort } from '../putrid_seed';

  const WISHLIST_KEY = 'putridSeedWishlist';
  const TAB_KEY = 'putridSeedTab';
  const RESULT_ROWS = 30;
  const MATRIX_COLUMNS = 8;
  const SEARCH_ROWS = 60;

  const safeGet = (key: string): string | null => {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  };
  const safeSet = (key: string, value: string) => {
    try {
      localStorage.setItem(key, value);
    } catch {
      // storage can be unavailable (private mode); the page works without it
    }
  };

  const notables = loadPutridNotables(skillTree);
  const byName = new Map(notables.map((n) => [n.name, n]));
  const categoryMembers = new Map(
    CATEGORIES.map((c) => [c.name, notables.filter((n) => n.categories.includes(c.name)).map((n) => n.name)])
  );

  let tab = $state<'pool' | 'wishlist'>(safeGet(TAB_KEY) === 'wishlist' ? 'wishlist' : 'pool');
  $effect(() => safeSet(TAB_KEY, tab));

  let allowRepeats = $state(false);

  // ---- Oil pool mode ----

  let chosenOils = $state<string[]>([]);
  let poolSearch = $state('');

  const toggleOil = (id: string) => {
    const at = chosenOils.indexOf(id);
    if (!allowRepeats && at >= 0) {
      chosenOils = chosenOils.filter((o) => o !== id);
    } else if (chosenOils.length < 3) {
      chosenOils = [...chosenOils, id];
    }
  };
  const removeOilAt = (i: number) => (chosenOils = chosenOils.filter((_, j) => j !== i));

  // Turning repeats off drops the extra copies.
  const onRepeatsChange = () => {
    if (!allowRepeats) {
      chosenOils = [...new Set(chosenOils)];
    }
  };

  const pool = $derived(
    chosenOils.length === 0 ? [] : poolFor(notables, chosenOils).sort((a, b) => recipeCost(a) - recipeCost(b))
  );
  const matches = (n: PutridNotable, q: string) => q.split(/\s+/).every((w) => n.searchText.includes(w));
  const poolQuery = $derived(poolSearch.trim().toLowerCase());
  const shownPool = $derived(poolQuery ? pool.filter((n) => matches(n, poolQuery)) : pool);

  // ---- Wishlist mode ----

  const loadWishlist = (): string[] => {
    try {
      const raw = JSON.parse(safeGet(WISHLIST_KEY) ?? '[]');
      return Array.isArray(raw) ? raw.filter((n) => byName.has(n)) : [];
    } catch {
      return [];
    }
  };

  let wishlist = $state(new Set<string>(loadWishlist()));
  $effect(() => safeSet(WISHLIST_KEY, JSON.stringify([...wishlist])));

  let wishSearch = $state('');
  let rankBy = $state<RankSort>('count');
  let expanded = $state<string | null>(null);

  const wishQuery = $derived(wishSearch.trim().toLowerCase());
  const wishMatches = $derived(wishQuery ? notables.filter((n) => matches(n, wishQuery)) : []);

  const setMany = (names: string[], on: boolean) => {
    const next = new Set(wishlist);
    names.forEach((n) => (on ? next.add(n) : next.delete(n)));
    wishlist = next;
  };
  const toggleNotable = (name: string) => setMany([name], !wishlist.has(name));
  const categoryState = (name: string): 'all' | 'some' | 'none' => {
    const members = categoryMembers.get(name) ?? [];
    const have = members.filter((m) => wishlist.has(m)).length;
    return have === 0 ? 'none' : have === members.length ? 'all' : 'some';
  };
  const toggleCategory = (name: string) => setMany(categoryMembers.get(name) ?? [], categoryState(name) !== 'all');

  const ranks = $derived(wishlist.size === 0 ? [] : sortRanks(rankCombos(notables, wishlist, allowRepeats), rankBy));
  const topRanks = $derived(ranks.slice(0, RESULT_ROWS));
  const matrixRanks = $derived(ranks.slice(0, MATRIX_COLUMNS));
  const wishNotables = $derived(
    [...wishlist]
      .map((n) => byName.get(n))
      .filter((n): n is PutridNotable => !!n)
      .sort((a, b) => a.name.localeCompare(b.name))
  );
  const comboKey = (r: ComboRank) => r.oils.join('+');
  const pct = (x: number) => `${Math.round(x * 100)}%`;

  const viewPool = (oils: string[]) => {
    chosenOils = [...oils];
    poolSearch = '';
    tab = 'pool';
  };
</script>

{#snippet oilChip(id: string, small = false)}
  {@const oil = OIL_BY_ID[id]}
  <span
    class="inline-flex items-center gap-1 rounded px-1.5 whitespace-nowrap bg-neutral-700/70"
    class:text-xs={small}
    class:text-sm={!small}>
    <span class="inline-block w-2.5 h-2.5 rounded-full" style="background: {oil?.color ?? '#888'}"></span>
    {oil?.name ?? id}
  </span>
{/snippet}

{#snippet notableCard(n: PutridNotable, highlight = false)}
  <div class="border-l-2 pl-2 py-1" class:border-orange-500={highlight} class:border-neutral-600={!highlight}>
    <div class="flex flex-row flex-wrap items-center gap-1">
      <span class="font-bold" class:text-orange-400={highlight}>{n.name}</span>
      {#each n.recipe as o, i (i)}
        {@render oilChip(o, true)}
      {/each}
      {#if n.blighted}
        <span class="text-xs text-lime-400" title="Anoint-only notable that is not on the normal passive tree">
          blight-only
        </span>
      {/if}
    </div>
    {#each n.stats as s, i (i)}
      <div class="text-sm text-neutral-300">{s}</div>
    {/each}
    {#if n.categories.length}
      <div class="text-xs text-neutral-500">{n.categories.join(' · ')}</div>
    {/if}
  </div>
{/snippet}

<div class="flex flex-col gap-2 overflow-auto min-h-0 mt-2">
  <div class="text-xs text-amber-300/90 bg-amber-900/20 rounded p-2">
    A Putrid Seed grows up to {GROWN_DRAWS} notables, drawn from the notables whose anoint recipe uses only the oils you put
    in. That rule was seen in 50 test anoints with Clear, Sepia and Amber (all 10 of their notables grew, nothing else did)
    and is untested for other oils. Draws are weighted, not even: Clear x3 grew on about 3 in 4 seeds, and recipes with pricier
    oils grew less often. Duplicates merge, so some seeds grow fewer than {GROWN_DRAWS}.
  </div>

  <div class="flex flex-row flex-wrap items-center gap-2">
    <button
      class="px-3 py-1 rounded"
      class:bg-orange-700={tab === 'pool'}
      class:bg-neutral-700={tab !== 'pool'}
      onclick={() => (tab = 'pool')}>
      Oil pool
    </button>
    <button
      class="px-3 py-1 rounded"
      class:bg-orange-700={tab === 'wishlist'}
      class:bg-neutral-700={tab !== 'wishlist'}
      onclick={() => (tab = 'wishlist')}>
      Wishlist ({wishlist.size})
    </button>
    <label
      class="flex flex-row items-center gap-1 text-sm text-neutral-300 ml-auto"
      title="Whether the game accepts the same oil twice in a Putrid Seed is untested">
      <input type="checkbox" class="!w-4 !h-4 !p-0" bind:checked={allowRepeats} onchange={onRepeatsChange} />
      Allow repeated oils (untested)
    </label>
  </div>

  {#if tab === 'pool'}
    <div class="grid grid-cols-3 sm:grid-cols-5 md:grid-cols-7 gap-1">
      {#each OILS as oil (oil.id)}
        {@const count = chosenOils.filter((o) => o === oil.id).length}
        <button
          class="flex flex-row items-center gap-1 rounded px-2 py-1 text-sm border"
          class:border-orange-500={count > 0}
          class:bg-neutral-700={count > 0}
          class:border-neutral-700={count === 0}
          disabled={count === 0 && chosenOils.length >= 3}
          class:opacity-40={count === 0 && chosenOils.length >= 3}
          onclick={() => toggleOil(oil.id)}>
          <span class="inline-block w-3 h-3 rounded-full shrink-0" style="background: {oil.color}"></span>
          {oil.name}{count > 1 ? ` x${count}` : ''}
        </button>
      {/each}
    </div>

    <div class="flex flex-row flex-wrap items-center gap-2 text-sm">
      <span class="text-neutral-400">Oils:</span>
      {#each [0, 1, 2] as i (i)}
        {#if chosenOils[i]}
          <button title="Remove" onclick={() => removeOilAt(i)}>{@render oilChip(chosenOils[i])} ✕</button>
        {:else}
          <span class="px-2 rounded border border-dashed border-neutral-600 text-neutral-500">empty</span>
        {/if}
      {/each}
      {#if chosenOils.length}
        <button class="text-neutral-400 underline" onclick={() => (chosenOils = [])}>clear</button>
      {/if}
    </div>

    {#if chosenOils.length === 0}
      <div class="text-neutral-400 text-sm">Pick up to 3 oils to see which notables the seed can grow.</div>
    {:else}
      <input type="text" placeholder="Search notable names and stats" bind:value={poolSearch} />
      <div class="text-sm text-neutral-300">
        {pool.length} notable{pool.length === 1 ? '' : 's'} in this pool{poolQuery
          ? `, ${shownPool.length} match`
          : ''}. Cheapest recipes first.
      </div>
      <div class="flex flex-col gap-1">
        {#each shownPool as n (n.name)}
          {@render notableCard(n, wishlist.has(n.name))}
        {/each}
      </div>
    {/if}
  {:else}
    <details open class="bg-neutral-800/60 rounded p-2">
      <summary class="cursor-pointer font-bold">Categories ({CATEGORIES.length})</summary>
      <div class="text-xs text-neutral-400 my-1">
        Click a category to add all its notables to the wishlist; click again to remove them. Categories come from
        keyword matching on the stat text, so a few edge cases land oddly.
      </div>
      {#each CATEGORY_GROUPS as group (group)}
        <div class="flex flex-row flex-wrap items-center gap-1 my-1">
          <span class="text-xs text-neutral-500 w-16">{group}</span>
          {#each CATEGORIES.filter((c) => c.group === group) as c (c.name)}
            {@const st = categoryState(c.name)}
            <button
              class="text-xs rounded px-2 py-0.5 border"
              class:bg-orange-700={st === 'all'}
              class:border-orange-500={st !== 'none'}
              class:bg-orange-900={st === 'some'}
              class:border-neutral-600={st === 'none'}
              onclick={() => toggleCategory(c.name)}>
              {c.name} ({categoryMembers.get(c.name)?.length ?? 0})
            </button>
          {/each}
        </div>
      {/each}
    </details>

    <input
      type="text"
      placeholder="Find notables by name or stat, e.g. totem, block, energy shield"
      bind:value={wishSearch} />
    {#if wishQuery}
      <div class="flex flex-row flex-wrap items-center gap-2 text-sm">
        <span class="text-neutral-300">{wishMatches.length} match</span>
        <button
          class="px-2 py-0.5 rounded bg-blue-500/40 disabled:opacity-40"
          disabled={wishMatches.length === 0}
          onclick={() =>
            setMany(
              wishMatches.map((n) => n.name),
              true
            )}>
          Add all
        </button>
        <button
          class="px-2 py-0.5 rounded bg-neutral-700 disabled:opacity-40"
          disabled={wishMatches.length === 0}
          onclick={() =>
            setMany(
              wishMatches.map((n) => n.name),
              false
            )}>
          Remove all
        </button>
      </div>
      <div class="flex flex-col gap-1 max-h-72 overflow-auto shrink-0 bg-neutral-800/60 rounded p-1">
        {#each wishMatches.slice(0, SEARCH_ROWS) as n (n.name)}
          <label class="flex flex-row items-start gap-2 cursor-pointer hover:bg-neutral-700/50 rounded px-1">
            <input
              type="checkbox"
              class="!w-4 !h-4 !p-0 mt-1 shrink-0"
              checked={wishlist.has(n.name)}
              onchange={() => toggleNotable(n.name)} />
            <span>
              <span class="font-bold">{n.name}</span>
              <span class="text-sm text-neutral-400">{n.stats.join(' / ')}</span>
            </span>
          </label>
        {/each}
        {#if wishMatches.length > SEARCH_ROWS}
          <div class="text-xs text-neutral-500 px-1">
            Showing {SEARCH_ROWS} of {wishMatches.length}. "Add all" takes every match.
          </div>
        {/if}
      </div>
    {/if}

    {#if wishlist.size > 0}
      <div class="flex flex-row flex-wrap items-center gap-1 max-h-28 overflow-auto shrink-0">
        <span class="text-sm text-neutral-300">Wishlist ({wishlist.size}):</span>
        {#each wishNotables as n (n.name)}
          <button
            class="text-xs rounded px-2 py-0.5 bg-neutral-700 hover:bg-red-900"
            title={n.stats.join('\n')}
            onclick={() => toggleNotable(n.name)}>
            {n.name} ✕
          </button>
        {/each}
        <button class="text-xs text-neutral-400 underline ml-1" onclick={() => (wishlist = new Set())}
          >clear all</button>
      </div>

      <div class="flex flex-row flex-wrap items-center gap-2 text-sm">
        <span class="text-neutral-300">Rank by:</span>
        {#each [['count', 'Most wishlist notables'], ['share', 'Share of pool'], ['expected', 'Expected wishlist grows']] as [key, label] (key)}
          <button
            class="px-2 py-0.5 rounded"
            class:bg-orange-700={rankBy === key}
            class:bg-neutral-700={rankBy !== key}
            onclick={() => (rankBy = key as RankSort)}>
            {label}
          </button>
        {/each}
      </div>
      <div class="text-xs text-neutral-400">
        "Share" is wishlist notables / pool size: a big pool full of junk dilutes the odds. "Chance" and "Expected"
        assume every notable in the pool is equally likely across {GROWN_DRAWS} draws, which the real weighting is not; use
        them to compare combinations, not as real odds.
      </div>

      {#if ranks.length === 0}
        <div class="text-neutral-400">No oil combination reaches any wishlist notable.</div>
      {:else}
        <div class="overflow-x-auto shrink-0">
          <table class="w-full text-sm">
            <thead class="text-neutral-400 text-left">
              <tr>
                <th class="pr-2">Oils</th>
                <th class="pr-2 text-right" title="Wishlist notables in this pool">Wish</th>
                <th class="pr-2 text-right">Pool</th>
                <th class="pr-2 text-right">Share</th>
                <th class="pr-2 text-right" title="Chance at least one wishlist notable grows (even-odds estimate)">
                  Chance
                </th>
                <th class="pr-2 text-right" title="Expected wishlist notables grown (even-odds estimate)">Exp.</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {#each topRanks as r (comboKey(r))}
                {@const key = comboKey(r)}
                <tr
                  class="border-t border-neutral-700 cursor-pointer hover:bg-neutral-700/40"
                  onclick={() => (expanded = expanded === key ? null : key)}>
                  <td class="pr-2 py-1">
                    <div class="flex flex-row flex-wrap gap-1">
                      {#each r.oils as o (o)}{@render oilChip(o, true)}{/each}
                    </div>
                  </td>
                  <td class="pr-2 text-right font-bold">{r.hits.length}</td>
                  <td class="pr-2 text-right">{r.pool.length}</td>
                  <td class="pr-2 text-right">{pct(r.share)}</td>
                  <td class="pr-2 text-right">{pct(r.chanceAny)}</td>
                  <td class="pr-2 text-right">{r.expectedHits.toFixed(2)}</td>
                  <td class="text-neutral-500">{expanded === key ? '▴' : '▾'}</td>
                </tr>
                {#if expanded === key}
                  <tr>
                    <td colspan="7" class="pb-2">
                      <div class="text-xs text-neutral-400 mb-1">
                        Wishlist hits in orange, the rest of the pool below.
                        <button class="underline text-blue-300" onclick={() => viewPool(r.oils)}>Open this pool</button>
                      </div>
                      {#each r.hits as n (n.name)}
                        {@render notableCard(n, true)}
                      {/each}
                      {#each r.pool.filter((n) => !wishlist.has(n.name)) as n (n.name)}
                        {@render notableCard(n, false)}
                      {/each}
                    </td>
                  </tr>
                {/if}
              {/each}
            </tbody>
          </table>
          {#if ranks.length > RESULT_ROWS}
            <div class="text-xs text-neutral-500">
              Top {RESULT_ROWS} of {ranks.length} combinations that reach your list.
            </div>
          {/if}
        </div>

        <details class="bg-neutral-800/60 rounded p-2 shrink-0">
          <summary class="cursor-pointer font-bold">Which wishlist notables are in which combination</summary>
          <div class="overflow-x-auto">
            <table class="text-xs mt-1">
              <thead>
                <tr>
                  <th class="text-left pr-2">Notable (recipe)</th>
                  {#each matrixRanks as r, i (comboKey(r))}
                    <th class="px-1 align-bottom" title={r.oils.map((o) => OIL_BY_ID[o]?.name).join(' + ')}>
                      <div class="flex flex-col items-center gap-0.5">
                        <span class="text-neutral-400">#{i + 1}</span>
                        {#each r.oils as o (o)}
                          <span class="inline-block w-2.5 h-2.5 rounded-full" style="background: {OIL_BY_ID[o]?.color}"
                          ></span>
                        {/each}
                      </div>
                    </th>
                  {/each}
                </tr>
              </thead>
              <tbody>
                {#each wishNotables as n (n.name)}
                  <tr class="border-t border-neutral-700">
                    <td class="pr-2 whitespace-nowrap">
                      {n.name}
                      <span class="text-neutral-500">({n.recipe.map((o) => OIL_BY_ID[o]?.name).join(', ')})</span>
                    </td>
                    {#each matrixRanks as r (comboKey(r))}
                      <td class="text-center">
                        {#if r.hits.includes(n)}<span class="text-orange-400">●</span>{/if}
                      </td>
                    {/each}
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>
        </details>
      {/if}
    {:else}
      <div class="text-neutral-400 text-sm">
        Add notables by searching above or by picking categories, then see which oil combination reaches the most of
        them.
      </div>
    {/if}
  {/if}
</div>
