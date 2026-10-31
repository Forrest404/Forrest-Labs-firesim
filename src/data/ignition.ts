/**
 * Default ignition for an area that does not carry a suggested one.
 *
 * Roads, rivers and buildings cut the burnable land into compartments, and a fire cannot leave the
 * compartment it starts in (without spotting). A default near the grid centre can land in a tiny
 * walled-in patch and burn 13 cells. So: find the 8-connected burnable region with the most cells
 * (the same connectivity the solver spreads through), then pick the cell in it closest to the grid
 * centre, preferring forest and shrub with a burnable neighbourhood so the fire has somewhere to go.
 */

import { FuelClass } from '../contract';
import type { CellRef } from '../contract';
import type { DemoArea } from './bundle';

const PREFERRED = new Set<number>([FuelClass.FOREST_CONIFER, FuelClass.FOREST_DECIDUOUS, FuelClass.SHRUB]);

/** Labels 8-connected burnable regions. Returns the label per cell (0 = not burnable) and each region's size. */
export function burnableRegions(fuel: Uint8Array, width: number, height: number): { label: Int32Array; sizes: number[] } {
  const label = new Int32Array(width * height);
  const sizes: number[] = [0];
  const stack = new Int32Array(width * height);
  for (let start = 0; start < label.length; start++) {
    if (label[start] !== 0 || fuel[start] === FuelClass.NONE) continue;
    const id = sizes.length;
    let size = 0;
    let top = 0;
    stack[top++] = start;
    label[start] = id;
    while (top > 0) {
      const i = stack[--top];
      size++;
      const r = (i / width) | 0;
      const c = i - r * width;
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          if (!dr && !dc) continue;
          const rr = r + dr;
          const cc = c + dc;
          if (rr < 0 || cc < 0 || rr >= height || cc >= width) continue;
          const j = rr * width + cc;
          if (label[j] === 0 && fuel[j] !== FuelClass.NONE) {
            label[j] = id;
            stack[top++] = j;
          }
        }
      }
    }
    sizes.push(size);
  }
  return { label, sizes };
}

/** Half-width (cells) of the window used to judge how open the land around an ignition candidate is. */
const OPEN_RADIUS = 6;
/** Fraction of the window that must be burnable for a cell to count as "open". */
const OPEN_FRACTION = 0.85;

export function defaultIgnition(area: DemoArea): CellRef | null {
  if (area.meta.suggestedIgnition) return area.meta.suggestedIgnition;
  const { width: W, height: H } = area.grid;
  const fuel = area.fuel;
  const { label, sizes } = burnableRegions(fuel, W, H);
  let best = 0;
  for (let id = 1; id < sizes.length; id++) if (sizes[id] > sizes[best]) best = id; // first (lowest index) wins ties
  if (best === 0) return null;

  // Burnable cells of the chosen region in a summed-area table: how open is the land around each cell?
  const SW = W + 1;
  const sat = new Int32Array(SW * (H + 1));
  for (let r = 0; r < H; r++) {
    let rowSum = 0;
    for (let c = 0; c < W; c++) {
      rowSum += label[r * W + c] === best ? 1 : 0;
      sat[(r + 1) * SW + c + 1] = sat[r * SW + c + 1] + rowSum;
    }
  }
  const openness = (r: number, c: number): number => {
    const r0 = Math.max(0, r - OPEN_RADIUS), r1 = Math.min(H, r + OPEN_RADIUS + 1);
    const c0 = Math.max(0, c - OPEN_RADIUS), c1 = Math.min(W, c + OPEN_RADIUS + 1);
    const n = sat[r1 * SW + c1] - sat[r0 * SW + c1] - sat[r1 * SW + c0] + sat[r0 * SW + c0];
    return n / ((2 * OPEN_RADIUS + 1) ** 2); // out-of-grid area counts as not burnable
  };

  const row0 = H >> 1;
  const col0 = W >> 1;
  // Candidates: open land (>= OPEN_FRACTION burnable around it), preferring forest and shrub, nearest the centre.
  let bestScore = Infinity;
  let pick: CellRef | null = null;
  let fallback: CellRef | null = null;
  let fallbackOpen = -1;
  let fallbackD = Infinity;
  for (let r = 0; r < H; r++) {
    for (let c = 0; c < W; c++) {
      const i = r * W + c;
      if (label[i] !== best) continue;
      const o = openness(r, c);
      const d = (r - row0) * (r - row0) + (c - col0) * (c - col0);
      if (o > fallbackOpen + 1e-9 || (Math.abs(o - fallbackOpen) <= 1e-9 && d < fallbackD)) { fallbackOpen = o; fallbackD = d; fallback = { row: r, col: c }; }
      if (o < OPEN_FRACTION) continue;
      // Forest and shrub are preferred, but only mildly: a grass cell right at the centre still beats a forest cell far away.
      const score = d + (PREFERRED.has(fuel[i]) ? 0 : (Math.min(W, H) / 6) ** 2);
      if (score < bestScore) { bestScore = score; pick = { row: r, col: c }; }
    }
  }
  return pick ?? fallback;
}
