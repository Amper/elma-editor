import type { EditorTool, CanvasPointerEvent } from './Tool';
import type { EditorState } from '@/state/editorStore';
import type { Vec2 } from '@/types';
import { getTheme, withAlpha } from '@/canvas/themeColors';
import { fillWithPreviewTexture } from './texturePreview';

type ShapeState = 'idle' | 'placing';

/** Compute vertices of a regular polygon. */
function regularPolygon(
  center: Vec2,
  sides: number,
  radius: number,
  rotation: number,
): Vec2[] {
  return Array.from({ length: sides }, (_, i) => {
    const angle = rotation + (2 * Math.PI * i) / sides;
    return {
      x: center.x + Math.cos(angle) * radius,
      y: center.y + Math.sin(angle) * radius,
    };
  });
}

export class ShapeTool implements EditorTool {
  private state: ShapeState = 'idle';
  private center: Vec2 = { x: 0, y: 0 };
  private currentPos: Vec2 = { x: 0, y: 0 };

  constructor(private getStore: () => EditorState) {}

  activate() {
    this.state = 'idle';
  }

  deactivate() {
    this.state = 'idle';
  }

  onPointerDown(e: CanvasPointerEvent) {
    // Right-click cancels
    if (e.button === 2) {
      this.state = 'idle';
      return;
    }
    if (e.button !== 0) return;

    if (this.state === 'idle') {
      // First click: set center
      this.center = e.worldPos;
      this.currentPos = e.worldPos;
      this.state = 'placing';
    } else if (this.state === 'placing') {
      // Second click: commit
      this.commitShape();
    }
  }

  onPointerMove(e: CanvasPointerEvent) {
    if (this.state === 'placing') {
      this.currentPos = e.worldPos;
    }
  }

  onPointerUp() {}

  onKeyDown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      this.state = 'idle';
    } else if (e.key === 'Enter' && this.state === 'placing') {
      this.commitShape();
    }
  }

  onKeyUp() {}

  renderOverlay(ctx: CanvasRenderingContext2D) {
    if (this.state !== 'placing') return;

    const t = getTheme();
    const store = this.getStore();
    const zoom = store.viewport.zoom;
    const { radius, angle } = this.getRadiusAndAngle();

    if (radius < 1e-6) return;

    const vertices = regularPolygon(this.center, store.shapeSides, radius, angle);

    // Draw preview polygon
    if (!fillWithPreviewTexture(ctx, store.level, vertices)) {
      ctx.beginPath();
      ctx.moveTo(vertices[0]!.x, vertices[0]!.y);
      for (let i = 1; i < vertices.length; i++) {
        ctx.lineTo(vertices[i]!.x, vertices[i]!.y);
      }
      ctx.closePath();
      ctx.fillStyle = withAlpha(t.toolPrimary, 0.1);
      ctx.fill();
    }

    // Stroke outline
    ctx.beginPath();
    ctx.moveTo(vertices[0]!.x, vertices[0]!.y);
    for (let i = 1; i < vertices.length; i++) {
      ctx.lineTo(vertices[i]!.x, vertices[i]!.y);
    }
    ctx.closePath();
    ctx.setLineDash([6 / zoom, 3 / zoom]);
    ctx.strokeStyle = withAlpha(t.toolPrimary, 0.8);
    ctx.lineWidth = 1.5 / zoom;
    ctx.stroke();
    ctx.setLineDash([]);

    // Draw vertex dots
    const dotR = 3 / zoom;
    ctx.fillStyle = withAlpha(t.toolPrimary, 0.9);
    for (const v of vertices) {
      ctx.beginPath();
      ctx.arc(v.x, v.y, dotR, 0, Math.PI * 2);
      ctx.fill();
    }

    // Draw center crosshair
    const ch = 6 / zoom;
    ctx.strokeStyle = withAlpha(t.toolPrimary, 0.5);
    ctx.lineWidth = 1 / zoom;
    ctx.beginPath();
    ctx.moveTo(this.center.x - ch, this.center.y);
    ctx.lineTo(this.center.x + ch, this.center.y);
    ctx.moveTo(this.center.x, this.center.y - ch);
    ctx.lineTo(this.center.x, this.center.y + ch);
    ctx.stroke();
  }

  getCursor() {
    return 'crosshair';
  }

  private getRadiusAndAngle(): { radius: number; angle: number } {
    const dx = this.currentPos.x - this.center.x;
    const dy = this.currentPos.y - this.center.y;
    return {
      radius: Math.sqrt(dx * dx + dy * dy),
      angle: Math.atan2(dy, dx),
    };
  }

  private commitShape() {
    const store = this.getStore();
    const { radius, angle } = this.getRadiusAndAngle();
    if (radius < 1e-6) {
      this.state = 'idle';
      return;
    }

    const vertices = regularPolygon(this.center, store.shapeSides, radius, angle);
    store.addPolygon({ grass: false, vertices });
    this.state = 'idle';
  }
}
