// Entry point. Stage 4: viewer spike. Loads the first demo area, creates the Cesium viewer,
// drapes the fuel grid and the alignment checkerboard, shows corner markers. Replaced by full
// wiring in Stage 5.
import 'cesium/Build/Cesium/Widgets/widgets.css';
import '../ui/styles.css';
import { loadDemoArea, loadDemoAreaIndex } from '../data/demoAreas';
import { STR } from '../ui/strings';
import { paintCheckerboard, paintFuel } from '../viewer/burnCanvas';
import { GridLayer } from '../viewer/burnLayer';
import { flyToGrid, flyTopDown } from '../viewer/camera';
import { createViewer } from '../viewer/createViewer';
import { createGridOutline } from '../viewer/gridOutline';

const panel = document.getElementById('panel') as HTMLElement;
const notices = document.getElementById('notices') as HTMLElement;
const container = document.getElementById('viewer') as HTMLElement;

function banner(text: string, kind: 'info' | 'error' | 'warn' = 'warn'): void {
  const el = document.createElement('div');
  el.className = `banner ${kind}`;
  el.textContent = text;
  notices.appendChild(el);
}

async function main(): Promise<void> {
  panel.innerHTML = `<h1>${STR.appTitle}</h1><div class="notice">${STR.honestyNotice}<small>${STR.honestyDetail}</small></div><div id="status" class="muted">${STR.loadingArea}</div>`;
  const status = document.getElementById('status') as HTMLElement;

  const index = await loadDemoAreaIndex();
  const entry = index.areas[0];
  const area = await loadDemoArea(entry);
  status.textContent = `${area.meta.label} · ${area.grid.width}×${area.grid.height} @ ${area.grid.cellSizeM} m`;

  const handle = await createViewer({
    container,
    googleApiKey: import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined,
    onModeChange: (_mode, reason) => banner(`${STR.fallbackBanner} ${reason}`),
  });
  if (handle.mode === 'fallback') banner(`${STR.fallbackBanner} ${handle.fallbackReason}`);
  const { viewer } = handle;

  const fuelLayer = new GridLayer(viewer, area.grid, { zIndex: 1 });
  fuelLayer.paint((data) => paintFuel(data, area.fuel));
  const checker = new GridLayer(viewer, area.grid, { zIndex: 2 });
  checker.paint((data, w, h) => paintCheckerboard(data, w, h));
  checker.setVisible(false);
  const outline = createGridOutline(viewer, area.grid);
  flyToGrid(viewer, area.grid);

  const controls = document.createElement('section');
  controls.innerHTML = `
    <h2>Spike controls</h2>
    <div class="muted">${STR.viewerMode[handle.mode]}</div>
    <label><span>${STR.debugOutline}</span><input id="t-outline" type="checkbox" checked></label>
    <label><span>${STR.debugFuel}</span><input id="t-fuel" type="checkbox" checked></label>
    <label><span>Checkerboard (red = NW, blue = SE)</span><input id="t-check" type="checkbox"></label>
    <div class="row"><button id="b-top">${STR.cameraTopDown}</button><button id="b-reset">${STR.cameraReset}</button></div>
    <div class="muted">${area.meta.synthetic ? STR.syntheticNote : STR.realNote}</div>`;
  panel.appendChild(controls);
  (document.getElementById('t-outline') as HTMLInputElement).onchange = (e) => outline.setVisible((e.target as HTMLInputElement).checked);
  (document.getElementById('t-fuel') as HTMLInputElement).onchange = (e) => fuelLayer.setVisible((e.target as HTMLInputElement).checked);
  (document.getElementById('t-check') as HTMLInputElement).onchange = (e) => checker.setVisible((e.target as HTMLInputElement).checked);
  (document.getElementById('b-top') as HTMLButtonElement).onclick = () => flyTopDown(viewer, area.grid);
  (document.getElementById('b-reset') as HTMLButtonElement).onclick = () => flyToGrid(viewer, area.grid);

  console.log('[spike] viewer ready', { mode: handle.mode, area: area.meta.name, bounds: area.grid.bounds });
}

main().catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  banner(`${STR.loadError} ${msg}`, 'error');
  console.error(err);
});
