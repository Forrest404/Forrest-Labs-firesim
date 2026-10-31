/**
 * LANDFIRE fuel (Scott & Burgan 40 fire behavior fuel models, FBFM40) -> the app's fuel classes.
 * LANDFIRE is the official US fuel map (USGS/USDA, public domain), 30 m cells like our grid.
 * The app has 6 classes (frozen contract), so the 40 models collapse by fuel family:
 *
 *   91-99   NB  urban, snow, agriculture, water, barren  -> NONE
 *   101-109 GR  grass                                    -> GRASS
 *   121-124 GS  grass-shrub                              -> SHRUB
 *   141-149 SH  shrub                                    -> SHRUB
 *   161-165 TU  timber-understory                        -> FOREST_CONIFER
 *   181-189 TL  timber litter (TL6, TL9 broadleaf)       -> FOREST_CONIFER (FOREST_DECIDUOUS)
 *   201-204 SB  slash-blowdown                           -> FOREST_CONIFER
 */

import { FuelClass } from '../contract';

const BROADLEAF_LITTER = new Set([186, 189]);

export function fbfm40ToFuelClass(code: number): FuelClass {
  if (code >= 101 && code <= 109) return FuelClass.GRASS;
  if (code >= 121 && code <= 149) return FuelClass.SHRUB;
  if (BROADLEAF_LITTER.has(code)) return FuelClass.FOREST_DECIDUOUS;
  if ((code >= 161 && code <= 189) || (code >= 201 && code <= 204)) return FuelClass.FOREST_CONIFER;
  return FuelClass.NONE;
}

/**
 * ArcGIS ImageServer export of a LANDFIRE layer as raw 8-bit codes on a lon/lat grid, one pixel per
 * cell (FBFM40 codes are 91-204, so U8 holds them). No key or account needed.
 */
export function landfireExportUrl(layer: string, b: { west: number; south: number; east: number; north: number }, width: number, height: number): string {
  const params = new URLSearchParams({
    bbox: [b.west, b.south, b.east, b.north].join(','),
    bboxSR: '4326',
    imageSR: '4326',
    size: `${width},${height}`,
    format: 'png',
    pixelType: 'U8',
    interpolation: 'RSP_NearestNeighbor',
    renderingRule: JSON.stringify({ rasterFunction: 'None' }),
    f: 'image',
  });
  const folder = layer.split('_')[0];
  return `https://lfps.usgs.gov/arcgis/rest/services/Landfire_${folder}/${layer}_CONUS/ImageServer/exportImage?${params}`;
}
