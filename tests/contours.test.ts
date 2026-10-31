import { describe, expect, it } from 'vitest';
import { contourPolygons, contourRings, pointInRing, polygonArea, ringArea, ringLength, ringsToPolygons } from '../src/data/contours';
import type { Pt } from '../src/data/contours';
import { mulberry32 } from '../src/sim/prng';

const field = (w: number, h: number, f: (r: number, c: number) => number): Float32Array => {
  const v = new Float32Array(w * h);
  for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) v[r * w + c] = f(r, c);
  return v;
};
const totalArea = (polys: ReturnType<typeof contourPolygons>): number => polys.reduce((s, p) => s + polygonArea(p), 0);
const closeTo = (a: Pt, b: Pt, e = 1e-9): boolean => Math.abs(a[0] - b[0]) < e && Math.abs(a[1] - b[1]) < e;

describe('geometry helpers', () => {
  it('ring area, length and point-in-ring on a unit square', () => {
    const sq: Pt[] = [[0, 0], [1, 0], [1, 1], [0, 1]];
    expect(ringArea(sq)).toBeCloseTo(1, 12);
    expect(ringArea([...sq].reverse())).toBeCloseTo(-1, 12);
    expect(ringLength(sq)).toBeCloseTo(4, 12);
    expect(pointInRing([0.5, 0.5], sq)).toBe(true);
    expect(pointInRing([1.5, 0.5], sq)).toBe(false);
    expect(pointInRing([-0.1, 0.5], sq)).toBe(false);
  });
});

