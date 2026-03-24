import type { EditorTool, CanvasPointerEvent } from './Tool';
import type { EditorState } from '@/state/editorStore';
import type { Vec2 } from '@/types';
import { ObjectType, OBJECT_RADIUS } from 'elmajs';
import { snapToGrid } from '@/utils/snap';
import { getTheme, type ThemeColors } from '@/canvas/themeColors';

function objectColor(type: number, t: ThemeColors): string {
  switch (type) {
    case ObjectType.Exit: return t.objExit;
    case ObjectType.Apple: return t.objApple;
    case ObjectType.Killer: return t.objKiller;
    case ObjectType.Start: return t.objStart;
    default: return '#888888';
  }
}

const OBJECT_LABELS: Record<number, string> = {
  [ObjectType.Exit]: 'F',
  [ObjectType.Apple]: 'A',
  [ObjectType.Killer]: 'K',
  [ObjectType.Start]: 'S',
};

export class DrawObjectTool implements EditorTool {
  private previewPos: Vec2 | null = null;

  constructor(private getStore: () => EditorState) {}

  activate() {
    this.previewPos = null;
  }
  deactivate() {
    this.previewPos = null;
  }

  onPointerDown(e: CanvasPointerEvent) {
    if (e.button === 0) {
      const store = this.getStore();
      const snapped = snapToGrid(e.worldPos, store.grid);
      const config = store.objectConfig;
      store.addObject({
        x: snapped.x,
        y: snapped.y,
        type: config.type,
        gravity: config.gravity,
        animation: config.animation,
      });
    }
  }

  onPointerMove(e: CanvasPointerEvent) {
    this.previewPos = snapToGrid(e.worldPos, this.getStore().grid);
  }

  onPointerUp() {}
  onKeyDown() {}
  onKeyUp() {}

  renderOverlay(ctx: CanvasRenderingContext2D) {
    if (!this.previewPos) return;

    const t = getTheme();
    const store = this.getStore();
    const { type } = store.objectConfig;
    const { x, y } = this.previewPos;
    const color = objectColor(type, t);
    const label = OBJECT_LABELS[type] ?? '?';

    ctx.globalAlpha = 0.4;
    ctx.beginPath();
    ctx.arc(x, y, OBJECT_RADIUS, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.strokeStyle = color;
    ctx.lineWidth = 0.02;
    ctx.stroke();

    ctx.fillStyle = t.handle;
    ctx.font = `${OBJECT_RADIUS * 1.2}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, x, y);
    ctx.globalAlpha = 1.0;
  }

  getCursor() {
    return 'crosshair';
  }
}
