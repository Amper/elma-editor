import { useEditorStore } from '@/state/editorStore';
import { DEFAULT_TOOLBAR_CONFIG } from '@/state/editorStore';
import { ToolId } from '@/types';
import { useState, useRef, useCallback, useMemo, useEffect } from "react";
import type { ComponentType, DragEvent } from "react";
import type { IconProps } from "@phosphor-icons/react";
import {
  ArchiveIcon,
  ArrowsOutCardinalIcon,
  CheckIcon,
  CirclesThreePlusIcon,
  FileIcon,
  FlowerIcon, ImageIcon, ImageSquareIcon, SquareHalfBottomIcon,
  GearSixIcon,
  PlantIcon,
  PipeIcon,
  PolygonIcon,
  SelectionIcon,
  ShapesIcon,
  TextTIcon,
  ArrowCounterClockwiseIcon,
} from "@phosphor-icons/react";
import { useLibraryStore } from '@/state/libraryStore';
import { Tooltip } from './Tooltip';

const ICON_SIZE = { small: 20, medium: 24, large: 28 } as const;

interface ToolMeta { id: ToolId; label: string; shortcut: string; desc: string; Icon: ComponentType<IconProps> }

const TOOLS: ToolMeta[] = [
  { id: ToolId.Select, label: 'Select', shortcut: 'S', desc: 'Click to select polygons and objects', Icon: SelectionIcon },
  { id: ToolId.DrawPolygon, label: 'Polygon', shortcut: 'D', desc: 'Draw polygons by placing vertices', Icon: PolygonIcon },
  { id: ToolId.DrawGrass, label: 'Grass', shortcut: 'G', desc: 'Draw grass polygons', Icon: PlantIcon },
  { id: ToolId.Vertex, label: 'Vertex', shortcut: 'V', desc: 'Add, move and delete vertices', Icon: CirclesThreePlusIcon },
  { id: ToolId.DrawObject, label: 'Object', shortcut: 'O', desc: 'Place flowers, apples, killers and starts', Icon: FlowerIcon },
  { id: ToolId.Shape, label: 'Shape', shortcut: 'R', desc: 'Draw regular shapes (circle, hexagon...)', Icon: ShapesIcon },
  { id: ToolId.DrawPicture, label: 'Picture', shortcut: 'Q', desc: 'Place LGR picture sprites', Icon: ImageSquareIcon },
  { id: ToolId.DrawMask, label: 'Mask', shortcut: 'M', desc: 'Place textured mask pictures', Icon: SquareHalfBottomIcon },
  { id: ToolId.Pipe, label: 'Pipe', shortcut: 'P', desc: 'Draw pipes along a spine path', Icon: PipeIcon },
  { id: ToolId.Pan, label: 'Move', shortcut: 'H', desc: 'Pan the canvas view', Icon: ArrowsOutCardinalIcon },
  { id: ToolId.ImageImport, label: 'Image', shortcut: 'I', desc: 'Import image contours as polygons', Icon: ImageIcon },
  { id: ToolId.Text, label: 'Text', shortcut: 'X', desc: 'Convert text to polygons', Icon: TextTIcon },
];

const TOOL_MAP = new Map(TOOLS.map(t => [t.id, t]));

