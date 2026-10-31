/**
 * Crossing an edge into a sprayed cell while its moisture is changing.
 *
 * Evaluating an edge's speed once, when the source ignites, is wrong here: a source that ignites
 * later sees drier fuel and could beat an earlier one (a "non-FIFO" edge), which breaks Dijkstra and
 * lets a barrier make fire arrive EARLIER. Instead we integrate progress over time:
 *     integral of rate(moisture(tau)) d tau = distance.
 * The rate is piecewise constant on an ABSOLUTE time grid (spacing `step`, a function of the edge
 * only), so progress per grid interval does not depend on when the front started. That makes the
 * crossing time non-decreasing in the start time (FIFO) by construction, and, because moisture only
 * ever goes up with a spray, never earlier than the unsprayed crossing. See docs/sim-realism.md SIM-4.
 *
 * While the cell is at or above its extinction moisture the front waits for it to dry, but only
 * while the source is still burning (`burnout`).
 */

import { windTowardDeg } from '../contract';
import { sprayContribution, sprayStartsAround, timeUntilMoisture } from './events';
import type { EventLayers } from './events';
import type { EdgeInput, RateFn } from './models';
import type { WeatherTimeline } from './weather';

/** Spray contributions below this (moisture fraction) count as fully decayed. */
const FULLY_DECAYED = 1e-5;
const MAX_STEPS = 6000;
const MIN_STEP_S = 2;
const MAX_STEP_S = 512;
const bounds = { lo: 0, hi: 0 };

export interface Crossing {
  /** Arrival time at the target, Infinity if the front cannot cross. */
  t: number;
  /** Spread rate in the last interval, m/s. */
  rate: number;
}

export function crossWetEdge(
  layers: EventLayers,
  j: number,
  tStart: number,
  dist: number,
  baseMoisture: number,
  extinction: number,
  burnout: number,
  duration: number,
  rateFn: RateFn,
  edge: EdgeInput,
  out: Crossing,
): void {
  out.t = Infinity;
  out.rate = 0;
  edge.moisture = baseMoisture;
  const rBase = rateFn(edge);
  if (!(rBase > 0) || !Number.isFinite(rBase)) return;

  // Grid spacing: a power of two near (unsprayed crossing time) / 32, clamped. Depends only on the
  // edge, never on the start time or on the sprays, so every start sees the same grid.
  const t0 = dist / rBase;
  let step = MIN_STEP_S;
  while (step < MAX_STEP_S && step < t0 / 32) step *= 2;
  const firstBoundary = Math.floor(layers.sprayFirst[j] / step) * step;
  const lastStart = layers.sprayLast[j];
  const dryTarget = extinction * (1 - 1e-6);

  let tau = tStart;
  let remaining = dist;
  let lastRate = rBase;
  for (let it = 0; it < MAX_STEPS; it++) {
    if (tau > duration) return;

    // Before any spray can matter: plain base rate, jump straight to the first affected interval.
    if (tau < firstBoundary) {
      const need = remaining / rBase;
      if (tau + need <= firstBoundary) {
        out.t = tau + need;
        out.rate = rBase;
        return;
      }
      remaining -= rBase * (firstBoundary - tau);
      tau = firstBoundary;
      lastRate = rBase;
      continue;
    }

    // Interval: the absolute grid cell around tau, cut at this cell's spray start times so a spray
    // never begins mid-interval (the midpoint would miss it). Still independent of the start time.
    let lo = Math.floor(tau / step) * step;
    let end = lo + step;
    sprayStartsAround(layers, j, tau, bounds);
    if (bounds.lo > lo) lo = bounds.lo;
    if (bounds.hi < end) end = bounds.hi;
    const mid = (lo + end) / 2;
    const c = sprayContribution(layers, j, mid);

    // Every spray has started and the water is gone: base rate from here on.
    if (mid >= lastStart && c < FULLY_DECAYED) {
      out.t = tau + remaining / rBase;
      out.rate = rBase;
      return;
    }

    const m = baseMoisture + c;
    if (m >= extinction) {
      // Too wet to burn: wait for it to dry, if the source is still burning to light it.
      if (tau >= burnout) return;
      const tDry = timeUntilMoisture(layers, j, baseMoisture, dryTarget, tau);
      if (!Number.isFinite(tDry) || tDry >= burnout) return;
      tau = Math.max(end, Math.floor(tDry / step) * step);
      continue;
    }

    edge.moisture = m;
    const r = rateFn(edge);
    if (!(r > 0) || !Number.isFinite(r)) return;
    lastRate = r;
    const avail = end - tau;
    const need = remaining / r;
    if (need <= avail) {
      out.t = tau + need;
      out.rate = r;
      return;
    }
    remaining -= r * avail;
    tau = end;
  }
  // Step cap reached (extremely long crossing): finish at the last rate rather than block.
  out.t = tau + remaining / lastRate;
  out.rate = lastRate;
}

