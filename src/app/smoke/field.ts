/** One lattice step of the smoke field: emission -> advection -> diffusion -> decay. */

import { emissionBetween } from './emission';
import type { EmissionTables, SmokeInputs } from './emission';
import type { SmokeParams } from './params';
import { briggsFinalRise, buoyancyFlux, windSpeedFactor } from './plume';
import { advect, blur, decay } from './transport';
import { windAtStep } from './wind';

export interface StepScratch {
  emis: Float32Array;
  emisSmolder: Float32Array;
  tmp: Float32Array;
}

export interface StepInfo {
  /** Global plume top above ground this step, m (0 when nothing is flaming). */
  plumeTopM: number;
  /** Smoldering share of this step's emission, 0..1. */
  smolderFrac: number;
  /** kg emitted this step. */
  emitted: number;
  ux: number;
  uy: number;
  speed: number;
}

export function makeScratch(n: number): StepScratch {
  return { emis: new Float32Array(n), emisSmolder: new Float32Array(n), tmp: new Float32Array(n) };
}

/**
 * Advances `conc` (lattice step k) into `next` (step k+1). `conc` is modified in place by the
 * emission (so callers treat the pair as a double buffer and swap afterwards).
 */
export function stepField(conc: Float32Array, next: Float32Array, k: number, tbl: EmissionTables, inp: SmokeInputs, p: SmokeParams, scratch: StepScratch): StepInfo {
  const { width: w, height: h, cellSizeM: cell } = inp.grid;
  const t0 = k * p.stepS;
  const t1 = t0 + p.stepS;

  scratch.emis.fill(0);
  scratch.emisSmolder.fill(0);
  const em = emissionBetween(tbl, t0, t1, scratch.emis, scratch.emisSmolder);
  if (em.total > 0) for (let i = 0; i < conc.length; i++) conc[i] += scratch.emis[i];

  const wind = windAtStep(inp.weather, inp.seed, k, p);
  const plumeTopM = briggsFinalRise(buoyancyFlux(em.heatW), wind.speed, p.plumeMaxM);
  const uAdv = wind.speed * windSpeedFactor(plumeTopM, p);
  const dx = (wind.ux * uAdv * p.stepS) / cell;
  const dy = (-wind.uy * uAdv * p.stepS) / cell;
  advect(conc, next, w, h, dx, dy);

  const K = p.kBaseM2s + p.kWindM2sPerMps * wind.speed + (p.kPlumeM2sPerKm * plumeTopM) / 1000;
  const sigmaCells = Math.sqrt(2 * K * p.stepS) / cell;
  blur(next, scratch.tmp, w, h, sigmaCells);

  if (p.lossTauS > 0) decay(next, Math.exp(-p.stepS / p.lossTauS));

  return { plumeTopM, smolderFrac: em.total > 0 ? em.smolder / em.total : 0, emitted: em.total, ux: wind.ux, uy: wind.uy, speed: wind.speed };
}
