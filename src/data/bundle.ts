/**
 * Demo-area bundle: the on-disk JSON format in public/demo-areas/, and the in-memory DemoArea.
 * Typed arrays are base64 (little-endian). Works in Node and the browser (atob/btoa).
 */

import { DEFAULT_DURATION_SECONDS, DEFAULT_SETTINGS, DEFAULT_WEATHER } from '../contract';
import type { CellRef, GridSpec, Scenario, SimSettings, Weather } from '../contract';

export const BUNDLE_VERSION = 1;

export interface AreaMeta {
  /** Stable id, also the file name without extension. */
  name: string;
  label: string;
  /** True when generated, not from real data. Shown in the UI. Never present synthetic as real. */
  synthetic: boolean;
  description: string;
  source: string;
  attribution: string[];
  license: string;
  createdAt: string;
  suggestedIgnition?: CellRef;
  defaultWindFromDeg?: number;
}

export interface DemoArea {
  meta: AreaMeta;
  grid: GridSpec;
  fuel: Uint8Array;
  elevation: Float32Array;
}

export interface DemoAreaBundle extends AreaMeta {
  version: number;
  grid: GridSpec;
  fuelBase64: string;
  elevationBase64: string;
}

export interface DemoAreaIndexEntry {
  name: string;
  label: string;
  synthetic: boolean;
  file: string;
  center: { lon: number; lat: number };
  description: string;
}

export interface DemoAreaIndex {
  version: number;
  areas: DemoAreaIndexEntry[];
}

export function encodeBundle(area: DemoArea): DemoAreaBundle {
  return {
    ...area.meta,
    version: BUNDLE_VERSION,
    grid: area.grid,
    fuelBase64: bytesToBase64(area.fuel),
    elevationBase64: bytesToBase64(new Uint8Array(area.elevation.buffer, area.elevation.byteOffset, area.elevation.byteLength)),
  };
}

export function decodeBundle(b: DemoAreaBundle): DemoArea {
  if (b.version !== BUNDLE_VERSION) throw new Error(`Unsupported bundle version ${b.version}`);
  const n = b.grid.width * b.grid.height;
  const fuel = base64ToBytes(b.fuelBase64);
  const elevBytes = base64ToBytes(b.elevationBase64);
  if (fuel.length !== n) throw new Error(`bundle ${b.name}: fuel length ${fuel.length} != ${n}`);
  if (elevBytes.length !== n * 4) throw new Error(`bundle ${b.name}: elevation bytes ${elevBytes.length} != ${n * 4}`);
  const { version: _v, grid, fuelBase64: _f, elevationBase64: _e, ...meta } = b;
  return { meta, grid, fuel, elevation: new Float32Array(elevBytes.buffer, 0, n) };
}

export function indexEntryFor(area: DemoArea): DemoAreaIndexEntry {
  const b = area.grid.bounds;
  return {
    name: area.meta.name,
    label: area.meta.label,
    synthetic: area.meta.synthetic,
    file: `${area.meta.name}.json`,
    center: { lon: (b.west + b.east) / 2, lat: (b.north + b.south) / 2 },
    description: area.meta.description,
  };
}

export interface ScenarioOptions {
  weather?: Partial<Weather>;
  settings?: Partial<SimSettings>;
  ignition?: CellRef[];
  durationSeconds?: number;
  seed?: number;
}

/** Builds a Scenario from an area with defaults filled in. Typed arrays are shared, not copied. */
export function scenarioFromArea(area: DemoArea, o: ScenarioOptions = {}): Scenario {
  const ignition = o.ignition ?? (area.meta.suggestedIgnition ? [area.meta.suggestedIgnition] : [{ row: area.grid.height >> 1, col: area.grid.width >> 1 }]);
  return {
    grid: area.grid,
    fuel: area.fuel,
    elevation: area.elevation,
    weather: { ...DEFAULT_WEATHER, windFromDeg: area.meta.defaultWindFromDeg ?? DEFAULT_WEATHER.windFromDeg, ...o.weather },
    ignition,
    interventions: [],
    durationSeconds: o.durationSeconds ?? DEFAULT_DURATION_SECONDS,
    seed: o.seed ?? 1,
    settings: { ...DEFAULT_SETTINGS, ...o.settings },
  };
}

// TODO(share-persist): scenario JSON export/import (weather, ignition, interventions, seed, area name)
// belongs here, next to the bundle codec, so share links and bundles use the same base64 helpers.

const CHUNK = 0x8000;

export function bytesToBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    s += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK) as unknown as number[]);
  }
  return btoa(s);
}

export function base64ToBytes(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}
