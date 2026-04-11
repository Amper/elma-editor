import { useEditorStore, getCollabUndoStack } from './editorStore';
import { applyOperation } from '@/collab/operationApplier';

export const useLevel = () => useEditorStore((s) => s.level);
export const useViewport = () => useEditorStore((s) => s.viewport);
export const useActiveTool = () => useEditorStore((s) => s.activeTool);
export const useSelection = () => useEditorStore((s) => s.selection);
export const useTopologyErrors = () => useEditorStore((s) => s.topologyErrors);
export const useGrid = () => useEditorStore((s) => s.grid);
export const useIsDirty = () => useEditorStore((s) => s.isDirty);
export const useCursorWorld = () => useEditorStore((s) => s.cursorWorld);
export const useFileName = () => useEditorStore((s) => s.fileName);
export const useObjectConfig = () => useEditorStore((s) => s.objectConfig);

export const useHasSelection = () =>
  useEditorStore((s) => {
    const sel = s.selection;
    return (
      sel.polygonIds.size > 0 ||
      sel.objectIds.size > 0 ||
      sel.vertexSelections.size > 0
    );
  });

/** Call these outside of React components (imperative). */
export function undo() {
  const state = useEditorStore.getState();
  if (state.isCollaborating) {
    // Collab mode: compute inverse of last local op and broadcast it
    const result = getCollabUndoStack().popUndo();
    if (!result || !state.level) return;
    useEditorStore.temporal.getState().pause();
    const newLevel = applyOperation(state.level, result.inverseOp);
    useEditorStore.setState({ level: newLevel });
    useEditorStore.temporal.getState().resume();
    state.collabClient?.sendOperation(result.inverseOp);
  } else {
    useEditorStore.temporal.getState().undo();
  }
}

export function redo() {
  const state = useEditorStore.getState();
  if (state.isCollaborating) {
    // Collab mode: re-apply the undone operation and broadcast it
    const result = getCollabUndoStack().popRedo();
    if (!result || !state.level) return;
    useEditorStore.temporal.getState().pause();
    const newLevel = applyOperation(state.level, result.op);
    useEditorStore.setState({ level: newLevel });
    useEditorStore.temporal.getState().resume();
    state.collabClient?.sendOperation(result.op);
  } else {
    useEditorStore.temporal.getState().redo();
  }
}
