/**
 * Satellite land cover -> fuel classes, for areas where OpenStreetMap vegetation is patchy.
 *
 *   ESA WorldCover (10 m, global, CC BY 4.0), classes 10-100
 *   CORINE Land Cover (100 m, Europe), 3-digit codes
 *
 * The mappings are PLACEHOLDERS in the same spirit as the fuel table (src/contract/fuels.ts): coarse,
 * deliberately simple, not validated against fuel models. WorldCover does not distinguish
 * coniferous from broadleaved trees, so tree cover maps to `treeFuel` (conifer by default, the more
 * flammable choice). Pure and Node-safe; reading the rasters from disk or the network is in scripts/.
 */

import { FuelClass } from '../contract';
import type { GridSpec } from '../contract';

export type LandcoverKind = 'worldcover' | 'corine';

export interface LandcoverClass {
  name: string;
  /** Fuel class; 'tree' means "use the treeFuel option". */
  fuel: FuelClass | 'tree';
}

const N = FuelClass.NONE;
const G = FuelClass.GRASS;
const S = FuelClass.SHRUB;
const F = FuelClass.FARMLAND;
const D = FuelClass.FOREST_DECIDUOUS;
const C = FuelClass.FOREST_CONIFER;

/** ESA WorldCover v100/v200 legend. 0 is "no data". */
export const WORLDCOVER_CLASSES: Record<number, LandcoverClass> = {
  10: { name: 'Tree cover', fuel: 'tree' },
  20: { name: 'Shrubland', fuel: S },
  30: { name: 'Grassland', fuel: G },
  40: { name: 'Cropland', fuel: F },
  50: { name: 'Built-up', fuel: N },
  60: { name: 'Bare / sparse vegetation', fuel: N },
  70: { name: 'Snow and ice', fuel: N },
  80: { name: 'Permanent water bodies', fuel: N },
  90: { name: 'Herbaceous wetland', fuel: N },
  95: { name: 'Mangroves', fuel: N },
  100: { name: 'Moss and lichen', fuel: N },
};

/** CORINE Land Cover (CLC) nomenclature. */
export const CORINE_CLASSES: Record<number, LandcoverClass> = {
  111: { name: 'Continuous urban fabric', fuel: N },
  112: { name: 'Discontinuous urban fabric', fuel: N },
  121: { name: 'Industrial or commercial units', fuel: N },
  122: { name: 'Road and rail networks', fuel: N },
  123: { name: 'Port areas', fuel: N },
  124: { name: 'Airports', fuel: N },
  131: { name: 'Mineral extraction sites', fuel: N },
  132: { name: 'Dump sites', fuel: N },
  133: { name: 'Construction sites', fuel: N },
  141: { name: 'Green urban areas', fuel: G },
  142: { name: 'Sport and leisure facilities', fuel: G },
  211: { name: 'Non-irrigated arable land', fuel: F },
  212: { name: 'Permanently irrigated land', fuel: N },
  213: { name: 'Rice fields', fuel: N },
  221: { name: 'Vineyards', fuel: F },
  222: { name: 'Fruit trees and berry plantations', fuel: F },
  223: { name: 'Olive groves', fuel: F },
  231: { name: 'Pastures', fuel: G },
  241: { name: 'Annual crops with permanent crops', fuel: F },
  242: { name: 'Complex cultivation patterns', fuel: F },
  243: { name: 'Agriculture with significant natural vegetation', fuel: G },
  244: { name: 'Agro-forestry areas', fuel: D },
  311: { name: 'Broad-leaved forest', fuel: D },
  312: { name: 'Coniferous forest', fuel: C },
  313: { name: 'Mixed forest', fuel: C },
  321: { name: 'Natural grasslands', fuel: G },
  322: { name: 'Moors and heathland', fuel: S },
  323: { name: 'Sclerophyllous vegetation', fuel: S },
  324: { name: 'Transitional woodland-shrub', fuel: S },
  331: { name: 'Beaches, dunes, sands', fuel: N },
  332: { name: 'Bare rocks', fuel: N },
  333: { name: 'Sparsely vegetated areas', fuel: G },
  334: { name: 'Burnt areas', fuel: N },
  335: { name: 'Glaciers and perpetual snow', fuel: N },
  411: { name: 'Inland marshes', fuel: N },
  412: { name: 'Peat bogs', fuel: G },
  421: { name: 'Salt marshes', fuel: N },
  422: { name: 'Salines', fuel: N },
  423: { name: 'Intertidal flats', fuel: N },
  511: { name: 'Water courses', fuel: N },
  512: { name: 'Water bodies', fuel: N },
  521: { name: 'Coastal lagoons', fuel: N },
  522: { name: 'Estuaries', fuel: N },
  523: { name: 'Sea and ocean', fuel: N },
};

export function landcoverClasses(kind: LandcoverKind): Record<number, LandcoverClass> {
  return kind === 'worldcover' ? WORLDCOVER_CLASSES : CORINE_CLASSES;
}

export interface LandcoverOptions {
  /** Fuel for WorldCover "Tree cover". Default conifer (more flammable). Ignored by CORINE, which names the forest type. */
  treeFuel?: FuelClass;
  /** Fuel for no-data pixels and codes that are not in the legend. Default non-burnable. */
  unknownFuel?: FuelClass;
}

