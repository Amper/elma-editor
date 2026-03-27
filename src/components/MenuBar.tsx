import { useEditorStore } from '@/state/editorStore';
import { undo, redo } from '@/state/selectors';
import {
  ArrowUDownLeftIcon,
  ArrowUUpRightIcon,
  ClipboardIcon,
  CopyIcon, FarmIcon,
  FlipHorizontalIcon,
  FlipVerticalIcon,
  PlayIcon,
  ScissorsIcon, SlidersHorizontalIcon, SubtractSquareIcon,
  TrashIcon,
  UniteSquareIcon,
  WarningIcon,
} from "@phosphor-icons/react";

function keyLabel(code: string): string {
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Arrow')) return code.slice(5);
  return code;
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
  const viewMode = useEditorStore((s) => s.actionsBarViewMode);
  const buttonSize = useEditorStore((s) => s.actionsBarButtonSize);
  const showIcon = viewMode !== 'text';
  const showLabel = viewMode !== 'icons';
  const iconSize = { small: 13, medium: 16, large: 18 }[buttonSize];
  const hasSelection = selection.polygonIndices.size > 0 || selection.objectIndices.size > 0;

  const deleteSelection = () => {
    if (selection.objectIndices.size > 0) {
      removeObjects([...selection.objectIndices]);
    }
    if (selection.polygonIndices.size > 0) {
      removePolygons([...selection.polygonIndices]);
    }
  };
  const canPaste = clipboard !== null;
  const canMerge = selection.polygonIndices.size >= 1;
  const canSplit = selection.polygonIndices.size >= 1 && selection.polygonIndices.size <= 2;
  const canAutoGrass = level != null && [...selection.polygonIndices].some(
    (i) => level.polygons[i] && !level.polygons[i]!.grass,
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
      <button onClick={startTesting} disabled={!level || isTesting} title={`Test Level (${keyLabel(testRestartKey)})`} className="btn btn--text" style={{ color: '#6cc66c', fontWeight: 700 }}>
        {showIcon && <PlayIcon size={iconSize} />}
        {showLabel && <span className="btn--text-label">Test / Play ({keyLabel(testRestartKey)})</span>}
      </button>
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
        className="btn btn--text menu-bar__panel-toggle"
        onClick={() => setShowPropPanel(!showPropPanel)}
        title="Toggle properties panel"
      >
        <SlidersHorizontalIcon size={18} />
      </button>
    </>
  );
}
