/**
 * Typed message protocol between the app and the simulation worker.
 * Requests carry a client-chosen id; every response echoes it so stale results can be dropped.
 */

import type { Scenario, SimResult } from '../contract';
import type { ContainPlan, PlanInput } from '../contain/planner';

export type SimRequest =
  | { type: 'run'; id: number; scenario: Scenario }
  /** Emergency-response plan: baseline + contained runs and the orders (src/contain). */
  | { type: 'plan'; id: number; input: PlanInput }
  /** Advisory: simulate() is synchronous and fast, so cancel only drops the pending result. */
  | { type: 'cancel'; id: number };

export type SimResponse =
  | { type: 'result'; id: number; result: SimResult }
  | { type: 'planResult'; id: number; plan: ContainPlan }
  | { type: 'error'; id: number; message: string }
  | { type: 'progress'; id: number; fraction: number };
