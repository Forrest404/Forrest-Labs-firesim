/**
 * Writes the two synthetic fallback demo areas and index.json to public/demo-areas/.
 * Usage: npm run make:synthetic
 */
import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { encodeBundle, indexEntryFor } from '../src/data/bundle';
import type { DemoAreaIndex } from '../src/data/bundle';
import { makeSyntheticArea } from '../src/data/synthetic';

const outDir = join(process.cwd(), 'public', 'demo-areas');
mkdirSync(outDir, { recursive: true });

const areas = [
  makeSyntheticArea({ name: 'synthetic-valley', label: 'River Valley', centerLon: -122.122, centerLat: 37.126, seed: 101, style: 'valley' }),
  makeSyntheticArea({ name: 'synthetic-ridge', label: 'Forest Ridge', centerLon: 8.4, centerLat: 48.345, seed: 202, style: 'ridge' }),
];

const indexPath = join(outDir, 'index.json');
const index: DemoAreaIndex = existsSync(indexPath)
  ? (JSON.parse(readFileSync(indexPath, 'utf8')) as DemoAreaIndex)
  : { version: 1, areas: [] };

for (const area of areas) {
  const bundle = encodeBundle(area);
  const file = join(outDir, `${area.meta.name}.json`);
  writeFileSync(file, JSON.stringify(bundle));
  const entry = indexEntryFor(area);
  index.areas = index.areas.filter((a) => a.name !== entry.name);
  index.areas.push(entry);
  const counts = new Map<number, number>();
  for (const f of area.fuel) counts.set(f, (counts.get(f) ?? 0) + 1);
  console.log(`wrote ${file} (${(JSON.stringify(bundle).length / 1024).toFixed(0)} KB) fuel counts`, Object.fromEntries(counts));
}
// Synthetic areas list after real ones.
index.areas.sort((a, b) => Number(a.synthetic) - Number(b.synthetic) || a.label.localeCompare(b.label));
writeFileSync(indexPath, JSON.stringify(index, null, 2) + '\n');
console.log(`wrote ${indexPath} with ${index.areas.length} areas`);
