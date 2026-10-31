/**
 * "Live fires · predict": lists wildfires reported now (NIFC) and forecasts one of them. After a
 * forecast, shows how big the fire is predicted to be at each ring (1 h / 3 h / 6 h).
 */

import { cellAreaHa } from '../contract';
import type { LiveFire } from '../data/liveFire';
import type { Store } from '../app/state';
import { FORECAST_RINGS } from '../viewer/burnCanvas';
import { el } from './el';
import { icon } from './icons';
import { STR } from './strings';

export interface LiveFiresActions {
  loadLiveFires(): void;
  predictLiveFire(fire: LiveFire): void;
}

export function mountLiveFires(container: HTMLElement, store: Store, actions: LiveFiresActions): void {
  const find = el('button', { type: 'button', class: 'primary', onclick: () => actions.loadLiveFires() }, icon('globe', 16), el('span', {}, STR.liveFind)) as HTMLButtonElement;
  const status = el('div', { class: 'muted hint' });
  const list = el('ul', { class: 'live-list' });
  const forecast = el('div', { class: 'live-forecast' });
  container.append(find, status, list, forecast, el('div', { class: 'muted hint' }, STR.liveNote));

  let renderedFires: LiveFire[] | null = null;
  store.subscribe((s) => {
    find.disabled = s.liveLoading || s.areaLoading || s.simRunning;
    find.querySelector('span')!.textContent = s.liveFires ? STR.predictRefresh : STR.liveFind;
    status.textContent = s.liveLoading ? STR.liveLoadingList : s.liveFires && !s.liveFires.length ? STR.liveNone : '';

    if (s.liveFires !== renderedFires) {
      renderedFires = s.liveFires;
      list.replaceChildren(...(s.liveFires ?? []).map((f) => fireItem(f, () => actions.predictLiveFire(f))));
    }
    for (const b of list.querySelectorAll('button')) (b as HTMLButtonElement).disabled = s.areaLoading || s.simRunning;

    const live = s.area?.meta.name.startsWith('live-');
    if (s.forecast && live && s.result && s.area) {
      const ha = cellAreaHa(s.area.grid);
      const arr = s.result.arrivalTime;
      const rows = FORECAST_RINGS.map((ring) => {
        let n = 0;
        for (const a of arr) if (a <= ring.t) n++;
        return el('div', { class: 'ring-row' },
          el('span', { class: 'ring-swatch', style: `background: rgb(${ring.rgba.slice(0, 3).join(',')})` }),
          el('span', {}, `${STR.liveIn} ${ring.t / 3600} h`),
          el('strong', {}, `${Math.round(n * ha)} ha`),
        );
      });
      const w = s.weather;
      forecast.replaceChildren(
        el('div', {}, el('strong', {}, s.area.meta.label), el('span', { class: 'muted' }, ` · ${STR.liveForecastTitle}`)),
        el('div', { class: 'muted' }, `${Math.round(w.windSpeedMps * 3.6)} km/h ${STR.windFrom.toLowerCase()} ${Math.round(w.windFromDeg)}° · ${Math.round(w.temperatureC)} °C · ${Math.round(w.relativeHumidity * 100)} %`),
        ...rows,
      );
    } else forecast.replaceChildren();
  });
}

function fireItem(f: LiveFire, onPredict: () => void): HTMLElement {
  const size = f.acres != null ? ` · ${f.acres} ${STR.liveAcres}` : '';
  const when = f.discovered ? ` · ${STR.liveReported} ${ago(f.discovered)}` : '';
  return el('li', {},
    el('div', {}, el('strong', {}, f.name), el('div', { class: 'muted' }, `${f.lat.toFixed(3)}, ${f.lon.toFixed(3)}${size}${when}`)),
    el('button', { type: 'button', onclick: onPredict }, icon('flame', 14), el('span', {}, STR.livePredict)),
  );
}

function ago(ms: number): string {
  const min = Math.max(0, Math.round((Date.now() - ms) / 60000));
  if (min < 60) return `${min} min ago`;
  const h = Math.round(min / 60);
  return h < 48 ? `${h} h ago` : `${Math.round(h / 24)} d ago`;
}
