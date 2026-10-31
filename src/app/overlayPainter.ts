/**
 * Turns (result, interventions, t) into pixels on the burn GridLayer, throttled to ~25 fps.
 * Also computes the live stats shown in the panel.
 */

import { NEVER_ARRIVES, cellAreaHa } from '../contract';
import type { GridSpec, Intervention, SimResult, SimSettings } from '../contract';
import { FORECAST_RINGS, paintBurn, paintCompare, paintRingCells } from '../viewer/burnCanvas';
import type { GridLayer } from '../viewer/burnLayer';

export interface Preview {
  type: 'firebreak' | 'water';
  cells: number[];
}

export interface LiveStats {
  burnedCells: number;
  burnedAreaHa: number;
}

export class OverlayPainter {
  private readonly firebreak: Uint8Array;
  private readonly wetness: Float32Array;
  private dirty = false;
  private lastPaint = 0;
  private raf = 0;
  private args: { result: SimResult | null; interventions: Intervention[]; t: number; settings: SimSettings; preview: Preview | null; compareMask: Uint8Array | null; ringCells: Uint8Array | null } | null = null;

  constructor(
    private readonly layer: GridLayer,
    private readonly grid: GridSpec,
    private readonly minIntervalMs = 40,
  ) {
    const n = grid.width * grid.height;
    this.firebreak = new Uint8Array(n);
    this.wetness = new Float32Array(n);
  }

  /**
   * Request a repaint with the latest inputs (coalesced to one paint per frame). With a
   * `compareMask` (a real fire's burned cells) the layer shows the accuracy view instead; with
   * `ringCells` (from forecastRingCells) the forecast outlines (where the fire is predicted at 1 h / 3 h / 6 h) are drawn on top.
   */
  schedule(result: SimResult | null, interventions: Intervention[], t: number, settings: SimSettings, preview: Preview | null = null, compareMask: Uint8Array | null = null, ringCells: Uint8Array | null = null): void {
    this.args = { result, interventions, t, settings, preview, compareMask, ringCells };
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
    this.paintNow();
  };

  private paintNow(): void {
    const a = this.args;
    if (!a) return;
    if (a.compareMask) {
      const mask = a.compareMask;
      const arrival = a.result?.arrivalTime ?? this.emptyArrival();
      this.layer.paint((data) => paintCompare(data, arrival, a.t, mask));
      return;
    }
    this.buildMasks(a.interventions, a.t, a.settings);
    if (a.preview) {
      if (a.preview.type === 'firebreak') for (const c of a.preview.cells) this.firebreak[c] = 1;
      else for (const c of a.preview.cells) this.wetness[c] = 1;
    }
    const arrival = a.result?.arrivalTime ?? EMPTY;
    const flameWindowS = Math.max(300, Math.min(1800, a.settings.waterHalfLifeS * 1.5));
    this.layer.paint((data) => {
      paintBurn(data, arrival.length ? arrival : this.emptyArrival(), a.t, {
        flameWindowS,
        firebreak: this.firebreak,
        wetness: this.wetness,
      });
      if (a.ringCells) paintRingCells(data, a.ringCells, FORECAST_RINGS);
    });
  }

  private emptyCache: Float32Array | null = null;
  private emptyArrival(): Float32Array {
    if (!this.emptyCache) this.emptyCache = new Float32Array(this.grid.width * this.grid.height).fill(NEVER_ARRIVES);
    return this.emptyCache;
  }

  private buildMasks(interventions: Intervention[], t: number, settings: SimSettings): void {
    this.firebreak.fill(0);
    this.wetness.fill(0);
    for (const iv of interventions) {
      if (iv.tSeconds > t) continue;
      if (iv.type === 'firebreak') {
        for (const c of iv.cells) this.firebreak[c] = 1;
      } else {
        const half = iv.params?.halfLifeS ?? settings.waterHalfLifeS;
        const w = half > 0 ? Math.pow(2, -(t - iv.tSeconds) / half) : 0;
        if (w < 0.02) continue;
        for (const c of iv.cells) if (w > this.wetness[c]) this.wetness[c] = w;
      }
    }
  }

  destroy(): void {
    if (this.raf) cancelAnimationFrame(this.raf);
  }
}

const EMPTY = new Float32Array(0);

export function liveStats(result: SimResult | null, grid: GridSpec, t: number): LiveStats {
  if (!result) return { burnedCells: 0, burnedAreaHa: 0 };
  const arr = result.arrivalTime;
  let n = 0;
  for (let i = 0; i < arr.length; i++) if (arr[i] <= t) n++;
  return { burnedCells: n, burnedAreaHa: n * cellAreaHa(grid) };
}
