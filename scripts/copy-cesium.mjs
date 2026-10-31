// Copies Cesium's prebuilt static assets (workers, textures, widget CSS) into public/cesium/ so
// Vite serves them identically in dev and in the build. public/cesium/ is gitignored.
// Runs on postinstall, predev and prebuild. Idempotent; skips if the version marker matches.
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'node_modules', 'cesium', 'Build', 'Cesium');
const dest = join(root, 'public', 'cesium');
const dirs = ['Workers', 'ThirdParty', 'Assets', 'Widgets'];

if (!existsSync(src)) {
  console.error('copy-cesium: cesium is not installed (node_modules/cesium missing). Run npm install.');
  process.exit(1);
}
const version = JSON.parse(readFileSync(join(root, 'node_modules', 'cesium', 'package.json'), 'utf8')).version;
const marker = join(dest, '.version');
if (existsSync(marker) && readFileSync(marker, 'utf8') === version && dirs.every((d) => existsSync(join(dest, d)))) {
  console.log(`copy-cesium: public/cesium already at ${version}`);
  process.exit(0);
}
mkdirSync(dest, { recursive: true });
for (const d of dirs) cpSync(join(src, d), join(dest, d), { recursive: true });
writeFileSync(marker, version);
console.log(`copy-cesium: copied ${dirs.join(', ')} for cesium ${version} -> public/cesium/`);
