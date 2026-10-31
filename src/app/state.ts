/**
 * App state store: one plain object, replaced on every change, with synchronous subscribers.
 * UI components read from it and write to it; they never own state themselves.
 */

import { DEFAULT_DURATION_SECONDS, DEFAULT_SETTINGS, DEFAULT_WEATHER } from '../contract';
import type { CellRef, Intervention, SimResult, SimSettings, Weather } from '../contract';
import type { DemoArea, DemoAreaIndexEntry } from '../data/bundle';
import type { DemoId } from '../data/demo-scenarios';
import type { Basemap, ViewerMode } from '../viewer/createViewer';
import { DEFAULT_FILTERS } from '../data/firms';
import type { FireRegion, Hotspot, HotspotFilters, LiveSource } from '../data/firms';

export type ToolId = 'ignite' | 'firebreak' | 'water';

/** Top-level panel tab: the simulator, or the live satellite fire detections. */
export type ViewId = 'sim' | 'live';

export type LiveStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface LiveLayers {
  /** Individual detections as points. */
  dots: boolean;
  /** Fire regions: hulls around linked detections. */
  regions: boolean;
}

export interface LiveState {
  /** False when no VITE_FIRMS_MAP_KEY was compiled in. */
  keyPresent: boolean;
  source: LiveSource;
  days: 1 | 2 | 3;
  filters: HotspotFilters;
  status: LiveStatus;
  /** User-facing, already redacted. */
  error: string | null;
  /** Raw result of the last fetch. */
  hotspots: Hotspot[];
  /** Derived from hotspots + filters; written in the same update as either. */
  filtered: Hotspot[];
  /** Derived from filtered: linked detections with hulls, sorted by summed FRP. */
  regions: FireRegion[];
  layers: LiveLayers;
  basemap: Basemap;
  fetchedAt: number | null;
  selectedId: string | null;
  selectedRegionId: string | null;
}

export interface PlaybackState {
  /** Simulated seconds since ignition. */
  t: number;
  playing: boolean;
  /** Simulated seconds per real second. */
  speed: number;
}

export interface ToolParams {
  firebreakWidthCells: number;
  waterRadiusCells: number;
  /** If true, new interventions are applied at t = 0 ("pre-clear") instead of the playback time. */
  preClear: boolean;
}

export interface DebugFlags {
  outline: boolean;
  fuel: boolean;
  slope: boolean;
}

/** Every visual extra is independently switchable (D21). */
export interface EffectsFlags {
  /** Flame particles on flaming cells. */
  flames: boolean;
  /** Ember sparks lofted from flaming cells. */
  embers: boolean;
  /** Smoke puff particles near the fire. */
  smokeParticles: boolean;
  /** Draped smoke-concentration layer (cosmetic model, see DECISIONS.md D20). */
  smoke: boolean;
  /** Flickering ground glow around flaming cells on the overlay. */
  glow: boolean;
  /** Sub-cell smoothing of the burn and smoke overlays (2x canvas, bilinear). */
  smooth: boolean;
  /** Particle budget. */
  quality: 'low' | 'medium' | 'high';
}

export interface AppState {
  areas: DemoAreaIndexEntry[];
  area: DemoArea | null;
  areaLoading: boolean;
  viewerMode: ViewerMode;

  weather: Weather;
  settings: SimSettings;
  durationSeconds: number;
  seed: number;
  ignition: CellRef | null;
  interventions: Intervention[];
  /** The demo scenario that was loaded with the Demo card, until the area is changed by hand. */
  demoId: DemoId | null;

  result: SimResult | null;
  /** True when inputs changed since `result` was computed. */
  resultStale: boolean;
  simRunning: boolean;
  simError: string | null;

  playback: PlaybackState;
  tool: ToolId;
  toolParams: ToolParams;
  debug: DebugFlags;
  effects: EffectsFlags;
  advancedOpen: boolean;
  view: ViewId;
  live: LiveState;
}

export type Listener = (state: AppState, prev: AppState) => void;

export interface Store {
  get(): AppState;
  set(patch: Partial<AppState>): void;
  update(fn: (s: AppState) => Partial<AppState>): void;
  subscribe(listener: Listener): () => void;
}

export function initialLive(): LiveState {
  return {
    keyPresent: false,
    source: 'viirs',
    days: 1,
    filters: { ...DEFAULT_FILTERS },
    status: 'idle',
    error: null,
    hotspots: [],
    filtered: [],
    regions: [],
    layers: { dots: true, regions: true },
    basemap: 'map',
    fetchedAt: null,
    selectedId: null,
    selectedRegionId: null,
  };
}

export function initialState(): AppState {
  return {
    areas: [],
    area: null,
    areaLoading: false,
    viewerMode: 'fallback',
    weather: { ...DEFAULT_WEATHER },
    settings: { ...DEFAULT_SETTINGS },
    durationSeconds: DEFAULT_DURATION_SECONDS,
    seed: 1,
    ignition: null,
    interventions: [],
    demoId: null,
    result: null,
    resultStale: false,
    simRunning: false,
    simError: null,
    playback: { t: 0, playing: false, speed: 64 },
    tool: 'ignite',
    toolParams: { firebreakWidthCells: 3, waterRadiusCells: 3, preClear: false },
    debug: { outline: false, fuel: false, slope: false },
    effects: { flames: true, embers: true, smokeParticles: true, smoke: true, glow: true, smooth: true, quality: 'medium' },
    advancedOpen: false,
    view: 'sim',
    live: initialLive(),
  };
}

export function createStore(initial: AppState = initialState()): Store {
  let state = initial;
  const listeners = new Set<Listener>();
  const set = (patch: Partial<AppState>): void => {
    const prev = state;
    state = { ...prev, ...patch };
    for (const l of listeners) l(state, prev);
  };
  return {
    get: () => state,
    set,
    update: (fn) => set(fn(state)),
    subscribe: (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
  };
}

/** Marks the current result stale (inputs changed) without discarding it. */
export function staleIfResult(s: AppState): Partial<AppState> {
  return s.result ? { resultStale: true } : {};
}
