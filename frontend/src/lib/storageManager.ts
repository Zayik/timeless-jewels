export const KEYS = {
  LEAGUE: 'league',
  POE_SESS_ID: 'poesessid',
  SHOW_MARKET_PANEL: 'showMarketPanel',
  PLATFORM: 'platform',
  GROUP_RESULTS: 'groupResults',
  SORT_ORDER: 'sortOrder',
  COLORED: 'colored',
  SPLIT: 'split'
} as const;

// ── Generic helpers ────────────────────────────────────────────

export const getString = (key: string, defaultValue = ''): string => localStorage.getItem(key) ?? defaultValue;

export const setString = (key: string, value: string): void => localStorage.setItem(key, value);

/**
 * Returns the stored boolean value, or `defaultValue` when the key is absent.
 * Stored as the literal strings 'true' / 'false'.
 */
export const getBoolean = (key: string, defaultValue: boolean): boolean => {
  const raw = localStorage.getItem(key);
  if (raw === null) {
    return defaultValue;
  }
  return raw === 'true';
};

export const setBoolean = (key: string, value: boolean): void => localStorage.setItem(key, value ? 'true' : 'false');

// ── Named accessors ────────────────────────────────────────────

export const getLeague = (defaultValue = ''): string => getString(KEYS.LEAGUE, defaultValue);

export const setLeague = (value: string): void => setString(KEYS.LEAGUE, value);

export const getPoeSessionId = (defaultValue = ''): string => getString(KEYS.POE_SESS_ID, defaultValue);

export const setPoeSessionId = (value: string): void => setString(KEYS.POE_SESS_ID, value);

export const getShowMarketPanel = (defaultValue = true): boolean => getBoolean(KEYS.SHOW_MARKET_PANEL, defaultValue);

export const setShowMarketPanel = (value: boolean): void => setBoolean(KEYS.SHOW_MARKET_PANEL, value);

export const getPlatform = (defaultValue = ''): string => getString(KEYS.PLATFORM, defaultValue);

export const setPlatform = (value: string): void => setString(KEYS.PLATFORM, value);

export const getGroupResults = (defaultValue = true): boolean => getBoolean(KEYS.GROUP_RESULTS, defaultValue);

export const setGroupResults = (value: boolean): void => setBoolean(KEYS.GROUP_RESULTS, value);

export const getSortOrder = (defaultValue = ''): string => getString(KEYS.SORT_ORDER, defaultValue);

export const setSortOrder = (value: string): void => setString(KEYS.SORT_ORDER, value);

export const getColored = (defaultValue = true): boolean => getBoolean(KEYS.COLORED, defaultValue);

export const setColored = (value: boolean): void => setBoolean(KEYS.COLORED, value);

export const getSplit = (defaultValue = true): boolean => getBoolean(KEYS.SPLIT, defaultValue);

export const setSplit = (value: boolean): void => setBoolean(KEYS.SPLIT, value);
