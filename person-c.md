# Person C: numbers, demo script, pitch copy, test plan

Checked against the `scaffold/v0` code (`src/contract/presets.ts`, `src/contract/fuels.ts`, `src/sim/rates.ts`, `src/data/osm.ts`) and the real `boulder-creek` bundle. Last updated 2026-10-31.

## 1. Presets and numbers

### Dryness presets

The app's presets are reasonable. The moisture numbers are about 2x real values, but the fuels' extinction moistures are also about 2x, so the ratio that drives spread (moisture ÷ extinction) is close to real. **Keep the numbers; don't show the moisture % on screen as if it were a measured value.**

| Preset | Temp | Humidity | App fuel moisture | Real 1-hour dead fuel moisture (approx.) | Real-world equivalent |
|---|---|---|---|---|---|
| Low | 15 °C | 60 % | 18 % | ~10 % | Cool, humid day; fire creeps |
| Medium | 22 °C | 40 % | 12 % | ~7 % | Normal summer afternoon |
| High | 30 °C | 25 % | 8 % | ~4–5 % | Hot, dry summer day |
| Extreme | 38 °C | 8 % | 4 % | ~2–3 % | **Red Flag day.** NWS warnings usually need humidity ≤ 15 % plus strong wind (criteria vary by office). The real Crozier Fire days were 35 °C and ~10 % |

### Wind

| Setting | Value | Why |
|---|---|---|
| Slider range | **0–80 km/h** (already in the app) | Covers calm to strong Santa Ana / Diablo winds. Keep it |
| Default | **22 km/h (6 m/s) from the west** (already in the app) | A typical breezy California afternoon |
| Demo setting | **40 km/h from 250° (WSW)** | Red Flag strength. 250° is also the Boulder Creek bundle's `defaultWindFromDeg` |
| Real-fire run | **13 km/h from 225°** | Crozier Fire afternoons (Open-Meteo archive) |

Labels people understand: 0–10 calm, 10–25 breezy, 25–40 windy, 40+ Red Flag.

### Fuel table sanity check

**Head-fire speed in the app (km/h)**, flat ground, by wind speed:

| Fuel | High, 22 km/h | Extreme, 22 km/h | Extreme, 40 km/h |
|---|---|---|---|
| Grass | 0.68 | 1.01 | 1.53 |
| Shrub | 0.51 | 0.76 | 1.15 |
| Conifer forest | 0.38 | 0.52 | 0.80 |
| Deciduous forest | 0.25 | 0.35 | 0.53 |
| Farmland | 0.34 | 0.50 | 0.77 |

Computed from `rates.ts` with the default settings: base rate × wind factor × moisture factor.

**What's right:** the order grass > shrub > conifer > deciduous holds, and drier or windier conditions are always faster.

**What to tune.** Send this to Person A; each item is a number change, not new code:

1. **Strong-wind fires are 3–5x too slow.** A published rule of thumb says that in dry forest and shrubland a wildfire's forward speed is about **10 % of the open wind speed** ([Cruz & Alexander 2019](https://doi.org/10.1007/s13595-019-0829-8)). At 40 km/h that's ~4 km/h; the app gives 0.8–1.5 km/h. For a quick fix, raise `globalMultiplier` for the demo, or tune `windExponent`. Then check against the Crozier comparison.
2. **Shrub should not be slower than grass for California.** Chaparral is among the fastest fuels under wind. Suggest `SHRUB.baseRateMps` 0.045 → **0.06**.
3. **Farmland should be low.** In California, orchards and vineyards are usually irrigated and often act as fuel breaks. Suggest `FARMLAND.baseRateMps` 0.03 → **0.015**.
4. **Unmapped land defaults to grass (D10), and that's 61 % of Boulder Creek.** I decoded the bundle: 61 % grass, 27 % conifer, 6 % farmland, 5 % non-burnable. The real area is mostly redwood forest. Suggest a **per-area default fuel**: conifer for Boulder Creek and Truckee. The builder already makes the default configurable.

**OSM tag mapping is sound:** forest/wood → conifer (broadleaved → deciduous); scrub/heath → shrub; grassland/meadow → grass; farmland/orchard/vineyard → farmland; buildings, water, rock and major roads/rivers → non-burnable. Leaving `landuse=residential` as burnable (D13) is right for wooded California towns.

## 2. Demo script (3 minutes)

**Area:** Boulder Creek, CA. It's already a real bundle in the app (`?area=boulder-creek`). Note: the 2020 CZU Lightning Complex fire burned in these mountains, so the team should be comfortable with that before showing it.

**Ignition spot:** **37.1221, -122.1347**. That's a conifer/grass edge on the hillside 1.2 km WSW of town, at 422 m. The town sits in the valley at ~150 m. With wind from 250° the fire is pushed straight at town. Have this clicked or bookmarked before going on stage.

**Settings:** dryness **Extreme**, wind **40 km/h from 250°**, duration **6 h**, playback **64x** or faster.

