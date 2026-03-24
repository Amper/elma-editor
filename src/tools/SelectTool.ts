import type { EditorTool, CanvasPointerEvent } from './Tool';
import type { EditorState } from '@/state/editorStore';
import type {
  Vec2,
  SelectionState,
  HitTestResult,
  ResizeHandleId,
  FrameHandleHit,
  TransformFrame,
} from '@/types';
import {
  hitTest,
  computeBBox,
  distance,
  rotatePoint,
  scalePoint,
  angleBetween,
} from '@/utils/geometry';
import { OBJECT_RADIUS } from 'elmajs';
import { getTheme, withAlpha } from '@/canvas/themeColors';
import { getEditorLgr } from '@/canvas/lgrCache';

type SelectState = 'idle' | 'moving' | 'rubber-band' | 'resizing' | 'rotating';

export class SelectTool implements EditorTool {
  private state: SelectState = 'idle';

  // ── Drag / rubber-band ──
  private dragStart: Vec2 = { x: 0, y: 0 };
  private dragCurrent: Vec2 = { x: 0, y: 0 };

  // ── Move ──
  private moveStartWorld: Vec2 = { x: 0, y: 0 };
  private moveOriginals: {
    vertices: Array<{ polyIdx: number; vertIdx: number; pos: Vec2 }>;
    objects: Array<{ objIdx: number; pos: Vec2 }>;
    pictures: Array<{ picIdx: number; pos: Vec2 }>;
  } = { vertices: [], objects: [], pictures: [] };

  // ── Hover ──
  private hoveredHit: HitTestResult = { kind: 'none' };

  // ── Transform frame ──
  private frame: TransformFrame | null = null;
  private hoveredFrameHit: FrameHandleHit = { kind: 'none' };

  // ── Resize state ──
  private resizeHandle: ResizeHandleId | null = null;
  private resizeAnchor: Vec2 = { x: 0, y: 0 };
  private resizeStartWorld: Vec2 = { x: 0, y: 0 };

  // ── Rotation state ──
  private rotationCenter: Vec2 = { x: 0, y: 0 };
  private rotationStartPos: Vec2 = { x: 0, y: 0 };

  constructor(private getStore: () => EditorState) {}

  activate() {
    this.state = 'idle';
    this.hoveredHit = { kind: 'none' };
    this.hoveredFrameHit = { kind: 'none' };
    this.frame = null;
  }

  deactivate() {
    if (this.state === 'moving' || this.state === 'resizing' || this.state === 'rotating') {
      this.getStore().endUndoBatch();
    }
    this.state = 'idle';
    this.hoveredHit = { kind: 'none' };
    this.hoveredFrameHit = { kind: 'none' };
    this.frame = null;
  }

  // ── Pointer Events ─────────────────────────────────────────────────────────

