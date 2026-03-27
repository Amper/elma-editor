import type { Vec2 } from '@/types';

/** Canvas mouse event with both screen and world coordinates. */
export interface CanvasPointerEvent {
  screenPos: Vec2;
  worldPos: Vec2;
  button: number; // 0=left, 1=middle, 2=right
  shiftKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
}

/** Interface that every editor tool must implement. */
export interface EditorTool {
  activate(): void;
  deactivate(): void;
  onPointerDown(event: CanvasPointerEvent): void;
  onPointerMove(event: CanvasPointerEvent): void;
  onPointerUp(event: CanvasPointerEvent): void;
  onKeyDown(event: KeyboardEvent): void;
  onKeyUp(event: KeyboardEvent): void;
  /** Draw tool-specific overlays (preview polygon, selection handles, etc.) */
  renderOverlay(ctx: CanvasRenderingContext2D): void;
  getCursor(): string;
  /** Return false when the tool needs right-click for its own purposes. */
  wantsContextMenu?(): boolean;
}
