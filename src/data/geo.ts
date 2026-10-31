/**
 * THE ONLY lat/lon <-> grid conversion in the app. Everything else calls these.
 *
 * The grid is equirectangular: its bounds are a lon/lat rectangle and cells map linearly to it.
 * Metres per degree are evaluated once, at the grid's centre latitude, when the GridSpec is made.
 * Over a 6 km box the distortion is negligible for a demo. Row 0 = north, col 0 = west.
 */

import { DEFAULT_CELL_SIZE_M, DEFAULT_GRID_HEIGHT, DEFAULT_GRID_WIDTH, inGrid } from '../contract';
import type { CellRef, GridSpec } from '../contract';

export interface LonLat {
  lon: number;
  lat: number;
}

export const METERS_PER_DEG_LAT = 111_320;

export function metersPerDegLon(latDeg: number): number {
  return METERS_PER_DEG_LAT * Math.cos((latDeg * Math.PI) / 180);
}

export interface MakeGridOptions {
  centerLon: number;
  centerLat: number;
  width?: number;
  height?: number;
  cellSizeM?: number;
}

/** Builds a GridSpec centred on a point. */
export function makeGridSpec(o: MakeGridOptions): GridSpec {
  const width = o.width ?? DEFAULT_GRID_WIDTH;
  const height = o.height ?? DEFAULT_GRID_HEIGHT;
  const cellSizeM = o.cellSizeM ?? DEFAULT_CELL_SIZE_M;
  const halfHDeg = (height * cellSizeM) / 2 / METERS_PER_DEG_LAT;
  const halfWDeg = (width * cellSizeM) / 2 / metersPerDegLon(o.centerLat);
  const bounds = {
    west: o.centerLon - halfWDeg,
    east: o.centerLon + halfWDeg,
    north: o.centerLat + halfHDeg,
    south: o.centerLat - halfHDeg,
  };
  return { width, height, cellSizeM, originLon: bounds.west, originLat: bounds.north, bounds };
}

export function gridCenter(grid: GridSpec): LonLat {
  const b = grid.bounds;
  return { lon: (b.west + b.east) / 2, lat: (b.north + b.south) / 2 };
}

/** Fractional cell coordinates: x along columns (east), y along rows (south). May be outside the grid. */
export function lonLatToCellFloat(grid: GridSpec, lon: number, lat: number): { x: number; y: number } {
  const b = grid.bounds;
  return {
    x: ((lon - b.west) / (b.east - b.west)) * grid.width,
    y: ((b.north - lat) / (b.north - b.south)) * grid.height,
  };
}

/** Integer cell containing the point, or null if outside the grid. */
export function lonLatToCell(grid: GridSpec, lon: number, lat: number): CellRef | null {
  const { x, y } = lonLatToCellFloat(grid, lon, lat);
  const row = Math.floor(y);
  const col = Math.floor(x);
  return inGrid(grid, row, col) ? { row, col } : null;
}

export function lonLatToCellIndex(grid: GridSpec, lon: number, lat: number): number | null {
  const c = lonLatToCell(grid, lon, lat);
  return c ? c.row * grid.width + c.col : null;
}

/** Lon/lat of a fractional cell position (x = col, y = row). (0,0) is the NW corner of cell (0,0). */
export function cellFloatToLonLat(grid: GridSpec, x: number, y: number): LonLat {
  const b = grid.bounds;
  return {
    lon: b.west + (x / grid.width) * (b.east - b.west),
    lat: b.north - (y / grid.height) * (b.north - b.south),
  };
}

export function cellCenterLonLat(grid: GridSpec, row: number, col: number): LonLat {
  return cellFloatToLonLat(grid, col + 0.5, row + 0.5);
}

/** Ground size of the grid in metres (at the centre latitude). */
export function gridSizeMeters(grid: GridSpec): { widthM: number; heightM: number } {
  const b = grid.bounds;
  const lat = (b.north + b.south) / 2;
  return {
    widthM: (b.east - b.west) * metersPerDegLon(lat),
    heightM: (b.north - b.south) * METERS_PER_DEG_LAT,
  };
}