  onPointerDown(e: CanvasPointerEvent) {
    if (e.button !== 0) return;
    const store = this.getStore();
    if (!store.level) return;

    const zoom = store.viewport.zoom;

    // 1. If transform frame is visible, check frame handles first
    if (this.frame) {
      const frameHit = this.hitTestFrame(e.worldPos, zoom);

      if (frameHit.kind === 'rotate') {
        store.beginUndoBatch();
        this.snapshotOriginals(store);
        this.rotationCenter = { x: this.frame.cx, y: this.frame.cy };
        this.rotationStartPos = e.worldPos;
        this.state = 'rotating';
        return;
      }

      if (frameHit.kind === 'resize') {
        store.beginUndoBatch();
        this.snapshotOriginals(store);
        this.resizeHandle = frameHit.handle;
        this.resizeAnchor = this.getResizeAnchor(frameHit.handle);
        this.resizeStartWorld = e.worldPos;
        this.state = 'resizing';
        return;
      }

      // 'inside' does NOT block — fall through to level hit-testing
      // so that unselected polygons inside the frame can still be clicked
    }

    // 2. Normal level hit-testing
    const captureRadius = 10 / zoom;
    const vis = { showGrass: store.showGrass, showObjects: store.showObjects, showPictures: store.showPictures, showTextures: store.showTextures };
    const hit = hitTest(
      e.worldPos,
      store.level.polygons,
      store.level.objects,
      captureRadius,
      store.level.pictures,
      vis,
    );

    if (hit.kind === 'vertex' || hit.kind === 'edge') {
      // Select tool works with whole polygons — treat vertex/edge hits as polygon hits
      const isAlreadySelected = store.selection.polygonIndices.has(hit.polygonIndex);
      if (isAlreadySelected && e.shiftKey) {
        this.deselectPolygon(hit.polygonIndex, store);
      } else if (isAlreadySelected) {
        this.startMove(e.worldPos, store);
      } else {
        this.selectPolygon(hit.polygonIndex, e.shiftKey, store);
        this.startMove(e.worldPos, this.getStore());
      }
    } else if (hit.kind === 'object') {
      const isAlreadySelected = store.selection.objectIndices.has(hit.objectIndex);
      if (isAlreadySelected && e.shiftKey) {
        this.deselectObject(hit.objectIndex, store);
      } else if (isAlreadySelected) {
        this.startMove(e.worldPos, store);
      } else {
        this.selectObject(hit.objectIndex, e.shiftKey, store);
        this.startMove(e.worldPos, this.getStore());
      }
    } else if (hit.kind === 'picture') {
      const isAlreadySelected = store.selection.pictureIndices.has(hit.pictureIndex);
      if (isAlreadySelected && e.shiftKey) {
        this.deselectPicture(hit.pictureIndex, store);
      } else if (isAlreadySelected) {
        this.startMove(e.worldPos, store);
      } else {
        this.selectPicture(hit.pictureIndex, e.shiftKey, store);
        this.startMove(e.worldPos, this.getStore());
      }
    } else if (hit.kind === 'polygon') {
      const isAlreadySelected = store.selection.polygonIndices.has(hit.polygonIndex);
      if (isAlreadySelected && e.shiftKey) {
        this.deselectPolygon(hit.polygonIndex, store);
      } else if (isAlreadySelected) {
        this.startMove(e.worldPos, store);
      } else {
        this.selectPolygon(hit.polygonIndex, e.shiftKey, store);
        // Immediately allow dragging after selecting via interior click
        this.startMove(e.worldPos, this.getStore());
      }
    } else if (this.frame && this.hitTestFrame(e.worldPos, zoom).kind === 'inside') {
      // Clicked inside the frame but not on any level geometry — start move
      this.startMove(e.worldPos, store);
    } else {
      // Empty space outside the frame — start rubber-band
      if (!e.shiftKey) {
        store.clearSelection();
      }
      this.state = 'rubber-band';
      this.dragStart = e.worldPos;
      this.dragCurrent = e.worldPos;
    }
  }

  onPointerMove(e: CanvasPointerEvent) {
    const store = this.getStore();

    if (this.state === 'moving') {
      const dx = e.worldPos.x - this.moveStartWorld.x;
      const dy = e.worldPos.y - this.moveStartWorld.y;

      if (this.moveOriginals.vertices.length > 0) {
        store.moveVertices(
          this.moveOriginals.vertices.map((v) => ({
            polyIdx: v.polyIdx,
            vertIdx: v.vertIdx,
            newPos: { x: v.pos.x + dx, y: v.pos.y + dy },
          })),
        );
      }
      if (this.moveOriginals.objects.length > 0) {
        store.moveObjects(
          this.moveOriginals.objects.map((o) => ({
            objIdx: o.objIdx,
            newPos: { x: o.pos.x + dx, y: o.pos.y + dy },
          })),
        );
      }
      if (this.moveOriginals.pictures.length > 0) {
        store.movePictures(
          this.moveOriginals.pictures.map((p) => ({
            picIdx: p.picIdx,
            newPos: { x: p.pos.x + dx, y: p.pos.y + dy },
          })),
        );
      }
    } else if (this.state === 'resizing') {
      this.applyResize(e.worldPos, store);
    } else if (this.state === 'rotating') {
      this.applyRotation(e.worldPos, store);
    } else if (this.state === 'rubber-band') {
      this.dragCurrent = e.worldPos;
    } else if (this.state === 'idle' && store.level) {
      // Recompute frame
      this.frame = this.computeFrame(store);

      // Check frame handles first
      if (this.frame) {
        const frameHit = this.hitTestFrame(e.worldPos, store.viewport.zoom);
        this.hoveredFrameHit = frameHit;
        // Only block level hover for actual handles (resize/rotate),
        // NOT for 'inside' — so that inner polygons can still be hovered
        if (frameHit.kind === 'resize' || frameHit.kind === 'rotate') {
          this.hoveredHit = { kind: 'none' };
          return;
        }
      } else {
        this.hoveredFrameHit = { kind: 'none' };
      }

      // Normal level hover tracking
      const captureRadius = 10 / store.viewport.zoom;
      const vis = { showGrass: store.showGrass, showObjects: store.showObjects, showPictures: store.showPictures, showTextures: store.showTextures };
      this.hoveredHit = hitTest(
        e.worldPos,
        store.level.polygons,
        store.level.objects,
        captureRadius,
        store.level.pictures,
        vis,
      );

      // If hovering over an unselected element inside the frame,
      // clear the 'inside' frame hit so the cursor shows 'pointer' not 'move'
      if (this.hoveredHit.kind !== 'none' && !this.isHoverSelected(store)) {
        this.hoveredFrameHit = { kind: 'none' };
      }
    }
  }

