import { create } from 'zustand';
import { temporal } from 'zundo';
import { Level, Polygon, Position, ElmaObject, ObjectType, Gravity, Picture, Clip } from 'elmajs';
import {
  ToolId,
  type ViewportState,
  type GridConfig,
  type SelectionState,
  type ObjectPlacementConfig,
  type PicturePlacementConfig,
  type MaskPlacementConfig,
  type TopologyError,
  type Vec2,
} from '@/types';
import { fitLevel } from '@/canvas/viewport';
import { validateTopology } from '@/utils/topology';
import { mergePolygons } from '@/utils/mergePolygons';
import { splitPolygons, selfSplitPolygon } from '@/utils/splitPolygons';
import { autoGrassPolygon, type AutoGrassConfig } from '@/utils/autoGrass';
import { generateId } from '@/utils/generateId';

// ── Test config ──────────────────────────────────────────────────────────────

export interface TestConfig {
  showGrass: boolean;
  showPictures: boolean;
  showTextures: boolean;
  gasKey: string;
  brakeKey: string;
  turnKey: string;
  alovoltKey: string;
  leftVoltKey: string;
  rightVoltKey: string;
  exitKey: string;
  restartKey: string;
}

export const DEFAULT_TEST_CONFIG: TestConfig = {
  showGrass: true,
  showPictures: true,
  showTextures: true,
  gasKey: 'ArrowUp',
  brakeKey: 'ArrowDown',
  turnKey: 'Space',
  alovoltKey: 'KeyD',
  leftVoltKey: 'ArrowLeft',
  rightVoltKey: 'ArrowRight',
  exitKey: 'Escape',
  restartKey: 'F5',
};

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Debounced topology validation. */
let topologyTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleTopologyValidation() {
  if (topologyTimer) clearTimeout(topologyTimer);
  topologyTimer = setTimeout(() => {
    const state = useEditorStore.getState();
    if (!state.level) return;
    const errors = validateTopology(state.level.polygons, state.level.objects, state.level.pictures);
    state.setTopologyErrors(errors);
    // Auto-close validation panel when all errors are resolved
    if (errors.length === 0 && state.showValidationPanel) {
      state.setShowValidationPanel(false);
    }
  }, 100);
}

/** Snapshot saved by beginUndoBatch() to create a single undo entry on endUndoBatch(). */
let undoBatchSnapshot: { level: Level | null; fileName: string | null } | null =
  null;

/** Shallow-clone a Level instance so zundo detects a new reference. */
function cloneLevel(level: Level): Level {
  const clone = Object.assign(
    Object.create(Object.getPrototypeOf(level) as object),
    level,
  ) as Level;
  // Deep-clone mutable arrays so undo snapshots are independent
  clone.polygons = level.polygons.map((p) => {
    const cp = new Polygon();
    cp.id = p.id;
    cp.grass = p.grass;
    cp.vertices = p.vertices.map((v) => new Position(v.x, v.y));
    return cp;
  });
  clone.objects = level.objects.map((o) => {
    const co = new ElmaObject();
    co.id = o.id;
    co.position = new Position(o.position.x, o.position.y);
    co.type = o.type;
    co.gravity = o.gravity;
    co.animation = o.animation;
    return co;
  });
  clone.pictures = level.pictures.map((p) => {
    const cp = new Picture();
    cp.name = p.name;
    cp.texture = p.texture;
    cp.mask = p.mask;
    cp.position = new Position(p.position.x, p.position.y);
    cp.distance = p.distance;
    cp.clip = p.clip;
    return cp;
  });
  return clone;
}

/** Assign unique IDs to all polygons and objects in a level that lack one. */
function assignLevelIds(level: Level): void {
  for (const p of level.polygons) {
    if (!p.id) p.id = generateId();
  }
  for (const o of level.objects) {
    if (!o.id) o.id = generateId();
  }
}

function emptySelection(): SelectionState {
  return {
    polygonIndices: new Set(),
    vertexIndices: new Map(),
    objectIndices: new Set(),
    pictureIndices: new Set(),
  };
}

// ── Store types ──────────────────────────────────────────────────────────────

export interface EditorState {
  // Level data (tracked by undo/redo)
  level: Level | null;
  fileName: string | null;

