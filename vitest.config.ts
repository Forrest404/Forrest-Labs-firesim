import { defineConfig } from 'vitest/config';

// Tests cover the pure modules only (contract, sim, data, tools). Nothing here touches
// Cesium or the DOM, so the plain Node environment is enough and fast.
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    reporters: 'default',
  },
});