// ---------------------------------------------------------------------------------------------
// Time-varying weather
// ---------------------------------------------------------------------------------------------

export interface TimeVaryingContext {
  layers: EventLayers;
  timeline: WeatherTimeline;
  rateFn: RateFn;
  edge: EdgeInput;
  duration: number;
}

const SPRAYED_STEP_S = 60;
const DEG = Math.PI / 180;

/**
 * Like crossWetEdge, but the WEATHER changes with time too (wind speed and direction, and the
 * lagged fuel moisture), for every edge. Same idea: integrate progress over time on an absolute grid
 * (timeline.stepS, 600 s by default, or 60 s into a sprayed cell), with the weather piecewise constant at each
 * interval's midpoint, so the crossing time is non-decreasing in the start time (FIFO) and Dijkstra
 * stays correct. Used only when a weather schedule is present; steady weather keeps the closed form.
 *
 * A too-wet interval (moisture at or above extinction) makes the front wait, but only while the source
 * is still burning (`burnout`), as in crossWetEdge.
 *
 * Caller sets edge.fuel, edge.dz and edge.dist. ux, uy: unit direction of spread (x east, y north).
 * jitterDeg: this source cell's fixed wind-direction jitter.
 */
export function crossTimeVarying(
  c: TimeVaryingContext,
  j: number,
  tStart: number,
  dist: number,
  ux: number,
  uy: number,
  jitterDeg: number,
  extinction: number,
  burnout: number,
  out: Crossing,
): void {
  out.t = Infinity;
  out.rate = 0;
  const { layers, timeline, rateFn, edge } = c;
  const sprayed = layers.hasWater && layers.sprayHead[j] >= 0;
  const step = sprayed ? SPRAYED_STEP_S : timeline.stepS;
  let tau = tStart;
  let remaining = dist;
  let lastRate = 0;
  for (let it = 0; it < MAX_STEPS; it++) {
    if (tau > c.duration) return;
    let lo = Math.floor(tau / step) * step;
    let end = lo + step;
    if (sprayed) {
      sprayStartsAround(layers, j, tau, bounds);
      if (bounds.lo > lo) lo = bounds.lo;
      if (bounds.hi < end) end = bounds.hi;
    }
    const mid = (lo + end) / 2;
    const m = timeline.baseMoistureAt(mid) + (sprayed ? sprayContribution(layers, j, mid) : 0);
    let r = 0;
    if (m < extinction) {
      const a = (windTowardDeg(timeline.fromDegAt(mid)) + jitterDeg) * DEG;
      edge.windSpeedMps = timeline.speedAt(mid);
      edge.moisture = m;
      edge.cosTheta = ux * Math.sin(a) + uy * Math.cos(a);
      r = rateFn(edge);
    }
    if (!(r > 0) || !Number.isFinite(r)) {
      // Too wet (or no spread) this interval: wait for it to pass, if the source is still burning.
      if (tau >= burnout) return;
      tau = end;
      continue;
    }
    lastRate = r;
    const avail = end - tau;
    const need = remaining / r;
    if (need <= avail) {
      out.t = tau + need;
      out.rate = r;
      return;
    }
    remaining -= r * avail;
    tau = end;
  }
  if (lastRate > 0) {
    out.t = tau + remaining / lastRate;
    out.rate = lastRate;
  }
}
