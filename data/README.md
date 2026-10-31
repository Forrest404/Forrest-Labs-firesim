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
| ESA WorldCover 2021 (v200), 10 m global | Vegetation (forest, shrub, grass, crops) and built-up / water, where OSM vegetation is patchy (Boulder Creek) | `npm run build:demo-area -- … --landcover worldcover --osm barriers`; read straight from `esa-worldcover.s3.eu-central-1.amazonaws.com` (Cloud-Optimized GeoTIFF, only the needed window is downloaded) | v200 / 2021 | CC BY 4.0. Attribution: "© ESA WorldCover project 2021 / Contains modified Copernicus Sentinel data (2021) processed by the ESA WorldCover consortium" |
| AWS Terrain Tiles (Mapzen Terrarium encoding) | Elevation, slope, aspect | same script, `s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png` | tiles as served | Open data; attribute the underlying sources listed at https://registry.opendata.aws/terrain-tiles/ |

**Display-only sources (never a data source):** Google Photorealistic 3D Tiles, OpenStreetMap raster basemap tiles. Nothing is extracted from them.

## Land-cover options of `build:demo-area`

| Flag | Meaning |
|---|---|
| `--landcover worldcover` | ESA WorldCover 2021 fetched from AWS (3 x 3 degree tiles, stitched) |
| `--landcover-file f.tif` or `.asc` | a local raster in EPSG:4326 (GeoTIFF or ESRI ASCII grid) |
| `--landcover-kind worldcover\|corine` | legend of the raster given with `--landcover-file` (default worldcover) |
| `--tree-fuel FOREST_CONIFER\|FOREST_DECIDUOUS` | fuel for WorldCover "Tree cover" (it does not distinguish forest types; default conifer) |
| `--osm full\|barriers\|none` | `full` (default without land cover): OSM vegetation, buildings, water, roads. `barriers` (default with land cover): satellite vegetation, OSM water, buildings, roads, rivers, rail. `none`: no Overpass call, for when Overpass is down |

**CORINE** is downloaded from the Copernicus Land Monitoring Service (a free account is required, so it is
not fetched automatically) and is in EPSG:3035: reproject it first, `gdalwarp -t_srs EPSG:4326 clc.tif clc4326.tif`,
then `--landcover-file clc4326.tif --landcover-kind corine`. Licence: Copernicus free, full and open data; attribute
"© European Union, Copernicus Land Monitoring Service, European Environment Agency (EEA)".
