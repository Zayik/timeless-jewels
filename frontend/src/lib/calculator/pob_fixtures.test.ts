// Grades the TypeScript calculator against the Path of Building fixtures that upstream
// (Vilsol/timeless-jewels) ships in testdata/. These replace the Go tests that used the same
// fixtures (abyss_test.go, abyss_region_test.go, abyss_ascendancy_test.go,
// legion_draw_guard_test.go) now that the Go engine is gone from this fork.

import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { data, initializeData, JewelType, ABYSS_CONQUEROR } from './data';
import { calculator } from './index';
import { abyssConqueredNodes } from './abyss';
import type { AbyssTreeNodes } from './abyss';
import type { AlternatePassiveSkillInformation, PassiveSkill } from './types';

const here = path.dirname(fileURLToPath(import.meta.url));
const staticData = path.resolve(here, '../../../static');
const testdata = path.resolve(here, '../../../../testdata');

// Path of Building numbers a replacement by alternate skill index + #legionAdditions.
const POB_TIMELESS_JEWEL_ADDITIONS = 337;

const readGzLines = (rel: string): string[] =>
  gunzipSync(readFileSync(path.join(testdata, rel)))
    .toString('utf8')
    .split('\n')
    .filter((l) => l.trim() !== '');

let byGraphID: Map<number, PassiveSkill>;
let treeNodes: Record<string, { skill?: number; name?: string; ascendancyName?: string }>;

beforeAll(async () => {
  // data.ts loads over fetch(); serve the static assets from disk instead.
  globalThis.fetch = (async (input: string | URL) => {
    const file = path.join(staticData, String(input));
    return new Response(readFileSync(file));
  }) as typeof fetch;
  await initializeData('');

  // Several passives can share a graph id; like the Go tests, keep the first.
  byGraphID = new Map();
  for (const p of data.PassiveSkills ?? []) {
    if (!byGraphID.has(p.PassiveSkillGraphID)) {
      byGraphID.set(p.PassiveSkillGraphID, p);
    }
  }
  treeNodes = JSON.parse(data.SkillTree).nodes;
});

const roll = (rolls: Record<number, number> | undefined, i: number) => rolls?.[i] ?? 0;

// ---- Calculate vs PoB's Abyss LUT ----

type Component = { type: number; id: number; rolls: number[] };

const parseComponents = (s: string): Component[] =>
  s === '-'
    ? []
    : s.split(';').map((part) => {
        const [type, id, rolls] = part.split(':');
        return { type: Number(type), id: Number(id), rolls: rolls === '' ? [] : rolls.split(',').map(Number) };
      });

const components = (info: AlternatePassiveSkillInformation): Component[] => {
  const out: Component[] = [];
  const skill = info.AlternatePassiveSkill;
  if (skill) {
    const n = Math.min(skill.StatsKeys?.length ?? 0, 4);
    out.push({
      type: 1,
      id: skill.Index + POB_TIMELESS_JEWEL_ADDITIONS,
      rolls: Array.from({ length: n }, (_, i) => roll(info.StatRolls, i))
    });
  }
  for (const a of info.AlternatePassiveAdditionInformations ?? []) {
    const n = Math.min(a.AlternatePassiveAddition?.StatsKeys?.length ?? 0, 2);
    out.push({
      type: 2,
      id: a.AlternatePassiveAddition!.Index,
      rolls: Array.from({ length: n }, (_, i) => roll(a.StatRolls, i))
    });
  }
  return out;
};

const gradeAbyssFixture = (rel: string) => {
  let records = 0;
  const failures: string[] = [];
  for (const line of readGzLines(rel)) {
    let fields = line.split(/\s+/);
    if (fields[0] === 'Z') {
      fields = ['Z', String(JewelType.AbyssZorath), ...fields.slice(1)];
    }
    const jewel = Number(fields[1]);
    const seed = Number(fields[2]);
    const node = Number(fields[3]);
    const want = parseComponents(fields[4]);
    const passive = byGraphID.get(node);
    expect(passive, `node ${node} is a passive skill`).toBeDefined();
    const got = components(calculator.Calculate(passive!.Index, seed, jewel, ABYSS_CONQUEROR));
    records++;
    if (JSON.stringify(got) !== JSON.stringify(want)) {
      failures.push(
        `jewel ${jewel} seed ${seed} node ${node}: got ${JSON.stringify(got)}, PoB ${JSON.stringify(want)}`
      );
    }
  }
  return { records, failures };
};

