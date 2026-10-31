/**
 * Turns (result, interventions, t) into pixels on the burn GridLayer, throttled to ~25 fps.
 * Also computes the live stats shown in the panel.
 */

import { NEVER_ARRIVES, cellAreaHa } from '../contract';
import type { GridSpec, Intervention, SimResult, SimSettings } from '../contract';
import { FORECAST_RINGS, paintBurnScaled, paintCompareScaled, paintRing, paintRingCellsScaled } from '../viewer/burnCanvas';
import type { GridLayer } from '../viewer/burnLayer';
import { paintSmoke, upsampleBilinear, upsampleNearest } from '../viewer/smokeCanvas';

/** Canvas pixels per cell for the burn and smoke layers (smoothing needs > 1). */
export const OVERLAY_SCALE = 2;

export interface OverlayEffects {
  glow: boolean;
  smooth: boolean;
}
import type { SmokeSample, SmokeTimeline } from './smoke';

/** Wall-time budget per paint for stepping the smoke field toward the playback time. */
const SMOKE_BUDGET_MS = 6;
/** Larger per-frame budget used by the dedicated catch-up loop after a long scrub. */
const SMOKE_CATCHUP_BUDGET_MS = 12;
/** Nominal mass extinction of biomass smoke, m^2/kg. */
const SMOKE_SIGMA_EXT = 4000;
const SMOKE_MAX_ALPHA = 0.8;
/** Opacity multiplier for smoke drawn over cells that are flaming right now. */
const SMOKE_OVER_FLAMES = 0.3;

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
  private smokeLayer: GridLayer | null = null;
  private timeline: SmokeTimeline | null = null;
  private readonly smokeBuf: Float32Array;
  private burnoutAt: Float32Array | null = null;
  private lastSmoke: SmokeSample | null = null;
  private catchUpRaf = 0;
  private fx: OverlayEffects = { glow: true, smooth: true };
  private smokeHi: Float32Array | null = null;
  private readonly flaming: Uint8Array;
  private ring: Float32Array | null = null;

  constructor(
    private readonly layer: GridLayer,
    private readonly grid: GridSpec,
    private readonly minIntervalMs = 40,
  ) {
    const n = grid.width * grid.height;
    this.firebreak = new Uint8Array(n);
    this.wetness = new Float32Array(n);
    this.smokeBuf = new Float32Array(n);
    this.flaming = new Uint8Array(n);
  }

  /** Attaches (or detaches, with null) the smoke layer and the timeline that fills it. */
  setSmoke(layer: GridLayer | null, timeline: SmokeTimeline | null): void {
    this.smokeLayer = layer;
    this.timeline = timeline;
    this.lastSmoke = null;
    if (layer && !timeline) layer.paint((d) => d.fill(0));
  }

  /** Per-cell burnout times for the per-fuel burning ramp (null falls back to the fixed window). */
  setBurnout(burnoutAt: Float32Array | null): void {
    this.burnoutAt = burnoutAt;
  }

  setEffects(fx: OverlayEffects): void {
    this.fx = fx;
  }

  /** Arrival field of another run whose burned-area outline is drawn over this one (null: none). */
  setRing(arrival: Float32Array | null): void {
    this.ring = arrival;
  }

  get lastSmokeSample(): SmokeSample | null {
    return this.lastSmoke;
  }

  get smokeTimeline(): SmokeTimeline | null {
    return this.timeline;
  }

  /**
   * Request a repaint with the latest inputs (coalesced to one paint per frame). With a
   * `compareMask` (a real fire's burned cells) the layer shows the accuracy view instead; with
   * `ringCells` (from forecastRingCells) the 1 h / 3 h / 6 h forecast outlines are drawn on top.
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
      this.layer.paint((data) => paintCompareScaled(data, arrival, this.grid.width, this.grid.height, this.layer.scale, a.t, mask));
      this.paintSmoke(a.t);
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
      paintBurnScaled(data, arrival.length ? arrival : this.emptyArrival(), this.grid.width, this.grid.height, this.layer.scale, a.t, {
        flameWindowS,
        burnoutAt: a.result && this.burnoutAt ? this.burnoutAt : undefined,
        firebreak: this.firebreak,
        wetness: this.wetness,
        smooth: this.fx.smooth,
        glow: this.fx.glow && !!a.result,
      });
      if (this.ring && a.result) paintRing(data, this.ring, this.grid.width, this.grid.height, this.layer.scale, a.t, RING_RGBA);
      if (a.ringCells) paintRingCellsScaled(data, a.ringCells, this.grid.width, this.grid.height, this.layer.scale, FORECAST_RINGS);
    });
    this.paintSmoke(a.t);
  }

  private paintSmoke(t: number): void {
    const layer = this.smokeLayer;
    const tl = this.timeline;
    if (!layer || !tl || !layer.isVisible) return;
    const caughtUp = tl.advanceTo(t, SMOKE_BUDGET_MS);
    const sample = tl.sampleAt(t, this.smokeBuf);
    this.lastSmoke = sample;
    const cellAreaM2 = this.grid.cellSizeM * this.grid.cellSizeM;
    const { width: w, height: h } = this.grid;
    const sc = layer.scale;
    let field = sample.conc;
    if (sc > 1) {
      if (!this.smokeHi || this.smokeHi.length !== w * h * sc * sc) this.smokeHi = new Float32Array(w * h * sc * sc);
      if (this.fx.smooth) upsampleBilinear(sample.conc, w, h, sc, this.smokeHi);
      else upsampleNearest(sample.conc, w, h, sc, this.smokeHi);
      field = this.smokeHi;
    }
    // Flaming mask so the fire stays visible under its own plume.
    const arrival = this.args?.result?.arrivalTime;
    const burnout = this.burnoutAt;
    const mask = this.flaming;
    if (arrival && burnout) {
      for (let i = 0; i < mask.length; i++) {
        const a = arrival[i];
        mask[i] = a <= t && t < burnout[i] ? 1 : 0;
      }
    } else mask.fill(0);
    layer.paint((data) =>
      paintSmoke(data, field, {
        cellAreaM2,
        sigmaExtM2PerKg: SMOKE_SIGMA_EXT,
        maxAlpha: SMOKE_MAX_ALPHA,
        smolderFrac: sample.smolderFrac,
        dim: { mask, width: w, height: h, scale: sc, factor: SMOKE_OVER_FLAMES },
      }),
    );
    if (!caughtUp && !this.catchUpRaf) this.catchUpRaf = requestAnimationFrame(this.catchUp);
  }

  /** Steps the field every frame (not just every paint) after a long jump, then repaints. */
  private readonly catchUp = (): void => {
    this.catchUpRaf = 0;
    const tl = this.timeline;
    const a = this.args;
    if (!tl || !a || !this.smokeLayer?.isVisible) return;
    const done = tl.advanceTo(a.t, SMOKE_CATCHUP_BUDGET_MS, 1000);
    this.dirty = true;
    if (!this.raf) this.raf = requestAnimationFrame(this.tick);
    if (!done) this.catchUpRaf = requestAnimationFrame(this.catchUp);
  };

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
    if (this.catchUpRaf) cancelAnimationFrame(this.catchUpRaf);
  }
}

const EMPTY = new Float32Array(0);
/** Magenta: distinct from fire (orange), firebreak (grey) and water (blue). */
const RING_RGBA: [number, number, number, number] = [255, 70, 220, 235];

export function liveStats(result: SimResult | null, grid: GridSpec, t: number): LiveStats {
  if (!result) return { burnedCells: 0, burnedAreaHa: 0 };
  const arr = result.arrivalTime;
  let n = 0;
  for (let i = 0; i < arr.length; i++) if (arr[i] <= t) n++;
  return { burnedCells: n, burnedAreaHa: n * cellAreaHa(grid) };
}
