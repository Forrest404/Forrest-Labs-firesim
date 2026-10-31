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
}

const LIGHT = [200, 200, 205];
const DARK = [70, 66, 62];
const BROWN = [125, 92, 60];

export function paintSmoke(data: Uint8ClampedArray, conc: Float32Array, o: SmokePaintOptions): void {
  const scale = o.sigmaExtM2PerKg / Math.max(1, o.cellAreaM2);
  const maxA = Math.max(0, Math.min(1, o.maxAlpha));
  const brown = 0.5 * Math.max(0, Math.min(1, o.smolderFrac));
  for (let i = 0, p = 0; i < conc.length; i++, p += 4) {
    const tau = conc[i] * scale;
    if (!(tau >= 0.02)) {
      data[p] = data[p + 1] = data[p + 2] = data[p + 3] = 0;
      continue;
    }
    const alpha = Math.min(maxA, 1 - Math.exp(-tau));
    const k = Math.min(1, tau / 6);
    for (let c = 0; c < 3; c++) {
      const grey = LIGHT[c] + (DARK[c] - LIGHT[c]) * k;
      data[p + c] = Math.round(grey + (BROWN[c] - grey) * brown);
    }
    data[p + 3] = Math.round(alpha * 255);
  }
}
