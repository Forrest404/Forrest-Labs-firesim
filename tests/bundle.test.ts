import { describe, expect, it } from 'vitest';
import { ELEVATION_NODATA, FuelClass, validateScenario } from '../src/contract';
import { decodeBundle, encodeBundle, scenarioFromArea } from '../src/data/bundle';
import { buildFuelGrid, overpassQuery } from '../src/data/osm';
import type { OsmElement } from '../src/data/osm';
import { makeGridSpec, cellCenterLonLat } from '../src/data/geo';
import { makeSyntheticArea } from '../src/data/synthetic';
import { computeSlopeAspect, decodeTerrarium, fillNodata } from '../src/data/terrain';
import { simulate } from '../src/sim';

describe('synthetic areas and bundles', () => {
  const area = makeSyntheticArea({ name: 't', label: 'T', centerLon: 8.4, centerLat: 48.345, seed: 5, style: 'valley' });

  it('generates a valid, varied area', () => {
    const counts = new Map<number, number>();
    for (const f of area.fuel) counts.set(f, (counts.get(f) ?? 0) + 1);
    expect(counts.get(FuelClass.NONE) ?? 0).toBeGreaterThan(300); // river, roads, lake, village
    expect((counts.get(FuelClass.FOREST_CONIFER) ?? 0) + (counts.get(FuelClass.FOREST_DECIDUOUS) ?? 0)).toBeGreaterThan(5000);
    expect(counts.get(FuelClass.GRASS) ?? 0).toBeGreaterThan(1000);
    expect(area.meta.synthetic).toBe(true);
    expect(area.meta.label).toContain('synthetic');
    const s = scenarioFromArea(area);
    expect(validateScenario(s)).toEqual([]);
  });

  it('encodes and decodes byte-identically, and the result still simulates', () => {
    const bundle = encodeBundle(area);
    const json = JSON.stringify(bundle);
    expect(json.length).toBeLessThan(600_000);
    const back = decodeBundle(JSON.parse(json));
    expect(Buffer.from(back.fuel).equals(Buffer.from(area.fuel))).toBe(true);
    expect(Buffer.from(back.elevation.buffer).equals(Buffer.from(area.elevation.buffer))).toBe(true);
    expect(back.meta).toEqual(area.meta);
    const a = simulate(scenarioFromArea(area, { durationSeconds: 3600 }));
    const b = simulate(scenarioFromArea(back, { durationSeconds: 3600 }));
    expect(Buffer.from(a.arrivalTime.buffer).equals(Buffer.from(b.arrivalTime.buffer))).toBe(true);
    expect(a.stats.burnedCells).toBeGreaterThan(10);
  });
});

describe('terrain', () => {
  it('decodes Terrarium pixels', () => {
    expect(decodeTerrarium(128, 0, 0)).toBe(0);
    expect(decodeTerrarium(129, 44, 128)).toBeCloseTo(300.5, 6);
  });

  it('fills nodata from the nearest valid cell', () => {
    const e = new Float32Array([1, ELEVATION_NODATA, ELEVATION_NODATA, 4, ELEVATION_NODATA, NaN]);
    const filled = fillNodata(e, 3, 2);
    expect(filled).toBe(4);
    for (const v of e) expect(Number.isFinite(v)).toBe(true);
    expect(e[1]).toBe(1);
  });

  it('computes slope and aspect for a plane rising north', () => {
    const W = 10;
    const H = 10;
    const e = new Float32Array(W * H);
    const rise = 30 * Math.tan((12 * Math.PI) / 180);
    for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) e[r * W + c] = (H - 1 - r) * rise;
    const { slopeDeg, aspectDeg } = computeSlopeAspect(e, W, H, 30);
    expect(slopeDeg[5 * W + 5]).toBeCloseTo(12, 3);
    expect(aspectDeg[5 * W + 5]).toBeCloseTo(180, 3); // faces south (downhill is south)
  });
});

describe('osm', () => {
  const grid = makeGridSpec({ centerLon: 8.4, centerLat: 48.345, width: 40, height: 40 });

  it('produces a query with the bbox in south,west,north,east order', () => {
    const q = overpassQuery(grid.bounds);
    expect(q).toContain(`(${grid.bounds.south},${grid.bounds.west},${grid.bounds.north},${grid.bounds.east})`);
    expect(q).toContain('out geom');
  });

  it('rasterises a forest polygon, a river line and defaults the rest to grass', () => {
    const ll = (r: number, c: number) => {
      const p = cellCenterLonLat(grid, r, c);
      return { lat: p.lat, lon: p.lon };
    };
    const forest: OsmElement = { type: 'way', id: 1, tags: { landuse: 'forest' }, geometry: [ll(5, 5), ll(5, 20), ll(20, 20), ll(20, 5), ll(5, 5)] };
    const river: OsmElement = { type: 'way', id: 2, tags: { waterway: 'river' }, geometry: [ll(0, 30), ll(39, 30)] };
    const { fuel, stats } = buildFuelGrid([forest, river], grid);
    expect(fuel[10 * 40 + 10]).toBe(FuelClass.FOREST_CONIFER);
    expect(fuel[10 * 40 + 30]).toBe(FuelClass.NONE);
    expect(fuel[35 * 40 + 2]).toBe(FuelClass.GRASS);
    expect(stats.forest).toBeGreaterThan(200);
    expect(stats.waterway).toBeGreaterThanOrEqual(40);
  });
});
