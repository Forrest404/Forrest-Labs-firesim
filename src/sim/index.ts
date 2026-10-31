/**
 * Pure simulation core: minimum-travel-time fire spread (Dijkstra over the 8-neighbour grid).
 * Deterministic for a given scenario. No DOM, no Cesium, no Math.random. See DECISIONS.md D3.
 */

import {
  FUELS,
  FuelClass,
  NEVER_ARRIVES,
  assertValidScenario,
  cellAreaHa,
  windTowardDeg,
} from '../contract';
import type { Scenario, SimResult } from '../contract';
import { crossTimeVarying, crossWetEdge } from './crossing';
import type { Crossing, TimeVaryingContext } from './crossing';
import { buildEventLayers } from './events';
import { MinHeap } from './heap';
import { byramIntensityKwM, flameLengthM } from './intensity';
import { createRateFn } from './models';
import { createSpotter } from './spotting';
import type { EdgeInput } from './models';
import { mulberry32 } from './prng';
import { NEIGHBOR_OFFSETS, KING_MOVES, cosAgainstWind } from './rates';
import { createWeatherTimeline } from './weather';

const DEG = Math.PI / 180;

export function simulate(scenario: Scenario): SimResult {
  const t0 = now();
  assertValidScenario(scenario);

  const { grid, fuel, elevation, weather, settings } = scenario;
  const { width, height, cellSizeM } = grid;
  const n = width * height;
  const duration = scenario.durationSeconds;
  const baseMoisture = weather.baseFuelMoisture;

  const arrival = new Float32Array(n).fill(NEVER_ARRIVES);
  const rateAtIgnition = new Float32Array(n);
  const sourceCell = new Int32Array(n).fill(-1);
  const viaEmber = new Uint8Array(n);
  const done = new Uint8Array(n);
  const events = buildEventLayers(scenario.interventions, n, settings);

  // Per-cell downwind unit vector (x east, y north). Optional seeded jitter of the direction.
  const windX = new Float32Array(n);
  const windY = new Float32Array(n);
  const jitterDeg = new Float32Array(n); // each cell's fixed direction jitter (used when the weather changes over time)
  {
    const variability = weather.windVariabilityDeg ?? 0;
    const rand = mulberry32(scenario.seed);
    const toward = windTowardDeg(weather.windFromDeg);
    for (let i = 0; i < n; i++) {
      const jitter = variability > 0 ? (rand() * 2 - 1) * variability : 0;
      jitterDeg[i] = jitter;
      const a = (toward + jitter) * DEG;
      windX[i] = Math.sin(a);
      windY[i] = Math.cos(a);
    }
  }

  // Per-fuel lookups as flat arrays indexed by class id.
  const extinction = new Float64Array(FUELS_COUNT);
  const burnDuration = new Float64Array(FUELS_COUNT);
  for (let c = 0; c < FUELS_COUNT; c++) {
    const spec = FUELS[c as FuelClass];
    extinction[c] = spec.extinctionMoisture;
    burnDuration[c] = spec.burnDurationS;
  }

  // The rate-of-spread model (settings.rateModel) and a reusable edge record for it.
  const rateFn = createRateFn(scenario);
  const edge: EdgeInput = { fuel: 0, moisture: 0, cosTheta: 0, windSpeedMps: weather.windSpeedMps, dz: 0, dist: 0 };

  const heap = new MinHeap(Math.max(1024, n >> 2));
  for (const ig of scenario.ignition) {
    const i = ig.row * width + ig.col;
    if (arrival[i] > 0) {
      arrival[i] = 0;
      heap.push(0, i);
    }
  }

  const crossing: Crossing = { t: Infinity, rate: 0 };
  // Weather that changes over time (null = steady: the fast path, identical to before).
  const timeline = createWeatherTimeline(scenario);
  const tvCtx: TimeVaryingContext | null = timeline ? { layers: events, timeline, rateFn, edge, duration } : null;
  const moves = settings.neighbourhood;

  // Ember spotting (off unless settings.spottingEnabled): embers become extra, positive-delay edges.
  let curSource = -1;
  const spotter = settings.spottingEnabled
    ? createSpotter({
        settings, seed: scenario.seed, width, height, cellSizeM, fuel, elevation, baseMoisture,
        windSpeedMps: weather.windSpeedMps, windX, windY, events, rateFn, edge, timeline, jitterDeg,
      })
    : null;
  const emitEmber = (target: number, tArr: number): void => {
    if (tArr > duration || tArr >= events.breakT[target] || tArr >= arrival[target]) return;
    arrival[target] = tArr;
    sourceCell[target] = curSource;
    viaEmber[target] = 1;
    heap.push(tArr, target);
  };
  let maxRate = 0;

  while (heap.size > 0) {
    const t = heap.peekKey();
    const i = heap.pop();
    if (done[i]) continue;
    done[i] = 1;
    if (spotter) {
      curSource = i;
      spotter.spot(i, t, emitEmber);
    }

    const row = (i / width) | 0;
    const col = i - row * width;
    const fuelSrc = fuel[i];
    const burnout = settings.burnoutEnabled && fuelSrc !== FuelClass.NONE ? t + burnDuration[fuelSrc] : NEVER_ARRIVES;
    const wx = windX[i];
    const wy = windY[i];
    const ei = elevation[i];

    for (let k = 0; k < moves; k++) {
      const off = NEIGHBOR_OFFSETS[k];
      const r2 = row + off.dr;
      const c2 = col + off.dc;
      if (r2 < 0 || c2 < 0 || r2 >= height || c2 >= width) continue;
      const j = r2 * width + c2;
      if (done[j]) continue;
      const fj = fuel[j];
      if (fj === FuelClass.NONE) continue;
      const mx = extinction[fj];
      if (!timeline && mx <= baseMoisture) continue;

      // Knight move: only across two cells that are the same fuel as the target, unsprayed (see
      // rates.ts). Their firebreak status is checked once the arrival time is known.
      let m1 = -1;
      let m2 = -1;
      if (k >= KING_MOVES) {
        m1 = (row + off.m1r) * width + (col + off.m1c);
        m2 = (row + off.m2r) * width + (col + off.m2c);
        if (fuel[m1] !== fj || fuel[m2] !== fj) continue;
        if (events.hasWater && (events.sprayHead[m1] >= 0 || events.sprayHead[m2] >= 0)) continue;
      }

      const dist = cellSizeM * off.distFactor;

      edge.fuel = fj;
      edge.cosTheta = cosAgainstWind(off, wx, wy);
      edge.dz = elevation[j] - ei;
      edge.dist = dist;
      let tArr: number;
      let rate: number;
      if (tvCtx) {
        // Weather changes over time: integrate every edge over the schedule (FIFO-safe).
        crossTimeVarying(tvCtx, j, t, dist, off.ux, off.uy, jitterDeg[i], mx, burnout, crossing);
        tArr = crossing.t;
        rate = crossing.rate;
        if (!(tArr < Infinity)) continue;
      } else if (events.hasWater && events.sprayHead[j] >= 0) {
        // Sprayed target: integrate over its changing moisture (FIFO-safe), see crossing.ts.
        crossWetEdge(events, j, t, dist, baseMoisture, mx, burnout, duration, rateFn, edge, crossing);
        tArr = crossing.t;
        rate = crossing.rate;
        if (!(tArr < Infinity)) continue;
      } else {
        edge.moisture = baseMoisture;
        rate = rateFn(edge);
        if (!(rate > 0) || !Number.isFinite(rate)) continue;
        tArr = t + dist / rate;
      }
      if (tArr >= events.breakT[j] || tArr > duration) continue;
      if (m1 >= 0 && (tArr >= events.breakT[m1] || tArr >= events.breakT[m2])) continue;
      if (tArr < arrival[j]) {
        arrival[j] = tArr;
        sourceCell[j] = i;
        viaEmber[j] = 0;
        rateAtIgnition[j] = rate;
        if (rate > maxRate) maxRate = rate;
        heap.push(tArr, j);
      }
    }
  }

  // Firebreak cells cleared at t=0 are non-burnable from the start; make sure none report an arrival.
  let burnedCells = 0;
  for (let i = 0; i < n; i++) if (arrival[i] !== NEVER_ARRIVES) burnedCells++;

  // Spot fires have no spread edge: use the cell's potential head-fire rate for their intensity.
  let spotFires = 0;
  if (spotter) {
    for (let i = 0; i < n; i++) {
      if (!viaEmber[i] || arrival[i] === NEVER_ARRIVES) continue;
      rateAtIgnition[i] = spotter.headRate(i, arrival[i]);
      spotFires++;
    }
  }

  // Ignition cells have no incoming edge: give them the strongest spread they started.
  for (const ig of scenario.ignition) {
    const i = ig.row * width + ig.col;
    let best = 0;
    for (let k = 0; k < KING_MOVES; k++) {
      const o = NEIGHBOR_OFFSETS[k];
      const r2 = ig.row + o.dr;
      const c2 = ig.col + o.dc;
      if (r2 < 0 || c2 < 0 || r2 >= height || c2 >= width) continue;
      const j = r2 * width + c2;
      if (arrival[j] !== NEVER_ARRIVES && rateAtIgnition[j] > best) best = rateAtIgnition[j];
    }
    rateAtIgnition[i] = best;
  }

  const intensity = new Float32Array(n);
  const firelineIntensity = new Float32Array(n);
  const flameLength = new Float32Array(n);
  let maxIntensity = 0;
  let maxFlame = 0;
  for (let i = 0; i < n; i++) {
    if (arrival[i] === NEVER_ARRIVES) continue;
    if (maxRate > 0) intensity[i] = Math.min(1, rateAtIgnition[i] / maxRate);
    const bed = FUELS[fuel[i] as FuelClass].bed;
    const kwPerM = byramIntensityKwM(bed.heatContentJkg, bed.loadKgM2, rateAtIgnition[i]);
    firelineIntensity[i] = kwPerM;
    flameLength[i] = flameLengthM(kwPerM);
    if (kwPerM > maxIntensity) maxIntensity = kwPerM;
    if (flameLength[i] > maxFlame) maxFlame = flameLength[i];
  }

  return {
    arrivalTime: arrival,
    intensity,
    firelineIntensityKwM: firelineIntensity,
    flameLengthM: flameLength,
    sourceCell,
    ignitedByEmber: viaEmber,
    stats: {
      burnedCells,
      burnedAreaHa: burnedCells * cellAreaHa(grid),
      maxSpreadRateMps: maxRate,
      spotFires,
      maxIntensityKwM: maxIntensity,
      maxFlameLengthM: maxFlame,
      runtimeMs: now() - t0,
    },
  };
}

const FUELS_COUNT = Object.keys(FUELS).length;

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}
