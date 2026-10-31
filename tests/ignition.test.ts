import { describe, expect, it } from 'vitest';
import { FuelClass } from '../src/contract';
import type { DemoArea } from '../src/data/bundle';
import { makeGridSpec } from '../src/data/geo';
import { burnableRegions, defaultIgnition } from '../src/data/ignition';
import { mulberry32 } from '../src/sim/prng';

function area(w: number, h: number, f: (r: number, c: number) => number, suggested?: { row: number; col: number }): DemoArea {
  const fuel = new Uint8Array(w * h);
  for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) fuel[r * w + c] = f(r, c);
  return {
    meta: { name: 't', label: 't', synthetic: true, description: '', source: '', attribution: [], license: '', createdAt: '', suggestedIgnition: suggested },
    grid: makeGridSpec({ centerLon: 8, centerLat: 48, width: w, height: h }),
    fuel,
    elevation: new Float32Array(w * h),
  };
}

describe('burnable regions', () => {
  it('labels 8-connected regions and counts their cells', () => {
    const w = 10, h = 6;
    const a = area(w, h, (r, c) => (c === 4 ? 0 : r === 5 && c === 9 ? 0 : 1));
    const { label, sizes } = burnableRegions(a.fuel, w, h);
    expect(sizes.length).toBe(3); // placeholder 0, west part, east part
    expect(sizes[1] + sizes[2]).toBe(w * h - 6 - 1);
    expect(label[0]).not.toBe(label[9]);
    expect(label[4]).toBe(0);
  });

  it('connects diagonally (as the solver does) but not through a 4-connected wall', () => {
    const w = 6, h = 6;
    const diag = area(w, h, (r, c) => (r === c ? 1 : 0));
    expect(burnableRegions(diag.fuel, w, h).sizes.length).toBe(2); // the diagonal is one region
    const wall = area(w, h, (_r, c) => (c === 2 || c === 3 ? 0 : 1));
    expect(burnableRegions(wall.fuel, w, h).sizes.length).toBe(3);
  });
});

describe('default ignition', () => {
  it('uses the suggested ignition when the area has one', () => {
    expect(defaultIgnition(area(20, 20, () => 1, { row: 3, col: 4 }))).toEqual({ row: 3, col: 4 });
  });

  it('is the burnable cell nearest the centre of an open area, preferring forest', () => {
    const open = area(21, 21, () => FuelClass.GRASS);
    expect(defaultIgnition(open)).toEqual({ row: 10, col: 10 });
    const mixed = area(21, 21, (r, c) => (Math.abs(r - 10) <= 1 && Math.abs(c - 10) <= 1 ? FuelClass.GRASS : r > 10 ? FuelClass.FOREST_CONIFER : FuelClass.GRASS));
    const ig = defaultIgnition(mixed)!;
    expect(mixed.fuel[ig.row * 21 + ig.col]).toBe(FuelClass.FOREST_CONIFER);
    expect(Math.hypot(ig.row - 10, ig.col - 10)).toBeLessThan(6);
  });

  it('avoids a small walled-in patch at the centre in favour of the large region (the Boulder Creek failure)', () => {
    const w = 60, h = 60;
    // A 5 x 5 forest patch in the middle, surrounded by a one-cell wall, inside a big forest.
    const a = area(w, h, (r, c) => {
      const d = Math.max(Math.abs(r - 30), Math.abs(c - 30));
      if (d === 4) return FuelClass.NONE; // wall
      return FuelClass.FOREST_CONIFER;
    });
    const ig = defaultIgnition(a)!;
    expect(Math.max(Math.abs(ig.row - 30), Math.abs(ig.col - 30))).toBeGreaterThan(4); // outside the wall
    expect(a.fuel[ig.row * w + ig.col]).toBe(FuelClass.FOREST_CONIFER);
  });

  it('avoids a perforated area (a town: most cells built-up) in favour of solid open land, even if the town is at the centre', () => {
    const w = 80, h = 80;
    // Everything is burnable forest, except a 24 x 24 "town" at the centre where 60 % of the cells are buildings.
    const a = area(w, h, (r, c) => {
      const inTown = Math.abs(r - 40) < 12 && Math.abs(c - 40) < 12;
      return inTown && (r * 5 + c * 3) % 5 < 3 ? FuelClass.NONE : FuelClass.FOREST_CONIFER;
    });
    const ig = defaultIgnition(a)!;
    const inTown = Math.abs(ig.row - 40) < 12 && Math.abs(ig.col - 40) < 12;
    expect(inTown).toBe(false);
    // And it still takes the nearest open land, not a far corner.
    expect(Math.hypot(ig.row - 40, ig.col - 40)).toBeLessThan(26);
  });

  it('falls back to the most open cell of the region when no cell is open enough', () => {
    const w = 30, h = 30;
    const a = area(w, h, (r, c) => ((r + c * 2) % 3 === 0 ? FuelClass.NONE : FuelClass.SHRUB)); // perforated everywhere
    const ig = defaultIgnition(a);
    expect(ig).not.toBeNull();
    expect(a.fuel[ig!.row * w + ig!.col]).not.toBe(FuelClass.NONE);
  });

  it('always lands in the largest burnable region, and on a burnable cell (fuzz: 100 random landscapes)', () => {
    for (let seed = 1; seed <= 100; seed++) {
      const rand = mulberry32(seed);
      const w = 20 + Math.floor(rand() * 40), h = 20 + Math.floor(rand() * 40);
      const a = area(w, h, () => (rand() < 0.42 ? FuelClass.NONE : [1, 2, 3, 4, 5][Math.floor(rand() * 5)]));
      const ig = defaultIgnition(a);
      const { label, sizes } = burnableRegions(a.fuel, w, h);
      if (sizes.length === 1) { expect(ig).toBeNull(); continue; }
      expect(ig, `seed ${seed}`).not.toBeNull();
      const biggest = Math.max(...sizes.slice(1));
      expect(sizes[label[ig!.row * w + ig!.col]], `seed ${seed}`).toBe(biggest);
      expect(a.fuel[ig!.row * w + ig!.col]).not.toBe(FuelClass.NONE);
    }
  });

  it('when two regions are exactly the same size, the first one in scan order wins (deterministic tie-break)', () => {
    const w = 41, h = 21;
    const twin = area(w, h, (_r, c) => (c === 20 ? FuelClass.NONE : FuelClass.GRASS)); // two identical 20 x 21 halves
    const sizes = burnableRegions(twin.fuel, w, h).sizes;
    expect(sizes[1]).toBe(sizes[2]);
    const ig = defaultIgnition(twin)!;
    expect(ig.col).toBeLessThan(20); // the western half is region 1
  });

  it('returns null when nothing can burn, and is deterministic', () => {
    expect(defaultIgnition(area(10, 10, () => FuelClass.NONE))).toBeNull();
    const a = area(30, 30, (r, c) => ((r * 7 + c * 3) % 5 === 0 ? FuelClass.NONE : FuelClass.SHRUB));
    expect(defaultIgnition(a)).toEqual(defaultIgnition(a));
  });
});