  onPointerUp(e: CanvasPointerEvent) {
    if (e.button !== 0) return;

    if (this.state === 'moving' || this.state === 'resizing' || this.state === 'rotating') {
      this.getStore().endUndoBatch();
    } else if (this.state === 'rubber-band') {
      this.commitRubberBand();
    }
    // All active states (moving, resizing, rotating, rubber-band) return to idle
    this.state = 'idle';
  }

  // ── Keyboard Events ────────────────────────────────────────────────────────

  onKeyDown(e: KeyboardEvent) {
    if (e.key === 'Delete' || e.key === 'Backspace') {
      this.deleteSelected();
    } else if (e.key === 'm' || e.key === 'M') {
      const store = this.getStore();
      if (store.selection.polygonIndices.size >= 1) {
        store.mergeSelectedPolygons();
      }
    } else if (e.key === 'x' || e.key === 'X') {
      const store = this.getStore();
      const size = store.selection.polygonIndices.size;
      if (size >= 1 && size <= 2) {
        store.splitSelectedPolygons();
      }
    } else if (
      e.key === 'ArrowUp' ||
      e.key === 'ArrowDown' ||
      e.key === 'ArrowLeft' ||
      e.key === 'ArrowRight'
    ) {
      e.preventDefault();
      this.nudgeSelection(e.key, e.shiftKey);
    }
  }

  onKeyUp() {}

  // ── Rendering ──────────────────────────────────────────────────────────────

  renderOverlay(ctx: CanvasRenderingContext2D) {
    const store = this.getStore();
    const zoom = store.viewport.zoom;

    // Hover highlight when idle
    if (this.state === 'idle') {
      this.renderHoverHighlight(ctx, store, zoom);
    }

    // Rubber-band rectangle
    if (this.state === 'rubber-band') {
      const x = Math.min(this.dragStart.x, this.dragCurrent.x);
      const y = Math.min(this.dragStart.y, this.dragCurrent.y);
      const w = Math.abs(this.dragCurrent.x - this.dragStart.x);
      const h = Math.abs(this.dragCurrent.y - this.dragStart.y);

      const t = getTheme();
      ctx.strokeStyle = t.toolPrimary;
      ctx.fillStyle = withAlpha(t.toolPrimary, 0.1);
      ctx.lineWidth = 1 / zoom;
      ctx.fillRect(x, y, w, h);
      ctx.strokeRect(x, y, w, h);
    }

    // Transform frame
    this.renderTransformFrame(ctx, store, zoom);
  }

  // ── Cursor ─────────────────────────────────────────────────────────────────

  getCursor() {
    if (this.state === 'moving') return 'move';
    if (this.state === 'resizing') return this.getResizeCursor(this.resizeHandle!);
    if (this.state === 'rotating') return 'grabbing';

    if (this.state === 'idle') {
      // Frame handle hover takes priority
      if (this.hoveredFrameHit.kind === 'resize') {
        return this.getResizeCursor(this.hoveredFrameHit.handle);
      }
      if (this.hoveredFrameHit.kind === 'rotate') {
        return 'grab';
      }
      if (this.hoveredFrameHit.kind === 'inside') {
        return 'move';
      }
      // Level hover
      if (this.hoveredHit.kind !== 'none') {
        return this.isHoverSelected(this.getStore()) ? 'move' : 'pointer';
      }
    }
    return 'default';
  }

  // ── Private: Transform Frame ───────────────────────────────────────────────

