/**
 * Seeded value noise for synthetic demo areas. Pure.
 * Contains its own mulberry32 so src/data does not import src/sim (see src/README.md rules).
 */

export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}

/** One octave of value noise on a lattice with the given spacing (cells). Values in [0, 1]. */
function octave(seed: number, width: number, height: number, spacing: number): Float32Array {
  const gw = Math.ceil(width / spacing) + 2;
  const gh = Math.ceil(height / spacing) + 2;
  const rand = seededRandom(seed);
  const lattice = new Float32Array(gw * gh);
  for (let i = 0; i < lattice.length; i++) lattice[i] = rand();
  const out = new Float32Array(width * height);
  for (let r = 0; r < height; r++) {
    const gy = r / spacing;
    const y0 = Math.floor(gy);
    const ty = smooth(gy - y0);
    for (let c = 0; c < width; c++) {
      const gx = c / spacing;
      const x0 = Math.floor(gx);
      const tx = smooth(gx - x0);
      const a = lattice[y0 * gw + x0];
      const b = lattice[y0 * gw + x0 + 1];
      const d = lattice[(y0 + 1) * gw + x0];
      const e = lattice[(y0 + 1) * gw + x0 + 1];
      out[r * width + c] = (a * (1 - tx) + b * tx) * (1 - ty) + (d * (1 - tx) + e * tx) * ty;
    }
  }
  return out;
}

/** Fractal value noise, normalised to [0, 1]. */
export function valueNoise(seed: number, width: number, height: number, spacing: number, octaves = 3): Float32Array {
  const out = new Float32Array(width * height);
  let amp = 1;
  let total = 0;
  for (let o = 0; o < octaves; o++) {
    const layer = octave(seed + o * 1013, width, height, Math.max(2, spacing / Math.pow(2, o)));
    for (let i = 0; i < out.length; i++) out[i] += layer[i] * amp;
    total += amp;
    amp *= 0.5;
  }
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < out.length; i++) {
    out[i] /= total;
    if (out[i] < min) min = out[i];
    if (out[i] > max) max = out[i];
  }
  const span = max - min || 1;
  for (let i = 0; i < out.length; i++) out[i] = (out[i] - min) / span;
  return out;
}
