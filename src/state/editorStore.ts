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
import { polyIdToIndex, objectIdToIndex, pictureIdToIndex } from '@/utils/idLookup';
import { applyOperation } from '@/collab/operationApplier';
import type { Operation } from '@/collab/operations';
import type { UserInfo, BikeSnapshot } from '@/collab/protocol';
import { CollabClient } from '@/collab/CollabClient';

/** Remote user awareness state. */
export interface RemoteUser extends UserInfo {
  cursor: Vec2 | null;
  selectedPolygonIds: Set<string>;
  selectedObjectIds: Set<string>;
  activeTool: string;
  isTesting: boolean;
  bikeState: BikeSnapshot | null;
}

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

/** Send an operation to the collab server if connected. */
function broadcastOp(op: Operation) {
  const client = useEditorStore.getState().collabClient;
  if (client?.connected) {
    client.sendOperation(op);
  }
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
    cp.id = p.id;
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

/** Assign unique IDs to all polygons, objects, and pictures in a level that lack one. */
function assignLevelIds(level: Level): void {
  for (const p of level.polygons) {
    if (!p.id) p.id = generateId();
  }
  for (const o of level.objects) {
    if (!o.id) o.id = generateId();
  }
  for (const pic of level.pictures) {
    if (!pic.id) pic.id = generateId();
  }
}

function emptySelection(): SelectionState {
  return {
    polygonIds: new Set(),
    vertexSelections: new Map(),
    objectIds: new Set(),
    pictureIds: new Set(),
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
  /** Show the collaboration panel. */
  showCollabPanel: boolean;
  setShowCollabPanel: (show: boolean) => void;

  // ── Collaboration ──
  collabClient: CollabClient | null;
  isCollaborating: boolean;
  remoteUsers: Map<string, RemoteUser>;

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
  removePolygons: (ids: string[]) => void;
  setPolygonGrass: (id: string, grass: boolean) => void;
  setPolygonsGrass: (ids: string[], grass: boolean) => void;
  moveVertices: (
    moves: Array<{ polyId: string; vertIdx: number; newPos: Vec2 }>,
  ) => void;
  insertVertex: (polyId: string, afterVertIdx: number, pos: Vec2) => void;
  removeVertex: (polyId: string, vertIdx: number) => void;
  removeVertices: (verts: Map<string, Set<number>>) => void;
  addObject: (data: {
    x: number;
    y: number;
    type: ObjectType;
    gravity: Gravity;
    animation: number;
  }) => void;
  removeObjects: (ids: string[]) => void;
  moveObjects: (moves: Array<{ objectId: string; newPos: Vec2 }>) => void;
  addPicture: (data: { x: number; y: number; name: string; clip: Clip; distance: number; texture?: string; mask?: string }) => void;
  removePictures: (ids: string[]) => void;
  movePictures: (moves: Array<{ pictureId: string; newPos: Vec2 }>) => void;
  updatePictures: (ids: string[], data: Partial<{ name: string; clip: Clip; distance: number; texture: string; mask: string }>) => void;
  updateObjects: (ids: string[], data: Partial<{ type: ObjectType; gravity: Gravity; animation: number }>) => void;
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

  // ── Collaboration ──
  setCollabClient: (client: CollabClient | null) => void;
  applyRemoteOperation: (op: Operation, userId: string) => void;
  loadCollabLevel: (level: Level, users: UserInfo[]) => void;
  addRemoteUser: (user: UserInfo) => void;
  removeRemoteUser: (userId: string) => void;
  updateRemoteUser: (userId: string, data: { cursor: Vec2 | null; selectedPolygonIds: string[]; selectedObjectIds: string[]; activeTool: string }) => void;
  setRemoteBikeState: (userId: string, bike: BikeSnapshot) => void;
  setRemoteTesting: (userId: string, isTesting: boolean) => void;
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
      showCollabPanel: false,
      showGrass: true,
      showPictures: true,
      showTextures: true,
      showObjects: true,

      // ── Collaboration ──
      collabClient: null,
      isCollaborating: false,
      remoteUsers: new Map(),

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
        const hasPolys = selection.polygonIds.size > 0;
        const hasObjs = selection.objectIds.size > 0;
        if (!hasPolys && !hasObjs) return;

        const polygons: Array<{ grass: boolean; vertices: Vec2[] }> = [];
        for (const id of selection.polygonIds) {
          const p = level.polygons.find((p) => p.id === id);
          if (!p) continue;
          polygons.push({
            grass: p.grass,
            vertices: p.vertices.map((v) => ({ x: v.x, y: v.y })),
          });
        }

        const objects: Array<{ x: number; y: number; type: ObjectType; gravity: Gravity; animation: number }> = [];
        for (const id of selection.objectIds) {
          const o = level.objects.find((o) => o.id === id);
          if (!o) continue;
          objects.push({
            x: o.position.x,
            y: o.position.y,
            type: o.type,
            gravity: o.gravity,
            animation: o.animation,
          });
        }

        set({ clipboard: { polygons, objects, pasteCount: 0 } });
      },

      cutSelection: () => {
        const { level, selection } = get();
        if (!level) return;
        const hasPolys = selection.polygonIds.size > 0;
        const hasObjs = selection.objectIds.size > 0;
        if (!hasPolys && !hasObjs) return;

        // Copy first
        const polygons: Array<{ grass: boolean; vertices: Vec2[] }> = [];
        for (const id of selection.polygonIds) {
          const p = level.polygons.find((p) => p.id === id);
          if (!p) continue;
          polygons.push({
            grass: p.grass,
            vertices: p.vertices.map((v) => ({ x: v.x, y: v.y })),
          });;
          return {
            grass: p.grass,
            vertices: p.vertices.map((v) => ({ x: v.x, y: v.y })),
          };
        }
        const objects: Array<{ x: number; y: number; type: ObjectType; gravity: Gravity; animation: number }> = [];
        for (const id of selection.objectIds) {
          const o = level.objects.find((o) => o.id === id);
          if (!o) continue;
          objects.push({
            x: o.position.x,
            y: o.position.y,
            type: o.type,
            gravity: o.gravity,
            animation: o.animation,
          });
        }

        // Then delete + set clipboard in one go
        const clone = cloneLevel(level);
        clone.polygons = clone.polygons.filter((p) => !selection.polygonIds.has(p.id));
        clone.objects = clone.objects.filter((o) => !selection.objectIds.has(o.id));

        set({
          level: clone,
          isDirty: true,
          selection: emptySelection(),
          clipboard: { polygons, objects, pasteCount: 0 },
        });
        const polyIds = [...selection.polygonIds];
        const objIds = [...selection.objectIds];
        if (polyIds.length > 0) broadcastOp({ type: 'removePolygons', ids: polyIds });
        if (objIds.length > 0) broadcastOp({ type: 'removeObjects', ids: objIds });
      },

      pasteClipboard: () => {
        const { level, clipboard } = get();
        if (!level || !clipboard) return;
        if (clipboard.polygons.length === 0 && clipboard.objects.length === 0) return;

        const offset = 0.5 * (clipboard.pasteCount + 1);
        const clone = cloneLevel(level);

        const newPolyIds: string[] = [];
        const newObjIds: string[] = [];

        // Add polygons with offset
        for (const pd of clipboard.polygons) {
          const poly = new Polygon();
          poly.id = generateId();
          poly.grass = pd.grass;
          poly.vertices = pd.vertices.map(
            (v) => new Position(v.x + offset, v.y + offset),
          );
          clone.polygons.push(poly);
          newPolyIds.push(poly.id);
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
          newObjIds.push(obj.id);
        }

        // Build selection for pasted items
        const sel: SelectionState = {
          polygonIds: new Set(newPolyIds),
          vertexSelections: new Map(
            clipboard.polygons.map((pd, i) => [
              newPolyIds[i]!,
              new Set(pd.vertices.map((_, vi) => vi)),
            ]),
          ),
          objectIds: new Set(newObjIds),
          pictureIds: new Set(),
        };

        set({
          level: clone,
          isDirty: true,
          selection: sel,
          clipboard: { ...clipboard, pasteCount: clipboard.pasteCount + 1 },
        });
        // Broadcast pasted items
        if (newPolyIds.length > 0) {
          broadcastOp({ type: 'addPolygons', polygons: clipboard.polygons.map((pd, i) => ({
            id: newPolyIds[i]!,
            grass: pd.grass,
            vertices: pd.vertices.map((v) => ({ x: v.x + offset, y: v.y + offset })),
          })) });
        }
        if (newObjIds.length > 0) {
          const ops: Operation[] = clipboard.objects.map((od, i) => ({
            type: 'addObject' as const,
            id: newObjIds[i]!,
            x: od.x + offset,
            y: od.y + offset,
            objectType: od.type,
            gravity: od.gravity,
            animation: od.animation,
          }));
          for (const op of ops) broadcastOp(op);
        }
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
        broadcastOp({ type: 'addPolygon', id: poly.id, grass: data.grass, vertices: data.vertices });
      },

      addPolygons: (data) => {
        const { level } = get();
        if (!level || data.length === 0) return;
        const clone = cloneLevel(level);
        const polygons: Array<{ id: string; grass: boolean; vertices: Vec2[] }> = [];
        for (const d of data) {
          const poly = new Polygon();
          poly.id = generateId();
          poly.grass = d.grass;
          poly.vertices = d.vertices.map((v) => new Position(v.x, v.y));
          clone.polygons.push(poly);
          polygons.push({ id: poly.id, grass: d.grass, vertices: d.vertices });
        }
        set({ level: clone, isDirty: true });
        broadcastOp({ type: 'addPolygons', polygons });
      },

      removePolygons: (ids) => {
        const { level } = get();
        if (!level) return;
        const idSet = new Set(ids);
        const clone = cloneLevel(level);
        clone.polygons = clone.polygons.filter((p) => !idSet.has(p.id));
        set({ level: clone, isDirty: true, selection: emptySelection() });
        broadcastOp({ type: 'removePolygons', ids });
      },

      setPolygonGrass: (id, grass) => {
        const { level } = get();
        if (!level) return;
        const clone = cloneLevel(level);
        const poly = clone.polygons.find((p) => p.id === id);
        if (!poly) return;
        poly.grass = grass;
        set({ level: clone, isDirty: true });
        broadcastOp({ type: 'setPolygonGrass', id, grass });
      },

      setPolygonsGrass: (ids, grass) => {
        const { level } = get();
        if (!level || ids.length === 0) return;
        const idSet = new Set(ids);
        const clone = cloneLevel(level);
        for (const poly of clone.polygons) {
          if (idSet.has(poly.id)) poly.grass = grass;
        }
        set({ level: clone, isDirty: true });
        broadcastOp({ type: 'setPolygonsGrass', ids, grass });
      },

      moveVertices: (moves) => {
        const { level } = get();
        if (!level) return;
        const clone = cloneLevel(level);
        for (const m of moves) {
          const idx = polyIdToIndex(clone, m.polyId);
          if (idx < 0) continue;
          const vert = clone.polygons[idx]!.vertices[m.vertIdx];
          if (vert) {
            vert.x = m.newPos.x;
            vert.y = m.newPos.y;
          }
        }
        set({ level: clone, isDirty: true });
        broadcastOp({ type: 'moveVertices', moves });
      },

      insertVertex: (polyId, afterVertIdx, pos) => {
        const { level } = get();
        if (!level) return;
        const clone = cloneLevel(level);
        const idx = polyIdToIndex(clone, polyId);
        if (idx < 0) return;
        clone.polygons[idx]!.vertices.splice(afterVertIdx, 0, new Position(pos.x, pos.y));
        set({ level: clone, isDirty: true });
        broadcastOp({ type: 'insertVertex', polyId, afterVertIdx, pos });
      },

      removeVertex: (polyId, vertIdx) => {
        const { level } = get();
        if (!level) return;
        const idx = polyIdToIndex(level, polyId);
        if (idx < 0) return;
        const poly = level.polygons[idx]!;
        if (poly.vertices.length <= 3) return;
        const clone = cloneLevel(level);
        clone.polygons[idx]!.vertices.splice(vertIdx, 1);
        set({ level: clone, isDirty: true });
        broadcastOp({ type: 'removeVertex', polyId, vertIdx });
      },

      removeVertices: (verts) => {
        const { level } = get();
        if (!level) return;
        const clone = cloneLevel(level);
        const opVerts: Array<{ polyId: string; vertIndices: number[] }> = [];
        for (const [polyId, vertSet] of verts) {
          const idx = polyIdToIndex(clone, polyId);
          if (idx < 0) continue;
          const poly = clone.polygons[idx]!;
          const remaining = poly.vertices.length - vertSet.size;
          if (remaining < 3) continue;
          const sorted = [...vertSet].sort((a, b) => b - a);
          for (const vi of sorted) {
            poly.vertices.splice(vi, 1);
          }
          opVerts.push({ polyId, vertIndices: [...vertSet] });
        }
        set({ level: clone, isDirty: true, selection: emptySelection() });
        if (opVerts.length > 0) broadcastOp({ type: 'removeVertices', verts: opVerts });
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
        broadcastOp({ type: 'addObject', id: obj.id, x: data.x, y: data.y, objectType: data.type, gravity: data.gravity, animation: data.animation });
      },

      addPicture: (data) => {
        const { level } = get();
        if (!level) return;
        const clone = cloneLevel(level);
        const pic = new Picture();
        pic.id = generateId();
        pic.name = data.name;
        pic.position = new Position(data.x, data.y);
        pic.clip = data.clip;
        pic.distance = data.distance;
        if (data.texture) pic.texture = data.texture;
        if (data.mask) pic.mask = data.mask;
        if (data.texture && data.mask) pic.name = '';
        clone.pictures.push(pic);
        set({ level: clone, isDirty: true });
        broadcastOp({ type: 'addPicture', id: pic.id, x: data.x, y: data.y, name: data.name, clip: data.clip, distance: data.distance, texture: data.texture, mask: data.mask });
      },

      removePictures: (ids) => {
        const { level } = get();
        if (!level) return;
        const idSet = new Set(ids);
        const clone = cloneLevel(level);
        clone.pictures = clone.pictures.filter((p) => !idSet.has(p.id));
        set({ level: clone, isDirty: true, selection: emptySelection() });
        broadcastOp({ type: 'removePictures', ids });
      },

      movePictures: (moves) => {
        const { level } = get();
        if (!level) return;
        const clone = cloneLevel(level);
        for (const m of moves) {
          const idx = pictureIdToIndex(clone, m.pictureId);
          if (idx < 0) continue;
          const pic = clone.pictures[idx]!;
          pic.position = new Position(m.newPos.x, m.newPos.y);
        }
        set({ level: clone, isDirty: true });
        broadcastOp({ type: 'movePictures', moves });
      },

      updatePictures: (ids, data) => {
        const { level } = get();
        if (!level) return;
        const idSet = new Set(ids);
        const clone = cloneLevel(level);
        for (const pic of clone.pictures) {
          if (!idSet.has(pic.id)) continue;
          if (data.name !== undefined) pic.name = data.name;
          if (data.clip !== undefined) pic.clip = data.clip;
          if (data.distance !== undefined) pic.distance = data.distance;
          if (data.texture !== undefined) pic.texture = data.texture;
          if (data.mask !== undefined) pic.mask = data.mask;
        }
        set({ level: clone, isDirty: true });
        broadcastOp({ type: 'updatePictures', ids, data });
      },

      removeObjects: (ids) => {
        const { level } = get();
        if (!level) return;
        const idSet = new Set(ids);
        const clone = cloneLevel(level);
        clone.objects = clone.objects.filter((o) => !idSet.has(o.id));
        set({ level: clone, isDirty: true, selection: emptySelection() });
        broadcastOp({ type: 'removeObjects', ids });
      },

      moveObjects: (moves) => {
        const { level } = get();
        if (!level) return;
        const clone = cloneLevel(level);
        for (const m of moves) {
          const idx = objectIdToIndex(clone, m.objectId);
          if (idx < 0) continue;
          const obj = clone.objects[idx]!;
          obj.position.x = m.newPos.x;
          obj.position.y = m.newPos.y;
        }
        set({ level: clone, isDirty: true });
        broadcastOp({ type: 'moveObjects', moves });
      },

      updateObjects: (ids, data) => {
        const { level } = get();
        if (!level || ids.length === 0) return;
        const idSet = new Set(ids);
        const clone = cloneLevel(level);
        for (const obj of clone.objects) {
          if (!idSet.has(obj.id)) continue;
          if (data.type !== undefined) obj.type = data.type;
          if (data.gravity !== undefined) obj.gravity = data.gravity;
          if (data.animation !== undefined) obj.animation = data.animation;
        }
        set({ level: clone, isDirty: true });
        broadcastOp({ type: 'updateObjects', ids, data });
      },

      setLevelName: (name) => {
        const { level } = get();
        if (!level) return;
        const clone = cloneLevel(level);
        clone.name = name;
        set({ level: clone, isDirty: true });
        broadcastOp({ type: 'setLevelName', name });
      },

      setLevelGround: (ground) => {
        const { level } = get();
        if (!level) return;
        const clone = cloneLevel(level);
        clone.ground = ground;
        set({ level: clone, isDirty: true });
        broadcastOp({ type: 'setLevelGround', ground });
      },

      setLevelSky: (sky) => {
        const { level } = get();
        if (!level) return;
        const clone = cloneLevel(level);
        clone.sky = sky;
        set({ level: clone, isDirty: true });
        broadcastOp({ type: 'setLevelSky', sky });
      },

      setFileName: (fileName) => {
        set({ fileName, isDirty: true });
      },

      mergeSelectedPolygons: () => {
        const { level, selection } = get();
        if (!level || selection.polygonIds.size < 1) return;

        const selectedPolys = level.polygons.filter((p) => selection.polygonIds.has(p.id));
        if (selectedPolys.length < 1) return;

        const result = mergePolygons(selectedPolys);
        if (!result) return; // Disjoint or failed — do nothing

        const clone = cloneLevel(level);
        const removeIds = [...selection.polygonIds];
        clone.polygons = clone.polygons.filter((p) => !selection.polygonIds.has(p.id));
        const addPolys: Array<{ id: string; grass: boolean; vertices: Vec2[] }> = [];
        for (const p of result) {
          p.id = generateId();
          addPolys.push({ id: p.id, grass: p.grass, vertices: p.vertices.map((v) => ({ x: v.x, y: v.y })) });
        }
        clone.polygons.push(...result);

        set({ level: clone, isDirty: true, selection: emptySelection() });
        broadcastOp({ type: 'replacePolygons', removeIds, add: addPolys });
      },

      splitSelectedPolygons: () => {
        const { level, selection } = get();
        if (!level || selection.polygonIds.size < 1 || selection.polygonIds.size > 2) return;

        const selectedPolys = level.polygons.filter((p) => selection.polygonIds.has(p.id));
        if (selectedPolys.length < 1 || selectedPolys.length > 2) return;

        let result: ReturnType<typeof splitPolygons>;
        if (selectedPolys.length === 1) {
          result = selfSplitPolygon(selectedPolys[0]!);
        } else {
          result = splitPolygons(selectedPolys[0]!, selectedPolys[1]!);
        }
        if (!result) return;

        const clone = cloneLevel(level);
        const removeIds = [...selection.polygonIds];
        clone.polygons = clone.polygons.filter((p) => !selection.polygonIds.has(p.id));
        const addPolys: Array<{ id: string; grass: boolean; vertices: Vec2[] }> = [];
        for (const p of result) {
          p.id = generateId();
          addPolys.push({ id: p.id, grass: p.grass, vertices: p.vertices.map((v) => ({ x: v.x, y: v.y })) });
        }
        clone.polygons.push(...result);

        set({ level: clone, isDirty: true, selection: emptySelection() });
        broadcastOp({ type: 'replacePolygons', removeIds, add: addPolys });
      },

      autoGrassSelectedPolygons: () => {
        const { level, selection, autoGrassConfig } = get();
        if (!level || selection.polygonIds.size < 1) return;

        const grassPolygons: Array<{ grass: boolean; vertices: Vec2[] }> = [];

        for (const poly of level.polygons) {
          if (!selection.polygonIds.has(poly.id)) continue;
          if (poly.grass) continue; // Skip grass polygons

          const verts = poly.vertices.map((v) => ({ x: v.x, y: v.y }));
          const strips = autoGrassPolygon(verts, autoGrassConfig);
          for (const strip of strips) {
            grassPolygons.push({ grass: true, vertices: strip });
          }
        }

        if (grassPolygons.length === 0) return;

        const clone = cloneLevel(level);
        const opPolygons: Array<{ id: string; grass: boolean; vertices: Vec2[] }> = [];
        for (const gp of grassPolygons) {
          const p = new Polygon();
          p.id = generateId();
          p.grass = true;
          p.vertices = gp.vertices.map((v) => new Position(v.x, v.y));
          clone.polygons.push(p);
          opPolygons.push({ id: p.id, grass: true, vertices: gp.vertices });
        }

        set({ level: clone, isDirty: true });
        if (opPolygons.length > 0) broadcastOp({ type: 'addPolygons', polygons: opPolygons });
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
      setShowCollabPanel: (show) => set({ showCollabPanel: show }),

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

      // ── Collaboration ──

      setCollabClient: (client) => set({ collabClient: client, isCollaborating: client !== null }),

      applyRemoteOperation: (op, _userId) => {
        const { level } = get();
        if (!level) return;
        try {
          const newLevel = applyOperation(level, op);
          assignLevelIds(newLevel);
          set({ level: newLevel, isDirty: true });
        } catch {
          // Failed to apply remote op — ignore, wait for resync
        }
      },

      loadCollabLevel: (level, users) => {
        assignLevelIds(level);
        const vp = fitLevel(level.polygons, 800, 600);
        const remoteUsers = new Map<string, RemoteUser>();
        for (const u of users) {
          remoteUsers.set(u.userId, {
            ...u,
            cursor: null,
            selectedPolygonIds: new Set(),
            selectedObjectIds: new Set(),
            activeTool: 'select',
            isTesting: false,
            bikeState: null,
          });
        }
        set({
          level,
          fileName: 'collab.lev',
          isDirty: false,
          selection: emptySelection(),
          topologyErrors: [],
          viewport: vp,
          isCollaborating: true,
          remoteUsers,
        });
        useEditorStore.temporal.getState().clear();
      },

      addRemoteUser: (user) => {
        set((state) => {
          const remoteUsers = new Map(state.remoteUsers);
          remoteUsers.set(user.userId, {
            ...user,
            cursor: null,
            selectedPolygonIds: new Set(),
            selectedObjectIds: new Set(),
            activeTool: 'select',
            isTesting: false,
            bikeState: null,
          });
          return { remoteUsers };
        });
      },

      removeRemoteUser: (userId) => {
        set((state) => {
          const remoteUsers = new Map(state.remoteUsers);
          remoteUsers.delete(userId);
          return { remoteUsers };
        });
      },

      updateRemoteUser: (userId, data) => {
        set((state) => {
          const remoteUsers = new Map(state.remoteUsers);
          const existing = remoteUsers.get(userId);
          if (existing) {
            remoteUsers.set(userId, {
              ...existing,
              cursor: data.cursor,
              selectedPolygonIds: new Set(data.selectedPolygonIds),
              selectedObjectIds: new Set(data.selectedObjectIds),
              activeTool: data.activeTool,
            });
          }
          return { remoteUsers };
        });
      },

      setRemoteBikeState: (userId, bike) => {
        set((state) => {
          const remoteUsers = new Map(state.remoteUsers);
          const existing = remoteUsers.get(userId);
          if (existing) {
            remoteUsers.set(userId, { ...existing, bikeState: bike });
          }
          return { remoteUsers };
        });
      },

      setRemoteTesting: (userId, isTesting) => {
        set((state) => {
          const remoteUsers = new Map(state.remoteUsers);
          const existing = remoteUsers.get(userId);
          if (existing) {
            remoteUsers.set(userId, { ...existing, isTesting, bikeState: isTesting ? existing.bikeState : null });
          }
          return { remoteUsers };
        });
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
