<script lang="ts">
  import '../app.scss';
  import { browser } from '$app/environment';
  import { base } from '$app/paths';
  import { page } from '$app/stores';
  import { loadSkillTree, loadSkillTreePoe2 } from '../lib/skill_tree';
  import { syncWrap } from '../lib/worker';
  import { initializeCrystalline, initializeCrystallinePoe2 } from '../lib/types';

  const { children } = $props();

  // PoE1 and PoE2 are separate apps sharing UI. They populate the same data /
  // skill-tree singletons but from different sources, so only one boots per route.
  const isPoe2 = $derived($page.url.pathname.startsWith(`${base}/poe2`));

  let poe1Loading = $state(true);
  let poe1Booted = false;
  let poe2Loading = $state(true);
  let poe2Booted = false;

  // Boot the PoE1 engine lazily, only the first time we land on a PoE1 route.
  $effect(() => {
    if (!browser || isPoe2 || poe1Booted) {
      return;
    }
    poe1Booted = true;
    initializeCrystalline(base).then(() => {
      loadSkillTree();
      poe1Loading = false;
      syncWrap?.boot();
    });
  });

  // Boot the PoE2 engine (jewel data + adapted PoE2 tree) on a PoE2 route. No
  // worker pool — PoE2 search is served by the (future) DB layer, not the PRNG.
  $effect(() => {
    if (!browser || !isPoe2 || poe2Booted) {
      return;
    }
    poe2Booted = true;
    initializeCrystallinePoe2(base)
      .then(() => loadSkillTreePoe2(base))
      .then(() => {
        poe2Loading = false;
      });
  });
</script>

{#if (isPoe2 && poe2Loading) || (!isPoe2 && poe1Loading)}
  <div class="flex flex-row justify-center h-screen">
    <div class="flex flex-col">
      <div class="py-10 flex flex-col justify-between">
        <div>
          <h1 class="text-white mb-10 text-center">Timeless Calculator</h1>

          <h2 class="text-center">Loading...</h2>
        </div>
      </div>
    </div>
  </div>
{:else}
  {@render children?.()}
{/if}
