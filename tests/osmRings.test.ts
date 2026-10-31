import { describe, expect, it } from 'vitest';
import { FuelClass } from '../src/contract';
import { cellCenterLonLat, makeGridSpec } from '../src/data/geo';
import { assembleRings, buildFuelGrid } from '../src/data/osm';
import type { OsmElement, OsmGeomPoint } from '../src/data/osm';
import { mulberry32 } from '../src/sim/prng';

const W = 40;
const grid = makeGridSpec({ centerLon: -0.376, centerLat: 51.175, width: W, height: W });
const ll = (r: number, c: number): OsmGeomPoint => {
  const p = cellCenterLonLat(grid, r, c);
  return { lat: p.lat, lon: p.lon };
};
const wood = (members: OsmGeomPoint[][], extra: Record<string, string> = {}): OsmElement => ({
  type: 'relation', id: 1, tags: { type: 'multipolygon', natural: 'wood', ...extra },
  members: members.map((geometry) => ({ type: 'way', role: 'outer', geometry })),
});
const count = (a: Uint8Array, v: number): number => a.reduce((n, x) => n + (x === v ? 1 : 0), 0);

// A square ring 10..30 as four ways, each running along one side.
const sides = (): OsmGeomPoint[][] => [
  [ll(10, 10), ll(10, 20), ll(10, 30)],
  [ll(10, 30), ll(20, 30), ll(30, 30)],
  [ll(30, 30), ll(30, 20), ll(30, 10)],
  [ll(30, 10), ll(20, 10), ll(10, 10)],
];

describe('assembleRings', () => {
  it('passes closed ways through and joins open ways end to end into one ring', () => {
    const closed = [ll(1, 1), ll(1, 4), ll(4, 4), ll(4, 1), ll(1, 1)];
    const { rings, unjoined } = assembleRings([closed, ...sides()]);
    expect(unjoined).toBe(0);
    expect(rings.length).toBe(2);
    const big = rings.find((r) => r.length > 5)!;
    expect(big[0]).toEqual(big[big.length - 1]);
    expect(big.length).toBe(9); // 4 sides x 2 steps + the closing point
  });

  it('does not care about the order or the direction of the member ways (fuzz)', () => {
    const rand = mulberry32(5);
    for (let trial = 0; trial < 200; trial++) {
      const parts = sides().map((p) => (rand() < 0.5 ? [...p].reverse() : p));
      for (let i = parts.length - 1; i > 0; i--) {
        const j = Math.floor(rand() * (i + 1));
        [parts[i], parts[j]] = [parts[j], parts[i]];
      }
      const { rings, unjoined } = assembleRings(parts);
      expect(unjoined, `trial ${trial}`).toBe(0);
      expect(rings.length).toBe(1);
      expect(new Set(rings[0].map((p) => `${p.lat},${p.lon}`)).size).toBe(8);
    }
  });

  it('keeps a hole and an outer ring that are each split across ways as two rings', () => {
    const hole = [[ll(15, 15), ll(15, 25), ll(25, 25)], [ll(25, 25), ll(25, 15), ll(15, 15)]];
    const { rings, unjoined } = assembleRings([...sides(), ...hole]);
    expect(unjoined).toBe(0);
    expect(rings.length).toBe(2);
  });

  it('reports ways that cannot form a ring instead of inventing one', () => {
    const missing = sides().slice(0, 3); // the fourth side is not in the extract
    const { rings, unjoined } = assembleRings(missing);
    expect(rings).toEqual([]);
    expect(unjoined).toBe(1);
    const stray = assembleRings([...sides(), [ll(2, 2), ll(2, 3)]]);
    expect(stray.rings.length).toBe(1);
    expect(stray.unjoined).toBe(1);
  });
});

describe('buildFuelGrid with multipolygon relations', () => {
  it('fills a woodland whose outline is split across several ways (this used to be dropped)', () => {
    const { fuel, stats } = buildFuelGrid([wood(sides())], grid, { defaultFuel: FuelClass.GRASS });
    expect(fuel[20 * W + 20]).toBe(FuelClass.FOREST_CONIFER);
    expect(fuel[5 * W + 5]).toBe(FuelClass.GRASS);
    expect(stats.forest).toBeGreaterThan(300);
    expect(stats.skippedUnclosed).toBe(0);
  });

  it('leaves the hole of a split-up woodland unfilled', () => {
    const hole = [[ll(15, 15), ll(15, 25), ll(25, 25)], [ll(25, 25), ll(25, 15), ll(15, 15)]];
    const { fuel } = buildFuelGrid([wood([...sides(), ...hole])], grid, { defaultFuel: FuelClass.GRASS });
    expect(fuel[20 * W + 20]).toBe(FuelClass.GRASS);
    expect(fuel[12 * W + 20]).toBe(FuelClass.FOREST_CONIFER);
  });

  it('still counts a relation member that cannot be closed', () => {
    const { fuel, stats } = buildFuelGrid([wood(sides().slice(0, 3))], grid, { defaultFuel: FuelClass.GRASS });
    expect(count(fuel, FuelClass.FOREST_CONIFER)).toBe(0);
    expect(stats.skippedUnclosed).toBe(1);
  });
});
