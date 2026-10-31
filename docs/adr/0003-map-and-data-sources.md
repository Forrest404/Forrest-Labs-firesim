# 0003. Map renderer and data sources

- **Status:** Proposed
- **Date:** TBD
- **Deciders:** TBD

## Context

The user picks an ignition point on a map, and the simulation needs terrain, fuel, canopy, moisture and weather data. Google Maps does not provide tree-level data, and its terms likely prohibit extracting or processing its data this way, so it should not be a data source.

## Options

### Map renderer (ignition selection)
- Leaflet
- MapLibre
- Mapbox with satellite tiles

Basemap imagery licensing must be checked for each.

### Data sources
- **Fuel/vegetation:** LANDFIRE (US), CORINE (Europe), ESA WorldCover (global)
- **Canopy height/density:** Meta/WRI global canopy height, GEDI lidar, national lidar
- **Terrain:** USGS 3DEP, Copernicus DEM, SRTM
- **Moisture/dryness:** Sentinel-2/Landsat NDVI and NDMI
- **Weather:** Open-Meteo, ERA5, NOAA
- **Roads, rivers, buildings:** OpenStreetMap

## Decision

_None yet._ Target region (data quality varies by country) and per-source license review are prerequisites.

## Consequences

_To be filled in once decided._
