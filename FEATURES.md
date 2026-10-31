# FEATURES — slots for the 3-person split

Pick a slot, put your handle in Owner, branch `feature/<slot>`. Every extension point below is a
real `TODO(<slot>)` comment at a working seam in the code (`git grep "TODO("` lists them all).

| Slot | Goal | Files owned | Extension point | Acceptance check | Time | Owner |
|---|---|---|---|---|---|---|
| `sim-realism` | Tune factors, burnout, wind variability, ember spotting, sanity calibration against known fire behaviour | `src/sim/*`, numbers in `src/contract/fuels.ts`, `tests/sim.test.ts` | `TODO(sim-realism)` in `src/sim/rates.ts` (`combineRate`: swap in Rothermel ROS) and `src/sim/events.ts` (spotting as a new event source) | `npm test` stays green; the 16 fixture behaviours hold; a 6 h "extreme + 30 km/h" run on Alpirsbach looks like a wind-driven fire, not a disc | 60-90 min | `@unassigned` |
| `live-data` | Overpass + elevation for the current view in the browser, caching, error handling, performance | `src/data/*` (keep `geo.ts` semantics), `scripts/build-demo-area.ts` | `TODO(live-data)` in `src/data/demoAreas.ts` (`loadLiveArea` stub; the pure builders `buildFuelGrid`, `sampleElevationGrid`, `fillNodata` already exist and are tested) | "Live (current view)" loads a real grid in < 20 s or falls back with a banner; never crashes | 60-90 min | `@unassigned` |
| `settings-polish` | Advanced panel completeness, validation, units toggle, reset-to-preset, per-fuel knobs | `src/ui/settingsSimple.ts`, `src/ui/settingsAdvanced.ts`, numbers in `src/contract/presets.ts` | `TODO(settings-polish)` in `src/ui/settingsAdvanced.ts` | Every advanced value round-trips into the scenario (check via `window.__firesim.store.get()` in dev); invalid input is rejected inline | 45-60 min | `@unassigned` |
| `tools-v2` | Retardant, backburn, crews/trucks with resource limits, better brushes | `src/tools/*`, `src/ui/tools.ts`, `src/app/toolsController.ts` | `TODO(tools-v2)` in `src/tools/index.ts` (`DRAW_TOOLS` registry) | New tool appears in the palette, produces interventions, changes the outcome, undoes cleanly, has a test in `tests/tools.test.ts` | 60-90 min | `@unassigned` |
| `3d-polish` | Fire and smoke quality, glow, legend, follow-camera, mobile layout, heights on 3D tiles | `src/viewer/particles.ts`, `src/viewer/camera.ts`, `src/viewer/burnCanvas.ts`, `src/ui/styles.css` | `TODO(3d-polish)` in `src/viewer/particles.ts` and `src/viewer/camera.ts` | Effects on at "high" keep > 30 fps on a laptop in fallback mode; a legend explains the overlay colours | 60-90 min | `@unassigned` |
| `share-persist` | Save/load scenario JSON, share link (optional Supabase; v0 has no backend) | new `src/app/share.ts`, new `src/ui/share.ts` | `TODO(share-persist)` in `src/data/bundle.ts` (reuse its base64 helpers) | Download, reload, re-run gives byte-identical `arrivalTime` | 45-60 min | `@unassigned` |
| `demo-ship` | Deploy, README polish, honesty notice review, demo script, rehearsal, suggested ignitions for the real areas | `README.md`, deploy config, new `docs/demo-script.md`, `public/demo-areas/index.json` | `TODO(demo-ship)` at the end of `README.md` | Deployed URL works on a second machine with no key; 3-minute script rehearsed twice | 45 min | `@unassigned` |

## How to work in parallel

- Branch from `main` as `feature/<slot>`. Pull before you start and before you open a PR.
- Small PRs, one slot at a time. `main` must always build, typecheck, test and run
  (`npm run typecheck && npm test && npm run build`).
- **Never edit `src/contract/` without announcing it in chat first.** Tuning the numbers in
  `fuels.ts` and `presets.ts` is fine; renaming or adding fields is a contract change.
- Stay inside the files your slot owns. If you must touch another slot's file, keep the change
  tiny and say so in the PR.
- `src/viewer/` is the only Cesium importer. `src/sim/` and `src/tools/` never touch the DOM.
- Add a line to `DECISIONS.md` for every judgement call, and to `PROGRESS.md` when you finish.
- Dev hook: in `npm run dev`, `window.__firesim = { store, wiring }`. `wiring.debugStroke(points)`
  feeds a stroke through the active drawing tool, which is how the headless tests drive tools.

## Stubs documented here, not built

- **Scenario sharing (Supabase):** out of scope for v0. If built, use only the public anon key in
  the client, keep keys in `.env.local`, table `scenarios(share_id, scenario_json, created_at)`.
- **Spotting, crown fire, time-varying weather, grid size:** shown disabled in the advanced panel
  with "coming soon".
- **Live (current view):** disabled entry in the area picker; selecting it is impossible, and the
  loader throws a typed `LiveAreaNotAvailable` if called.
