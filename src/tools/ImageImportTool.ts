import type { EditorTool, CanvasPointerEvent } from './Tool';
import type { EditorState } from '@/state/editorStore';
import type { Vec2 } from '@/types';
import { getTheme, withAlpha } from '@/canvas/themeColors';

export class ImageImportTool implements EditorTool {
  private cursorPos: Vec2 = { x: 0, y: 0 };

  constructor(private getStore: () => EditorState) {}

  activate() {}

  deactivate() {}

  onPointerDown(e: CanvasPointerEvent) {
    // Right-click: clear loaded polygons
    if (e.button === 2) {
      this.getStore().setImageImportPolygons(null);
      return;
    }
    if (e.button !== 0) return;

    // Left-click: place polygons if loaded
    const store = this.getStore();
    const polygons = store.imageImportPolygons;
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
      this.getStore().setImageImportPolygons(null);
    }
  }

  onKeyUp() {}

  renderOverlay(ctx: CanvasRenderingContext2D) {
    const store = this.getStore();
    const polygons = store.imageImportPolygons;
    if (!polygons || polygons.length === 0) return;

    const t = getTheme();
    const zoom = store.viewport.zoom;
    const { x: ox, y: oy } = this.cursorPos;

    // Draw each polygon offset by cursor position
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

    // Draw vertex dots (skip if too many polygons for performance)
    if (polygons.length <= 20) {
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

    // Info label
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
    return store.imageImportPolygons ? 'crosshair' : 'default';
  }

  wantsContextMenu(): boolean {
    return this.getStore().imageImportPolygons === null;
  }

  private placePolygons(worldPos: Vec2) {
    const store = this.getStore();
    const polygons = store.imageImportPolygons;
    if (!polygons) return;

    // Add all polygons in a single undo snapshot
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
