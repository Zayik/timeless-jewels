export interface MarketJewel {
  id?: string;
  seed: number;
  worshipper: string;
  price: string;
  listedAt: string;
}

const cacheKey = (jewelType: number, league: string) => `market_cache_${jewelType}_${league}`;
const cacheTimeKey = (jewelType: number, league: string) => `market_cache_time_${jewelType}_${league}`;

export const getCachedJewels = (jewelType: number, league: string): MarketJewel[] => {
  const data = localStorage.getItem(cacheKey(jewelType, league));
  if (data) {
    try {
      return JSON.parse(data);
    } catch (e) {
      console.error('Failed to parse market cache', e);
    }
  }
  return [];
};

export const setCachedJewels = (jewelType: number, league: string, jewels: MarketJewel[]) => {
  localStorage.setItem(cacheKey(jewelType, league), JSON.stringify(jewels));
  localStorage.setItem(cacheTimeKey(jewelType, league), new Date().toISOString());
};

export const getCacheTime = (jewelType: number, league: string): Date | null => {
  const time = localStorage.getItem(cacheTimeKey(jewelType, league));
  if (time) {
    return new Date(time);
  }
  return null;
};

export const clearCachedJewels = (jewelType: number, league: string) => {
  localStorage.removeItem(cacheKey(jewelType, league));
  localStorage.removeItem(cacheTimeKey(jewelType, league));
};
