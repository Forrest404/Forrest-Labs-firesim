/**
 * Counter-based pseudo-random numbers: a pure function of (seed, a, b, c), not a stream. The same
 * (seed, cell, ember) always gives the same draw no matter what else happens in the run, so adding
 * a firebreak or changing the order of events cannot reshuffle the embers of unrelated cells.
 * (A stream such as mulberry32 would make every later draw depend on how many came before.)
 * Mixing is a 32-bit avalanche in the style of murmur3's finaliser.
 */

export function hash32(seed: number, a: number, b: number, c: number): number {
  let h = Math.imul(seed ^ 0x9e3779b9, 0x85ebca6b);
  h = Math.imul((h ^ (h >>> 16)) ^ a, 0x7feb352d);
  h = Math.imul((h ^ (h >>> 15)) ^ b, 0x846ca68b);
  h = Math.imul((h ^ (h >>> 16)) ^ c, 0x9e3779b1);
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/** Uniform in [0, 1). */
export function hashUnit(seed: number, a: number, b: number, c: number): number {
  return hash32(seed, a, b, c) / 4294967296;
}

/** Standard normal via Box-Muller from two independent streams (c and c + 1000003). */
export function hashNormal(seed: number, a: number, b: number, c: number): number {
  const u1 = Math.max(1e-12, hashUnit(seed, a, b, c));
  const u2 = hashUnit(seed, a, b, c + 1_000_003);
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}
