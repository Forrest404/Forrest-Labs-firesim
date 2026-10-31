import { defineConfig } from 'vitest/config';

// Tests cover the pure modules only (contract, sim, data, tools). Nothing here touches
// Cesium or the DOM, so the plain Node environment is enough and fast.
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    reporters: 'default',
    testTimeout: 30_000,
    // Fuzzed invariants and the response planner run hundreds of full sims per test; CI runners
    // are 3-4x slower than a laptop and tripped the default 5 s limit.
  },
});
