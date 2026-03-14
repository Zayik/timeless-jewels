  import { fetchMarketJewels } from '$lib/trade_api';
  import { getCachedJewels, getCacheTime, setCachedJewels } from '$lib/market_cache';
  import type { MarketJewel } from '$lib/market_cache';

  // Market state
  let poeSessId = '';
  let showMarketSettings = false;
  let fetchingMarket = false;
  let marketProgress = '';
  let cachedJewels: MarketJewel[] = [];
  let cacheTime: Date | null = null;
  
  onMount(() => {
    poeSessId = localStorage.getItem('poesessid') || '';
  });

  $: if (poeSessId) localStorage.setItem('poesessid', poeSessId);

  $: if (selectedJewel) {
     cachedJewels = getCachedJewels(selectedJewel.value);
     cacheTime = getCacheTime(selectedJewel.value);
  }

  const syncMarket = async () => {
    if (!selectedJewel) return;
    fetchingMarket = true;
    try {
      const jewels = await fetchMarketJewels(
         selectedJewel.value,
         league?.value || 'Standard',
         poeSessId,
         (msg) => marketProgress = msg
      );
      setCachedJewels(selectedJewel.value, jewels);
      cachedJewels = jewels;
      cacheTime = new Date();
    } catch(e: any) {
      alert(e.message || "Failed to sync");
    } finally {
      fetchingMarket = false;
      marketProgress = '';
    }
  };

  const marketSearchAllSockets = async () => {
    if (!selectedJewel) return;
    if (cachedJewels.length === 0) {
      alert("No jewels in market cache for this type.");
      return;
    }

    searching = true;
    massSearchResults = undefined;

    const reqNodes: { [key: number]: number[] } = {};
    const jewelSockets = [
      61834, 33989, 41263, 60735, 61419, 31683, 34483, 54127, 32763, 17181, 6230,
      13170, 7960, 26196, 33631, 26725, 46882, 36634, 55058, 28475, 48768, 6910
    ];

    jewelSockets.forEach((s) => {
      reqNodes[s] = (affectedNodes as number[]).filter(n => Math.sqrt(Math.pow((skillTree.nodes[n].x || 0) - (skillTree.nodes[s].x || 0), 2) + Math.pow((skillTree.nodes[n].y || 0) - (skillTree.nodes[s].y || 0), 2)) <= 1800);
    });

    const seeds = cachedJewels.map(j => j.seed);
    const conquerors = cachedJewels.map(j => j.worshipper);
    
    seedsProcessed = 0;
    
    const res = await syncWrap.targetedMassSearch(
      {
        jewel: selectedJewel.value,
        seeds,
        conquerors,
        socketToNodes: reqNodes,
        stats: Object.values(selectedStats).filter((s) => s.weight > 0),
        minTotalWeight
      },
      comlink.proxy(async (s: number) => {
        seedsProcessed++;
      })
    );

    massSearchResults = res;
    searching = false;
  };