describe('Abyss Calculate vs Path of Building', () => {
  it('matches the Abyss LUT sample (seeds 100, 4242, 8000; all five jewels)', () => {
    const { records, failures } = gradeAbyssFixture('abyss/abyss_lut.txt.gz');
    expect(records).toBeGreaterThan(0);
    expect(failures.slice(0, 5)).toEqual([]);
  });

  it('matches every biased-tail draw, where plain modulo disagrees', () => {
    const { records, failures } = gradeAbyssFixture('abyss/abyss_tail_draws.txt.gz');
    expect(records).toBe(1153);
    expect(failures.slice(0, 5)).toEqual([]);
  });
});

// ---- Legion draws vs PoB's legion LUTs ----

const legionMatchesLUT = (jewel: number, info: AlternatePassiveSkillInformation, lut: number[]): boolean => {
  const replaced = info.AlternatePassiveSkill;
  const adds = info.AlternatePassiveAdditionInformations ?? [];

  if (jewel !== JewelType.GloriousVanity) {
    if (replaced) {
      return replaced.Index + POB_TIMELESS_JEWEL_ADDITIONS === lut[0];
    }
    if (adds.length > 0) {
      return adds[0].AlternatePassiveAddition!.Index === lut[0];
    }
    return false;
  }

  switch (lut.length) {
    case 2:
    case 3: {
      if (!replaced || adds.length > 0 || replaced.Index + POB_TIMELESS_JEWEL_ADDITIONS !== lut[0]) {
        return false;
      }
      const rolls = [0, 1, 2, 3].map((i) => roll(info.StatRolls, i));
      const k = lut.length - 1;
      return rolls.slice(0, k).every((r, i) => r === lut[1 + i]) && rolls.slice(k).every((r) => r === 0);
    }
    case 6:
    case 8: {
      const k = lut.length / 2;
      if (adds.length !== k) {
        return false;
      }
      return adds.every((a, i) => a.AlternatePassiveAddition!.Index === lut[i] && roll(a.StatRolls, 0) === lut[k + i]);
    }
  }
  return false;
};

describe('Legion draws vs Path of Building', () => {
  it('matches every deciding and neighbour record', () => {
    const read: Record<string, number> = { D: 0, N: 0 };
    const neighbours: Record<number, number> = {};
    const failures: string[] = [];
    for (const line of readGzLines('legion/legion_draws.txt.gz')) {
      const [kind, jt, seedS, nodeS, lutS] = line.split(/\s+/);
      const jewel = Number(jt);
      read[kind]++;
      if (kind === 'N') {
        neighbours[jewel] = (neighbours[jewel] ?? 0) + 1;
      }
      const passive = byGraphID.get(Number(nodeS));
      expect(passive).toBeDefined();
      const conqueror = Object.keys(data.TimelessJewelConquerors[jewel] ?? {}).sort()[0];
      const got = calculator.Calculate(passive!.Index, Number(seedS), jewel, conqueror);
      if (!legionMatchesLUT(jewel, got, lutS.split(',').map(Number))) {
        failures.push(`${kind} jewel ${jewel} seed ${seedS} node ${nodeS}: PoB ${lutS}`);
      }
    }
    expect(read.D).toBe(100);
    for (let jt = JewelType.GloriousVanity; jt <= JewelType.HeroicTragedy; jt++) {
      expect(neighbours[jt] ?? 0).toBeGreaterThanOrEqual(10);
    }
    expect(failures.slice(0, 5)).toEqual([]);
  });
});

// ---- Socket-keyed Abyss regions vs PoB's ABYS LUTs ----

