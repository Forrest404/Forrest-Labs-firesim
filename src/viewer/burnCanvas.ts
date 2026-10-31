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
  /** Seconds a cell stays in the "flaming" ramp before it looks charred (fallback when burnoutAt is absent). */
  flameWindowS: number;
  /** Per-cell burnout time (arrival + the fuel's burn duration). When present it replaces flameWindowS. */
  burnoutAt?: Float32Array;
  /** Cells that are cleared firebreaks (by time t). */
  firebreak?: Uint8Array;
  /** 0..1 current wetness per cell (by time t). */
  wetness?: Float32Array;
}

/**
 * Paints the fire state at time t from arrival times. Unburned: transparent. Burning: yellow ->
 * orange -> red by recency. Burned: dark char. Firebreak: light grey. Wet: blue tint.
 */
export function paintBurn(data: Uint8ClampedArray, arrival: Float32Array, t: number, o: BurnPaintOptions): void {
  const winDefault = Math.max(1, o.flameWindowS);
  const burnout = o.burnoutAt;
  for (let i = 0, p = 0; i < arrival.length; i++, p += 4) {
    const a = arrival[i];
    const win = burnout ? Math.max(1, burnout[i] - a) : winDefault;
    let r = 0;
    let g = 0;
    let b = 0;
    let alpha = 0;
    if (a !== NEVER_ARRIVES && a <= t) {
      const age = t - a;
      if (age < win) {
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
