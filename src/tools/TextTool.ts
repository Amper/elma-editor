import type { EditorTool, CanvasPointerEvent } from './Tool';
import type { EditorState } from '@/state/editorStore';
import type { Vec2 } from '@/types';
import { getTheme, withAlpha } from '@/canvas/themeColors';

export class TextTool implements EditorTool {
  private cursorPos: Vec2 = { x: 0, y: 0 };

  constructor(private getStore: () => EditorState) {}

  activate() {}

  deactivate() {}

  onPointerDown(e: CanvasPointerEvent) {
    if (e.button === 2) {
      this.getStore().setTextPolygons(null);
      return;
    }
    if (e.button !== 0) return;

    const store = this.getStore();
    const polygons = store.textPolygons;
    if (polygons && polygons.length > 0) {
      this.placePolygons(e.worldPos);
    }
  }

  onPointerMove(e: CanvasPointerEvent) {
    this.cursorPos = e.worldPos;
  }

  onPointerUp() {}

  onKeyDown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      this.getStore().setTextPolygons(null);
    }
  }

  onKeyUp() {}

  renderOverlay(ctx: CanvasRenderingContext2D) {
    const store = this.getStore();
    const polygons = store.textPolygons;
    if (!polygons || polygons.length === 0) return;

    const t = getTheme();
    const zoom = store.viewport.zoom;
    const { x: ox, y: oy } = this.cursorPos;

    for (const poly of polygons) {
      if (poly.length < 3) continue;

      ctx.beginPath();
      ctx.moveTo(poly[0]!.x + ox, poly[0]!.y + oy);
      for (let i = 1; i < poly.length; i++) {
        ctx.lineTo(poly[i]!.x + ox, poly[i]!.y + oy);
      }
      ctx.closePath();

      ctx.fillStyle = withAlpha(t.toolImport, 0.15);
      ctx.fill();

      ctx.setLineDash([6 / zoom, 3 / zoom]);
      ctx.strokeStyle = withAlpha(t.toolImport, 0.8);
      ctx.lineWidth = 1.5 / zoom;
      ctx.stroke();
      ctx.setLineDash([]);
    }

    if (polygons.length <= 50) {
      const dotR = 2.5 / zoom;
      ctx.fillStyle = withAlpha(t.toolImport, 0.9);
      for (const poly of polygons) {
        for (const v of poly) {
          ctx.beginPath();
          ctx.arc(v.x + ox, v.y + oy, dotR, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }

    const totalVerts = polygons.reduce((sum, p) => sum + p.length, 0);
    ctx.fillStyle = withAlpha(t.toolImport, 0.8);
    ctx.font = `${11 / zoom}px sans-serif`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(
      `${polygons.length} poly, ${totalVerts} verts`,
      ox + 8 / zoom,
      oy + 8 / zoom,
    );
  }

  getCursor() {
    const store = this.getStore();
    return store.textPolygons ? 'crosshair' : 'default';
  }

  private placePolygons(worldPos: Vec2) {
    const store = this.getStore();
    const polygons = store.textPolygons;
    if (!polygons) return;

    store.addPolygons(
      polygons.map((poly) => ({
        grass: false,
        vertices: poly.map((v) => ({
          x: v.x + worldPos.x,
          y: v.y + worldPos.y,
        })),
      })),
    );
  }
}
