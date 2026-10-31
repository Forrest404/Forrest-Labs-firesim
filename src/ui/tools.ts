/** Tool palette (icon chips), brush size, apply-at-start switch, undo/redo/clear, intervention list. */

import type { ToolsController } from '../app/toolsController';
import type { Store, ToolId } from '../app/state';
import { DRAW_TOOLS } from '../tools';
import { chip, iconButton, row, slider, toggle } from './controls';
import { el, formatClock } from './el';
import { icon } from './icons';
import type { IconName } from './icons';
import { STR } from './strings';

const TOOL_ICON: Record<ToolId, IconName> = { ignite: 'flame', firebreak: 'axe', water: 'droplet' };

export function mountTools(container: HTMLElement, store: Store, ctl: ToolsController): void {
  const palette: [ToolId, string][] = [['ignite', STR.toolIgnite], ...DRAW_TOOLS.map((t) => [t.id, STR[t.labelKey]] as [ToolId, string])];
  const buttons = new Map<ToolId, HTMLButtonElement>();
  const seg = el('div', { class: 'seg tools grow', role: 'radiogroup', 'aria-label': STR.toolsTitle });
  for (const [id, label] of palette) {
    const b = el('button', { type: 'button', role: 'radio', 'aria-checked': 'false', onclick: () => store.set({ tool: id }) }, icon(TOOL_ICON[id], 16), el('span', {}, label)) as HTMLButtonElement;
    buttons.set(id, b);
    seg.append(b);
  }
  const hint = el('div', { class: 'muted hint' });
  const size = slider({ min: 1, max: 7, step: 1, ariaLabel: STR.brushSize }, (v) =>
    store.update((s) => ({
      toolParams: s.tool === 'firebreak' ? { ...s.toolParams, firebreakWidthCells: v } : { ...s.toolParams, waterRadiusCells: v },
    })));
  const sizeVal = chip('', 'value');
  const sizeRow = row(STR.brushSize, size, sizeVal);
  const sizeLabel = sizeRow.querySelector('.ctl-label') as HTMLElement;
  const preClear = toggle(STR.preClear, (on) => store.update((s) => ({ toolParams: { ...s.toolParams, preClear: on } })), { title: STR.preClearHelp });
  const undoBtn = iconButton('undo', STR.undo, () => ctl.undo(), { title: `${STR.undo} (⌘Z)` });
  const redoBtn = iconButton('redo', STR.redo, () => ctl.redo(), { title: `${STR.redo} (⇧⌘Z)` });
  const clearBtn = iconButton('trash', STR.clearAll, () => ctl.clearAll(), { class: 'danger' });
  const list = el('ul', { class: 'interventions' });
  const drawOnly = el('div', { class: 'draw-only' }, sizeRow, preClear.root);

  container.append(
    seg,
    hint,
    drawOnly,
    el('div', { class: 'row between' }, el('div', { class: 'row tight' }, undoBtn, redoBtn), clearBtn),
    list,
  );

  window.addEventListener('keydown', (e) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
    if (store.get().view !== 'sim') return;
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      if (e.shiftKey) ctl.redo();
      else ctl.undo();
    }
  });

  store.subscribe((s, prev) => {
    for (const [id, b] of buttons) {
      b.classList.toggle('on', s.tool === id);
      b.setAttribute('aria-checked', s.tool === id ? 'true' : 'false');
    }
    const drawing = s.tool === 'firebreak' || s.tool === 'water';
    drawOnly.classList.toggle('open', drawing);
    if (drawing) {
      const tool = DRAW_TOOLS.find((t) => t.id === s.tool)!;
      size.min = String(tool.sizeMin);
      size.max = String(tool.sizeMax);
      const v = s.tool === 'firebreak' ? s.toolParams.firebreakWidthCells : s.toolParams.waterRadiusCells;
      if (document.activeElement !== size) size.value = String(v);
      sizeLabel.textContent = STR[tool.sizeLabelKey];
      sizeVal.textContent = `${v * (s.area?.grid.cellSizeM ?? 0)} m`;
    }
    hint.textContent = s.tool === 'ignite' ? STR.toolIgniteHint : s.tool === 'firebreak' ? STR.toolFirebreakHint : STR.toolWaterHint;
    preClear.input.checked = s.toolParams.preClear;
    undoBtn.disabled = !ctl.canUndo;
    redoBtn.disabled = !ctl.canRedo;
    clearBtn.disabled = s.interventions.length === 0;
    if (s.interventions === prev.interventions && list.childElementCount === s.interventions.length) return;
    list.replaceChildren(
      ...s.interventions.map((iv) =>
        el('li', {},
          icon(iv.type === 'firebreak' ? 'axe' : 'droplet', 14),
          el('span', { class: 'iv-text' }, `${iv.type === 'firebreak' ? STR.toolFirebreak : STR.toolWater} · ${iv.cells.length} ${STR.cells} · ${formatClock(iv.tSeconds)}`),
          iconButton('x', STR.remove, () => ctl.remove(iv.id), { class: 'tiny' }),
        ),
      ),
    );
  });
}
