/**
 * Default ignition for an area that does not carry a suggested one: the burnable cell nearest the
 * grid centre, preferring forest and shrub so the first run looks like a wildfire.
 */

import { FuelClass } from '../contract';
import type { CellRef } from '../contract';
import type { DemoArea } from './bundle';

const PREFERRED = new Set<number>([FuelClass.FOREST_CONIFER, FuelClass.FOREST_DECIDUOUS, FuelClass.SHRUB]);

export function defaultIgnition(area: DemoArea): CellRef | null {
  if (area.meta.suggestedIgnition) return area.meta.suggestedIgnition;
  const { width: W, height: H } = area.grid;
  const fuel = area.fuel;
  const row0 = H >> 1;
  const col0 = W >> 1;
  let fallback: CellRef | null = null;
  for (let radius = 0; radius < Math.max(W, H); radius++) {
    for (let dr = -radius; dr <= radius; dr++) {
      for (let dc = -radius; dc <= radius; dc++) {
        if (Math.max(Math.abs(dr), Math.abs(dc)) !== radius) continue;
        const r = row0 + dr;
        const c = col0 + dc;
        if (r < 0 || c < 0 || r >= H || c >= W) continue;
        const f = fuel[r * W + c];
        if (f === FuelClass.NONE) continue;
        if (PREFERRED.has(f) && hasBurnableNeighbourhood(fuel, W, H, r, c)) return { row: r, col: c };
        if (!fallback) fallback = { row: r, col: c };
      }
    }
    // Do not wander too far from the centre looking for forest; any burnable cell will do.
    if (radius > 40 && fallback) return fallback;
  }
  return fallback;
}

/** At least 6 of the 8 neighbours burnable, so the fire has somewhere to go. */
function hasBurnableNeighbourhood(fuel: Uint8Array, W: number, H: number, r: number, c: number): boolean {
  let n = 0;
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      if (!dr && !dc) continue;
      const rr = r + dr;
      const cc = c + dc;
      if (rr < 0 || cc < 0 || rr >= H || cc >= W) continue;
      if (fuel[rr * W + cc] !== FuelClass.NONE) n++;
    }
  }
  return n >= 6;
}