  private computeFrame(store: EditorState): TransformFrame | null {
    const level = store.level;
    if (!level) return null;
    const sel = store.selection;

    const points: Vec2[] = [];

    for (const [pi, vertSet] of sel.vertexIndices) {
      const poly = level.polygons[pi];
      if (!poly) continue;
      for (const vi of vertSet) {
        const v = poly.vertices[vi];
        if (v) points.push({ x: v.x, y: v.y });
      }
    }

    for (const oi of sel.objectIndices) {
      const obj = level.objects[oi];
      if (obj) points.push({ x: obj.position.x, y: obj.position.y });
    }

    for (const pi of sel.pictureIndices) {
      const pic = level.pictures[pi];
      if (pic) points.push({ x: pic.position.x, y: pic.position.y });
    }

    if (points.length < 2) return null;

    const bbox = computeBBox(points);
    const w = bbox.maxX - bbox.minX;
    const h = bbox.maxY - bbox.minY;

    // Degenerate: all points coincident
    if (w < 1e-6 && h < 1e-6) return null;

    return {
      ...bbox,
      cx: (bbox.minX + bbox.maxX) / 2,
      cy: (bbox.minY + bbox.maxY) / 2,
    };
  }

  private hitTestFrame(worldPos: Vec2, zoom: number): FrameHandleHit {
    if (!this.frame) return { kind: 'none' };
    const f = this.frame;
    const hr = 8 / zoom;

    // Rotation handle: 20px above top-center
    const rotOffset = 20 / zoom;
    const rotPos = { x: f.cx, y: f.minY - rotOffset };
    if (distance(worldPos, rotPos) <= hr) {
      return { kind: 'rotate' };
    }

    // 8 resize handles
    const handles = this.getHandlePositions(f);
    for (const h of handles) {
      if (distance(worldPos, h.pos) <= hr) {
        return { kind: 'resize', handle: h.id };
      }
    }

    // Inside frame bounding area (with a small tolerance)
    const tol = hr * 0.5;
    if (
      worldPos.x >= f.minX - tol && worldPos.x <= f.maxX + tol &&
      worldPos.y >= f.minY - tol && worldPos.y <= f.maxY + tol
    ) {
      return { kind: 'inside' };
    }

    return { kind: 'none' };
  }

  private getHandlePositions(
    f: TransformFrame,
  ): Array<{ id: ResizeHandleId; pos: Vec2 }> {
    return [
      { id: 'nw', pos: { x: f.minX, y: f.minY } },
      { id: 'n', pos: { x: f.cx, y: f.minY } },
      { id: 'ne', pos: { x: f.maxX, y: f.minY } },
      { id: 'w', pos: { x: f.minX, y: f.cy } },
      { id: 'e', pos: { x: f.maxX, y: f.cy } },
      { id: 'sw', pos: { x: f.minX, y: f.maxY } },
      { id: 's', pos: { x: f.cx, y: f.maxY } },
      { id: 'se', pos: { x: f.maxX, y: f.maxY } },
    ];
  }

  private getResizeAnchor(handle: ResizeHandleId): Vec2 {
    const f = this.frame!;
    const map: Record<ResizeHandleId, Vec2> = {
      nw: { x: f.maxX, y: f.maxY },
      n: { x: f.cx, y: f.maxY },
      ne: { x: f.minX, y: f.maxY },
      w: { x: f.maxX, y: f.cy },
      e: { x: f.minX, y: f.cy },
      sw: { x: f.maxX, y: f.minY },
      s: { x: f.cx, y: f.minY },
      se: { x: f.minX, y: f.minY },
    };
    return map[handle];
  }

  private getResizeCursor(handle: ResizeHandleId): string {
    const map: Record<ResizeHandleId, string> = {
      nw: 'nwse-resize',
      se: 'nwse-resize',
      ne: 'nesw-resize',
      sw: 'nesw-resize',
      n: 'ns-resize',
      s: 'ns-resize',
      e: 'ew-resize',
      w: 'ew-resize',
    };
    return map[handle];
  }

  // ── Private: Resize Logic ──────────────────────────────────────────────────

