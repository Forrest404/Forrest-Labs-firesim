/**
 * FROZEN shared contract. Do not edit without telling the team in chat.
 *
 * Structural validation of a Scenario. Returns a list of human-readable problems; empty means
 * valid. The sim calls this before running; the UI shows the first problem on failure.
 */

import { ELEVATION_NODATA, MAX_GRID_DIM, inGrid } from './conventions';
import { FUEL_CLASS_COUNT } from './types';
import type { Scenario } from './types';

export function validateScenario(s: Scenario): string[] {
  const errors: string[] = [];
  const { grid } = s;
  const n = grid.width * grid.height;

  if (!Number.isInteger(grid.width) || !Number.isInteger(grid.height) || grid.width < 2 || grid.height < 2) {
    errors.push(`grid size must be integers >= 2, got ${grid.width} x ${grid.height}`);
  }
  if (grid.width > MAX_GRID_DIM || grid.height > MAX_GRID_DIM) {
    errors.push(`grid exceeds MAX_GRID_DIM ${MAX_GRID_DIM}: ${grid.width} x ${grid.height}`);
  }
  if (!(grid.cellSizeM > 0)) errors.push(`cellSizeM must be > 0, got ${grid.cellSizeM}`);
  if (!Number.isFinite(grid.originLon) || !Number.isFinite(grid.originLat)) {
    errors.push('grid origin must be finite lon/lat');
  }

  if (s.fuel.length !== n) errors.push(`fuel length ${s.fuel.length} != ${n}`);
  if (s.elevation.length !== n) errors.push(`elevation length ${s.elevation.length} != ${n}`);
  if (s.canopyHeight && s.canopyHeight.length !== n) {
    errors.push(`canopyHeight length ${s.canopyHeight.length} != ${n}`);
  }

  if (s.fuel.length === n) {
    for (let i = 0; i < n; i++) {
      if (s.fuel[i] >= FUEL_CLASS_COUNT) {
        errors.push(`fuel[${i}] = ${s.fuel[i]} is not a FuelClass`);
        break;
      }
    }
  }
  if (s.elevation.length === n) {
    for (let i = 0; i < n; i++) {
      const e = s.elevation[i];
      if (!Number.isFinite(e) || e === ELEVATION_NODATA) {
        errors.push(`elevation[${i}] = ${e} is nodata or not finite; builder must fill gaps`);
        break;
      }
    }
  }

  if (s.ignition.length === 0) errors.push('at least one ignition cell is required');
  for (const ig of s.ignition) {
    if (!inGrid(grid, ig.row, ig.col)) errors.push(`ignition (${ig.row}, ${ig.col}) outside grid`);
  }

  for (const iv of s.interventions) {
    if (!(iv.tSeconds >= 0)) errors.push(`intervention ${iv.id} has tSeconds ${iv.tSeconds} < 0`);
    if (iv.type !== 'firebreak' && iv.type !== 'water') {
      errors.push(`intervention ${iv.id} has unknown type ${String(iv.type)}`);
    }
    for (const c of iv.cells) {
      if (!Number.isInteger(c) || c < 0 || c >= n) {
        errors.push(`intervention ${iv.id} has cell ${c} outside grid`);
        break;
      }
    }
  }

  if (!(s.durationSeconds > 0)) errors.push(`durationSeconds must be > 0, got ${s.durationSeconds}`);
  if (!Number.isInteger(s.seed)) errors.push(`seed must be an integer, got ${s.seed}`);

  const w = s.weather;
  if (!(w.windSpeedMps >= 0)) errors.push('windSpeedMps must be >= 0');
  if (!(w.relativeHumidity >= 0 && w.relativeHumidity <= 1)) errors.push('relativeHumidity must be 0-1');
  if (!(w.baseFuelMoisture >= 0 && w.baseFuelMoisture <= 1)) errors.push('baseFuelMoisture must be 0-1');
  if (!['factors', 'rothermel', 'iso'].includes(s.settings.rateModel)) errors.push(`unknown rateModel ${String(s.settings.rateModel)}`);
  if (s.settings.neighbourhood !== 8 && s.settings.neighbourhood !== 16) errors.push('neighbourhood must be 8 or 16');
  if (!(s.settings.isoSpeedMps >= 0)) errors.push('isoSpeedMps must be >= 0');
  if (!(s.settings.fuelMoistureLagS >= 0)) errors.push('fuelMoistureLagS must be >= 0');
  const sched = s.weatherSchedule ?? [];
  if (sched.length > 200) errors.push('weatherSchedule has more than 200 keyframes');
  let lastT = -Infinity;
  for (const k of sched) {
    if (!Number.isFinite(k.tSeconds) || k.tSeconds < 0) errors.push(`weather keyframe time ${k.tSeconds} must be >= 0`);
    else if (k.tSeconds <= lastT) errors.push(`weather keyframe times must be strictly increasing (at ${k.tSeconds})`);
    lastT = Math.max(lastT, k.tSeconds);
    if (k.windSpeedMps !== undefined && !(k.windSpeedMps >= 0 && k.windSpeedMps < 200)) errors.push(`weather keyframe wind speed ${k.windSpeedMps} out of range`);
    if (k.windFromDeg !== undefined && !Number.isFinite(k.windFromDeg)) errors.push('weather keyframe wind direction must be finite');
    if (k.temperatureC !== undefined && !(k.temperatureC > -60 && k.temperatureC < 70)) errors.push(`weather keyframe temperature ${k.temperatureC} out of range`);
    if (k.relativeHumidity !== undefined && !(k.relativeHumidity >= 0 && k.relativeHumidity <= 1)) errors.push(`weather keyframe humidity ${k.relativeHumidity} must be 0-1`);
  }
  const st = s.settings;
  if (!(st.spottingIntensityKwM > 0)) errors.push('spottingIntensityKwM must be > 0');
  if (!(st.spottingEmbers >= 0 && st.spottingEmbers <= 8)) errors.push('spottingEmbers must be 0-8');
  if (!(st.spottingRangeScale >= 0)) errors.push('spottingRangeScale must be >= 0');
  if (!(st.spottingIgnitionProb >= 0 && st.spottingIgnitionProb <= 1)) errors.push('spottingIgnitionProb must be 0-1');

  return errors;
}

export function assertValidScenario(s: Scenario): void {
  const errors = validateScenario(s);
  if (errors.length > 0) throw new Error(`Invalid scenario: ${errors.join('; ')}`);
}
