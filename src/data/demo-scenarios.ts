/**
 * The hackathon demo scenarios, as DATA: which area, where the fire starts, the weather, how long,
 * where the camera goes, what is threatened, and the saved "contained" plan (a firebreak and water
 * spray at fixed times). Nothing here is UI code or user-facing text (that lives in src/ui/strings.ts,
 * keyed by `id`). Every value was found with scripts/tune-demo.ts and is checked by
 * tests/demoScenario.test.ts; the reasoning is in DECISIONS.md.
 *
 * Cells are (row, col) with row 0 = north. Cell-space points are [col, row] floats (x east, y south),
 * the same space the drawing tools work in, so a presenter's own drag produces the same kind of line.
 */

import { applyDrynessPreset, DEFAULT_WEATHER } from '../contract';
import type { CellRef, DrynessPreset, GridSpec, Intervention, Weather } from '../contract';
import { makeFirebreak } from '../tools/firebreak';
import { makeWater } from '../tools/water';
import type { Pt } from './raster';

export type DemoId = 'surrey' | 'backup';

export interface PlannedAction {
  id: string;
  type: 'firebreak' | 'water';
  /** Stroke in cell space: [col, row] pairs. */
  points: Pt[];
  /** Firebreak width in cells, or water spray radius in cells. */
  size: number;
  /** Simulated seconds since ignition at which the action takes effect. */
  tSeconds: number;
}

export interface DemoScenario {
  id: DemoId;
  /** Name of the demo area bundle (public/demo-areas/<name>.json). */
  areaName: string;
  ignition: CellRef;
  windFromDeg: number;
  windSpeedKmh: number;
  dryness: DrynessPreset;
  durationSeconds: number;
  seed: number;
  /** Camera on the upwind side looking along the fire direction at the middle of the action (heading: degrees clockwise from north). */
  camera: { focus: CellRef; headingDeg: number; pitchDeg: number; rangeM: number };
  /** Simulation playback speed that fits the 3-minute script. */
  playbackSpeed: number;
  /** When to pause and draw the line: a little before the head reaches it. */
  pauseAtSeconds: number;
  /** The thing the fire must not reach: a disc of cells around a village. */
  threatened: { centre: CellRef; radiusCells: number };
  /** The saved containing plan, applied by "Show contained version". */
  contained: PlannedAction[];
}

const H = 3600;

export const DEMO_SCENARIOS: Record<DemoId, DemoScenario> = {
  // Leith Hill, Surrey (real OpenStreetMap land cover and terrain). Woodland low on the south-west
  // side runs north-east towards Coldharbour; the break is anchored on the road on its west side.
  surrey: {
    id: 'surrey',
    areaName: 'surrey-hills',
    ignition: { row: 142, col: 102 },
    windFromDeg: 225,
    windSpeedKmh: 25,
    dryness: 'high',
    durationSeconds: 4 * H,
    seed: 1,
    camera: { focus: { row: 120, col: 105 }, headingDeg: 30, pitchDeg: -32, rangeM: 2600 },
    playbackSpeed: 256,
    pauseAtSeconds: 1.5 * H,
    threatened: { centre: { row: 97, col: 109 }, radiusCells: 8 },
    contained: [
      { id: 'demo-firebreak', type: 'firebreak', points: [[94, 118.5], [132, 118.5]], size: 3, tSeconds: 1.6 * H },
      { id: 'demo-spray', type: 'water', points: [[137, 116], [137, 120]], size: 4, tSeconds: 2 * H },
    ],
  },
  // Backup: the generated "Forest Ridge" area (river on the east side), no network needed.
  backup: {
    id: 'backup',
    areaName: 'synthetic-ridge',
    ignition: { row: 114, col: 124 },
    windFromDeg: 270,
    windSpeedKmh: 25,
    dryness: 'high',
    durationSeconds: 6 * H,
    seed: 1,
    camera: { focus: { row: 118, col: 145 }, headingDeg: 70, pitchDeg: -32, rangeM: 2800 },
    playbackSpeed: 256,
    pauseAtSeconds: 2.3 * H,
    threatened: { centre: { row: 121, col: 165 }, radiusCells: 8 },
    contained: [
      { id: 'demo-firebreak', type: 'firebreak', points: [[148.5, 90], [148.5, 136]], size: 3, tSeconds: 2.4 * H },
      { id: 'demo-spray-north', type: 'water', points: [[151, 87]], size: 4, tSeconds: 2.8 * H },
      { id: 'demo-spray-south', type: 'water', points: [[151, 139]], size: 4, tSeconds: 2.8 * H },
    ],
  },
};

export const DEMO_IDS: DemoId[] = ['surrey', 'backup'];

/** Every intervention in a saved plan has an id starting with this (so the UI can tell they are on). */
export const DEMO_INTERVENTION_PREFIX = 'demo-';

/** The scenario's weather, with the UI's units (km/h) converted to SI at this edge. */
export function demoWeather(s: DemoScenario): Weather {
  return applyDrynessPreset({ ...DEFAULT_WEATHER, windSpeedMps: s.windSpeedKmh / 3.6, windFromDeg: s.windFromDeg }, s.dryness);
}

/** The saved plan as interventions, built with the same functions the drawing tools use. */
export function demoContained(s: DemoScenario, grid: GridSpec): Intervention[] {
  const out: Intervention[] = [];
  for (const a of s.contained) {
    const iv = a.type === 'firebreak' ? makeFirebreak(grid, a.points, a.size, a.tSeconds, a.id) : makeWater(grid, a.points, a.size, a.tSeconds, a.id);
    if (iv) out.push(iv);
  }
  return out;
}
