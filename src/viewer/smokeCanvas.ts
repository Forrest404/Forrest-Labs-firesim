/**
 * Pure painter for the smoke layer: column-integrated smoke per cell -> RGBA. Opacity follows
 * Beer-Lambert with a nominal mass extinction, capped so the ground stays readable; the tint goes
 * from light grey (thin) to dark (thick) and toward brown as the smoldering share grows.
 */

export interface SmokePaintOptions {
  cellAreaM2: number;
  /** Mass extinction efficiency, m^2 per kg of particulate (biomass smoke ~4 m^2/g). */
  sigmaExtM2PerKg: number;
  /** Opacity cap, 0..1. */
  maxAlpha: number;
  /** Smoldering share of recent emission, 0..1 (mixes brown into the tint). */
  smolderFrac: number;
  /**
   * Optional per-cell mask (1 = flaming) at grid resolution: smoke over flaming cells is drawn at
   * `dimFactor` opacity so the fire stays visible under its own plume.
   */
  dim?: { mask: Uint8Array; width: number; height: number; scale: number; factor: number };
}

const LIGHT = [200, 200, 205];
const DARK = [70, 66, 62];
const BROWN = [125, 92, 60];

export function paintSmoke(data: Uint8ClampedArray, conc: Float32Array, o: SmokePaintOptions): void {
  const scale = o.sigmaExtM2PerKg / Math.max(1, o.cellAreaM2);
  const maxA = Math.max(0, Math.min(1, o.maxAlpha));
  const brown = 0.5 * Math.max(0, Math.min(1, o.smolderFrac));
  const dim = o.dim;
  const W = dim ? dim.width * dim.scale : 0;
  for (let i = 0, p = 0; i < conc.length; i++, p += 4) {
    const tau = conc[i] * scale;
    if (!(tau >= 0.02)) {
      data[p] = data[p + 1] = data[p + 2] = data[p + 3] = 0;
      continue;
    }
    let alpha = Math.min(maxA, 1 - Math.exp(-tau));
    if (dim) {
      const px = i % W;
      const py = (i / W) | 0;
      const ci = ((py / dim.scale) | 0) * dim.width + ((px / dim.scale) | 0);
      if (dim.mask[ci]) alpha *= dim.factor;
    }
    const k = Math.min(1, tau / 6);
    for (let c = 0; c < 3; c++) {
      const grey = LIGHT[c] + (DARK[c] - LIGHT[c]) * k;
      data[p + c] = Math.round(grey + (BROWN[c] - grey) * brown);
    }
    data[p + 3] = Math.round(alpha * 255);
  }
}

/** Nearest-neighbour upsample of a per-cell field to (w*scale) x (h*scale). */
export function upsampleNearest(src: Float32Array, w: number, h: number, scale: number, out: Float32Array): void {
  const W = w * scale;
  for (let py = 0; py < h * scale; py++) {
    const row = ((py / scale) | 0) * w;
    for (let px = 0; px < W; px++) out[py * W + px] = src[row + ((px / scale) | 0)];
  }
}

/** Bilinear upsample (cell centres as samples, edges clamped). */
export function upsampleBilinear(src: Float32Array, w: number, h: number, scale: number, out: Float32Array): void {
  const W = w * scale;
  const H = h * scale;
  for (let py = 0; py < H; py++) {
    const v = (py + 0.5) / scale - 0.5;
    let y0 = Math.floor(v);
    let fy = v - y0;
    if (y0 < 0) { y0 = 0; fy = 0; }
    const y1 = Math.min(h - 1, y0 + 1);
    for (let px = 0; px < W; px++) {
      const u = (px + 0.5) / scale - 0.5;
      let x0 = Math.floor(u);
      let fx = u - x0;
      if (x0 < 0) { x0 = 0; fx = 0; }
      const x1 = Math.min(w - 1, x0 + 1);
      out[py * W + px] =
        src[y0 * w + x0] * (1 - fx) * (1 - fy) + src[y0 * w + x1] * fx * (1 - fy) + src[y1 * w + x0] * (1 - fx) * fy + src[y1 * w + x1] * fx * fy;
    }
  }
}
