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
  if (s.settings.spottingEnabled) errors.push('spottingEnabled is a stub and must be false in v0');

  return errors;
}

export function assertValidScenario(s: Scenario): void {
  const errors = validateScenario(s);
  if (errors.length > 0) throw new Error(`Invalid scenario: ${errors.join('; ')}`);
}
