/**
 * App state store: one plain object, replaced on every change, with synchronous subscribers.
 * UI components read from it and write to it; they never own state themselves.
 */

import { DEFAULT_DURATION_SECONDS, DEFAULT_SETTINGS, DEFAULT_WEATHER } from '../contract';
import type { CellRef, EnsembleResult, Intervention, SimResult, SimSettings, UncertaintyLevel, Weather, WeatherPresetId } from '../contract';
import type { DemoArea, DemoAreaIndexEntry } from '../data/bundle';
import type { LiveEdit } from '../sim/live';
import type { ViewerMode } from '../viewer/createViewer';

export type ToolId = 'ignite' | 'firebreak' | 'water';

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

export interface EffectsFlags {
  particles: boolean;
  quality: 'low' | 'medium' | 'high';
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
  live: boolean;
  /** The live changes made so far (see src/sim/live.ts); `weather` stays the weather at t = 0. */
  liveEdits: LiveEdit[];
  /** Bumped whenever something asks for an automatic re-run (wiring debounces and runs it). */
  autoRun: number;
  seed: number;
  ignition: CellRef | null;
  interventions: Intervention[];

  result: SimResult | null;
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
}

export type Listener = (state: AppState, prev: AppState) => void;

export interface Store {
  get(): AppState;
  set(patch: Partial<AppState>): void;
  update(fn: (s: AppState) => Partial<AppState>): void;
  subscribe(listener: Listener): () => void;
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
    live: true,
    liveEdits: [],
    autoRun: 0,
    seed: 1,
    ignition: null,
    interventions: [],
    result: null,
    resultStale: false,
    simRunning: false,
    simError: null,
    ensemble: { runs: 50, uncertainty: 'medium', ignitionJitterCells: 0, running: false, progress: 0, result: null, stale: false, error: null },
    showProbability: false,
    playback: { t: 0, playing: false, speed: 64 },
    tool: 'ignite',
    toolParams: { firebreakWidthCells: 3, waterRadiusCells: 3, preClear: false },
    debug: { outline: false, fuel: false, slope: false },
    effects: { particles: true, quality: 'medium' },
    advancedOpen: false,
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
