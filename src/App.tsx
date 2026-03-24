import { useEffect } from 'react';
import './App.css';
import { EditorCanvas } from '@/canvas/EditorCanvas';
import { MenuBar } from '@/components/MenuBar';
import { Toolbar } from '@/components/Toolbar';
import { PropertyPanel } from '@/components/PropertyPanel';
import { CollabPanel } from '@/components/CollabPanel';
import { StatusBar } from '@/components/StatusBar';
import { GameOverlay } from '@/game/GameOverlay';
import { useEditorStore } from '@/state/editorStore';

export function App() {
  const isTesting = useEditorStore((s) => s.isTesting);
  const showPropPanel = useEditorStore((s) => s.showPropPanel);
  const setShowPropPanel = useEditorStore((s) => s.setShowPropPanel);
  const showCollabPanel = useEditorStore((s) => s.showCollabPanel);
  const setShowCollabPanel = useEditorStore((s) => s.setShowCollabPanel);

  // Check for ?room= URL parameter on mount and auto-trigger join
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const roomParam = params.get('room');
    if (roomParam) {
      // Remove the param from the URL so refreshing doesn't re-join
      const url = new URL(window.location.href);
      url.searchParams.delete('room');
      window.history.replaceState({}, '', url.toString());

      // Open the collab panel and set the auto-join room
      setShowCollabPanel(true);
      useEditorStore.setState({ __autoJoinRoom: roomParam } as any);
    }
  }, [setShowCollabPanel]);

  return (
    <div className={`app-layout${isTesting ? ' app-layout--testing' : ''}`}>
      {!isTesting && (
        <div className="menu-bar">
          <MenuBar />
        </div>
      )}
      {!isTesting && (
        <div className="toolbar">
          <Toolbar />
        </div>
      )}
      <div className="canvas-area" style={{ position: 'relative' }}>
        <EditorCanvas />
        {isTesting && <GameOverlay />}
        {showCollabPanel && <CollabPanel hidden={isTesting} />}
      </div>
      {!isTesting && (
        <>
          <div
            className={`prop-panel-backdrop${showPropPanel ? ' prop-panel-backdrop--visible' : ''}`}
            onClick={() => setShowPropPanel(false)}
          />
          <div className={`prop-panel${showPropPanel ? ' prop-panel--open' : ''}`}>
            <PropertyPanel />
          </div>
        </>
      )}
      {!isTesting && (
        <div className="status-bar">
          <StatusBar />
        </div>
      )}
    </div>
  );
}
