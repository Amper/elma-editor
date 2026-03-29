import { useState, useRef, useEffect } from 'react';
import { useEditorStore, extractSelectionData } from '@/state/editorStore';
import { useLibraryStore } from '@/state/libraryStore';
import { undo, redo } from '@/state/selectors';
import { computeBBox } from '@/utils/geometry';
import type { TestMode } from '@/types';
import {
  ArrowUDownLeftIcon,
  ArrowUUpRightIcon,
  BookmarkSimpleIcon,
  CaretDownIcon,
  CheckIcon,
  ClipboardIcon,
  CopyIcon, FarmIcon,
  FlipHorizontalIcon,
  FlipVerticalIcon,
  PencilSimpleIcon,
  PlayIcon,
  PolygonIcon,
  ScissorsIcon, SlidersHorizontalIcon, SubtractSquareIcon,
  TrashIcon,
  UniteSquareIcon,
  UsersIcon,
  WarningIcon,
} from "@phosphor-icons/react";
import { ToolId } from '@/types';
import { SaveToLibraryModal } from './SaveToLibraryModal';

function keyLabel(code: string): string {
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Arrow')) return code.slice(5);
  return code;
}

function TestModeButton({
  level,
  isTesting,
  testMode,
  setTestMode,
  startTesting,
  testRestartKey,
  hasDebugStart,
  showIcon,
  showLabel,
  iconSize,
}: {
  level: boolean;
  isTesting: boolean;
  testMode: TestMode;
  setTestMode: (mode: TestMode) => void;
  startTesting: () => void;
  testRestartKey: string;
  hasDebugStart: boolean;
  showIcon: boolean;
  showLabel: boolean;
  iconSize: number;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const modeLabel = testMode === 'debug' ? 'Debug' : 'Normal';
  const modeColor = testMode === 'debug' ? '#e0a030' : '#6cc66c';

  return (
    <div ref={ref} style={{ position: 'relative', display: 'inline-flex', alignSelf: 'stretch' }}>
      <button
        onClick={startTesting}
        disabled={!level || isTesting}
        title={`Test Level - ${modeLabel} (${keyLabel(testRestartKey)})`}
        className="btn btn--text"
        style={{ color: modeColor, fontWeight: 700, borderTopRightRadius: 0, borderBottomRightRadius: 0 }}
      >
        {showIcon && <PlayIcon size={iconSize} />}
        {showLabel && <span className="btn--text-label">{testMode === 'debug' ? 'Debug' : 'Test'} ({keyLabel(testRestartKey)})</span>}
      </button>
      <button
        onClick={() => setOpen(!open)}
        disabled={!level || isTesting}
        className="btn btn--text"
        style={{ color: modeColor, padding: '0 4px', borderTopLeftRadius: 0, borderBottomLeftRadius: 0, borderLeft: '1px solid var(--color-border)' }}
        title="Select test mode"
      >
        <CaretDownIcon size={10} />
      </button>
      {open && (
        <div
          style={{
            position: 'absolute',
            top: '100%',
            left: 0,
            zIndex: 100,
            background: 'var(--color-bg-secondary)',
            border: '1px solid var(--color-border)',
            borderRadius: 4,
            padding: 4,
            minWidth: 140,
            boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
          }}
        >
          <button
            className="btn btn--text"
            style={{ width: '100%', textAlign: 'left', padding: '6px 10px', color: testMode === 'normal' ? '#6cc66c' : undefined, fontWeight: testMode === 'normal' ? 700 : 400 }}
            onClick={() => { setTestMode('normal'); setOpen(false); }}
          >
            Normal
          </button>
          <button
            className="btn btn--text"
            style={{ width: '100%', textAlign: 'left', padding: '6px 10px', color: testMode === 'debug' ? '#e0a030' : undefined, fontWeight: testMode === 'debug' ? 700 : 400, opacity: hasDebugStart ? 1 : 0.5 }}
            onClick={() => { setTestMode('debug'); setOpen(false); }}
            title={hasDebugStart ? 'Start from Debug Start position' : 'Place a Debug Start object first'}
          >
            Debug {!hasDebugStart && '(no start)'}
          </button>
        </div>
      )}
    </div>
  );
}

function PolygonActionsMenu({
  canSplit,
  canMerge,
  canAutoGrass,
  canEditVertices,
  selectVertexEditing,
  splitSelectedPolygons,
  mergeSelectedPolygons,
  mirrorHorizontally,
  mirrorVertically,
  autoGrassSelectedPolygons,
  toggleSelectVertexEditing,
  showIcon,
  showLabel,
  iconSize,
}: {
  canSplit: boolean;
  canMerge: boolean;
  canAutoGrass: boolean;
  canEditVertices: boolean;
  selectVertexEditing: boolean;
  splitSelectedPolygons: () => void;
  mergeSelectedPolygons: () => void;
  mirrorHorizontally: () => void;
  mirrorVertically: () => void;
  autoGrassSelectedPolygons: () => void;
  toggleSelectVertexEditing: () => void;
  showIcon: boolean;
  showLabel: boolean;
  iconSize: number;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const run = (fn: () => void) => {
    fn();
    setOpen(false);
  };

  return (
    <div ref={ref} style={{ position: 'relative', display: 'inline-flex', alignSelf: 'stretch' }}>
      <button
        onClick={() => setOpen(!open)}
        className="btn btn--text"
        title="Polygon actions"
      >
        {showIcon && <PolygonIcon size={iconSize} />}
        {showLabel && <span className="btn--text-label">Polygon actions</span>}
        <CaretDownIcon size={10} style={{ marginLeft: 2 }} />
      </button>
      {open && (
        <div
          style={{
            position: 'absolute',
            top: '100%',
            left: 0,
            zIndex: 100,
            background: 'var(--color-bg-secondary)',
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-md)',
            padding: '4px 0',
            minWidth: 180,
            boxShadow: '0 4px 12px rgba(0,0,0,0.25)',
          }}
        >
          {canEditVertices && (
            <button
              className="toolbar-context-menu__item"
              onClick={() => run(toggleSelectVertexEditing)}
            >
              {selectVertexEditing ? <CheckIcon size={14} /> : <PencilSimpleIcon size={14} />}
              <span className="toolbar-context-menu__label">
                {selectVertexEditing ? 'Finish editing vertices' : 'Edit polygon vertices'}
              </span>
            </button>
          )}
          {canEditVertices && <div className="toolbar-context-menu__divider" />}
          <button
            className="toolbar-context-menu__item"
            onClick={() => run(splitSelectedPolygons)}
            disabled={!canSplit}
          >
            <SubtractSquareIcon size={14} />
            <span className="toolbar-context-menu__label">Split</span>
          </button>
          <button
            className="toolbar-context-menu__item"
            onClick={() => run(mergeSelectedPolygons)}
            disabled={!canMerge}
          >
            <UniteSquareIcon size={14} />
            <span className="toolbar-context-menu__label">Merge</span>
          </button>
          <div className="toolbar-context-menu__divider" />
          <button
            className="toolbar-context-menu__item"
            onClick={() => run(mirrorHorizontally)}
          >
            <FlipHorizontalIcon size={14} />
            <span className="toolbar-context-menu__label">Mirror horizontally</span>
          </button>
          <button
            className="toolbar-context-menu__item"
            onClick={() => run(mirrorVertically)}
          >
            <FlipVerticalIcon size={14} />
            <span className="toolbar-context-menu__label">Mirror vertically</span>
          </button>
          <div className="toolbar-context-menu__divider" />
          <button
            className="toolbar-context-menu__item"
            onClick={() => run(autoGrassSelectedPolygons)}
            disabled={!canAutoGrass}
          >
            <FarmIcon size={14} />
            <span className="toolbar-context-menu__label">Auto Grass</span>
            <span className="toolbar-context-menu__shortcut">T</span>
          </button>
        </div>
      )}
    </div>
  );
}

export function MenuBar() {
  const level = useEditorStore((s) => s.level);
  const selection = useEditorStore((s) => s.selection);
  const clipboard = useEditorStore((s) => s.clipboard);
  const isTesting = useEditorStore((s) => s.isTesting);
  const testRestartKey = useEditorStore((s) => s.testConfig.restartKey);
  const copySelection = useEditorStore((s) => s.copySelection);
  const cutSelection = useEditorStore((s) => s.cutSelection);
  const pasteClipboard = useEditorStore((s) => s.pasteClipboard);
  const startTesting = useEditorStore((s) => s.startTesting);
  const testMode = useEditorStore((s) => s.testMode);
  const setTestMode = useEditorStore((s) => s.setTestMode);
  const debugStart = useEditorStore((s) => s.debugStart);
  const mergeSelectedPolygons = useEditorStore((s) => s.mergeSelectedPolygons);
  const splitSelectedPolygons = useEditorStore((s) => s.splitSelectedPolygons);
  const autoGrassSelectedPolygons = useEditorStore((s) => s.autoGrassSelectedPolygons);
  const mirrorHorizontally = useEditorStore((s) => s.mirrorHorizontally);
  const mirrorVertically = useEditorStore((s) => s.mirrorVertically);
  const removePolygons = useEditorStore((s) => s.removePolygons);
  const removeObjects = useEditorStore((s) => s.removeObjects);
  const topologyErrors = useEditorStore((s) => s.topologyErrors);
  const activeTool = useEditorStore((s) => s.activeTool);
  const selectVertexEditing = useEditorStore((s) => s.selectVertexEditing);
  const toggleSelectVertexEditing = useEditorStore((s) => s.toggleSelectVertexEditing);
  const showPropPanel = useEditorStore((s) => s.showPropPanel);
  const setShowPropPanel = useEditorStore((s) => s.setShowPropPanel);
  const showCollabPanel = useEditorStore((s) => s.showCollabPanel);
  const setShowCollabPanel = useEditorStore((s) => s.setShowCollabPanel);
  const isCollaborating = useEditorStore((s) => s.isCollaborating);
  const viewMode = useEditorStore((s) => s.actionsBarViewMode);
  const buttonSize = useEditorStore((s) => s.actionsBarButtonSize);
  const showIcon = viewMode !== 'text';
  const showLabel = viewMode !== 'icons';
  const iconSize = { small: 13, medium: 16, large: 18 }[buttonSize];
  const hasSelection = selection.polygonIds.size > 0 || selection.objectIds.size > 0;

  const deleteSelection = () => {
    if (selection.objectIds.size > 0) {
      removeObjects([...selection.objectIds]);
    }
    if (selection.polygonIds.size > 0) {
      removePolygons([...selection.polygonIds]);
    }
  };
  const canPaste = clipboard !== null;
  const canMerge = selection.polygonIds.size >= 1;
  const canSplit = selection.polygonIds.size >= 1 && selection.polygonIds.size <= 2;
  const canAutoGrass = level != null && level.polygons.some(
    (p) => selection.polygonIds.has(p.id) && !p.grass,
  );
  const canEditVertices = activeTool === ToolId.Select && toggleSelectVertexEditing != null &&
    (selectVertexEditing || selection.polygonIds.size === 1);

  const [showSaveModal, setShowSaveModal] = useState(false);

  const handleSaveConfirm = (name: string) => {
    if (!level) return;
    const data = extractSelectionData(level, selection);
    const points = [
      ...data.polygons.flatMap((p) => p.vertices),
      ...data.objects.map((o) => ({ x: o.x, y: o.y })),
      ...data.pictures.map((p) => ({ x: p.x, y: p.y })),
    ];
    if (points.length === 0) return;
    const bbox = computeBBox(points);
    const cx = (bbox.minX + bbox.maxX) / 2;
    const cy = (bbox.minY + bbox.maxY) / 2;
    const polygons = data.polygons.map((p) => ({
      ...p,
      vertices: p.vertices.map((v) => ({ x: v.x - cx, y: v.y - cy })),
    }));
    const objects = data.objects.map((o) => ({ ...o, x: o.x - cx, y: o.y - cy }));
    const pictures = data.pictures.map((p) => ({ ...p, x: p.x - cx, y: p.y - cy }));
    useLibraryStore.getState().addItem({ name, polygons, objects, pictures });
    setShowSaveModal(false);
  };

  return (
    <>
      <span className="brand">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</span>
      <button onClick={undo} disabled={!level} title="Undo (Ctrl+Z)" className="btn btn--text">
        {showIcon && <ArrowUDownLeftIcon size={iconSize} />}
        {showLabel && <span className="btn--text-label">Undo</span>}
      </button>
      <button onClick={redo} disabled={!level} title="Redo (Ctrl+Y)" className="btn btn--text">
        {showIcon && <ArrowUUpRightIcon size={iconSize} />}
        {showLabel && <span className="btn--text-label">Redo</span>}
      </button>
      <span className="separator" />
      <button onClick={copySelection} disabled={!hasSelection} title="Copy (Ctrl+C)" className="btn btn--text">
        {showIcon && <CopyIcon size={iconSize} />}
        {showLabel && <span className="btn--text-label">Copy</span>}
      </button>
      <button onClick={cutSelection} disabled={!hasSelection} title="Cut (Ctrl+X)" className="btn btn--text">
        {showIcon && <ScissorsIcon size={iconSize} />}
        {showLabel && <span className="btn--text-label">Cut</span>}
      </button>
      <button onClick={deleteSelection} disabled={!hasSelection} title="Delete (Del)" className="btn btn--text">
        {showIcon && <TrashIcon size={iconSize} />}
        {showLabel && <span className="btn--text-label">Delete</span>}
      </button>
      <button onClick={pasteClipboard} disabled={!canPaste} title="Paste (Ctrl+V)" className="btn btn--text">
        {showIcon && <ClipboardIcon size={iconSize} />}
        {showLabel && <span className="btn--text-label">Paste</span>}
      </button>
      <span className="separator" />
      <TestModeButton
        level={!!level}
        isTesting={isTesting}
        testMode={testMode}
        setTestMode={setTestMode}
        startTesting={startTesting}
        testRestartKey={testRestartKey}
        hasDebugStart={!!debugStart}
        showIcon={showIcon}
        showLabel={showLabel}
        iconSize={iconSize}
      />
      {hasSelection && (
        <>
          <span className="separator" />
          <PolygonActionsMenu
            canSplit={canSplit}
            canMerge={canMerge}
            canAutoGrass={canAutoGrass}
            canEditVertices={canEditVertices}
            selectVertexEditing={!!selectVertexEditing}
            splitSelectedPolygons={splitSelectedPolygons}
            mergeSelectedPolygons={mergeSelectedPolygons}
            mirrorHorizontally={mirrorHorizontally}
            mirrorVertically={mirrorVertically}
            autoGrassSelectedPolygons={autoGrassSelectedPolygons}
            toggleSelectVertexEditing={toggleSelectVertexEditing!}
            showIcon={showIcon}
            showLabel={showLabel}
            iconSize={iconSize}
          />
          <button onClick={() => setShowSaveModal(true)} title="Save selection to library" className="btn btn--text">
            {showIcon && <BookmarkSimpleIcon size={iconSize} />}
            {showLabel && <span className="btn--text-label">Save to library</span>}
          </button>
        </>
      )}
      {topologyErrors.length > 0 && (
        <span className="menu-bar__errors pill pill--error">
          <WarningIcon size={14} />
          {topologyErrors.length}
        </span>
      )}
      <button
        className="btn btn--text"
        onClick={() => setShowCollabPanel(!showCollabPanel)}
        title="Toggle collaboration panel"
        style={{ marginLeft: 'auto', position: 'relative' }}
      >
        <UsersIcon size={16} />
        <span className="btn--text-label">Collab</span>
        {isCollaborating && (
          <span
            style={{
              position: 'absolute',
              top: 4,
              right: 4,
              width: 7,
              height: 7,
              borderRadius: '50%',
              background: '#4caf50',
              border: '1px solid var(--color-bg-tertiary)',
            }}
          />
        )}
      </button>
      <button
        className="btn btn--text menu-bar__panel-toggle"
        onClick={() => setShowPropPanel(!showPropPanel)}
        title="Toggle properties panel"
      >
        <SlidersHorizontalIcon size={18} />
      </button>
      {showSaveModal && (
        <SaveToLibraryModal
          onSave={handleSaveConfirm}
          onCancel={() => setShowSaveModal(false)}
        />
      )}
    </>
  );
}
