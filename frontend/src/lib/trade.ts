export interface SeedRef {
  seed: number;
}

export const tradeStatNames: { [key: number]: { [key: string]: string } } = {
  1: {
    Ahuana: 'explicit.pseudo_timeless_jewel_ahuana',
    Xibaqua: 'explicit.pseudo_timeless_jewel_xibaqua',
    Doryani: 'explicit.pseudo_timeless_jewel_doryani',
    Zerphi: 'explicit.pseudo_timeless_jewel_zerphi'
  },
  2: {
    Kaom: 'explicit.pseudo_timeless_jewel_kaom',
    Rakiata: 'explicit.pseudo_timeless_jewel_rakiata',
    Kiloava: 'explicit.pseudo_timeless_jewel_kiloava',
    Akoya: 'explicit.pseudo_timeless_jewel_akoya'
  },
  3: {
    Deshret: 'explicit.pseudo_timeless_jewel_deshret',
    Balbala: 'explicit.pseudo_timeless_jewel_balbala',
    Asenath: 'explicit.pseudo_timeless_jewel_asenath',
    Nasima: 'explicit.pseudo_timeless_jewel_nasima'
  },
  4: {
    Venarius: 'explicit.pseudo_timeless_jewel_venarius',
    Maxarius: 'explicit.pseudo_timeless_jewel_maxarius',
    Dominus: 'explicit.pseudo_timeless_jewel_dominus',
    Avarius: 'explicit.pseudo_timeless_jewel_avarius'
  },
  5: {
    Cadiro: 'explicit.pseudo_timeless_jewel_cadiro',
    Victario: 'explicit.pseudo_timeless_jewel_victario',
    Chitus: 'explicit.pseudo_timeless_jewel_chitus',
    Caspiro: 'explicit.pseudo_timeless_jewel_caspiro'
  },
  6: {
    Vorana: 'explicit.pseudo_timeless_jewel_vorana',
    Uhtred: 'explicit.pseudo_timeless_jewel_uhtred',
    Medved: 'explicit.pseudo_timeless_jewel_medved'
  }
};

// PoE2 timeless jewels filter on an explicit per-variant seed stat (the seed is the
// stat's value), sourced from the PoE2 trade API (/api/trade2/data/stats). Keyed by
// the PoE2 jewel id (1 = Heroic Tragedy, 2 = Undying Hate). These ids are PoE2's own
// and collide with PoE1's, so they live in a separate, game-selected map.
export const poe2TradeStatNames: { [key: number]: { [key: string]: string } } = {
  1: {
    Vorana: 'explicit.stat_3418580811|21',
    Medved: 'explicit.stat_3418580811|22',
    Olroth: 'explicit.stat_3418580811|23'
  },
  2: {
    Amanamu: 'explicit.stat_3418580811|24',
    Kulemak: 'explicit.stat_3418580811|25',
    Kurgal: 'explicit.stat_3418580811|26',
    Tecrod: 'explicit.stat_3418580811|27',
    Ulaman: 'explicit.stat_3418580811|28'
  }
};

// Trade is game-aware: the PoE2 route sets this so the query + site target PoE2.
let activeTradeGame: 'poe1' | 'poe2' = 'poe1';
export const setTradeGame = (game: 'poe1' | 'poe2'): void => {
  activeTradeGame = game;
};
const activeStatNames = (): { [key: number]: { [key: string]: string } } =>
  activeTradeGame === 'poe2' ? poe2TradeStatNames : tradeStatNames;

const platformRealms: { [key: string]: string } = {
  PC: '',
  Xbox: 'xbox',
  Playstation: 'sony'
};

