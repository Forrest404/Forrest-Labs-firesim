import { describe, expect, it } from 'vitest';
import { DEFAULT_ENSEMBLE_SPEC, FuelClass } from '../src/contract';
import type { Intervention } from '../src/contract';
import { cellCenterLonLat } from '../src/data/geo';
import { EXPORT_DISCLAIMER, defaultPerimeterTimes, perimetersToGeoJSON, probabilityToGeoJSON } from '../src/export/geojson';
import type { GeoJsonCollection, GeoJsonFeature, Position } from '../src/export/geojson';
import { simulate } from '../src/sim';
import { mulberry32 } from '../src/sim/prng';
import type { SimResult } from '../src/contract';
import { runEnsemble } from '../src/sim/ensemble';
import { FIX_H, FIX_W, idx, makeFixture } from './fixtures';

const scenario = (o = {}) => makeFixture({ river: false, road: false, ignition: [{ row: 25, col: 20 }], fuelClass: FuelClass.GRASS, dryness: 'high', weather: { windSpeedMps: 6, windFromDeg: 270 }, durationSeconds: 4 * 3600, ...o });

function ringsOf(f: GeoJsonFeature): Position[][][] {
  if (f.geometry.type === 'Polygon') return [f.geometry.coordinates as Position[][]];
  return f.geometry.coordinates as Position[][][];
}
const signedArea = (ring: Position[]): number => {
  let a = 0;
  for (let i = 0; i < ring.length - 1; i++) a += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
  return a / 2;
};
const perims = (c: GeoJsonCollection): GeoJsonFeature[] => c.features.filter((f) => f.properties.kind === 'perimeter');