  private applyResize(currentWorld: Vec2, store: EditorState) {
    const handle = this.resizeHandle!;
    const anchor = this.resizeAnchor;
    const startW = this.resizeStartWorld;

    const isHorizontalOnly = handle === 'w' || handle === 'e';
    const isVerticalOnly = handle === 'n' || handle === 's';

    let sx = 1;
    let sy = 1;

    if (!isVerticalOnly) {
      const origDx = startW.x - anchor.x;
      const currDx = currentWorld.x - anchor.x;
      sx = Math.abs(origDx) > 1e-6 ? currDx / origDx : 1;
    }

    if (!isHorizontalOnly) {
      const origDy = startW.y - anchor.y;
      const currDy = currentWorld.y - anchor.y;
      sy = Math.abs(origDy) > 1e-6 ? currDy / origDy : 1;
    }

    // Apply scale to all original positions
    if (this.moveOriginals.vertices.length > 0) {
      store.moveVertices(
        this.moveOriginals.vertices.map((v) => ({
          polyIdx: v.polyIdx,
          vertIdx: v.vertIdx,
          newPos: scalePoint(v.pos, anchor, sx, sy),
        })),
      );
    }
    if (this.moveOriginals.objects.length > 0) {
      store.moveObjects(
        this.moveOriginals.objects.map((o) => ({
          objIdx: o.objIdx,
          newPos: scalePoint(o.pos, anchor, sx, sy),
        })),
      );
    }
    if (this.moveOriginals.pictures.length > 0) {
      store.movePictures(
        this.moveOriginals.pictures.map((p) => ({
          picIdx: p.picIdx,
          newPos: scalePoint(p.pos, anchor, sx, sy),
        })),
      );
    }
  }

  // ── Private: Rotation Logic ────────────────────────────────────────────────

  private applyRotation(currentWorld: Vec2, store: EditorState) {
    const angle = angleBetween(
      this.rotationStartPos,
      currentWorld,
      this.rotationCenter,
    );

    if (this.moveOriginals.vertices.length > 0) {
      store.moveVertices(
        this.moveOriginals.vertices.map((v) => ({
          polyIdx: v.polyIdx,
          vertIdx: v.vertIdx,
          newPos: rotatePoint(v.pos, this.rotationCenter, angle),
        })),
      );
    }
    if (this.moveOriginals.objects.length > 0) {
      store.moveObjects(
        this.moveOriginals.objects.map((o) => ({
          objIdx: o.objIdx,
          newPos: rotatePoint(o.pos, this.rotationCenter, angle),
        })),
      );
    }
    if (this.moveOriginals.pictures.length > 0) {
      store.movePictures(
        this.moveOriginals.pictures.map((p) => ({
          picIdx: p.picIdx,
          newPos: rotatePoint(p.pos, this.rotationCenter, angle),
        })),
      );
    }
  }

  // ── Private: Frame Rendering ───────────────────────────────────────────────

  private renderTransformFrame(
    ctx: CanvasRenderingContext2D,
    store: EditorState,
    zoom: number,
  ) {
    // Recompute frame from current (live) positions
    const frame = this.computeFrame(store);
    if (!frame) return;

    // Update stored frame during idle
    if (this.state === 'idle') {
      this.frame = frame;
    }

    const f = frame;
    const handleSize = 8 / zoom;
    const halfHandle = handleSize / 2;

    const t = getTheme();

    // 1. Dashed bounding box
    ctx.strokeStyle = withAlpha(t.toolPrimary, 0.6);
    ctx.lineWidth = 1.5 / zoom;
    ctx.setLineDash([6 / zoom, 3 / zoom]);
    ctx.strokeRect(f.minX, f.minY, f.maxX - f.minX, f.maxY - f.minY);
    ctx.setLineDash([]);

    // 2. Resize handles
    const handles = this.getHandlePositions(f);
    for (const h of handles) {
      const isHovered =
        this.hoveredFrameHit.kind === 'resize' &&
        this.hoveredFrameHit.handle === h.id;

      ctx.fillStyle = isHovered ? t.handle : withAlpha(t.handle, 0.88);
      ctx.strokeStyle = t.toolPrimary;
      ctx.lineWidth = 1.5 / zoom;
      ctx.fillRect(h.pos.x - halfHandle, h.pos.y - halfHandle, handleSize, handleSize);
      ctx.strokeRect(h.pos.x - halfHandle, h.pos.y - halfHandle, handleSize, handleSize);
    }

    // 3. Rotation handle: circle above top-center, connected by stem line
    const rotOffset = 20 / zoom;
    const rotY = f.minY - rotOffset;
    const rotRadius = 5 / zoom;
    const isRotHovered = this.hoveredFrameHit.kind === 'rotate';

    // Stem line
    ctx.strokeStyle = withAlpha(t.toolPrimary, 0.5);
    ctx.lineWidth = 1 / zoom;
    ctx.beginPath();
    ctx.moveTo(f.cx, f.minY);
    ctx.lineTo(f.cx, rotY);
    ctx.stroke();

    // Rotation circle
    ctx.beginPath();
    ctx.arc(f.cx, rotY, rotRadius, 0, Math.PI * 2);
    ctx.fillStyle = isRotHovered ? t.handle : withAlpha(t.handle, 0.88);
    ctx.fill();
    ctx.strokeStyle = t.toolPrimary;
    ctx.lineWidth = 1.5 / zoom;
    ctx.stroke();

    // Small rotation icon inside the circle (↻ arc arrow)
    const iconR = rotRadius * 0.55;
    ctx.strokeStyle = t.toolPrimary;
    ctx.lineWidth = 1 / zoom;
    ctx.beginPath();
    ctx.arc(f.cx, rotY, iconR, -Math.PI * 0.8, Math.PI * 0.5);
    ctx.stroke();
    // Arrow head
    const arrowTip = {
      x: f.cx + iconR * Math.cos(Math.PI * 0.5),
      y: rotY + iconR * Math.sin(Math.PI * 0.5),
    };
    const arrowSize = 2.5 / zoom;
    ctx.beginPath();
    ctx.moveTo(arrowTip.x - arrowSize, arrowTip.y - arrowSize);
    ctx.lineTo(arrowTip.x, arrowTip.y);
    ctx.lineTo(arrowTip.x + arrowSize, arrowTip.y - arrowSize);
    ctx.stroke();
  }

