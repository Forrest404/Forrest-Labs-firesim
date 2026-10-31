import { describe, expect, it } from 'vitest';
import { NEVER_ARRIVES } from '../src/contract';
import { flicker, paintBurn, paintBurnScaled } from '../src/viewer/burnCanvas';
import { upsampleBilinear, upsampleNearest } from '../src/viewer/smokeCanvas';

const W = 6, H = 6;
function arrivalWithBlob(): Float32Array {
  const a = new Float32Array(W * H).fill(NEVER_ARRIVES);
  for (let y = 1; y <= 3; y++) for (let x = 1; x <= 3; x++) a[y * W + x] = 0;
  return a;
}

describe('paintBurnScaled', () => {
  it('at scale 1 without smoothing or glow equals paintBurn', () => {
    const arrival = arrivalWithBlob();
    const a = new Uint8ClampedArray(W * H * 4);
    const b = new Uint8ClampedArray(W * H * 4);
    paintBurn(a, arrival, 100, { flameWindowS: 600 });
    paintBurnScaled(b, arrival, W, H, 1, 100, { flameWindowS: 600 });
    expect(b).toEqual(a);
  });

  it('at scale 2 without smoothing is a nearest upsample of scale 1', () => {
    const arrival = arrivalWithBlob();
    const a = new Uint8ClampedArray(W * H * 4);
    const b = new Uint8ClampedArray(W * H * 16);
    paintBurn(a, arrival, 100, { flameWindowS: 600 });
    paintBurnScaled(b, arrival, W, H, 2, 100, { flameWindowS: 600, smooth: false });
    for (let py = 0; py < H * 2; py++) for (let px = 0; px < W * 2; px++) {
      const src = (((py / 2) | 0) * W + ((px / 2) | 0)) * 4;
      const dst = (py * W * 2 + px) * 4;
      for (let c = 0; c < 4; c++) expect(b[dst + c]).toBe(a[src + c]);
    }
  });

  it('smoothing anti-aliases the front: partial alpha just outside the blob, full inside', () => {
    const arrival = arrivalWithBlob();
    const b = new Uint8ClampedArray(W * H * 16);
    paintBurnScaled(b, arrival, W, H, 2, 100, { flameWindowS: 600, smooth: true });
    const alphaAt = (px: number, py: number) => b[(py * W * 2 + px) * 4 + 3];
    expect(alphaAt(5, 5)).toBe(235); // centre of the blob (cell 2,2)
    const edge = alphaAt(1, 5); // pixel in cell 0 next to the blob edge
    expect(edge).toBeGreaterThan(0);
    expect(edge).toBeLessThan(235);
    expect(alphaAt(0, 0)).toBe(0); // far corner
  });

  it('glow paints orange onto empty pixels next to flaming cells only when enabled', () => {
    const arrival = arrivalWithBlob();
    const on = new Uint8ClampedArray(W * H * 16);
    const off = new Uint8ClampedArray(W * H * 16);
    paintBurnScaled(on, arrival, W, H, 2, 100, { flameWindowS: 600, smooth: false, glow: true });
    paintBurnScaled(off, arrival, W, H, 2, 100, { flameWindowS: 600, smooth: false, glow: false });
    const p = (0 * W * 2 + 2) * 4; // pixel in cell (1,0): directly above the blob
    expect(off[p + 3]).toBe(0);
    expect(on[p + 3]).toBeGreaterThan(0);
    expect(on[p]).toBe(255);
    expect(on[p + 1]).toBe(130);
    // Inside the blob the flaming colour is untouched.
    const q = (5 * W * 2 + 5) * 4;
    expect(on[q + 3]).toBe(235);
    expect(on[q]).toBe(off[q]);
    // Charred cells (age >= window) do not glow.
    const charred = new Uint8ClampedArray(W * H * 16);
    paintBurnScaled(charred, arrival, W, H, 2, 10_000, { flameWindowS: 600, smooth: false, glow: true });
    expect(charred[p + 3]).toBe(0);
  });

  it('flicker is deterministic and bounded', () => {
    expect(flicker(5, 100)).toBe(flicker(5, 100));
    for (let i = 0; i < 50; i++) {
      const f = flicker(i, i * 37);
      expect(f).toBeGreaterThanOrEqual(0.7);
      expect(f).toBeLessThanOrEqual(1.0);
    }
    expect(flicker(5, 0)).not.toBe(flicker(5, 1000));
  });
});

describe('upsampling', () => {
  it('nearest repeats cells, bilinear conserves the mean and interpolates between cells', () => {
    const src = new Float32Array([0, 1, 0, 1]); // 2x2
    const near = new Float32Array(16);
    upsampleNearest(src, 2, 2, 2, near);
    expect(Array.from(near.slice(0, 4))).toEqual([0, 0, 1, 1]);
    const bil = new Float32Array(16);
    upsampleBilinear(src, 2, 2, 2, bil);
    const mean = bil.reduce((a, b) => a + b, 0) / 16;
    expect(mean).toBeCloseTo(0.5, 6);
    expect(bil[1]).toBeGreaterThan(0);
    expect(bil[1]).toBeLessThan(1);
    expect(bil[0]).toBe(0);
    expect(bil[3]).toBe(1);
  });
});