| Time | On screen | Say |
|---|---|---|
| 0:00–0:15 | Already flying over Boulder Creek in 3D. No slides | **Opening line** (below) |
| 0:15–0:40 | Click the ignition spot. Set Extreme and 40 km/h. Press Simulate | "Real land cover, real terrain. A Red Flag afternoon: 38 degrees, 8 % humidity, 40 km/h wind." |
| 0:40–1:20 | Fire runs downwind toward town. Scrub the timeline | "Two hours in, it's at the edge of town. This is the moment a crew commander has to decide." |
| 1:20–2:10 | Pause. Draw a firebreak across the head of the fire, spray water on a flank. Re-run | "Cut a firebreak here, wet the flank there, and the simulation replays with those actions at the time we took them." |
| 2:10–2:40 | Show the result: fire held or slowed before town | "Same fire, same wind. The difference is the plan." |
| 2:40–3:00 | Honest limitations line (below) and the next step | Close |

**If something breaks:** switch to the synthetic area, or play the backup screen recording (record it by 3:30).

**Opening line:**
> "When a wildfire starts above a town, a fire commander has minutes to decide where to cut a firebreak, and no way to test that decision first. We built one."

**Honest limitations line:**
> "This is a simplified model, not a forecast: fixed weather, no ember spotting, no crews. Next we're checking it against a real fire, the 2024 Crozier Fire, and we'll show you that number rather than claim accuracy."

If the Crozier comparison is built in time, replace the second sentence with the measured overlap: "...and it matched X % of the real burned area."

## 3. README and pitch copy

**Project description (one paragraph):**
> Wildfire Sim is a 3D wildfire planning tool for California. Pick a real place, start a fire, set the wind and dryness, and watch it spread across real terrain and land cover. Then fight it: cut firebreaks and spray water at the moment you choose, and the simulation replays with your plan applied. It's built for the decision a fire commander faces in the first hours: where to put limited crews before the fire gets there.

**How it works:**
> The map is a grid of 30 m cells, each with a fuel type from OpenStreetMap and an elevation from open terrain data. From every burning cell, the fire reaches each neighbour after a travel time set by the fuel, the wind (faster downwind), the slope (faster uphill) and the dryness. The app solves for the earliest time fire reaches every cell, so a run is instant and the same inputs always give the same result. Firebreaks remove fuel, and water raises moisture that fades over time.

**Honesty notice (README top and on screen):**
> Simplified model for exploring ideas. Not a forecast and not for real-world decisions. Spread trends follow the Rothermel model, but the numbers are not calibrated against real fires yet.

**Roadmap (what we'd add with more time):**
1. **Real physics:** Rothermel rate of spread with the 40 Scott & Burgan fuel models.
2. **Real fuel data:** LANDFIRE fuel maps instead of OpenStreetMap land cover.
3. **Ember spotting and crown fire:** how real fires jump firebreaks and run through treetops.
4. **Validation:** compare against real fire perimeters (starting with Crozier 2024) and publish the overlap score.
5. **Live weather:** pull forecast wind and humidity for any location and day.

**References for the pitch:**
- Rothermel, R. C. (1972). [A mathematical model for predicting fire spread in wildland fuels](https://www.fs.usda.gov/rm/pubs_int/int_rp115.pdf). USDA Forest Service INT-115. The basis of US fire-spread models.
- Finney, M. A. (1998). [FARSITE: Fire Area Simulator](https://www.fs.usda.gov/rm/pubs/rmrs_rp004.pdf). USDA Forest Service RMRS-RP-4. The standard operational spread simulator.
- Scott, J. H. and Burgan, R. E. (2005). [Standard fire behavior fuel models](https://www.fs.usda.gov/rm/pubs/rmrs_gtr153.pdf). USDA Forest Service RMRS-GTR-153. The 40 fuel models LANDFIRE maps.
- [LANDFIRE](https://landfire.gov/). US national fuel, vegetation and terrain maps at 30 m.
- Cruz, M. G. and Alexander, M. E. (2019). [The 10 % wind speed rule of thumb](https://doi.org/10.1007/s13595-019-0829-8). Annals of Forest Science. Used above as a sanity check.

## 4. Test plan for v0

Run each on the real Boulder Creek area unless noted. Tick when it passes.

- [ ] **Wind direction:** wind from 270° (west), and the fire stretches east. Change to 90° and it stretches west.
- [ ] **Wind strength:** at 0 km/h the burn is roughly round; at 40 km/h it's clearly elongated downwind.
- [ ] **Uphill is faster:** on a slope with no wind, the fire runs further uphill than downhill in the same time.
- [ ] **Dryness:** same ignition and seed, Low vs Extreme. Extreme burns at least 2x the area at the same time.
- [ ] **Water delays spread:** spray ahead of the front; the fire arrives later there, then speeds back up as the water fades.
- [ ] **Firebreak blocks it:** a break across the head stops the fire unless it can go around. Cells behind it stay unburned.
- [ ] **Barriers:** the fire doesn't cross the river or a major road.
- [ ] **Ignition guard:** clicking water or a road is rejected with a message.
- [ ] **Repeatable:** the same settings twice give the identical result.
- [ ] **Fallback mode:** with no Google key, or with the network off, the app still loads the saved area with a banner.
- [ ] **Deployed URL:** works on a second laptop.
- [ ] **Demo timing:** the full script runs in under 3 minutes, rehearsed twice.
