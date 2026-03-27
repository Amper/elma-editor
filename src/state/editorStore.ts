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
  type ShapeConfig,
  type TopologyError,
  type Vec2,
  type ButtonViewMode,
  type ButtonSize,
  type ToolbarItemConfig,
} from '@/types';
import { fitLevel } from '@/canvas/viewport';
import { validateTopology } from '@/utils/topology';
import { mergePolygons } from '@/utils/mergePolygons';
import { splitPolygons, selfSplitPolygon } from '@/utils/splitPolygons';
import { autoGrassPolygon, type AutoGrassConfig } from '@/utils/autoGrass';
import { pointInPolygon, computeSignedArea, computeBBox } from '@/utils/geometry';
import { generateId } from '@/utils/generateId';

// ── Test config ──────────────────────────────────────────────────────────────

export interface TestConfig {
  showGrass: boolean;
  showPictures: boolean;
  showTextures: boolean;
  objectsAnimation: boolean;
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
  objectsAnimation: true,
  gasKey: 'ArrowUp',
  brakeKey: 'ArrowDown',
  turnKey: 'Space',
  alovoltKey: 'KeyD',
  leftVoltKey: 'ArrowLeft',
  rightVoltKey: 'ArrowRight',
  exitKey: 'Escape',
  restartKey: 'F5',
};

// ── Default toolbar config ───────────────────────────────────────────────────

export const DEFAULT_TOOLBAR_CONFIG: ToolbarItemConfig[] = [
  { id: ToolId.Select, visible: true },
  { id: ToolId.DrawPolygon, visible: true },
  { id: ToolId.DrawGrass, visible: true },
  { id: ToolId.Vertex, visible: true },
  { id: ToolId.DrawObject, visible: true },
  { id: ToolId.Shape, visible: true },
  { id: ToolId.DrawPicture, visible: true },
  { id: ToolId.DrawMask, visible: true },
  { id: ToolId.Pipe, visible: true },
  { id: ToolId.Pan, visible: true },
  { id: ToolId.ImageImport, visible: true },
  { id: ToolId.Text, visible: true },
];

/** Reconcile saved toolbar config with current tool list (handles version drift). */
function reconcileToolbarConfig(saved: ToolbarItemConfig[]): ToolbarItemConfig[] {
  const allToolIds = new Set(DEFAULT_TOOLBAR_CONFIG.map(t => t.id));
  const savedIds = new Set(saved.map(t => t.id));
  // Keep only items that still exist
  const result = saved.filter(t => allToolIds.has(t.id));
  // Append any new tools not in saved config
  for (const def of DEFAULT_TOOLBAR_CONFIG) {
    if (!savedIds.has(def.id)) {
      result.push({ ...def });
    }
  }
  return result;
}

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

/** Extract selected polygons, objects and pictures as plain serializable data. */
export function extractSelectionData(level: Level, selection: SelectionState) {
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
  const pictures = [...selection.pictureIndices].map((i) => {
    const p = level.pictures[i]!;
    return {
      x: p.position.x,
      y: p.position.y,
      name: p.name,
      texture: p.texture,
      mask: p.mask,
      clip: p.clip,
      distance: p.distance,
    };
  });
  return { polygons, objects, pictures };
}

// ── Store types ──────────────────────────────────────────────────────────────

export interface EditorState {
  // Level data (tracked by undo/redo)
  level: Level | null;
  fileName: string | null;

