/**
 * Tool registry. The UI palette and the drawing controller are driven by this list, so adding a
 * tool means adding an entry here plus its pure `make*` function.
 */

import type { GridSpec, Intervention } from '../contract';
import type { Pt } from '../data/raster';
import { FIREBREAK_WIDTH_MAX, FIREBREAK_WIDTH_MIN, firebreakCells, makeFirebreak } from './firebreak';
import { WATER_RADIUS_MAX, WATER_RADIUS_MIN, makeWater, waterCells } from './water';

export type DrawToolId = 'firebreak' | 'water';

export interface DrawTool {
  id: DrawToolId;
  /** Key into src/ui/strings.ts tool labels. */
  labelKey: 'toolFirebreak' | 'toolWater';
  sizeLabelKey: 'firebreakWidth' | 'waterRadius';
  sizeMin: number;
  sizeMax: number;
  /** Cells covered by a stroke, for live preview. */
  previewCells(grid: GridSpec, points: Pt[], size: number): number[];
  /** Builds the intervention for a finished stroke. */
  make(grid: GridSpec, points: Pt[], size: number, tSeconds: number, id: string): Intervention | null;
}

export const DRAW_TOOLS: DrawTool[] = [
  {
    id: 'firebreak',
    labelKey: 'toolFirebreak',
    sizeLabelKey: 'firebreakWidth',
    sizeMin: FIREBREAK_WIDTH_MIN,
    sizeMax: FIREBREAK_WIDTH_MAX,
    previewCells: firebreakCells,
    make: makeFirebreak,
  },
  {
    id: 'water',
    labelKey: 'toolWater',
    sizeLabelKey: 'waterRadius',
    sizeMin: WATER_RADIUS_MIN,
    sizeMax: WATER_RADIUS_MAX,
    previewCells: waterCells,
    make: makeWater,
  },
  // TODO(tools-v2): register retardant (long half-life water), backburn (early ignition events),
  // crews/trucks (rate-limited firebreak/water with travel time). Each needs its own pure module
  // here and, if it introduces a new InterventionType, a contract change announced in chat.
];

export function drawTool(id: DrawToolId): DrawTool {
  const t = DRAW_TOOLS.find((d) => d.id === id);
  if (!t) throw new Error(`unknown tool ${id}`);
  return t;
}

export { InterventionHistory } from './history';