describe('contouring known shapes', () => {
  const INF = Infinity;

  it('a single burned cell is a diamond around its centre (area half a cell)', () => {
    const v = field(5, 5, (r, c) => (r === 2 && c === 2 ? 0 : INF));
    const polys = contourPolygons(v, 5, 5, 100, 'below');
    expect(polys.length).toBe(1);
    expect(polys[0].holes.length).toBe(0);
    const ring = polys[0].outer;
    expect(ring.length).toBe(4);
    for (const [x, y] of ring) expect(Math.abs(x - 2.5) + Math.abs(y - 2.5)).toBeCloseTo(0.5, 12);
    expect(polygonArea(polys[0])).toBeCloseTo(0.5, 12);
  });

  it('nothing inside gives no polygons; everything inside gives the whole grid with its four corners clipped', () => {
    expect(contourPolygons(field(6, 4, () => INF), 6, 4, 10).length).toBe(0);
    expect(contourPolygons(field(6, 4, () => 0), 6, 4, -1).length).toBe(0); // level below every value
    const all = contourPolygons(field(6, 4, () => 0), 6, 4, 10);
    expect(all.length).toBe(1);
    // Marching squares cuts each grid corner diagonally: 4 corners x 1/8 of a cell = 0.5.
    expect(polygonArea(all[0])).toBeCloseTo(24 - 0.5, 9);
    const xs = all[0].outer.map((p) => p[0]);
    const ys = all[0].outer.map((p) => p[1]);
    expect(Math.min(...xs)).toBeCloseTo(0, 9);
    expect(Math.max(...xs)).toBeCloseTo(6, 9);
    expect(Math.min(...ys)).toBeCloseTo(0, 9);
    expect(Math.max(...ys)).toBeCloseTo(4, 9);
  });

  it('a distance field gives a circle: radius, area and roundness', () => {
    const W = 81;
    const cx = 40.5;
    const v = field(W, W, (r, c) => Math.hypot(r + 0.5 - cx, c + 0.5 - cx));
    for (const L of [8, 15, 30]) {
      const polys = contourPolygons(v, W, W, L, 'below');
      expect(polys.length).toBe(1);
      expect(polys[0].holes.length).toBe(0);
      let worst = 0;
      for (const [x, y] of polys[0].outer) worst = Math.max(worst, Math.abs(Math.hypot(x - cx, y - cx) - L) / L);
      expect(worst, `level ${L}`).toBeLessThan(0.02);
      expect(Math.abs(polygonArea(polys[0]) / (Math.PI * L * L) - 1)).toBeLessThan(0.02);
    }
  });

  it('an unburned pocket inside the fire becomes a hole, and the area is outer minus hole', () => {
    const v = field(20, 20, (r, c) => (r >= 6 && r <= 13 && c >= 6 && c <= 13 && !(r >= 9 && r <= 10 && c >= 9 && c <= 10) ? 0 : INF));
    const polys = contourPolygons(v, 20, 20, 5, 'below');
    expect(polys.length).toBe(1);
    expect(polys[0].holes.length).toBe(1);
    expect(Math.abs(ringArea(polys[0].outer))).toBeGreaterThan(Math.abs(ringArea(polys[0].holes[0])));
    // 64 cells inside minus 4 in the hole; the contour area is within the staircase error of that.
    expect(Math.abs(polygonArea(polys[0]) - 60) / 60).toBeLessThan(0.12);
    expect(pointInRing(polys[0].holes[0][0], polys[0].outer)).toBe(true);
  });

  it('an island inside a hole is its own polygon (nesting depth 2)', () => {
    const v = field(31, 31, (r, c) => {
      const d = Math.max(Math.abs(r - 15), Math.abs(c - 15));
      return d <= 4 || (d >= 8 && d <= 12) ? 0 : INF;
    });
    const polys = contourPolygons(v, 31, 31, 5, 'below');
    expect(polys.length).toBe(2); // the outer band (with the gap as a hole) and the central island
    expect(polys.filter((p) => p.holes.length === 1).length).toBe(1);
    expect(polys.filter((p) => p.holes.length === 0).length).toBe(1);
  });

  it('two separate fires are two polygons', () => {
    const v = field(30, 10, (r, c) => (c < 8 || c > 21 ? (r >= 3 && r <= 6 ? 0 : INF) : INF));
    const polys = contourPolygons(v, 30, 10, 1, 'below');
    expect(polys.length).toBe(2);
    expect(polys[0].outer.every((p) => p[0] < 15) !== polys[1].outer.every((p) => p[0] < 15)).toBe(true);
  });

  it('a fire touching the grid edge is closed along the boundary, half a cell out', () => {
    const v = field(10, 10, (r, c) => (r <= 3 && c <= 3 ? 0 : INF));
    const polys = contourPolygons(v, 10, 10, 1, 'below');
    expect(polys.length).toBe(1);
    const xs = polys[0].outer.map((p) => p[0]);
    const ys = polys[0].outer.map((p) => p[1]);
    expect(Math.min(...xs)).toBeCloseTo(0, 9);
    expect(Math.min(...ys)).toBeCloseTo(0, 9);
    expect(Math.max(...xs)).toBeCloseTo(4.0, 9); // midway between the last burned centre (3.5) and the next (4.5)
  });

  it("'above' mode: a probability bump contoured at 0.5 is the region where p >= 0.5", () => {
    const v = field(40, 40, (r, c) => Math.max(0, 1 - Math.hypot(r - 19.5, c - 19.5) / 15));
    const polys = contourPolygons(v, 40, 40, 0.5, 'above');
    expect(polys.length).toBe(1);
    let worst = 0;
    for (const [x, y] of polys[0].outer) worst = Math.max(worst, Math.abs(Math.hypot(x - 20, y - 20) - 7.5));
    expect(worst).toBeLessThan(0.3);
    // Higher levels are inside lower ones.
    const inner = contourPolygons(v, 40, 40, 0.8, 'above');
    const outer = contourPolygons(v, 40, 40, 0.2, 'above');
    expect(totalArea(inner)).toBeLessThan(totalArea(polys));
    expect(totalArea(polys)).toBeLessThan(totalArea(outer));
    expect(pointInRing(inner[0].outer[0], polys[0].outer)).toBe(true);
  });

  it('crossings are linearly interpolated between samples, not just snapped to midpoints', () => {
    // A ramp along x: value = x. The level 2.25 must cross between the samples at 2 and 3 at x = 2.25.
    const v = field(8, 3, (_, c) => c);
    const rings = contourRings(v, 8, 3, 2.25, 'below');
    // The contour's vertical run: vertices in the interior rows (y = 0.5, 1.5, 2.5), not on the padded border.
    const run = rings[0].filter(([x, y]) => y > 0.1 && y < 2.9 && x > 2.6 && x < 4);
    expect(run.length).toBe(3);
    // Sample c sits at x = c + 0.5, so the crossing of value 2.25 is a quarter of the way from c = 2 to c = 3.
    for (const [x] of run) expect(x).toBeCloseTo(2.5 + 0.25, 9);
  });
});

