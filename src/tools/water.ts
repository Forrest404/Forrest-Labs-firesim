/**
 * Water spray: a click or dragged brush raises fuel moisture in the covered cells at tSeconds,
 * decaying back with the configured half-life (see src/sim/events.ts). Pure; cell-space input.
 */

import type { GridSpec, Intervention } from '../contract';
import { lineCells } from '../data/raster';
import type { Pt } from '../data/raster';

export const WATER_RADIUS_MIN = 1;
export const WATER_RADIUS_MAX = 8;
export const WATER_RADIUS_DEFAULT = 3;

export function waterCells(grid: GridSpec, points: Pt[], radiusCells: number): number[] {
  const r = Math.max(WATER_RADIUS_MIN, Math.min(WATER_RADIUS_MAX, Math.round(radiusCells)));
  return lineCells(grid.width, grid.height, points, 2 * r + 1);
}

export function makeWater(
  grid: GridSpec,
  points: Pt[],
  radiusCells: number,
  tSeconds: number,
  id: string,
  params: { moistureBoost?: number; halfLifeS?: number } = {},
): Intervention | null {
  const cells = waterCells(grid, points, radiusCells);
  if (cells.length === 0) return null;
  return {
    id,
    tSeconds: Math.max(0, tSeconds),
    type: 'water',
    cells,
    params: { radiusCells, ...params },
    label: `Water spray, ${cells.length} cells`,
  };
}
