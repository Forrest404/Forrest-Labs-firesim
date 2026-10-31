# data

Contents of this folder are gitignored (except this file). **Never commit large data files.**

Download datasets locally into `data/` and document how to obtain each one below (source, URL, version, license, any processing steps).
Check each source's license and terms before using it (see [CONTRIBUTING.md](../CONTRIBUTING.md)).

Candidate sources (not yet decided, see [ADR 0003](../docs/adr/0003-map-and-data-sources.md)):

- Fuel/vegetation: LANDFIRE, CORINE, ESA WorldCover
- Canopy: Meta/WRI global canopy height, GEDI, national lidar
- Terrain: USGS 3DEP, Copernicus DEM, SRTM
- Moisture/weather: Sentinel-2/Landsat (NDVI, NDMI), Open-Meteo, ERA5, NOAA
- Roads, rivers, buildings: OpenStreetMap

## Datasets in use

Demo-area bundles live in `public/demo-areas/` (small JSON, committed), not here.

| Dataset | Used for | How obtained | Version | License / attribution |
|---|---|---|---|---|
| Synthetic areas (`synthetic-valley`, `synthetic-ridge`) | Fallback demo areas in v0 | `npm run make:synthetic` (seeded noise, `src/data/synthetic.ts`) | repo commit | Same as the repository. **Labelled synthetic in the UI; never presented as real.** |
| OpenStreetMap via Overpass API | Land cover -> fuel classes; roads, rivers, buildings as non-burnable | `npm run build:demo-area -- --name <n> --label <l> --center lon,lat` | snapshot date in bundle `createdAt` | ODbL. Attribution "© OpenStreetMap contributors". Derived grids committed under ODbL share-alike. |
| AWS Terrain Tiles (Mapzen Terrarium encoding) | Elevation, slope, aspect | same script, `s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png` | tiles as served | Open data; attribute the underlying sources listed at https://registry.opendata.aws/terrain-tiles/ |

**Display-only sources (never a data source):** Google Photorealistic 3D Tiles, OpenStreetMap raster basemap tiles. Nothing is extracted from them.
