/**
 * A grid-sized canvas draped over the terrain / 3D tiles as a ground rectangle. Double-buffered:
 * each paint swaps to the other canvas so Cesium sees a new image and re-uploads the texture.
 */

import { CallbackProperty, ClassificationType, Color, ImageMaterialProperty, Rectangle } from 'cesium';
import type { Entity, Viewer } from 'cesium';
import type { GridSpec } from '../contract';

export type PaintFn = (data: Uint8ClampedArray, width: number, height: number) => void;

export interface GridLayerOptions {
  /** Overall opacity 0-1 (applied through the material alpha). */
  alpha?: number;
  /** Draw order among layers: higher wins. */
  zIndex?: number;
}

export class GridLayer {
  private readonly canvases: [HTMLCanvasElement, HTMLCanvasElement];
  private readonly contexts: [CanvasRenderingContext2D, CanvasRenderingContext2D];
  private readonly imageData: ImageData;
  private front = 0;
  private readonly entity: Entity;
  private visible = true;

  constructor(
    private readonly viewer: Viewer,
    readonly grid: GridSpec,
    o: GridLayerOptions = {},
  ) {
    const make = (): [HTMLCanvasElement, CanvasRenderingContext2D] => {
      const c = document.createElement('canvas');
      c.width = grid.width;
      c.height = grid.height;
      const ctx = c.getContext('2d');
      if (!ctx) throw new Error('2D canvas not available');
      return [c, ctx];
    };
    const [c0, x0] = make();
    const [c1, x1] = make();
    this.canvases = [c0, c1];
    this.contexts = [x0, x1];
    this.imageData = x0.createImageData(grid.width, grid.height);
    const b = grid.bounds;
    this.entity = viewer.entities.add({
      rectangle: {
        coordinates: Rectangle.fromDegrees(b.west, b.south, b.east, b.north),
        material: new ImageMaterialProperty({
          image: new CallbackProperty(() => this.canvases[this.front], false),
          transparent: true,
          color: undefined,
        }),
        classificationType: ClassificationType.BOTH,
        zIndex: o.zIndex ?? 0,
      },
    });
    if (o.alpha !== undefined) this.setAlpha(o.alpha);
  }

  /** Fills the back buffer via `fn` (RGBA, row 0 = north), then swaps buffers. */
  paint(fn: PaintFn): void {
    const back = 1 - this.front;
    fn(this.imageData.data, this.grid.width, this.grid.height);
    this.contexts[back].putImageData(this.imageData, 0, 0);
    this.front = back;
    this.viewer.scene.requestRender();
  }

  setAlpha(alpha: number): void {
    const mat = this.entity.rectangle?.material as ImageMaterialProperty | undefined;
    if (!mat) return;
    // Cesium multiplies the image by this colour; white with alpha = pure opacity control.
    // The setter wraps a raw Color in a ConstantProperty.
    (mat as unknown as { color: Color }).color = new Color(1, 1, 1, alpha);
  }

  setVisible(visible: boolean): void {
    this.visible = visible;
    this.entity.show = visible;
  }

  get isVisible(): boolean {
    return this.visible;
  }

  destroy(): void {
    this.viewer.entities.remove(this.entity);
  }
}
