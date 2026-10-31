# Data: demo areas and sources

What data we have, where it comes from, and what is checked. Last updated 2026-10-31.

## Demo areas

Each box is 6 km x 6 km (200 x 200 cells at 30 m). Boxes are written **S, W, N, E** (min lat, min lon, max lat, max lon).
Terrain range comes from the Open-Meteo elevation API (7 x 7 sample points per box).

| Key | Area | Box (S, W, N, E) | Centre | Elevation | What's in it |
|---|---|---|---|---|---|
| `mill-valley` | Mill Valley / Mt Tamalpais, CA | 37.8781, -122.5942, 37.9319, -122.5258 | 37.905, -122.560 | 1–731 m (730 m relief) | Redwood forest and chaparral right against homes; Hwy 1 and Panoramic Hwy; bay water to the east |
| `truckee` | Truckee, Sierra Nevada, CA | 39.2931, -120.2348, 39.3469, -120.1652 | 39.320, -120.200 | 1,766–2,095 m (330 m relief) | Sierra conifer forest, Truckee River, I-80, edge of town |
| `boulder-creek` (backup) | Boulder Creek, Santa Cruz Mtns, CA | 37.0991, -122.1558, 37.1529, -122.0882 | 37.126, -122.122 | 139–798 m (660 m relief) | Redwoods, San Lorenzo River, Hwy 9. Near the 2020 CZU fire area, so check plan.md's "no recent harmful fire" rule before using |

### Checks per area