  // Editor UI state (NOT tracked by undo/redo)
  activeTool: ToolId;
  toolPanelCollapsed: boolean;
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
  /** Shape tool configuration. */
  shapeConfig: ShapeConfig;
  /** Image import tool configuration. */
  imageImportConfig: {
    threshold: number;
    simplifyTolerance: number;
    scale: number;
    invert: boolean;
  };
  /** Traced polygons waiting to be placed (centered at origin). */
  imageImportPolygons: Vec2[][] | null;
  /** Text tool configuration. */
  textConfig: {
    text: string;
    fontFamily: string;
    fontSize: number;
    bold: boolean;
    italic: boolean;
    simplifyTolerance: number;
    useGoogleFonts: boolean;
  };
  /** Text tool polygons waiting to be placed (centered at origin). */
  textPolygons: Vec2[][] | null;
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
  objectsAnimation: boolean;
  /** Name of the currently selected LGR ("Default" for the local file). */
  selectedLgr: string;
  /** Whether an LGR is currently being downloaded/parsed. */
  lgrLoading: boolean;
  /** Test mode configuration. */
  testConfig: TestConfig;
  /** Show the validation error panel. */
  showValidationPanel: boolean;
  /** Whether the select tool is in vertex-editing sub-mode. */
  selectVertexEditing: boolean;
  setSelectVertexEditing: (editing: boolean) => void;
  /** Callback to toggle vertex editing from UI (set by SelectTool). */
  toggleSelectVertexEditing: (() => void) | null;
  setToggleSelectVertexEditing: (fn: (() => void) | null) => void;
  /** Show the property panel drawer (mobile/tablet). */
  showPropPanel: boolean;
  setShowPropPanel: (show: boolean) => void;
  /** Show the properties panel (level/editor/test props). */
  showPropertiesPanel: boolean;
  setShowPropertiesPanel: (show: boolean) => void;
  /** Show the full-screen Level screen. */
  showLevelScreen: boolean;
  setShowLevelScreen: (show: boolean) => void;

  // ── Interface settings ──
  /** Whether the top actions bar is visible. */
  showActionsBar: boolean;
  setShowActionsBar: (show: boolean) => void;
  /** Button display mode for the side toolbar. */
  toolbarViewMode: ButtonViewMode;
  setToolbarViewMode: (mode: ButtonViewMode) => void;
  /** Button display mode for the top actions bar. */
  actionsBarViewMode: ButtonViewMode;
  setActionsBarViewMode: (mode: ButtonViewMode) => void;
  /** Button size for the side toolbar. */
  toolbarButtonSize: ButtonSize;
  setToolbarButtonSize: (size: ButtonSize) => void;
  /** Button size for the top actions bar. */
  actionsBarButtonSize: ButtonSize;
  setActionsBarButtonSize: (size: ButtonSize) => void;
  /** Toolbar tool order and visibility config. */
  toolbarConfig: ToolbarItemConfig[];
  setToolbarItemVisibility: (id: ToolId, visible: boolean) => void;
  reorderToolbarItem: (fromIndex: number, toIndex: number) => void;
  resetToolbarConfig: () => void;
  /** Whether the status bar is visible. */
  showStatusBar: boolean;
  setShowStatusBar: (show: boolean) => void;
  /** Whether the minimap overlay is visible. */
  showMinimap: boolean;
  setShowMinimap: (show: boolean) => void;
  /** Minimap opacity (0–100). */
  minimapOpacity: number;
  setMinimapOpacity: (value: number) => void;

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
  setShapeConfig: (config: Partial<ShapeConfig>) => void;

  // ── Image import config ──
  setImageImportConfig: (config: Partial<EditorState['imageImportConfig']>) => void;
  setImageImportPolygons: (polygons: Vec2[][] | null) => void;

  // ── Text config ──
  setTextConfig: (config: Partial<EditorState['textConfig']>) => void;
  setTextPolygons: (polygons: Vec2[][] | null) => void;

  // ── Draw polygon config ──
  setDrawPolygonGrass: (grass: boolean) => void;

  // ── Auto-grass config ──
  setAutoGrassConfig: (config: Partial<AutoGrassConfig>) => void;

  // ── Clipboard ──
  copySelection: () => void;
  cutSelection: () => void;
  pasteClipboard: () => void;

  // ── Library ──
  placeFromLibrary: (item: { polygons: Array<{ grass: boolean; vertices: Vec2[] }>; objects: Array<{ x: number; y: number; type: ObjectType; gravity: Gravity; animation: number }>; pictures: Array<{ x: number; y: number; name: string; texture: string; mask: string; clip: Clip; distance: number }> }) => void;

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
  setLevelLgr: (lgr: string) => void;
  setFileName: (fileName: string) => void;
  mergeSelectedPolygons: () => void;
  splitSelectedPolygons: () => void;
  autoGrassSelectedPolygons: () => void;
  mirrorHorizontally: () => void;
  mirrorVertically: () => void;

  // ── Topology ──
  setTopologyErrors: (errors: TopologyError[]) => void;

