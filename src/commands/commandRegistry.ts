import { useEditorStore } from '@/state/editorStore';
import { undo, redo } from '@/state/selectors';
import { downloadLevel } from '@/io/fileIO';
import { ToolId } from '@/types';

export type CommandCategory = 'Tools' | 'File' | 'Edit' | 'Selection' | 'Polygon' | 'View' | 'Testing';

export interface Command {
  id: string;
  label: string;
  category: CommandCategory;
  shortcut?: string | (() => string);
  execute: () => void;
  isEnabled: () => boolean;
}

export function getShortcut(cmd: Command): string | undefined {
  if (typeof cmd.shortcut === 'function') return cmd.shortcut();
  return cmd.shortcut;
}

const isMac = navigator.platform.includes('Mac');
const mod = isMac ? '\u2318' : 'Ctrl+';

function keyLabel(code: string): string {
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Arrow')) return code.slice(5);
  return code;
}

function hasLevel(): boolean {
  return useEditorStore.getState().level !== null;
}

function hasSelection(): boolean {
  const s = useEditorStore.getState().selection;
  return s.polygonIds.size > 0 || s.objectIds.size > 0 || s.pictureIds.size > 0;
}

function hasPolygonSelection(): boolean {
  return useEditorStore.getState().selection.polygonIds.size > 0;
}