  // Editor UI state (NOT tracked by undo/redo)
  activeTool: ToolId;
  viewport: ViewportState;
  grid: GridConfig;
  selection: SelectionState;
  objectConfig: ObjectPlacementConfig;
  pictureConfig: PicturePlacementConfig;
  maskConfig: MaskPlacementConfig;
  topologyErrors: TopologyError[];
  isDirty: boolean;
  /** World-space mouse position for status bar. */
  cursorWorld: Vec2 | null;
  /** Pipe tool half-width (distance from center-line to each wall). */
  pipeRadius: number;
  /** Pipe tool: use rounded corners at bends. */
  pipeRoundCorners: boolean;
  /** Shape tool: number of sides for the regular polygon. */
  shapeSides: number;
  /** Image import tool configuration. */
  imageImportConfig: {
    threshold: number;
    simplifyTolerance: number;
    scale: number;
    invert: boolean;
  };
  /** Traced polygons waiting to be placed (centered at origin). */
  imageImportPolygons: Vec2[][] | null;
  /** Clipboard for copy/cut/paste. */
  clipboard: {
    polygons: Array<{ grass: boolean; vertices: Vec2[] }>;
    objects: Array<{ x: number; y: number; type: ObjectType; gravity: Gravity; animation: number }>;
    pasteCount: number;
  } | null;
  /** Draw polygon tool: create grass polygons. */
  drawPolygonGrass: boolean;
  /** Auto-grass configuration. */
  autoGrassConfig: AutoGrassConfig;
  /** Whether the game test mode is active. */
  isTesting: boolean;
  /** Display toggles for editor rendering layers. */
  showGrass: boolean;
  showPictures: boolean;
  showTextures: boolean;
  showObjects: boolean;
  /** Test mode configuration. */
  testConfig: TestConfig;
  /** Show the validation error panel. */
  showValidationPanel: boolean;
  /** Show the property panel drawer (mobile/tablet). */
  showPropPanel: boolean;
  setShowPropPanel: (show: boolean) => void;

  // ── Level I/O ──
  loadLevel: (level: Level, fileName: string) => void;
  newLevel: () => void;

  // ── Tool state ──
  setActiveTool: (tool: ToolId) => void;

  // ── Viewport ──
  setViewport: (vp: ViewportState) => void;

  // ── Grid ──
  setGrid: (grid: Partial<GridConfig>) => void;

  // ── Selection ──
  setSelection: (sel: SelectionState) => void;
  clearSelection: () => void;

  // ── Cursor ──
  setCursorWorld: (pos: Vec2 | null) => void;

  // ── Object config ──
  setObjectConfig: (config: Partial<ObjectPlacementConfig>) => void;

  // ── Picture config ──
  setPictureConfig: (config: Partial<PicturePlacementConfig>) => void;

  // ── Mask config ──
  setMaskConfig: (config: Partial<MaskPlacementConfig>) => void;

  // ── Pipe config ──
  setPipeRadius: (radius: number) => void;
  setPipeRoundCorners: (round: boolean) => void;

  // ── Shape config ──
  setShapeSides: (sides: number) => void;

  // ── Image import config ──
  setImageImportConfig: (config: Partial<EditorState['imageImportConfig']>) => void;
  setImageImportPolygons: (polygons: Vec2[][] | null) => void;

  // ── Draw polygon config ──
  setDrawPolygonGrass: (grass: boolean) => void;

  // ── Auto-grass config ──
  setAutoGrassConfig: (config: Partial<AutoGrassConfig>) => void;

  // ── Clipboard ──
  copySelection: () => void;
  cutSelection: () => void;
  pasteClipboard: () => void;

  // ── Level mutations (each creates an undo snapshot) ──
  addPolygon: (data: { grass: boolean; vertices: Vec2[] }) => void;
  addPolygons: (data: Array<{ grass: boolean; vertices: Vec2[] }>) => void;
  removePolygons: (indices: number[]) => void;
  setPolygonGrass: (index: number, grass: boolean) => void;
  setPolygonsGrass: (indices: number[], grass: boolean) => void;
  moveVertices: (
    moves: Array<{ polyIdx: number; vertIdx: number; newPos: Vec2 }>,
  ) => void;
  insertVertex: (polyIdx: number, afterVertIdx: number, pos: Vec2) => void;
  removeVertex: (polyIdx: number, vertIdx: number) => void;
  removeVertices: (verts: Map<number, Set<number>>) => void;
  addObject: (data: {
    x: number;
    y: number;
    type: ObjectType;
    gravity: Gravity;
    animation: number;
  }) => void;
  removeObjects: (indices: number[]) => void;
  moveObjects: (moves: Array<{ objIdx: number; newPos: Vec2 }>) => void;
  addPicture: (data: { x: number; y: number; name: string; clip: Clip; distance: number; texture?: string; mask?: string }) => void;
  removePictures: (indices: number[]) => void;
  movePictures: (moves: Array<{ picIdx: number; newPos: Vec2 }>) => void;
  updatePictures: (indices: number[], data: Partial<{ name: string; clip: Clip; distance: number; texture: string; mask: string }>) => void;
  updateObjects: (indices: number[], data: Partial<{ type: ObjectType; gravity: Gravity; animation: number }>) => void;
  setLevelName: (name: string) => void;
  setLevelGround: (ground: string) => void;
  setLevelSky: (sky: string) => void;
  setFileName: (fileName: string) => void;
  mergeSelectedPolygons: () => void;
  splitSelectedPolygons: () => void;
  autoGrassSelectedPolygons: () => void;

