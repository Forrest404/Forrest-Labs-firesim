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
  /** 1 where the cell was ignited by an ember: shown as a pale flash while it is flaming. */
  spot?: Uint8Array;
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

export interface BurnPaintScaledOptions extends BurnPaintOptions {
  /** Bilinear sub-cell edges and age ramp instead of one flat colour per cell. */
  smooth?: boolean;
  /** Flickering orange halo on unburned pixels around flaming cells. */
  glow?: boolean;
}

/** Flaming ramp colour by normalised age k (0 = just ignited, 1 = charring). */
function flameRgb(k: number, out: number[]): void {
  out[0] = 255;
  out[1] = Math.round(230 * (1 - k) * (1 - k) + 40);
  out[2] = Math.round(60 * (1 - k));
}

/**
 * Paints the fire state onto a canvas of (width*scale) x (height*scale) pixels. With `smooth`,
 * each pixel bilinearly interpolates the burned fraction and age of the four nearest cells, which
 * anti-aliases the front and softens the ramp; otherwise one flat colour per cell. With `glow`,
 * flaming cells cast a flickering halo onto neighbouring unburned pixels. Masks are per cell.
 */
export function paintBurnScaled(data: Uint8ClampedArray, arrival: Float32Array, width: number, height: number, scale: number, t: number, o: BurnPaintScaledOptions): void {
  const W = width * scale;
  const H = height * scale;
  const winDefault = Math.max(1, o.flameWindowS);
  const burnout = o.burnoutAt;
  const winOf = (i: number): number => (burnout ? Math.max(1, burnout[i] - arrival[i]) : winDefault);
  const rgb = [0, 0, 0];
  const smooth = !!o.smooth && scale > 1;
  for (let py = 0; py < H; py++) {
    const cy = (py / scale) | 0;
    for (let px = 0; px < W; px++) {
      const cx = (px / scale) | 0;
      const ci = cy * width + cx;
      let r = 0, g = 0, b = 0, alpha = 0;
      let age = -1, win = 1, frac = 0;
      if (smooth) {
        const u = (px + 0.5) / scale - 0.5;
        const v = (py + 0.5) / scale - 0.5;
        let x0 = Math.floor(u), y0 = Math.floor(v);
        let fx = u - x0, fy = v - y0;
        if (x0 < 0) { x0 = 0; fx = 0; }
        if (y0 < 0) { y0 = 0; fy = 0; }
        const x1 = Math.min(width - 1, x0 + 1);
        const y1 = Math.min(height - 1, y0 + 1);
        const idx = [y0 * width + x0, y0 * width + x1, y1 * width + x0, y1 * width + x1];
        const wts = [(1 - fx) * (1 - fy), fx * (1 - fy), (1 - fx) * fy, fx * fy];
        let ageSum = 0, winSum = 0;
        for (let q = 0; q < 4; q++) {
          const a = arrival[idx[q]];
          if (a === NEVER_ARRIVES || a > t) continue;
          frac += wts[q];
          ageSum += wts[q] * (t - a);
          winSum += wts[q] * winOf(idx[q]);
        }
        if (frac > 0.001) {
          age = ageSum / frac;
          win = winSum / frac;
        }
      } else {
        const a = arrival[ci];
        if (a !== NEVER_ARRIVES && a <= t) {
          frac = 1;
          age = t - a;
          win = winOf(ci);
        }
      }
      if (age >= 0) {
        if (age < win) {
          flameRgb(age / win, rgb);
          r = rgb[0]; g = rgb[1]; b = rgb[2];
          alpha = 235;
        } else {
          r = 35; g = 28; b = 26; alpha = 200;
        }
        if (smooth) alpha = Math.round(alpha * Math.min(1, frac * 1.25));
      }
      if (o.firebreak && o.firebreak[ci]) { r = 225; g = 225; b = 215; alpha = 220; }
      if (o.wetness) {
        const wv = o.wetness[ci];
        if (wv > 0.02) {
          const k = Math.min(1, wv);
          r = Math.round(r * (1 - k) + 40 * k);
          g = Math.round(g * (1 - k) + 120 * k);
          b = Math.round(b * (1 - k) + 255 * k);
          alpha = Math.max(alpha, Math.round(90 + 130 * k));
        }
      }
      const p = (py * W + px) * 4;
      data[p] = r; data[p + 1] = g; data[p + 2] = b; data[p + 3] = alpha;
    }
  }
  if (o.glow) paintGlow(data, arrival, width, height, scale, t, winOf);
}

