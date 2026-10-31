import { describe, expect, it } from 'vitest';
import { discCells, lineCells, rasterizeLine, rasterizePolygon } from '../src/data/raster';

const W = 20;
const H = 20;

function count(a: Uint8Array, v: number): number {
  let n = 0;
  for (const x of a) if (x === v) n++;
  return n;
}

describe('rasterizePolygon', () => {
  it('fills an axis-aligned square exactly', () => {
    const t = new Uint8Array(W * H);
    const n = rasterizePolygon(t, W, H, [[[2, 3], [8, 3], [8, 7], [2, 7]]], 1);
    expect(n).toBe(6 * 4);
    expect(count(t, 1)).toBe(24);
    expect(t[3 * W + 2]).toBe(1);
    expect(t[6 * W + 7]).toBe(1);
    expect(t[7 * W + 2]).toBe(0);
    expect(t[3 * W + 8]).toBe(0);
  });

  it('respects holes with even-odd filling', () => {
    const t = new Uint8Array(W * H);
    const outer = [[0, 0], [10, 0], [10, 10], [0, 10]] as const;
    const hole = [[3, 3], [7, 3], [7, 7], [3, 7]] as const;
    rasterizePolygon(t, W, H, [[...outer], [...hole]], 1);
    expect(count(t, 1)).toBe(100 - 16);
    expect(t[5 * W + 5]).toBe(0);
  });

  it('clips to the grid', () => {
    const t = new Uint8Array(W * H);
    rasterizePolygon(t, W, H, [[[-5, -5], [5, -5], [5, 5], [-5, 5]]], 1);
    expect(count(t, 1)).toBe(25);
  });
});

describe('lineCells', () => {
  it('a horizontal line of width 1 covers exactly the cells it crosses', () => {
    const cells = lineCells(W, H, [[0.5, 4.5], [9.5, 4.5]]);
    expect(cells.length).toBe(10);
    for (const i of cells) expect(Math.floor(i / W)).toBe(4);
  });

  it('a diagonal line is 4-connected (every step shares an edge)', () => {
    const cells = lineCells(W, H, [[0.5, 0.5], [12.5, 9.5]]);
    const set = new Set(cells);
    expect(set.has(0)).toBe(true);
    expect(set.has(9 * W + 12)).toBe(true);
    // Each cell must have a 4-neighbour in the set (except possibly endpoints).
    let orphans = 0;
    for (const i of cells) {
      const r = Math.floor(i / W);
      const c = i % W;
      const ok = set.has(i - 1) || set.has(i + 1) || set.has(i - W) || set.has(i + W);
      if (!ok) orphans++;
      expect(r).toBeLessThanOrEqual(9);
      expect(c).toBeLessThanOrEqual(12);
    }
    expect(orphans).toBe(0);
    // No diagonal-only steps: a path of 13 cols x 10 rows must have at least 13 + 10 - 1 cells.
    expect(cells.length).toBeGreaterThanOrEqual(22);
  });

  it('wider lines stamp a swath', () => {
    const one = lineCells(W, H, [[2.5, 10.5], [17.5, 10.5]], 1).length;
    const three = lineCells(W, H, [[2.5, 10.5], [17.5, 10.5]], 3).length;
    expect(three).toBeGreaterThan(one * 2.5);
    const t = new Uint8Array(W * H);
    rasterizeLine(t, W, H, [[2.5, 10.5], [17.5, 10.5]], 1, 3);
    expect(t[9 * W + 10]).toBe(1);
    expect(t[11 * W + 10]).toBe(1);
    expect(t[12 * W + 10]).toBe(0);
  });
});

describe('discCells', () => {
  it('returns roughly pi r^2 cells and clips at the border', () => {
    const n = discCells(W, H, 10, 10, 4).length;
    expect(n).toBeGreaterThan(40);
    expect(n).toBeLessThan(60);
    expect(discCells(W, H, 0, 0, 3).length).toBeLessThan(n / 3);
  });
});
