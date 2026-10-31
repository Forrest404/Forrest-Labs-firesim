/** Undo/redo over immutable snapshots of the intervention list. */

import type { Intervention } from '../contract';

export class InterventionHistory {
  private past: Intervention[][] = [];
  private future: Intervention[][] = [];

  constructor(private present: Intervention[] = []) {}

  get current(): Intervention[] {
    return this.present;
  }
  get canUndo(): boolean {
    return this.past.length > 0;
  }
  get canRedo(): boolean {
    return this.future.length > 0;
  }

  /** Records a new state (clears the redo stack). */
  push(next: Intervention[]): void {
    this.past.push(this.present);
    if (this.past.length > 100) this.past.shift();
    this.present = next;
    this.future = [];
  }

  undo(): Intervention[] | null {
    const prev = this.past.pop();
    if (!prev) return null;
    this.future.push(this.present);
    this.present = prev;
    return prev;
  }

  redo(): Intervention[] | null {
    const next = this.future.pop();
    if (!next) return null;
    this.past.push(this.present);
    this.present = next;
    return next;
  }

  /** Resets to a state without history (e.g. a new area). */
  reset(state: Intervention[] = []): void {
    this.past = [];
    this.future = [];
    this.present = state;
  }
}