describe('perimeters GeoJSON', () => {
  const s = scenario();
  const result = simulate(s);
  const ctx = { grid: s.grid, areaName: 'Test area', areaIsSynthetic: true };
  const fc = perimetersToGeoJSON(ctx, result, { durationSeconds: s.durationSeconds, ignition: s.ignition });

  it('is a FeatureCollection with the honesty metadata every export must carry', () => {
    expect(fc.type).toBe('FeatureCollection');
    expect(fc.disclaimer).toBe(EXPORT_DISCLAIMER);
    expect(fc.disclaimer).toMatch(/Not for real-world decisions/);
    expect(fc.properties).toMatchObject({ kind: 'fire-perimeters', area: 'Test area', areaIsSynthetic: true, cellSizeM: 30 });
    expect(fc.generator).toMatch(/simplified/);
    expect(JSON.parse(JSON.stringify(fc))).toEqual(fc); // plain JSON, round-trips
  });

  it('follows RFC 7946: [lon, lat] order inside the grid, closed rings, exterior counter-clockwise, holes clockwise', () => {
    const b = s.grid.bounds;
    const margin = 0.6 * (b.east - b.west) / s.grid.width;
    expect(perims(fc).length).toBeGreaterThan(2);
    for (const f of perims(fc)) {
      for (const poly of ringsOf(f)) {
        poly.forEach((ring, k) => {
          expect(ring.length).toBeGreaterThanOrEqual(4);
          expect(ring[0]).toEqual(ring[ring.length - 1]);
          for (const [lon, lat] of ring) {
            expect(lon).toBeGreaterThanOrEqual(b.west - margin);
            expect(lon).toBeLessThanOrEqual(b.east + margin);
            expect(lat).toBeGreaterThanOrEqual(b.south - margin);
            expect(lat).toBeLessThanOrEqual(b.north + margin);
          }
          expect(signedArea(ring) > 0, `${f.properties.tHours} h ring ${k}`).toBe(k === 0);
        });
      }
    }
    expect(fc.bbox![0]).toBeLessThan(fc.bbox![2]);
    expect(fc.bbox![1]).toBeLessThan(fc.bbox![3]);
  });

  it('has hourly perimeters ending at the duration, growing nested over time', () => {
    const ts = perims(fc).map((f) => f.properties.tSeconds as number);
    expect(ts).toEqual(defaultPerimeterTimes(s.durationSeconds));
    expect(ts[ts.length - 1]).toBe(s.durationSeconds);
    for (let i = 1; i < ts.length; i++) expect(ts[i]).toBeGreaterThan(ts[i - 1]);
    let prevArea = 0;
    let prevLen = 0;
    for (const f of perims(fc)) {
      expect(f.properties.areaHa as number).toBeGreaterThanOrEqual(prevArea);
      expect(f.properties.perimeterKm as number).toBeGreaterThan(0);
      expect(f.properties.tHours).toBeCloseTo((f.properties.tSeconds as number) / 3600, 12);
      prevArea = f.properties.areaHa as number;
      prevLen = Math.max(prevLen, f.properties.perimeterKm as number);
    }
    expect(prevLen).toBeGreaterThan(0.5);
  });

  it('the area of each perimeter matches the burned area of the run at that time (within the contour staircase error)', () => {
    for (const f of perims(fc)) {
      const t = f.properties.tSeconds as number;
      let burned = 0;
      for (const a of result.arrivalTime) if (a <= t) burned++;
      const ha = burned * 0.09;
      expect(Math.abs((f.properties.areaHa as number) / ha - 1), `t = ${t / 3600} h`).toBeLessThan(0.1);
    }
  });

  it('the final perimeter encloses exactly the cells that burned (point-in-polygon on every cell centre)', () => {
    const f = perims(fc)[perims(fc).length - 1];
    const polys = ringsOf(f);
    const inside = (p: Position): boolean => {
      let n = 0;
      for (const poly of polys) {
        const hit = (ring: Position[]): boolean => {
          let c = false;
          for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
            const [xi, yi] = ring[i], [xj, yj] = ring[j];
            if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) c = !c;
          }
          return c;
        };
        if (hit(poly[0]) && !poly.slice(1).some(hit)) n++;
      }
      return n > 0;
    };
    let wrong = 0;
    for (let r = 0; r < FIX_H; r++) {
      for (let c = 0; c < FIX_W; c++) {
        const { lon, lat } = cellCenterLonLat(s.grid, r, c);
        if (inside([lon, lat]) !== (result.arrivalTime[idx(r, c)] <= s.durationSeconds)) wrong++;
      }
    }
    expect(wrong).toBe(0); // every cell centre is on the correct side of the line
  });

  it('includes the ignition point and the firefighting actions as points', () => {
    const iv: Intervention[] = [{ id: 'fb1', tSeconds: 600, type: 'firebreak', cells: [idx(3, 3), idx(3, 4)] }, { id: 'w1', tSeconds: 0, type: 'water', cells: [idx(10, 10)] }];
    const out = perimetersToGeoJSON(ctx, result, { durationSeconds: s.durationSeconds, ignition: s.ignition, interventions: iv });
    const ig = out.features.find((f) => f.properties.kind === 'ignition')!;
    const c = cellCenterLonLat(s.grid, 25, 20);
    expect(ig.geometry).toEqual({ type: 'Point', coordinates: [Math.round(c.lon * 1e6) / 1e6, Math.round(c.lat * 1e6) / 1e6] });
    const fb = out.features.find((f) => f.properties.kind === 'firebreak')!;
    expect(fb.geometry.type).toBe('MultiPoint');
    expect((fb.geometry.coordinates as Position[]).length).toBe(2);
    expect(fb.properties).toMatchObject({ id: 'fb1', tSeconds: 600, cells: 2 });
    expect(out.features.some((f) => f.properties.kind === 'water')).toBe(true);
  });

  it('a fire that has not started to spread, or never burns at a requested time, gives no polygon for that time', () => {
    const out = perimetersToGeoJSON(ctx, result, { durationSeconds: s.durationSeconds, timesS: [-5, 60] });
    expect(perims(out).length).toBe(1); // t = 60 s: the ignition cell and a few neighbours
    expect(perims(out)[0].properties.tSeconds).toBe(60);
  });

  it('custom times are honoured and the default times are sensible for short and long runs', () => {
    expect(defaultPerimeterTimes(3600)).toEqual([3600]);
    expect(defaultPerimeterTimes(3 * 3600)).toEqual([3600, 7200, 10800]);
    const long = defaultPerimeterTimes(200 * 3600);
    expect(long.length).toBeLessThanOrEqual(49);
    expect(long[long.length - 1]).toBe(200 * 3600);
  });

  it('coordinates are rounded to 6 decimals and the files stay small', () => {
    const text = JSON.stringify(fc);
    const longNumbers = text.match(/-?\d+\.\d{7,}/g) ?? [];
    // Only properties (areas, lengths) may carry long decimals, never a coordinate.
    for (const f of fc.features) {
      const visit = (c: unknown): void => {
        if (Array.isArray(c) && typeof c[0] === 'number') for (const v of c as number[]) expect(Math.abs(v * 1e6 - Math.round(v * 1e6))).toBeLessThan(1e-6);
        else if (Array.isArray(c)) c.forEach(visit);
      };
      visit(f.geometry.coordinates);
    }
    expect(text.length).toBeLessThan(150_000);
    expect(longNumbers.length).toBeLessThan(40); // area/length properties only
  });

  it('is deterministic', () => {
    expect(JSON.stringify(perimetersToGeoJSON(ctx, result, { durationSeconds: s.durationSeconds }))).toBe(JSON.stringify(fc.features.length ? perimetersToGeoJSON(ctx, result, { durationSeconds: s.durationSeconds, ignition: s.ignition }) && perimetersToGeoJSON(ctx, result, { durationSeconds: s.durationSeconds }) : fc));
  });
});