  // ── Private: Hover Highlight ───────────────────────────────────────────────

  /** Check whether the hovered element is part of the current selection. */
  private isHoverSelected(store: EditorState): boolean {
    const hit = this.hoveredHit;
    if (hit.kind === 'object') {
      return store.selection.objectIndices.has(hit.objectIndex);
    }
    if (hit.kind === 'picture') {
      return store.selection.pictureIndices.has(hit.pictureIndex);
    }
    if (hit.kind === 'polygon' || hit.kind === 'edge' || hit.kind === 'vertex') {
      return store.selection.polygonIndices.has(hit.polygonIndex);
    }
    return false;
  }

  private renderHoverHighlight(
    ctx: CanvasRenderingContext2D,
    store: EditorState,
    zoom: number,
  ) {
    const hit = this.hoveredHit;
    if (hit.kind === 'none' || !store.level) return;

    const t = getTheme();
    const isSelected = this.isHoverSelected(store);

    if (hit.kind === 'polygon' || hit.kind === 'edge' || hit.kind === 'vertex') {
      // Select tool works with whole polygons — all geometry hits highlight the polygon
      const poly = store.level.polygons[hit.polygonIndex];
      if (!poly || poly.vertices.length < 2) return;

      ctx.beginPath();
      ctx.moveTo(poly.vertices[0]!.x, poly.vertices[0]!.y);
      for (let i = 1; i < poly.vertices.length; i++) {
        ctx.lineTo(poly.vertices[i]!.x, poly.vertices[i]!.y);
      }
      ctx.closePath();

      if (isSelected) {
        ctx.fillStyle = withAlpha(t.selection, 0.06);
        ctx.fill();
        ctx.strokeStyle = withAlpha(t.selection, 0.8);
        ctx.lineWidth = 2.5 / zoom;
        ctx.stroke();
      } else {
        ctx.fillStyle = withAlpha(t.handle, 0.06);
        ctx.fill();
        ctx.setLineDash([6 / zoom, 4 / zoom]);
        ctx.strokeStyle = withAlpha(t.selection, 0.5);
        ctx.lineWidth = 1.5 / zoom;
        ctx.stroke();
        ctx.setLineDash([]);
      }
    } else if (hit.kind === 'object') {
      ctx.beginPath();
      ctx.arc(hit.position.x, hit.position.y, OBJECT_RADIUS + 0.08, 0, Math.PI * 2);

      if (isSelected) {
        ctx.strokeStyle = withAlpha(t.selection, 0.8);
        ctx.lineWidth = 2 / zoom;
      } else {
        ctx.setLineDash([4 / zoom, 3 / zoom]);
        ctx.strokeStyle = withAlpha(t.selection, 0.5);
        ctx.lineWidth = 1.5 / zoom;
      }
      ctx.stroke();
      ctx.setLineDash([]);
    } else if (hit.kind === 'picture') {
      const pic = store.level!.pictures[hit.pictureIndex];
      if (pic) {
        const lgrAssets = getEditorLgr();
        const picData = (pic.texture && pic.mask)
          ? lgrAssets?.masks.get(pic.mask)
          : lgrAssets?.pictures.get(pic.name);
        const w = picData ? picData.worldW : 0.6;
        const h = picData ? picData.worldH : 0.6;

        if (isSelected) {
          ctx.strokeStyle = withAlpha(t.selection, 0.8);
          ctx.lineWidth = 2 / zoom;
        } else {
          ctx.setLineDash([4 / zoom, 3 / zoom]);
          ctx.strokeStyle = withAlpha(t.selection, 0.5);
          ctx.lineWidth = 1.5 / zoom;
        }
        ctx.strokeRect(pic.position.x, pic.position.y, w, h);
        ctx.setLineDash([]);
      }
    }
  }

