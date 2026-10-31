/**
 * OpenStreetMap land cover -> FuelClass grid. Data from the Overpass API (ODbL). Pure.
 * Google tiles/imagery are never used here or anywhere as a data source (see README).
 */

import { FuelClass } from '../contract';
import type { GridBounds, GridSpec } from '../contract';
import { lonLatToCellFloat } from './geo';
import { rasterizeLine, rasterizePolygon } from './raster';
import type { Pt } from './raster';

export type Tags = Record<string, string>;

export interface TagRule {
  name: string;
  kind: 'area' | 'line';
  /** Higher priority is drawn later and wins. */
  priority: number;
  fuel: (tags: Tags) => FuelClass;
  match: (tags: Tags) => boolean;
  lineWidthCells?: (tags: Tags) => number;
}

const has = (tags: Tags, key: string, ...values: string[]): boolean =>
  key in tags && (values.length === 0 || values.includes(tags[key]));

const forestFuel = (tags: Tags): FuelClass =>
  tags.leaf_type === 'broadleaved' ? FuelClass.FOREST_DECIDUOUS : FuelClass.FOREST_CONIFER;

/** Ordered rules. Edit here to change the mapping (slot `live-data`). */
export const TAG_RULES: TagRule[] = [
  { name: 'grass', kind: 'area', priority: 1, fuel: () => FuelClass.GRASS,
    match: (t) => has(t, 'natural', 'grassland', 'fell') || has(t, 'landuse', 'meadow', 'grass', 'village_green', 'recreation_ground', 'cemetery') },
  { name: 'farmland', kind: 'area', priority: 1, fuel: () => FuelClass.FARMLAND,
    match: (t) => has(t, 'landuse', 'farmland', 'orchard', 'vineyard', 'plant_nursery') },
  { name: 'scrub', kind: 'area', priority: 2, fuel: () => FuelClass.SHRUB,
    match: (t) => has(t, 'natural', 'scrub', 'heath') },
  { name: 'forest', kind: 'area', priority: 3, fuel: forestFuel,
    match: (t) => has(t, 'natural', 'wood') || has(t, 'landuse', 'forest') },
  // Building footprints and hard surfaces are non-burnable. landuse=residential is deliberately NOT
  // matched: in wildland-urban areas those polygons are wooded lots and would wipe out a quarter of
  // a grid (Boulder Creek). They fall through to the default fuel. See DECISIONS.md D13.
  { name: 'built-up', kind: 'area', priority: 4, fuel: () => FuelClass.NONE,
    match: (t) => has(t, 'landuse', 'industrial', 'retail', 'quarry') || has(t, 'building') || has(t, 'amenity', 'parking') || has(t, 'aeroway', 'runway', 'apron') },
  { name: 'water', kind: 'area', priority: 5, fuel: () => FuelClass.NONE,
    match: (t) => has(t, 'natural', 'water', 'bare_rock', 'scree', 'sand', 'glacier') || has(t, 'landuse', 'reservoir', 'basin') || has(t, 'waterway', 'riverbank') },
  // Only roads and waterways wide enough to plausibly stop a 30 m cell's spread are barriers.
  // Residential streets and small streams are not (they are a few metres wide). D13.
  { name: 'road', kind: 'line', priority: 6, fuel: () => FuelClass.NONE,
    match: (t) => has(t, 'highway', 'motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'motorway_link', 'trunk_link', 'primary_link'),
    lineWidthCells: (t) => (['motorway', 'trunk'].includes(t.highway) ? 2 : 1) },
  { name: 'waterway', kind: 'line', priority: 6, fuel: () => FuelClass.NONE,
    match: (t) => has(t, 'waterway', 'river', 'canal'),
    lineWidthCells: (t) => (t.waterway === 'river' ? 2 : 1) },
  { name: 'rail', kind: 'line', priority: 6, fuel: () => FuelClass.NONE,
    match: (t) => has(t, 'railway', 'rail') },
];

export function classify(tags: Tags | undefined): TagRule | null {
  if (!tags) return null;
  let best: TagRule | null = null;
  for (const rule of TAG_RULES) if (rule.match(tags) && (!best || rule.priority > best.priority)) best = rule;
  return best;
}

/** Overpass QL for everything the rules need, with inline geometry (no node resolution needed). */
export function overpassQuery(bounds: GridBounds, timeoutS = 60): string {
  const bbox = `${bounds.south},${bounds.west},${bounds.north},${bounds.east}`;
  const keys = ['landuse', 'natural', 'highway', 'waterway', 'building', 'railway'];
  const ways = keys.map((k) => `way["${k}"](${bbox});`).join('');
  const rels = ['landuse', 'natural'].map((k) => `relation["${k}"](${bbox});`).join('');
  return `[out:json][timeout:${timeoutS}];(${ways}${rels});out geom;`;
}

export interface OsmGeomPoint {
  lat: number;
  lon: number;
}
export interface OsmMember {
  type: string;
  role?: string;
  geometry?: OsmGeomPoint[];
}
export interface OsmElement {
  type: 'node' | 'way' | 'relation';
  id: number;
  tags?: Tags;
  geometry?: OsmGeomPoint[];
  members?: OsmMember[];
}

export interface BuildFuelOptions {
  /** Fuel for land with no mapped polygon. Default GRASS (see DECISIONS.md D10). */
  defaultFuel?: FuelClass;
  /**
   * Starting fuel grid (e.g. from satellite land cover) instead of one flat default. OSM features are
   * drawn on top of it.
   */
  baseFuel?: Uint8Array;
  /**
   * Draw OSM vegetation polygons (forest, scrub, grass, farmland)? Default true. Set false with a
   * `baseFuel` to keep the satellite vegetation and use OSM only for what it maps well: water,
   * buildings, roads, rivers and rails (all non-burnable).
   */
  vegetationFromOsm?: boolean;
}

interface Feature {
  rule: TagRule;
  rings: Pt[][];
  tags: Tags;
}

/** Rasterises OSM elements onto the grid. Returns the fuel grid and per-rule cell counts. */
export function buildFuelGrid(
  elements: OsmElement[],
  grid: GridSpec,
  opts: BuildFuelOptions = {},
): { fuel: Uint8Array; stats: Record<string, number> } {
  const cells = grid.width * grid.height;
  if (opts.baseFuel && opts.baseFuel.length !== cells) throw new Error(`baseFuel has ${opts.baseFuel.length} cells but the grid has ${cells}`);
  const fuel = opts.baseFuel ? Uint8Array.from(opts.baseFuel) : new Uint8Array(cells).fill(opts.defaultFuel ?? FuelClass.GRASS);
  const vegetationFromOsm = opts.vegetationFromOsm ?? true;
  const toCell = (pts: OsmGeomPoint[]): Pt[] =>
    pts.map((p) => {
      const { x, y } = lonLatToCellFloat(grid, p.lon, p.lat);
      return [x, y] as const;
    });
  const features: Feature[] = [];
  const stats: Record<string, number> = { skippedUnclosed: 0 };

  for (const el of elements) {
    const rule = classify(el.tags);
    if (!rule || !el.tags) continue;
    // Vegetation polygons are burnable fuel; with satellite vegetation they are skipped.
    if (!vegetationFromOsm && rule.kind === 'area' && rule.fuel(el.tags) !== FuelClass.NONE) continue;
    if (el.type === 'way' && el.geometry && el.geometry.length >= 2) {
      const pts = toCell(el.geometry);
      const closed = isClosed(el.geometry);
      if (rule.kind === 'line') features.push({ rule, rings: [pts], tags: el.tags });
      else if (closed) features.push({ rule, rings: [pts], tags: el.tags });
      else stats.skippedUnclosed++;
    } else if (el.type === 'relation' && el.members && rule.kind === 'area') {
      const rings: Pt[][] = [];
      for (const m of el.members) {
        if (m.type !== 'way' || !m.geometry || m.geometry.length < 4) continue;
        if (isClosed(m.geometry)) rings.push(toCell(m.geometry));
        else stats.skippedUnclosed++;
      }
      if (rings.length > 0) features.push({ rule, rings, tags: el.tags });
    }
  }

  features.sort((a, b) => a.rule.priority - b.rule.priority);
  for (const f of features) {
    const value = f.rule.fuel(f.tags);
    const count =
      f.rule.kind === 'line'
        ? rasterizeLine(fuel, grid.width, grid.height, f.rings[0], value, f.rule.lineWidthCells?.(f.tags) ?? 1)
        : rasterizePolygon(fuel, grid.width, grid.height, f.rings, value);
    stats[f.rule.name] = (stats[f.rule.name] ?? 0) + count;
  }
  return { fuel, stats };
}

function isClosed(g: OsmGeomPoint[]): boolean {
  const a = g[0];
  const b = g[g.length - 1];
  return g.length >= 4 && a.lat === b.lat && a.lon === b.lon;
}
