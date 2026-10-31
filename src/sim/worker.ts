/**
 * Web Worker wrapper around simulate(), the ensemble engine and the emergency-response planner. Result typed arrays are
 * transferred (zero copy). Instantiated by src/app/simClient.ts via
 * `new Worker(new URL('../sim/worker.ts', import.meta.url), { type: 'module' })`.
 *
 * An ensemble runs one simulation at a time and yields to the event loop between runs, so a
 * `cancel` message (or a new request) is handled promptly instead of waiting for all runs.
 */

import { planContainment } from '../contain/planner';
import { accumulateRun, beginEnsemble, finishEnsemble } from './ensemble';
import { simulate } from './index';
import type { SimRequest, SimResponse } from './protocol';

interface WorkerScope {
  postMessage(message: SimResponse, transfer?: Transferable[]): void;
  onmessage: ((event: MessageEvent<SimRequest>) => void) | null;
}

const ctx = self as unknown as WorkerScope;
let cancelled = new Set<number>();
const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

ctx.onmessage = (event) => {
  const msg = event.data;
  if (msg.type === 'cancel') {
    cancelled.add(msg.id);
    return;
  }
  if (msg.type === 'plan') {
    try {
      const plan = planContainment(msg.input, (fraction) => ctx.postMessage({ type: 'progress', id: msg.id, fraction }));
      if (cancelled.has(msg.id)) {
        cancelled.delete(msg.id);
        return;
      }
      // With no orders the contained run is the baseline itself: never transfer a buffer twice.
      const transfer = [...new Set<Transferable>([plan.baseline.arrivalTime.buffer, plan.contained.arrivalTime.buffer, plan.baseline.intensity?.buffer, plan.contained.intensity?.buffer].filter((b): b is ArrayBuffer => !!b))];
      ctx.postMessage({ type: 'planResult', id: msg.id, plan }, transfer);
    } catch (err) {
      ctx.postMessage({ type: 'error', id: msg.id, message: err instanceof Error ? err.message : String(err) });
    }
    return;
  }
  if (msg.type === 'run') {
    try {
      const result = simulate(msg.scenario);
      if (cancelled.has(msg.id)) {
        cancelled.delete(msg.id);
        return;
      }
      const transfer: Transferable[] = [result.arrivalTime.buffer, result.firelineIntensityKwM.buffer, result.flameLengthM.buffer, result.sourceCell.buffer, result.ignitedByEmber.buffer];
      if (result.intensity) transfer.push(result.intensity.buffer);
      ctx.postMessage({ type: 'result', id: msg.id, result }, transfer);
    } catch (err) {
      ctx.postMessage({ type: 'error', id: msg.id, message: err instanceof Error ? err.message : String(err) });
    }
  } else if (msg.type === 'ensemble') {
    void runEnsembleMessage(msg.id, msg.scenario, msg.spec);
  }
  if (cancelled.size > 64) cancelled = new Set();
};

async function runEnsembleMessage(id: number, scenario: Parameters<typeof beginEnsemble>[0], spec: Parameters<typeof beginEnsemble>[1]): Promise<void> {
  try {
    const acc = beginEnsemble(scenario, spec);
    for (let k = 0; k < spec.runs; k++) {
      await tick(); // let a pending cancel / new request in
      if (cancelled.has(id)) {
        cancelled.delete(id);
        return;
      }
      accumulateRun(acc, k);
      ctx.postMessage({ type: 'progress', id, fraction: (k + 1) / spec.runs });
    }
    const result = finishEnsemble(acc);
    ctx.postMessage({ type: 'ensembleResult', id, result }, [
      result.burnProbability.buffer, result.burnedByBin.buffer, result.meanArrivalS.buffer, result.earliestArrivalS.buffer, result.areasHa.buffer,
    ]);
  } catch (err) {
    ctx.postMessage({ type: 'error', id, message: err instanceof Error ? err.message : String(err) });
  }
}
