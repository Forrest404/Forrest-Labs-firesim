/**
 * Typed message protocol between the app and the simulation worker.
 * Requests carry a client-chosen id; every response echoes it so stale results can be dropped.
 */

import type { EnsembleResult, EnsembleSpec, Scenario, SimResult } from '../contract';

export type SimRequest =
  | { type: 'run'; id: number; scenario: Scenario }
  | { type: 'ensemble'; id: number; scenario: Scenario; spec: EnsembleSpec }
  /** Drops a pending result; a running ensemble stops before its next run. */
  | { type: 'cancel'; id: number };

export type SimResponse =
  | { type: 'result'; id: number; result: SimResult }
  | { type: 'ensembleResult'; id: number; result: EnsembleResult }
  | { type: 'error'; id: number; message: string }
  | { type: 'progress'; id: number; fraction: number };
