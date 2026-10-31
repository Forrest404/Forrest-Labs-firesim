# src

Single TypeScript web app (Vite). Module map and import rules:

| Folder | Owns | Must not import |
|---|---|---|
| `contract/` | **Frozen** shared types, conventions, fuel table, presets, validator | anything else in `src/` |
| `sim/` | Pure simulation core (`simulate(scenario)`), worker wrapper | DOM, Cesium, `data/`, `ui/`, `viewer/` |
| `data/` | lat/lon to grid (`geo.ts`), rasterisation, contours (marching squares), terrain decode, OSM tag mapping, bundles, synthetic areas | Cesium, DOM (Node-safe) |
| `export/` | File formats for results (GeoJSON perimeters and probability lines). May import `contract/`, `data/` and `sim/` | Cesium, DOM, `ui/`, `viewer/` |
| `tools/` | Firebreak and water tools as pure logic producing `Intervention`s, undo/redo | Cesium, DOM |
| `viewer/` | **The only Cesium importer.** Viewer setup, Google tiles + fallback, burn overlay, particles, camera, picking | `ui/` |
| `ui/` | Side panel, settings, playback, notices, debug toggles, `strings.ts` | Cesium |
| `app/` | State store, worker client, wiring, entry point | — |

Each module folder has its own `README.md` with its public interface and extension points.
See [`../FEATURES.md`](../FEATURES.md) for who works where.
