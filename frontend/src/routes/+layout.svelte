<script lang="ts">
  import '../app.scss';
  import { browser } from '$app/environment';
  import { loadSkillTree } from '../lib/skill_tree';
  import { syncWrap } from '../lib/worker';
  import { initializeCrystalline } from '../lib/types';

  const { children } = $props();
  let wasmLoading = $state(true);

  if (browser) {
    initializeCrystalline().then(() => {
      loadSkillTree();
      wasmLoading = false;
      syncWrap?.boot();
    });
  }
</script>

{#if wasmLoading}
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
