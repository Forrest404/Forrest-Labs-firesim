/** Numbers for the response: homes reached, vegetation cleared. Pure, worker-safe. */

import type { GridSpec } from '../contract';
import { CLEAR_WEIGHT } from './units';
import type { FuelClass } from '../contract';

/**
 * Homes are non-burnable cells, so a home counts as reached when fire arrives in its cell or any
 * of the 8 cells around it (the lot) by time t. Same rule as src/app/impact.ts on feature/yariel.
 */
export function homesReached(arrival: Float32Array, homes: Uint16Array, grid: GridSpec, t: number): number {
  const { width: W, height: H } = grid;
  let reached = 0;
  for (let i = 0; i < homes.length; i++) {
    if (!homes[i]) continue;
    const r = (i / W) | 0;
    const c = i - r * W;
    let hit = false;
    for (let dr = -1; dr <= 1 && !hit; dr++) {
      const rr = r + dr;
      if (rr < 0 || rr >= H) continue;
      for (let dc = -1; dc <= 1; dc++) {
        const cc = c + dc;
        if (cc >= 0 && cc < W && arrival[rr * W + cc] <= t) {
          hit = true;
          break;
        }
      }
    }
    if (hit) reached += homes[i];
  }
  return reached;
}

export function totalHomes(homes: Uint16Array): number {
  let n = 0;
  for (const h of homes) n += h;
  return n;
}

/** Hectares of vegetation a firebreak through `cells` removes (weighted by fuel class). */
export function clearedHaOf(cells: number[], fuel: Uint8Array, cellHa: number): number {
  let ha = 0;
  for (const c of cells) ha += CLEAR_WEIGHT[fuel[c] as FuelClass] * cellHa;
  return ha;
}

/** True when a home lies within `clearance` cells (Chebyshev) of cell `i`; clearance 0 checks the cell itself. */
export function nearHome(homes: Uint16Array | null, grid: GridSpec, i: number, clearance: number): boolean {
  if (!homes) return false;
  if (clearance <= 0) return homes[i] > 0;
  const { width: W, height: H } = grid;
  const r = (i / W) | 0;
  const c = i - r * W;
  for (let dr = -clearance; dr <= clearance; dr++) {
    const rr = r + dr;
    if (rr < 0 || rr >= H) continue;
    for (let dc = -clearance; dc <= clearance; dc++) {
      const cc = c + dc;
      if (cc >= 0 && cc < W && homes[rr * W + cc] > 0) return true;
    }
  }
  return false;
}
