import type { EditorTool, CanvasPointerEvent } from './Tool';
import type { EditorState } from '@/state/editorStore';
import type { Vec2 } from '@/types';
import { snapToGrid } from '@/utils/snap';
import { getTheme, withAlpha } from '@/canvas/themeColors';
import { fillWithPreviewTexture } from './texturePreview';

export class DrawPolygonTool implements EditorTool {
  private vertices: Vec2[] = [];
  private previewVertex: Vec2 | null = null;

  constructor(private getStore: () => EditorState) {}

  activate() {
    this.vertices = [];
    this.previewVertex = null;
  }

  deactivate() {
    this.vertices = [];
    this.previewVertex = null;
  }

  onPointerDown(e: CanvasPointerEvent) {
    if (e.button === 0) {
      const snapped = snapToGrid(e.worldPos, this.getStore().grid);
      this.vertices.push(snapped);
    } else if (e.button === 2) {
      this.commitPolygon();
    }
  }

  onPointerMove(e: CanvasPointerEvent) {
    this.previewVertex = snapToGrid(e.worldPos, this.getStore().grid);
  }

  onPointerUp() {}

  onKeyDown(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      this.commitPolygon();
    } else if (e.key === 'Escape') {
      this.vertices = [];
      this.previewVertex = null;
    } else if (e.key === 'Backspace' && this.vertices.length > 0) {
      this.vertices.pop();
    } else if (e.key === 'g' || e.key === 'G') {
      const store = this.getStore();
      store.setDrawPolygonGrass(!store.drawPolygonGrass);
    }
  }

  onKeyUp() {}

  renderOverlay(ctx: CanvasRenderingContext2D) {
    if (this.vertices.length === 0 && !this.previewVertex) return;

    const t = getTheme();
    const zoom = this.getStore().viewport.zoom;
    const lineWidth = 1 / zoom;
    const vertexSize = 4 / zoom;

    const isGrass = this.getStore().drawPolygonGrass;
    ctx.strokeStyle = isGrass ? t.toolDrawGrass : t.toolDrawGround;
    ctx.lineWidth = lineWidth;

    // Draw placed edges and preview line to cursor
    if (this.vertices.length > 0) {
      // Translucent fill (closed path, only when closeable)
      if (this.previewVertex && this.vertices.length >= 2) {
        const previewVerts = [...this.vertices, this.previewVertex];

        if (isGrass || !fillWithPreviewTexture(ctx, this.getStore().level, previewVerts)) {
          ctx.beginPath();
          ctx.moveTo(previewVerts[0]!.x, previewVerts[0]!.y);
          for (let i = 1; i < previewVerts.length; i++) {
            ctx.lineTo(previewVerts[i]!.x, previewVerts[i]!.y);
          }
          ctx.closePath();
          ctx.fillStyle = withAlpha(
            isGrass ? t.toolDrawGrass : t.toolDrawGround,
            0.12,
          );
          ctx.fill();
        }
      }

      // Solid stroke for placed edges + line to cursor (open path)
      ctx.beginPath();
      ctx.moveTo(this.vertices[0]!.x, this.vertices[0]!.y);
      for (let i = 1; i < this.vertices.length; i++) {
        ctx.lineTo(this.vertices[i]!.x, this.vertices[i]!.y);
      }
      if (this.previewVertex) {
        ctx.lineTo(this.previewVertex.x, this.previewVertex.y);
      }
      ctx.stroke();

      // Dashed closing line (preview to first vertex)
      if (this.previewVertex && this.vertices.length >= 2) {
        ctx.setLineDash([lineWidth * 4, lineWidth * 4]);
        ctx.beginPath();
        ctx.moveTo(this.previewVertex.x, this.previewVertex.y);
        ctx.lineTo(this.vertices[0]!.x, this.vertices[0]!.y);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }

    // Draw vertex markers
    ctx.fillStyle = t.handle;
    for (const v of this.vertices) {
      ctx.fillRect(
        v.x - vertexSize / 2,
        v.y - vertexSize / 2,
        vertexSize,
        vertexSize,
      );
    }

    // Grass mode indicator
    if (isGrass) {
      ctx.fillStyle = t.toolDrawGrass;
      ctx.font = `${12 / zoom}px sans-serif`;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      if (this.previewVertex) {
        ctx.fillText(
          'GRASS',
          this.previewVertex.x + 8 / zoom,
          this.previewVertex.y + 8 / zoom,
        );
      }
    }
  }

  getCursor() {
    return 'crosshair';
  }

  private commitPolygon() {
    if (this.vertices.length < 3) return;
    this.getStore().addPolygon({
      grass: this.getStore().drawPolygonGrass,
      vertices: [...this.vertices],
    });
    this.vertices = [];
    this.previewVertex = null;
  }
}
