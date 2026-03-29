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
  type TestMode,
  type DebugStartConfig,
  type DebugStartParams,
  type TrajectoryPoint,
} from '@/types';
import { fitLevel } from '@/canvas/viewport';
import { validateTopology } from '@/utils/topology';
import { mergePolygons } from '@/utils/mergePolygons';
import { splitPolygons, selfSplitPolygon } from '@/utils/splitPolygons';
import { autoGrassPolygon, type AutoGrassConfig } from '@/utils/autoGrass';
import { smoothPolygonVertices } from '@/utils/smoothPolygon';
import { simplifyPolygon } from '@/utils/imageTrace';
import { pointInPolygon, computeSignedArea, computeBBox } from '@/utils/geometry';
import { generateId } from '@/utils/generateId';
import { polyIdToIndex, objectIdToIndex, pictureIdToIndex } from '@/utils/idLookup';
import type { Operation } from '@/collab/operations';
import type { CollabClient } from '@/collab/CollabClient';
import type { UserInfo, BikeSnapshot } from '@/collab/protocol';
import { applyOperation } from '@/collab/operationApplier';

// ── Remote user for collab ───────────────────────────────────────────────────

interface RemoteUser extends UserInfo {
  cursor: { x: number; y: number } | null;
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

/** Assign unique IDs to all polygons and objects in a level that lack one. */
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

/** Extract selected polygons, objects and pictures as plain serializable data. */
export function extractSelectionData(level: Level, selection: SelectionState) {
  const polygons = level.polygons.filter(p => selection.polygonIds.has(p.id)).map((p) => ({
    grass: p.grass,
    vertices: p.vertices.map((v) => ({ x: v.x, y: v.y })),
  }));
  const objects = level.objects.filter(o => selection.objectIds.has(o.id)).map((o) => ({
    x: o.position.x,
    y: o.position.y,
    type: o.type,
    gravity: o.gravity,
    animation: o.animation,
  }));
  const pictures = level.pictures.filter(p => selection.pictureIds.has(p.id)).map((p) => ({
    x: p.position.x,
    y: p.position.y,
    name: p.name,
    texture: p.texture,
    mask: p.mask,
    clip: p.clip,
    distance: p.distance,
  }));
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
  /** Normal or debug test mode. */
  testMode: TestMode;
  /** Virtual debug start object (editor-only, not saved to .lev). */
  debugStart: DebugStartConfig | null;
  /** Whether the debug start object is currently selected. */
  debugStartSelected: boolean;
  /** Whether the DrawObject tool is placing a debug start. */
  placingDebugStart: boolean;
  /** Default params for the next debug start placement. */
  debugStartParams: DebugStartParams;
  /** Recorded bike trajectory from last debug test (ephemeral). */
  debugTrajectory: TrajectoryPoint[] | null;
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

  // ── Collab ──
  collabClient: CollabClient | null;
  isCollaborating: boolean;
  remoteUsers: Map<string, RemoteUser>;
  showCollabPanel: boolean;
  setCollabClient: (client: CollabClient | null) => void;
  setShowCollabPanel: (show: boolean) => void;
  applyRemoteOperation: (op: Operation, userId: string) => void;
  loadCollabLevel: (level: Level, users: UserInfo[]) => void;
  addRemoteUser: (user: UserInfo) => void;
  removeRemoteUser: (userId: string) => void;
  updateRemoteUser: (userId: string, data: Partial<{ cursor: { x: number; y: number } | null; selectedPolygonIds: string[]; selectedObjectIds: string[]; activeTool: string }>) => void;
  setRemoteBikeState: (userId: string, bike: BikeSnapshot) => void;
  setRemoteTesting: (userId: string, isTesting: boolean) => void;

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
  setLevelLgr: (lgr: string) => void;
  setFileName: (fileName: string) => void;
  mergeSelectedPolygons: () => void;
  splitSelectedPolygons: () => void;
  autoGrassSelectedPolygons: () => void;
  mirrorHorizontally: () => void;
  mirrorVertically: () => void;
  smoothSelectedPolygons: () => void;
  simplifySelectedPolygons: () => void;

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

  // ── Debug start ──
  setDebugStart: (config: DebugStartConfig | null) => void;
  updateDebugStart: (partial: Partial<DebugStartConfig>) => void;
  removeDebugStart: () => void;
  setTestMode: (mode: TestMode) => void;
  setDebugStartSelected: (selected: boolean) => void;
  setPlacingDebugStart: (placing: boolean) => void;
  setDebugStartParams: (params: Partial<DebugStartParams>) => void;
  setDebugTrajectory: (trajectory: TrajectoryPoint[] | null) => void;

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
    (set, get) => {
      const broadcast = (op: Operation) => {
        const client = get().collabClient;
        if (client?.connected) client.sendOperation(op);
      };

      return ({
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
      testMode: 'normal' as TestMode,
      debugStart: null as DebugStartConfig | null,
      debugStartSelected: false,
      placingDebugStart: false,
      debugStartParams: { gravityDirection: 'down', flipped: false, angle: 0, speed: 0, speedAngle: 0 } as DebugStartParams,
      debugTrajectory: null as TrajectoryPoint[] | null,
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
      collabClient: null,
      isCollaborating: false,
      remoteUsers: new Map(),
      showCollabPanel: false,

      // ── Level I/O ──

      loadLevel: (level, fileName) => {
        assignLevelIds(level);
        set({
          level,
          fileName,
          isDirty: false,
          selection: emptySelection(),
          topologyErrors: [],
          debugStart: null,
          debugStartSelected: false,
          debugTrajectory: null,
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
          debugStart: null,
          debugStartSelected: false,
          debugTrajectory: null,
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
        if (selection.polygonIds.size === 0 && selection.objectIds.size === 0) return;
        const { polygons, objects } = extractSelectionData(level, selection);
        set({ clipboard: { polygons, objects, pasteCount: 0 } });
      },

      cutSelection: () => {
        const { level, selection } = get();
        if (!level) return;
        if (selection.polygonIds.size === 0 && selection.objectIds.size === 0) return;
        const { polygons, objects } = extractSelectionData(level, selection);

        // Then delete + set clipboard in one go
        const clone = cloneLevel(level);
        clone.polygons = clone.polygons.filter(p => !selection.polygonIds.has(p.id));
        clone.objects = clone.objects.filter(o => !selection.objectIds.has(o.id));

        set({
          level: clone,
          isDirty: true,
          selection: emptySelection(),
          clipboard: { polygons, objects, pasteCount: 0 },
        });
        const ops: Operation[] = [];
        if (selection.polygonIds.size > 0) ops.push({ type: 'removePolygons', ids: [...selection.polygonIds] });
        if (selection.objectIds.size > 0) ops.push({ type: 'removeObjects', ids: [...selection.objectIds] });
        if (ops.length === 1) broadcast(ops[0]!);
        else if (ops.length > 1) broadcast({ type: 'batch', operations: ops });
      },

      pasteClipboard: () => {
        const { level, clipboard } = get();
        if (!level || !clipboard) return;
        if (clipboard.polygons.length === 0 && clipboard.objects.length === 0) return;

        const offset = 0.5 * (clipboard.pasteCount + 1);
        const clone = cloneLevel(level);

        // Track IDs of newly added items for selection
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
            newPolyIds.map((id, i) => [
              id,
              new Set(clipboard.polygons[i]!.vertices.map((_, vi) => vi)),
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
        const pasteOps: Operation[] = [];
        for (let i = 0; i < newPolyIds.length; i++) {
          const pd = clipboard.polygons[i]!;
          pasteOps.push({ type: 'addPolygon', id: newPolyIds[i]!, grass: pd.grass, vertices: pd.vertices.map(v => ({ x: v.x + offset, y: v.y + offset })) });
        }
        for (let i = 0; i < newObjIds.length; i++) {
          const od = clipboard.objects[i]!;
          pasteOps.push({ type: 'addObject', id: newObjIds[i]!, x: od.x + offset, y: od.y + offset, objectType: od.type, gravity: od.gravity, animation: od.animation });
        }
        if (pasteOps.length === 1) broadcast(pasteOps[0]!);
        else if (pasteOps.length > 1) broadcast({ type: 'batch', operations: pasteOps });
      },

      // ── Library ──

      placeFromLibrary: (item) => {
        const { level, viewport } = get();
        if (!level) return;
        if (item.polygons.length === 0 && item.objects.length === 0 && item.pictures.length === 0) return;

        const clone = cloneLevel(level);
        const cx = viewport.centerX;
        const cy = viewport.centerY;

        const newPolyIds: string[] = [];
        const newObjIds: string[] = [];
        const newPicIds: string[] = [];

        for (const pd of item.polygons) {
          const poly = new Polygon();
          poly.id = generateId();
          poly.grass = pd.grass;
          poly.vertices = pd.vertices.map(
            (v) => new Position(v.x + cx, v.y + cy),
          );
          clone.polygons.push(poly);
          newPolyIds.push(poly.id);
        }

        for (const od of item.objects) {
          const obj = new ElmaObject();
          obj.id = generateId();
          obj.position = new Position(od.x + cx, od.y + cy);
          obj.type = od.type;
          obj.gravity = od.gravity;
          obj.animation = od.animation;
          clone.objects.push(obj);
          newObjIds.push(obj.id);
        }

        for (const pd of item.pictures) {
          const pic = new Picture();
          pic.id = generateId();
          pic.name = pd.name;
          pic.texture = pd.texture;
          pic.mask = pd.mask;
          pic.position = new Position(pd.x + cx, pd.y + cy);
          pic.clip = pd.clip;
          pic.distance = pd.distance;
          clone.pictures.push(pic);
          newPicIds.push(pic.id);
        }

        const sel: SelectionState = {
          polygonIds: new Set(newPolyIds),
          vertexSelections: new Map(
            newPolyIds.map((id, i) => [
              id,
              new Set(item.polygons[i]!.vertices.map((_, vi) => vi)),
            ]),
          ),
          objectIds: new Set(newObjIds),
          pictureIds: new Set(newPicIds),
        };

        set({
          level: clone,
          isDirty: true,
          selection: sel,
        });
        const libOps: Operation[] = [];
        for (let i = 0; i < newPolyIds.length; i++) {
          const pd = item.polygons[i]!;
          libOps.push({ type: 'addPolygon', id: newPolyIds[i]!, grass: pd.grass, vertices: pd.vertices.map(v => ({ x: v.x + cx, y: v.y + cy })) });
        }
        for (let i = 0; i < newObjIds.length; i++) {
          const od = item.objects[i]!;
          libOps.push({ type: 'addObject', id: newObjIds[i]!, x: od.x + cx, y: od.y + cy, objectType: od.type, gravity: od.gravity, animation: od.animation });
        }
        for (let i = 0; i < newPicIds.length; i++) {
          const pd = item.pictures[i]!;
          libOps.push({ type: 'addPicture', id: newPicIds[i]!, x: pd.x + cx, y: pd.y + cy, name: pd.name, clip: pd.clip, distance: pd.distance, texture: pd.texture || undefined, mask: pd.mask || undefined });
        }
        if (libOps.length === 1) broadcast(libOps[0]!);
        else if (libOps.length > 1) broadcast({ type: 'batch', operations: libOps });
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
        broadcast({ type: 'addPolygon', id: poly.id, grass: poly.grass, vertices: poly.vertices.map(v => ({ x: v.x, y: v.y })) });
      },

      addPolygons: (data) => {
        const { level } = get();
        if (!level || data.length === 0) return;
        const clone = cloneLevel(level);
        const newPolygons: Polygon[] = [];
        for (const d of data) {
          const poly = new Polygon();
          poly.id = generateId();
          poly.grass = d.grass;
          poly.vertices = d.vertices.map((v) => new Position(v.x, v.y));
          clone.polygons.push(poly);
          newPolygons.push(poly);
        }
        set({ level: clone, isDirty: true });
        broadcast({ type: 'addPolygons', polygons: newPolygons.map(p => ({ id: p.id, grass: p.grass, vertices: p.vertices.map(v => ({ x: v.x, y: v.y })) })) });
      },

      removePolygons: (ids) => {
        const { level } = get();
        if (!level) return;
        const clone = cloneLevel(level);
        const idSet = new Set(ids);
        clone.polygons = clone.polygons.filter(p => !idSet.has(p.id));
        set({ level: clone, isDirty: true, selection: emptySelection() });
        broadcast({ type: 'removePolygons', ids });
      },

      setPolygonGrass: (id, grass) => {
        const { level } = get();
        if (!level) return;
        const clone = cloneLevel(level);
        const poly = clone.polygons.find(p => p.id === id);
        if (!poly) return;
        poly.grass = grass;
        set({ level: clone, isDirty: true });
        broadcast({ type: 'setPolygonGrass', id, grass });
      },

      setPolygonsGrass: (ids, grass) => {
        const { level } = get();
        if (!level || ids.length === 0) return;
        const clone = cloneLevel(level);
        const idSet = new Set(ids);
        for (const poly of clone.polygons) {
          if (idSet.has(poly.id)) poly.grass = grass;
        }
        set({ level: clone, isDirty: true });
        broadcast({ type: 'setPolygonsGrass', ids, grass });
      },

      moveVertices: (moves) => {
        const { level } = get();
        if (!level) return;
        const clone = cloneLevel(level);
        for (const m of moves) {
          const pi = polyIdToIndex(clone, m.polyId);
          const poly = clone.polygons[pi];
          const vert = poly?.vertices[m.vertIdx];
          if (vert) {
            vert.x = m.newPos.x;
            vert.y = m.newPos.y;
          }
        }
        set({ level: clone, isDirty: true });
        broadcast({ type: 'moveVertices', moves });
      },

      insertVertex: (polyId, afterVertIdx, pos) => {
        const { level } = get();
        if (!level) return;
        const clone = cloneLevel(level);
        const pi = polyIdToIndex(clone, polyId);
        const poly = clone.polygons[pi];
        if (!poly) return;
        poly.vertices.splice(afterVertIdx, 0, new Position(pos.x, pos.y));
        set({ level: clone, isDirty: true });
        broadcast({ type: 'insertVertex', polyId, afterVertIdx, pos });
      },

      removeVertex: (polyId, vertIdx) => {
        const { level } = get();
        if (!level) return;
        const pi = polyIdToIndex(level, polyId);
        const poly = level.polygons[pi];
        if (!poly || poly.vertices.length <= 3) return;
        const clone = cloneLevel(level);
        clone.polygons[pi]!.vertices.splice(vertIdx, 1);
        set({ level: clone, isDirty: true });
        broadcast({ type: 'removeVertex', polyId, vertIdx });
      },

      removeVertices: (verts) => {
        const { level } = get();
        if (!level) return;
        const clone = cloneLevel(level);
        // Process each polygon, removing indices in descending order
        for (const [polyId, vertSet] of verts) {
          const pi = polyIdToIndex(clone, polyId);
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
        broadcast({ type: 'removeVertices', verts: [...verts.entries()].map(([polyId, indices]) => ({ polyId, vertIndices: [...indices] })) });
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
        broadcast({ type: 'addObject', id: obj.id, x: obj.position.x, y: obj.position.y, objectType: obj.type, gravity: obj.gravity, animation: obj.animation });
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
        broadcast({ type: 'addPicture', id: pic.id, x: pic.position.x, y: pic.position.y, name: pic.name, clip: pic.clip, distance: pic.distance, texture: pic.texture || undefined, mask: pic.mask || undefined });
      },

      removePictures: (ids) => {
        const { level } = get();
        if (!level) return;
        const clone = cloneLevel(level);
        const idSet = new Set(ids);
        clone.pictures = clone.pictures.filter(p => !idSet.has(p.id));
        set({ level: clone, isDirty: true, selection: emptySelection() });
        broadcast({ type: 'removePictures', ids });
      },

      movePictures: (moves) => {
        const { level } = get();
        if (!level) return;
        const clone = cloneLevel(level);
        for (const m of moves) {
          const pi = pictureIdToIndex(clone, m.pictureId);
          const pic = clone.pictures[pi];
          if (pic) {
            pic.position = new Position(m.newPos.x, m.newPos.y);
          }
        }
        set({ level: clone, isDirty: true });
        broadcast({ type: 'movePictures', moves });
      },

      updatePictures: (ids, data) => {
        const { level } = get();
        if (!level) return;
        const clone = cloneLevel(level);
        const idSet = new Set(ids);
        for (const pic of clone.pictures) {
          if (!idSet.has(pic.id)) continue;
          if (data.name !== undefined) pic.name = data.name;
          if (data.clip !== undefined) pic.clip = data.clip;
          if (data.distance !== undefined) pic.distance = data.distance;
          if (data.texture !== undefined) pic.texture = data.texture;
          if (data.mask !== undefined) pic.mask = data.mask;
        }
        set({ level: clone, isDirty: true });
        broadcast({ type: 'updatePictures', ids, data });
      },

      removeObjects: (ids) => {
        const { level } = get();
        if (!level) return;
        const clone = cloneLevel(level);
        const idSet = new Set(ids);
        clone.objects = clone.objects.filter(o => !idSet.has(o.id));
        set({ level: clone, isDirty: true, selection: emptySelection() });
        broadcast({ type: 'removeObjects', ids });
      },

      moveObjects: (moves) => {
        const { level } = get();
        if (!level) return;
        const clone = cloneLevel(level);
        for (const m of moves) {
          const oi = objectIdToIndex(clone, m.objectId);
          const obj = clone.objects[oi];
          if (obj) {
            obj.position.x = m.newPos.x;
            obj.position.y = m.newPos.y;
          }
        }
        set({ level: clone, isDirty: true });
        broadcast({ type: 'moveObjects', moves });
      },

      updateObjects: (ids, data) => {
        const { level } = get();
        if (!level || ids.length === 0) return;
        const clone = cloneLevel(level);
        const idSet = new Set(ids);
        for (const obj of clone.objects) {
          if (!idSet.has(obj.id)) continue;
          if (data.type !== undefined) obj.type = data.type;
          if (data.gravity !== undefined) obj.gravity = data.gravity;
          if (data.animation !== undefined) obj.animation = data.animation;
        }
        set({ level: clone, isDirty: true });
        broadcast({ type: 'updateObjects', ids, data });
      },

      setLevelName: (name) => {
        const { level } = get();
        if (!level) return;
        const clone = cloneLevel(level);
        clone.name = name;
        set({ level: clone, isDirty: true });
        broadcast({ type: 'setLevelName', name });
      },

      setLevelGround: (ground) => {
        const { level } = get();
        if (!level) return;
        const clone = cloneLevel(level);
        clone.ground = ground;
        set({ level: clone, isDirty: true });
        broadcast({ type: 'setLevelGround', ground });
      },

      setLevelSky: (sky) => {
        const { level } = get();
        if (!level) return;
        const clone = cloneLevel(level);
        clone.sky = sky;
        set({ level: clone, isDirty: true });
        broadcast({ type: 'setLevelSky', sky });
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
        if (!level || selection.polygonIds.size < 1) return;

        const selectedPolys = level.polygons.filter(p => selection.polygonIds.has(p.id));

        const result = mergePolygons(selectedPolys);
        if (!result) return; // Disjoint or failed — do nothing

        const clone = cloneLevel(level);
        // Remove originals by ID
        clone.polygons = clone.polygons.filter(p => !selection.polygonIds.has(p.id));
        // Add merged polygon(s)
        for (const p of result) p.id = generateId();
        clone.polygons.push(...result);

        set({ level: clone, isDirty: true, selection: emptySelection() });
        broadcast({ type: 'replacePolygons', removeIds: [...selection.polygonIds], add: result.map(p => ({ id: p.id, grass: p.grass, vertices: p.vertices.map(v => ({ x: v.x, y: v.y })) })) });
      },

      splitSelectedPolygons: () => {
        const { level, selection } = get();
        if (!level || selection.polygonIds.size < 1 || selection.polygonIds.size > 2) return;

        const selectedPolys = level.polygons.filter(p => selection.polygonIds.has(p.id));

        let result: ReturnType<typeof splitPolygons>;
        if (selectedPolys.length === 1) {
          // Self-split: split a single self-intersecting polygon
          result = selfSplitPolygon(selectedPolys[0]!);
        } else {
          result = splitPolygons(selectedPolys[0]!, selectedPolys[1]!);
        }
        if (!result) return; // Not self-intersecting / disjoint / failed

        const clone = cloneLevel(level);
        // Remove originals by ID
        clone.polygons = clone.polygons.filter(p => !selection.polygonIds.has(p.id));
        // Add split polygon pieces
        for (const p of result) p.id = generateId();
        clone.polygons.push(...result);

        set({ level: clone, isDirty: true, selection: emptySelection() });
        broadcast({ type: 'replacePolygons', removeIds: [...selection.polygonIds], add: result.map(p => ({ id: p.id, grass: p.grass, vertices: p.vertices.map(v => ({ x: v.x, y: v.y })) })) });
      },

      autoGrassSelectedPolygons: () => {
        const { level, selection, autoGrassConfig } = get();
        if (!level || selection.polygonIds.size < 1) return;

        const grassPolygons: Array<{ grass: boolean; vertices: Vec2[] }> = [];

        for (const poly of level.polygons) {
          if (!selection.polygonIds.has(poly.id)) continue;
          if (poly.grass) continue; // Skip grass polygons

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
          for (const other of level.polygons) {
            if (other.id === poly.id) continue;
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
        const newGrassPolys: Polygon[] = [];
        for (const gp of grassPolygons) {
          const p = new Polygon();
          p.id = generateId();
          p.grass = true;
          p.vertices = gp.vertices.map((v) => new Position(v.x, v.y));
          clone.polygons.push(p);
          newGrassPolys.push(p);
        }

        set({ level: clone, isDirty: true });
        broadcast({ type: 'addPolygons', polygons: newGrassPolys.map(p => ({ id: p.id, grass: p.grass, vertices: p.vertices.map(v => ({ x: v.x, y: v.y })) })) });
      },

      mirrorHorizontally: () => {
        const { level, selection } = get();
        if (!level) return;
        const hasSel = selection.polygonIds.size > 0 || selection.objectIds.size > 0 || selection.pictureIds.size > 0;
        if (!hasSel) return;

        // Collect all selected points to compute bounding box center
        const points: Vec2[] = [];
        for (const poly of level.polygons) {
          if (selection.polygonIds.has(poly.id)) {
            for (const v of poly.vertices) points.push(v);
          }
        }
        for (const obj of level.objects) {
          if (selection.objectIds.has(obj.id)) points.push(obj.position);
        }
        for (const pic of level.pictures) {
          if (selection.pictureIds.has(pic.id)) points.push(pic.position);
        }
        if (points.length === 0) return;

        const bbox = computeBBox(points);
        const cx = (bbox.minX + bbox.maxX) / 2;

        const clone = cloneLevel(level);
        for (const poly of clone.polygons) {
          if (!selection.polygonIds.has(poly.id)) continue;
          for (const v of poly.vertices) {
            v.x = 2 * cx - v.x;
          }
          poly.vertices.reverse();
        }
        for (const obj of clone.objects) {
          if (!selection.objectIds.has(obj.id)) continue;
          obj.position = new Position(2 * cx - obj.position.x, obj.position.y);
        }
        for (const pic of clone.pictures) {
          if (!selection.pictureIds.has(pic.id)) continue;
          pic.position = new Position(2 * cx - pic.position.x, pic.position.y);
        }
        set({ level: clone, isDirty: true });
        {
          const mirrorOps: Operation[] = [];
          const selPolys = clone.polygons.filter(p => selection.polygonIds.has(p.id));
          if (selPolys.length > 0) {
            mirrorOps.push({ type: 'replacePolygons', removeIds: selPolys.map(p => p.id), add: selPolys.map(p => ({ id: p.id, grass: p.grass, vertices: p.vertices.map(v => ({ x: v.x, y: v.y })) })) });
          }
          const objMoves = clone.objects.filter(o => selection.objectIds.has(o.id)).map(o => ({ objectId: o.id, newPos: { x: o.position.x, y: o.position.y } }));
          if (objMoves.length > 0) mirrorOps.push({ type: 'moveObjects', moves: objMoves });
          const picMoves = clone.pictures.filter(p => selection.pictureIds.has(p.id)).map(p => ({ pictureId: p.id, newPos: { x: p.position.x, y: p.position.y } }));
          if (picMoves.length > 0) mirrorOps.push({ type: 'movePictures', moves: picMoves });
          if (mirrorOps.length === 1) broadcast(mirrorOps[0]!);
          else if (mirrorOps.length > 1) broadcast({ type: 'batch', operations: mirrorOps });
        }
      },

      mirrorVertically: () => {
        const { level, selection } = get();
        if (!level) return;
        const hasSel = selection.polygonIds.size > 0 || selection.objectIds.size > 0 || selection.pictureIds.size > 0;
        if (!hasSel) return;

        const points: Vec2[] = [];
        for (const poly of level.polygons) {
          if (selection.polygonIds.has(poly.id)) {
            for (const v of poly.vertices) points.push(v);
          }
        }
        for (const obj of level.objects) {
          if (selection.objectIds.has(obj.id)) points.push(obj.position);
        }
        for (const pic of level.pictures) {
          if (selection.pictureIds.has(pic.id)) points.push(pic.position);
        }
        if (points.length === 0) return;

        const bbox = computeBBox(points);
        const cy = (bbox.minY + bbox.maxY) / 2;

        const clone = cloneLevel(level);
        for (const poly of clone.polygons) {
          if (!selection.polygonIds.has(poly.id)) continue;
          for (const v of poly.vertices) {
            v.y = 2 * cy - v.y;
          }
          poly.vertices.reverse();
        }
        for (const obj of clone.objects) {
          if (!selection.objectIds.has(obj.id)) continue;
          obj.position = new Position(obj.position.x, 2 * cy - obj.position.y);
        }
        for (const pic of clone.pictures) {
          if (!selection.pictureIds.has(pic.id)) continue;
          pic.position = new Position(pic.position.x, 2 * cy - pic.position.y);
        }
        set({ level: clone, isDirty: true });
        {
          const mirrorOps: Operation[] = [];
          const selPolys = clone.polygons.filter(p => selection.polygonIds.has(p.id));
          if (selPolys.length > 0) {
            mirrorOps.push({ type: 'replacePolygons', removeIds: selPolys.map(p => p.id), add: selPolys.map(p => ({ id: p.id, grass: p.grass, vertices: p.vertices.map(v => ({ x: v.x, y: v.y })) })) });
          }
          const objMoves = clone.objects.filter(o => selection.objectIds.has(o.id)).map(o => ({ objectId: o.id, newPos: { x: o.position.x, y: o.position.y } }));
          if (objMoves.length > 0) mirrorOps.push({ type: 'moveObjects', moves: objMoves });
          const picMoves = clone.pictures.filter(p => selection.pictureIds.has(p.id)).map(p => ({ pictureId: p.id, newPos: { x: p.position.x, y: p.position.y } }));
          if (picMoves.length > 0) mirrorOps.push({ type: 'movePictures', moves: picMoves });
          if (mirrorOps.length === 1) broadcast(mirrorOps[0]!);
          else if (mirrorOps.length > 1) broadcast({ type: 'batch', operations: mirrorOps });
        }
      },

      smoothSelectedPolygons: () => {
        const { level, selection } = get();
        if (!level || selection.polygonIds.size === 0) return;

        const clone = cloneLevel(level);
        const smoothed: { id: string; grass: boolean; vertices: { x: number; y: number }[] }[] = [];
        for (const poly of clone.polygons) {
          if (!selection.polygonIds.has(poly.id)) continue;
          poly.vertices = smoothPolygonVertices(poly.vertices);
          smoothed.push({ id: poly.id, grass: poly.grass, vertices: poly.vertices.map(v => ({ x: v.x, y: v.y })) });
        }
        set({ level: clone, isDirty: true });
        if (smoothed.length > 0) {
          broadcast({ type: 'replacePolygons', removeIds: smoothed.map(p => p.id), add: smoothed });
        }
      },

      simplifySelectedPolygons: () => {
        const { level, selection } = get();
        if (!level || selection.polygonIds.size === 0) return;

        const clone = cloneLevel(level);
        const simplified: { id: string; grass: boolean; vertices: { x: number; y: number }[] }[] = [];
        for (const poly of clone.polygons) {
          if (!selection.polygonIds.has(poly.id)) continue;
          if (poly.vertices.length <= 3) continue;
          const bbox = computeBBox(poly.vertices);
          const diag = Math.hypot(bbox.maxX - bbox.minX, bbox.maxY - bbox.minY);
          const tolerance = diag * 0.02;
          const result = simplifyPolygon(poly.vertices.map(v => ({ x: v.x, y: v.y })), tolerance);
          if (result.length >= 3) {
            poly.vertices = result.map(v => new Position(v.x, v.y));
            simplified.push({ id: poly.id, grass: poly.grass, vertices: result });
          }
        }
        if (simplified.length === 0) return;
        set({ level: clone, isDirty: true });
        broadcast({ type: 'replacePolygons', removeIds: simplified.map(p => p.id), add: simplified });
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
        const { level, testMode, debugStart } = get();
        if (!level) return;
        // Debug mode stays active even without a debug start (uses regular start, still records trajectory)
        const effectiveMode = testMode;
        // Run validation synchronously to ensure latest state
        const errors = validateTopology(level.polygons, level.objects, level.pictures);
        // Only block on errors that prevent playing (not missing flower)
        const blocking = errors.filter((e) => e.type !== 'missing-flower');
        if (blocking.length > 0) {
          set({ topologyErrors: errors, showValidationPanel: true });
          return;
        }
        set({ isTesting: true, showValidationPanel: false, testMode: effectiveMode, debugTrajectory: null });
      },
      stopTesting: () => set({ isTesting: false }),

      // ── Debug start ──

      setDebugStart: (config) => set({ debugStart: config }),
      updateDebugStart: (partial) => {
        const { debugStart } = get();
        if (!debugStart) return;
        set({ debugStart: { ...debugStart, ...partial } });
      },
      removeDebugStart: () => set({ debugStart: null, debugStartSelected: false, debugTrajectory: null }),
      setTestMode: (mode) => set({ testMode: mode, ...(mode === 'normal' ? { debugTrajectory: null } : {}) }),
      setDebugStartSelected: (selected) => set({ debugStartSelected: selected }),
      setPlacingDebugStart: (placing) => set({ placingDebugStart: placing }),
      setDebugStartParams: (partial) => set((s) => ({ debugStartParams: { ...s.debugStartParams, ...partial } })),
      setDebugTrajectory: (trajectory) => set({ debugTrajectory: trajectory }),

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

      // ── Collab ──

      setCollabClient: (client) => set({ collabClient: client, isCollaborating: client !== null }),
      setShowCollabPanel: (show) => set({ showCollabPanel: show }),

      applyRemoteOperation: (op, _userId) => {
        const { level } = get();
        if (!level) return;
        const newLevel = applyOperation(level, op);
        set({ level: newLevel });
      },

      loadCollabLevel: (level, users) => {
        const remoteUsers = new Map<string, RemoteUser>();
        for (const u of users) {
          remoteUsers.set(u.userId, {
            ...u,
            cursor: null,
            selectedPolygonIds: new Set(),
            selectedObjectIds: new Set(),
            activeTool: '',
            isTesting: false,
            bikeState: null,
          });
        }
        set({ level, isCollaborating: true, remoteUsers, selection: emptySelection() });
      },

      addRemoteUser: (user) => {
        const users = new Map(get().remoteUsers);
        users.set(user.userId, {
          ...user,
          cursor: null,
          selectedPolygonIds: new Set(),
          selectedObjectIds: new Set(),
          activeTool: '',
          isTesting: false,
          bikeState: null,
        });
        set({ remoteUsers: users });
      },

      removeRemoteUser: (userId) => {
        const users = new Map(get().remoteUsers);
        users.delete(userId);
        set({ remoteUsers: users });
      },

      updateRemoteUser: (userId, data) => {
        const users = new Map(get().remoteUsers);
        const existing = users.get(userId);
        if (!existing) return;
        users.set(userId, {
          ...existing,
          ...(data.cursor !== undefined ? { cursor: data.cursor } : {}),
          ...(data.selectedPolygonIds ? { selectedPolygonIds: new Set(data.selectedPolygonIds) } : {}),
          ...(data.selectedObjectIds ? { selectedObjectIds: new Set(data.selectedObjectIds) } : {}),
          ...(data.activeTool !== undefined ? { activeTool: data.activeTool } : {}),
        });
        set({ remoteUsers: users });
      },

      setRemoteBikeState: (userId, bike) => {
        const users = new Map(get().remoteUsers);
        const existing = users.get(userId);
        if (!existing) return;
        users.set(userId, { ...existing, bikeState: bike });
        set({ remoteUsers: users });
      },

      setRemoteTesting: (userId, isTesting) => {
        const users = new Map(get().remoteUsers);
        const existing = users.get(userId);
        if (!existing) return;
        users.set(userId, { ...existing, isTesting });
        set({ remoteUsers: users });
      },
    });},
    {
      // Only track level data for undo/redo, not UI state
      partialize: (state) => ({
        level: state.level,
        fileName: state.fileName,
        debugStart: state.debugStart,
      }),
      // Compare by reference so that set() calls that don't change
      // level/fileName/debugStart are ignored (otherwise futureStates gets cleared
      // by unrelated state updates like topology validation or cursor moves)
      equality: (pastState, currentState) =>
        pastState.level === currentState.level &&
        pastState.fileName === currentState.fileName &&
        pastState.debugStart === currentState.debugStart,
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
const LS_DEBUG_START_KEY = 'eled_debugStart';
const LS_TEST_MODE_KEY = 'eled_testMode';

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
let prevDebugStart = '';
let prevTestMode = '';

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
  const debugStart = JSON.stringify(state.debugStart);
  const testMode = state.testMode;

  try {
    if (editorProps !== prevEditorProps) {
      prevEditorProps = editorProps;
      localStorage.setItem(LS_EDITOR_PROPS_KEY, editorProps);
    }
    if (testConfig !== prevTestConfig) {
      prevTestConfig = testConfig;
      localStorage.setItem(LS_TEST_CONFIG_KEY, testConfig);
    }
    if (debugStart !== prevDebugStart) {
      prevDebugStart = debugStart;
      if (state.debugStart) {
        localStorage.setItem(LS_DEBUG_START_KEY, debugStart);
      } else {
        localStorage.removeItem(LS_DEBUG_START_KEY);
      }
    }
    if (testMode !== prevTestMode) {
      prevTestMode = testMode;
      localStorage.setItem(LS_TEST_MODE_KEY, testMode);
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

  // Restore debug start
  try {
    const raw = localStorage.getItem(LS_DEBUG_START_KEY);
    if (raw) {
      const ds = JSON.parse(raw);
      if (ds && typeof ds.position === 'object') {
        patch.debugStart = ds;
      }
    }
  } catch {
    localStorage.removeItem(LS_DEBUG_START_KEY);
  }

  // Restore test mode
  try {
    const raw = localStorage.getItem(LS_TEST_MODE_KEY);
    if (raw === 'normal' || raw === 'debug') {
      patch.testMode = raw;
    }
  } catch {
    localStorage.removeItem(LS_TEST_MODE_KEY);
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
