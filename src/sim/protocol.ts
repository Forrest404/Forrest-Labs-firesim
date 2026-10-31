/**
 * Typed message protocol between the app and the simulation worker.
 * Requests carry a client-chosen id; every response echoes it so stale results can be dropped.
 */

import type { Scenario, SimResult } from '../contract';

export type SimRequest =
  | { type: 'run'; id: number; scenario: Scenario }
  /** Advisory: simulate() is synchronous and fast, so cancel only drops the pending result. */
  | { type: 'cancel'; id: number };

export type SimResponse =
  | { type: 'result'; id: number; result: SimResult }
  | { type: 'error'; id: number; message: string }
  | { type: 'progress'; id: number; fraction: number };
