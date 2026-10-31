/**
 * Web Worker wrapper around simulate(). Result typed arrays are transferred (zero copy).
 * Instantiated by src/app/simClient.ts via `new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })`.
 */

import { simulate } from './index';
import type { SimRequest, SimResponse } from './protocol';

interface WorkerScope {
  postMessage(message: SimResponse, transfer?: Transferable[]): void;
  onmessage: ((event: MessageEvent<SimRequest>) => void) | null;
}

const ctx = self as unknown as WorkerScope;
let cancelled = new Set<number>();

ctx.onmessage = (event) => {
  const msg = event.data;
  if (msg.type === 'cancel') {
    cancelled.add(msg.id);
    return;
  }
  if (msg.type !== 'run') return;
  try {
    const result = simulate(msg.scenario);
    if (cancelled.has(msg.id)) {
      cancelled.delete(msg.id);
      return;
    }
    const transfer: Transferable[] = [result.arrivalTime.buffer];
    if (result.intensity) transfer.push(result.intensity.buffer);
    ctx.postMessage({ type: 'result', id: msg.id, result }, transfer);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    ctx.postMessage({ type: 'error', id: msg.id, message });
  }
  if (cancelled.size > 64) cancelled = new Set();
};
