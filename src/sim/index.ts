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
import { buildEventLayers, moistureAt, timeUntilMoisture } from './events';
import { MinHeap } from './heap';
import { mulberry32 } from './prng';
import {
  NEIGHBOR_OFFSETS,
  combineRate,
  cosAgainstWind,
  moistureFactor,
  slopeFactor,
  windFactor,
} from './rates';

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
  const done = new Uint8Array(n);
  const events = buildEventLayers(scenario.interventions, n, settings);

  // Per-cell downwind unit vector (x east, y north). Optional seeded jitter of the direction.
  const windX = new Float32Array(n);
  const windY = new Float32Array(n);
  {
    const variability = weather.windVariabilityDeg ?? 0;
    const rand = mulberry32(scenario.seed);
    const toward = windTowardDeg(weather.windFromDeg);
    for (let i = 0; i < n; i++) {
      const jitter = variability > 0 ? (rand() * 2 - 1) * variability : 0;
      const a = (toward + jitter) * DEG;
      windX[i] = Math.sin(a);
      windY[i] = Math.cos(a);
    }
  }

  // Per-fuel lookups as flat arrays indexed by class id.
  const baseRate = new Float32Array(FUELS_COUNT);
  const extinction = new Float32Array(FUELS_COUNT);
  const burnDuration = new Float32Array(FUELS_COUNT);
  for (let c = 0; c < FUELS_COUNT; c++) {
    const spec = FUELS[c as FuelClass];
    baseRate[c] = spec.baseRateMps;
    extinction[c] = spec.extinctionMoisture;
    burnDuration[c] = spec.burnDurationS;
  }

  const heap = new MinHeap(Math.max(1024, n >> 2));
  for (const ig of scenario.ignition) {
    const i = ig.row * width + ig.col;
    if (arrival[i] > 0) {
      arrival[i] = 0;
      heap.push(0, i);
    }
  }

  const windSpeed = weather.windSpeedMps;
  let maxRate = 0;

  while (heap.size > 0) {
    const t = heap.peekKey();
    const i = heap.pop();
    if (done[i]) continue;
    done[i] = 1;

    const row = (i / width) | 0;
    const col = i - row * width;
    const fuelSrc = fuel[i];
    const burnout = settings.burnoutEnabled && fuelSrc !== FuelClass.NONE ? t + burnDuration[fuelSrc] : NEVER_ARRIVES;
    const wx = windX[i];
    const wy = windY[i];
    const ei = elevation[i];

    for (let k = 0; k < 8; k++) {
      const off = NEIGHBOR_OFFSETS[k];
      const r2 = row + off.dr;
      const c2 = col + off.dc;
      if (r2 < 0 || c2 < 0 || r2 >= height || c2 >= width) continue;
      const j = r2 * width + c2;
      if (done[j]) continue;
      const fj = fuel[j];
      if (fj === FuelClass.NONE) continue;
      const mx = extinction[fj];
      if (mx <= baseMoisture) continue;

      const dist = cellSizeM * off.distFactor;
      const wind = windFactor(cosAgainstWind(off, wx, wy), windSpeed, settings);
      const slope = slopeFactor(elevation[j] - ei, dist, settings);

      // Arrival if the fire leaves the source at time tLeave, given the cell's moisture then.
      const arriveIfLeaving = (tLeave: number): { tArr: number; rate: number } => {
        const m = events.hasWater ? moistureAt(events, j, tLeave, baseMoisture) : baseMoisture;
        const r = m < mx ? combineRate(baseRate[fj], wind, slope, moistureFactor(m, mx), settings) : 0;
        return { tArr: r > 0 ? tLeave + dist / r : NEVER_ARRIVES, rate: r };
      };
      let { tArr, rate } = arriveIfLeaving(t);
      // A sprayed cell dries over time, so leaving later can mean arriving sooner. The fire may
      // wait at the source (while it still burns) for the best moment. Taking that minimum makes
      // arrival non-decreasing in t, which keeps Dijkstra correct and means more water or a later
      // source can never make a cell burn earlier. Approximation, see DECISIONS.md D3.
      if (events.hasWater && events.sprays.has(j)) {
        const nearlyDry = baseMoisture + 1e-3 * (mx - baseMoisture);
        const tDry = timeUntilMoisture(events, j, baseMoisture, nearlyDry, t);
        let lo = t;
        let hi = Math.min(tDry === NEVER_ARRIVES ? duration : tDry, burnout, duration);
        if (hi > lo) {
          // Arrival vs leave time is unimodal (infinite while too wet, then falling, then rising
          // once the cell is dry), so a ternary search finds the best leave time.
          for (let it = 0; it < 60 && hi - lo > 1e-3; it++) {
            const a = lo + (hi - lo) / 3;
            const b = hi - (hi - lo) / 3;
            if (arriveIfLeaving(a).tArr <= arriveIfLeaving(b).tArr && Number.isFinite(arriveIfLeaving(a).tArr)) hi = b;
            else lo = a;
          }
          for (const cand of [lo, hi]) {
            const o = arriveIfLeaving(cand);
            if (o.tArr < tArr) ({ tArr, rate } = o);
          }
        }
      }
      if (!(rate > 0)) continue;
      if (tArr >= events.breakT[j] || tArr > duration) continue;
      if (tArr < arrival[j]) {
        arrival[j] = tArr;
        rateAtIgnition[j] = rate;
        if (rate > maxRate) maxRate = rate;
        heap.push(tArr, j);
      }
    }
  }

  // Firebreak cells cleared at t=0 are non-burnable from the start; make sure none report an arrival.
  let burnedCells = 0;
  for (let i = 0; i < n; i++) if (arrival[i] !== NEVER_ARRIVES) burnedCells++;

  const intensity = new Float32Array(n);
  if (maxRate > 0) for (let i = 0; i < n; i++) intensity[i] = rateAtIgnition[i] / maxRate;

  return {
    arrivalTime: arrival,
    intensity,
    stats: {
      burnedCells,
      burnedAreaHa: burnedCells * cellAreaHa(grid),
      maxSpreadRateMps: maxRate,
      runtimeMs: now() - t0,
    },
  };
}

const FUELS_COUNT = Object.keys(FUELS).length;

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}