/** Deterministic flicker in [0.7, 1] from the cell index and a 20 s time slot. */
export function flicker(i: number, t: number): number {
  const slot = Math.floor(t / 20);
  let h = Math.imul(i + 1, 2654435761) ^ Math.imul(slot + 7, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b) >>> 0;
  return 0.7 + 0.3 * ((h >>> 8) / 16777216);
}

function paintGlow(data: Uint8ClampedArray, arrival: Float32Array, width: number, height: number, scale: number, t: number, winOf: (i: number) => number): void {
  const W = width * scale;
  const H = height * scale;
  const R = 2.5 * scale;
  const Ri = Math.ceil(R);
  for (let cy = 0; cy < height; cy++) {
    for (let cx = 0; cx < width; cx++) {
      const i = cy * width + cx;
      const a = arrival[i];
      if (a === NEVER_ARRIVES || a > t) continue;
      const age = t - a;
      const win = winOf(i);
      if (age >= win) continue;
      const strength = (1 - age / win) * flicker(i, t);
      const ox = (cx + 0.5) * scale;
      const oy = (cy + 0.5) * scale;
      const x0 = Math.max(0, Math.floor(ox - Ri)), x1 = Math.min(W - 1, Math.ceil(ox + Ri));
      const y0 = Math.max(0, Math.floor(oy - Ri)), y1 = Math.min(H - 1, Math.ceil(oy + Ri));
      for (let py = y0; py <= y1; py++) {
        for (let px = x0; px <= x1; px++) {
          const p = (py * W + px) * 4;
          if (data[p + 3] >= 90) continue; // only glow onto (nearly) empty pixels
          const dx = px + 0.5 - ox, dy = py + 0.5 - oy;
          const d = Math.sqrt(dx * dx + dy * dy) / R;
          if (d >= 1) continue;
          const alpha = Math.round(150 * strength * (1 - d) * (1 - d));
          if (alpha <= data[p + 3]) continue;
          data[p] = 255; data[p + 1] = 130; data[p + 2] = 30; data[p + 3] = alpha;
        }
      }
    }
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

/**
 * Outline of the burned area of another run at time t: cells that have burned whose 4-neighbour
 * has not (or lies outside the grid), filled over the scaled canvas. Used to show the "without
 * response" perimeter over the contained run (and the reverse).
 */
export function paintRing(data: Uint8ClampedArray, arrival: Float32Array, width: number, height: number, scale: number, t: number, rgba: RGBA): void {
  const W = width * scale;
  const [cr, cg, cb, ca] = rgba;
  for (let r = 0; r < height; r++) {
    for (let c = 0; c < width; c++) {
      const i = r * width + c;
      if (!(arrival[i] <= t)) continue;
      const edge =
        r === 0 || c === 0 || r === height - 1 || c === width - 1 ||
        !(arrival[i - width] <= t) || !(arrival[i + width] <= t) || !(arrival[i - 1] <= t) || !(arrival[i + 1] <= t);
      if (!edge) continue;
      for (let dy = 0; dy < scale; dy++) {
        let p = ((r * scale + dy) * W + c * scale) * 4;
        for (let dx = 0; dx < scale; dx++, p += 4) {
          data[p] = cr;
          data[p + 1] = cg;
          data[p + 2] = cb;
          data[p + 3] = ca;
        }
      }
    }
  }
}

export const COMPARE_RGBA: Record<'both' | 'missed' | 'extra', RGBA> = {
  both: [40, 200, 90, 210],
  missed: [235, 60, 50, 200],
  extra: [250, 190, 40, 170],
};

/**
 * Accuracy view at time t against a real fire's burned mask: burned in both green, burned only in
 * reality (missed) red, burned only in the simulation (extra) amber, everything else transparent.
 */
export function paintCompare(data: Uint8ClampedArray, arrival: Float32Array, t: number, realMask: Uint8Array): void {
  for (let i = 0, p = 0; i < arrival.length; i++, p += 4) {
    const sim = arrival[i] !== NEVER_ARRIVES && arrival[i] <= t;
    const real = realMask[i] === 1;
    const c = sim && real ? COMPARE_RGBA.both : real ? COMPARE_RGBA.missed : sim ? COMPARE_RGBA.extra : null;
    data[p] = c ? c[0] : 0;
    data[p + 1] = c ? c[1] : 0;
    data[p + 2] = c ? c[2] : 0;
    data[p + 3] = c ? c[3] : 0;
  }
}

export interface ForecastRing {
  /** Seconds after ignition. */
  t: number;
  rgba: RGBA;
}

/** Forecast rings: 1 h / 3 h / 6 h in white -> amber -> red. */
export const FORECAST_RINGS: ForecastRing[] = [
  { t: 3600, rgba: [255, 255, 255, 255] },
  { t: 3 * 3600, rgba: [255, 200, 60, 255] },
  { t: 6 * 3600, rgba: [255, 70, 70, 255] },
];

/**
 * Where each ring is drawn: cells burned by its time with a neighbour that could still burn but
 * has not yet (the advancing edge). Roads, water and rock inside the fire are not outlined, and
 * neither is the grid border. Value = ring index + 1, later rings win; 0 = no ring.
 */
export function forecastRingCells(arrival: Float32Array, fuel: Uint8Array, width: number, rings: ForecastRing[]): Uint8Array {
  const out = new Uint8Array(arrival.length);
  const height = arrival.length / width;
  rings.forEach((ring, k) => {
    const open = (j: number): boolean => fuel[j] !== FuelClass.NONE && !(arrival[j] <= ring.t);
    for (let i = 0; i < arrival.length; i++) {
      if (!(arrival[i] <= ring.t)) continue;
      const r = (i / width) | 0;
      const c = i - r * width;
      if ((c > 0 && open(i - 1)) || (c < width - 1 && open(i + 1)) || (r > 0 && open(i - width)) || (r < height - 1 && open(i + width))) out[i] = k + 1;
    }
  });
  return out;
}

export function paintRingCells(data: Uint8ClampedArray, cells: Uint8Array, rings: ForecastRing[]): void {
  for (let i = 0, p = 0; i < cells.length; i++, p += 4) {
    const k = cells[i];
    if (!k) continue;
    const c = rings[k - 1].rgba;
    data[p] = c[0];
    data[p + 1] = c[1];
    data[p + 2] = c[2];
    data[p + 3] = c[3];
  }
}

/** Alignment test pattern: 10-cell checkerboard with a red NW corner block and blue SE block. */
export function paintCompareScaled(data: Uint8ClampedArray, arrival: Float32Array, width: number, height: number, scale: number, t: number, realMask: Uint8Array): void {
  const W = width * scale;
  for (let r = 0; r < height; r++) {
    for (let c = 0; c < width; c++) {
      const i = r * width + c;
      const sim = arrival[i] !== NEVER_ARRIVES && arrival[i] <= t;
      const real = realMask[i] === 1;
      const col = sim && real ? COMPARE_RGBA.both : real ? COMPARE_RGBA.missed : sim ? COMPARE_RGBA.extra : null;
      for (let dy = 0; dy < scale; dy++) {
        let p = ((r * scale + dy) * W + c * scale) * 4;
        for (let dx = 0; dx < scale; dx++, p += 4) {
          data[p] = col ? col[0] : 0;
          data[p + 1] = col ? col[1] : 0;
          data[p + 2] = col ? col[2] : 0;
          data[p + 3] = col ? col[3] : 0;
        }
      }
    }
  }
}

/** paintRingCells on a scaled canvas. */
export function paintRingCellsScaled(data: Uint8ClampedArray, cells: Uint8Array, width: number, height: number, scale: number, rings: ForecastRing[]): void {
  const W = width * scale;
  for (let r = 0; r < height; r++) {
    for (let c = 0; c < width; c++) {
      const k = cells[r * width + c];
      if (!k) continue;
      const col = rings[k - 1].rgba;
      for (let dy = 0; dy < scale; dy++) {
        let p = ((r * scale + dy) * W + c * scale) * 4;
        for (let dx = 0; dx < scale; dx++, p += 4) {
          data[p] = col[0];
          data[p + 1] = col[1];
          data[p + 2] = col[2];
          data[p + 3] = col[3];
        }
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
