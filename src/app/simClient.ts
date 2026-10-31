/**
 * Main-thread client for the simulation Web Worker. One run at a time: starting a new run
 * cancels the previous one. A crashed worker is replaced automatically.
 */

import type { EnsembleResult, EnsembleSpec, Scenario, SimResult } from '../contract';
import type { ContainPlan, PlanInput } from '../contain/planner';
import type { SimRequest, SimResponse } from '../sim/protocol';

export class SimCancelledError extends Error {
  constructor() {
    super('Simulation cancelled');
    this.name = 'SimCancelledError';
  }
}

interface Pending {
  resolve: (r: SimResult | EnsembleResult) => void;
  resolvePlan?: (p: ContainPlan) => void;
  reject: (e: Error) => void;
  onProgress?: (fraction: number) => void;
}

export class SimClient {
  private worker!: Worker;
  private nextId = 1;
  private pending = new Map<number, Pending>();

  constructor() {
    this.spawn();
  }

  private spawn(): void {
    this.worker = new Worker(new URL('../sim/worker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (ev: MessageEvent<SimResponse>) => {
      const msg = ev.data;
      const p = this.pending.get(msg.id);
      if (!p) return;
      if (msg.type === 'result' || msg.type === 'ensembleResult') {
        this.pending.delete(msg.id);
        p.resolve(msg.result);
      } else if (msg.type === 'planResult') {
        this.pending.delete(msg.id);
        p.resolvePlan?.(msg.plan);
      } else if (msg.type === 'progress') {
        p.onProgress?.(msg.fraction);
      } else if (msg.type === 'error') {
        this.pending.delete(msg.id);
        p.reject(new Error(msg.message));
      }
    };
    this.worker.onerror = (ev) => {
      const err = new Error(`Simulation worker crashed: ${ev.message || 'unknown error'}`);
      for (const p of this.pending.values()) p.reject(err);
      this.pending.clear();
      this.worker.terminate();
      this.spawn();
    };
  }

  /** Runs the scenario. Any in-flight run is cancelled (its promise rejects with SimCancelledError). */
  run(scenario: Scenario): Promise<SimResult> {
    this.cancelAll();
    const id = this.nextId++;
    const msg: SimRequest = { type: 'run', id, scenario };
    return new Promise<SimResult>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as Pending['resolve'], reject });
      // Scenario arrays are shared with the loaded area, so they are copied (structured clone), not transferred.
      this.worker.postMessage(msg);
    });
  }

  /** Plans the emergency response (baseline + contained runs). Cancels any in-flight job like run(). */
  plan(input: PlanInput, onProgress?: (fraction: number) => void): Promise<ContainPlan> {
    this.cancelAll();
    const id = this.nextId++;
    const msg: SimRequest = { type: 'plan', id, input };
    return new Promise<ContainPlan>((resolve, reject) => {
      this.pending.set(id, { resolve: () => undefined, resolvePlan: resolve, reject, onProgress });
      this.worker.postMessage(msg);
    });
  }

  /** Runs an ensemble (many perturbed simulations). Cancels anything in flight first. */
  runEnsemble(scenario: Scenario, spec: EnsembleSpec, onProgress?: (fraction: number) => void): Promise<EnsembleResult> {
    this.cancelAll();
    const id = this.nextId++;
    const msg: SimRequest = { type: 'ensemble', id, scenario, spec };
    return new Promise<EnsembleResult>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as Pending['resolve'], reject, onProgress });
      this.worker.postMessage(msg);
    });
  }

  cancelAll(): void {
    for (const [id, p] of this.pending) {
      this.worker.postMessage({ type: 'cancel', id } satisfies SimRequest);
      p.reject(new SimCancelledError());
    }
    this.pending.clear();
  }

  dispose(): void {
    this.cancelAll();
    this.worker.terminate();
  }
}
