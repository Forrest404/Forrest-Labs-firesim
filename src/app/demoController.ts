/**
 * One-click demo: loads a saved scenario (area, ignition, weather, duration, seed, camera) into the
 * app and leaves it ready for Simulate; resets to that clean state; and applies the saved
 * "contained" plan as ONE undoable step. If the scenario's area cannot be loaded it falls back to
 * the offline synthetic backup and says so; it never leaves the app without an area.
 */

import { DEFAULT_SETTINGS } from '../contract';
import { DEMO_INTERVENTION_PREFIX, DEMO_SCENARIOS, demoContained, demoWeather } from '../data/demo-scenarios';
import type { DemoId } from '../data/demo-scenarios';
import type { Notices } from '../ui/notices';
import { STR } from '../ui/strings';
import type { Store } from './state';
import type { ToolsController } from './toolsController';
import type { Wiring } from './wiring';

export interface DemoController {
  /** Loads a scenario (default: the Surrey one). Resolves once the app is ready for Simulate. */
  load(id?: DemoId): Promise<void>;
  /** Back to the clean state of the current (or default) demo. */
  reset(): Promise<void>;
  /** Applies the saved firebreak and water spray as one undo step. */
  showContained(): void;
}

export function createDemoController(store: Store, wiring: Wiring, tools: ToolsController, notices: Notices): DemoController {
  let loading = false;

  // Choosing another area by hand ends "the demo is loaded".
  store.subscribe((s, prev) => {
    if (!loading && s.area !== prev.area && s.demoId) store.set({ demoId: null });
  });

  async function tryLoadArea(id: DemoId): Promise<boolean> {
    const name = DEMO_SCENARIOS[id].areaName;
    if (!store.get().areas.some((a) => a.name === name)) return false;
    await wiring.selectArea(name); // reports its own error and keeps the old area when the bundle fails to load
    return store.get().area?.meta.name === name;
  }

  async function load(id: DemoId = 'surrey'): Promise<void> {
    loading = true;
    try {
      let use: DemoId = id;
      let ok = await tryLoadArea(use);
      if (!ok && use !== 'backup') {
        notices.show(STR.demoFallback(STR.demoNames[use]), 'warn', 9000);
        use = 'backup';
        ok = await tryLoadArea(use);
      }
      if (!ok) {
        notices.show(STR.demoFailed, 'error', 0);
        return;
      }
      const sc = DEMO_SCENARIOS[use];
      store.set({
        demoId: use,
        ignition: { ...sc.ignition },
        weather: demoWeather(sc),
        settings: { ...DEFAULT_SETTINGS }, // the scenario was tuned on the defaults
        durationSeconds: sc.durationSeconds,
        seed: sc.seed,
        interventions: [],
        result: null,
        resultStale: false,
        simRunning: false,
        simError: null,
        tool: 'ignite',
        playback: { t: 0, playing: false, speed: sc.playbackSpeed },
      });
      wiring.flyToView(sc.camera);
    } finally {
      loading = false;
    }
  }

  return {
    load,
    reset: () => load(store.get().demoId ?? 'surrey'),
    showContained() {
      const s = store.get();
      if (!s.demoId || !s.area) return;
      if (s.interventions.some((iv) => iv.id.startsWith(DEMO_INTERVENTION_PREFIX))) return; // already shown
      tools.applyAll(demoContained(DEMO_SCENARIOS[s.demoId], s.area.grid));
    },
  };
}
