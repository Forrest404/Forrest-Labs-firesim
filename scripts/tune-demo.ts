/**
 * Headless check of the demo scenarios: loads each demo area bundle, runs the simulation
 * (uncontained, contained with the saved plan, wind flipped) and prints what the audience will see.
 *   npm run tune:demo                      all scenarios
 *   npm run tune:demo -- --scenario surrey
 * Exits 1 if a check fails. To retune, edit src/data/demo-scenarios.ts (weather, ignition, duration,
 * the contained plan) and run this again; tests/demoScenario.test.ts guards the same checks.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { demoChecks, evaluateDemo } from '../src/app/demoEval';
import { decodeBundle } from '../src/data/bundle';
import type { DemoAreaBundle } from '../src/data/bundle';
import { DEMO_IDS, DEMO_SCENARIOS } from '../src/data/demo-scenarios';
import type { DemoId } from '../src/data/demo-scenarios';

const arg = process.argv.indexOf('--scenario');
const wanted = arg >= 0 ? (process.argv[arg + 1] as DemoId) : undefined;
const ids = wanted ? [wanted] : DEMO_IDS;
let failed = 0;

for (const id of ids) {
  const s = DEMO_SCENARIOS[id];
  if (!s) throw new Error(`unknown scenario "${id}" (known: ${DEMO_IDS.join(', ')})`);
  const file = join('public', 'demo-areas', `${s.areaName}.json`);
  console.log(`\n=== ${id}: area ${s.areaName}`);
  if (!existsSync(file)) {
    console.log(`  bundle ${file} is missing: build it with npm run build:demo-area (see PROGRESS.md). Skipped.`);
    continue;
  }
  const area = decodeBundle(JSON.parse(readFileSync(file, 'utf8')) as DemoAreaBundle);
  const r = evaluateDemo(area, s);
  const h = (t: number): string => (t === Infinity ? 'never' : `${(t / 3600).toFixed(2)} h`);
  console.log(`  ignition (${s.ignition.row}, ${s.ignition.col}), wind from ${s.windFromDeg} deg ${s.windSpeedKmh} km/h, ${s.dryness}, ${(s.durationSeconds / 3600).toFixed(1)} h`);
  console.log(`  uncontained: ${r.uncontained.hectares.toFixed(0)} ha, head ${r.uncontained.headBearingDeg.toFixed(0)} deg, village zone at ${h(r.zoneArrivalS)}, head at the break line ${h(r.breakArrivalS)}`);
  console.log(`    when it reaches the zone: ${r.atZone.hectares.toFixed(0)} ha, aspect ${r.atZone.aspect.toFixed(2)}, ahead ${r.atZone.aheadM.toFixed(0)} m / behind ${r.atZone.behindM.toFixed(0)} m, axis ${r.atZone.axisBearingDeg.toFixed(0)} deg`);
  console.log(`  contained:   ${r.contained.hectares.toFixed(0)} ha (${((100 * r.contained.hectares) / r.uncontained.hectares).toFixed(0)}%), zone ${h(r.containedZoneArrivalS)}`);
  console.log(`  wind flipped: ${r.flipped.hectares.toFixed(0)} ha, head ${r.flipped.headBearingDeg.toFixed(0)} deg`);
  console.log(`  one run: ${r.runtimeMs.toFixed(0)} ms`);
  for (const c of demoChecks(r)) {
    console.log(`  ${c.ok ? 'PASS' : 'FAIL'}  ${c.name}${c.detail ? `  [${c.detail}]` : ''}`);
    if (!c.ok) failed++;
  }
}
if (failed) {
  console.error(`\n${failed} check(s) failed`);
  process.exit(1);
}
