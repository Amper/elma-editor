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
  distanceToSegment,
  pointInPolygon,
  rotatePoint,
  scalePoint,
  angleBetween,
} from '@/utils/geometry';
import { snapToGrid } from '@/utils/snap';
import { OBJECT_RADIUS } from 'elmajs';
import { getTheme, withAlpha } from '@/canvas/themeColors';
import { getEditorLgr } from '@/canvas/lgrCache';

type SelectState = 'idle' | 'moving' | 'rubber-band' | 'resizing' | 'rotating' | 'vertex-editing';

export class SelectTool implements EditorTool {
  private state: SelectState = 'idle';

  // ── Drag / rubber-band ──
  private dragStart: Vec2 = { x: 0, y: 0 };
  private dragCurrent: Vec2 = { x: 0, y: 0 };

  // ── Move ──
  private moveStartWorld: Vec2 = { x: 0, y: 0 };
  private moveOriginals: {
    vertices: Array<{ polyId: string; vertIdx: number; pos: Vec2 }>;
    objects: Array<{ objectId: string; pos: Vec2 }>;
    pictures: Array<{ pictureId: string; pos: Vec2 }>;
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

  // ── Double-click detection ──
  private lastClickTime: number = 0;
  private lastClickPos: Vec2 = { x: 0, y: 0 };

  // ── Vertex editing sub-mode ──
  private vePolyId: string = '';
  private veSelected: Set<number> = new Set();
  private veHover: HitTestResult = { kind: 'none' };
  private veMoving: boolean = false;
  private veMoveStart: Vec2 = { x: 0, y: 0 };
  private veMoveOriginals: Array<{ vertIdx: number; pos: Vec2 }> = [];

  constructor(private getStore: () => EditorState) {}

  activate() {
    this.state = 'idle';
    this.hoveredHit = { kind: 'none' };
    this.hoveredFrameHit = { kind: 'none' };
    this.frame = null;
    this.vePolyId = '';
    this.veSelected = new Set();
    this.veHover = { kind: 'none' };
    this.veMoving = false;
    const store = this.getStore();
    store.setSelectVertexEditing(false);
    store.setToggleSelectVertexEditing(() => this.handleToggleVertexEditing());
  }

  deactivate() {
    if (this.state === 'moving' || this.state === 'resizing' || this.state === 'rotating') {
      this.getStore().endUndoBatch();
    }
    if (this.state === 'vertex-editing' && this.veMoving) {
      this.getStore().endUndoBatch();
    }
    this.state = 'idle';
    this.hoveredHit = { kind: 'none' };
    this.hoveredFrameHit = { kind: 'none' };
    this.frame = null;
    this.vePolyId = '';
    this.veSelected = new Set();
    this.veMoving = false;
    const store = this.getStore();
    store.setSelectVertexEditing(false);
    store.setToggleSelectVertexEditing(null);
  }

  // ── Pointer Events ─────────────────────────────────────────────────────────

  onPointerDown(e: CanvasPointerEvent) {
    if (e.button !== 0) return;
    const store = this.getStore();
    if (!store.level) return;

    // ── Double-click detection ──
    const now = performance.now();
    const isDoubleClick =
      now - this.lastClickTime < 400 &&
      distance(e.screenPos, this.lastClickPos) < 5;
    this.lastClickTime = now;
    this.lastClickPos = e.screenPos;

    const zoom = store.viewport.zoom;

    // ── Vertex editing sub-mode ──
    if (this.state === 'vertex-editing') {
      this.onPointerDownVertexEdit(e, store, isDoubleClick);
      return;
    }

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

    // Double-click on polygon → enter vertex editing
    if (isDoubleClick && (hit.kind === 'vertex' || hit.kind === 'edge' || hit.kind === 'polygon')) {
      this.enterVertexEditing(hit.polygonIndex, store);
      return;
    }

    if (hit.kind === 'vertex' || hit.kind === 'edge') {
      // Select tool works with whole polygons — treat vertex/edge hits as polygon hits
      const isAlreadySelected = store.selection.polygonIds.has(hit.polygonId);
      if (isAlreadySelected && e.shiftKey) {
        this.deselectPolygon(hit.polygonId, store);
      } else if (isAlreadySelected) {
        this.startMove(e.worldPos, store);
      } else {
        this.selectPolygon(hit.polygonId, hit.polygonIndex, e.shiftKey, store);
        this.startMove(e.worldPos, this.getStore());
      }
    } else if (hit.kind === 'object') {
      const isAlreadySelected = store.selection.objectIds.has(hit.objectId);
      if (isAlreadySelected && e.shiftKey) {
        this.deselectObject(hit.objectId, store);
      } else if (isAlreadySelected) {
        this.startMove(e.worldPos, store);
      } else {
        this.selectObject(hit.objectId, e.shiftKey, store);
        this.startMove(e.worldPos, this.getStore());
      }
    } else if (hit.kind === 'picture') {
      const isAlreadySelected = store.selection.pictureIds.has(hit.pictureId);
      if (isAlreadySelected && e.shiftKey) {
        this.deselectPicture(hit.pictureId, store);
      } else if (isAlreadySelected) {
        this.startMove(e.worldPos, store);
      } else {
        this.selectPicture(hit.pictureId, e.shiftKey, store);
        this.startMove(e.worldPos, this.getStore());
      }
    } else if (hit.kind === 'polygon') {
      const isAlreadySelected = store.selection.polygonIds.has(hit.polygonId);
      if (isAlreadySelected && e.shiftKey) {
        this.deselectPolygon(hit.polygonId, store);
      } else if (isAlreadySelected) {
        this.startMove(e.worldPos, store);
      } else {
        this.selectPolygon(hit.polygonId, hit.polygonIndex, e.shiftKey, store);
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

    if (this.state === 'vertex-editing') {
      this.onPointerMoveVertexEdit(e, store);
      return;
    }

    if (this.state === 'moving') {
      const dx = e.worldPos.x - this.moveStartWorld.x;
      const dy = e.worldPos.y - this.moveStartWorld.y;

      if (this.moveOriginals.vertices.length > 0) {
        store.moveVertices(
          this.moveOriginals.vertices.map((v) => ({
            polyId: v.polyId,
            vertIdx: v.vertIdx,
            newPos: { x: v.pos.x + dx, y: v.pos.y + dy },
          })),
        );
      }
      if (this.moveOriginals.objects.length > 0) {
        store.moveObjects(
          this.moveOriginals.objects.map((o) => ({
            objectId: o.objectId,
            newPos: { x: o.pos.x + dx, y: o.pos.y + dy },
          })),
        );
      }
      if (this.moveOriginals.pictures.length > 0) {
        store.movePictures(
          this.moveOriginals.pictures.map((p) => ({
            pictureId: p.pictureId,
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

    if (this.state === 'vertex-editing') {
      if (this.veMoving) {
        this.getStore().endUndoBatch();
        this.veMoving = false;
      }
      return;
    }

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
    if (this.state === 'vertex-editing') {
      if (e.key === 'Escape') {
        this.exitVertexEditing();
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        this.deleteVertexEditVertices();
      } else if (
        e.key === 'ArrowUp' ||
        e.key === 'ArrowDown' ||
        e.key === 'ArrowLeft' ||
        e.key === 'ArrowRight'
      ) {
        e.preventDefault();
        this.nudgeVertexEditSelection(e.key, e.shiftKey);
      }
      return;
    }

    if (e.key === 'Delete' || e.key === 'Backspace') {
      this.deleteSelected();
    } else if (e.key === 'm' || e.key === 'M') {
      const store = this.getStore();
      if (store.selection.polygonIds.size >= 1) {
        store.mergeSelectedPolygons();
      }
    } else if (e.key === 'x' || e.key === 'X') {
      const store = this.getStore();
      const size = store.selection.polygonIds.size;
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

    if (this.state === 'vertex-editing') {
      this.renderVertexEditingOverlay(ctx, store, zoom);
      return;
    }

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
    if (this.state === 'vertex-editing') {
      if (this.veMoving) return 'move';
      if (this.veHover.kind === 'vertex') {
        return this.veSelected.has(this.veHover.vertexIndex) ? 'move' : 'pointer';
      }
      if (this.veHover.kind === 'edge') return 'pointer';
      return 'default';
    }

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

    for (const [polyId, vertSet] of sel.vertexSelections) {
      const poly = level.polygons.find((p) => p.id === polyId);
      if (!poly) continue;
      for (const vi of vertSet) {
        const v = poly.vertices[vi];
        if (v) points.push({ x: v.x, y: v.y });
      }
    }

    for (const objId of sel.objectIds) {
      const obj = level.objects.find((o) => o.id === objId);
      if (obj) points.push({ x: obj.position.x, y: obj.position.y });
    }

    for (const picId of sel.pictureIds) {
      const pic = level.pictures.find((p) => p.id === picId);
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
          polyId: v.polyId,
          vertIdx: v.vertIdx,
          newPos: scalePoint(v.pos, anchor, sx, sy),
        })),
      );
    }
    if (this.moveOriginals.objects.length > 0) {
      store.moveObjects(
        this.moveOriginals.objects.map((o) => ({
          objectId: o.objectId,
          newPos: scalePoint(o.pos, anchor, sx, sy),
        })),
      );
    }
    if (this.moveOriginals.pictures.length > 0) {
      store.movePictures(
        this.moveOriginals.pictures.map((p) => ({
          pictureId: p.pictureId,
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
          polyId: v.polyId,
          vertIdx: v.vertIdx,
          newPos: rotatePoint(v.pos, this.rotationCenter, angle),
        })),
      );
    }
    if (this.moveOriginals.objects.length > 0) {
      store.moveObjects(
        this.moveOriginals.objects.map((o) => ({
          objectId: o.objectId,
          newPos: rotatePoint(o.pos, this.rotationCenter, angle),
        })),
      );
    }
    if (this.moveOriginals.pictures.length > 0) {
      store.movePictures(
        this.moveOriginals.pictures.map((p) => ({
          pictureId: p.pictureId,
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
      return store.selection.objectIds.has(hit.objectId);
    }
    if (hit.kind === 'picture') {
      return store.selection.pictureIds.has(hit.pictureId);
    }
    if (hit.kind === 'polygon' || hit.kind === 'edge' || hit.kind === 'vertex') {
      return store.selection.polygonIds.has(hit.polygonId);
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
    objectId: string,
    additive: boolean,
    store: EditorState,
  ) {
    const sel = additive ? this.cloneSelection(store.selection) : this.emptySelection();
    sel.objectIds.add(objectId);
    store.setSelection(sel);
  }

  private selectPolygon(
    polygonId: string,
    polygonIndex: number,
    additive: boolean,
    store: EditorState,
  ) {
    const sel = additive ? this.cloneSelection(store.selection) : this.emptySelection();
    sel.polygonIds.add(polygonId);
    const poly = store.level?.polygons[polygonIndex];
    if (poly) {
      sel.vertexSelections.set(polygonId, new Set(poly.vertices.map((_, i) => i)));
    }
    store.setSelection(sel);
  }

  private deselectPolygon(polygonId: string, store: EditorState) {
    const sel = this.cloneSelection(store.selection);
    sel.polygonIds.delete(polygonId);
    sel.vertexSelections.delete(polygonId);
    store.setSelection(sel);
  }

  private deselectObject(objectId: string, store: EditorState) {
    const sel = this.cloneSelection(store.selection);
    sel.objectIds.delete(objectId);
    store.setSelection(sel);
  }

  private selectPicture(pictureId: string, additive: boolean, store: EditorState) {
    const sel = additive ? this.cloneSelection(store.selection) : this.emptySelection();
    sel.pictureIds.add(pictureId);
    store.setSelection(sel);
  }

  private deselectPicture(pictureId: string, store: EditorState) {
    const sel = this.cloneSelection(store.selection);
    sel.pictureIds.delete(pictureId);
    store.setSelection(sel);
  }

  // ── Private: Move/Transform Helpers ────────────────────────────────────────

  private snapshotOriginals(store: EditorState) {
    const level = store.level!;
    const sel = store.selection;

    const vertices: Array<{ polyId: string; vertIdx: number; pos: Vec2 }> = [];
    for (const [polyId, vertSet] of sel.vertexSelections) {
      const poly = level.polygons.find((p) => p.id === polyId);
      if (!poly) continue;
      for (const vi of vertSet) {
        const v = poly.vertices[vi];
        if (v) vertices.push({ polyId, vertIdx: vi, pos: { x: v.x, y: v.y } });
      }
    }

    const objects: Array<{ objectId: string; pos: Vec2 }> = [];
    for (const objId of sel.objectIds) {
      const obj = level.objects.find((o) => o.id === objId);
      if (obj) objects.push({ objectId: objId, pos: { x: obj.position.x, y: obj.position.y } });
    }

    const pictures: Array<{ pictureId: string; pos: Vec2 }> = [];
    for (const picId of sel.pictureIds) {
      const pic = level.pictures.find((p) => p.id === picId);
      if (pic) pictures.push({ pictureId: picId, pos: { x: pic.position.x, y: pic.position.y } });
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
    for (const poly of store.level.polygons) {
      if (!store.showGrass && poly.grass) continue;
      const verts = poly.vertices;
      const allInside = verts.every(
        (v) => v.x >= minX && v.x <= maxX && v.y >= minY && v.y <= maxY,
      );
      if (allInside) {
        sel.polygonIds.add(poly.id);
        sel.vertexSelections.set(poly.id, new Set(verts.map((_, i) => i)));
      }
    }

    if (store.showObjects) {
      for (const obj of store.level.objects) {
        const pos = obj.position;
        if (pos.x >= minX && pos.x <= maxX && pos.y >= minY && pos.y <= maxY) {
          sel.objectIds.add(obj.id);
        }
      }
    }

    for (const pic of store.level.pictures) {
      const isTextureMask = !!(pic.texture && pic.mask);
      if (isTextureMask && !store.showTextures) continue;
      if (!isTextureMask && !store.showPictures) continue;
      const pos = pic.position;
      if (pos.x >= minX && pos.x <= maxX && pos.y >= minY && pos.y <= maxY) {
        sel.pictureIds.add(pic.id);
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

    const vertMoves: Array<{ polyId: string; vertIdx: number; newPos: Vec2 }> = [];
    for (const [polyId, vertSet] of sel.vertexSelections) {
      const poly = store.level.polygons.find((p) => p.id === polyId);
      if (!poly) continue;
      for (const vi of vertSet) {
        const v = poly.vertices[vi];
        if (v) vertMoves.push({ polyId, vertIdx: vi, newPos: { x: v.x + dx, y: v.y + dy } });
      }
    }

    const objMoves: Array<{ objectId: string; newPos: Vec2 }> = [];
    for (const objId of sel.objectIds) {
      const obj = store.level.objects.find((o) => o.id === objId);
      if (obj) objMoves.push({ objectId: objId, newPos: { x: obj.position.x + dx, y: obj.position.y + dy } });
    }

    const picMoves: Array<{ pictureId: string; newPos: Vec2 }> = [];
    for (const picId of sel.pictureIds) {
      const pic = store.level.pictures.find((p) => p.id === picId);
      if (pic) picMoves.push({ pictureId: picId, newPos: { x: pic.position.x + dx, y: pic.position.y + dy } });
    }

    if (vertMoves.length > 0) store.moveVertices(vertMoves);
    if (objMoves.length > 0) store.moveObjects(objMoves);
    if (picMoves.length > 0) store.movePictures(picMoves);
  }

  private deleteSelected() {
    const store = this.getStore();
    if (!store.level) return;
    const sel = store.selection;

    if (sel.pictureIds.size > 0) {
      store.removePictures([...sel.pictureIds]);
    }
    if (sel.objectIds.size > 0) {
      store.removeObjects([...sel.objectIds]);
    }
    if (sel.polygonIds.size > 0) {
      store.removePolygons([...sel.polygonIds]);
    }
  }

  // ── Vertex Editing Sub-Mode ──────────────────────────────────────────────

  private enterVertexEditing(polyIdx: number, store: EditorState) {
    this.state = 'vertex-editing';
    const poly = store.level?.polygons[polyIdx];
    this.vePolyId = poly?.id ?? '';
    this.veSelected = new Set();
    this.veHover = { kind: 'none' };
    this.veMoving = false;
    this.frame = null;

    // Keep polygon selected in the store
    const sel = this.emptySelection();
    if (poly) {
      sel.polygonIds.add(poly.id);
      sel.vertexSelections.set(poly.id, new Set(poly.vertices.map((_, i) => i)));
    }
    store.setSelection(sel);
    store.setSelectVertexEditing(true);
  }

  private exitVertexEditing() {
    if (this.veMoving) {
      this.getStore().endUndoBatch();
    }
    this.state = 'idle';
    this.vePolyId = '';
    this.veSelected = new Set();
    this.veHover = { kind: 'none' };
    this.veMoving = false;
    this.getStore().setSelectVertexEditing(false);
  }

  private handleToggleVertexEditing() {
    const store = this.getStore();
    if (this.state === 'vertex-editing') {
      this.exitVertexEditing();
    } else if (this.state === 'idle' && store.selection.polygonIds.size === 1) {
      const polyId = [...store.selection.polygonIds][0]!;
      const polyIdx = store.level?.polygons.findIndex((p) => p.id === polyId) ?? -1;
      if (polyIdx >= 0) {
        this.enterVertexEditing(polyIdx, store);
      }
    }
  }

  private hitTestSinglePolygon(worldPos: Vec2, captureRadius: number): HitTestResult {
    const store = this.getStore();
    if (!store.level || !this.vePolyId) return { kind: 'none' };

    const pi = store.level.polygons.findIndex((p) => p.id === this.vePolyId);
    if (pi < 0) return { kind: 'none' };
    const poly = store.level.polygons[pi]!;

    // Check vertices first (highest priority)
    let bestDist = captureRadius;
    let best: HitTestResult = { kind: 'none' };

    for (let vi = 0; vi < poly.vertices.length; vi++) {
      const v = poly.vertices[vi]!;
      const d = distance(worldPos, v);
      if (d < bestDist) {
        bestDist = d;
        best = { kind: 'vertex', polygonIndex: pi, polygonId: this.vePolyId, vertexIndex: vi, position: { x: v.x, y: v.y } };
      }
    }
    if (best.kind !== 'none') return best;

    // Check edges
    bestDist = captureRadius;
    for (let ei = 0; ei < poly.vertices.length; ei++) {
      const a = poly.vertices[ei]!;
      const b = poly.vertices[(ei + 1) % poly.vertices.length]!;
      const { dist, t } = distanceToSegment(worldPos, a, b);
      if (dist < bestDist) {
        bestDist = dist;
        best = {
          kind: 'edge',
          polygonIndex: pi,
          polygonId: this.vePolyId,
          edgeIndex: ei,
          position: { x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) },
          t,
        };
      }
    }

    return best;
  }

  private onPointerDownVertexEdit(e: CanvasPointerEvent, store: EditorState, isDoubleClick: boolean) {
    if (!store.level) return;

    const vePolyIdx = store.level.polygons.findIndex((p) => p.id === this.vePolyId);
    const poly = vePolyIdx >= 0 ? store.level.polygons[vePolyIdx] : undefined;
    if (!poly) {
      this.exitVertexEditing();
      return;
    }

    // Double-click on a different polygon → switch to editing that one
    if (isDoubleClick) {
      const captureRadius = 10 / store.viewport.zoom;
      const vis = { showGrass: store.showGrass, showObjects: store.showObjects, showPictures: store.showPictures, showTextures: store.showTextures };
      const globalHit = hitTest(e.worldPos, store.level.polygons, store.level.objects, captureRadius, store.level.pictures, vis);
      if ((globalHit.kind === 'vertex' || globalHit.kind === 'edge' || globalHit.kind === 'polygon') && globalHit.polygonId !== this.vePolyId) {
        this.enterVertexEditing(globalHit.polygonIndex, store);
        return;
      }
    }

    const captureRadius = 10 / store.viewport.zoom;
    const hit = this.hitTestSinglePolygon(e.worldPos, captureRadius);

    if (hit.kind === 'vertex') {
      const isAlreadySelected = this.veSelected.has(hit.vertexIndex);
      if (e.shiftKey) {
        if (isAlreadySelected) this.veSelected.delete(hit.vertexIndex);
        else this.veSelected.add(hit.vertexIndex);
      } else if (isAlreadySelected) {
        this.startVertexEditMove(e.worldPos, store);
      } else {
        this.veSelected = new Set([hit.vertexIndex]);
        this.startVertexEditMove(e.worldPos, store);
      }
    } else if (hit.kind === 'edge') {
      const insertIdx = hit.edgeIndex + 1;
      store.insertVertex(this.vePolyId, insertIdx, e.worldPos);
      // Shift selected indices after insertion point
      const shifted = new Set<number>();
      for (const vi of this.veSelected) {
        shifted.add(vi >= insertIdx ? vi + 1 : vi);
      }
      this.veSelected = new Set([insertIdx]);
      this.startVertexEditMove(e.worldPos, this.getStore());
    } else {
      // No vertex/edge hit — check if click is inside the polygon
      if (pointInPolygon(e.worldPos, poly.vertices)) {
        this.veSelected = new Set();
      } else {
        this.exitVertexEditing();
      }
    }
  }

  private onPointerMoveVertexEdit(e: CanvasPointerEvent, store: EditorState) {
    if (!store.level) return;

    const poly = store.level.polygons.find((p) => p.id === this.vePolyId);
    if (!poly) {
      this.exitVertexEditing();
      return;
    }

    if (this.veMoving) {
      const dx = e.worldPos.x - this.veMoveStart.x;
      const dy = e.worldPos.y - this.veMoveStart.y;

      if (this.veMoveOriginals.length > 0) {
        const first = this.veMoveOriginals[0]!;
        const rawPos = { x: first.pos.x + dx, y: first.pos.y + dy };
        const snapped = snapToGrid(rawPos, store.grid);
        const snapDx = snapped.x - first.pos.x;
        const snapDy = snapped.y - first.pos.y;

        store.moveVertices(
          this.veMoveOriginals.map((v) => ({
            polyId: this.vePolyId,
            vertIdx: v.vertIdx,
            newPos: { x: v.pos.x + snapDx, y: v.pos.y + snapDy },
          })),
        );
      }
    } else {
      const captureRadius = 10 / store.viewport.zoom;
      this.veHover = this.hitTestSinglePolygon(e.worldPos, captureRadius);
    }
  }

  private startVertexEditMove(worldPos: Vec2, store: EditorState) {
    const level = store.level!;
    const poly = level.polygons.find((p) => p.id === this.vePolyId);
    if (!poly) return;

    store.beginUndoBatch();
    this.veMoving = true;
    this.veMoveStart = worldPos;
    this.veMoveOriginals = [];
    for (const vi of this.veSelected) {
      const v = poly.vertices[vi];
      if (v) this.veMoveOriginals.push({ vertIdx: vi, pos: { x: v.x, y: v.y } });
    }
  }

  private deleteVertexEditVertices() {
    const store = this.getStore();
    if (!store.level || !this.vePolyId) return;
    if (this.veSelected.size === 0) return;

    const poly = store.level.polygons.find((p) => p.id === this.vePolyId);
    if (!poly) return;

    // Enforce 3-vertex minimum
    if (poly.vertices.length - this.veSelected.size < 3) return;

    const vertsToRemove = new Map<string, Set<number>>();
    vertsToRemove.set(this.vePolyId, new Set(this.veSelected));
    store.removeVertices(vertsToRemove);
    this.veSelected = new Set();
  }

  private nudgeVertexEditSelection(key: string, shift: boolean) {
    const store = this.getStore();
    if (!store.level || !this.vePolyId) return;

    const MAJOR_EVERY = 5;
    const step = shift ? store.grid.size * MAJOR_EVERY : store.grid.size;

    let dx = 0;
    let dy = 0;
    if (key === 'ArrowLeft') dx = -step;
    else if (key === 'ArrowRight') dx = step;
    else if (key === 'ArrowUp') dy = -step;
    else if (key === 'ArrowDown') dy = step;

    const poly = store.level.polygons.find((p) => p.id === this.vePolyId);
    if (!poly) return;

    const moves: Array<{ polyId: string; vertIdx: number; newPos: Vec2 }> = [];
    for (const vi of this.veSelected) {
      const v = poly.vertices[vi];
      if (v) moves.push({ polyId: this.vePolyId, vertIdx: vi, newPos: { x: v.x + dx, y: v.y + dy } });
    }

    if (moves.length > 0) store.moveVertices(moves);
  }

  private renderVertexEditingOverlay(
    ctx: CanvasRenderingContext2D,
    store: EditorState,
    zoom: number,
  ) {
    if (!this.vePolyId || !store.level) return;
    const poly = store.level.polygons.find((p) => p.id === this.vePolyId);
    if (!poly || poly.vertices.length < 2) return;

    const t = getTheme();
    const radius = 5 / zoom;
    const edgeDotRadius = 3 / zoom;

    // 1. Polygon outline with subtle fill
    ctx.beginPath();
    ctx.moveTo(poly.vertices[0]!.x, poly.vertices[0]!.y);
    for (let i = 1; i < poly.vertices.length; i++) {
      ctx.lineTo(poly.vertices[i]!.x, poly.vertices[i]!.y);
    }
    ctx.closePath();
    ctx.fillStyle = withAlpha(t.selection, 0.05);
    ctx.fill();
    ctx.strokeStyle = withAlpha(t.selection, 0.4);
    ctx.lineWidth = 1.5 / zoom;
    ctx.stroke();

    // 2. Unselected vertices — outlined circles
    for (let vi = 0; vi < poly.vertices.length; vi++) {
      if (this.veSelected.has(vi)) continue;
      const v = poly.vertices[vi]!;
      ctx.beginPath();
      ctx.arc(v.x, v.y, radius, 0, Math.PI * 2);
      ctx.fillStyle = withAlpha(t.handle, 0.7);
      ctx.fill();
      ctx.strokeStyle = withAlpha(t.toolVertexHover, 0.8);
      ctx.lineWidth = 1.5 / zoom;
      ctx.stroke();
    }

    // 3. Selected vertices — filled circles with thicker border
    for (const vi of this.veSelected) {
      const v = poly.vertices[vi];
      if (!v) continue;
      ctx.beginPath();
      ctx.arc(v.x, v.y, radius, 0, Math.PI * 2);
      ctx.fillStyle = t.toolVertexActive;
      ctx.fill();
      ctx.strokeStyle = t.toolPrimary;
      ctx.lineWidth = 2.5 / zoom;
      ctx.stroke();
    }

    // 4. Hover highlight (idle only)
    if (!this.veMoving) {
      if (this.veHover.kind === 'vertex') {
        const { position } = this.veHover;
        const isSelected = this.veSelected.has(this.veHover.vertexIndex);
        ctx.beginPath();
        ctx.arc(position.x, position.y, radius + 2 / zoom, 0, Math.PI * 2);
        ctx.strokeStyle = isSelected
          ? withAlpha(t.toolVertexActive, 0.8)
          : t.toolVertexHover;
        ctx.lineWidth = 2 / zoom;
        ctx.stroke();
      } else if (this.veHover.kind === 'edge') {
        const { position } = this.veHover;
        ctx.beginPath();
        ctx.arc(position.x, position.y, edgeDotRadius, 0, Math.PI * 2);
        ctx.fillStyle = withAlpha(t.toolVertexHover, 0.8);
        ctx.fill();
        ctx.strokeStyle = t.toolPrimary;
        ctx.lineWidth = 1 / zoom;
        ctx.stroke();
      }
    }
  }

  private emptySelection(): SelectionState {
    return {
      polygonIds: new Set(),
      vertexSelections: new Map(),
      objectIds: new Set(),
      pictureIds: new Set(),
    };
  }

  private cloneSelection(sel: SelectionState): SelectionState {
    return {
      polygonIds: new Set(sel.polygonIds),
      vertexSelections: new Map(
        [...sel.vertexSelections].map(([k, v]) => [k, new Set(v)]),
      ),
      objectIds: new Set(sel.objectIds),
      pictureIds: new Set(sel.pictureIds),
    };
  }
}
