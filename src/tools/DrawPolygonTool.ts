import type { EditorTool, CanvasPointerEvent } from './Tool';
import type { EditorState } from '@/state/editorStore';
import type { Vec2, HitTestResult } from '@/types';
import { snapToGrid } from '@/utils/snap';
import { getTheme, withAlpha } from '@/canvas/themeColors';
import { fillWithPreviewTexture } from './texturePreview';
import { hitTest } from '@/utils/geometry';

export class DrawPolygonTool implements EditorTool {
  private vertices: Vec2[] = [];
  private previewVertex: Vec2 | null = null;

  // Edge hover (only when vertices.length === 0)
  private hoveredHit: HitTestResult = { kind: 'none' };

  // Continuation mode
  private continuationMode = false;
  private lockedVertexCount = 0;
  private continuationGrass = false;

  constructor(private getStore: () => EditorState, private forceGrass?: boolean) {}

  activate() {
    this.vertices = [];
    this.previewVertex = null;
    this.hoveredHit = { kind: 'none' };
    this.continuationMode = false;
    this.lockedVertexCount = 0;
    if (this.forceGrass !== undefined) {
      this.getStore().setDrawPolygonGrass(this.forceGrass);
    }
  }

  deactivate() {
    if (this.continuationMode) {
      this.getStore().cancelUndoBatch();
      this.continuationMode = false;
    }
    this.vertices = [];
    this.previewVertex = null;
    this.hoveredHit = { kind: 'none' };
    this.lockedVertexCount = 0;
  }

  onPointerDown(e: CanvasPointerEvent) {
    if (e.button === 0) {
      // Start continuation if clicking on an edge (before any vertex is placed)
      if (
        this.vertices.length === 0 &&
        !this.continuationMode &&
        this.hoveredHit.kind === 'edge'
      ) {
        this.enterContinuationMode(this.hoveredHit);
        return;
      }

      const snapped = snapToGrid(e.worldPos, this.getStore().grid);
      this.vertices.push(snapped);
    } else if (e.button === 2) {
      this.commitPolygon();
    }
  }

  onPointerMove(e: CanvasPointerEvent) {
    const store = this.getStore();
    this.previewVertex = snapToGrid(e.worldPos, store.grid);

    // Edge hover detection (only before any vertex is placed)
    if (this.vertices.length === 0 && !this.continuationMode && store.level) {
      const captureRadius = 10 / store.viewport.zoom;
      const vis = {
        showGrass: store.showGrass,
        showObjects: store.showObjects,
        showPictures: store.showPictures,
        showTextures: store.showTextures,
      };
      const hit = hitTest(
        e.worldPos,
        store.level.polygons,
        store.level.objects,
        captureRadius,
        undefined,
        vis,
      );
      this.hoveredHit = hit.kind === 'edge' ? hit : { kind: 'none' };
    } else {
      this.hoveredHit = { kind: 'none' };
    }
  }

  onPointerUp() {}

