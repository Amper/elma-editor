import { FileControls } from './FileControls';
import { useEditorStore } from '@/state/editorStore';
import { undo, redo } from '@/state/selectors';
import {
  ArrowUDownLeftIcon,
  ArrowUUpRightIcon,
  ClipboardIcon,
  CopyIcon, FarmIcon,
  PlayIcon,
  ScissorsIcon, SlidersHorizontalIcon, SubtractSquareIcon,
  TrashIcon,
  UniteSquareIcon,
  UsersIcon,
  WarningIcon,
} from "@phosphor-icons/react";

export function MenuBar() {
  const level = useEditorStore((s) => s.level);
  const selection = useEditorStore((s) => s.selection);
  const clipboard = useEditorStore((s) => s.clipboard);
  const isTesting = useEditorStore((s) => s.isTesting);
  const copySelection = useEditorStore((s) => s.copySelection);
  const cutSelection = useEditorStore((s) => s.cutSelection);
  const pasteClipboard = useEditorStore((s) => s.pasteClipboard);
  const startTesting = useEditorStore((s) => s.startTesting);
  const mergeSelectedPolygons = useEditorStore((s) => s.mergeSelectedPolygons);
  const splitSelectedPolygons = useEditorStore((s) => s.splitSelectedPolygons);
  const autoGrassSelectedPolygons = useEditorStore((s) => s.autoGrassSelectedPolygons);
  const removePolygons = useEditorStore((s) => s.removePolygons);
  const removeObjects = useEditorStore((s) => s.removeObjects);
  const topologyErrors = useEditorStore((s) => s.topologyErrors);
  const showPropPanel = useEditorStore((s) => s.showPropPanel);
  const setShowPropPanel = useEditorStore((s) => s.setShowPropPanel);
  const showCollabPanel = useEditorStore((s) => s.showCollabPanel);
  const setShowCollabPanel = useEditorStore((s) => s.setShowCollabPanel);
  const isCollaborating = useEditorStore((s) => s.isCollaborating);
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
      <span className="brand">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</span>
      <FileControls />
      <span className="separator" />
      <button onClick={undo} disabled={!level} title="Undo (Ctrl+Z)" className="btn btn--text">
        <ArrowUDownLeftIcon size={16} />
        <span className="btn--text-label">Undo</span>
      </button>
      <button onClick={redo} disabled={!level} title="Redo (Ctrl+Y)" className="btn btn--text">
        <ArrowUUpRightIcon size={16} />
        <span className="btn--text-label">Redo</span>
      </button>
      <span className="separator" />
      <button onClick={copySelection} disabled={!hasSelection} title="Copy (Ctrl+C)" className="btn btn--text">
        <CopyIcon size={16} />
        <span className="btn--text-label">Copy</span>
      </button>
      <button onClick={cutSelection} disabled={!hasSelection} title="Cut (Ctrl+X)" className="btn btn--text">
        <ScissorsIcon size={16} />
        <span className="btn--text-label">Cut</span>
      </button>
      <button onClick={pasteClipboard} disabled={!canPaste} title="Paste (Ctrl+V)" className="btn btn--text">
        <ClipboardIcon size={16} />
        <span className="btn--text-label">Paste</span>
      </button>
      <button onClick={deleteSelection} disabled={!hasSelection} title="Delete (Del)" className="btn btn--text">
        <TrashIcon size={16} />
        <span className="btn--text-label">Delete</span>
      </button>
      <span className="separator" />
      <button onClick={startTesting} disabled={!level || isTesting} title="Test Level (F5)" className="btn btn--text">
        <PlayIcon size={16} />
        <span className="btn--text-label">Test</span>
      </button>
      {canMerge && (
        <>
          <span className="separator" />
          <button
            onClick={mergeSelectedPolygons}
            title="Merge selected polygons (M)"
            className="btn btn--text"
          >
            <UniteSquareIcon size={16} />
            <span className="btn--text-label">Merge</span>
          </button>
        </>
      )}
      {canSplit && (
        <button
          onClick={splitSelectedPolygons}
          title="Split selected polygons (X)"
          className="btn btn--text"
        >
          <SubtractSquareIcon size={16} />
          <span className="btn--text-label">Split</span>
        </button>
      )}
      {canAutoGrass && (
        <button
          onClick={autoGrassSelectedPolygons}
          title="Generate grass for selected polygons (T)"
          className="btn btn--text"
        >
          <FarmIcon size={16} />
          <span className="btn--text-label">Auto Grass</span>
        </button>
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
