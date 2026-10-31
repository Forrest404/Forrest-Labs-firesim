import { defineConfig } from 'vite';
import { viteStaticCopy } from 'vite-plugin-static-copy';

// Cesium ships prebuilt static assets (web workers, widgets CSS, textures) that must be
// served from a known URL. We copy them to /cesium/ in dev and in the build output and
// tell Cesium where to find them via the CESIUM_BASE_URL global.
const cesiumSource = 'node_modules/cesium/Build/Cesium';
const cesiumStaticDirs = ['Workers', 'ThirdParty', 'Assets', 'Widgets'];

export default defineConfig({
  define: {
    CESIUM_BASE_URL: JSON.stringify('/cesium/'),
  },
  plugins: [
    viteStaticCopy({
      targets: cesiumStaticDirs.map((dir) => ({ src: `${cesiumSource}/${dir}`, dest: 'cesium' })),
    }),
  ],
  worker: {
    format: 'es',
  },
  build: {
    // Cesium is a large single dependency; the warning is expected.
    chunkSizeWarningLimit: 6000,
    sourcemap: false,
  },
});
