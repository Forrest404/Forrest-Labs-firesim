/**
 * Numbers people feel: homes reached by the fire, and how a run compares with a real fire.
 * Pure; reads only a SimResult and the area's optional layers.
 */

import type { GridSpec, SimResult } from '../contract';
import type { ReferenceFire } from '../data/bundle';

/**
 * Buildings are non-burnable cells, so a home counts as reached when fire arrives in its cell or
 * any of the 8 cells around it (the lot) by time t.
 */
export function homesReached(result: SimResult, homes: Uint16Array, grid: GridSpec, t: number): number {
  const { width: W, height: H } = grid;
  const arr = result.arrivalTime;
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
        if (cc >= 0 && cc < W && arr[rr * W + cc] <= t) {
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

export interface Overlap {
  /** Intersection over union of burned cells and the real perimeter, 0-1. */
  iou: number;
  /** Share of the real burned area the simulation also burned, 0-1. */
  covered: number;
  /** Simulated time at which the comparison was taken, seconds. */
  t: number;
}

function overlapOf(burned: (i: number) => boolean, mask: Uint8Array): { iou: number; covered: number } {
  let inter = 0;
  let union = 0;
  let real = 0;
  for (let i = 0; i < mask.length; i++) {
    const b = burned(i);
    const m = mask[i] === 1;
    if (m) real++;
    if (b && m) inter++;
    if (b || m) union++;
  }
  return { iou: union ? inter / union : 0, covered: real ? inter / real : 0 };
}

/** Overlap at playback time t. */
export function overlapAt(result: SimResult, ref: ReferenceFire, t: number): Overlap {
  const arr = result.arrivalTime;
  return { ...overlapOf((i) => arr[i] <= t, ref.mask), t };
}

/**
 * Fair comparison: take the simulated fire at the moment it has burned as many cells as the real
 * fire did, and compare shapes. Independent of how fast the model is, only where it goes.
 * Null if the run never gets that big.
 */
export function overlapAtRealSize(result: SimResult, ref: ReferenceFire): Overlap | null {
  let realCells = 0;
  for (const m of ref.mask) realCells += m;
  const times = Array.from(result.arrivalTime).filter((t) => Number.isFinite(t)).sort((a, b) => a - b);
  if (times.length < realCells || realCells === 0) return null;
  return overlapAt(result, ref, times[realCells - 1]);
}
