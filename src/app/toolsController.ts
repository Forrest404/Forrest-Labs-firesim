/**
 * Drives the drawing tools: collects drag strokes from the picker (cell space), shows a live
 * preview, turns a finished stroke into a timestamped Intervention, keeps undo/redo, and
 * re-simulates while preserving playback time.
 */

import type { Intervention } from '../contract';
import type { Pt } from '../data/raster';
import { InterventionHistory, drawTool } from '../tools';
import type { PickedCell } from '../viewer/picking';
import type { Store } from './state';
import type { Wiring } from './wiring';

export interface ToolsController {
  undo(): void;
  redo(): void;
  remove(id: string): void;
  clearAll(): void;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
}

export function createToolsController(store: Store, wiring: Wiring): ToolsController {
  const history = new InterventionHistory(store.get().interventions);
  let stroke: Pt[] = [];
  let counter = 1;

  const commit = (next: Intervention[]): void => {
    history.push(next);
    store.update((s) => ({ interventions: next, resultStale: !!s.result }));
    if (store.get().result) void wiring.simulate();
  };

  const applyHistory = (list: Intervention[] | null): void => {
    if (!list) return;
    store.update((s) => ({ interventions: list, resultStale: !!s.result }));
    if (store.get().result) void wiring.simulate();
  };

  const sizeFor = (): number => {
    const s = store.get();
    return s.tool === 'firebreak' ? s.toolParams.firebreakWidthCells : s.toolParams.waterRadiusCells;
  };

  wiring.setDrawHandlers({
    start(c: PickedCell) {
      stroke = [[c.x, c.y]];
      preview();
    },
    move(c: PickedCell) {
      stroke.push([c.x, c.y]);
      preview();
    },
    end() {
      const s = store.get();
      if (!s.area || (s.tool !== 'firebreak' && s.tool !== 'water') || stroke.length === 0) return;
      const tool = drawTool(s.tool);
      const t = s.toolParams.preClear ? 0 : s.playback.t;
      const id = `${s.tool}-${Date.now().toString(36)}-${counter++}`;
      const iv = tool.make(
        s.area.grid,
        stroke,
        sizeFor(),
        t,
        id,
      );
      stroke = [];
      wiring.setPreview(null);
      if (iv) commit([...s.interventions, iv]);
    },
  });

  function preview(): void {
    const s = store.get();
    if (!s.area || (s.tool !== 'firebreak' && s.tool !== 'water')) return;
    const tool = drawTool(s.tool);
    wiring.setPreview({ type: s.tool, cells: tool.previewCells(s.area.grid, stroke, sizeFor()) });
  }

  // A new area resets the history.
  store.subscribe((s, prev) => {
    if (s.area !== prev.area) history.reset(s.interventions);
  });

  return {
    undo: () => applyHistory(history.undo()),
    redo: () => applyHistory(history.redo()),
    remove: (id) => commit(store.get().interventions.filter((iv) => iv.id !== id)),
    clearAll: () => commit([]),
    get canUndo() {
      return history.canUndo;
    },
    get canRedo() {
      return history.canRedo;
    },
  };
}
