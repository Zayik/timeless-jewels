import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { CATEGORIES, loadPutridNotables, oilSets, poolFor, rankCombos, sortRanks } from './putrid_seed';

const here = path.dirname(fileURLToPath(import.meta.url));
const tree = JSON.parse(gunzipSync(readFileSync(path.resolve(here, '../../static/data/SkillTree.json.gz'))).toString());
const notables = loadPutridNotables(tree);

// Every notable grown in David's anoint log (Clear+Sepia+Amber, 50 seeds).
const LOGGED_CSA = [
  'Battle Trance',
  'Burst of Energy',
  'Careful Counterattack',
  'Cruel Retort',
  'Crushing Reply',
  'Flow of Battle',
  'Indiscriminate Revenge',
  'Path of the Warrior',
  'Practised Reapplication',
  'Prepared Response'
];

describe('putrid seed', () => {
  it('reads every anointable notable', () => {
    expect(notables.length).toBe(472);
  });

  it('Clear+Sepia+Amber pool is exactly the logged notables', () => {
    const pool = poolFor(notables, ['ClearOil', 'SepiaOil', 'AmberOil']).map((n) => n.name);
    expect(pool.sort()).toEqual([...LOGGED_CSA].sort());
  });

  it('enumerates oil sets', () => {
    expect(oilSets(false).length).toBe(364);
    expect(oilSets(true).length).toBe(364 + 91 + 14);
  });

  it('every three-oil set has a pool', () => {
    for (const s of oilSets(false)) {
      expect(poolFor(notables, s).length).toBeGreaterThan(0);
    }
  });

  it('ranks a totem/aura wishlist with Indigo+Prismatic+Silver on top', () => {
    const wish = new Set(['Wood, Stone, and Spell', 'Sovereignty', 'Watchtowers']);
    const top = sortRanks(rankCombos(notables, wish, false), 'count')[0];
    expect(top.hits.map((n) => n.name).sort()).toEqual([...wish].sort());
    expect(top.oils.sort()).toEqual(['IndigoOil', 'PrismaticOil', 'SilverOil']);
  });

  it('puts every category to use', () => {
    for (const c of CATEGORIES) {
      expect(
        notables.some((n) => n.categories.includes(c.name)),
        c.name
      ).toBe(true);
    }
  });
});