  // ── Display toggles ──
  setShowGrass: (show: boolean) => void;
  setShowPictures: (show: boolean) => void;
  setShowTextures: (show: boolean) => void;
  setShowObjects: (show: boolean) => void;
  setObjectsAnimation: (show: boolean) => void;
  setSelectedLgr: (name: string) => void;
  setLgrLoading: (loading: boolean) => void;

  // ── Test config ──
  setTestConfig: (config: Partial<TestConfig>) => void;

  // ── Validation panel ──
  setShowValidationPanel: (show: boolean) => void;

  // ── Testing ──
  startTesting: () => void;
  stopTesting: () => void;

  // ── Command palette ──
  commandPaletteOpen: boolean;
  setCommandPaletteOpen: (open: boolean) => void;

  // ── Hotkeys panel ──
  showHotkeysPanel: boolean;
  setShowHotkeysPanel: (show: boolean) => void;

  // ── Undo batching ──
  beginUndoBatch: () => void;
  endUndoBatch: () => void;
  cancelUndoBatch: () => void;
}

// ── Store implementation ────────────────────────────────────────────────────

export const useEditorStore = create<EditorState>()(
  temporal(
    (set, get) => ({
      // Initial state
      level: null,
      fileName: null,
      activeTool: ToolId.Select,
      toolPanelCollapsed: false,
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
        clip: Clip.Sky,
        distance: 600,
      },
      maskConfig: {
        texture: 'stone3',
        mask: 'maskbig',
        clip: Clip.Ground,
        distance: 600,
      },
      topologyErrors: [],
      isDirty: false,
      cursorWorld: null,
      pipeRadius: 1.0,
      pipeRoundCorners: false,
      shapeConfig: { type: 'square', topRatio: 50, tiltAngle: 30, segments: 400, sides: 5, starPoints: 5, starDepth: 50, randomMinVertices: 5, randomMaxVertices: 10 },
      imageImportConfig: {
        threshold: 128,
        simplifyTolerance: 2.0,
        scale: 0.1,
        invert: false,
      },
      imageImportPolygons: null,
      textConfig: {
        text: '',
        fontFamily: 'Arial',
        fontSize: 3,
        bold: false,
        italic: false,
        simplifyTolerance: 1.5,
        useGoogleFonts: false,
      },
      textPolygons: null,
      clipboard: null,
      drawPolygonGrass: false,
      autoGrassConfig: { thickness: 0.5, maxAngle: 40 },
      isTesting: false,
      testConfig: { ...DEFAULT_TEST_CONFIG },
      selectVertexEditing: false,
      setSelectVertexEditing: (editing) => set({ selectVertexEditing: editing }),
      toggleSelectVertexEditing: null,
      setToggleSelectVertexEditing: (fn) => set({ toggleSelectVertexEditing: fn }),
      showValidationPanel: false,
      showPropPanel: false,
      showPropertiesPanel: false,
      showLevelScreen: true,
      showActionsBar: true,
      toolbarViewMode: 'both' as ButtonViewMode,
      actionsBarViewMode: 'both' as ButtonViewMode,
      toolbarButtonSize: 'small' as ButtonSize,
      actionsBarButtonSize: 'small' as ButtonSize,
      toolbarConfig: DEFAULT_TOOLBAR_CONFIG.map(c => ({ ...c })),
      showStatusBar: true,
      showMinimap: true,
      minimapOpacity: 80,
      showGrass: true,
      showPictures: true,
      showTextures: true,
      showObjects: true,
      objectsAnimation: false,
      selectedLgr: 'Default',
      lgrLoading: false,

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

      setActiveTool: (tool) => {
        const { activeTool, toolPanelCollapsed } = get();
        if (tool === activeTool) {
          set({ toolPanelCollapsed: !toolPanelCollapsed });
        } else {
          set({ activeTool: tool, toolPanelCollapsed: false });
        }
      },

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

      setShapeConfig: (config) => set((s) => ({ shapeConfig: { ...s.shapeConfig, ...config } })),

      // ── Image import config ──

      setImageImportConfig: (config) =>
        set((s) => ({ imageImportConfig: { ...s.imageImportConfig, ...config } })),
      setImageImportPolygons: (polygons) =>
        set({ imageImportPolygons: polygons }),

      // ── Text config ──

      setTextConfig: (config) =>
        set((s) => ({ textConfig: { ...s.textConfig, ...config } })),
      setTextPolygons: (polygons) =>
        set({ textPolygons: polygons }),

      // ── Draw polygon config ──

      setDrawPolygonGrass: (grass) => set({ drawPolygonGrass: grass }),

      // ── Auto-grass config ──

      setAutoGrassConfig: (config) =>
        set((s) => ({ autoGrassConfig: { ...s.autoGrassConfig, ...config } })),

      // ── Clipboard ──

      copySelection: () => {
        const { level, selection } = get();
        if (!level) return;
        if (selection.polygonIndices.size === 0 && selection.objectIndices.size === 0) return;
        const { polygons, objects } = extractSelectionData(level, selection);
        set({ clipboard: { polygons, objects, pasteCount: 0 } });
      },

      cutSelection: () => {
        const { level, selection } = get();
        if (!level) return;
        if (selection.polygonIndices.size === 0 && selection.objectIndices.size === 0) return;
        const { polygons, objects } = extractSelectionData(level, selection);

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

      // ── Library ──

      placeFromLibrary: (item) => {
        const { level, viewport } = get();
        if (!level) return;
        if (item.polygons.length === 0 && item.objects.length === 0 && item.pictures.length === 0) return;

        const clone = cloneLevel(level);
        const cx = viewport.centerX;
        const cy = viewport.centerY;

        const polyStartIdx = clone.polygons.length;
        const objStartIdx = clone.objects.length;
        const picStartIdx = clone.pictures.length;

        for (const pd of item.polygons) {
          const poly = new Polygon();
          poly.id = generateId();
          poly.grass = pd.grass;
          poly.vertices = pd.vertices.map(
            (v) => new Position(v.x + cx, v.y + cy),
          );
          clone.polygons.push(poly);
        }

        for (const od of item.objects) {
          const obj = new ElmaObject();
          obj.id = generateId();
          obj.position = new Position(od.x + cx, od.y + cy);
          obj.type = od.type;
          obj.gravity = od.gravity;
          obj.animation = od.animation;
          clone.objects.push(obj);
        }

        for (const pd of item.pictures) {
          const pic = new Picture();
          pic.name = pd.name;
          pic.texture = pd.texture;
          pic.mask = pd.mask;
          pic.position = new Position(pd.x + cx, pd.y + cy);
          pic.clip = pd.clip;
          pic.distance = pd.distance;
          clone.pictures.push(pic);
        }

        const sel: SelectionState = {
          polygonIndices: new Set(
            item.polygons.map((_, i) => polyStartIdx + i),
          ),
          vertexIndices: new Map(
            item.polygons.map((pd, i) => [
              polyStartIdx + i,
              new Set(pd.vertices.map((_, vi) => vi)),
            ]),
          ),
          objectIndices: new Set(
            item.objects.map((_, i) => objStartIdx + i),
          ),
          pictureIndices: new Set(
            item.pictures.map((_, i) => picStartIdx + i),
          ),
        };

        set({
          level: clone,
          isDirty: true,
          selection: sel,
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

      setLevelLgr: (lgr) => {
        const { level } = get();
        if (!level) return;
        const clone = cloneLevel(level);
        clone.lgr = lgr;
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

          // Determine if this polygon creates air or ground (even-odd nesting).
          // Use a point on the polygon's edge (slightly inward) instead of the
          // centroid — the centroid can accidentally land inside a child polygon.
          const isCW = computeSignedArea(verts) > 0;
          const edgeDx = verts[1]!.x - verts[0]!.x;
          const edgeDy = verts[1]!.y - verts[0]!.y;
          const edgeLen = Math.sqrt(edgeDx * edgeDx + edgeDy * edgeDy);
          let testPoint = {
            x: (verts[0]!.x + verts[1]!.x) / 2,
            y: (verts[0]!.y + verts[1]!.y) / 2,
          };
          if (edgeLen > 1e-10) {
            const eps = 0.001;
            // Inward normal: CW → (-dy, dx), CCW → (dy, -dx)
            const nx = isCW ? -edgeDy / edgeLen : edgeDy / edgeLen;
            const ny = isCW ? edgeDx / edgeLen : -edgeDx / edgeLen;
            testPoint = { x: testPoint.x + nx * eps, y: testPoint.y + ny * eps };
          }
          let containingCount = 0;
          for (let i = 0; i < level.polygons.length; i++) {
            if (i === idx) continue;
            const other = level.polygons[i]!;
            if (other.grass || other.vertices.length < 3) continue;
            if (pointInPolygon(testPoint, other.vertices)) containingCount++;
          }
          const isAir = containingCount % 2 === 0;

          // For island polygons (ground), reverse vertices so the algorithm
          // correctly identifies top edges as grassable instead of bottom edges.
          const finalVerts = isCW !== isAir ? [...verts].reverse() : verts;
          const strips = autoGrassPolygon(finalVerts, autoGrassConfig);
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

      mirrorHorizontally: () => {
        const { level, selection } = get();
        if (!level) return;
        const hasSel = selection.polygonIndices.size > 0 || selection.objectIndices.size > 0 || selection.pictureIndices.size > 0;
        if (!hasSel) return;

        // Collect all selected points to compute bounding box center
        const points: Vec2[] = [];
        for (const pi of selection.polygonIndices) {
          for (const v of level.polygons[pi]!.vertices) points.push(v);
        }
        for (const oi of selection.objectIndices) {
          points.push(level.objects[oi]!.position);
        }
        for (const pi of selection.pictureIndices) {
          points.push(level.pictures[pi]!.position);
        }
        if (points.length === 0) return;

        const bbox = computeBBox(points);
        const cx = (bbox.minX + bbox.maxX) / 2;

        const clone = cloneLevel(level);
        for (const pi of selection.polygonIndices) {
          const poly = clone.polygons[pi]!;
          for (const v of poly.vertices) {
            v.x = 2 * cx - v.x;
          }
          poly.vertices.reverse();
        }
        for (const oi of selection.objectIndices) {
          const obj = clone.objects[oi]!;
          obj.position = new Position(2 * cx - obj.position.x, obj.position.y);
        }
        for (const pi of selection.pictureIndices) {
          const pic = clone.pictures[pi]!;
          pic.position = new Position(2 * cx - pic.position.x, pic.position.y);
        }
        set({ level: clone, isDirty: true });
      },

      mirrorVertically: () => {
        const { level, selection } = get();
        if (!level) return;
        const hasSel = selection.polygonIndices.size > 0 || selection.objectIndices.size > 0 || selection.pictureIndices.size > 0;
        if (!hasSel) return;

        const points: Vec2[] = [];
        for (const pi of selection.polygonIndices) {
          for (const v of level.polygons[pi]!.vertices) points.push(v);
        }
        for (const oi of selection.objectIndices) {
          points.push(level.objects[oi]!.position);
        }
        for (const pi of selection.pictureIndices) {
          points.push(level.pictures[pi]!.position);
        }
        if (points.length === 0) return;

        const bbox = computeBBox(points);
        const cy = (bbox.minY + bbox.maxY) / 2;

        const clone = cloneLevel(level);
        for (const pi of selection.polygonIndices) {
          const poly = clone.polygons[pi]!;
          for (const v of poly.vertices) {
            v.y = 2 * cy - v.y;
          }
          poly.vertices.reverse();
        }
        for (const oi of selection.objectIndices) {
          const obj = clone.objects[oi]!;
          obj.position = new Position(obj.position.x, 2 * cy - obj.position.y);
        }
        for (const pi of selection.pictureIndices) {
          const pic = clone.pictures[pi]!;
          pic.position = new Position(pic.position.x, 2 * cy - pic.position.y);
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
      setObjectsAnimation: (show) => set({ objectsAnimation: show }),
      setSelectedLgr: (name) => set({ selectedLgr: name }),
      setLgrLoading: (loading) => set({ lgrLoading: loading }),

      // ── Test config ──

      setTestConfig: (config) => set((s) => ({ testConfig: { ...s.testConfig, ...config } })),

      // ── Validation panel ──

      setShowValidationPanel: (show) => set({ showValidationPanel: show }),
      setShowPropPanel: (show) => set({ showPropPanel: show }),
      setShowPropertiesPanel: (show) => set({ showPropertiesPanel: show }),
      setShowLevelScreen: (show) => set({ showLevelScreen: show }),

      // ── Interface settings ──
      setShowActionsBar: (show) => set({ showActionsBar: show }),
      setToolbarViewMode: (mode) => set({ toolbarViewMode: mode }),
      setActionsBarViewMode: (mode) => set({ actionsBarViewMode: mode }),
      setToolbarButtonSize: (size) => set({ toolbarButtonSize: size }),
      setActionsBarButtonSize: (size) => set({ actionsBarButtonSize: size }),
      setToolbarItemVisibility: (id, visible) => set((s) => ({
        toolbarConfig: s.toolbarConfig.map(c => c.id === id ? { ...c, visible } : c),
      })),
      reorderToolbarItem: (fromIndex, toIndex) => set((s) => {
        if (fromIndex === toIndex) return s;
        const config = [...s.toolbarConfig];
        const [item] = config.splice(fromIndex, 1);
        config.splice(toIndex, 0, item!);
        return { toolbarConfig: config };
      }),
      resetToolbarConfig: () => set({ toolbarConfig: DEFAULT_TOOLBAR_CONFIG.map(c => ({ ...c })) }),
      setShowStatusBar: (show) => set({ showStatusBar: show }),
      setShowMinimap: (show) => set({ showMinimap: show }),
      setMinimapOpacity: (value) => set({ minimapOpacity: Math.max(0, Math.min(100, value)) }),

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

      // ── Command palette ──────────────────────────────────────────────
      commandPaletteOpen: false,
      setCommandPaletteOpen: (open) => set({ commandPaletteOpen: open }),

      // ── Hotkeys panel ──────────────────────────────────────────────
      showHotkeysPanel: false,
      setShowHotkeysPanel: (show) => set({ showHotkeysPanel: show }),

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
      cancelUndoBatch: () => {
        if (undoBatchSnapshot) {
          // Restore level while tracking is still paused (no undo entry)
          set({ level: undoBatchSnapshot.level, fileName: undoBatchSnapshot.fileName });
          undoBatchSnapshot = null;
        }
        useEditorStore.temporal.getState().resume();
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
    objectsAnimation: state.objectsAnimation,
    selectedLgr: state.selectedLgr,
    autoGrassConfig: state.autoGrassConfig,
    grid: state.grid,
    toolbarConfig: state.toolbarConfig,
    showStatusBar: state.showStatusBar,
    showActionsBar: state.showActionsBar,
    toolbarViewMode: state.toolbarViewMode,
    actionsBarViewMode: state.actionsBarViewMode,
    toolbarButtonSize: state.toolbarButtonSize,
    actionsBarButtonSize: state.actionsBarButtonSize,
    showMinimap: state.showMinimap,
    minimapOpacity: state.minimapOpacity,
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
      patch.objectsAnimation = props.objectsAnimation ?? false;
      if (props.selectedLgr) patch.selectedLgr = props.selectedLgr;
      if (Array.isArray(props.toolbarConfig)) {
        patch.toolbarConfig = reconcileToolbarConfig(props.toolbarConfig);
      }
      if (props.autoGrassConfig) patch.autoGrassConfig = props.autoGrassConfig;
      if (props.grid) patch.grid = props.grid;
      if (props.showStatusBar !== undefined) patch.showStatusBar = props.showStatusBar;
      if (props.showActionsBar !== undefined) patch.showActionsBar = props.showActionsBar;
      if (props.toolbarViewMode) patch.toolbarViewMode = props.toolbarViewMode;
      if (props.actionsBarViewMode) patch.actionsBarViewMode = props.actionsBarViewMode;
      if (props.toolbarButtonSize) patch.toolbarButtonSize = props.toolbarButtonSize;
      if (props.actionsBarButtonSize) patch.actionsBarButtonSize = props.actionsBarButtonSize;
      if (props.showMinimap !== undefined) patch.showMinimap = props.showMinimap;
      if (props.minimapOpacity !== undefined && isFinite(props.minimapOpacity)) patch.minimapOpacity = props.minimapOpacity;
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
