/**
 * "Firebreak (clear trees)": a dragged polyline becomes a swath of cells whose fuel is set to
 * NONE from tSeconds on. Pure; cell-space input (x along columns, y along rows).
 */

import type { GridSpec, Intervention } from '../contract';
import { lineCells } from '../data/raster';
import type { Pt } from '../data/raster';

export const FIREBREAK_WIDTH_MIN = 1;
export const FIREBREAK_WIDTH_MAX = 7;
export const FIREBREAK_WIDTH_DEFAULT = 3;

export function firebreakCells(grid: GridSpec, points: Pt[], widthCells: number): number[] {
  const w = Math.max(FIREBREAK_WIDTH_MIN, Math.min(FIREBREAK_WIDTH_MAX, Math.round(widthCells)));
  return lineCells(grid.width, grid.height, points, w);
}

export function makeFirebreak(grid: GridSpec, points: Pt[], widthCells: number, tSeconds: number, id: string): Intervention | null {
  const cells = firebreakCells(grid, points, widthCells);
  if (cells.length === 0) return null;
  return {
    id,
    tSeconds: Math.max(0, tSeconds),
    type: 'firebreak',
    cells,
    params: { widthCells },
    label: `Firebreak, ${cells.length} cells`,
  };
}
