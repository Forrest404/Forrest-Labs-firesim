/**
 * Ember spotting. A burning cell whose POTENTIAL head-fire intensity (a property of the cell, not of
 * the route the fire took to reach it) reaches `spottingIntensityKwM` throws embers downwind. Each ember
 * is described entirely by hashes of (seed, source cell, ember number), so the draws never depend on
 * what else happens in the run (see hash.ts).
 *
 *   embers per cell   n = round(spottingEmbers * sqrt(I / threshold)), at most 8
 *   mean distance     d = range * 15 m * U * sqrt(flame length)       (U in m/s; flame length from Byram)
 *   distance          lognormal around d (sigma 0.6), at least 2.3 cells (nearer is ordinary spread)
 *   direction         downwind, +-25 degrees uniform
 *   flight time       distance / (0.7 U)   then a 30 s ignition delay
 *   success           spottingIgnitionProb * (1 - m / Mx)^2, on burnable fuel, not wetter than extinction
 *                     at landing time, and not already cleared by a firebreak
 *
 * Embers fly over water, roads and firebreaks, which is the whole point: with spotting on a firebreak
 * is no longer an absolute barrier. All constants are placeholders: a crude stand-in for Albini's
 * (1979, 1983) spotting-distance models, NOT calibrated. See docs/sim-realism.md SIM-10.
 */

import { FUELS } from '../contract';
import type { FuelClass, SimSettings } from '../contract';
import { sprayContribution } from './events';
import type { EventLayers } from './events';
import { hashNormal, hashUnit } from './hash';
import { byramIntensityKwM, flameLengthM } from './intensity';
import type { EdgeInput, RateFn } from './models';
import { KING_MOVES, NEIGHBOR_OFFSETS } from './rates';

/** Landings closer than this many cells are ordinary spread, not spotting. */
export const SPOT_MIN_DISTANCE_CELLS = 2.3;
export const MAX_EMBERS_PER_CELL = 8;
const DISTANCE_COEFF = 15;
const DISTANCE_SIGMA = 0.6;
const LATERAL_SPREAD_RAD = (25 * Math.PI) / 180;
const FLIGHT_SPEED_FRACTION = 0.7;
const IGNITION_DELAY_S = 30;
const MIN_WIND_MPS = 0.5;

export interface SpotterInput {
  settings: SimSettings;
  seed: number;
  width: number;
  height: number;
  cellSizeM: number;
  fuel: Uint8Array;
  elevation: Float32Array;
  baseMoisture: number;
  windSpeedMps: number;
  /** Per-cell downwind unit vector (x east, y north). */
  windX: Float32Array;
  windY: Float32Array;
  events: EventLayers;
  rateFn: RateFn;
  edge: EdgeInput;
}

export interface Spotter {
  /** Throws the embers of `src`, which ignited at time `t`; calls emit(target, arrivalTime) per success. */
  spot(src: number, t: number, emit: (target: number, tArrival: number) => void): void;
  /** Potential head-fire spread rate (m/s) at a cell at time t: wind-driven, steepest uphill. */
  headRate(cell: number, t: number): number;
}

export function createSpotter(c: SpotterInput): Spotter {
  const { settings, seed, width, height, cellSizeM, fuel, elevation, baseMoisture, events, rateFn, edge } = c;
  const U = c.windSpeedMps;

  function headRate(cell: number, t: number): number {
    const fs = fuel[cell];
    const row = (cell / width) | 0;
    const col = cell - row * width;
    let tanUp = 0;
    for (let k = 0; k < KING_MOVES; k++) {
      const o = NEIGHBOR_OFFSETS[k];
      const r2 = row + o.dr;
      const c2 = col + o.dc;
      if (r2 < 0 || c2 < 0 || r2 >= height || c2 >= width) continue;
      const tan = (elevation[r2 * width + c2] - elevation[cell]) / (cellSizeM * o.distFactor);
      if (tan > tanUp) tanUp = tan;
    }
    edge.fuel = fs;
    edge.moisture = events.hasWater && events.sprayHead[cell] >= 0 ? baseMoisture + sprayContribution(events, cell, t) : baseMoisture;
    edge.cosTheta = 1;
    edge.windSpeedMps = U;
    edge.dz = tanUp * cellSizeM;
    edge.dist = cellSizeM;
    const r = rateFn(edge);
    return r > 0 && Number.isFinite(r) ? r : 0;
  }

  function spot(src: number, t: number, emit: (target: number, tArrival: number) => void): void {
    if (U < MIN_WIND_MPS || fuel[src] === 0) return;
    const rate = headRate(src, t);
    if (!(rate > 0)) return;
    const bed = FUELS[fuel[src] as FuelClass].bed;
    const intensity = byramIntensityKwM(bed.heatContentJkg, bed.loadKgM2, rate);
    if (intensity < settings.spottingIntensityKwM) return;

    const n = Math.min(MAX_EMBERS_PER_CELL, Math.round(settings.spottingEmbers * Math.sqrt(intensity / settings.spottingIntensityKwM)));
    if (n <= 0) return;
    const meanDist = settings.spottingRangeScale * DISTANCE_COEFF * U * Math.sqrt(flameLengthM(intensity));
    const row = (src / width) | 0;
    const col = src - row * width;
    const heading = Math.atan2(c.windX[src], c.windY[src]); // clockwise from north, direction the wind blows toward

    for (let k = 0; k < n; k++) {
      const dist = meanDist * Math.exp(DISTANCE_SIGMA * hashNormal(seed, src, k, 1) - (DISTANCE_SIGMA * DISTANCE_SIGMA) / 2);
      if (dist < SPOT_MIN_DISTANCE_CELLS * cellSizeM) continue;
      const th = heading + (hashUnit(seed, src, k, 2) * 2 - 1) * LATERAL_SPREAD_RAD;
      const tr = Math.round(row - (dist * Math.cos(th)) / cellSizeM);
      const tc = Math.round(col + (dist * Math.sin(th)) / cellSizeM);
      if (tr < 0 || tc < 0 || tr >= height || tc >= width) continue;
      const target = tr * width + tc;
      if (target === src) continue;
      const ft = fuel[target];
      if (ft === 0) continue;
      const mx = FUELS[ft as FuelClass].extinctionMoisture;
      if (baseMoisture >= mx) continue;
      const dry = 1 - baseMoisture / mx;
      if (hashUnit(seed, src, k, 3) >= settings.spottingIgnitionProb * dry * dry) continue;
      const tLand = t + dist / (FLIGHT_SPEED_FRACTION * U);
      if (events.hasWater && events.sprayHead[target] >= 0 && baseMoisture + sprayContribution(events, target, tLand) >= mx) continue;
      emit(target, tLand + IGNITION_DELAY_S);
    }
  }

  return { spot, headRate };
}
