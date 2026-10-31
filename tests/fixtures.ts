/**
 * Hand-made 50 x 50 test grid with known expected behaviour, so the sim and UI can be developed
 * before real data exists.
 *
 * Layout (row 0 = north, col 0 = west):
 * - Uniform conifer forest.
 * - River: columns 40-41, every row (non-burnable). Optional.
 * - Road: row 25, every column (non-burnable). Optional, with an optional 3-cell gap at cols 5-7.
 * - Terrain: flat at 100 m, or a plane rising toward the NORTH at about 12 degrees.
 */

import {
  DEFAULT_SETTINGS,
  DEFAULT_WEATHER,
  FuelClass,
  applyDrynessPreset,
} from '../src/contract';
import type { DrynessPreset, Scenario, SimSettings, Weather } from '../src/contract';

export const FIX_W = 50;
export const FIX_H = 50;
export const RIVER_COLS = [40, 41];
export const ROAD_ROW = 25;
export const ROAD_GAP_COLS = [5, 6, 7];

export interface FixtureOptions {
  river?: boolean;
  road?: boolean;
  roadGap?: boolean;
  slopeNorth?: boolean;
  fuelClass?: FuelClass;
  dryness?: DrynessPreset;
  weather?: Partial<Weather>;
  settings?: Partial<SimSettings>;
  ignition?: { row: number; col: number }[];
  durationSeconds?: number;
  seed?: number;
}

export function makeFixture(opts: FixtureOptions = {}): Scenario {
  const width = FIX_W;
  const height = FIX_H;
  const n = width * height;
  const fuel = new Uint8Array(n).fill(opts.fuelClass ?? FuelClass.FOREST_CONIFER);
  const elevation = new Float32Array(n).fill(100);

  if (opts.river ?? true) {
    for (let r = 0; r < height; r++) for (const c of RIVER_COLS) fuel[r * width + c] = FuelClass.NONE;
  }
  if (opts.road ?? true) {
    for (let c = 0; c < width; c++) {
      if (opts.roadGap && ROAD_GAP_COLS.includes(c)) continue;
      fuel[ROAD_ROW * width + c] = FuelClass.NONE;
    }
  }
  if (opts.slopeNorth) {
    const risePerRow = 30 * Math.tan((12 * Math.PI) / 180);
    for (let r = 0; r < height; r++) {
      for (let c = 0; c < width; c++) elevation[r * width + c] = 100 + (height - 1 - r) * risePerRow;
    }
  }

  const cellSizeM = 30;
  const originLon = 8.4;
  const originLat = 48.35;
  const mPerDegLat = 111_320;
  const mPerDegLon = mPerDegLat * Math.cos((originLat * Math.PI) / 180);

  let weather: Weather = { ...DEFAULT_WEATHER, windSpeedMps: 0, windFromDeg: 270 };
  weather = applyDrynessPreset(weather, opts.dryness ?? 'medium');
  weather = { ...weather, ...opts.weather };

  return {
    grid: {
      width,
      height,
      cellSizeM,
      originLon,
      originLat,
      bounds: {
        west: originLon,
        north: originLat,
        east: originLon + (width * cellSizeM) / mPerDegLon,
        south: originLat - (height * cellSizeM) / mPerDegLat,
      },
    },
    fuel,
    elevation,
    weather,
    ignition: opts.ignition ?? [{ row: 35, col: 20 }],
    interventions: [],
    durationSeconds: opts.durationSeconds ?? 12 * 3600,
    seed: opts.seed ?? 42,
    settings: { ...DEFAULT_SETTINGS, ...opts.settings },
  };
}

export function idx(row: number, col: number): number {
  return row * FIX_W + col;
}

export function countBurned(arrival: Float32Array): number {
  let n = 0;
  for (let i = 0; i < arrival.length; i++) if (arrival[i] !== Infinity) n++;
  return n;
}
