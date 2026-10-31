# DEMO: a fire above Boulder Creek, and the response that stops it (3 minutes)

The story: a wind-driven fire starts in the redwoods west of Boulder Creek and runs into town.
Without a response it reaches 262 homes in 12 hours. A Standard response barely dents it. A Maximum
response holds it to 11 ha and no home is reached. Then one click of "Red Flag day" shows that on a bad
weather day even the maximum response only saves half.

Every number below comes from the headless rehearsal of 2026-10-31 (`feature/demo-integration`,
Google 3D mode, 214 tests green). The planner is deterministic, so the numbers repeat exactly as long
as the settings in the table are the ones on screen.

## Settings

| | Value | Where |
|---|---|---|
| Area | **Boulder Creek, CA** (opens by default) | Demo area |
| Ignition | the suggested one, in the forest 1.2 km west of town (row 114, col 62) | already placed; do not click the map |
| Wind | **22 km/h from 250° (WSW)** | default for the area |
| Dryness | **High** (8 % moisture) | default |
| Duration | **12 h** | Conditions, chip "12 h" (the default is 6 h: change it) |
| Response level | Standard, then **Maximum** | Emergency response popup, top right |
| Playback speed | **256×** (12 h in 169 s) or **1024×** (42 s) | chips under the clock |

## What the numbers will be

| Run | Burned | Homes reached | Orders | Plan time |
|---|---|---|---|---|
| No response | 176 ha | 262 of 1339 | – | 2.5 s |
| Standard (2 crews, 2 engines, 1 helicopter, 20 min delay) | 153 ha (−13 %) | 254 | 11 | 1.9 s |
| Aggressive | 108 ha (−39 %) | 222 | 23 | ~1 s |
| **Maximum** (4 crews, 4 engines, 2 dozers, 3 helicopters, 2 airtankers, 5 min delay) | **11 ha (−94 %)** | **0** | 17 | 1.0 s |
| Red Flag day + Maximum (40 km/h, 4 % moisture) | 179 ha of 339 (−47 %) | 259 of 276 | 24 | 2.8 s |

With the default 6 h duration the fire is only 67 ha and the first homes are reached in the last
hour, so the "Standard is not enough" beat does not land. Use 12 h.

## The script

| Time | Beat | Do | Say |
|---|---|---|---|
| 0:00 (15 s) | **Fly-in** | Page loads on Boulder Creek, camera oblique over the grid. Click **12 h**. | "Real terrain and land cover above Boulder Creek, Santa Cruz Mountains. Redwood forest, 1,300 buildings. Wind 22 km/h from the south-west, dry fuel." |
| 0:15 (45 s) | **The fire alone** | Press **Simulate**. It plays at 256×. Pick **1024×** to finish in 40 s. Point at the clock and at "Homes reached" under the stat chips. | "One ignition in the forest. Downwind and uphill it runs into town. Twelve hours: 176 hectares, 262 homes reached." |
| 1:00 (30 s) | **Standard response** | In the top-right popup press **Dispatch response**. The progress bar runs for 2 s. Press **Top-down**. Scrub to the end. | "Now the response: two hand crews, two engines, one helicopter, dispatched 20 minutes after detection. Each unit gets an assignment, builds its line cell by cell, and can be outrun. The magenta outline is the fire without them. 153 hectares, 254 homes. Not enough." |
| 1:30 (45 s) | **Maximum response** | Click **Maximum**, then **Dispatch response**. Scrub to **1h30** on the clock, zoom in on the fire with the mouse wheel (unit labels appear under about 7 km). Press **Play**; the dispatch cards on the right tell what every unit is doing. Scrub to the end. | "Maximum: four crews, four engines, two dozers, three helicopters, two air tankers, five-minute dispatch. Dozer line on the south flank, retardant to the north-east, wet lines along the roads. Eleven hectares. No home reached." |
| 2:15 (20 s) | **Without / With** | Click **Without**, then **With response**. | "Same fire, same wind. Only the response differs." |
| 2:35 (25 s) | **Red Flag day** | Press **Red Flag day** (Conditions), then **Dispatch response**. | "Forty kilometres an hour, four percent moisture. The same maximum response saves half the area and a few homes. Weather decides what a response can do." |

Reset between runs: switch **Simulate the response** off (the view returns to the run without a
response), click **High** under Dryness to leave Red Flag, press the reset icon under the clock.

### Shorter variant (90 s)

Simulate, Dispatch (Standard), Maximum + Dispatch, Without / With. Skip Red Flag.

### Optional extras, if asked

- **AI plan** card: "Suggest a plan" (labelled built-in when no Gemini key is set) places one
  firebreak and re-runs; the sim verifies the claim: 67 → 17 ha, 65 → 0 homes on the 6 h run.
- **Tools**: pause, pick **Firebreak** or **Water**, drag on the map; the response re-plans around
  your lines on the next Dispatch.
- **Crozier Fire 2024** (Demo area): **Compare with real fire** gives 67 % IoU at real size with the
  recorded wind, 37 % with no wind, 11 % with the wind reversed. **Real vs simulation** draws both
  maps side by side and pauses itself at real size (about 5.6 h).
- **Live fires** tab: NASA FIRMS detections of the last 24 h on the globe (needs the FIRMS key and
  a responsive NASA server: it was slow to answer on the rehearsal day, so do not promise it).

## Pre-flight (5 minutes before)

1. `npm run dev` from the `feature/demo-integration` checkout; open the printed URL in Chrome,
   window at least 1,200 px wide (the response popup and dispatch cards are hidden under 720 px).
2. Top-left pill says **Google 3D** (key in `.env.local`). "Map · fallback" also works; only the
   backdrop changes.
3. Boulder Creek is selected, the ignition marker sits west of town, the response popup is visible
   top right with the switch **off**.
4. Click **12 h**, **Simulate**: the stat chips must end at **176 ha / 1960 cells, Homes reached 262**.
   Then **Dispatch response** at Standard: **Saved 24 ha · 13 %**. Then **Maximum**: **Saved 165 ha · 94 %**.
5. Switch the response off, press the reset icon. Leave the duration at 12 h.

## If something breaks

| Symptom | Do |
|---|---|
| Numbers differ from the table | Check Conditions (22 km/h, 250°, High, 12 h) and that the ignition was not moved: reload the page and click 12 h again. |
| "Inputs changed · simulate again to replan" in the popup | You changed a setting after dispatching. Press **Dispatch response** again. |
| Dispatch button greyed | No ignition (click a forest cell) or a run is in progress. |
| "No useful assignment found" | Only happens on tiny or already contained fires; pick 12 h. |
| Units pile up or labels overlap | Zoom out: labels hide beyond 7 km and the dispatch cards carry the status. |
| Fallback banner / no tiles | Expected without the key or offline. Carry on. |
| Page hangs | Reload. Nothing is saved between loads. |

## What is honest about it

The spread model is simplified (D3, D10, D13), the response units are order-of-magnitude realistic
and uncalibrated (D27), and the planner is greedy: a bigger response is usually, not always, better
(Red Flag day: Aggressive 54 %, Maximum 47 % on the 6 h run). The disclaimer under the title stays on.
