/**
 * Paints the ensemble's burn-probability map at the playback time onto a GridLayer, throttled like
 * the burn painter. P(burned by t) comes from the ensemble's time slices (see probabilityAt).
 */

import type { EnsembleResult } from '../contract';
import { probabilityAt } from '../sim/ensemble';
import { paintProbability } from '../viewer/burnCanvas';
import type { GridLayer } from '../viewer/burnLayer';

export class ProbabilityPainter {
  private raf = 0;
  private dirty = false;
  private lastPaint = 0;
  private args: { result: EnsembleResult | null; t: number } | null = null;
  private readonly buffer: Float32Array;

  constructor(
    private readonly layer: GridLayer,
    cells: number,
    private readonly minIntervalMs = 60,
  ) {
    this.buffer = new Float32Array(cells);
  }

  schedule(result: EnsembleResult | null, t: number): void {
    this.args = { result, t };
    this.dirty = true;
    if (!this.raf) this.raf = requestAnimationFrame(this.tick);
  }

  private readonly tick = (now: number): void => {
    this.raf = 0;
    if (!this.dirty) return;
    if (now - this.lastPaint < this.minIntervalMs) {
      this.raf = requestAnimationFrame(this.tick);
      return;
    }
    this.dirty = false;
    this.lastPaint = now;
    const a = this.args;
    if (!a) return;
    if (!a.result) this.buffer.fill(0);
    else probabilityAt(a.result, a.t, this.buffer);
    this.layer.paint((data) => paintProbability(data, this.buffer));
  };

  destroy(): void {
    if (this.raf) cancelAnimationFrame(this.raf);
  }
}
