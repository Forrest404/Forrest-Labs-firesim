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
  /** Conditions applied when the area is selected (e.g. the real weather of a historical fire). */
  defaultWeather?: Partial<Weather>;
  defaultDurationSeconds?: number;
}

/** A real fire's final burned area, for comparing a simulation against what actually happened. */
export interface ReferenceFire {
  name: string;
  /** Short line shown in the UI: date, place, source. */
  summary: string;
  source: string;
  /** Real burned area in hectares (from the perimeter, not the cell count). */
  areaHa: number;
  /** 1 where the cell centre lies inside the real perimeter. */
  mask: Uint8Array;
  /** Perimeter rings as [lon, lat] pairs, for drawing the outline. */
  rings: [number, number][][];
}

export interface DemoArea {
  meta: AreaMeta;
  grid: GridSpec;
  fuel: Uint8Array;
  elevation: Float32Array;
  /** Optional building count per cell (OSM building footprints), for the homes-reached number. */
  homes?: Uint16Array;
  reference?: ReferenceFire;
}

export interface DemoAreaBundle extends AreaMeta {
  version: number;
  grid: GridSpec;
  fuelBase64: string;
  elevationBase64: string;
  homesBase64?: string;
  reference?: Omit<ReferenceFire, 'mask'> & { maskBase64: string };
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
  const b: DemoAreaBundle = {
    ...area.meta,
    version: BUNDLE_VERSION,
    grid: area.grid,
    fuelBase64: bytesToBase64(area.fuel),
    elevationBase64: bytesToBase64(new Uint8Array(area.elevation.buffer, area.elevation.byteOffset, area.elevation.byteLength)),
  };
  if (area.homes) b.homesBase64 = bytesToBase64(new Uint8Array(area.homes.buffer, area.homes.byteOffset, area.homes.byteLength));
  if (area.reference) {
    const { mask, ...rest } = area.reference;
    b.reference = { ...rest, maskBase64: bytesToBase64(mask) };
  }
  return b;
}

export function decodeBundle(b: DemoAreaBundle): DemoArea {
  if (b.version !== BUNDLE_VERSION) throw new Error(`Unsupported bundle version ${b.version}`);
  const n = b.grid.width * b.grid.height;
  const fuel = base64ToBytes(b.fuelBase64);
  const elevBytes = base64ToBytes(b.elevationBase64);
  if (fuel.length !== n) throw new Error(`bundle ${b.name}: fuel length ${fuel.length} != ${n}`);
  if (elevBytes.length !== n * 4) throw new Error(`bundle ${b.name}: elevation bytes ${elevBytes.length} != ${n * 4}`);
  const { version: _v, grid, fuelBase64: _f, elevationBase64: _e, homesBase64, reference, ...meta } = b;
  const area: DemoArea = { meta, grid, fuel, elevation: new Float32Array(elevBytes.buffer, 0, n) };
  if (homesBase64) {
    const hb = base64ToBytes(homesBase64);
    if (hb.length !== n * 2) throw new Error(`bundle ${b.name}: homes bytes ${hb.length} != ${n * 2}`);
    area.homes = new Uint16Array(hb.buffer, 0, n);
  }
  if (reference) {
    const { maskBase64, ...rest } = reference;
    const mask = base64ToBytes(maskBase64);
    if (mask.length !== n) throw new Error(`bundle ${b.name}: reference mask length ${mask.length} != ${n}`);
    area.reference = { ...rest, mask };
  }
  return area;
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
    weather: { ...DEFAULT_WEATHER, windFromDeg: area.meta.defaultWindFromDeg ?? DEFAULT_WEATHER.windFromDeg, ...area.meta.defaultWeather, ...o.weather },
    ignition,
    interventions: [],
    durationSeconds: o.durationSeconds ?? area.meta.defaultDurationSeconds ?? DEFAULT_DURATION_SECONDS,
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
