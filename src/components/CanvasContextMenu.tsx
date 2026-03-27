import { useRef, useState, useEffect, useCallback } from 'react';
import { useEditorStore, extractSelectionData } from '@/state/editorStore';
import { useLibraryStore } from '@/state/libraryStore';
import { undo, redo } from '@/state/selectors';
import { computeBBox } from '@/utils/geometry';
import {
  ArrowUDownLeftIcon,
  ArrowUUpRightIcon,
  BookmarkSimpleIcon,
  CheckIcon,
  ClipboardIcon,
  CopyIcon,
  FarmIcon,
  FlipHorizontalIcon,
  FlipVerticalIcon,
  PencilSimpleIcon,
  PlayIcon,
  ScissorsIcon,
  SubtractSquareIcon,
  TrashIcon,
  UniteSquareIcon,
} from '@phosphor-icons/react';
import { ToolId } from '@/types';
import { SaveToLibraryModal } from './SaveToLibraryModal';

function keyLabel(code: string): string {
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Arrow')) return code.slice(5);
  return code;
}

interface Props {
  x: number;
  y: number;
  onClose: () => void;
}

export function CanvasContextMenu({ x, y, onClose }: Props) {
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

  const activeTool = useEditorStore((s) => s.activeTool);
  const selectVertexEditing = useEditorStore((s) => s.selectVertexEditing);
  const toggleSelectVertexEditing = useEditorStore((s) => s.toggleSelectVertexEditing);

  const [showSaveModal, setShowSaveModal] = useState(false);

  const hasSelection = selection.polygonIndices.size > 0 || selection.objectIndices.size > 0 || selection.pictureIndices.size > 0;
  const canPaste = clipboard !== null;
  const canMerge = selection.polygonIndices.size >= 1;
  const canSplit = selection.polygonIndices.size >= 1 && selection.polygonIndices.size <= 2;
  const canAutoGrass = level != null && [...selection.polygonIndices].some(
    (i) => level.polygons[i] && !level.polygons[i]!.grass,
  );
  const canEditVertices = activeTool === ToolId.Select && toggleSelectVertexEditing != null &&
    (selectVertexEditing || selection.polygonIndices.size === 1);

  const deleteSelection = () => {
    if (selection.objectIndices.size > 0) removeObjects([...selection.objectIndices]);
    if (selection.polygonIndices.size > 0) removePolygons([...selection.polygonIndices]);
  };

  const handleSaveToLibrary = () => {
    setShowSaveModal(true);
  };

  const handleSaveConfirm = (name: string) => {
    if (!level) return;
    const data = extractSelectionData(level, selection);

    // Normalize coordinates: center at origin
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
    onClose();
  };

  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });

  useEffect(() => {
    const el = menuRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const pad = 8;
    setPos({
      left: Math.min(x, window.innerWidth - rect.width - pad),
      top: Math.min(y, window.innerHeight - rect.height - pad),
    });
  }, [x, y]);

  const handleEscape = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape' && !showSaveModal) onClose();
  }, [onClose, showSaveModal]);

  useEffect(() => {
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [handleEscape]);

  const act = (fn: () => void) => () => { fn(); onClose(); };

  const showConditional = canMerge || canSplit || canAutoGrass || hasSelection || canEditVertices;

  return (
    <>
      <div className="canvas-context-menu-backdrop" onMouseDown={onClose} />
      <div ref={menuRef} className="canvas-context-menu" style={{ left: pos.left, top: pos.top }}>
        <button className="canvas-context-menu__item" onClick={act(undo)} disabled={!level}>
          <ArrowUDownLeftIcon size={14} />
          <span className="canvas-context-menu__label">Undo</span>
          <span className="canvas-context-menu__shortcut">Ctrl+Z</span>
        </button>
        <button className="canvas-context-menu__item" onClick={act(redo)} disabled={!level}>
          <ArrowUUpRightIcon size={14} />
          <span className="canvas-context-menu__label">Redo</span>
          <span className="canvas-context-menu__shortcut">Ctrl+Y</span>
        </button>
        <div className="canvas-context-menu__divider" />
        <button className="canvas-context-menu__item" onClick={act(copySelection)} disabled={!hasSelection}>
          <CopyIcon size={14} />
          <span className="canvas-context-menu__label">Copy</span>
          <span className="canvas-context-menu__shortcut">Ctrl+C</span>
        </button>
        <button className="canvas-context-menu__item" onClick={act(cutSelection)} disabled={!hasSelection}>
          <ScissorsIcon size={14} />
          <span className="canvas-context-menu__label">Cut</span>
          <span className="canvas-context-menu__shortcut">Ctrl+X</span>
        </button>
        <button className="canvas-context-menu__item" onClick={act(deleteSelection)} disabled={!hasSelection}>
          <TrashIcon size={14} />
          <span className="canvas-context-menu__label">Delete</span>
          <span className="canvas-context-menu__shortcut">Del</span>
        </button>
        <button className="canvas-context-menu__item" onClick={act(pasteClipboard)} disabled={!canPaste}>
          <ClipboardIcon size={14} />
          <span className="canvas-context-menu__label">Paste</span>
          <span className="canvas-context-menu__shortcut">Ctrl+V</span>
        </button>
        <div className="canvas-context-menu__divider" />
        <button className="canvas-context-menu__item" onClick={act(startTesting)} disabled={!level || isTesting}>
          <PlayIcon size={14} />
          <span className="canvas-context-menu__label">Test / Play</span>
          <span className="canvas-context-menu__shortcut">{keyLabel(testRestartKey)}</span>
        </button>
        {showConditional && <div className="canvas-context-menu__divider" />}
        {canEditVertices && (
          <button className="canvas-context-menu__item" onClick={act(toggleSelectVertexEditing!)}>
            {selectVertexEditing ? <CheckIcon size={14} /> : <PencilSimpleIcon size={14} />}
            <span className="canvas-context-menu__label">
              {selectVertexEditing ? 'Finish editing vertices' : 'Edit polygon vertices'}
            </span>
          </button>
        )}
        {canSplit && (
          <button className="canvas-context-menu__item" onClick={act(splitSelectedPolygons)}>
            <SubtractSquareIcon size={14} />
            <span className="canvas-context-menu__label">Split polygons</span>
          </button>
        )}
        {canMerge && (
          <button className="canvas-context-menu__item" onClick={act(mergeSelectedPolygons)}>
            <UniteSquareIcon size={14} />
            <span className="canvas-context-menu__label">Merge polygons</span>
          </button>
        )}
        {hasSelection && (
          <button className="canvas-context-menu__item" onClick={act(mirrorHorizontally)}>
            <FlipHorizontalIcon size={14} />
            <span className="canvas-context-menu__label">Mirror horizontally</span>
          </button>
        )}
        {hasSelection && (
          <button className="canvas-context-menu__item" onClick={act(mirrorVertically)}>
            <FlipVerticalIcon size={14} />
            <span className="canvas-context-menu__label">Mirror vertically</span>
          </button>
        )}
        {hasSelection && (
          <button className="canvas-context-menu__item" onClick={handleSaveToLibrary}>
            <BookmarkSimpleIcon size={14} />
            <span className="canvas-context-menu__label">Save to library</span>
          </button>
        )}
        {canAutoGrass && (
          <button className="canvas-context-menu__item" onClick={act(autoGrassSelectedPolygons)}>
            <FarmIcon size={14} />
            <span className="canvas-context-menu__label">Auto Grass</span>
          </button>
        )}
      </div>
      {showSaveModal && (
        <SaveToLibraryModal
          onSave={handleSaveConfirm}
          onCancel={() => { setShowSaveModal(false); onClose(); }}
        />
      )}
    </>
  );
}
