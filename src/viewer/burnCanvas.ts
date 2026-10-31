/**
 * Pure pixel painting for the overlay: one pixel per cell, row 0 at the top (north).
 * No Cesium here, so these can be unit-tested and reused by debug layers.
 */

import { FUELS, FuelClass, NEVER_ARRIVES } from '../contract';

export type RGBA = [number, number, number, number];

const FUEL_RGBA: RGBA[] = Object.keys(FUELS)
  .map(Number)
  .sort((a, b) => a - b)
  .map((id) => parseRgba(FUELS[id as FuelClass].color));

export function parseRgba(css: string): RGBA {
  const m = /rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+))?\s*\)/.exec(css);
  if (!m) return [255, 0, 255, 255];
  return [Number(m[1]), Number(m[2]), Number(m[3]), Math.round((m[4] === undefined ? 1 : Number(m[4])) * 255)];
}

export function paintFuel(data: Uint8ClampedArray, fuel: Uint8Array): void {
  for (let i = 0, p = 0; i < fuel.length; i++, p += 4) {
    const c = FUEL_RGBA[fuel[i]] ?? FUEL_RGBA[0];
    data[p] = c[0];
    data[p + 1] = c[1];
    data[p + 2] = c[2];
    data[p + 3] = c[3];
  }
}

/** Slope in degrees -> greyscale hillshade-ish ramp. */
export function paintSlope(data: Uint8ClampedArray, slopeDeg: Float32Array): void {
  for (let i = 0, p = 0; i < slopeDeg.length; i++, p += 4) {
    const v = Math.min(1, slopeDeg[i] / 45);
    data[p] = 255;
    data[p + 1] = Math.round(255 * (1 - v));
    data[p + 2] = Math.round(255 * (1 - v) * 0.5);
    data[p + 3] = Math.round(40 + 180 * v);
  }
}

export interface BurnPaintOptions {
  /** Seconds a cell stays in the "flaming" ramp before it looks charred. */
  flameWindowS: number;
  /** Cells that are cleared firebreaks (by time t). */
  firebreak?: Uint8Array;
  /** 0..1 current wetness per cell (by time t). */
  wetness?: Float32Array;
  /** 1 where the cell was ignited by an ember: shown as a pale flash while it is flaming. */
  spot?: Uint8Array;
}

/**
 * Paints the fire state at time t from arrival times. Unburned: transparent. Burning: yellow ->
 * orange -> red by recency. Burned: dark char. Firebreak: light grey. Wet: blue tint.
 */
export function paintBurn(data: Uint8ClampedArray, arrival: Float32Array, t: number, o: BurnPaintOptions): void {
  const win = Math.max(1, o.flameWindowS);
  for (let i = 0, p = 0; i < arrival.length; i++, p += 4) {
    const a = arrival[i];
    let r = 0;
    let g = 0;
    let b = 0;
    let alpha = 0;
    if (a !== NEVER_ARRIVES && a <= t) {
      const age = t - a;
      if (age < win && o.spot && o.spot[i]) {
        // Ember spot fire: bright white-yellow, fading to the normal flame colours.
        const k = age / win;
        r = 255;
        g = Math.round(255 - 60 * k);
        b = Math.round(200 * (1 - k));
        alpha = 245;
      } else if (age < win) {
        const k = age / win; // 0 = just ignited
        r = 255;
        g = Math.round(230 * (1 - k) * (1 - k) + 40);
        b = Math.round(60 * (1 - k));
        alpha = 235;
      } else {
        r = 35;
        g = 28;
        b = 26;
        alpha = 200;
      }
    }
    if (o.firebreak && o.firebreak[i]) {
      r = 225;
      g = 225;
      b = 215;
      alpha = 220;
    }
    if (o.wetness) {
      const w = o.wetness[i];
      if (w > 0.02) {
        const k = Math.min(1, w);
        r = Math.round(r * (1 - k) + 40 * k);
        g = Math.round(g * (1 - k) + 120 * k);
        b = Math.round(b * (1 - k) + 255 * k);
        alpha = Math.max(alpha, Math.round(90 + 130 * k));
      }
    }
    data[p] = r;
    data[p + 1] = g;
    data[p + 2] = b;
    data[p + 3] = alpha;
  }
}

/** Alignment test pattern: 10-cell checkerboard with a red NW corner block and blue SE block. */
export function paintCheckerboard(data: Uint8ClampedArray, width: number, height: number): void {
  for (let r = 0; r < height; r++) {
    for (let c = 0; c < width; c++) {
      const p = (r * width + c) * 4;
      const on = ((r / 10) | 0) % 2 === ((c / 10) | 0) % 2;
      data[p] = on ? 255 : 0;
      data[p + 1] = on ? 255 : 0;
      data[p + 2] = on ? 255 : 0;
      data[p + 3] = 120;
      if (r < 20 && c < 20) {
        data[p] = 255;
        data[p + 1] = 0;
        data[p + 2] = 0;
        data[p + 3] = 220;
      } else if (r >= height - 20 && c >= width - 20) {
        data[p] = 0;
        data[p + 1] = 80;
        data[p + 2] = 255;
        data[p + 3] = 220;
      }
    }
  }
}

/** CSS gradient matching paintProbability, for the legend. */
export const PROBABILITY_GRADIENT = 'linear-gradient(to right, rgb(255,235,120), rgb(255,140,0), rgb(180,0,40))';

/**
 * Burn-probability heat map. Cells with probability 0 stay transparent; low probabilities are pale
 * yellow and faint, high ones deep red and strong. p is 0-1 per cell, row 0 = north.
 */
export function paintProbability(data: Uint8ClampedArray, p: Float32Array): void {
  for (let i = 0, q = 0; i < p.length; i++, q += 4) {
    const v = p[i];
    if (!(v > 0.004)) {
      data[q + 3] = 0;
      continue;
    }
    const k = Math.min(1, v);
    let r: number, g: number, b: number;
    if (k < 0.5) {
      const f = k / 0.5;
      r = 255; g = Math.round(235 - 95 * f); b = Math.round(120 - 120 * f);
    } else {
      const f = (k - 0.5) / 0.5;
      r = Math.round(255 - 75 * f); g = Math.round(140 - 140 * f); b = Math.round(40 * f);
    }
    data[q] = r;
    data[q + 1] = g;
    data[q + 2] = b;
    data[q + 3] = Math.round(70 + 160 * Math.pow(k, 0.7));
  }
}
