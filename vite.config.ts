import { defineConfig } from 'vite';

// Cesium's prebuilt static assets (web workers, widget CSS, textures) are copied into
// public/cesium/ by scripts/copy-cesium.mjs (postinstall / predev / prebuild), so Vite serves
// them the same way in dev and in the build. index.html sets window.CESIUM_BASE_URL from %BASE_URL%.
//
// BASE_PATH: public URL prefix the site is served under. '/' locally; the GitHub Pages workflow
// sets it to '/<repo-name>/' because project pages live under a sub-path.
const base = process.env.BASE_PATH ?? '/';

export default defineConfig({
  base,
  define: {
    CESIUM_BASE_URL: JSON.stringify(`${base}cesium/`),
  },
  worker: {
    format: 'es',
  },
  build: {
    // Cesium is a large single dependency; the warning is expected.
    chunkSizeWarningLimit: 6000,
    sourcemap: false,
  },
});
