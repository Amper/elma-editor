import { useState, useRef, useEffect } from 'react';
import { useEditorStore } from '@/state/editorStore';
import { undo, redo } from '@/state/selectors';
import type { TestMode } from '@/types';
import {
  ArrowUDownLeftIcon,
  ArrowUUpRightIcon,
  CaretDownIcon,
  ClipboardIcon,
  CopyIcon, FarmIcon,
  FlipHorizontalIcon,
  FlipVerticalIcon,
  PlayIcon,
  ScissorsIcon, SlidersHorizontalIcon, SubtractSquareIcon,
  TrashIcon,
  UniteSquareIcon,
  UsersIcon,
  WarningIcon,
} from "@phosphor-icons/react";

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
          {canSplit && (
            <button
              onClick={splitSelectedPolygons}
              title="Split selected polygons (X)"
              className="btn btn--text"
            >
              {showIcon && <SubtractSquareIcon size={iconSize} />}
              {showLabel && <span className="btn--text-label">Split</span>}
            </button>
          )}
          {canMerge && (
            <button
              onClick={mergeSelectedPolygons}
              title="Merge selected polygons (M)"
              className="btn btn--text"
            >
              {showIcon && <UniteSquareIcon size={iconSize} />}
              {showLabel && <span className="btn--text-label">Merge</span>}
            </button>
          )}
          <button
            onClick={mirrorHorizontally}
            title="Mirror horizontally"
            className="btn btn--text"
          >
            {showIcon && <FlipHorizontalIcon size={iconSize} />}
            {showLabel && <span className="btn--text-label">Mirror H</span>}
          </button>
          <button
            onClick={mirrorVertically}
            title="Mirror vertically"
            className="btn btn--text"
          >
            {showIcon && <FlipVerticalIcon size={iconSize} />}
            {showLabel && <span className="btn--text-label">Mirror V</span>}
          </button>
          {canAutoGrass && (
            <button
              onClick={autoGrassSelectedPolygons}
              title="Generate grass for selected polygons (T)"
              className="btn btn--text"
            >
              {showIcon && <FarmIcon size={iconSize} />}
              {showLabel && <span className="btn--text-label">Auto Grass</span>}
            </button>
          )}
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
    </>
  );
}
