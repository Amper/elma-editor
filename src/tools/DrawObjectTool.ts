import type { EditorTool, CanvasPointerEvent } from './Tool';
import type { EditorState } from '@/state/editorStore';
import type { Vec2 } from '@/types';
import { ObjectType, OBJECT_RADIUS } from 'elmajs';
import { snapToGrid } from '@/utils/snap';
import { getTheme, type ThemeColors } from '@/canvas/themeColors';

export const DEBUG_START_COLOR = '#e0a030';

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
    // Exit debug start placement mode when switching tools
    const store = this.getStore();
    if (store.placingDebugStart) {
      store.setPlacingDebugStart(false);
    }
  }

  onPointerDown(e: CanvasPointerEvent) {
    if (e.button === 0) {
      const store = this.getStore();
      const snapped = snapToGrid(e.worldPos, store.grid);

      if (store.placingDebugStart) {
        const params = store.debugStartParams;
        store.setDebugStart({
          position: { x: snapped.x, y: snapped.y },
          ...params,
        });
        return;
      }

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
    const { x, y } = this.previewPos;

    if (store.placingDebugStart) {
      ctx.globalAlpha = 0.4;
      ctx.beginPath();
      ctx.arc(x, y, OBJECT_RADIUS, 0, Math.PI * 2);
      ctx.fillStyle = DEBUG_START_COLOR;
      ctx.fill();
      ctx.strokeStyle = DEBUG_START_COLOR;
      ctx.lineWidth = 0.02;
      ctx.stroke();

      ctx.fillStyle = '#fff';
      ctx.font = `${OBJECT_RADIUS * 1.2}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('D', x, y);
      ctx.globalAlpha = 1.0;
      return;
    }

    const { type } = store.objectConfig;
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
