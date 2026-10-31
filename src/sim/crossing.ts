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

import { sprayContribution, timeUntilMoisture } from './events';
import type { EventLayers } from './events';
import type { EdgeInput, RateFn } from './models';

/** Spray contributions below this (moisture fraction) count as fully decayed. */
const FULLY_DECAYED = 1e-5;
const MAX_STEPS = 6000;
const MIN_STEP_S = 2;
const MAX_STEP_S = 512;

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

    const end = (Math.floor(tau / step) + 1) * step;
    const mid = end - step / 2;
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
