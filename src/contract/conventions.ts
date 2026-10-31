/**
 * FROZEN shared contract. Do not edit without telling the team in chat.
 *
 * Conventions every module relies on. Read this before touching grids, wind or time.
 *
 * GRID
 * - Cells are square, DEFAULT_CELL_SIZE_M metres on a side (30 m). Default grid 200 x 200
 *   (6 km x 6 km). Hard cap MAX_GRID_DIM per side.
 * - Flat row-major typed arrays. index = row * width + col.
 * - Row 0 is the NORTH edge. Column 0 is the WEST edge. Row increases southward.
 * - Lat/lon <-> cell conversion uses a local equirectangular approximation (metres per degree
 *   at the grid's centre latitude). It lives ONLY in src/data/geo.ts.
 *
 * UNITS (SI everywhere inside the app; the UI converts at the edge)
 * - metres, seconds, m/s, degrees Celsius, relative humidity 0-1, fuel moisture 0-1.
 *
 * WIND (classic bug source)
 * - Weather.windFromDeg is the direction the wind blows FROM, degrees clockwise from north.
 *   270 = wind from the west, pushing the fire EAST. Use windTowardDeg() to get the push
 *   direction. Never pass a "toward" angle into Weather.
 *
 * TIME
 * - Simulated seconds since ignition. Interventions carry tSeconds and are applied when the
 *   simulation clock reaches them. The sim always re-runs from t = 0.
 *
 * SENTINELS
 * - FuelClass.NONE (0) means non-burnable and also "no data".
 * - SimResult.arrivalTime: NEVER_ARRIVES (Infinity) means the cell never ignites.
 * - Elevation: ELEVATION_NODATA (-9999) is used by builders for missing samples and MUST be
 *   filled before a Scenario is created. The validator rejects it.
 */

import type { CellRef, GridSpec } from './types';

export const DEFAULT_CELL_SIZE_M = 30;
export const DEFAULT_GRID_WIDTH = 200;
export const DEFAULT_GRID_HEIGHT = 200;
export const MAX_GRID_DIM = 300;

export const NEVER_ARRIVES = Infinity;
export const ELEVATION_NODATA = -9999;

export const CONTRACT_VERSION = 1;

export function cellIndex(row: number, col: number, width: number): number {
  return row * width + col;
}

export function cellRowCol(index: number, width: number): CellRef {
  return { row: Math.floor(index / width), col: index % width };
}

export function inGrid(grid: GridSpec, row: number, col: number): boolean {
  return row >= 0 && col >= 0 && row < grid.height && col < grid.width;
}

/** Direction the wind pushes the fire toward, degrees clockwise from north. */
export function windTowardDeg(windFromDeg: number): number {
  return (((windFromDeg + 180) % 360) + 360) % 360;
}

/** Hectares covered by one cell. */
export function cellAreaHa(grid: GridSpec): number {
  return (grid.cellSizeM * grid.cellSizeM) / 10_000;
}