  // ── Topology ──
  setTopologyErrors: (errors: TopologyError[]) => void;

  // ── Display toggles ──
  setShowGrass: (show: boolean) => void;
  setShowPictures: (show: boolean) => void;
  setShowTextures: (show: boolean) => void;
  setShowObjects: (show: boolean) => void;

  // ── Test config ──
  setTestConfig: (config: Partial<TestConfig>) => void;

  // ── Validation panel ──
  setShowValidationPanel: (show: boolean) => void;

  // ── Testing ──
  startTesting: () => void;
  stopTesting: () => void;

  // ── Undo batching ──
  beginUndoBatch: () => void;
  endUndoBatch: () => void;
}

// ── Store implementation ────────────────────────────────────────────────────

export const useEditorStore = create<EditorState>()(
  temporal(
    (set, get) => ({
      // Initial state
      level: null,
      fileName: null,
      activeTool: ToolId.Select,
      viewport: { centerX: 0, centerY: 0, zoom: 50 },
      grid: { enabled: true, size: 0.1, visible: true },
      selection: emptySelection(),
      objectConfig: {
        type: ObjectType.Apple,
        gravity: Gravity.None,
        animation: 1,
      },
      pictureConfig: {
        name: 'barrel',
        clip: Clip.Unclipped,
        distance: 600,
      },
      maskConfig: {
        texture: 'stone3',
        mask: 'maskbig',
        clip: Clip.Unclipped,
        distance: 600,
      },
      topologyErrors: [],
      isDirty: false,
      cursorWorld: null,
      pipeRadius: 1.0,
      pipeRoundCorners: false,
      shapeSides: 4,
      imageImportConfig: {
        threshold: 128,
        simplifyTolerance: 2.0,
        scale: 0.1,
        invert: false,
      },
      imageImportPolygons: null,
      clipboard: null,
      drawPolygonGrass: false,
      autoGrassConfig: { thickness: 0.8, maxAngle: 60 },
      isTesting: false,
      testConfig: { ...DEFAULT_TEST_CONFIG },
      showValidationPanel: false,
      showPropPanel: false,
      showGrass: true,
      showPictures: true,
      showTextures: true,
      showObjects: true,

      // ── Level I/O ──

      loadLevel: (level, fileName) => {
        assignLevelIds(level);
        set({
          level,
          fileName,
          isDirty: false,
          selection: emptySelection(),
          topologyErrors: [],
        });
        // Clear undo history so Ctrl+Z doesn't revert to null/previous file
        useEditorStore.temporal.getState().clear();
      },

      newLevel: () => {
        const level = new Level();
        assignLevelIds(level);
        const vp = fitLevel(level.polygons, 800, 600);
        set({
          level,
          fileName: 'untitled.lev',
          isDirty: false,
          selection: emptySelection(),
          topologyErrors: [],
          viewport: vp,
        });
        // Clear undo history so Ctrl+Z doesn't revert to null/previous file
        useEditorStore.temporal.getState().clear();
      },

      // ── Tool state ──

      setActiveTool: (tool) => set({ activeTool: tool }),

      // ── Viewport ──

      setViewport: (vp) => set({ viewport: vp }),

      // ── Grid ──

      setGrid: (partial) =>
        set((s) => ({ grid: { ...s.grid, ...partial } })),

      // ── Selection ──

      setSelection: (sel) => set({ selection: sel }),
      clearSelection: () => set({ selection: emptySelection() }),

      // ── Cursor ──

      setCursorWorld: (pos) => set({ cursorWorld: pos }),

      // ── Object config ──

      setObjectConfig: (config) =>
        set((s) => ({ objectConfig: { ...s.objectConfig, ...config } })),

      setPictureConfig: (config) =>
        set((s) => ({ pictureConfig: { ...s.pictureConfig, ...config } })),

      setMaskConfig: (config) =>
        set((s) => ({ maskConfig: { ...s.maskConfig, ...config } })),

      // ── Pipe config ──

      setPipeRadius: (radius) => set({ pipeRadius: radius }),
      setPipeRoundCorners: (round) => set({ pipeRoundCorners: round }),

      // ── Shape config ──

      setShapeSides: (sides) => set({ shapeSides: sides }),

      // ── Image import config ──

      setImageImportConfig: (config) =>
        set((s) => ({ imageImportConfig: { ...s.imageImportConfig, ...config } })),
      setImageImportPolygons: (polygons) =>
        set({ imageImportPolygons: polygons }),

      // ── Draw polygon config ──

      setDrawPolygonGrass: (grass) => set({ drawPolygonGrass: grass }),

      // ── Auto-grass config ──

      setAutoGrassConfig: (config) =>
        set((s) => ({ autoGrassConfig: { ...s.autoGrassConfig, ...config } })),

      // ── Clipboard ──

      copySelection: () => {
        const { level, selection } = get();
        if (!level) return;
        const hasPolys = selection.polygonIndices.size > 0;
        const hasObjs = selection.objectIndices.size > 0;
        if (!hasPolys && !hasObjs) return;

        const polygons = [...selection.polygonIndices].map((i) => {
          const p = level.polygons[i]!;
          return {
            grass: p.grass,
            vertices: p.vertices.map((v) => ({ x: v.x, y: v.y })),
          };
        });

        const objects = [...selection.objectIndices].map((i) => {
          const o = level.objects[i]!;
          return {
            x: o.position.x,
            y: o.position.y,
            type: o.type,
            gravity: o.gravity,
            animation: o.animation,
          };
        });

        set({ clipboard: { polygons, objects, pasteCount: 0 } });
      },

      cutSelection: () => {
        const { level, selection } = get();
        if (!level) return;
        const hasPolys = selection.polygonIndices.size > 0;
        const hasObjs = selection.objectIndices.size > 0;
        if (!hasPolys && !hasObjs) return;

        // Copy first
        const polygons = [...selection.polygonIndices].map((i) => {
          const p = level.polygons[i]!;
          return {
            grass: p.grass,
            vertices: p.vertices.map((v) => ({ x: v.x, y: v.y })),
          };
        });
        const objects = [...selection.objectIndices].map((i) => {
          const o = level.objects[i]!;
          return {
            x: o.position.x,
            y: o.position.y,
            type: o.type,
            gravity: o.gravity,
            animation: o.animation,
          };
        });

        // Then delete + set clipboard in one go
        const clone = cloneLevel(level);
        const sortedPolys = [...selection.polygonIndices].sort((a, b) => b - a);
        for (const idx of sortedPolys) clone.polygons.splice(idx, 1);
        const sortedObjs = [...selection.objectIndices].sort((a, b) => b - a);
        for (const idx of sortedObjs) clone.objects.splice(idx, 1);

        set({
          level: clone,
          isDirty: true,
          selection: emptySelection(),
          clipboard: { polygons, objects, pasteCount: 0 },
        });
      },

      pasteClipboard: () => {
        const { level, clipboard } = get();
        if (!level || !clipboard) return;
        if (clipboard.polygons.length === 0 && clipboard.objects.length === 0) return;

        const offset = 0.5 * (clipboard.pasteCount + 1);
        const clone = cloneLevel(level);

        // Track indices of newly added items for selection
        const polyStartIdx = clone.polygons.length;
        const objStartIdx = clone.objects.length;

        // Add polygons with offset
        for (const pd of clipboard.polygons) {
          const poly = new Polygon();
          poly.id = generateId();
          poly.grass = pd.grass;
          poly.vertices = pd.vertices.map(
            (v) => new Position(v.x + offset, v.y + offset),
          );
          clone.polygons.push(poly);
        }

        // Add objects with offset
        for (const od of clipboard.objects) {
          const obj = new ElmaObject();
          obj.id = generateId();
          obj.position = new Position(od.x + offset, od.y + offset);
          obj.type = od.type;
          obj.gravity = od.gravity;
          obj.animation = od.animation;
          clone.objects.push(obj);
        }

        // Build selection for pasted items
        const sel: SelectionState = {
          polygonIndices: new Set(
            clipboard.polygons.map((_, i) => polyStartIdx + i),
          ),
          vertexIndices: new Map(
            clipboard.polygons.map((pd, i) => [
              polyStartIdx + i,
              new Set(pd.vertices.map((_, vi) => vi)),
            ]),
          ),
          objectIndices: new Set(
            clipboard.objects.map((_, i) => objStartIdx + i),
          ),
          pictureIndices: new Set(),
        };

        set({
          level: clone,
          isDirty: true,
          selection: sel,
          clipboard: { ...clipboard, pasteCount: clipboard.pasteCount + 1 },
        });
      },

      // ── Level mutations ──

      addPolygon: (data) => {
        const { level } = get();
        if (!level) return;
        const clone = cloneLevel(level);
        const poly = new Polygon();
        poly.id = generateId();
        poly.grass = data.grass;
        poly.vertices = data.vertices.map((v) => new Position(v.x, v.y));
        clone.polygons.push(poly);
        set({ level: clone, isDirty: true });
      },

      addPolygons: (data) => {
        const { level } = get();
        if (!level || data.length === 0) return;
        const clone = cloneLevel(level);
        for (const d of data) {
          const poly = new Polygon();
          poly.id = generateId();
          poly.grass = d.grass;
          poly.vertices = d.vertices.map((v) => new Position(v.x, v.y));
          clone.polygons.push(poly);
        }
        set({ level: clone, isDirty: true });
      },

      removePolygons: (indices) => {
        const { level } = get();
        if (!level) return;
        const clone = cloneLevel(level);
        const sorted = [...indices].sort((a, b) => b - a);
        for (const idx of sorted) {
          clone.polygons.splice(idx, 1);
        }
        set({ level: clone, isDirty: true, selection: emptySelection() });
      },

      setPolygonGrass: (index, grass) => {
        const { level } = get();
        if (!level || !level.polygons[index]) return;
        const clone = cloneLevel(level);
        clone.polygons[index]!.grass = grass;
        set({ level: clone, isDirty: true });
      },

      setPolygonsGrass: (indices, grass) => {
        const { level } = get();
        if (!level || indices.length === 0) return;
        const clone = cloneLevel(level);
        for (const idx of indices) {
          const poly = clone.polygons[idx];
          if (poly) poly.grass = grass;
        }
        set({ level: clone, isDirty: true });
      },

      moveVertices: (moves) => {
        const { level } = get();
        if (!level) return;
        const clone = cloneLevel(level);
        for (const m of moves) {
          const poly = clone.polygons[m.polyIdx];
          const vert = poly?.vertices[m.vertIdx];
          if (vert) {
            vert.x = m.newPos.x;
            vert.y = m.newPos.y;
          }
        }
        set({ level: clone, isDirty: true });
      },

      insertVertex: (polyIdx, afterVertIdx, pos) => {
        const { level } = get();
        if (!level) return;
        const clone = cloneLevel(level);
        const poly = clone.polygons[polyIdx];
        if (!poly) return;
        poly.vertices.splice(afterVertIdx, 0, new Position(pos.x, pos.y));
        set({ level: clone, isDirty: true });
      },

      removeVertex: (polyIdx, vertIdx) => {
        const { level } = get();
        if (!level) return;
        const poly = level.polygons[polyIdx];
        if (!poly || poly.vertices.length <= 3) return;
        const clone = cloneLevel(level);
        clone.polygons[polyIdx]!.vertices.splice(vertIdx, 1);
        set({ level: clone, isDirty: true });
      },

      removeVertices: (verts) => {
        const { level } = get();
        if (!level) return;
        const clone = cloneLevel(level);
        // Process each polygon, removing indices in descending order
        for (const [pi, vertSet] of verts) {
          const poly = clone.polygons[pi];
          if (!poly) continue;
          const remaining = poly.vertices.length - vertSet.size;
          if (remaining < 3) continue; // keep at least 3 vertices
          const sorted = [...vertSet].sort((a, b) => b - a);
          for (const vi of sorted) {
            poly.vertices.splice(vi, 1);
          }
        }
        set({ level: clone, isDirty: true, selection: emptySelection() });
      },

      addObject: (data) => {
        const { level } = get();
        if (!level) return;
        if (data.type === ObjectType.Start && level.objects.some(o => o.type === ObjectType.Start)) return;
        const clone = cloneLevel(level);
        const obj = new ElmaObject();
        obj.id = generateId();
        obj.position = new Position(data.x, data.y);
        obj.type = data.type;
        obj.gravity = data.gravity;
        obj.animation = data.animation;
        clone.objects.push(obj);
        set({ level: clone, isDirty: true });
      },

      addPicture: (data) => {
        const { level } = get();
        if (!level) return;
        const clone = cloneLevel(level);
        const pic = new Picture();
        pic.name = data.name;
        pic.position = new Position(data.x, data.y);
        pic.clip = data.clip;
        pic.distance = data.distance;
        if (data.texture) pic.texture = data.texture;
        if (data.mask) pic.mask = data.mask;
        if (data.texture && data.mask) pic.name = '';
        clone.pictures.push(pic);
        set({ level: clone, isDirty: true });
      },

      removePictures: (indices) => {
        const { level } = get();
        if (!level) return;
        const clone = cloneLevel(level);
        const sorted = [...indices].sort((a, b) => b - a);
        for (const idx of sorted) {
          clone.pictures.splice(idx, 1);
        }
        set({ level: clone, isDirty: true, selection: emptySelection() });
      },

      movePictures: (moves) => {
        const { level } = get();
        if (!level) return;
        const clone = cloneLevel(level);
        for (const m of moves) {
          const pic = clone.pictures[m.picIdx];
          if (pic) {
            pic.position = new Position(m.newPos.x, m.newPos.y);
          }
        }
        set({ level: clone, isDirty: true });
      },

      updatePictures: (indices, data) => {
        const { level } = get();
        if (!level) return;
        const clone = cloneLevel(level);
        for (const idx of indices) {
          const pic = clone.pictures[idx];
          if (!pic) continue;
          if (data.name !== undefined) pic.name = data.name;
          if (data.clip !== undefined) pic.clip = data.clip;
          if (data.distance !== undefined) pic.distance = data.distance;
          if (data.texture !== undefined) pic.texture = data.texture;
          if (data.mask !== undefined) pic.mask = data.mask;
        }
        set({ level: clone, isDirty: true });
      },

      removeObjects: (indices) => {
        const { level } = get();
        if (!level) return;
        const clone = cloneLevel(level);
        const sorted = [...indices].sort((a, b) => b - a);
        for (const idx of sorted) {
          clone.objects.splice(idx, 1);
        }
        set({ level: clone, isDirty: true, selection: emptySelection() });
      },

      moveObjects: (moves) => {
        const { level } = get();
        if (!level) return;
        const clone = cloneLevel(level);
        for (const m of moves) {
          const obj = clone.objects[m.objIdx];
          if (obj) {
            obj.position.x = m.newPos.x;
            obj.position.y = m.newPos.y;
          }
        }
        set({ level: clone, isDirty: true });
      },

      updateObjects: (indices, data) => {
        const { level } = get();
        if (!level || indices.length === 0) return;
        const clone = cloneLevel(level);
        for (const index of indices) {
          const obj = clone.objects[index];
          if (!obj) continue;
          if (data.type !== undefined) obj.type = data.type;
          if (data.gravity !== undefined) obj.gravity = data.gravity;
          if (data.animation !== undefined) obj.animation = data.animation;
        }
        set({ level: clone, isDirty: true });
      },

      setLevelName: (name) => {
        const { level } = get();
        if (!level) return;
        const clone = cloneLevel(level);
        clone.name = name;
        set({ level: clone, isDirty: true });
      },

      setLevelGround: (ground) => {
        const { level } = get();
        if (!level) return;
        const clone = cloneLevel(level);
        clone.ground = ground;
        set({ level: clone, isDirty: true });
      },

      setLevelSky: (sky) => {
        const { level } = get();
        if (!level) return;
        const clone = cloneLevel(level);
        clone.sky = sky;
        set({ level: clone, isDirty: true });
      },

      setFileName: (fileName) => {
        set({ fileName, isDirty: true });
      },

      mergeSelectedPolygons: () => {
        const { level, selection } = get();
        if (!level || selection.polygonIndices.size < 1) return;

        const indices = [...selection.polygonIndices];
        const selectedPolys = indices.map((i) => level.polygons[i]!);

        const result = mergePolygons(selectedPolys);
        if (!result) return; // Disjoint or failed — do nothing

        const clone = cloneLevel(level);
        // Remove originals in descending order to preserve indices
        const sorted = [...indices].sort((a, b) => b - a);
        for (const idx of sorted) {
          clone.polygons.splice(idx, 1);
        }
        // Add merged polygon(s)
        for (const p of result) p.id = generateId();
        clone.polygons.push(...result);

        set({ level: clone, isDirty: true, selection: emptySelection() });
      },

      splitSelectedPolygons: () => {
        const { level, selection } = get();
        if (!level || selection.polygonIndices.size < 1 || selection.polygonIndices.size > 2) return;

        const indices = [...selection.polygonIndices];

        let result: ReturnType<typeof splitPolygons>;
        if (indices.length === 1) {
          // Self-split: split a single self-intersecting polygon
          result = selfSplitPolygon(level.polygons[indices[0]!]!);
        } else {
          const [polyA, polyB] = indices.map((i) => level.polygons[i]!);
          result = splitPolygons(polyA!, polyB!);
        }
        if (!result) return; // Not self-intersecting / disjoint / failed

        const clone = cloneLevel(level);
        // Remove originals in descending order to preserve indices
        const sorted = [...indices].sort((a, b) => b - a);
        for (const idx of sorted) {
          clone.polygons.splice(idx, 1);
        }
        // Add split polygon pieces
        for (const p of result) p.id = generateId();
        clone.polygons.push(...result);

        set({ level: clone, isDirty: true, selection: emptySelection() });
      },

      autoGrassSelectedPolygons: () => {
        const { level, selection, autoGrassConfig } = get();
        if (!level || selection.polygonIndices.size < 1) return;

        const grassPolygons: Array<{ grass: boolean; vertices: Vec2[] }> = [];

        for (const idx of selection.polygonIndices) {
          const poly = level.polygons[idx];
          if (!poly || poly.grass) continue; // Skip grass polygons

          const verts = poly.vertices.map((v) => ({ x: v.x, y: v.y }));
          const strips = autoGrassPolygon(verts, autoGrassConfig);
          for (const strip of strips) {
            grassPolygons.push({ grass: true, vertices: strip });
          }
        }

        if (grassPolygons.length === 0) return;

        const clone = cloneLevel(level);
        for (const gp of grassPolygons) {
          const p = new Polygon();
          p.id = generateId();
          p.grass = true;
          p.vertices = gp.vertices.map((v) => new Position(v.x, v.y));
          clone.polygons.push(p);
        }

        set({ level: clone, isDirty: true });
      },

      // ── Topology ──

      setTopologyErrors: (errors) => set({ topologyErrors: errors }),

      // ── Display toggles ──

      setShowGrass: (show) => set({ showGrass: show }),
      setShowPictures: (show) => set({ showPictures: show }),
      setShowTextures: (show) => set({ showTextures: show }),
      setShowObjects: (show) => set({ showObjects: show }),

      // ── Test config ──

      setTestConfig: (config) => set((s) => ({ testConfig: { ...s.testConfig, ...config } })),

      // ── Validation panel ──

      setShowValidationPanel: (show) => set({ showValidationPanel: show }),
      setShowPropPanel: (show) => set({ showPropPanel: show }),

      // ── Testing ──

      startTesting: () => {
        const { level } = get();
        if (!level) return;
        // Run validation synchronously to ensure latest state
        const errors = validateTopology(level.polygons, level.objects, level.pictures);
        // Only block on errors that prevent playing (not missing flower)
        const blocking = errors.filter((e) => e.type !== 'missing-flower');
        if (blocking.length > 0) {
          set({ topologyErrors: errors, showValidationPanel: true });
          return;
        }
        set({ isTesting: true, showValidationPanel: false });
      },
      stopTesting: () => set({ isTesting: false }),

      // ── Undo batching ─────────────────────────────────────────────────
      // Pause undo tracking at drag start, commit a single entry on drag end.
      beginUndoBatch: () => {
        const state = get();
        undoBatchSnapshot = { level: state.level, fileName: state.fileName };
        useEditorStore.temporal.getState().pause();
      },
      endUndoBatch: () => {
        useEditorStore.temporal.getState().resume();
        if (undoBatchSnapshot) {
          const state = get();
          // Only create an undo entry if level actually changed during the batch
          if (
            undoBatchSnapshot.level !== state.level ||
            undoBatchSnapshot.fileName !== state.fileName
          ) {
            const { pastStates } = useEditorStore.temporal.getState();
            useEditorStore.temporal.setState({
              pastStates: [...pastStates, undoBatchSnapshot],
              futureStates: [],
            });
          }
          undoBatchSnapshot = null;
        }
      },
    }),
    {
      // Only track level data for undo/redo, not UI state
      partialize: (state) => ({
        level: state.level,
        fileName: state.fileName,
      }),
      // Compare by reference so that set() calls that don't change
      // level/fileName are ignored (otherwise futureStates gets cleared
      // by unrelated state updates like topology validation or cursor moves)
      equality: (pastState, currentState) =>
        pastState.level === currentState.level &&
        pastState.fileName === currentState.fileName,
      limit: 100,
    },
  ),
);