  // ── Private: Selection Helpers ─────────────────────────────────────────────

  private selectObject(
    objIdx: number,
    additive: boolean,
    store: EditorState,
  ) {
    const sel = additive ? this.cloneSelection(store.selection) : this.emptySelection();
    sel.objectIndices.add(objIdx);
    store.setSelection(sel);
  }

  private selectPolygon(
    polyIdx: number,
    additive: boolean,
    store: EditorState,
  ) {
    const sel = additive ? this.cloneSelection(store.selection) : this.emptySelection();
    sel.polygonIndices.add(polyIdx);
    const poly = store.level?.polygons[polyIdx];
    if (poly) {
      sel.vertexIndices.set(polyIdx, new Set(poly.vertices.map((_, i) => i)));
    }
    store.setSelection(sel);
  }

  private deselectPolygon(polyIdx: number, store: EditorState) {
    const sel = this.cloneSelection(store.selection);
    sel.polygonIndices.delete(polyIdx);
    sel.vertexIndices.delete(polyIdx);
    store.setSelection(sel);
  }

  private deselectObject(objIdx: number, store: EditorState) {
    const sel = this.cloneSelection(store.selection);
    sel.objectIndices.delete(objIdx);
    store.setSelection(sel);
  }

  private selectPicture(picIdx: number, additive: boolean, store: EditorState) {
    const sel = additive ? this.cloneSelection(store.selection) : this.emptySelection();
    sel.pictureIndices.add(picIdx);
    store.setSelection(sel);
  }

  private deselectPicture(picIdx: number, store: EditorState) {
    const sel = this.cloneSelection(store.selection);
    sel.pictureIndices.delete(picIdx);
    store.setSelection(sel);
  }

  // ── Private: Move/Transform Helpers ────────────────────────────────────────

  private snapshotOriginals(store: EditorState) {
    const level = store.level!;
    const sel = store.selection;

    const vertices: Array<{ polyIdx: number; vertIdx: number; pos: Vec2 }> = [];
    for (const [pi, vertSet] of sel.vertexIndices) {
      const poly = level.polygons[pi];
      if (!poly) continue;
      for (const vi of vertSet) {
        const v = poly.vertices[vi];
        if (v) vertices.push({ polyIdx: pi, vertIdx: vi, pos: { x: v.x, y: v.y } });
      }
    }

    const objects: Array<{ objIdx: number; pos: Vec2 }> = [];
    for (const oi of sel.objectIndices) {
      const obj = level.objects[oi];
      if (obj) objects.push({ objIdx: oi, pos: { x: obj.position.x, y: obj.position.y } });
    }

    const pictures: Array<{ picIdx: number; pos: Vec2 }> = [];
    for (const pi of sel.pictureIndices) {
      const pic = level.pictures[pi];
      if (pic) pictures.push({ picIdx: pi, pos: { x: pic.position.x, y: pic.position.y } });
    }

    this.moveOriginals = { vertices, objects, pictures };
  }

  private startMove(worldPos: Vec2, store: EditorState) {
    store.beginUndoBatch();
    this.state = 'moving';
    this.moveStartWorld = worldPos;
    this.snapshotOriginals(store);
  }

