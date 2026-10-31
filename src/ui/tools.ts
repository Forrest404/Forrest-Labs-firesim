/** Tool palette, brush size, timing mode, undo/redo and the intervention list. */

import type { ToolsController } from '../app/toolsController';
import type { Store, ToolId } from '../app/state';
import { DRAW_TOOLS } from '../tools';
import { el, formatClock } from './el';
import { STR } from './strings';

export function mountTools(container: HTMLElement, store: Store, ctl: ToolsController): void {
  const palette: [ToolId, string][] = [['ignite', STR.toolIgnite], ...DRAW_TOOLS.map((t) => [t.id, STR[t.labelKey]] as [ToolId, string])];
  const buttons = new Map<ToolId, HTMLButtonElement>();
  const row = el('div', { class: 'row' });
  for (const [id, label] of palette) {
    const b = el('button', { onclick: () => store.set({ tool: id }) }, label) as HTMLButtonElement;
    buttons.set(id, b);
    row.append(b);
  }
  const hint = el('div', { class: 'muted' });
  const size = el('input', { type: 'range', min: 1, max: 7, step: 1 }) as HTMLInputElement;
  const sizeLabel = el('span', {});
  const sizeVal = el('span', { class: 'value' });
  const sizeRow = el('label', {}, sizeLabel, size, sizeVal);
  size.oninput = () =>
    store.update((s) => ({
      toolParams: s.tool === 'firebreak'
        ? { ...s.toolParams, firebreakWidthCells: Number(size.value) }
        : { ...s.toolParams, waterRadiusCells: Number(size.value) },
    }));
  const preClear = el('input', { type: 'checkbox' }) as HTMLInputElement;
  preClear.onchange = () => store.update((s) => ({ toolParams: { ...s.toolParams, preClear: preClear.checked } }));
  const undoBtn = el('button', { onclick: () => ctl.undo() }, STR.undo) as HTMLButtonElement;
  const redoBtn = el('button', { onclick: () => ctl.redo() }, STR.redo) as HTMLButtonElement;
  const clearBtn = el('button', { onclick: () => ctl.clearAll() }, STR.clearAll) as HTMLButtonElement;
  const list = el('ul', { class: 'interventions' });

  container.append(
    el('h2', {}, STR.toolsTitle),
    row,
    hint,
    sizeRow,
    el('label', {}, el('span', {}, STR.preClear), preClear),
    el('div', { class: 'row' }, undoBtn, redoBtn, clearBtn),
    list,
  );

  window.addEventListener('keydown', (e) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      if (e.shiftKey) ctl.redo();
      else ctl.undo();
    }
  });

  store.subscribe((s) => {
    for (const [id, b] of buttons) b.classList.toggle('active', s.tool === id);
    const drawing = s.tool === 'firebreak' || s.tool === 'water';
    sizeRow.style.display = drawing ? '' : 'none';
    if (drawing) {
      const tool = DRAW_TOOLS.find((t) => t.id === s.tool)!;
      size.min = String(tool.sizeMin);
      size.max = String(tool.sizeMax);
      const v = s.tool === 'firebreak' ? s.toolParams.firebreakWidthCells : s.toolParams.waterRadiusCells;
      if (document.activeElement !== size) size.value = String(v);
      sizeLabel.textContent = STR[tool.sizeLabelKey];
      sizeVal.textContent = `${v} ${v === 1 ? 'cell' : 'cells'} (${v * s.area!.grid.cellSizeM} m)`;
    }
    hint.textContent = s.tool === 'ignite' ? STR.toolIgniteHint : s.tool === 'firebreak' ? STR.toolFirebreakHint : STR.toolWaterHint;
    preClear.checked = s.toolParams.preClear;
    undoBtn.disabled = !ctl.canUndo;
    redoBtn.disabled = !ctl.canRedo;
    clearBtn.disabled = s.interventions.length === 0;
    list.replaceChildren(
      ...s.interventions.map((iv) =>
        el('li', {},
          el('span', {}, `${iv.type === 'firebreak' ? STR.toolFirebreak : STR.toolWater} · ${iv.cells.length} cells · ${STR.atTime} ${formatClock(iv.tSeconds)}`),
          el('button', { class: 'small', title: STR.remove, onclick: () => ctl.remove(iv.id) }, '✕'),
        ),
      ),
    );
  });
}
