<script lang="ts">
  import { SvelteSet } from 'svelte/reactivity';
  import { skillTree } from '../skill_tree';
  import {
    CATEGORIES,
    CATEGORY_GROUPS,
    OILS,
    OIL_BY_ID,
    GROWN_DRAWS,
    loadPutridNotables,
    notableIconLookup,
    poolFor,
    rankCombos,
    recipeCost,
    sortRanks
  } from '../putrid_seed';
  import type { ComboRank, PutridNotable, RankSort } from '../putrid_seed';

  const SELECTED_KEY = 'putridSeedWishlist';
  const TAB_KEY = 'putridSeedTab';
  const RESULT_ROWS = 30;
  const MATRIX_COLUMNS = 8;

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
  const iconOf = notableIconLookup(skillTree.sprites?.notableActive);
  const categoryCount = new Map(
    CATEGORIES.map((c) => [c.name, notables.filter((n) => n.categories.includes(c.name)).length])
  );

  type Tab = 'browse' | 'oils' | 'pool';
  const storedTab = safeGet(TAB_KEY);
  let tab = $state<Tab>(storedTab === 'oils' || storedTab === 'pool' ? storedTab : 'browse');
  $effect(() => safeSet(TAB_KEY, tab));

  let allowRepeats = $state(false);

  // ---- Selection (shared by every tab) ----

  const loadSelected = (): string[] => {
    try {
      const raw = JSON.parse(safeGet(SELECTED_KEY) ?? '[]');
      return Array.isArray(raw) ? raw.filter((n) => byName.has(n)) : [];
    } catch {
      return [];
    }
  };
  // SvelteSet tracks each key, so toggling one card only re-renders that card.
  const selected = new SvelteSet<string>(loadSelected());
  $effect(() => safeSet(SELECTED_KEY, JSON.stringify([...selected])));

  const setMany = (names: string[], on: boolean) => {
    names.forEach((n) => (on ? selected.add(n) : selected.delete(n)));
  };
  const toggleNotable = (name: string) => setMany([name], !selected.has(name));

  const matches = (n: PutridNotable, q: string) => q.split(/\s+/).every((w) => n.searchText.includes(w));

  // ---- Browse ----

  let search = $state('');
  const filterCats = new SvelteSet<string>();
  let matchAll = $state(false);
  let selectedOnly = $state(false);

  const toggleFilter = (name: string) => {
    if (filterCats.has(name)) {
      filterCats.delete(name);
    } else {
      filterCats.add(name);
    }
  };

  const query = $derived(search.trim().toLowerCase());
  const shown = $derived(
    notables.filter((n) => {
      if (selectedOnly && !selected.has(n.name)) {
        return false;
      }
      if (filterCats.size > 0) {
        const hit = matchAll
          ? [...filterCats].every((c) => n.categories.includes(c))
          : n.categories.some((c) => filterCats.has(c));
        if (!hit) {
          return false;
        }
      }
      return !query || matches(n, query);
    })
  );
  const shownSelected = $derived(shown.filter((n) => selected.has(n.name)).length);

  // ---- Best oils ----

  let rankBy = $state<RankSort>('count');
  let expanded = $state<string | null>(null);

  const ranks = $derived(selected.size === 0 ? [] : sortRanks(rankCombos(notables, selected, allowRepeats), rankBy));
  const topRanks = $derived(ranks.slice(0, RESULT_ROWS));
  const matrixRanks = $derived(ranks.slice(0, MATRIX_COLUMNS));
  const selectedNotables = $derived(
    [...selected]
      .map((n) => byName.get(n))
      .filter((n): n is PutridNotable => !!n)
      .sort((a, b) => a.name.localeCompare(b.name))
  );
  const comboKey = (r: ComboRank) => r.oils.join('+');
  const pct = (x: number) => `${Math.round(x * 100)}%`;

  // ---- Oil pool ----

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
  const poolQuery = $derived(poolSearch.trim().toLowerCase());
  const shownPool = $derived(poolQuery ? pool.filter((n) => matches(n, poolQuery)) : pool);

  const viewPool = (oils: string[]) => {
    chosenOils = [...oils];
    poolSearch = '';
    tab = 'pool';
  };

  const ICON_SIZE = 44;

  // Every icon shares one sprite sheet. Setting its URL once as a CSS variable keeps it out
  // of each card's inline style (the sheet can be a large data URI).
  const firstIcon = notables.map((n) => iconOf(n.icon)).find(Boolean);
  const spriteUrl = firstIcon ? `url('${firstIcon.url}')` : 'none';

  // Render cards in pages as the list scrolls, so a filter change builds ~60 cards, not 472.
  const PAGE = 60;
  let browseLimit = $state(PAGE);
  $effect(() => {
    void shown;
    browseLimit = PAGE;
  });
  const loadMore = (node: HTMLElement) => {
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          browseLimit += PAGE;
        }
      },
      { rootMargin: '600px' }
    );
    io.observe(node);
    return { destroy: () => io.disconnect() };
  };
