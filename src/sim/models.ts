/**
 * Rate-of-spread models. The solver builds one RateFn per run and calls it for every edge
 * (burning cell -> neighbour). Adding a model: implement a factory below, add its id to
 * RateModelId in the contract (announce it), register it in createRateFn, and add it to MODELS in
 * tests/invariants.test.ts so it must pass the invariant suite.
 *
 * Contract for a RateFn: returns metres per second, finite, >= 0. Zero means "cannot spread".
 * It must be non-increasing in moisture, and (for the head direction) non-decreasing in wind.
 */

import { FUELS, FUEL_CLASS_COUNT } from '../contract';
import type { FuelClass, Scenario, SimSettings } from '../contract';
import { combineRate, moistureFactor, slopeFactor, windFactor } from './rates';
import { MS_TO_FTMIN, prepareBed, reaction, spreadRate } from './rothermel';
import type { PreparedBed, Reaction } from './rothermel';

/** Mutable edge description, reused for every call (no allocation in the inner loop). */
export interface EdgeInput {
  /** FuelClass of the TARGET cell. */
  fuel: number;
  /** Fuel moisture of the target at the time the source ignites, fraction. */
  moisture: number;
  /** Cosine of the angle between the spread direction and the direction the wind blows toward. */
  cosTheta: number;
  /** Wind speed in m/s (open 10 m wind; models apply their own sheltering). */
  windSpeedMps: number;
  /** Elevation of target minus source, m. */
  dz: number;
  /** Centre-to-centre distance, m. */
  dist: number;
}

export type RateFn = (e: EdgeInput) => number;

export function createRateFn(s: Scenario): RateFn {
  switch (s.settings.rateModel) {
    case 'rothermel':
      return rothermelModel(s.settings);
    case 'iso':
      return isoModel(s.settings);
    case 'factors':
    default:
      return factorsModel(s.settings);
  }
}

/** Demo-tuned product of simple factors (the v0 model). Order of multiplication is fixed on purpose. */
function factorsModel(settings: SimSettings): RateFn {
  const base = new Float64Array(FUEL_CLASS_COUNT);
  const ext = new Float64Array(FUEL_CLASS_COUNT);
  for (let c = 0; c < FUEL_CLASS_COUNT; c++) {
    base[c] = FUELS[c as FuelClass].baseRateMps;
    ext[c] = FUELS[c as FuelClass].extinctionMoisture;
  }
  return (e) =>
    combineRate(
      base[e.fuel],
      windFactor(e.cosTheta, e.windSpeedMps, settings),
      slopeFactor(e.dz, e.dist, settings),
      moistureFactor(e.moisture, ext[e.fuel]),
      settings,
    );
}

/** Constant speed everywhere (blocked only by non-burnable cells and the solver's moisture check). */
function isoModel(settings: SimSettings): RateFn {
  const v = settings.isoSpeedMps * settings.globalMultiplier;
  return () => v;
}

const MOISTURE_STEP = 0.0005;

/**
 * Rothermel head-fire rate along each direction: the wind term uses the component of the midflame
 * wind along the direction of spread (backing and flank spread get no wind boost) and the slope
 * term uses the upslope tangent along that direction (downhill gets none). Reaction terms are
 * cached per fuel and moisture bucket so the inner loop stays cheap.
 */
function rothermelModel(settings: SimSettings): RateFn {
  const beds: PreparedBed[] = [];
  const waf = new Float64Array(FUEL_CLASS_COUNT);
  const cache: Reaction[][] = [];
  for (let c = 0; c < FUEL_CLASS_COUNT; c++) {
    const spec = FUELS[c as FuelClass];
    beds.push(prepareBed(spec.bed, spec.extinctionMoisture));
    waf[c] = spec.bed.windReduction;
    cache.push([]);
  }
  const k = settings.globalMultiplier;
  return (e) => {
    const bed = beds[e.fuel];
    if (!bed.valid || e.moisture >= bed.mx) return 0;
    const bucket = Math.floor(e.moisture / MOISTURE_STEP);
    let r = cache[e.fuel][bucket];
    if (!r) {
      r = reaction(bed, bucket * MOISTURE_STEP);
      cache[e.fuel][bucket] = r;
    }
    const along = e.windSpeedMps * waf[e.fuel] * settings.windStrength * (e.cosTheta > 0 ? e.cosTheta : 0);
    const tan = (e.dz > 0 ? e.dz / e.dist : 0) * settings.slopeStrength;
    return spreadRate(bed, r, along * MS_TO_FTMIN, tan) * k;
  };
}
