import type { EditorTool, CanvasPointerEvent } from './Tool';
import type { EditorState } from '@/state/editorStore';
import type { Vec2, SelectionState, HitTestResult } from '@/types';
import { hitTest } from '@/utils/geometry';
import { snapToGrid } from '@/utils/snap';
import { getTheme, withAlpha } from '@/canvas/themeColors';

type VertexState = 'idle' | 'moving' | 'rubber-band';

export class VertexTool implements EditorTool {
  private state: VertexState = 'idle';

  // ── Rubber-band ──
  private dragStart: Vec2 = { x: 0, y: 0 };
  private dragCurrent: Vec2 = { x: 0, y: 0 };

  // ── Move ──
  private moveStartWorld: Vec2 = { x: 0, y: 0 };
  private moveOriginals: Array<{ polyId: string; vertIdx: number; pos: Vec2 }> = [];

  // ── Hover ──
  private hoveredHit: HitTestResult = { kind: 'none' };

  constructor(private getStore: () => EditorState) {}

  activate() {
    this.state = 'idle';
    this.hoveredHit = { kind: 'none' };
  }

  deactivate() {
    if (this.state === 'moving') {
      this.getStore().endUndoBatch();
    }
    this.state = 'idle';
    this.hoveredHit = { kind: 'none' };
  }

  // ── Pointer Events ──────────────────────────────────────────────────────────

  onPointerDown(e: CanvasPointerEvent) {
    if (e.button !== 0) return;
    const store = this.getStore();
    if (!store.level) return;

    const captureRadius = 10 / store.viewport.zoom;
    const vis = { showGrass: store.showGrass, showObjects: store.showObjects, showPictures: store.showPictures, showTextures: store.showTextures };
    const hit = hitTest(
      e.worldPos,
      store.level.polygons,
      store.level.objects,
      captureRadius,
      undefined,
      vis,
    );

    if (hit.kind === 'vertex') {
      const isAlreadySelected = this.isVertexSelected(
        store.selection,
        hit.polygonId,
        hit.vertexIndex,
      );

      if (e.shiftKey) {
        // Shift+click toggles individual vertex
        if (isAlreadySelected) {
          this.deselectVertex(hit.polygonId, hit.vertexIndex, store);
        } else {
          this.selectVertex(hit.polygonId, hit.vertexIndex, true, store);
        }
      } else if (isAlreadySelected) {
        // Click on already-selected vertex → start moving all selected
        this.startMove(e.worldPos, store);
      } else {
        // Click on unselected vertex → select it exclusively, start moving
        this.selectVertex(hit.polygonId, hit.vertexIndex, false, store);
        this.startMove(e.worldPos, this.getStore());
      }
    } else if (hit.kind === 'edge') {
      // Insert vertex on edge, select it, and start dragging
      const insertIdx = hit.edgeIndex + 1;
      store.insertVertex(hit.polygonId, insertIdx, e.worldPos);
      // Select the newly inserted vertex exclusively
      this.selectVertex(hit.polygonId, insertIdx, false, this.getStore());
      this.startMove(e.worldPos, this.getStore());
    } else {
      // Empty space — start rubber-band
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

      if (this.moveOriginals.length > 0) {
        // Snap the delta: compute snapped position of first vertex, derive delta
        const first = this.moveOriginals[0]!;
        const rawPos = { x: first.pos.x + dx, y: first.pos.y + dy };
        const snapped = snapToGrid(rawPos, store.grid);
        const snapDx = snapped.x - first.pos.x;
        const snapDy = snapped.y - first.pos.y;

        store.moveVertices(
          this.moveOriginals.map((v) => ({
            polyId: v.polyId,
            vertIdx: v.vertIdx,
            newPos: { x: v.pos.x + snapDx, y: v.pos.y + snapDy },
          })),
        );
      }
    } else if (this.state === 'rubber-band') {
      this.dragCurrent = e.worldPos;
    } else if (this.state === 'idle' && store.level) {
      const captureRadius = 10 / store.viewport.zoom;
      const vis = { showGrass: store.showGrass, showObjects: store.showObjects, showPictures: store.showPictures, showTextures: store.showTextures };
      this.hoveredHit = hitTest(
        e.worldPos,
        store.level.polygons,
        store.level.objects,
        captureRadius,
        undefined,
        vis,
      );
    }
  }