describe('robustness', () => {
  it('saddles: a checkerboard of burned and unburned cells never produces dangling or crossing lines', () => {
    const v = field(8, 8, (r, c) => ((r + c) % 2 === 0 ? 0 : Infinity));
    const rings = contourRings(v, 8, 8, 1, 'below');
    expect(rings.length).toBeGreaterThan(0);
    for (const ring of rings) {
      expect(ring.length).toBeGreaterThanOrEqual(3);
      for (const [x, y] of ring) {
        expect(Number.isFinite(x) && Number.isFinite(y)).toBe(true);
      }
    }
    // Each isolated burned cell is its own diamond (the infinite neighbours keep corners apart).
    expect(ringsToPolygons(rings).length).toBe(32);
  });

  it('saddle resolved by the centre value: finite saddle joins or separates the diagonal corners', () => {
    // 2x2 block, TL and BR low (inside), TR and BL high (outside). Centre average decides.
    const joined = new Float32Array([0, 10, 10, 0]); // avg 5 <= 6 -> centre inside -> one ring
    const split = new Float32Array([0, 10, 10, 0]);
    expect(contourRings(joined, 2, 2, 6, 'below').length).toBe(1);
    expect(contourRings(split, 2, 2, 4, 'below').length).toBe(2); // avg 5 > 4 -> two separate rings
  });

  it('fuzz: random fields always give closed, finite rings that nest into valid polygons, and NaN is outside', () => {
    for (let seed = 1; seed <= 150; seed++) {
      const rand = mulberry32(seed);
      const W = 3 + Math.floor(rand() * 18);
      const H = 3 + Math.floor(rand() * 18);
      const v = field(W, H, () => (rand() < 0.15 ? Infinity : rand() < 0.05 ? NaN : rand() * 10));
      const level = 1 + rand() * 8;
      const rings = contourRings(v, W, H, level, rand() < 0.5 ? 'below' : 'above');
      for (const ring of rings) {
        expect(ring.length).toBeGreaterThanOrEqual(3);
        for (const [x, y] of ring) {
          expect(Number.isFinite(x) && Number.isFinite(y)).toBe(true);
          expect(x).toBeGreaterThanOrEqual(-0.5 - 1e-9);
          expect(x).toBeLessThanOrEqual(W + 0.5 + 1e-9);
          expect(y).toBeGreaterThanOrEqual(-0.5 - 1e-9);
          expect(y).toBeLessThanOrEqual(H + 0.5 + 1e-9);
        }
        for (let i = 0; i < ring.length; i++) expect(closeTo(ring[i], ring[(i + 1) % ring.length])).toBe(false); // no repeated points
        expect(Math.abs(ringArea(ring))).toBeGreaterThan(0);
      }
      const polys = ringsToPolygons(rings);
      let inner = 0;
      for (const p of polys) {
        inner += p.holes.length;
        expect(polygonArea(p)).toBeGreaterThan(0);
        for (const h of p.holes) expect(Math.abs(ringArea(h))).toBeLessThan(Math.abs(ringArea(p.outer)));
      }
      expect(polys.length + inner).toBe(rings.length);
    }
  });

  it('the total contoured area tracks the number of inside samples (within the staircase error), over random blobs', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const rand = mulberry32(seed + 500);
      const W = 40, H = 40;
      const cx = 10 + rand() * 20, cy = 10 + rand() * 20, rad = 4 + rand() * 8;
      const v = field(W, H, (r, c) => Math.hypot(r - cy, c - cx));
      let inside = 0;
      for (const x of v) if (x <= rad) inside++;
      const area = totalArea(contourPolygons(v, W, H, rad, 'below'));
      expect(Math.abs(area / inside - 1), `seed ${seed}`).toBeLessThan(0.1);
    }
  });

  it('is deterministic', () => {
    const v = field(25, 25, (r, c) => Math.hypot(r - 12, c - 12));
    const a = JSON.stringify(contourPolygons(v, 25, 25, 7.3));
    expect(JSON.stringify(contourPolygons(v, 25, 25, 7.3))).toBe(a);
  });
});