// abyss_regions.txt.gz was dumped from PoB against the 3.29 tree. 3.30 added Blightcore proxy
// passives next to some sockets, which changes those regions, so the walk is graded on the tree
// the fixture came from (upstream's Go test has the same 612 of 1908 mismatches on 3.30 until
// the fixture is regenerated). The walk is tree-agnostic, so this still pins the port exactly.
describe('Abyss conquered region vs Path of Building (3.29 tree)', () => {
  let tree329: AbyssTreeNodes;
  beforeAll(() => {
    tree329 = JSON.parse(gunzipSync(readFileSync(path.join(testdata, 'abyss/SkillTree-3.29.json.gz'))).toString('utf8'))
      .nodes as AbyssTreeNodes;
  });
  const conquered = (socket: number, seed: number, jewel: number) => abyssConqueredNodes(tree329, socket, seed, jewel);

  const rows = () =>
    readGzLines('abyss/abyss_regions.txt.gz').map((line) => {
      const [socket, seed, nodes] = line.split(/\s+/);
      return { socket: Number(socket), seed: Number(seed), nodes: nodes.split(',').map(Number) };
    });

  it('matches node set and order for every sampled record, all four jewels', () => {
    const all = rows();
    expect(all).toHaveLength(477);
    const failures: string[] = [];
    for (const r of all) {
      for (let jewel = JewelType.AbyssTecrod; jewel <= JewelType.AbyssAmanamu; jewel++) {
        const got = conquered(r.socket, r.seed, jewel);
        if (JSON.stringify(got) !== JSON.stringify(r.nodes)) {
          failures.push(`jewel ${jewel} socket ${r.socket} seed ${r.seed}`);
        }
      }
    }
    expect(failures.slice(0, 5)).toEqual([]);
  });

  it('cannot reproduce the records from a wrong seed (the fixture discriminates)', () => {
    let matched = 0;
    for (const r of rows()) {
      const got = conquered(r.socket, (r.seed % 7901) + 100, JewelType.AbyssTecrod);
      if (JSON.stringify(got) === JSON.stringify(r.nodes)) {
        matched++;
      }
    }
    expect(matched).toBe(0);
  });

  it('has no region for what PoB has no record of', () => {
    const cases: [string, number, number, number][] = [
      ['cluster sub-socket', 2311, 4242, JewelType.AbyssTecrod],
      ['not a socket', 27140, 4242, JewelType.AbyssTecrod],
      ['seed below range', 26725, 99, JewelType.AbyssTecrod],
      ['seed above range', 26725, 8001, JewelType.AbyssTecrod],
      ['legion jewel', 26725, 4242, JewelType.GloriousVanity],
      ['Zorath', 26725, 4242, JewelType.AbyssZorath]
    ];
    for (const [name, socket, seed, jewel] of cases) {
      expect(conquered(socket, seed, jewel), name).toBeUndefined();
    }
  });
});

// ---- Zorath's ascendancy notable ----

// In-game recordings of which notable Reclaimed Malevolence rewrote, from
// https://github.com/Parazeya/abyss-jewels observations/ascendancy.json (MIT, poeqol.com).
const observations: [number, string, string][] = [
  [1969, 'Deadeye', 'Gathering Winds'],
  [1969, 'Assassin', 'Shadowed Blood'],
  [4501, 'Deadeye', 'Avidity'],
  [778, 'Deadeye', 'Gathering Winds'],
  [4906, 'Deadeye', 'Far Shot'],
  [4906, 'Pathfinder', "Nature's Reprisal"],
  [4906, 'Elementalist', 'Bringer of Ruin'],
  [7760, 'Deadeye', 'Focal Point'],
  [7247, 'Deadeye', 'Far Shot'],
  [7247, 'Pathfinder', "Nature's Reprisal"],
  [7247, 'Assassin', 'Unstable Infusion'],
  [7247, 'Luminary', 'Noble Blood'],
  [7856, 'Luminary', 'Noble Blood'],
  [7856, 'Deadeye', 'Ricochet'],
  [7856, 'Pathfinder', "Nature's Adrenaline"],
  [7856, 'Assassin', 'Toxic Delivery'],
  [7856, 'Elementalist', 'Shaper of Winter'],
  [3418, 'Elementalist', 'Mastermind of Discord'],
  [3418, 'Deadeye', 'Avidity'],
  [3418, 'Luminary', 'Noble Blood'],
  [3418, 'Assassin', 'Shadowed Blood']
];

