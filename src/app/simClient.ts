/**
 * Main-thread client for the simulation Web Worker. One run at a time: starting a new run
 * cancels the previous one. A crashed worker is replaced automatically.
 */

import type { Scenario, SimResult } from '../contract';
import type { SimRequest, SimResponse } from '../sim/protocol';

export class SimCancelledError extends Error {
  constructor() {
    super('Simulation cancelled');
    this.name = 'SimCancelledError';
  }
}

interface Pending {
  resolve: (r: SimResult) => void;
  reject: (e: Error) => void;
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
      if (msg.type === 'result') {
        this.pending.delete(msg.id);
        p.resolve(msg.result);
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
      this.pending.set(id, { resolve, reject });
      // Scenario arrays are shared with the loaded area, so they are copied (structured clone), not transferred.
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
