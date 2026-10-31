/**
 * Weather over time. Built from Scenario.weather (the state at t = 0) plus the optional keyframes.
 *
 * Each of wind speed, wind direction, temperature and humidity is its own series, linearly
 * interpolated between the keyframes that set it (direction along the shorter arc), held after
 * the last one. Dead fuel moisture follows the weather with a time lag:
 *     equilibrium(t) = deriveFuelMoisture(T(t), RH(t)) + offset,   offset = m0 - deriveFuelMoisture(T0, RH0)
 *     dm/dt = (equilibrium - m) / lag          (m starts at Scenario.weather.baseFuelMoisture)
 * so a constant schedule reproduces the constant-weather run exactly, and an explicit moisture
 * override at t = 0 is respected. The moisture curve is a table at 60 s resolution.
 *
 * When there is no schedule `createWeatherTimeline` returns null and the solver keeps its fast
 * constant-weather path (byte-identical to before).
 */

import { deriveFuelMoisture } from '../contract';
import type { Scenario, Weather, WeatherKeyframe } from '../contract';

/** Default: weather is piecewise constant on this absolute grid inside the solver (see crossTimeVarying). */
export const WEATHER_STEP_S = 600;
const MOISTURE_TABLE_STEP_S = 60;

export interface WeatherTimeline {
  /** Resolution of the solver's weather grid, seconds. */
  readonly stepS: number;
  speedAt(t: number): number;
  fromDegAt(t: number): number;
  temperatureAt(t: number): number;
  humidityAt(t: number): number;
  /** Dead fuel moisture (fraction) with lag applied. */
  baseMoistureAt(t: number): number;
}

type Point = readonly [number, number];

function series(base: number, kf: Scenario['weatherSchedule'], pick: (k: NonNullable<Scenario['weatherSchedule']>[number]) => number | undefined): Point[] {
  const pts: Point[] = [[0, base]];
  for (const k of kf ?? []) {
    const v = pick(k);
    if (v === undefined) continue;
    if (k.tSeconds === 0) pts[0] = [0, v];
    else pts.push([k.tSeconds, v]);
  }
  return pts;
}

function interp(pts: Point[], t: number, angular: boolean): number {
  if (t <= pts[0][0]) return pts[0][1];
  const last = pts[pts.length - 1];
  if (t >= last[0]) return last[1];
  let i = 1;
  while (pts[i][0] < t) i++;
  const [t0, v0] = pts[i - 1];
  const [t1, v1] = pts[i];
  const f = (t - t0) / (t1 - t0);
  if (!angular) return v0 + (v1 - v0) * f;
  const d = ((((v1 - v0) % 360) + 540) % 360) - 180; // shorter arc, in [-180, 180)
  return (((v0 + d * f) % 360) + 360) % 360;
}

/** The four time-varying weather quantities. */
export interface WeatherState {
  windSpeedMps: number;
  /** Direction the wind blows FROM, degrees clockwise from north. */
  windFromDeg: number;
  temperatureC: number;
  /** 0-1 */
  relativeHumidity: number;
}

/** The weather at time t for a start state plus keyframes (same interpolation as the timeline, without the moisture table). */
export function weatherAt(w: Weather, kf: WeatherKeyframe[] | undefined, t: number): WeatherState {
  return {
    windSpeedMps: Math.max(0, interp(series(w.windSpeedMps, kf, (k) => k.windSpeedMps), t, false)),
    windFromDeg: interp(series(w.windFromDeg, kf, (k) => k.windFromDeg), t, true),
    temperatureC: interp(series(w.temperatureC, kf, (k) => k.temperatureC), t, false),
    relativeHumidity: Math.min(1, Math.max(0, interp(series(w.relativeHumidity, kf, (k) => k.relativeHumidity), t, false))),
  };
}

export function createWeatherTimeline(s: Scenario): WeatherTimeline | null {
  const kf = s.weatherSchedule;
  if (!kf || kf.length === 0) return null;
  const w = s.weather;
  const speed = series(w.windSpeedMps, kf, (k) => k.windSpeedMps);
  const from = series(w.windFromDeg, kf, (k) => k.windFromDeg);
  const temp = series(w.temperatureC, kf, (k) => k.temperatureC);
  const rh = series(w.relativeHumidity, kf, (k) => k.relativeHumidity);

  const offset = w.baseFuelMoisture - deriveFuelMoisture(w.temperatureC, w.relativeHumidity);
  const lag = s.settings.fuelMoistureLagS;
  const n = Math.ceil(s.durationSeconds / MOISTURE_TABLE_STEP_S) + 2;
  const table = new Float64Array(n);
  const eq = (t: number): number => Math.min(0.9, Math.max(0, deriveFuelMoisture(interp(temp, t, false), interp(rh, t, false)) + offset));
  table[0] = w.baseFuelMoisture;
  const decay = lag > 0 ? Math.exp(-MOISTURE_TABLE_STEP_S / lag) : 0;
  for (let k = 1; k < n; k++) {
    const e = eq((k - 0.5) * MOISTURE_TABLE_STEP_S); // equilibrium at the middle of the step
    table[k] = e + (table[k - 1] - e) * decay;
  }

  return {
    stepS: s.weatherStepS ?? WEATHER_STEP_S,
    speedAt: (t) => Math.max(0, interp(speed, t, false)),
    fromDegAt: (t) => interp(from, t, true),
    temperatureAt: (t) => interp(temp, t, false),
    humidityAt: (t) => Math.min(1, Math.max(0, interp(rh, t, false))),
    baseMoistureAt: (t) => {
      const x = Math.max(0, t) / MOISTURE_TABLE_STEP_S;
      const k = Math.min(n - 2, Math.floor(x));
      const f = Math.min(1, x - k);
      return table[k] + (table[k + 1] - table[k]) * f;
    },
  };
}