describe('Abyss Zorath ascendancy notable', () => {
  const notableID = (ascendancy: string, name: string): number => {
    const n = Object.values(treeNodes).find((t) => t.ascendancyName === ascendancy && t.name === name);
    expect(n, `${ascendancy} ${name}`).toBeDefined();
    return n!.skill!;
  };

  it('matches the in-game observations', () => {
    for (const [seed, ascendancy, target] of observations) {
      expect(calculator.AbyssAscendancyNotable(seed, ascendancy), `${seed} ${ascendancy}`).toBe(
        notableID(ascendancy, target)
      );
    }
  });

  it('matches the wrong-seed control counts Parazeya verify.mjs reports', () => {
    const hits = (shift: number) =>
      observations.filter(
        ([seed, ascendancy, target]) =>
          calculator.AbyssAscendancyNotable(seed + shift, ascendancy) === notableID(ascendancy, target)
      ).length;
    expect(hits(137)).toBe(10);
    expect(hits(911)).toBe(7);
    expect(hits(4242)).toBe(5);
  });

  it("matches the ASCS section of PoB's Zorath LUT", () => {
    let rows = 0;
    let conquered = 0;
    const failures: string[] = [];
    for (const line of readGzLines('abyss/abyss_ascendancy.txt.gz')) {
      const [ascendancy, seed, want] = line.split(/\s+/);
      const id = calculator.AbyssAscendancyNotable(Number(seed), ascendancy);
      const got = id === undefined ? '-' : String(id);
      rows++;
      if (want !== '-') {
        conquered++;
      }
      if (got !== want) {
        failures.push(`${ascendancy} seed ${seed}: got ${got}, PoB ${want}`);
      }
    }
    expect(failures.slice(0, 5)).toEqual([]);
    expect([rows, conquered]).toEqual([25197, 17213]);
  });

  it('end to end: the walk names the node, Calculate gives its PoB modification', () => {
    const lut = new Map<string, string>();
    for (const line of readGzLines('abyss/abyss_lut.txt.gz')) {
      const f = line.split(/\s+/);
      if (f[0] === 'Z') {
        lut.set(`${f[1]} ${f[2]}`, f[3]);
      }
    }
    let checked = 0;
    for (const line of readGzLines('abyss/abyss_ascendancy.txt.gz')) {
      const [ascendancy, seedS] = line.split(/\s+/);
      if (seedS !== '100' && seedS !== '4242' && seedS !== '8000') {
        continue;
      }
      const seed = Number(seedS);
      const id = calculator.AbyssAscendancyNotable(seed, ascendancy);
      if (id === undefined) {
        continue;
      }
      const want = lut.get(`${seed} ${id}`);
      expect(want && want !== '-', `${ascendancy} seed ${seed}: PoB modification for ${id}`).toBeTruthy();
      const info = calculator.Calculate(byGraphID.get(id)!.Index, seed, JewelType.AbyssZorath, ABYSS_CONQUEROR);
      expect(components(info), `${ascendancy} seed ${seed} node ${id}`).toEqual(parseComponents(want!));
      checked++;
    }
    expect(checked).toBe(40);
  });

  it('never conquers an Ascendant or Reliquarian notable', () => {
    const range = data.TimelessJewelSeedRanges[JewelType.AbyssZorath];
    for (const ascendancy of ['Ascendant', 'Reliquarian']) {
      for (let seed = range.Min; seed <= range.Max; seed++) {
        expect(calculator.AbyssAscendancyNotable(seed, ascendancy)).toBeUndefined();
      }
    }
  });
});
