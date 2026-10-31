import { describe, expect, it } from 'vitest';
import {
  cellCenterLonLat,
  cellFloatToLonLat,
  gridCenter,
  gridSizeMeters,
  lonLatToCell,
  lonLatToCellFloat,
  makeGridSpec,
} from '../src/data/geo';

const grid = makeGridSpec({ centerLon: -122.122, centerLat: 37.126, width: 200, height: 200, cellSizeM: 30 });

describe('geo', () => {
  it('builds a grid of the requested ground size', () => {
    const { widthM, heightM } = gridSizeMeters(grid);
    expect(widthM).toBeCloseTo(6000, 0);
    expect(heightM).toBeCloseTo(6000, 0);
    expect(grid.originLon).toBe(grid.bounds.west);
    expect(grid.originLat).toBe(grid.bounds.north);
    const c = gridCenter(grid);
    expect(c.lon).toBeCloseTo(-122.122, 9);
    expect(c.lat).toBeCloseTo(37.126, 9);
  });

  it('round-trips cell centres within the same cell', () => {
    for (const [row, col] of [[0, 0], [0, 199], [199, 0], [199, 199], [57, 123]]) {
      const ll = cellCenterLonLat(grid, row, col);
      expect(lonLatToCell(grid, ll.lon, ll.lat)).toEqual({ row, col });
    }
  });

  it('round-trips lon/lat to cell and back within one cell', () => {
    const b = grid.bounds;
    for (let k = 0; k < 50; k++) {
      const lon = b.west + ((k * 7919) % 1000) / 1000 * (b.east - b.west);
      const lat = b.south + ((k * 104729) % 1000) / 1000 * (b.north - b.south);
      const { x, y } = lonLatToCellFloat(grid, lon, lat);
      const back = cellFloatToLonLat(grid, x, y);
      expect(back.lon).toBeCloseTo(lon, 9);
      expect(back.lat).toBeCloseTo(lat, 9);
    }
  });

  it('orients row 0 north and col 0 west, and returns null outside', () => {
    const nw = lonLatToCell(grid, grid.bounds.west + 1e-6, grid.bounds.north - 1e-6);
    expect(nw).toEqual({ row: 0, col: 0 });
    const se = lonLatToCell(grid, grid.bounds.east - 1e-6, grid.bounds.south + 1e-6);
    expect(se).toEqual({ row: 199, col: 199 });
    expect(lonLatToCell(grid, grid.bounds.east + 0.01, grid.bounds.north)).toBeNull();
    expect(lonLatToCell(grid, grid.bounds.west, grid.bounds.north + 0.01)).toBeNull();
  });
});