  onPointerUp(e: CanvasPointerEvent) {
    if (e.button !== 0) return;

    if (this.state === 'moving') {
      this.getStore().endUndoBatch();
    } else if (this.state === 'rubber-band') {
      this.commitRubberBand();
    }
    this.state = 'idle';
  }

  // ── Keyboard Events ─────────────────────────────────────────────────────────

  onKeyDown(e: KeyboardEvent) {
    if (e.key === 'Delete' || e.key === 'Backspace') {
      this.deleteSelectedVertices();
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

  // ── Rendering ───────────────────────────────────────────────────────────────

  renderOverlay(ctx: CanvasRenderingContext2D) {
    const store = this.getStore();
    const t = getTheme();
    const zoom = store.viewport.zoom;
    const size = 6 / zoom;

    // Draw all vertices as small outlined squares so they're easy to find
    if (store.level) {
      ctx.strokeStyle = withAlpha(t.toolVertexHover, 0.5);
      ctx.lineWidth = 1 / zoom;
      for (let pi = 0; pi < store.level.polygons.length; pi++) {
        const poly = store.level.polygons[pi]!;
        if (!store.showGrass && poly.grass) continue;
        for (let vi = 0; vi < poly.vertices.length; vi++) {
          if (this.isVertexSelected(store.selection, poly.id, vi)) continue;
          const v = poly.vertices[vi]!;
          ctx.strokeRect(v.x - size / 2, v.y - size / 2, size, size);
        }
      }

      // Draw selected vertices as filled squares
      for (const [polyId, vertSet] of store.selection.vertexSelections) {
        const poly = store.level.polygons.find((p) => p.id === polyId);
        if (!poly) continue;
        for (const vi of vertSet) {
          const v = poly.vertices[vi];
          if (!v) continue;
          ctx.fillStyle = t.toolVertexActive;
          ctx.fillRect(v.x - size / 2, v.y - size / 2, size, size);
        }
      }
    }

    // Hover highlight when idle
    if (this.state === 'idle') {
      if (this.hoveredHit.kind === 'vertex') {
        const { position } = this.hoveredHit;
        const isSelected = this.isVertexSelected(
          store.selection,
          this.hoveredHit.polygonId,
          this.hoveredHit.vertexIndex,
        );
        // Draw hover square (outline for unselected, brighter for selected)
        ctx.strokeStyle = isSelected
          ? withAlpha(t.toolVertexActive, 0.8)
          : t.toolVertexHover;
        ctx.lineWidth = 2 / zoom;
        ctx.strokeRect(
          position.x - size / 2,
          position.y - size / 2,
          size,
          size,
        );
      } else if (this.hoveredHit.kind === 'edge') {
        // Show insert-vertex dot on hovered edge
        const { position } = this.hoveredHit;
        ctx.fillStyle = t.toolVertexHover;
        ctx.beginPath();
        ctx.arc(position.x, position.y, 3 / zoom, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Rubber-band rectangle
    if (this.state === 'rubber-band') {
      const x = Math.min(this.dragStart.x, this.dragCurrent.x);
      const y = Math.min(this.dragStart.y, this.dragCurrent.y);
      const w = Math.abs(this.dragCurrent.x - this.dragStart.x);
      const h = Math.abs(this.dragCurrent.y - this.dragStart.y);

      ctx.strokeStyle = t.toolPrimary;
      ctx.fillStyle = withAlpha(t.toolPrimary, 0.1);
      ctx.lineWidth = 1 / zoom;
      ctx.fillRect(x, y, w, h);
      ctx.strokeRect(x, y, w, h);
    }
  }

  // ── Cursor ──────────────────────────────────────────────────────────────────

  getCursor() {
    if (this.state === 'moving') return 'move';
    if (this.hoveredHit.kind === 'vertex') {
      const store = this.getStore();
      return this.isVertexSelected(
        store.selection,
        this.hoveredHit.polygonId,
        this.hoveredHit.vertexIndex,
      )
        ? 'move'
        : 'pointer';
    }
    if (this.hoveredHit.kind === 'edge') return 'pointer';
    return 'crosshair';
  }

  // ── Private: Selection ──────────────────────────────────────────────────────

  private isVertexSelected(
    sel: SelectionState,
    polyId: string,
    vertIdx: number,
  ): boolean {
    const vertSet = sel.vertexSelections.get(polyId);
    return vertSet ? vertSet.has(vertIdx) : false;
  }

  private selectVertex(
    polyId: string,
    vertIdx: number,
    additive: boolean,
    store: EditorState,
  ) {
    const sel = additive
      ? this.cloneSelection(store.selection)
      : this.emptySelection();
    let vertSet = sel.vertexSelections.get(polyId);
    if (!vertSet) {
      vertSet = new Set();
      sel.vertexSelections.set(polyId, vertSet);
    }
    vertSet.add(vertIdx);
    // Vertex tool doesn't select whole polygons or objects
    store.setSelection(sel);
  }

  private deselectVertex(
    polyId: string,
    vertIdx: number,
    store: EditorState,
  ) {
    const sel = this.cloneSelection(store.selection);
    const vertSet = sel.vertexSelections.get(polyId);
    if (vertSet) {
      vertSet.delete(vertIdx);
      if (vertSet.size === 0) {
        sel.vertexSelections.delete(polyId);
      }
    }
    store.setSelection(sel);
  }

  // ── Private: Move ───────────────────────────────────────────────────────────

  private startMove(worldPos: Vec2, store: EditorState) {
    store.beginUndoBatch();
    this.state = 'moving';
    this.moveStartWorld = worldPos;
    this.snapshotOriginals(store);
  }

  private snapshotOriginals(store: EditorState) {
    const level = store.level!;
    const sel = store.selection;
    const originals: Array<{ polyId: string; vertIdx: number; pos: Vec2 }> = [];

    for (const [polyId, vertSet] of sel.vertexSelections) {
      const poly = level.polygons.find((p) => p.id === polyId);
      if (!poly) continue;
      for (const vi of vertSet) {
        const v = poly.vertices[vi];
        if (v) {
          originals.push({ polyId, vertIdx: vi, pos: { x: v.x, y: v.y } });
        }
      }
    }

    this.moveOriginals = originals;
  }

  // ── Private: Rubber-band ────────────────────────────────────────────────────

  private commitRubberBand() {
    const store = this.getStore();
    if (!store.level) return;

    const minX = Math.min(this.dragStart.x, this.dragCurrent.x);
    const maxX = Math.max(this.dragStart.x, this.dragCurrent.x);
    const minY = Math.min(this.dragStart.y, this.dragCurrent.y);
    const maxY = Math.max(this.dragStart.y, this.dragCurrent.y);

    const sel = this.emptySelection();

    // Select individual vertices inside the rubber-band
    for (const poly of store.level.polygons) {
      if (!store.showGrass && poly.grass) continue;
      for (let vi = 0; vi < poly.vertices.length; vi++) {
        const v = poly.vertices[vi]!;
        if (v.x >= minX && v.x <= maxX && v.y >= minY && v.y <= maxY) {
          let vertSet = sel.vertexSelections.get(poly.id);
          if (!vertSet) {
            vertSet = new Set();
            sel.vertexSelections.set(poly.id, vertSet);
          }
          vertSet.add(vi);
        }
      }
    }

    store.setSelection(sel);
  }

  // ── Private: Nudge ──────────────────────────────────────────────────────────

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
        if (v) {
          vertMoves.push({
            polyId,
            vertIdx: vi,
            newPos: { x: v.x + dx, y: v.y + dy },
          });
        }
      }
    }

    if (vertMoves.length > 0) store.moveVertices(vertMoves);
  }

  // ── Private: Delete ─────────────────────────────────────────────────────────

  private deleteSelectedVertices() {
    const store = this.getStore();
    if (!store.level) return;
    const sel = store.selection;

    if (sel.vertexSelections.size === 0) return;

    // Build the map for batch removal
    const vertsToRemove = new Map<string, Set<number>>();
    for (const [polyId, vertSet] of sel.vertexSelections) {
      if (vertSet.size > 0) {
        vertsToRemove.set(polyId, new Set(vertSet));
      }
    }

    if (vertsToRemove.size > 0) {
      store.removeVertices(vertsToRemove);
    }
  }

  // ── Private: Selection Helpers ──────────────────────────────────────────────

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