  onKeyDown(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      this.commitPolygon();
    } else if (e.key === 'Escape') {
      if (this.continuationMode) {
        this.getStore().cancelUndoBatch();
        this.continuationMode = false;
        this.lockedVertexCount = 0;
      }
      this.vertices = [];
      this.previewVertex = null;
      this.hoveredHit = { kind: 'none' };
    } else if (e.key === 'Backspace' && this.vertices.length > this.lockedVertexCount) {
      this.vertices.pop();
    } else if (e.key === ' ' && this.vertices.length > 0) {
      e.preventDefault();
      // Reverse direction: flip locked and added parts separately
      // so the active drawing end switches to the other side
      const locked = this.vertices.slice(0, this.lockedVertexCount);
      const added = this.vertices.slice(this.lockedVertexCount);
      locked.reverse();
      added.reverse();
      this.vertices = [...locked, ...added];
    }
  }

  onKeyUp() {}

  renderOverlay(ctx: CanvasRenderingContext2D) {
    const t = getTheme();
    const zoom = this.getStore().viewport.zoom;

    // Edge hover dot (before any vertex is placed)
    if (
      this.vertices.length === 0 &&
      !this.continuationMode &&
      this.hoveredHit.kind === 'edge'
    ) {
      const { position } = this.hoveredHit;
      ctx.fillStyle = t.toolVertexHover;
      ctx.beginPath();
      ctx.arc(position.x, position.y, 3 / zoom, 0, Math.PI * 2);
      ctx.fill();
      return;
    }

    if (this.vertices.length === 0 && !this.previewVertex) return;

    const lineWidth = 1 / zoom;
    const vertexSize = 4 / zoom;

    const isGrass = this.continuationMode
      ? this.continuationGrass
      : this.getStore().drawPolygonGrass;
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
    for (let i = 0; i < this.vertices.length; i++) {
      const v = this.vertices[i]!;
      if (this.continuationMode && i < this.lockedVertexCount) {
        // Locked (original) vertices: outlined square
        ctx.strokeStyle = withAlpha(isGrass ? t.toolDrawGrass : t.toolDrawGround, 0.5);
        ctx.lineWidth = 1 / zoom;
        ctx.strokeRect(
          v.x - vertexSize / 2,
          v.y - vertexSize / 2,
          vertexSize,
          vertexSize,
        );
      } else {
        // New vertices: filled square
        ctx.fillStyle = t.handle;
        ctx.fillRect(
          v.x - vertexSize / 2,
          v.y - vertexSize / 2,
          vertexSize,
          vertexSize,
        );
      }
    }

    // Restore stroke style after vertex markers
    ctx.strokeStyle = isGrass ? t.toolDrawGrass : t.toolDrawGround;
    ctx.lineWidth = lineWidth;

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
    if (
      this.vertices.length === 0 &&
      !this.continuationMode &&
      this.hoveredHit.kind === 'edge'
    ) {
      return 'pointer';
    }
    return 'crosshair';
  }

  wantsContextMenu(): boolean {
    return false;
  }

  // ── Continuation mode ───────────────────────────────────────────────────────

  private enterContinuationMode(hit: Extract<HitTestResult, { kind: 'edge' }>) {
    const store = this.getStore();
    const level = store.level;
    if (!level) return;

    const poly = level.polygons[hit.polygonIndex];
    if (!poly) return;

    const originalVerts: Vec2[] = poly.vertices.map((v) => ({ x: v.x, y: v.y }));
    const n = originalVerts.length;

    // Rotate vertices so edge's end vertex is first (dashed line target)
    // and edge's start vertex is last (where user continues from).
    // Edge is from edgeIndex to (edgeIndex+1)%n.
    const startIdx = (hit.edgeIndex + 1) % n;
    const rotated: Vec2[] = [];
    for (let i = 0; i < n; i++) {
      rotated.push(originalVerts[(startIdx + i) % n]!);
    }

    // Begin undo batch before removing
    store.beginUndoBatch();
    store.removePolygons([hit.polygonId]);

    this.vertices = rotated;
    this.lockedVertexCount = n;
    this.continuationMode = true;
    this.continuationGrass = poly.grass;
    this.hoveredHit = { kind: 'none' };
  }

  // ── Commit ──────────────────────────────────────────────────────────────────

  private commitPolygon() {
    if (this.continuationMode) {
      // Need at least 1 new vertex beyond the original ones
      if (this.vertices.length <= this.lockedVertexCount) return;
    } else {
      if (this.vertices.length < 3) return;
    }

    const grass = this.continuationMode
      ? this.continuationGrass
      : this.getStore().drawPolygonGrass;

    this.getStore().addPolygon({
      grass,
      vertices: [...this.vertices],
    });

    if (this.continuationMode) {
      this.getStore().endUndoBatch();
      this.continuationMode = false;
      this.lockedVertexCount = 0;
    }

    this.vertices = [];
    this.previewVertex = null;
    this.hoveredHit = { kind: 'none' };
  }
}
