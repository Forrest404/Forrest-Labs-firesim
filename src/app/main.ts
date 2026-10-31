// Entry point: boots the store, panel, viewer and wiring. Any failure shows a banner.
import 'cesium/Build/Cesium/Widgets/widgets.css';
import '../ui/styles.css';
import { loadDemoAreaIndex } from '../data/demoAreas';
import { createNotices } from '../ui/notices';
import { mountPanel } from '../ui/panel';
import { STR } from '../ui/strings';
import { createViewer } from '../viewer/createViewer';
import { mountSettingsAdvanced } from '../ui/settingsAdvanced';
import { mountPlanner } from '../ui/planner';
import { mountRealVsSim } from '../ui/realVsSim';
import { mountTools } from '../ui/tools';
import { startClock } from './clock';
import { createStore } from './state';
import { createToolsController } from './toolsController';
import { wire } from './wiring';

const panelEl = document.getElementById('panel') as HTMLElement;
const noticesEl = document.getElementById('notices') as HTMLElement;
const viewerEl = document.getElementById('viewer') as HTMLElement;

async function main(): Promise<void> {
  const notices = createNotices(noticesEl);
  const store = createStore();

  // Surface anything unexpected instead of failing silently (teammates will see it immediately).
  let lastErr = '';
  const report = (msg: string): void => {
    if (msg === lastErr) return;
    lastErr = msg;
    notices.show(`${STR.unexpectedError} ${msg}`, 'error', 10000);
  };
  window.addEventListener('error', (e) => report(e.message));
  window.addEventListener('unhandledrejection', (e) => report(e.reason instanceof Error ? e.reason.message : String(e.reason)));

  // Panel first so the honesty notice is visible even if the viewer fails.
  let wiringRef: ReturnType<typeof wire> | null = null;
  const slots = mountPanel(panelEl, store, {
    selectArea: (name) => void wiringRef?.selectArea(name),
    simulate: () => void wiringRef?.simulate(),
    compareWithRealFire: () => void wiringRef?.compareWithRealFire(),
    realVsSim: () => void wiringRef?.realVsSim(),
    cancel: () => wiringRef?.cancel(),
    topDown: () => wiringRef?.topDown(),
    resetView: () => wiringRef?.resetView(),
    groundView: () => wiringRef?.groundView(),
  });
  mountSettingsAdvanced(slots.advanced, store);
  mountRealVsSim(document.getElementById('app') as HTMLElement, store, () => wiringRef?.groundView());

  notices.persistent('loading', STR.loadingArea, 'info');
  const handle = await createViewer({
    container: viewerEl,
    googleApiKey: import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined,
    onModeChange: (mode, reason) => {
      store.set({ viewerMode: mode });
      notices.show(`${STR.fallbackBanner} ${reason}`, 'warn', 8000);
    },
  });
  store.set({ viewerMode: handle.mode });
  // Shown briefly: it would otherwise cover the time scrubber. The panel keeps a mode line.
  if (handle.mode === 'fallback') notices.show(`${STR.fallbackBanner} ${handle.fallbackReason}`, 'warn', 8000);

  const wiring = wire(handle.viewer, store, notices);
  wiringRef = wiring;
  mountPlanner(slots.planner, store, wiring);
  mountTools(slots.tools, store, createToolsController(store, wiring));
  startClock(store);

  try {
    const index = await loadDemoAreaIndex();
    store.set({ areas: index.areas });
    const params = new URLSearchParams(location.search);
    const wanted = params.get('area');
    const first = index.areas.find((a) => a.name === wanted) ?? index.areas[0];
    if (first) await wiring.selectArea(first.name);
    else notices.show(STR.noAreas, 'error', 0);
  } catch (err) {
    notices.show(`${STR.indexError} (${err instanceof Error ? err.message : String(err)})`, 'error', 0);
  } finally {
    notices.persistent('loading', null);
  }

  // Keyboard: Escape returns to the ignition tool, Space toggles playback.
  window.addEventListener('keydown', (e) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
    if (e.key === 'Escape') store.set({ tool: 'ignite' });
    if (e.key === ' ' && store.get().result) {
      e.preventDefault();
      store.update((s) => ({ playback: { ...s.playback, playing: !s.playback.playing } }));
    }
  });

  if (import.meta.env.DEV) {
    // Dev/test hook (not in production builds): lets headless tests and teammates poke the app.
    (window as unknown as { __firesim: unknown }).__firesim = { store, wiring };
  }
  console.log('[app] ready', { mode: handle.mode });
}

main().catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  createNotices(noticesEl).show(`${STR.loadError} ${msg}`, 'error', 0);
  console.error(err);
});
