/**
 * App state store: one plain object, replaced on every change, with synchronous subscribers.
 * UI components read from it and write to it; they never own state themselves.
 */

import { DEFAULT_DURATION_SECONDS, DEFAULT_SETTINGS, DEFAULT_WEATHER } from '../contract';
import type { CellRef, EnsembleResult, Intervention, SimResult, SimSettings, UncertaintyLevel, Weather, WeatherPresetId } from '../contract';
import type { DemoArea, DemoAreaIndexEntry } from '../data/bundle';
import type { DemoId } from '../data/demo-scenarios';
import type { Basemap, ViewerMode } from '../viewer/createViewer';
import { DEFAULT_FILTERS } from '../data/firms';
import type { FireRegion, Hotspot, HotspotFilters, LiveSource } from '../data/firms';
import type { ContainOverrides, ContainPlan, ResponseLevel } from '../contain';
import type { PlanState } from './planner';
import type { ControlRun } from './realFire';
import type { LiveFire } from '../data/liveFire';
import type { LiveEdit } from '../sim/live';

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

/** Emergency response simulation (src/contain). The plan is recomputed by Simulate when enabled. */
export interface ContainState {
  enabled: boolean;
  level: ResponseLevel;
  /** Advanced-panel tweaks on top of the preset; null = preset as is. */
  overrides: ContainOverrides | null;
  planning: boolean;
  /** 0-1 while planning. */
  progress: number;
  plan: ContainPlan | null;
  /** Which run `result` currently holds when a plan exists. */
  show: 'contained' | 'baseline';
  /** Draw the other run's burned-area outline over the shown run. */
  outline: boolean;
  /** Moving unit markers in 3D. */
  units3d: boolean;
  /** Dispatch cards over the map. */
  hud: boolean;
}

export interface EnsembleState {
  /** Choices for the next run. */
  runs: number;
  uncertainty: UncertaintyLevel;
  ignitionJitterCells: number;
  running: boolean;
  /** 0-1 while running. */
  progress: number;
  result: EnsembleResult | null;
  /** Inputs changed since the result was computed. */
  stale: boolean;
  error: string | null;
}

export interface AppState {
  areas: DemoAreaIndexEntry[];
  area: DemoArea | null;
  areaLoading: boolean;
  viewerMode: ViewerMode;

  weather: Weather;
  /** How the weather changes during the run (applied relative to `weather` when simulating). */
  weatherPreset: WeatherPresetId;
  settings: SimSettings;
  durationSeconds: number;
  /**
   * Live mode: wind and dryness changes made while a result exists take effect from the current
   * playback time on (the past stays as it was) and re-run the simulation automatically.
   */
  liveEdit: boolean;
  /** The live changes made so far (see src/sim/live.ts); `weather` stays the weather at t = 0. */
  liveEdits: LiveEdit[];
  /** Bumped whenever something asks for an automatic re-run (wiring debounces and runs it). */
  autoRun: number;
  seed: number;
  ignition: CellRef | null;
  interventions: Intervention[];
  /** The demo scenario that was loaded with the Demo card, until the area is changed by hand. */
  demoId: DemoId | null;

  result: SimResult | null;
  /** The same run without any interventions, for "homes reached: before -> after". Equals `result` when there are none. */
  baseline: SimResult | null;
  /** Gemini (or built-in) plan suggestions and their verification. */
  plan: PlanState | null;
  /** Accuracy colours against the area's real fire instead of the fire colours. */
  compare: boolean;
  /** No-wind and reversed-wind re-runs from "Compare with real fire", for the current result. */
  controls: ControlRun[] | null;
  /** The "Real vs simulation" card: the real perimeter and our run side by side. */
  sideBySide: boolean;
  /** Ground view: the camera stays low in front of the fire front while it plays. */
  groundFollow: boolean;
  /** Fires reported now (NIFC), once loaded; null before the first load. */
  liveFires: LiveFire[] | null;
  liveLoading: boolean;
  /** Draw the 1 h / 3 h / 6 h forecast rings on the overlay (live fires). */
  forecast: boolean;
  /** True when inputs changed since `result` was computed. */
  resultStale: boolean;
  simRunning: boolean;
  simError: string | null;

  ensemble: EnsembleState;
  /** Show the burn-probability map (from the ensemble) instead of the single run's colours. */
  showProbability: boolean;

  playback: PlaybackState;
  tool: ToolId;
  toolParams: ToolParams;
  debug: DebugFlags;
  effects: EffectsFlags;
  advancedOpen: boolean;
  view: ViewId;
  live: LiveState;
  contain: ContainState;
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
    weatherPreset: 'steady',
    settings: { ...DEFAULT_SETTINGS },
    durationSeconds: DEFAULT_DURATION_SECONDS,
    liveEdit: true,
    liveEdits: [],
    autoRun: 0,
    seed: 1,
    ignition: null,
    interventions: [],
    demoId: null,
    result: null,
    baseline: null,
    plan: null,
    compare: false,
    controls: null,
    sideBySide: false,
    groundFollow: false,
    liveFires: null,
    liveLoading: false,
    forecast: false,
    resultStale: false,
    simRunning: false,
    simError: null,
    ensemble: { runs: 50, uncertainty: 'medium', ignitionJitterCells: 0, running: false, progress: 0, result: null, stale: false, error: null },
    showProbability: false,
    playback: { t: 0, playing: false, speed: 256 },
    tool: 'ignite',
    toolParams: { firebreakWidthCells: 3, waterRadiusCells: 3, preClear: false },
    debug: { outline: false, fuel: false, slope: false },
    effects: { flames: true, embers: true, smokeParticles: true, smoke: true, glow: true, smooth: true, quality: 'medium' },
    advancedOpen: false,
    view: 'sim',
    live: initialLive(),
    contain: { enabled: false, level: 'standard', overrides: null, planning: false, progress: 0, plan: null, show: 'contained', outline: true, units3d: true, hud: true },
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