/** Fuel class for one land-cover code. Unknown codes (and 0 = no data) give `unknownFuel`. */
export function fuelForLandcover(kind: LandcoverKind, code: number, o: LandcoverOptions = {}): FuelClass {
  const cls = landcoverClasses(kind)[code];
  if (!cls) return o.unknownFuel ?? FuelClass.NONE;
  return cls.fuel === 'tree' ? (o.treeFuel ?? FuelClass.FOREST_CONIFER) : cls.fuel;
}

/** A categorical raster in geographic coordinates (EPSG:4326), north-up: row 0 is the northern edge. */
export interface SourceRaster {
  data: ArrayLike<number>;
  width: number;
  height: number;
  /** Longitude of the western edge and latitude of the northern edge of pixel (0, 0). */
  west: number;
  north: number;
  /** Pixel size in degrees (both positive). */
  pxLon: number;
  pxLat: number;
}

export interface ResampleResult {
  /** Land-cover class per grid cell (majority of the source pixels inside it), 0 where no data. */
  classes: Uint16Array;
  /** Grid cells that had no source pixel at all (the raster did not cover them). */
  uncovered: number;
}

/**
 * Majority vote of the source pixels whose centres fall inside each grid cell. Ties go to the lower
 * class code so the result is deterministic. Pixels equal to `nodata` are ignored; a cell with no
 * valid pixel gets 0.
 */
export function resampleCategorical(src: SourceRaster, grid: GridSpec, nodata = 0): ResampleResult {
  const classes = new Uint16Array(grid.width * grid.height);
  const b = grid.bounds;
  const cellLon = (b.east - b.west) / grid.width;
  const cellLat = (b.north - b.south) / grid.height;
  const counts = new Map<number, number>();
  let uncovered = 0;
  for (let r = 0; r < grid.height; r++) {
    const lat1 = b.north - r * cellLat;
    const lat0 = lat1 - cellLat;
    // Pixel rows whose centre lies in [lat0, lat1): centre of row y is north - (y + 0.5) * pxLat.
    const y0 = Math.max(0, Math.ceil((src.north - lat1) / src.pxLat - 0.5));
    const y1 = Math.min(src.height - 1, Math.ceil((src.north - lat0) / src.pxLat - 0.5) - 1);
    for (let c = 0; c < grid.width; c++) {
      const lon0 = b.west + c * cellLon;
      const lon1 = lon0 + cellLon;
      const x0 = Math.max(0, Math.ceil((lon0 - src.west) / src.pxLon - 0.5));
      const x1 = Math.min(src.width - 1, Math.ceil((lon1 - src.west) / src.pxLon - 0.5) - 1);
      counts.clear();
      let any = false;
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          any = true;
          const v = src.data[y * src.width + x];
          if (v === nodata || Number.isNaN(v)) continue;
          counts.set(v, (counts.get(v) ?? 0) + 1);
        }
      }
      if (!any) uncovered++;
      let best = 0;
      let bestN = 0;
      for (const [v, n] of counts) if (n > bestN || (n === bestN && v < best)) { best = v; bestN = n; }
      classes[r * grid.width + c] = best;
    }
  }
  return { classes, uncovered };
}

export interface LandcoverFuelResult {
  fuel: Uint8Array;
  /** Cells per land-cover code that is not in the legend (including 0 = no data). */
  unknown: Map<number, number>;
  /** Cells per fuel class. */
  fuelCounts: Record<number, number>;
}

/** Land-cover class grid -> FuelClass grid. */
export function landcoverToFuel(classes: ArrayLike<number>, kind: LandcoverKind, o: LandcoverOptions = {}): LandcoverFuelResult {
  const fuel = new Uint8Array(classes.length);
  const unknown = new Map<number, number>();
  const fuelCounts: Record<number, number> = {};
  const table = landcoverClasses(kind);
  for (let i = 0; i < classes.length; i++) {
    const code = classes[i];
    if (!(code in table)) unknown.set(code, (unknown.get(code) ?? 0) + 1);
    const f = fuelForLandcover(kind, code, o);
    fuel[i] = f;
    fuelCounts[f] = (fuelCounts[f] ?? 0) + 1;
  }
  return { fuel, unknown, fuelCounts };
}

/** ESA WorldCover v200 (2021) tile file name for the 3 x 3 degree tile containing a point. */
export function worldCoverTileName(lon: number, lat: number): { name: string; swLon: number; swLat: number } {
  const swLon = Math.floor(lon / 3) * 3;
  const swLat = Math.floor(lat / 3) * 3;
  const ns = swLat >= 0 ? 'N' : 'S';
  const ew = swLon >= 0 ? 'E' : 'W';
  const name = `ESA_WorldCover_10m_2021_v200_${ns}${String(Math.abs(swLat)).padStart(2, '0')}${ew}${String(Math.abs(swLon)).padStart(3, '0')}_Map.tif`;
  return { name, swLon, swLat };
}

export const WORLDCOVER_BASE_URL = 'https://esa-worldcover.s3.eu-central-1.amazonaws.com/v200/2021/map/';
export const WORLDCOVER_ATTRIBUTION = '© ESA WorldCover project 2021 / Contains modified Copernicus Sentinel data (2021) processed by the ESA WorldCover consortium (CC BY 4.0)';
