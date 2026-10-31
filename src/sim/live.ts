/**
 * Live weather edits: changing the wind (or dryness) WHILE the fire is playing, so the change
 * affects the fire from "now" on and leaves everything that already happened alone.
 *
 * How the history stays put: the solver samples the weather at the middle of each step of an
 * absolute grid (`stepS`). An edit made at playback time T therefore ramps in around the grid
 * boundary B = the first one at least stepS/2 + 30 s after T:
 *   - a keyframe at B - stepS/2 holds the weather exactly as it was (read from the schedule so far), and
 *   - a keyframe at B + stepS/2 holds the new weather.
 * Every solver step that ends by B is sampled at or before B - stepS/2, so it sees the old weather,
 * and nothing that burns before T can change. (Embers and sprayed cells sample at other times; the
 * extra 30 s covers the 60 s sprayed-cell steps.) An edit overrides the preset's trend from then on
 * (the user has taken over), so later preset keyframes are dropped.
 *
 * Pure: no DOM, no Cesium. The app keeps the edits in the store and calls `effectiveSchedule`.
 */

import type { Weather, WeatherKeyframe } from '../contract';
import { weatherAt } from './weather';
import type { WeatherState } from './weather';

/** Solver weather resolution used for single live runs (the default elsewhere is 600 s). */
export const LIVE_STEP_S = 120;
const SPRAY_MARGIN_S = 30;
/** Each edit adds two keyframes and a schedule may hold 200. */
export const MAX_LIVE_EDITS = 80;

export interface LiveEdit {
  /** Playback time the user made the change at. */
  madeAtS: number;
  /** Grid boundary the change is centred on (see above). */
  tSeconds: number;
  /** The complete weather from then on. */
  state: WeatherState;
}

/** The grid boundary a change made at `nowS` is centred on. */
export function liveEditTime(nowS: number, stepS: number = LIVE_STEP_S): number {
  return Math.ceil((nowS + stepS / 2 + SPRAY_MARGIN_S) / stepS) * stepS;
}

/**
 * Adds an edit made at `nowS`. Editing at a time discards edits that were centred later (they
 * described a future that no longer happens), and a second edit in the same slot replaces the first
 * (dragging a slider is many edits, one slot).
 */
export function addLiveEdit(edits: readonly LiveEdit[], nowS: number, state: WeatherState, stepS: number = LIVE_STEP_S): LiveEdit[] {
  const tSeconds = liveEditTime(nowS, stepS);
  const kept = edits.filter((e) => e.tSeconds < tSeconds);
  if (kept.length >= MAX_LIVE_EDITS) kept.pop();
  return [...kept, { madeAtS: nowS, tSeconds, state: { ...state } }];
}

/**
 * The weather schedule: the preset's keyframes with the edits applied in order. With
 * `ensureTimeline` an otherwise empty schedule gets one do-nothing keyframe after the end, which
 * makes the solver use its time-varying path (so a run with and without later edits shares one code
 * path and agrees exactly before the first edit).
 */
export function effectiveSchedule(
  base: Weather,
  preset: readonly WeatherKeyframe[],
  edits: readonly LiveEdit[],
  o: { stepS?: number; durationSeconds: number; ensureTimeline?: boolean },
): WeatherKeyframe[] {
  const stepS = o.stepS ?? LIVE_STEP_S;
  const half = stepS / 2;
  let sched: WeatherKeyframe[] = preset.map((k) => ({ ...k }));
  for (const e of [...edits].sort((a, b) => a.tSeconds - b.tSeconds)) {
    const tPre = e.tSeconds - half;
    if (tPre <= 0 || tPre >= o.durationSeconds) continue;
    const before = weatherAt(base, sched, tPre);
    sched = sched.filter((k) => k.tSeconds < tPre);
    sched.push({ tSeconds: tPre, ...before }, { tSeconds: e.tSeconds + half, ...e.state });
  }
  if (sched.length === 0 && o.ensureTimeline) {
    sched.push({
      tSeconds: o.durationSeconds + 3600,
      windSpeedMps: base.windSpeedMps, windFromDeg: base.windFromDeg, temperatureC: base.temperatureC, relativeHumidity: base.relativeHumidity,
    });
  }
  return sched;
}

/**
 * The weather the user should see at playback time `t`: a change they made at or before `t` that has
 * not finished ramping in shows its target straight away (so sliders do not jump back), otherwise
 * the weather from the schedule.
 */
export function displayWeather(base: Weather, schedule: readonly WeatherKeyframe[], edits: readonly LiveEdit[], t: number, stepS: number = LIVE_STEP_S): WeatherState {
  for (let i = edits.length - 1; i >= 0; i--) {
    const e = edits[i];
    if (e.madeAtS <= t && t < e.tSeconds + stepS / 2) return e.state;
  }
  return weatherAt(base, schedule as WeatherKeyframe[], t);
}