// Auto-validate topology whenever the level changes
let prevLevel: Level | null = null;
useEditorStore.subscribe((state) => {
  if (state.level !== prevLevel) {
    prevLevel = state.level;
    scheduleTopologyValidation();
  }
});

// ── localStorage persistence ────────────────────────────────────────────────

const LS_LEVEL_KEY = 'eled_level';
const LS_FILENAME_KEY = 'eled_fileName';
const LS_EDITOR_PROPS_KEY = 'eled_editorProps';
const LS_TEST_CONFIG_KEY = 'eled_testConfig';

/** Debounced save to localStorage. */
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let prevSavedLevel: Level | null = null;

useEditorStore.subscribe((state) => {
  if (state.level === prevSavedLevel) return;
  prevSavedLevel = state.level;

  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      if (state.level) {
        const buffer = state.level.toBuffer();
        const bytes = new Uint8Array(buffer);
        let binary = '';
        for (let i = 0; i < bytes.length; i++) {
          binary += String.fromCharCode(bytes[i]!);
        }
        localStorage.setItem(LS_LEVEL_KEY, btoa(binary));
        localStorage.setItem(LS_FILENAME_KEY, state.fileName ?? 'untitled.lev');
      } else {
        localStorage.removeItem(LS_LEVEL_KEY);
        localStorage.removeItem(LS_FILENAME_KEY);
      }
    } catch {
      // Ignore serialization or quota errors
    }
  }, 500);
});