export const constructQuery = <T extends SeedRef>(
  jewel: number,
  conqueror: string,
  result: T[],
  isLegacyTradersMode = false
) => {
  const max_filter_length = 45;
  const max_filters = 4;
  const max_query_length = max_filter_length * max_filters;

  if (result.length === 0) {
    throw new Error('constructQuery: result must not be empty');
  }
  const statNames = activeStatNames();
  const conquerors = Object.keys(statNames[jewel] ?? {});
  if (conquerors.length === 0) {
    throw new Error(`constructQuery: unknown jewel type ${jewel}`);
  }
  // An empty / 'Any' conqueror means "any variant". The PoE2 seed->notable transform
  // is variant-agnostic, so a matching seed exists on every variant; we OR them.
  const anyConqueror = conqueror === '' || conqueror === 'Any';
  if (!anyConqueror && !conquerors.includes(conqueror)) {
    throw new Error(`constructQuery: unknown conqueror "${conqueror}" for jewel ${jewel}`);
  }

  interface TradeFilter {
    id: string;
    value: { min: number; max: number };
    disabled?: boolean;
  }
  interface TradeStatGroup {
    type: 'count';
    value: { min: number };
    filters: TradeFilter[];
    disabled: boolean;
  }
  const final_query: TradeStatGroup[] = [];

  if (anyConqueror) {
    // One count>=1 group OR-ing every (variant, seed) filter, so a jewel matches if
    // it is ANY variant carrying one of the seeds. Capped to the trade filter limit,
    // keeping each included seed fully covered across variants.
    const filters: TradeFilter[] = [];
    for (const r of result) {
      if (filters.length + conquerors.length > max_filter_length) {
        break;
      }
      for (const conq of conquerors) {
        filters.push({ id: statNames[jewel][conq], value: { min: r.seed, max: r.seed } });
      }
    }
    final_query.push({ type: 'count', value: { min: 1 }, filters, disabled: false });
  } else if (result.length === 1) {
    final_query.push({
      type: 'count',
      value: { min: 1 },
      disabled: false,
      filters: conquerors.map((conq) => ({
        id: statNames[jewel][conq],
        value: { min: result[0].seed, max: result[0].seed },
        disabled: conq != conqueror
      }))
    });
  } else if (result.length <= max_filter_length) {
    // Multi-conqueror compare layout: one stat group per conqueror, only the
    // selected one enabled. The disabled groups stay toggleable in PoE trade
    // so users can quickly compare seed coverage across conquerors.
    for (const conq of conquerors) {
      final_query.push({
        type: 'count',
        value: { min: 1 },
        filters: result.map((r) => ({
          id: statNames[jewel][conq],
          value: { min: r.seed, max: r.seed }
        })),
        disabled: conq != conqueror
      });
    }
  } else {
    // Selected-conqueror deep-dive: too many matches to compare against
    // other conquerors meaningfully, so chunk the selected conqueror's seeds
    // across all 4 stat groups. First group enabled, rest toggleable.
    const selectedId = statNames[jewel][conqueror];
    for (let i = 0; i < max_filters; i++) {
      final_query.push({
        type: 'count',
        value: { min: 1 },
        filters: [],
        disabled: i != 0
      });
    }
    for (const [i, r] of result.slice(0, max_query_length).entries()) {
      const index = Math.floor(i / max_filter_length);
      final_query[index].filters.push({
        id: selectedId,
        value: { min: r.seed, max: r.seed }
      });
    }
  }

  return {
    query: {
      status: { option: isLegacyTradersMode ? 'online' : 'any' },
      stats: final_query
    },
    sort: { price: 'asc' }
  };
};

export const tradeUrl = (platform: string, league: string): string => {
  if (!platform || typeof platform !== 'string') {
    platform = 'PC';
  }

  if (!league || typeof league !== 'string') {
    league = 'Standard';
  }

  if (activeTradeGame === 'poe2') {
    // PoE2 trade site — the realm segment is always 'poe2' (console PoE2 trade is not
    // distinguished here yet, so platform is ignored for PoE2).
    return `https://www.pathofexile.com/trade2/search/poe2/${encodeURIComponent(league)}`;
  }

  const realm = platformRealms[platform] ?? platform.toLowerCase();
  return `https://www.pathofexile.com/trade/search${realm ? `/${realm}` : ''}/${encodeURIComponent(league)}`;
};

export const openTrade = <T extends SeedRef>(
  jewel: number,
  conqueror: string,
  results: T[],
  platform: string,
  league: string,
  isLegacyTradersMode = false
) => {
  const url = new URL(tradeUrl(platform, league));
  url.searchParams.set('q', JSON.stringify(constructQuery(jewel, conqueror, results, isLegacyTradersMode)));

  console.log('opening trade', url);

  window.open(url, '_blank');
};
