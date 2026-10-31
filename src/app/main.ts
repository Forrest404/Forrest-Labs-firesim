// Entry point: boots the store, panel, viewer and wiring. Any failure shows a banner.
import 'cesium/Build/Cesium/Widgets/widgets.css';
import '../ui/styles.css';
import { loadDemoAreaIndex } from '../data/demoAreas';
import { createNotices } from '../ui/notices';
import { mountPanel } from '../ui/panel';
import { STR } from '../ui/strings';
import { createViewer } from '../viewer/createViewer';
import { startClock } from './clock';
import { createStore } from './state';
import { wire } from './wiring';

const panelEl = document.getElementById('panel') as HTMLElement;
const noticesEl = document.getElementById('notices') as HTMLElement;
const viewerEl = document.getElementById('viewer') as HTMLElement;

async function main(): Promise<void> {
  const notices = createNotices(noticesEl);
  const store = createStore();

  // Panel first so the honesty notice is visible even if the viewer fails.
  let wiringRef: ReturnType<typeof wire> | null = null;
  const slots = mountPanel(panelEl, store, {
    selectArea: (name) => void wiringRef?.selectArea(name),
    simulate: () => void wiringRef?.simulate(),
    cancel: () => wiringRef?.cancel(),
    topDown: () => wiringRef?.topDown(),
    resetView: () => wiringRef?.resetView(),
  });
  // Stage 6 fills these.
  slots.tools.hidden = true;
  slots.advanced.hidden = true;

  notices.persistent('loading', STR.loadingArea, 'info');
  const handle = await createViewer({
    container: viewerEl,
    googleApiKey: import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined,
    onModeChange: (mode, reason) => {
      store.set({ viewerMode: mode });
      notices.persistent('fallback', `${STR.fallbackBanner} ${reason}`);
    },
  });
  store.set({ viewerMode: handle.mode });
  if (handle.mode === 'fallback') notices.persistent('fallback', `${STR.fallbackBanner} ${handle.fallbackReason}`);

  const wiring = wire(handle.viewer, store, notices);
  wiringRef = wiring;
  startClock(store);

  try {
    const index = await loadDemoAreaIndex();
    store.set({ areas: index.areas });
    const params = new URLSearchParams(location.search);
    const wanted = params.get('area');
    const first = index.areas.find((a) => a.name === wanted) ?? index.areas[0];
    if (first) await wiring.selectArea(first.name);
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

  console.log('[app] ready', { mode: handle.mode });
}

main().catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  createNotices(noticesEl).show(`${STR.loadError} ${msg}`, 'error', 0);
  console.error(err);
});
