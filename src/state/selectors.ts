import { useEditorStore } from './editorStore';

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

export const useIsCollaborating = () => useEditorStore((s) => s.isCollaborating);
export const useRemoteUsers = () => useEditorStore((s) => s.remoteUsers);
export const useShowCollabPanel = () => useEditorStore((s) => s.showCollabPanel);

/** Call these outside of React components (imperative). */
export function undo() {
  useEditorStore.temporal.getState().undo();
}

export function redo() {
  useEditorStore.temporal.getState().redo();
}
