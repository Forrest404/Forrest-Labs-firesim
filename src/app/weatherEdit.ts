/**
 * Live weather: turns slider moves into either a change of the starting weather (nothing has
 * happened yet, or live mode is off) or a timestamped live edit (the fire is part-way through), and
 * answers "what is the weather right now" for the UI and the 3D effects.
 */

import { applyDrynessPreset, DRYNESS_PRESETS, scheduleFromPreset } from '../contract';
import type { DrynessPreset, Weather, WeatherKeyframe } from '../contract';
import { LIVE_STEP_S, addLiveEdit, displayWeather, effectiveSchedule } from '../sim/live';
import type { WeatherState } from '../sim/weather';
import { staleIfResult } from './state';
import type { AppState, Store } from './state';

type ScheduleInputs = Pick<AppState, 'weather' | 'weatherPreset' | 'liveEdits' | 'durationSeconds' | 'live'>;

let memoIn: ScheduleInputs | null = null;
let memoOut: WeatherKeyframe[] = [];

function same(a: ScheduleInputs, b: ScheduleInputs): boolean {
  return a.weather === b.weather && a.weatherPreset === b.weatherPreset && a.liveEdits === b.liveEdits && a.durationSeconds === b.durationSeconds && a.live === b.live;
}

/**
 * The weather schedule to simulate. Single live runs force the solver's time-varying path so that a
 * run before and after an edit agree exactly up to the edit; ensembles do not need that.
 */
export function scheduleFor(s: ScheduleInputs, forEnsemble = false): WeatherKeyframe[] {
  if (forEnsemble) {
    return effectiveSchedule(s.weather, scheduleFromPreset(s.weatherPreset, s.weather), s.liveEdits, { durationSeconds: s.durationSeconds });
  }
  if (!memoIn || !same(memoIn, s)) {
    memoIn = { weather: s.weather, weatherPreset: s.weatherPreset, liveEdits: s.liveEdits, durationSeconds: s.durationSeconds, live: s.live };
    memoOut = effectiveSchedule(s.weather, scheduleFromPreset(s.weatherPreset, s.weather), s.liveEdits, { durationSeconds: s.durationSeconds, ensureTimeline: s.live });
  }
  return memoOut;
}

/** The wind, temperature and humidity in force at the current playback time. */
export function currentWeather(s: AppState): WeatherState {
  return displayWeather(s.weather, scheduleFor(s), s.liveEdits, s.playback.t);
}

/** True when a slider move now would become a live edit rather than change the starting weather. */
export function isLiveEditing(s: AppState): boolean {
  return s.live && !!s.result && s.playback.t > 0;
}

/**
 * Applies a weather change. `patch` is the new value of the quantities the user touched;
 * `baseline` says how the same change applies to the starting weather.
 */
export function editWeather(store: Store, patch: Partial<WeatherState>, baseline: (w: Weather) => Weather): void {
  store.update((s) => {
    if (!isLiveEditing(s)) {
      // Nothing has happened yet (or live mode is off): the change is to the starting conditions.
      const weather = baseline(s.weather);
      if (s.live && s.result) return { weather, liveEdits: [], autoRun: s.autoRun + 1 };
      return { weather, liveEdits: [], ...staleIfResult(s) };
    }
    const next: WeatherState = { ...currentWeather(s), ...patch };
    return { liveEdits: addLiveEdit(s.liveEdits, s.playback.t, next, LIVE_STEP_S), autoRun: s.autoRun + 1 };
  });
}

export function setWindSpeed(store: Store, mps: number): void {
  editWeather(store, { windSpeedMps: mps }, (w) => ({ ...w, windSpeedMps: mps }));
}

export function setWindFrom(store: Store, deg: number): void {
  editWeather(store, { windFromDeg: deg }, (w) => ({ ...w, windFromDeg: deg }));
}

export function setDryness(store: Store, preset: DrynessPreset): void {
  const p = DRYNESS_PRESETS[preset];
  editWeather(store, { temperatureC: p.temperatureC, relativeHumidity: p.relativeHumidity }, (w) => applyDrynessPreset(w, preset));
}

export function setWeatherPreset(store: Store, id: AppState['weatherPreset']): void {
  store.update((s) => ({ weatherPreset: id, liveEdits: [], ...(s.live && s.result ? { autoRun: s.autoRun + 1 } : staleIfResult(s)) }));
}

export function clearLiveEdits(store: Store): void {
  store.update((s) => (s.liveEdits.length ? { liveEdits: [], autoRun: s.autoRun + 1 } : {}));
}

/** Turning live mode on re-runs with the live solver settings; turning it off drops the live edits. */
export function setLive(store: Store, on: boolean): void {
  store.update((s) => {
    if (on === s.live) return {};
    if (on) return { live: true, ...(s.result ? { autoRun: s.autoRun + 1 } : {}) };
    return { live: false, liveEdits: [], ...staleIfResult(s) };
  });
}
