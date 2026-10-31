# FEATURES — slots for the 3-person split

Skeleton written in Stage 1; the "Extension point" column is filled with real `TODO(slot)`
markers in Stage 7 once the code exists. Pick a slot, put your handle in Owner, branch
`feature/<slot>`.

| Slot | Goal | Files owned | Extension point | Acceptance check | Time | Owner |
|---|---|---|---|---|---|---|
| `sim-realism` | Tune factors, wind variability, burnout, ember spotting, sanity calibration | `src/sim/*`, `src/contract/fuels.ts` numbers, `tests/sim.test.ts` | `TODO(sim-realism)` in `src/sim/rates.ts`, `src/sim/events.ts` | Fixture tests still pass; a demo run looks believable at each preset | 60-90 min | `@unassigned` |
| `live-data` | Overpass + elevation for arbitrary bounds, caching, error handling, performance | `src/data/*` (except `geo.ts` semantics), `scripts/build-demo-area.ts` | `TODO(live-data)` in `src/data/demoAreas.ts` | "Live (current view)" loads a real grid in < 20 s or falls back with a banner | 60-90 min | `@unassigned` |
| `settings-polish` | Advanced panel completeness, validation, units toggle, presets UX | `src/ui/settingsSimple.ts`, `src/ui/settingsAdvanced.ts`, `src/contract/presets.ts` numbers | `TODO(settings-polish)` in `src/ui/settingsAdvanced.ts` | Every advanced value round-trips into the scenario; invalid input is rejected inline | 45-60 min | `@unassigned` |
| `tools-v2` | Retardant, backburn, crews/trucks with resource limits, better brushes | `src/tools/*`, `src/ui/tools.ts` | `TODO(tools-v2)` in `src/tools/index.ts` | New tool appears in the palette, produces interventions, changes the outcome, undoes cleanly | 60-90 min | `@unassigned` |
| `3d-polish` | Fire and smoke quality, glow, legend, follow-camera, mobile layout | `src/viewer/particles.ts`, `src/viewer/camera.ts`, `src/viewer/burnCanvas.ts`, `src/ui/styles.css` | `TODO(3d-polish)` in `src/viewer/particles.ts`, `src/viewer/camera.ts` | Effects toggle on/off without frame drops below 30 fps on a laptop | 60-90 min | `@unassigned` |
| `share-persist` | Save/load scenario JSON, share link (optional Supabase) | `src/app/share.ts` (new), `src/ui/share.ts` (new) | `TODO(share-persist)` in `src/data/bundle.ts` | Download, reload, re-run gives identical `arrivalTime` | 45-60 min | `@unassigned` |
| `demo-ship` | Deploy, README, honesty notice, demo script, rehearsal | `README.md`, deploy config, `docs/demo-script.md` (new) | `TODO(demo-ship)` in `README.md` | Deployed URL works on a second machine with no key; 3-minute script rehearsed | 45 min | `@unassigned` |

## How to work in parallel

- Branch from `main` as `feature/<slot>`. Pull before you start and before you open a PR.
- Small PRs, one slot at a time. `main` must always build, typecheck, test and run.
- **Never edit `src/contract/` without announcing it in chat first.** Tuning the numbers in
  `fuels.ts` and `presets.ts` is fine; renaming or adding fields is a contract change.
- Stay inside the files your slot owns. If you must touch another slot's file, keep the change
  tiny and say so in the PR.
- `src/viewer/` is the only Cesium importer. `src/sim/` and `src/tools/` never touch the DOM.
- Add a line to `DECISIONS.md` for every judgement call, and to `PROGRESS.md` when you finish.

## Stubs documented here, not built

- **Scenario sharing (Supabase):** out of scope for v0. If built, use only the public anon key in
  the client, keep keys in `.env.local`, table `scenarios(share_id, scenario_json, created_at)`.
- **Spotting, crown fire, time-varying weather:** advanced panel shows them disabled with
  "coming soon".