export function Toolbar() {
  const level = useEditorStore((s) => s.level);
  const activeTool = useEditorStore((s) => s.activeTool);
  const setActiveTool = useEditorStore((s) => s.setActiveTool);
  const showPropertiesPanel = useEditorStore((s) => s.showPropertiesPanel);
  const setShowPropertiesPanel = useEditorStore((s) => s.setShowPropertiesPanel);
  const showLevelScreen = useEditorStore((s) => s.showLevelScreen);
  const setShowLevelScreen = useEditorStore((s) => s.setShowLevelScreen);
  const viewMode = useEditorStore((s) => s.toolbarViewMode);
  const buttonSize = useEditorStore((s) => s.toolbarButtonSize);
  const toolbarConfig = useEditorStore((s) => s.toolbarConfig);
  const setToolbarItemVisibility = useEditorStore((s) => s.setToolbarItemVisibility);
  const reorderToolbarItem = useEditorStore((s) => s.reorderToolbarItem);
  const resetToolbarConfig = useEditorStore((s) => s.resetToolbarConfig);
  const showLibraryPanel = useLibraryStore((s) => s.showLibraryPanel);
  const showIcon = viewMode !== 'text';
  const showLabel = viewMode !== 'icons';
  const iconSize = ICON_SIZE[buttonSize];

  // Visible tools with their config index for DnD
  const visibleTools = useMemo(() => {
    const result: Array<{ meta: ToolMeta; configIndex: number }> = [];
    toolbarConfig.forEach((c, i) => {
      if (c.visible) {
        const meta = TOOL_MAP.get(c.id);
        if (meta) result.push({ meta, configIndex: i });
      }
    });
    return result;
  }, [toolbarConfig]);

  // ── Drag-and-drop state ──
  const [dragConfigIndex, setDragConfigIndex] = useState<number | null>(null);
  const [dropConfigIndex, setDropConfigIndex] = useState<number | null>(null);
  const dragCounterRef = useRef(0);

  const handleDragStart = useCallback((e: DragEvent, configIndex: number) => {
    setDragConfigIndex(configIndex);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(configIndex));
    // Defer adding dragging class so the drag image isn't affected
    requestAnimationFrame(() => {
      const el = e.target as HTMLElement;
      el.classList.add('btn--dragging');
    });
  }, []);

  const handleDragEnd = useCallback((e: DragEvent) => {
    (e.target as HTMLElement).classList.remove('btn--dragging');
    setDragConfigIndex(null);
    setDropConfigIndex(null);
    dragCounterRef.current = 0;
  }, []);

  const handleDragOver = useCallback((e: DragEvent, configIndex: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (configIndex !== dragConfigIndex) {
      setDropConfigIndex(configIndex);
    }
  }, [dragConfigIndex]);

  const handleDragEnter = useCallback((e: DragEvent, configIndex: number) => {
    e.preventDefault();
    dragCounterRef.current++;
    if (configIndex !== dragConfigIndex) {
      setDropConfigIndex(configIndex);
    }
  }, [dragConfigIndex]);

  const handleDragLeave = useCallback(() => {
    dragCounterRef.current--;
    if (dragCounterRef.current <= 0) {
      setDropConfigIndex(null);
      dragCounterRef.current = 0;
    }
  }, []);

  const handleDrop = useCallback((e: DragEvent, targetConfigIndex: number) => {
    e.preventDefault();
    const fromIndex = dragConfigIndex;
    if (fromIndex !== null && fromIndex !== targetConfigIndex) {
      reorderToolbarItem(fromIndex, targetConfigIndex);
    }
    setDragConfigIndex(null);
    setDropConfigIndex(null);
    dragCounterRef.current = 0;
  }, [dragConfigIndex, reorderToolbarItem]);

  // ── Context menu state ──
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY });
  }, []);

  const closeContextMenu = useCallback(() => {
    setContextMenu(null);
  }, []);

  // Close context menu on Escape
  useEffect(() => {
    if (!contextMenu) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setContextMenu(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [contextMenu]);

  const isDefault = useMemo(() => {
    if (toolbarConfig.length !== DEFAULT_TOOLBAR_CONFIG.length) return false;
    return toolbarConfig.every((c, i) => c.id === DEFAULT_TOOLBAR_CONFIG[i]!.id && c.visible === DEFAULT_TOOLBAR_CONFIG[i]!.visible);
  }, [toolbarConfig]);

  return (
    <>
      <Tooltip label="Level" desc="Properties, file operations, online search">
        <button
          onClick={() => { const next = !showLevelScreen; setShowLevelScreen(next); if (next) { setShowPropertiesPanel(false); useLibraryStore.getState().setShowLibraryPanel(false); } }}
          className={`btn btn--icon${showLevelScreen ? ' btn--active' : ''}`}
        >
          {showIcon && <FileIcon size={iconSize} />}
          {showLabel && <span className="btn--icon-label">Level</span>}
        </button>
      </Tooltip>
      {visibleTools.map(({ meta: t, configIndex }) => (
        <Tooltip key={t.id} label={t.label} shortcut={t.shortcut} desc={t.desc}>
          <button
            draggable
            onDragStart={(e) => handleDragStart(e, configIndex)}
            onDragEnd={handleDragEnd}
            onDragOver={(e) => handleDragOver(e, configIndex)}
            onDragEnter={(e) => handleDragEnter(e, configIndex)}
            onDragLeave={handleDragLeave}
            onDrop={(e) => handleDrop(e, configIndex)}
            onContextMenu={handleContextMenu}
            onClick={() => { setActiveTool(t.id); setShowLevelScreen(false); }}
            disabled={!level}
            className={
              `btn btn--icon`
              + (activeTool === t.id ? ' btn--active' : '')
              + (dragConfigIndex === configIndex ? ' btn--dragging' : '')
              + (dropConfigIndex === configIndex && dragConfigIndex !== configIndex ? ' btn--drop-indicator' : '')
            }
          >
            {showIcon && <t.Icon size={iconSize} />}
            {showLabel && <span className="btn--icon-label">{t.label}</span>}
          </button>
        </Tooltip>
      ))}
      <div className="toolbar__spacer" onContextMenu={handleContextMenu} />
      <Tooltip label="Library" desc="Saved polygon and object templates">
        <button
          onClick={() => {
            const next = !showLibraryPanel;
            useLibraryStore.getState().setShowLibraryPanel(next);
            if (next) { setShowPropertiesPanel(false); setShowLevelScreen(false); }
          }}
          disabled={!level}
          className={`btn btn--icon${showLibraryPanel ? ' btn--active' : ''}`}
        >
          {showIcon && <ArchiveIcon size={iconSize} />}
          {showLabel && <span className="btn--icon-label">Library</span>}
        </button>
      </Tooltip>
      <Tooltip label="Settings" desc="Level, editor and test settings">
        <button
          onClick={() => { const next = !showPropertiesPanel; setShowPropertiesPanel(next); if (next) { setShowLevelScreen(false); useLibraryStore.getState().setShowLibraryPanel(false); } }}
          disabled={!level}
          className={`btn btn--icon${showPropertiesPanel ? ' btn--active' : ''}`}
        >
          {showIcon && <GearSixIcon size={iconSize} />}
          {showLabel && <span className="btn--icon-label">Settings</span>}
        </button>
      </Tooltip>

      {contextMenu && (
        <>
          <div className="toolbar-context-menu-backdrop" onClick={closeContextMenu} />
          <ToolbarContextMenu
            x={contextMenu.x}
            y={contextMenu.y}
            toolbarConfig={toolbarConfig}
            onToggleVisibility={(id, visible) => setToolbarItemVisibility(id, visible)}
            onReset={resetToolbarConfig}
            onClose={closeContextMenu}
            isDefault={isDefault}
          />
        </>
      )}
    </>
  );
}

function ToolbarContextMenu({ x, y, toolbarConfig, onToggleVisibility, onReset, onClose, isDefault }: {
  x: number;
  y: number;
  toolbarConfig: Array<{ id: ToolId; visible: boolean }>;
  onToggleVisibility: (id: ToolId, visible: boolean) => void;
  onReset: () => void;
  onClose: () => void;
  isDefault: boolean;
}) {
  const menuRef = useRef<HTMLDivElement>(null);

  // Adjust position to stay within viewport
  const [pos, setPos] = useState({ left: x, top: y });
  useEffect(() => {
    const el = menuRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    let left = x;
    let top = y;
    if (rect.right > window.innerWidth) left = window.innerWidth - rect.width - 8;
    if (rect.bottom > window.innerHeight) top = window.innerHeight - rect.height - 8;
    if (left < 0) left = 8;
    if (top < 0) top = 8;
    if (left !== pos.left || top !== pos.top) setPos({ left, top });
  }, [x, y]);

  return (
    <div
      ref={menuRef}
      className="toolbar-context-menu"
      style={{ left: pos.left, top: pos.top }}
    >
      {toolbarConfig.map((c) => {
        const meta = TOOL_MAP.get(c.id);
        if (!meta) return null;
        return (
          <button
            key={c.id}
            className="toolbar-context-menu__item"
            onClick={() => onToggleVisibility(c.id, !c.visible)}
          >
            <span className="toolbar-context-menu__check">
              {c.visible && <CheckIcon size={14} />}
            </span>
            <meta.Icon size={16} />
            <span className="toolbar-context-menu__label">{meta.label}</span>
            <span className="toolbar-context-menu__shortcut">{meta.shortcut}</span>
          </button>
        );
      })}
      <div className="toolbar-context-menu__divider" />
      <button
        className="toolbar-context-menu__item"
        onClick={() => { onReset(); onClose(); }}
        disabled={isDefault}
      >
        <span className="toolbar-context-menu__check">
          <ArrowCounterClockwiseIcon size={14} />
        </span>
        <span className="toolbar-context-menu__label">Reset to defaults</span>
      </button>
    </div>
  );
}
