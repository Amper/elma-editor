import './App.css';
import { EditorCanvas } from '@/canvas/EditorCanvas';
import { MenuBar } from '@/components/MenuBar';
import { Toolbar } from '@/components/Toolbar';
import { PropertyPanel } from '@/components/PropertyPanel';
import { PropertiesPanel } from '@/components/PropertiesPanel';
import { LibraryPanel } from '@/components/LibraryPanel';
import { CollabPanel } from '@/components/CollabPanel';
import { LevelScreen } from '@/components/LevelScreen';
import { StatusBar } from '@/components/StatusBar';
import { GameOverlay } from '@/game/GameOverlay';
import { Minimap } from '@/components/Minimap';
import { CommandPalette } from '@/components/CommandPalette';
import { HotkeysPanel } from '@/components/HotkeysPanel';
import { useState, useEffect, useCallback } from 'react';
import { useEditorStore } from '@/state/editorStore';
import { useLibraryStore } from '@/state/libraryStore';
import { ToolId } from '@/types';

const TOOLS_WITH_PANEL = new Set<ToolId>([
  ToolId.Pipe, ToolId.Shape, ToolId.ImageImport, ToolId.Text,
  ToolId.DrawObject, ToolId.DrawPicture, ToolId.DrawMask,
]);

export function App() {
  const isTesting = useEditorStore((s) => s.isTesting);
  const showPropPanel = useEditorStore((s) => s.showPropPanel);
  const setShowPropPanel = useEditorStore((s) => s.setShowPropPanel);
  const showPropertiesPanel = useEditorStore((s) => s.showPropertiesPanel);
  const setShowPropertiesPanel = useEditorStore((s) => s.setShowPropertiesPanel);
  const showLevelScreen = useEditorStore((s) => s.showLevelScreen);
  const level = useEditorStore((s) => s.level);
  const activeTool = useEditorStore((s) => s.activeTool);
  const toolPanelCollapsed = useEditorStore((s) => s.toolPanelCollapsed);
  const selection = useEditorStore((s) => s.selection);

  const toolbarViewMode = useEditorStore((s) => s.toolbarViewMode);
  const toolbarButtonSize = useEditorStore((s) => s.toolbarButtonSize);
  const showActionsBar = useEditorStore((s) => s.showActionsBar);
  const setShowActionsBar = useEditorStore((s) => s.setShowActionsBar);
  const actionsBarViewMode = useEditorStore((s) => s.actionsBarViewMode);
  const actionsBarButtonSize = useEditorStore((s) => s.actionsBarButtonSize);

  const showStatusBar = useEditorStore((s) => s.showStatusBar);
  const setShowStatusBar = useEditorStore((s) => s.setShowStatusBar);

  const showCollabPanel = useEditorStore((s) => s.showCollabPanel);

  const showLibraryPanel = useLibraryStore((s) => s.showLibraryPanel);

  const [actionsBarCtx, setActionsBarCtx] = useState<{ x: number; y: number } | null>(null);
  const [statusBarCtx, setStatusBarCtx] = useState<{ x: number; y: number } | null>(null);

  const handleActionsBarContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setActionsBarCtx({ x: e.clientX, y: e.clientY });
  }, []);

  const handleStatusBarContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setStatusBarCtx({ x: e.clientX, y: e.clientY });
  }, []);

  useEffect(() => {
    if (!actionsBarCtx && !statusBarCtx) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setActionsBarCtx(null);
        setStatusBarCtx(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [actionsBarCtx, statusBarCtx]);

  const hasSelection = selection.polygonIds.size > 0 || selection.objectIds.size > 0 || selection.pictureIds.size > 0;
  const showToolPanel = !!level && !toolPanelCollapsed && (hasSelection || TOOLS_WITH_PANEL.has(activeTool));
  const showChrome = !isTesting && !showLevelScreen;

  return (
    <div className={`app-layout${isTesting ? ' app-layout--testing' : ''}`} style={!isTesting && (!showActionsBar || !showStatusBar) ? { gridTemplateRows: `${showActionsBar ? 'var(--menubar-height)' : '0'} 1fr ${showStatusBar ? 'var(--statusbar-height)' : '0'}` } : undefined}>
      {!isTesting && showActionsBar && (
        <div className="menu-bar" data-view={actionsBarViewMode} data-size={actionsBarButtonSize} onContextMenu={handleActionsBarContextMenu}>
          <MenuBar />
          {actionsBarCtx && (
            <>
              <div className="toolbar-context-menu-backdrop" onClick={() => setActionsBarCtx(null)} />
              <div className="toolbar-context-menu" style={{ left: actionsBarCtx.x, top: actionsBarCtx.y }}>
                <button
                  className="toolbar-context-menu__item"
                  onClick={() => { setShowActionsBar(false); setActionsBarCtx(null); }}
                >
                  <span className="toolbar-context-menu__label">Hide actions bar</span>
                </button>
              </div>
            </>
          )}
        </div>
      )}
      {!isTesting && (
        <div className="toolbar" data-view={toolbarViewMode} data-size={toolbarButtonSize}>
          <Toolbar />
          {showChrome && showPropertiesPanel && (
            <div className="settings-panel">
              <PropertiesPanel />
            </div>
          )}
          {showChrome && showLibraryPanel && (
            <div className="settings-panel">
              <LibraryPanel />
            </div>
          )}
          {showChrome && showToolPanel && (
            <div className={`prop-panel${showPropPanel ? ' prop-panel--open' : ''}`}>
              <PropertyPanel />
            </div>
          )}
        </div>
      )}
      <div className="canvas-area" style={{ position: 'relative' }}>
        <EditorCanvas />
        {isTesting && <GameOverlay />}
        {showLevelScreen && <LevelScreen />}
        <Minimap />
        <CollabPanel hidden={!showCollabPanel} />
      </div>
      {showChrome && (
        <>
          <div
            className={`prop-panel-backdrop${showPropPanel ? ' prop-panel-backdrop--visible' : ''}`}
            onClick={() => setShowPropPanel(false)}
          />
        </>
      )}
      {showChrome && showPropertiesPanel && (
        <div
          className="settings-panel-backdrop"
          onClick={() => setShowPropertiesPanel(false)}
        />
      )}
      {showChrome && showLibraryPanel && (
        <div
          className="settings-panel-backdrop"
          onClick={() => useLibraryStore.getState().setShowLibraryPanel(false)}
        />
      )}
      {!isTesting && showStatusBar && (
        <div className="status-bar" onContextMenu={handleStatusBarContextMenu}>
          <StatusBar />
          {statusBarCtx && (
            <>
              <div className="toolbar-context-menu-backdrop" onClick={() => setStatusBarCtx(null)} />
              <div className="toolbar-context-menu" style={{ left: statusBarCtx.x, top: statusBarCtx.y }}>
                <button
                  className="toolbar-context-menu__item"
                  onClick={() => { setShowStatusBar(false); setStatusBarCtx(null); }}
                >
                  <span className="toolbar-context-menu__label">Hide statusbar</span>
                </button>
              </div>
            </>
          )}
        </div>
      )}
      <CommandPalette />
      <HotkeysPanel />
    </div>
  );
}
