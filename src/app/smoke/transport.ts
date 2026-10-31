/**
 * Grid transport kernels on Float32Array fields (row 0 north, index = row*w + col). All are
 * unconditionally stable: advection is backward semi-Lagrangian with bilinear sampling, diffusion
 * is a Gaussian approximated by three running-sum box blurs per axis (O(n) for any sigma).
 * Outside the grid reads as zero, so mass leaves the domain and nothing enters.
 */

/** dst[x,y] = src[x - dxCells, y - dyCells] (bilinear). Positive dy moves mass toward higher rows (south). */
export function advect(src: Float32Array, dst: Float32Array, w: number, h: number, dxCells: number, dyCells: number): void {
  if (dxCells === 0 && dyCells === 0) {
    dst.set(src);
    return;
  }
  for (let y = 0; y < h; y++) {
    const sy = y - dyCells;
    const y0 = Math.floor(sy);
    const fy = sy - y0;
    const y1 = y0 + 1;
    const rowOk0 = y0 >= 0 && y0 < h;
    const rowOk1 = y1 >= 0 && y1 < h;
    for (let x = 0; x < w; x++) {
      const sx = x - dxCells;
      const x0 = Math.floor(sx);
      const fx = sx - x0;
      const x1 = x0 + 1;
      const colOk0 = x0 >= 0 && x0 < w;
      const colOk1 = x1 >= 0 && x1 < w;
      let v = 0;
      if (rowOk0) {
        const base = y0 * w;
        if (colOk0) v += src[base + x0] * (1 - fx) * (1 - fy);
        if (colOk1) v += src[base + x1] * fx * (1 - fy);
      }
      if (rowOk1) {
        const base = y1 * w;
        if (colOk0) v += src[base + x0] * (1 - fx) * fy;
        if (colOk1) v += src[base + x1] * fx * fy;
      }
      dst[y * w + x] = v;
    }
  }
}

/** Box radii that approximate a Gaussian of the given sigma with n passes ("boxes for Gauss"). */
export function boxesForGauss(sigma: number, n: number): number[] {
  const wIdeal = Math.sqrt((12 * sigma * sigma) / n + 1);
  let wl = Math.floor(wIdeal);
  if (wl % 2 === 0) wl--;
  const wu = wl + 2;
  const mIdeal = (12 * sigma * sigma - n * wl * wl - 4 * n * wl - 3 * n) / (-4 * wl - 4);
  const m = Math.round(mIdeal);
  const sizes: number[] = [];
  for (let i = 0; i < n; i++) sizes.push(i < m ? wl : wu);
  return sizes.map((s) => (s - 1) / 2);
}

function boxBlurH(src: Float32Array, dst: Float32Array, w: number, h: number, r: number): void {
  const inv = 1 / (2 * r + 1);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    let sum = 0;
    for (let x = 0; x <= r && x < w; x++) sum += src[row + x];
    for (let x = 0; x < w; x++) {
      dst[row + x] = sum * inv;
      const add = x + r + 1;
      const sub = x - r;
      if (add < w) sum += src[row + add];
      if (sub >= 0) sum -= src[row + sub];
    }
  }
}

function boxBlurV(src: Float32Array, dst: Float32Array, w: number, h: number, r: number): void {
  const inv = 1 / (2 * r + 1);
  for (let x = 0; x < w; x++) {
    let sum = 0;
    for (let y = 0; y <= r && y < h; y++) sum += src[y * w + x];
    for (let y = 0; y < h; y++) {
      dst[y * w + x] = sum * inv;
      const add = y + r + 1;
      const sub = y - r;
      if (add < h) sum += src[add * w + x];
      if (sub >= 0) sum -= src[sub * w + x];
    }
  }
}

/** Gaussian blur of `buf` in place (uses `tmp` as scratch). Skipped when sigma is tiny. */
export function blur(buf: Float32Array, tmp: Float32Array, w: number, h: number, sigmaCells: number): void {
  if (!(sigmaCells >= 0.3)) return;
  const radii = boxesForGauss(sigmaCells, 3);
  for (const r of radii) {
    if (r <= 0) continue;
    boxBlurH(buf, tmp, w, h, r);
    boxBlurV(tmp, buf, w, h, r);
  }
}

export function decay(buf: Float32Array, factor: number): void {
  if (factor === 1) return;
  for (let i = 0; i < buf.length; i++) buf[i] *= factor;
}