  private commitRubberBand() {
    const store = this.getStore();
    if (!store.level) return;

    const minX = Math.min(this.dragStart.x, this.dragCurrent.x);
    const maxX = Math.max(this.dragStart.x, this.dragCurrent.x);
    const minY = Math.min(this.dragStart.y, this.dragCurrent.y);
    const maxY = Math.max(this.dragStart.y, this.dragCurrent.y);

    const sel = this.emptySelection();

    // Select whole polygons that have ALL vertices inside the rubber-band
    for (let pi = 0; pi < store.level.polygons.length; pi++) {
      if (!store.showGrass && store.level.polygons[pi]!.grass) continue;
      const verts = store.level.polygons[pi]!.vertices;
      const allInside = verts.every(
        (v) => v.x >= minX && v.x <= maxX && v.y >= minY && v.y <= maxY,
      );
      if (allInside) {
        sel.polygonIndices.add(pi);
        sel.vertexIndices.set(pi, new Set(verts.map((_, i) => i)));
      }
    }

    if (store.showObjects) {
      for (let oi = 0; oi < store.level.objects.length; oi++) {
        const pos = store.level.objects[oi]!.position;
        if (pos.x >= minX && pos.x <= maxX && pos.y >= minY && pos.y <= maxY) {
          sel.objectIndices.add(oi);
        }
      }
    }

    for (let pi = 0; pi < store.level.pictures.length; pi++) {
      const pic = store.level.pictures[pi]!;
      const isTextureMask = !!(pic.texture && pic.mask);
      if (isTextureMask && !store.showTextures) continue;
      if (!isTextureMask && !store.showPictures) continue;
      const pos = pic.position;
      if (pos.x >= minX && pos.x <= maxX && pos.y >= minY && pos.y <= maxY) {
        sel.pictureIndices.add(pi);
      }
    }

    store.setSelection(sel);
  }

  private nudgeSelection(key: string, shift: boolean) {
    const store = this.getStore();
    if (!store.level) return;
    const sel = store.selection;

    const MAJOR_EVERY = 5;
    const step = shift ? store.grid.size * MAJOR_EVERY : store.grid.size;

    let dx = 0;
    let dy = 0;
    if (key === 'ArrowLeft') dx = -step;
    else if (key === 'ArrowRight') dx = step;
    else if (key === 'ArrowUp') dy = -step;
    else if (key === 'ArrowDown') dy = step;

    const vertMoves: Array<{ polyIdx: number; vertIdx: number; newPos: Vec2 }> = [];
    for (const [pi, vertSet] of sel.vertexIndices) {
      const poly = store.level.polygons[pi];
      if (!poly) continue;
      for (const vi of vertSet) {
        const v = poly.vertices[vi];
        if (v) vertMoves.push({ polyIdx: pi, vertIdx: vi, newPos: { x: v.x + dx, y: v.y + dy } });
      }
    }

    const objMoves: Array<{ objIdx: number; newPos: Vec2 }> = [];
    for (const oi of sel.objectIndices) {
      const obj = store.level.objects[oi];
      if (obj) objMoves.push({ objIdx: oi, newPos: { x: obj.position.x + dx, y: obj.position.y + dy } });
    }

    const picMoves: Array<{ picIdx: number; newPos: Vec2 }> = [];
    for (const pi of sel.pictureIndices) {
      const pic = store.level.pictures[pi];
      if (pic) picMoves.push({ picIdx: pi, newPos: { x: pic.position.x + dx, y: pic.position.y + dy } });
    }

    if (vertMoves.length > 0) store.moveVertices(vertMoves);
    if (objMoves.length > 0) store.moveObjects(objMoves);
    if (picMoves.length > 0) store.movePictures(picMoves);
  }

  private deleteSelected() {
    const store = this.getStore();
    if (!store.level) return;
    const sel = store.selection;

    if (sel.pictureIndices.size > 0) {
      store.removePictures([...sel.pictureIndices]);
    }
    if (sel.objectIndices.size > 0) {
      store.removeObjects([...sel.objectIndices]);
    }
    if (sel.polygonIndices.size > 0) {
      store.removePolygons([...sel.polygonIndices]);
    }
  }

  private emptySelection(): SelectionState {
    return {
      polygonIndices: new Set(),
      vertexIndices: new Map(),
      objectIndices: new Set(),
      pictureIndices: new Set(),
    };
  }

  private cloneSelection(sel: SelectionState): SelectionState {
    return {
      polygonIndices: new Set(sel.polygonIndices),
      vertexIndices: new Map(
        [...sel.vertexIndices].map(([k, v]) => [k, new Set(v)]),
      ),
      objectIndices: new Set(sel.objectIndices),
      pictureIndices: new Set(sel.pictureIndices),
    };
  }
}
