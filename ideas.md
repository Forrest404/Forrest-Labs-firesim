# Wildfire Simulator: Ideas & Brainstorm

## Vision

A web-based forest fire simulator using real terrain and vegetation data. The user places an ignition point on a map, chooses conditions (simple or advanced settings), and runs a simulation of fire spread. Firefighting tools (cutting trees, spraying water) let the user intervene and the simulation reacts.

## Reality check on "exactly"

No simulator predicts fire spread exactly; even research-grade models are statistically right. Our honest, achievable goal: **physically grounded and validated against real historical fires** (e.g. "matches the 20XX fire perimeter within X%").

## Data sources

Google Maps does not provide tree-level data and its terms restrict extracting/processing its data this way. Use it, if at all, only as a UI/basemap consideration; prefer open sources:

- **Fuel/vegetation:** LANDFIRE (US, standard fuel models), CORINE (Europe), ESA WorldCover (global)
- **Canopy height/density:** Meta/WRI global canopy height, GEDI lidar, national lidar
- **Terrain:** USGS 3DEP, Copernicus DEM, SRTM (slope and aspect matter: fire runs uphill)
- **Moisture/dryness:** Sentinel-2/Landsat NDVI and NDMI; weather from Open-Meteo, ERA5, NOAA
- **Roads, rivers, buildings (natural firebreaks):** OpenStreetMap
- **Map UI for ignition selection:** Leaflet, MapLibre, or Mapbox with satellite tiles

## Physics model options

| Approach | Realism | Compute | Notes |
|---|---|---|---|
| Cellular automaton | Low-medium | Very cheap | Good for MVP and interactivity |
| Rothermel + wavefront/level-set (FARSITE/ELMFIRE style) | Medium-high | Moderate | Proposed best balance; handles wind, slope, fuel type, moisture |
| Coupled fire-atmosphere (WRF-SFIRE, FIRETEC) | Highest | Supercomputer | Not practical in browser |

Proposed: Rothermel spread equations on a grid with level-set or elliptical wavefront, plus:

- Ember spotting
- Crown fire transition
- Fuel moisture classes (1h, 10h, 100h)
- Terrain-modified wind (simple version first)

## Settings

**Simple:** wind speed and direction, dryness (low/med/high/extreme), season, duration.

**Advanced:** temperature, humidity, per-class and live/dead fuel moisture, fuel model overrides, slope/aspect toggle, spotting probability, crown fire threshold, wind variability/gusts, time-varying weather, grid resolution (e.g. 10 m vs 30 m).

Idea: simple presets map to advanced values (e.g. "extreme" = 8% humidity, 4% fuel moisture) and are visible/tweakable.

## Firefighting tools

- **Chop trees / firebreak:** remove fuel in cells. Realism: only effective if wider than flame length, and embers can jump it.
- **Water spray:** temporarily raises fuel moisture, then decays. Most effective ahead of the front.
- **Possible extras:** retardant drops (longer-lasting), backburns, hand crews/trucks with limited range and overrun risk.
- **Game design angle:** resource limits (water, crews, time) for a strategy mode.

## Visualization

- 2D heatmap over satellite imagery (cheapest)
- 3D terrain with fire fronts (Cesium, deck.gl, Three.js)
- Output layers: time-of-arrival contours, flame length, intensity, timeline scrubber

## Performance / architecture

- Browser-only with WebGPU/WebGL compute is feasible for a few million cells
- Server-side compute for large areas or ensembles
- Ensemble runs (e.g. 50 with varied wind) to produce burn-probability maps

## Validation

Pick 2-3 well-documented historical fires, run with actual weather and ignition, compare against final perimeter. This is the basis for any accuracy claim.

## Staged scope

1. **MVP:** map + ignition point + wind/dryness + cellular automaton on fuel data + DEM
2. **v2:** Rothermel physics, spotting, firebreak and water tools
3. **v3:** crown fires, time-varying weather, 3D view, ensemble probability maps, validation against real fires

## Open questions for the team

- Purpose: education/entertainment, serious planning/research, or portfolio?
- Target region (data quality varies a lot by country)?
- Platform: web, desktop, mobile?
- Priority: real-time interactivity vs long-range realism?
- Licensing and data terms for each data source?

## Constraints

- Ask before making any decision that belongs in an ADR; leave those as "Proposed".
- Keep all docs concise and in Markdown.
- Do not install dependencies or generate application code.
