import { describe, expect, it } from 'vitest';
import { FuelClass } from '../src/contract';
import { simulate } from '../src/sim';
import { InterventionHistory } from '../src/tools/history';
import { firebreakCells, makeFirebreak } from '../src/tools/firebreak';
import { makeWater, waterCells } from '../src/tools/water';
import { FIX_W, countBurned, idx, makeFixture } from './fixtures';

const grid = makeFixture().grid;

describe('firebreak rasterization', () => {
  it('a horizontal line of width 1 returns exactly the crossed cells', () => {
    const cells = firebreakCells(grid, [[2.5, 10.5], [12.5, 10.5]], 1);
    expect(cells).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((c) => idx(10, c)));
  });

  it('width 3 covers the row above and below', () => {
    const cells = new Set(firebreakCells(grid, [[2.5, 10.5], [12.5, 10.5]], 3));
    for (let c = 2; c <= 12; c++) {
      expect(cells.has(idx(9, c))).toBe(true);
      expect(cells.has(idx(10, c))).toBe(true);
      expect(cells.has(idx(11, c))).toBe(true);
      expect(cells.has(idx(12, c))).toBe(false);
    }
  });

  it('clamps width and builds a labelled intervention at the given time', () => {
    const iv = makeFirebreak(grid, [[0.5, 0.5], [5.5, 0.5]], 99, 1200, 'fb1');
    expect(iv?.type).toBe('firebreak');
    expect(iv?.tSeconds).toBe(1200);
    expect(iv?.cells.length).toBeGreaterThan(6);
    expect(makeFirebreak(grid, [[-10, -10]], 1, 0, 'x')).toBeNull();
  });

  it('a spanning firebreak drawn by the tool actually stops the simulated fire', () => {
    const s = makeFixture({ road: false, weather: { windSpeedMps: 10, windFromDeg: 180 } });
    const iv = makeFirebreak(s.grid, [[0, 20.5], [FIX_W, 20.5]], 3, 0, 'fb');
    const r = simulate({ ...s, interventions: [iv!] });
    for (let c = 0; c < FIX_W; c++) expect(r.arrivalTime[idx(15, c)]).toBe(Infinity);
    expect(countBurned(r.arrivalTime)).toBeGreaterThan(100);
  });
});

describe('water brush', () => {
  it('a single click covers a disc of about pi r^2 cells', () => {
    const cells = waterCells(grid, [[25.5, 25.5]], 3);
    expect(cells.length).toBeGreaterThan(28);
    expect(cells.length).toBeLessThan(50);
    expect(cells).toContain(idx(25, 25));
    expect(cells).toContain(idx(22, 25));
    expect(cells).not.toContain(idx(21, 25));
  });

  it('carries custom half-life params', () => {
    const iv = makeWater(grid, [[10, 10]], 2, 60, 'w1', { halfLifeS: 900 });
    expect(iv?.type).toBe('water');
    expect(iv?.params?.halfLifeS).toBe(900);
    expect(iv?.params?.radiusCells).toBe(2);
  });
});

describe('history', () => {
  it('undo and redo walk the snapshots', () => {
    const h = new InterventionHistory([]);
    const a = [{ id: 'a', tSeconds: 0, type: 'firebreak' as const, cells: [1] }];
    const b = [...a, { id: 'b', tSeconds: 0, type: 'water' as const, cells: [2] }];
    h.push(a);
    h.push(b);
    expect(h.current).toBe(b);
    expect(h.undo()).toBe(a);
    expect(h.undo()).toEqual([]);
    expect(h.undo()).toBeNull();
    expect(h.redo()).toBe(a);
    h.push([]);
    expect(h.canRedo).toBe(false);
    expect(h.canUndo).toBe(true);
  });
});

describe('fixture sanity for tools', () => {
  it('fixture river cells are NONE', () => {
    expect(grid.width).toBe(FIX_W);
    expect(makeFixture().fuel[idx(0, 40)]).toBe(FuelClass.NONE);
  });
});
