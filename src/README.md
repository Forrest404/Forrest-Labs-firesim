# src

Single TypeScript web app (Vite). Module map and import rules:

| Folder | Owns | Must not import |
|---|---|---|
| `contract/` | **Frozen** shared types, conventions, fuel table, presets, validator | anything else in `src/` |
| `sim/` | Pure simulation core (`simulate(scenario)`), worker wrapper | DOM, Cesium, `data/`, `ui/`, `viewer/` |
| `data/` | lat/lon to grid (`geo.ts`), rasterisation, terrain decode, OSM tag mapping, bundles, synthetic areas, NASA FIRMS parse/fetch (`firms.ts`, `firmsClient.ts`) | Cesium, DOM (Node-safe) |
| `export/` | File formats for results (GeoJSON perimeters and probability lines). May import `contract/`, `data/` and `sim/` | Cesium, DOM, `ui/`, `viewer/` |
| `tools/` | Firebreak and water tools as pure logic producing `Intervention`s, undo/redo | Cesium, DOM |
| `viewer/` | **The only Cesium importer.** Viewer setup, Google tiles + fallback, burn overlay, particles, camera, picking, live hotspot points (`hotspotLayer.ts`) | `ui/` |
| `ui/` | Side panel (Simulation / Live fires tabs), settings, playback, notices, debug toggles, live pane (`live.ts`), `strings.ts` | Cesium |
| `app/` | State store, worker client, wiring, live-fires controller (`liveController.ts`), entry point | — |

Each module folder has its own `README.md` with its public interface and extension points.
See [`../FEATURES.md`](../FEATURES.md) for who works where.