</script>

{#snippet oilDot(id: string)}
  <span
    class="inline-block w-2.5 h-2.5 rounded-full shrink-0"
    style="background: {OIL_BY_ID[id]?.color ?? '#888'}"
    title={OIL_BY_ID[id]?.name ?? id}></span>
{/snippet}

{#snippet oilChip(id: string, small = false)}
  {@const oil = OIL_BY_ID[id]}
  <span
    class="inline-flex items-center gap-1 rounded px-1.5 whitespace-nowrap bg-neutral-700/70"
    class:text-xs={small}
    class:text-sm={!small}>
    {@render oilDot(id)}
    {oil?.name ?? id}
  </span>
{/snippet}

{#snippet icon(n: PutridNotable, size: number)}
  {@const ic = iconOf(n.icon)}
  {#if ic}
    {@const s = size / ic.w}
    <span
      class="notable-icon shrink-0"
      style="width: {size}px; height: {size}px; background-position: -{ic.x * s}px -{ic.y *
        s}px; background-size: {ic.sheetW * s}px {ic.sheetH * s}px;"></span>
  {:else}
    <span class="notable-icon shrink-0 bg-neutral-700" style="width: {size}px; height: {size}px;"></span>
  {/if}
{/snippet}

{#snippet card(n: PutridNotable)}
  {@const on = selected.has(n.name)}
  <button
    class="card text-left flex flex-row gap-2 rounded p-2 border bg-neutral-800/70 hover:bg-neutral-700/60"
    class:border-orange-500={on}
    class:bg-orange-950={on}
    class:border-neutral-700={!on}
    aria-pressed={on}
    title={on ? 'Click to unselect' : 'Click to select'}
    onclick={() => toggleNotable(n.name)}>
    <span class="flex flex-col items-center gap-1">
      {@render icon(n, ICON_SIZE)}
      <span class="check" class:on>{on ? '✓' : ''}</span>
    </span>
    <span class="flex flex-col min-w-0 gap-0.5">
      <span class="flex flex-row flex-wrap items-center gap-x-2 gap-y-0.5">
        <span class="font-bold" class:text-orange-400={on}>{n.name}</span>
        <span class="flex flex-row items-center gap-0.5" title={n.recipe.map((o) => OIL_BY_ID[o]?.name).join(' + ')}>
          {#each n.recipe as o, i (i)}{@render oilDot(o)}{/each}
        </span>
        {#if n.blighted}
          <span class="text-xs text-lime-400" title="Anoint-only notable that is not on the normal passive tree">
            blight-only
          </span>
        {/if}
      </span>
      {#each n.stats as s, i (i)}
        <span class="text-sm text-neutral-200 leading-snug">{s}</span>
      {/each}
      {#if n.categories.length}
        <span class="text-xs text-neutral-500">{n.categories.join(' · ')}</span>
      {/if}
    </span>
  </button>
{/snippet}

<div class="flex flex-col gap-2 overflow-auto min-h-0 mt-2 pr-1" style:--putrid-sprite={spriteUrl}>
  <div class="text-xs text-amber-300/90 bg-amber-900/20 rounded p-2">
    A Putrid Seed grows up to {GROWN_DRAWS} notables, drawn from the notables whose anoint recipe uses only the oils you put
    in. That rule was seen in 50 test anoints with Clear, Sepia and Amber (all 10 of their notables grew, nothing else did)
    and is untested for other oils. Draws are weighted, not even: Clear x3 grew on about 3 in 4 seeds, and recipes with pricier
    oils grew less often. Duplicates merge, so some seeds grow fewer than {GROWN_DRAWS}.
  </div>

  <div class="flex flex-row flex-wrap items-center gap-2">
    {#each [['browse', 'Notables'], ['oils', `Best oils (${selected.size})`], ['pool', 'Oil pool']] as [key, label] (key)}
      <button
        class="px-3 py-1 rounded"
        class:bg-orange-700={tab === key}
        class:bg-neutral-700={tab !== key}
        onclick={() => (tab = key as Tab)}>
        {label}
      </button>
    {/each}
    <label
      class="flex flex-row items-center gap-1 text-sm text-neutral-300 ml-auto"
      title="Whether the game accepts the same oil twice in a Putrid Seed is untested">
      <input type="checkbox" class="!w-4 !h-4 !p-0" bind:checked={allowRepeats} onchange={onRepeatsChange} />
      Allow repeated oils (untested)
    </label>
  </div>

  {#if tab === 'browse'}
    <input type="text" placeholder="Search names and stats, e.g. totem, block, energy shield" bind:value={search} />

    <details open class="bg-neutral-800/60 rounded p-2 shrink-0">
      <summary class="cursor-pointer font-bold">
        Categories ({CATEGORIES.length}){filterCats.size ? `: ${filterCats.size} picked` : ''}
      </summary>
      <div class="flex flex-row flex-wrap items-center gap-2 text-xs text-neutral-400 my-1">
        <span>Pick categories to narrow the cards below. Show notables in</span>
        <button
          class="px-2 py-0.5 rounded"
          class:bg-orange-700={!matchAll}
          class:bg-neutral-700={matchAll}
          onclick={() => (matchAll = false)}>
          any picked category
        </button>
        <button
          class="px-2 py-0.5 rounded"
          class:bg-orange-700={matchAll}
          class:bg-neutral-700={!matchAll}
          onclick={() => (matchAll = true)}>
          all of them
        </button>
        {#if filterCats.size}
          <button class="underline" onclick={() => filterCats.clear()}>clear categories</button>
        {/if}
      </div>
      {#each CATEGORY_GROUPS as group (group)}
        <div class="flex flex-row flex-wrap items-center gap-1 my-1">
          <span class="text-xs text-neutral-500 w-16">{group}</span>
          {#each CATEGORIES.filter((c) => c.group === group) as c (c.name)}
            <button
              class="text-xs rounded px-2 py-0.5 border"
              class:bg-orange-700={filterCats.has(c.name)}
              class:border-orange-500={filterCats.has(c.name)}
              class:border-neutral-600={!filterCats.has(c.name)}
              aria-pressed={filterCats.has(c.name)}
              onclick={() => toggleFilter(c.name)}>
              {c.name} ({categoryCount.get(c.name) ?? 0})
            </button>
          {/each}
        </div>
      {/each}
      <div class="text-xs text-neutral-500">
        Categories come from keyword matching on the stat text, so a few edge cases land oddly.
      </div>
    </details>

    <div class="flex flex-row flex-wrap items-center gap-2 text-sm sticky top-0 z-10 bg-neutral-900/95 py-1">
      <span class="text-neutral-300">
        Showing {shown.length} of {notables.length} · <b class="text-orange-400">{selected.size} selected</b>
      </span>
      <button
        class="px-2 py-0.5 rounded bg-blue-500/40 disabled:opacity-40"
        disabled={shownSelected === shown.length}
        onclick={() =>
          setMany(
            shown.map((n) => n.name),
            true
          )}>
        Select all shown
      </button>
      <button
        class="px-2 py-0.5 rounded bg-neutral-700 disabled:opacity-40"
        disabled={shownSelected === 0}
        onclick={() =>
          setMany(
            shown.map((n) => n.name),
            false
          )}>
        Unselect shown
      </button>
      <label class="flex flex-row items-center gap-1">
        <input type="checkbox" class="!w-4 !h-4 !p-0" bind:checked={selectedOnly} />
        Selected only
      </label>
      {#if selected.size}
        <button class="ml-auto px-2 py-0.5 rounded bg-orange-700" onclick={() => (tab = 'oils')}>
          Find best oils →
        </button>
      {/if}
    </div>

    {#if shown.length === 0}
      <div class="text-neutral-400 text-sm">No notables match. Clear the search or pick other categories.</div>
    {:else}
      <div class="grid grid-cols-1 lg:grid-cols-2 gap-2">
        {#each shown.slice(0, browseLimit) as n (n.name)}
          {@render card(n)}
        {/each}
      </div>
      {#if browseLimit < shown.length}
        {#key browseLimit}
          <div use:loadMore class="text-xs text-neutral-500 py-2">
            Loading more ({shown.length - browseLimit} left)…
          </div>
        {/key}
      {/if}
    {/if}
  {:else if tab === 'oils'}
    {#if selected.size === 0}
      <div class="text-neutral-400 text-sm">
        Select notables on the Notables tab first, then this ranks the oil combinations that can grow them.
        <button class="underline text-blue-300" onclick={() => (tab = 'browse')}>Browse notables</button>
      </div>
    {:else}
      <div class="flex flex-row flex-wrap items-center gap-2 text-sm">
        <span class="text-neutral-300">{selected.size} selected. Rank by:</span>
        {#each [['count', 'Most selected notables'], ['share', 'Share of pool'], ['expected', 'Expected grows']] as [key, label] (key)}
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
        "Share" is selected notables / pool size: a big pool full of junk dilutes the odds. "Chance" and "Expected"
        assume every notable in the pool is equally likely across {GROWN_DRAWS} draws, which the real weighting is not; use
        them to compare combinations, not as real odds. Click a row to see its notables.
      </div>

      {#if ranks.length === 0}
        <div class="text-neutral-400">No oil combination reaches any selected notable.</div>
      {:else}
        <div class="overflow-x-auto shrink-0">
          <table class="w-full text-sm">
            <thead class="text-neutral-400 text-left">
              <tr>
                <th class="pr-2">Oils</th>
                <th class="pr-2 text-right" title="Selected notables in this pool">Hits</th>
                <th class="pr-2 text-right">Pool</th>
                <th class="pr-2 text-right">Share</th>
                <th class="pr-2 text-right" title="Chance at least one selected notable grows (even-odds estimate)">
                  Chance
                </th>
                <th class="pr-2 text-right" title="Expected selected notables grown (even-odds estimate)">Exp.</th>
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
                      <div class="text-xs text-neutral-400 my-1">
                        Your selected notables first, then the rest of this pool.
                        <button class="underline text-blue-300" onclick={() => viewPool(r.oils)}>Open this pool</button>
                      </div>
                      <div class="grid grid-cols-1 lg:grid-cols-2 gap-2">
                        {#each r.hits as n (n.name)}{@render card(n)}{/each}
                        {#each r.pool.filter((n) => !selected.has(n.name)) as n (n.name)}{@render card(n)}{/each}
                      </div>
                    </td>
                  </tr>
                {/if}
              {/each}
            </tbody>
          </table>
          {#if ranks.length > RESULT_ROWS}
            <div class="text-xs text-neutral-500">
              Top {RESULT_ROWS} of {ranks.length} combinations that reach your selection.
            </div>
          {/if}
        </div>

        <details class="bg-neutral-800/60 rounded p-2 shrink-0">
          <summary class="cursor-pointer font-bold">Which selected notables are in which combination</summary>
          <div class="overflow-x-auto">
            <table class="text-xs mt-1">
              <thead>
                <tr>
                  <th class="text-left pr-2">Notable (recipe)</th>
                  {#each matrixRanks as r, i (comboKey(r))}
                    <th class="px-1 align-bottom" title={r.oils.map((o) => OIL_BY_ID[o]?.name).join(' + ')}>
                      <div class="flex flex-col items-center gap-0.5">
                        <span class="text-neutral-400">#{i + 1}</span>
                        {#each r.oils as o (o)}{@render oilDot(o)}{/each}
                      </div>
                    </th>
                  {/each}
                </tr>
              </thead>
              <tbody>
                {#each selectedNotables as n (n.name)}
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
    {/if}
  {:else}
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
          : ''}. Cheapest recipes first. Click a card to select it.
      </div>
      <div class="grid grid-cols-1 lg:grid-cols-2 gap-2">
        {#each shownPool as n (n.name)}
          {@render card(n)}
        {/each}
      </div>
    {/if}
  {/if}
</div>

<style>
  .card {
    content-visibility: auto;
    contain-intrinsic-size: auto 150px;
  }
  .notable-icon {
    display: inline-block;
    background-image: var(--putrid-sprite);
    border-radius: 9999px;
    background-repeat: no-repeat;
    box-shadow:
      0 0 0 2px #8a6d3b,
      0 0 0 3px #1c1c1c;
  }
  .card[aria-pressed='true'] .notable-icon {
    box-shadow:
      0 0 0 2px #f97316,
      0 0 0 3px #1c1c1c;
  }
  .check {
    width: 18px;
    height: 18px;
    border-radius: 4px;
    border: 1px solid #525252;
    font-size: 12px;
    line-height: 16px;
    text-align: center;
  }
  .check.on {
    background: #c2410c;
    border-color: #f97316;
  }
</style>
