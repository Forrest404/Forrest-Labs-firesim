/**
 * Keeps the smoke field in sync with playback time. The field lives on a 60 s lattice; a full
 * copy is checkpointed every `checkpointEvery` steps so scrubbing backwards restores the nearest
 * checkpoint and replays (bitwise identical, every step is a pure function of (field, k)).
 * Forward catch-up is budgeted per call so long jumps never stall a frame.
 */

import { buildEmissionTables, emissionBetween } from './emission';
import type { EmissionTables, SmokeInputs } from './emission';
import { makeScratch, stepField } from './field';
import type { StepInfo, StepScratch } from './field';
import { DEFAULT_SMOKE_PARAMS } from './params';
import type { SmokeParams } from './params';
import { windSpeedFactor } from './plume';
import { advect } from './transport';
import { windAtStep } from './wind';

export interface SmokeSample {
  /** Column-integrated smoke per cell (the `out` buffer passed in). */
  conc: Float32Array;
  plumeTopM: number;
  smolderFrac: number;
  /** Per-cell emission of the last lattice step (drives the particle emitters). */
  emission: Float32Array;
  /** Emission of the strongest possible flaming cell per step; "1.0 = strong source". */
  refEmission: number;
  burnoutAt: Float32Array;
  /** Lattice time the underlying field corresponds to (lags t while catching up). */
  fieldT: number;
}

interface Checkpoint {
  conc: Float32Array;
  info: StepInfo;
  emission: Float32Array;
}

const ZERO_INFO: StepInfo = { plumeTopM: 0, smolderFrac: 0, emitted: 0, ux: 0, uy: 1, speed: 0 };

export class SmokeTimeline {
  readonly burnoutAt: Float32Array;
  readonly refEmission: number;
  private readonly tbl: EmissionTables;
  private readonly scratch: StepScratch;
  private conc: Float32Array;
  private next: Float32Array;
  private k = 0;
  private readonly maxK: number;
  private info: StepInfo = ZERO_INFO;
  private readonly lastEmission: Float32Array;
  private readonly checkpoints = new Map<number, Checkpoint>();
  private steps = 0;

  constructor(
    private readonly inp: SmokeInputs,
    private readonly p: SmokeParams = DEFAULT_SMOKE_PARAMS,
  ) {
    const n = inp.grid.width * inp.grid.height;
    this.tbl = buildEmissionTables(inp, p);
    this.burnoutAt = this.tbl.burnoutAt;
    this.scratch = makeScratch(n);
    this.conc = new Float32Array(n);
    this.next = new Float32Array(n);
    this.lastEmission = new Float32Array(n);
    this.maxK = Math.max(0, Math.floor(inp.durationS / p.stepS));
    let ref = 0;
    for (let i = 0; i < n; i++) {
      const D = this.tbl.burnoutAt[i] - inp.arrival[i];
      if (D > 0 && Number.isFinite(D)) ref = Math.max(ref, (this.tbl.mFlame[i] / D) * p.stepS);
    }
    this.refEmission = ref > 0 ? ref : 1;
    this.saveCheckpoint();
  }

  /** Lattice steps computed so far (including replays). */
  stepsComputed(): number {
    return this.steps;
  }

  /** Current lattice time, seconds. */
  get fieldT(): number {
    return this.k * this.p.stepS;
  }

  /** Overwrites the current field (tests and debugging only). Invalidates checkpoints. */
  seedConcentration(conc: Float32Array): void {
    this.conc.set(conc);
    this.checkpoints.clear();
    this.saveCheckpoint();
  }

  /**
   * Moves the lattice field toward floor(t / stepS), spending at most `budgetMs` wall time and
   * `maxSteps` steps. Scrubbing back restores the nearest earlier checkpoint first. Returns true
   * when the field is at the target.
   */
  advanceTo(t: number, budgetMs: number, maxSteps = 64): boolean {
    const target = Math.max(0, Math.min(this.maxK, Math.floor(t / this.p.stepS)));
    if (target < this.k) this.restore(target);
    if (target === this.k) return true;
    const start = now();
    let n = 0;
    while (this.k < target && n < maxSteps) {
      this.step();
      n++;
      if (now() - start > budgetMs) break;
    }
    return this.k === target;
  }

  /** Field at time t: residual advection u*(t - fieldT) and residual emission into `out`. Never mutates state. */
  sampleAt(t: number, out: Float32Array): SmokeSample {
    const p = this.p;
    const { width: w, height: h, cellSizeM: cell } = this.inp.grid;
    const t0 = this.k * p.stepS;
    const dtRes = Math.max(0, Math.min(p.stepS, t - t0));
    const wind = windAtStep(this.inp.weather, this.inp.seed, this.k, p);
    const uAdv = wind.speed * windSpeedFactor(this.info.plumeTopM, p);
    advect(this.conc, out, w, h, (wind.ux * uAdv * dtRes) / cell, (-wind.uy * uAdv * dtRes) / cell);
    if (dtRes > 0) emissionBetween(this.tbl, t0, t0 + dtRes, out);
    return {
      conc: out,
      plumeTopM: this.info.plumeTopM,
      smolderFrac: this.info.smolderFrac,
      emission: this.lastEmission,
      refEmission: this.refEmission,
      burnoutAt: this.burnoutAt,
      fieldT: t0,
    };
  }

  private step(): void {
    this.info = stepField(this.conc, this.next, this.k, this.tbl, this.inp, this.p, this.scratch);
    this.lastEmission.set(this.scratch.emis);
    const tmp = this.conc;
    this.conc = this.next;
    this.next = tmp;
    this.k++;
    this.steps++;
    if (this.k % this.p.checkpointEvery === 0 && !this.checkpoints.has(this.k)) this.saveCheckpoint();
  }

  private saveCheckpoint(): void {
    this.checkpoints.set(this.k, { conc: new Float32Array(this.conc), info: this.info, emission: new Float32Array(this.lastEmission) });
  }

  private restore(target: number): void {
    let best = -1;
    for (const key of this.checkpoints.keys()) if (key <= target && key > best) best = key;
    if (best < 0) best = 0;
    const cp = this.checkpoints.get(best)!;
    this.conc.set(cp.conc);
    this.info = cp.info;
    this.lastEmission.set(cp.emission);
    this.k = best;
  }
}

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}