// ── Editor props & test config persistence ──────────────────────────────────

let prevEditorProps = '';
let prevTestConfig = '';

useEditorStore.subscribe((state) => {
  const editorProps = JSON.stringify({
    showGrass: state.showGrass,
    showPictures: state.showPictures,
    showTextures: state.showTextures,
    showObjects: state.showObjects,
  });
  const testConfig = JSON.stringify(state.testConfig);

  try {
    if (editorProps !== prevEditorProps) {
      prevEditorProps = editorProps;
      localStorage.setItem(LS_EDITOR_PROPS_KEY, editorProps);
    }
    if (testConfig !== prevTestConfig) {
      prevTestConfig = testConfig;
      localStorage.setItem(LS_TEST_CONFIG_KEY, testConfig);
    }
  } catch {
    // Ignore quota errors
  }
});

/** Restore level from localStorage on startup. */
function restoreFromLocalStorage(): void {
  const patch: Record<string, unknown> = {};

  // Restore editor props
  try {
    const raw = localStorage.getItem(LS_EDITOR_PROPS_KEY);
    if (raw) {
      const props = JSON.parse(raw);
      patch.showGrass = props.showGrass ?? true;
      patch.showPictures = props.showPictures ?? true;
      patch.showTextures = props.showTextures ?? true;
      patch.showObjects = props.showObjects ?? true;
    }
  } catch {
    localStorage.removeItem(LS_EDITOR_PROPS_KEY);
  }

  // Restore test config
  try {
    const raw = localStorage.getItem(LS_TEST_CONFIG_KEY);
    if (raw) {
      patch.testConfig = { ...DEFAULT_TEST_CONFIG, ...JSON.parse(raw) };
    }
  } catch {
    localStorage.removeItem(LS_TEST_CONFIG_KEY);
  }

  // Restore level
  try {
    const base64 = localStorage.getItem(LS_LEVEL_KEY);
    if (base64) {
      const binary = atob(base64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
      }
      const level = Level.from(bytes.buffer);
      assignLevelIds(level);
      patch.level = level;
      patch.fileName = localStorage.getItem(LS_FILENAME_KEY) ?? 'untitled.lev';
      patch.isDirty = false;
      patch.viewport = fitLevel(level.polygons, 800, 600);
    }
  } catch {
    // Corrupted data — start fresh
    localStorage.removeItem(LS_LEVEL_KEY);
    localStorage.removeItem(LS_FILENAME_KEY);
  }

  if (Object.keys(patch).length > 0) {
    useEditorStore.setState(patch);
    if (patch.level) {
      useEditorStore.temporal.getState().clear();
      prevLevel = patch.level as Level;
      prevSavedLevel = patch.level as Level;
    }
  }
}

restoreFromLocalStorage();