describe('ring orientation holds for every shape (holes, islands, several blobs)', () => {
  it('fuzz: 150 random arrival fields always give counter-clockwise exteriors and clockwise holes, rings closed', () => {
    const grid = makeFixture().grid;
    for (let seed = 1; seed <= 150; seed++) {
      const rand = mulberry32(seed);
      const n = grid.width * grid.height;
      const arrival = new Float32Array(n).fill(Infinity);
      // A few blobs, some with unburned pockets, plus an island inside a pocket.
      const blobs = 1 + Math.floor(rand() * 4);
      for (let b = 0; b < blobs; b++) {
        const cx = 5 + rand() * 40, cy = 5 + rand() * 40, rad = 3 + rand() * 9;
        const pocket = rand() < 0.6 ? rad * (0.25 + rand() * 0.3) : 0;
        const island = pocket > 3 && rand() < 0.5 ? pocket * 0.4 : 0;
        for (let r = 0; r < grid.height; r++) for (let c = 0; c < grid.width; c++) {
          const d = Math.hypot(r - cy, c - cx);
          if (d <= rad && (d >= pocket || d <= island)) arrival[r * grid.width + c] = d * 10;
        }
      }
      const res = { arrivalTime: arrival, stats: { burnedAreaHa: 0, spotFires: 0 } } as unknown as SimResult;
      const fc = perimetersToGeoJSON({ grid }, res, { durationSeconds: 1000, timesS: [1000] });
      for (const f of fc.features) {
        for (const poly of ringsOf(f)) {
          poly.forEach((ring, k) => {
            expect(ring[0]).toEqual(ring[ring.length - 1]);
            expect(ring.length).toBeGreaterThanOrEqual(4);
            expect(signedArea(ring) > 0, `seed ${seed} ring ${k}`).toBe(k === 0);
          });
        }
      }
    }
  });
});

describe('probability GeoJSON', () => {
  const s = scenario();
  const ctx = { grid: s.grid, areaName: 'Test area', areaIsSynthetic: false };
  const ens = runEnsemble(s, { ...DEFAULT_ENSEMBLE_SPEC, runs: 40, baseSeed: 3 })!;
  const fc = probabilityToGeoJSON(ctx, ens);

  it('carries the disclaimer and the ensemble summary, with one feature per level', () => {
    expect(fc.disclaimer).toBe(EXPORT_DISCLAIMER);
    expect(fc.properties).toMatchObject({ kind: 'burn-probability', runs: 40, areaIsSynthetic: false });
    expect(fc.features.map((f) => f.properties.probability)).toEqual([0.1, 0.5, 0.9]);
  });

  it('higher-probability lines enclose less area and sit inside the lower ones', () => {
    const areas = fc.features.map((f) => f.properties.areaHa as number);
    expect(areas[0]).toBeGreaterThan(areas[1]);
    expect(areas[1]).toBeGreaterThan(areas[2]);
    // Every vertex of the 90 % line is inside the 50 % region, and every 50 % vertex inside the 10 % region
    // (a vertex on the boundary of the lower one is allowed a small tolerance by nudging it inward).
    const inFeature = (f: GeoJsonFeature, p: Position): boolean => {
      const hit = (ring: Position[]): boolean => {
        let c = false;
        for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
          const [xi, yi] = ring[i], [xj, yj] = ring[j];
          if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) c = !c;
        }
        return c;
      };
      return ringsOf(f).some((poly) => hit(poly[0]) && !poly.slice(1).some(hit));
    };
    for (const [hi, lo] of [[2, 1], [1, 0]] as const) {
      let outside = 0;
      let total = 0;
      for (const poly of ringsOf(fc.features[hi])) {
        // Where both regions touch the grid edge their lines coincide, and a point exactly on a polygon's
        // boundary is ambiguous for ray casting: nudge each vertex 0.1 % of the way to the ring's centroid.
        const ring = poly[0].slice(0, -1);
        const cx = ring.reduce((a, q) => a + q[0], 0) / ring.length;
        const cy = ring.reduce((a, q) => a + q[1], 0) / ring.length;
        for (const [lon, lat] of ring) {
          total++;
          if (!inFeature(fc.features[lo], [lon + (cx - lon) * 1e-3, lat + (cy - lat) * 1e-3])) outside++;
        }
      }
      expect(total).toBeGreaterThan(8);
      expect(outside / total, `level ${hi} inside level ${lo}`).toBeLessThan(0.02);
    }
  });

  it("the 50 % area is close to the area of cells that burned in at least half of the runs", () => {
    let n = 0;
    for (const p of ens.burnProbability) if (p >= 0.5) n++;
    expect(Math.abs((fc.features[1].properties.areaHa as number) / (n * 0.09) - 1)).toBeLessThan(0.12);
  });

  it('earlier times give smaller probability regions, and a level nothing reaches gives no feature', () => {
    const early = probabilityToGeoJSON(ctx, ens, { tSeconds: ens.durationSeconds / 4, levels: [0.5] });
    const late = probabilityToGeoJSON(ctx, ens, { levels: [0.5] });
    expect(early.features[0].properties.areaHa as number).toBeLessThan(late.features[0].properties.areaHa as number);
    expect(early.features[0].properties.tSeconds).toBeCloseTo(ens.durationSeconds / 4, 6);
    expect(probabilityToGeoJSON(ctx, ens, { levels: [1.5] }).features.length).toBe(0);
  });
});
