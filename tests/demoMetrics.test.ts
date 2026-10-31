import { describe, expect, it } from 'vitest';
import type { GridSpec } from '../src/contract';
import { arrivalAtZone, bearingGap, burnedShape, discZone } from '../src/data/demoMetrics';

const W = 60;
const H = 60;
const grid = { width: W, height: H, cellSizeM: 30 } as GridSpec;
const ign = { row: 30, col: 10 };

/** Burned rectangle: rows r0..r1, cols c0..c1 (inclusive), everything else never. */
function rect(r0: number, r1: number, c0: number, c1: number, t = 100): Float32Array {
  const a = new Float32Array(W * H).fill(Infinity);
  for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) a[r * W + c] = t;
  return a;
}

describe('bearingGap', () => {
  it('is the smallest angle between two bearings, across north', () => {
    expect(bearingGap(10, 350)).toBe(20);
    expect(bearingGap(0, 180)).toBe(180);
    expect(bearingGap(90, 270)).toBe(180);
    expect(bearingGap(45, 45)).toBe(0);
    expect(bearingGap(359, 1)).toBe(2);
  });
});

describe('burnedShape', () => {
  it('a strip running east from the ignition: head east, long axis east-west, ahead >> behind, aspect ~ length / width', () => {
    const s = burnedShape(grid, rect(28, 32, 10, 49), ign); // 40 cols x 5 rows
    expect(s.burnedCells).toBe(200);
    expect(s.hectares).toBeCloseTo((200 * 900) / 10_000, 9);
    expect(s.headBearingDeg).toBeCloseTo(90, 5);
    expect(s.axisBearingDeg).toBeCloseTo(90, 5);
    expect(s.aspect).toBeCloseTo((40 * 30) / (5 * 30), 5);
    expect(s.aheadM).toBeCloseTo(39 * 30 + 15, 5); // farthest cell centre is 39 cells on, plus half a cell to its edge
    expect(s.behindM).toBeCloseTo(15, 5); // half a cell behind the ignition cell centre
    expect(s.elongation).toBeGreaterThan(2.5);
  });

  it('the same strip running north gives a north head and a north-south axis (row 0 is north)', () => {
    const s = burnedShape(grid, rect(0, 30, 8, 12), ign);
    expect(s.headBearingDeg).toBeCloseTo(0, 5);
    expect(s.axisBearingDeg).toBeCloseTo(0, 5);
    expect(s.centroidNorthM).toBeGreaterThan(0);
    expect(Math.abs(s.centroidEastM)).toBeLessThan(1e-6);
  });

  it('a strip running south-west gives a south-west head', () => {
    const a = new Float32Array(W * H).fill(Infinity);
    for (let k = 0; k <= 15; k++) for (const d of [0, 1]) a[(30 + k) * W + (30 - k + d)] = 1;
    const s = burnedShape(grid, a, { row: 30, col: 30 });
    expect(bearingGap(s.headBearingDeg, 225)).toBeLessThan(3); // the 2-wide strip puts the centroid half a cell off the diagonal
    expect(bearingGap(s.axisBearingDeg, 45)).toBeLessThan(2); // the axis is the same line, either end
  });

  it('a filled disc is round: aspect ~1, elongation ~1, same reach ahead and behind', () => {
    const a = new Float32Array(W * H).fill(Infinity);
    for (const i of discZone(grid, { row: 30, col: 30 }, 10).cells) a[i] = 5;
    const s = burnedShape(grid, a, { row: 30, col: 30 });
    expect(s.elongation).toBeLessThan(1.05);
    expect(s.aspect).toBeLessThan(1.15);
  });

  it('honours the time limit and handles nothing burned', () => {
    const a = rect(28, 32, 10, 49);
    for (let c = 30; c <= 49; c++) for (let r = 28; r <= 32; r++) a[r * W + c] = 500; // later part
    expect(burnedShape(grid, a, ign, 100).burnedCells).toBe(100);
    expect(burnedShape(grid, a, ign, 600).burnedCells).toBe(200);
    const none = burnedShape(grid, new Float32Array(W * H).fill(Infinity), ign);
    expect(none.burnedCells).toBe(0);
    expect(Number.isNaN(none.headBearingDeg)).toBe(true);
  });
});

describe('zones', () => {
  it('discZone is a clipped disc of the right size', () => {
    const z = discZone(grid, { row: 30, col: 30 }, 5);
    expect(z.cells.length).toBeGreaterThan(70);
    expect(z.cells.length).toBeLessThan(90);
    expect(z.cells).toContain(30 * W + 30);
    const corner = discZone(grid, { row: 0, col: 0 }, 5);
    expect(corner.cells.every((i) => i >= 0 && i < W * H)).toBe(true);
    expect(corner.cells.length).toBeLessThan(z.cells.length);
  });

  it('arrivalAtZone is the earliest arrival over the zone, or Infinity if never reached', () => {
    const a = new Float32Array(W * H).fill(Infinity);
    const z = discZone(grid, { row: 30, col: 30 }, 4);
    expect(arrivalAtZone(a, z)).toBe(Infinity);
    a[z.cells[3]] = 700;
    a[z.cells[7]] = 300;
    a[0] = 1; // outside the zone: ignored
    expect(arrivalAtZone(a, z)).toBe(300);
  });
});