| Check | mill-valley | truckee | boulder-creek |
|---|---|---|---|
| 6 km box computed | Done | Done | Done |
| Terrain relief over 100 m | Done (730 m) | Done (330 m) | Done (660 m) |
| Google 3D tiles look good | [Open 3D view](https://www.google.com/maps/@37.905,-122.56,3500a,35y,0h,65t/data=!3m1!1e3), to check by eye | [Open 3D view](https://www.google.com/maps/@39.32,-120.2,3500a,35y,0h,65t/data=!3m1!1e3), to check by eye | [Open 3D view](https://www.google.com/maps/@37.126,-122.122,3500a,35y,0h,65t/data=!3m1!1e3), to check by eye |
| OSM has forest, water, roads | [Run in overpass-turbo](https://overpass-turbo.eu/?Q=%5Bout%3Ajson%5D%5Btimeout%3A60%5D%3B%28nwr%5B%22landuse%22%3D%22forest%22%5D%2837.8781%2C-122.5942%2C37.9319%2C-122.5258%29%3Bnwr%5B%22natural%22~%22wood%7Cwater%7Cscrub%22%5D%2837.8781%2C-122.5942%2C37.9319%2C-122.5258%29%3Bway%5B%22waterway%22~%22river%7Cstream%22%5D%2837.8781%2C-122.5942%2C37.9319%2C-122.5258%29%3Bway%5B%22highway%22~%22motorway%7Ctrunk%7Cprimary%7Csecondary%7Ctertiary%22%5D%2837.8781%2C-122.5942%2C37.9319%2C-122.5258%29%3B%29%3Bout%20geom%3B&R), to check by eye | [Run in overpass-turbo](https://overpass-turbo.eu/?Q=%5Bout%3Ajson%5D%5Btimeout%3A60%5D%3B%28nwr%5B%22landuse%22%3D%22forest%22%5D%2839.2931%2C-120.2348%2C39.3469%2C-120.1652%29%3Bnwr%5B%22natural%22~%22wood%7Cwater%7Cscrub%22%5D%2839.2931%2C-120.2348%2C39.3469%2C-120.1652%29%3Bway%5B%22waterway%22~%22river%7Cstream%22%5D%2839.2931%2C-120.2348%2C39.3469%2C-120.1652%29%3Bway%5B%22highway%22~%22motorway%7Ctrunk%7Cprimary%7Csecondary%7Ctertiary%22%5D%2839.2931%2C-120.2348%2C39.3469%2C-120.1652%29%3B%29%3Bout%20geom%3B&R), to check by eye | [Run in overpass-turbo](https://overpass-turbo.eu/?Q=%5Bout%3Ajson%5D%5Btimeout%3A60%5D%3B%28nwr%5B%22landuse%22%3D%22forest%22%5D%2837.0991%2C-122.1558%2C37.1529%2C-122.0882%29%3Bnwr%5B%22natural%22~%22wood%7Cwater%7Cscrub%22%5D%2837.0991%2C-122.1558%2C37.1529%2C-122.0882%29%3Bway%5B%22waterway%22~%22river%7Cstream%22%5D%2837.0991%2C-122.1558%2C37.1529%2C-122.0882%29%3Bway%5B%22highway%22~%22motorway%7Ctrunk%7Cprimary%7Csecondary%7Ctertiary%22%5D%2837.0991%2C-122.1558%2C37.1529%2C-122.0882%29%3B%29%3Bout%20geom%3B&R), to check by eye |
| OSM result (overpass-turbo, 2026-10-31) | 8 wood polygons = **24% of box forest** (rest defaults to grass, D10); 1 river, 403 streams, 9 water polygons (the bay is coastline, not counted); 164 major roads | 524 forest polygons = **40% forest**, 1% scrub, **5% water** (lakes); Truckee River; 280 major roads | 55 forest polygons = **54% forest**; San Lorenzo River, 420 streams; 59 major roads |
| Verdict | OK. Weakest OSM forest, but the best 3D and story near SF | **Best all-round** | Best forest data; check fire-history rule |
| Bundle built (`build:demo-area`) | Not yet | Not yet | Not yet |

Streams are not barriers in the plan's fuel table (only `waterway=river/canal`), so the high stream counts don't wall off the fire.
Coverage is the share of a 60 x 60 sample grid inside forest/scrub/water polygons.

## Real-fire comparison: Crozier Fire (El Dorado County, CA, Aug 2024)

Run our sim from the real start point with the real weather, then overlay the real final burn area and report the overlap.
Chosen because it fits a 6 km box, sits in Sierra foothill forest, had steady weather, and CAL FIRE reported **0 structures destroyed and 0 deaths** ([CAL FIRE incident updates](https://www.fire.ca.gov/incidents/2024/8/6/crozier-fire/updates/6fdcdb0d-48ce-49a7-ab74-0bd69263a3ba)), so it doesn't break plan.md's rule.

| Field | Value | Source |
|---|---|---|
| Start | 2024-08-06, northwest side of Slate Mountain, near Mosquito. NIFC logs discovery as 2024-08-07 05:57 UTC (Aug 6, 22:57 PDT); CAL FIRE updates give Aug 6 early morning. Times conflict, so check before quoting | NIFC WFIGS, CAL FIRE |
| Ignition point | 38.828893, -120.697385 | NIFC `attr_InitialLatitude/Longitude` |
| Final area | 1,917 acres (7.8 km²) in NIFC; CAL FIRE final update says 1,960 acres | NIFC `poly_GISAcres`, CAL FIRE |
| Perimeter extent | ~3.5 km x 3.9 km | computed from the GeoJSON |
| Early growth | 182 acres and 5% contained by 11:30 a.m. on day one: a timing check for the sim | CAL FIRE |
| Containment | 100% by 2024-09-11 | CAL FIRE |
| **6 km box (S, W, N, E)** | **38.8116, -120.7245, 38.8655, -120.6554**, centred on the perimeter | computed |

**Weather, Open-Meteo archive at the ignition point (local time).** The same pattern held every day:

| Time | Temp | Humidity | Wind | Gusts | From |
|---|---|---|---|---|---|
| Afternoon (12:00–18:00) | 33–35 °C | 9–11 % | 9–13 km/h | 30–40 km/h | SW (225–250°) |
| Night (21:00–06:00) | 20–27 °C | 14–25 % | 4–13 km/h | 7–28 km/h | ENE (70–100°) |

So the sim inputs are: **dryness extreme, wind ~13 km/h from 225–230°** (pushes fire NE, upslope by day).

**OSM check (overpass-turbo, 2026-10-31): weak.** Only 4 forest polygons, covering 15% of the box. 1% scrub, 23 streams, no rivers, no major roads. With OSM the rest defaults to grass, which would distort the comparison. **Use LANDFIRE `LF2023_FBFM40` (pre-fire) for this area**, since the fuel map decides the result.

**Downloads:**

```bash
# Real final burn area (one MultiPolygon, ~40 KB), tested
curl -s "https://services3.arcgis.com/T4QMspbfLg3qTGWY/arcgis/rest/services/WFIGS_Interagency_Perimeters/FeatureServer/0/query?where=poly_IncidentName%3D%27CROZIER%27+AND+attr_POOState%3D%27US-CA%27&outFields=poly_IncidentName,poly_GISAcres&returnGeometry=true&outSR=4326&f=geojson" -o crozier_perimeter.geojson

# Fuel + terrain before the fire (LF2023 = pre-2024 fuels). Replace YOUR_EMAIL
curl -s "https://lfps.usgs.gov/api/job/submit?Email=YOUR_EMAIL&Layer_List=LF2023_FBFM40;LF2020_Elev;LF2020_SlpD;LF2020_Asp&Area_of_Interest=-120.7245%2038.8116%20-120.6554%2038.8655&Output_Projection=4326"

# Hourly weather for the first days
curl -s "https://archive-api.open-meteo.com/v1/archive?latitude=38.829&longitude=-120.697&start_date=2024-08-06&end_date=2024-08-08&hourly=temperature_2m,relative_humidity_2m,wind_speed_10m,wind_direction_10m,wind_gusts_10m&timezone=America%2FLos_Angeles"
```

**How to compare (what we can honestly claim):**

1. Ignite at the real point with the weather above. Run until the burned area is about 7.8 km² (the real size).
2. Overlay the real perimeter as an outline in the 3D view.
3. Report **overlap (IoU)** = cells burned in both / cells burned in either, plus the share of the real burn area the sim reached.
4. On stage: "Our simulation matched X% of the real Crozier Fire." Say the limits: the real fire burned for days with firefighters on it; our run has fixed weather and no suppression.

Backup fire if Crozier doesn't work out: **Lucas Fire**, Lake County, Sep 2026, 3,922 acres (~5.8 x 5.2 km), ignition 39.231856, -123.002756, box 39.1983, -123.0053, 39.2522, -122.9357. Its afternoons were ~32 °C, 17 % humidity, wind from the west. Impact not yet checked.

## Data sources

| Data | Source | Access | Status (tested 2026-10-31) | License |
|---|---|---|---|---|
| Land cover, roads, rivers | OpenStreetMap via Overpass | No key | **Blocked for scripts.** Every public server either timed out or replied that it's for browser-based, human-operated use only. Works in overpass-turbo in a browser | ODbL, attribution + share-alike |
| Fuel types (alternative to OSM) | LANDFIRE `LF2024_FBFM40` (40 Scott & Burgan fuel models, 30 m) | LFPS API, email required, async job of 5–15 min | Endpoints and layer names confirmed; full job not run yet | US public domain |
| Elevation, slope, aspect | AWS Terrain Tiles (Terrarium), as used by the scaffold | No key | Reachable (per scaffold PROGRESS.md) | See provider attribution |
| Elevation (alternative) | LANDFIRE `LF2020_Elev`, `LF2020_SlpD`, `LF2020_Asp` | Same LFPS job as fuel | Layer names confirmed | US public domain |
| Elevation spot checks | Open-Meteo elevation API | No key | Working, used for the relief numbers above | CC BY 4.0 |
| Weather, live and historical | Open-Meteo forecast and archive APIs | No key | Working | CC BY 4.0 |
| Real fire perimeters | NIFC WFIGS Interagency Perimeters | No key | Working | US public domain |
| Satellite hotspots | NASA FIRMS area API | Free MAP_KEY | Not tested | NASA open data |

## Ready-to-run commands

**LANDFIRE fuel and terrain for one box.** Replace `YOUR_EMAIL`, and swap in the box as `W S E N`, space-separated. This example is `mill-valley`:

```bash
curl -s "https://lfps.usgs.gov/api/job/submit?Email=YOUR_EMAIL&Layer_List=LF2024_FBFM40;LF2020_Elev;LF2020_SlpD;LF2020_Asp&Area_of_Interest=-122.5942%2037.8781%20-122.5258%2037.9319&Output_Projection=4326"
```

Then poll until the status is `Succeeded` and download the ZIP from the URL in the reply:

```bash
curl -s "https://lfps.usgs.gov/api/job/status?JobId=JOB_ID"
```

**Weather for an area today:**

```bash
curl -s "https://api.open-meteo.com/v1/forecast?latitude=37.905&longitude=-122.56&current=temperature_2m,relative_humidity_2m,wind_speed_10m,wind_direction_10m,wind_gusts_10m"
```

## Open issues

1. **`build:demo-area` relies on Overpass, which blocks scripts.** Options: run the fetch from the browser (allowed), or build fuel from LANDFIRE instead. The team needs to pick one.
2. LANDFIRE codes towns as `91` (urban, non-burnable), so a LANDFIRE-based sim stops at the edge of town unless houses are treated as ember-ignitable.
3. Google 3D tiles are display only. No simulation input is taken from them (DECISIONS.md D9).
