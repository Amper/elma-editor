import type { EditorTool, CanvasPointerEvent } from './Tool';
import type { EditorState } from '@/state/editorStore';
import type { Vec2 } from '@/types';
import { panByScreenDelta } from '@/canvas/viewport';

export class PanTool implements EditorTool {
  private dragging = false;
  private lastScreen: Vec2 = { x: 0, y: 0 };

  constructor(private getStore: () => EditorState) {}

  activate() {
    this.dragging = false;
  }
  deactivate() {
    this.dragging = false;
  }

  onPointerDown(e: CanvasPointerEvent) {
    if (e.button === 0) {
      this.dragging = true;
      this.lastScreen = e.screenPos;
    }
  }

  onPointerMove(e: CanvasPointerEvent) {
    if (!this.dragging) return;
    const dx = e.screenPos.x - this.lastScreen.x;
    const dy = e.screenPos.y - this.lastScreen.y;
    this.lastScreen = e.screenPos;
    const store = this.getStore();
    store.setViewport(panByScreenDelta(store.viewport, dx, dy));
  }

  onPointerUp(e: CanvasPointerEvent) {
    if (e.button === 0) this.dragging = false;
  }

  onKeyDown() {}
  onKeyUp() {}
  renderOverlay() {}

  getCursor() {
    return this.dragging ? 'grabbing' : 'grab';
  }
}
