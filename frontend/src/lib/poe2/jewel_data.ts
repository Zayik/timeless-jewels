// Wiki-baked PoE2 timeless-jewel reference data (the two PoE2 jewels and their
// variants/keystones/notables). Sourced from poe2wiki.net and committed under
// static/data/poe2/ — there is NO runtime wiki dependency. This is the PoE2
// analogue of PoE1's keystone_descriptions.ts + alternate-passive data, built
// fresh: the PoE2 jewels share nothing with PoE1.
//
// Heroic Tragedy (seed 100-8000, Kalguur) and Undying Hate (seed 79-30977,
// Abyssal). See frontend/static/data/poe2/{jewels,notables}.json.

export interface Poe2Variant {
  /** Conqueror-equivalent name shown in the picker (e.g. "Vorana"). */
  name: string;
  /** Keystone this variant transforms in-radius keystones into. */
  keystone: string;
  /** Wiki passive id of the keystone (e.g. "kalguur_keystone_1"). */
  keystoneId: string;
  /** Keystone effect lines. */
  keystoneStats: string[];
}

export interface Poe2JewelDef {
  /** Numeric id used as the jewel "value" throughout the reused PoE1 components. */
  id: number;
  /** Stable slug (e.g. "heroic_tragedy"). */
  key: string;
  name: string;
  seedMin: number;
  seedMax: number;
  /** Faction that "Conquers" passives in radius (e.g. "Kalguur"). */
  conqueredBy: string;
  /** What the jewel transforms ("notables" | "small+notables"). */
  transforms: string;
  variants: Poe2Variant[];
}

export interface Poe2NotableDef {
  name: string;
  /** Wiki passive id (e.g. "kalguur_notable19"). */
  id: string;
  stats: string[];
}

let _jewels: Poe2JewelDef[] = [];
let _notables: Record<number, Poe2NotableDef[]> = {};
let _loadPromise: Promise<void> | null = null;

/** Loaded jewel definitions (empty until loadPoe2JewelData resolves). */
export const getPoe2Jewels = (): Poe2JewelDef[] => _jewels;

/** Notable pool for a jewel id (empty array if not loaded / unknown jewel). */
export const getPoe2Notables = (jewelId: number): Poe2NotableDef[] => _notables[jewelId] ?? [];

export const getPoe2Jewel = (jewelId: number): Poe2JewelDef | undefined => _jewels.find((j) => j.id === jewelId);

/**
 * Fetch the committed PoE2 jewel/notable JSON from <base>/data/poe2/. Idempotent:
 * the fetch runs once and subsequent calls await the same promise.
 */
export async function loadPoe2JewelData(basePath = ''): Promise<void> {
  if (_loadPromise) {
    return _loadPromise;
  }
  _loadPromise = (async () => {
    const dir = `${basePath}/data/poe2`;
    const [jewels, notables] = await Promise.all([
      fetch(`${dir}/jewels.json`).then((r) => {
        if (!r.ok) {
          throw new Error(`Failed to load ${dir}/jewels.json: ${r.statusText}`);
        }
        return r.json() as Promise<Poe2JewelDef[]>;
      }),
      fetch(`${dir}/notables.json`).then((r) => {
        if (!r.ok) {
          throw new Error(`Failed to load ${dir}/notables.json: ${r.statusText}`);
        }
        return r.json() as Promise<Record<string, Poe2NotableDef[]>>;
      })
    ]);
    _jewels = jewels;
    _notables = {};
    for (const [k, v] of Object.entries(notables)) {
      _notables[parseInt(k)] = v;
    }
  })();
  return _loadPromise;
}
