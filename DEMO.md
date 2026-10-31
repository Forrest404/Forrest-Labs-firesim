# DEMO: wind-driven woodland fire, Surrey Hills (3 minutes)

One-click demo: a wind-driven fire runs through woodland towards a village, the presenter pauses,
cuts a firebreak and sprays water across its path, and the village is spared. Everything below was
checked headlessly (`npm run tune:demo`, `tests/demoScenario.test.ts`) and click-tested in Chrome.

## Settings (set by "Load demo scenario", do not change by hand)

| | Surrey Hills (main) | Backup (offline) |
|---|---|---|
| Area | `surrey-hills` (real OpenStreetMap land cover + AWS terrain), Leith Hill | `synthetic-ridge` ("Forest Ridge", generated) |
| Ignition (row, col) | 142, 102 = 51.1635 N, -0.3749 E, woodland, 110 m | 114, 124 = 48.3411 N, 8.4099 E, forest, 457 m |
| Wind | from 225 deg (SW), 25 km/h | from 270 deg (W), 25 km/h |
| Dryness | High (8 % fuel moisture) | High |
| Duration, seed | 4 h, 1 | 6 h, 1 |
| Threatened | Coldharbour, 51.1757 N, -0.3719 E (disc of 240 m) | the generated village, 48.3392 N, 8.4266 E |
| Playback speed | 256x (4 h in about 56 s) | 256x (6 h in about 84 s) |
| Camera | looks NE (heading 30), tilted 32 deg, 2.6 km out | looks ENE (heading 70), 2.8 km out |

What happens (numbers from the headless run): **uncontained** Surrey burns 191 ha and reaches the
village at 2h39 (66 % of the run); the head crosses the planned break line at 1h48. **Contained** burns
118 ha (62 %) and never reaches the village, even if you run it to 6 h. With the wind flipped to the NE the
fire turns round and runs the other way. Backup: 143 ha, village at 5h04; contained 95 ha (66 %).

## The 3-minute script

| Time | Beat | Do | Say |
|---|---|---|---|
| 0:00 (15 s) | **Fly-in** | Demo card: scenario "Surrey Hills", press **Load demo scenario**. The camera flies in over Leith Hill. | "Real Surrey woodland and terrain: Leith Hill, Coldharbour on the ridge ahead." |
| 0:15 (30 s) | **Ignite and run** | Press **Simulate** (big orange button). It plays at 256x. | "A fire starts low on the south-west slope. Wind from the south-west, 25 km/h, dry fuel." |
| 0:45 (20 s) | **Uphill and downwind** | Keep playing. Point at the wind arrow in Conditions and at the head of the fire. | "It runs downwind and up the slope. The back barely moves." |
| 1:05 (45 s) | **Pause and cut** | At about **1h30** on the clock press **Space** (pause). Tools card: **Firebreak**, drag across the front from the road on the west (51.1700 N, -0.3786 E) east to (51.1700 N, -0.3622 E). Then **Water**, radius 4, click-drag a short stroke at the east end (51.1707 N, -0.3601 E to 51.1696 N, -0.3601 E). | "Pause, and cut a line across the front, anchored on the road. Water on the open flank." |
| 1:50 (30 s) | **Payoff and compare** | Press **Space** to play on to the end. The fire stops short of the village. Then press **Undo** in Tools (or Ctrl/Cmd+Z) twice, once per stroke, and play again to show the village burning; or press **Reset**, **Load demo scenario**, **Simulate**, then **Show contained version** to apply the saved plan in one step. | "Same fire, same wind. Without the line it reaches the village at 2h39. With it, never." |
| 2:20 (20 s) | **Close** | Open the **Demo tips** (i) if you want the shortcuts on screen. | "Next: live data for any place, more tools (retardant, backburn, crews), calibration." |

Total about 2:40, 20 s of slack. At 256x the fire reaches the break line about 25 s after Simulate.
If you draw the line yourself, any time before about 1h45 on the clock works (the head arrives at 1h48).

### Quick version (no drawing)

Load demo scenario, Simulate, play to the end (village burns), **Reset**, **Load demo scenario**,
**Show contained version**, Simulate. Undo removes the plan again (one step).

## Backup scenario (no network at all)

Pick "Backup: predictable test area" in the Demo card, **Load demo scenario**. The area is generated and
labelled synthetic (the tag shows in the Demo area card). Run it the same way. Break: north-south line
across the front at 48.3477 N, 8.4197 E down to 48.3353 N, 8.4197 E at about **2h18** (the head arrives at
2h43); water at the two ends (48.3485 N, 8.4207 E and 48.3345 N, 8.4207 E). With no network the map
background has no tiles (a blank globe), but the fire overlay, tools and playback work.

## Pre-flight checklist (5 minutes before)

1. `npm install` done; `npm run dev` starts (note the URL it prints; another dev server may already hold 5173).
2. Tiles: top-left pill says **Google 3D** (key present in `.env.local`, never commit it) or **Map · fallback**
   (OpenStreetMap globe; fine, the banner "Fallback view" is expected without a key).
3. Bundle loads: press **Load demo scenario**; the card says "...loaded. Press Simulate." If it shows a
   "Showing the offline backup instead" banner, the Surrey bundle failed to load: reload the page.
4. Speed chip shows **256x** after loading (Load sets it).
5. Press **Simulate**, check about 191 ha / 2120 cells at the end, then **Reset**.
6. Optional: `npm run tune:demo` (every line PASS) and `npm test`.
7. Browser window at least 1200 px wide, panel open, zoom 100 %.

## If something breaks

| Symptom | Do |
|---|---|
| Map tiles missing or "Fallback view" banner | Expected without a key or network. Carry on: the overlay does not depend on tiles. |
| "Could not load ... Showing the offline backup" | Run the backup instead (it is a static file), or reload and try again. |
| Simulate does nothing or the numbers look odd | **Reset**, then **Load demo scenario**. Check the settings table above against Conditions. |
| The fire is already past the line when you draw it | Press **Reset**, or **Undo** and draw earlier (before 1h45). Or use **Show contained version**. |
| Drawing on the 3D map is awkward | Use **Show contained version**: it applies the same line and spray in one click (Undo removes both). |
| Playback too fast or slow | Speed chips under the clock (1x to 256x). |
| Page hangs | Reload. Nothing is saved between loads, so Load demo scenario starts clean. |

## Reproduce and re-tune

`npm run tune:demo` prints the full report and exits 1 if any promise breaks. Values live in
`src/data/demo-scenarios.ts` (weather, ignition, duration, camera, the saved plan). To rebuild the Surrey
area on a networked machine: `npm run build:demo-area -- --name surrey-hills --label "Surrey Hills (Leith Hill)" --center -0.376,51.175 --wind 225 --default GRASS`
(Overpass can return 502 or time out: it tries three mirrors, so run it again if it fails). Reasoning and
limits (why the fire is a teardrop, what "reaching the village" means): `DECISIONS.md` D23 and D24.