export const COMMANDS: Command[] = [
  // ── Tools ──
  { id: 'tool.select', label: 'Select Tool', category: 'Tools', shortcut: 'S',
    execute: () => useEditorStore.getState().setActiveTool(ToolId.Select),
    isEnabled: hasLevel },
  { id: 'tool.draw-polygon', label: 'Polygon Tool', category: 'Tools', shortcut: 'D',
    execute: () => useEditorStore.getState().setActiveTool(ToolId.DrawPolygon),
    isEnabled: hasLevel },
  { id: 'tool.draw-grass', label: 'Grass Tool', category: 'Tools', shortcut: 'G',
    execute: () => useEditorStore.getState().setActiveTool(ToolId.DrawGrass),
    isEnabled: hasLevel },
  { id: 'tool.vertex', label: 'Vertex Tool', category: 'Tools', shortcut: 'V',
    execute: () => useEditorStore.getState().setActiveTool(ToolId.Vertex),
    isEnabled: hasLevel },
  { id: 'tool.draw-object', label: 'Object Tool', category: 'Tools', shortcut: 'O',
    execute: () => useEditorStore.getState().setActiveTool(ToolId.DrawObject),
    isEnabled: hasLevel },
  { id: 'tool.shape', label: 'Shape Tool', category: 'Tools', shortcut: 'R',
    execute: () => useEditorStore.getState().setActiveTool(ToolId.Shape),
    isEnabled: hasLevel },
  { id: 'tool.draw-picture', label: 'Picture Tool', category: 'Tools', shortcut: 'Q',
    execute: () => useEditorStore.getState().setActiveTool(ToolId.DrawPicture),
    isEnabled: hasLevel },
  { id: 'tool.draw-mask', label: 'Mask Tool', category: 'Tools', shortcut: 'M',
    execute: () => useEditorStore.getState().setActiveTool(ToolId.DrawMask),
    isEnabled: hasLevel },
  { id: 'tool.pipe', label: 'Pipe Tool', category: 'Tools', shortcut: 'P',
    execute: () => useEditorStore.getState().setActiveTool(ToolId.Pipe),
    isEnabled: hasLevel },
  { id: 'tool.pan', label: 'Pan Tool', category: 'Tools', shortcut: 'H',
    execute: () => useEditorStore.getState().setActiveTool(ToolId.Pan),
    isEnabled: hasLevel },
  { id: 'tool.image-import', label: 'Image Import Tool', category: 'Tools', shortcut: 'I',
    execute: () => useEditorStore.getState().setActiveTool(ToolId.ImageImport),
    isEnabled: hasLevel },
  { id: 'tool.text', label: 'Text Tool', category: 'Tools', shortcut: 'X',
    execute: () => useEditorStore.getState().setActiveTool(ToolId.Text),
    isEnabled: hasLevel },

  // ── File ──
  { id: 'file.new', label: 'New Level', category: 'File', shortcut: `${mod}N`,
    execute: () => useEditorStore.getState().newLevel(),
    isEnabled: () => true },
  { id: 'file.open', label: 'Open Level', category: 'File', shortcut: `${mod}O`,
    execute: () => {}, // handled by CommandPalette component (file input)
    isEnabled: () => true },
  { id: 'file.save', label: 'Save Level', category: 'File', shortcut: `${mod}S`,
    execute: () => {
      const { level, fileName } = useEditorStore.getState();
      if (level && fileName) downloadLevel(level, fileName);
    },
    isEnabled: hasLevel },

  // ── Edit ──
  { id: 'edit.undo', label: 'Undo', category: 'Edit', shortcut: `${mod}Z`,
    execute: () => undo(),
    isEnabled: hasLevel },
  { id: 'edit.redo', label: 'Redo', category: 'Edit', shortcut: `${mod}Y`,
    execute: () => redo(),
    isEnabled: hasLevel },
  { id: 'edit.copy', label: 'Copy', category: 'Edit', shortcut: `${mod}C`,
    execute: () => useEditorStore.getState().copySelection(),
    isEnabled: hasSelection },
  { id: 'edit.cut', label: 'Cut', category: 'Edit', shortcut: `${mod}X`,
    execute: () => useEditorStore.getState().cutSelection(),
    isEnabled: hasSelection },
  { id: 'edit.paste', label: 'Paste', category: 'Edit', shortcut: `${mod}V`,
    execute: () => useEditorStore.getState().pasteClipboard(),
    isEnabled: () => useEditorStore.getState().clipboard !== null },
  { id: 'edit.delete', label: 'Delete', category: 'Edit', shortcut: 'Del',
    execute: () => {
      const s = useEditorStore.getState();
      const sel = s.selection;
      if (sel.objectIds.size > 0) s.removeObjects([...sel.objectIds]);
      if (sel.pictureIds.size > 0) s.removePictures([...sel.pictureIds]);
      if (sel.polygonIds.size > 0) s.removePolygons([...sel.polygonIds]);
    },
    isEnabled: hasSelection },

  // ── Selection ──
  { id: 'selection.all', label: 'Select All', category: 'Selection', shortcut: `${mod}A`,
    execute: () => {
      const store = useEditorStore.getState();
      if (!store.level) return;
      const visiblePolygons = store.level.polygons.filter(
        (p: any) => store.showGrass || !p.grass,
      );
      store.setSelection({
        polygonIds: new Set(visiblePolygons.map((p: any) => p.id)),
        vertexSelections: new Map(
          visiblePolygons.map((p: any) => [
            p.id,
            new Set(p.vertices.map((_: any, vi: number) => vi)),
          ]),
        ),
        objectIds: store.showObjects
          ? new Set(store.level.objects.map((o: any) => o.id))
          : new Set<string>(),
        pictureIds: new Set(
          store.level.pictures
            .filter((p: any) => {
              const isTexMask = !!(p.texture && p.mask);
              return isTexMask ? store.showTextures : store.showPictures;
            })
            .map((p: any) => p.id),
        ),
      });
    },
    isEnabled: hasLevel },
  { id: 'selection.clear', label: 'Clear Selection', category: 'Selection', shortcut: 'Esc',
    execute: () => useEditorStore.getState().clearSelection(),
    isEnabled: hasSelection },

  // ── Polygon ──
  { id: 'polygon.merge', label: 'Merge Polygons', category: 'Polygon',
    execute: () => useEditorStore.getState().mergeSelectedPolygons(),
    isEnabled: () => useEditorStore.getState().selection.polygonIds.size >= 2 },
  { id: 'polygon.split', label: 'Split Polygons', category: 'Polygon',
    execute: () => useEditorStore.getState().splitSelectedPolygons(),
    isEnabled: hasPolygonSelection },
  { id: 'polygon.auto-grass', label: 'Auto Grass', category: 'Polygon', shortcut: 'T',
    execute: () => useEditorStore.getState().autoGrassSelectedPolygons(),
    isEnabled: hasPolygonSelection },
  { id: 'polygon.mirror-h', label: 'Mirror Horizontally', category: 'Polygon',
    execute: () => useEditorStore.getState().mirrorHorizontally(),
    isEnabled: hasSelection },
  { id: 'polygon.mirror-v', label: 'Mirror Vertically', category: 'Polygon',
    execute: () => useEditorStore.getState().mirrorVertically(),
    isEnabled: hasSelection },

  // ── View ──
  { id: 'view.grid', label: 'Toggle Grid', category: 'View', shortcut: 'G',
    execute: () => {
      const s = useEditorStore.getState();
      s.setGrid({ visible: !s.grid.visible });
    },
    isEnabled: () => true },
  { id: 'view.grass', label: 'Toggle Grass', category: 'View',
    execute: () => {
      const s = useEditorStore.getState();
      s.setShowGrass(!s.showGrass);
    },
    isEnabled: hasLevel },
  { id: 'view.pictures', label: 'Toggle Pictures', category: 'View',
    execute: () => {
      const s = useEditorStore.getState();
      s.setShowPictures(!s.showPictures);
    },
    isEnabled: hasLevel },
  { id: 'view.objects', label: 'Toggle Objects', category: 'View',
    execute: () => {
      const s = useEditorStore.getState();
      s.setShowObjects(!s.showObjects);
    },
    isEnabled: hasLevel },
  { id: 'view.textures', label: 'Toggle Textures', category: 'View',
    execute: () => {
      const s = useEditorStore.getState();
      s.setShowTextures(!s.showTextures);
    },
    isEnabled: hasLevel },
  { id: 'view.properties', label: 'Toggle Properties Panel', category: 'View',
    execute: () => {
      const s = useEditorStore.getState();
      s.setShowPropertiesPanel(!s.showPropertiesPanel);
    },
    isEnabled: () => true },
  { id: 'view.level-screen', label: 'Toggle Level Screen', category: 'View',
    execute: () => {
      const s = useEditorStore.getState();
      s.setShowLevelScreen(!s.showLevelScreen);
    },
    isEnabled: () => true },

  // ── Testing ──
  { id: 'testing.start', label: 'Start Test', category: 'Testing',
    shortcut: () => keyLabel(useEditorStore.getState().testConfig.restartKey),
    execute: () => useEditorStore.getState().startTesting(),
    isEnabled: () => hasLevel() && !useEditorStore.getState().isTesting },
];
