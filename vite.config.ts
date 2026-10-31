import { defineConfig } from 'vite';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { generateTacticalBriefing } from './src/server/tacticalBriefingHandler';
import type { TacticalBriefingRequest } from './src/agent/types';

function createTacticalApiMiddleware() {
  return (req: IncomingMessage, res: ServerResponse, next: () => void): void => {
    if (req.url === '/api/tactical-briefing' && req.method === 'POST') {
      let body = '';
      req.on('data', (chunk: Buffer) => {
        body += chunk.toString();
      });
      req.on('end', () => {
        void (async () => {
          try {
            const payload = JSON.parse(body) as TacticalBriefingRequest;
            const result = await generateTacticalBriefing(payload);
            res.statusCode = 200;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify(result));
          } catch (err) {
            res.statusCode = 500;
            res.setHeader('Content-Type', 'application/json');
            res.end(
              JSON.stringify({
                error: err instanceof Error ? err.message : 'Failed to generate tactical briefing',
              }),
            );
          }
        })();
      });
      return;
    }
    next();
  };
}

// Cesium's prebuilt static assets (web workers, widget CSS, textures) are copied into
// public/cesium/ by scripts/copy-cesium.mjs (postinstall / predev / prebuild), so Vite serves
// them the same way in dev and in the build. index.html sets window.CESIUM_BASE_URL = '/cesium/'.
export default defineConfig({
  plugins: [
    {
      name: 'tactical-agent-api',
      configureServer(server) {
        server.middlewares.use(createTacticalApiMiddleware());
      },
      configurePreviewServer(server) {
        server.middlewares.use(createTacticalApiMiddleware());
      },
    },
  ],
  define: {
    CESIUM_BASE_URL: JSON.stringify('/cesium/'),
  },
  worker: {
    format: 'es',
  },
  server: {
    host: '0.0.0.0',
    port: 3000,
    allowedHosts: true,
    hmr: process.env.DISABLE_HMR !== 'true',
    watch: process.env.DISABLE_HMR === 'true' ? null : {},
  },
  preview: {
    host: '0.0.0.0',
    port: 3000,
    allowedHosts: true,
  },
  build: {
    // Cesium is a large single dependency; the warning is expected.
    chunkSizeWarningLimit: 6000,
    sourcemap: false,
  },
});
