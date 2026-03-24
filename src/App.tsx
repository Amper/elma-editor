import './App.css';
import { EditorCanvas } from '@/canvas/EditorCanvas';
import { MenuBar } from '@/components/MenuBar';
import { Toolbar } from '@/components/Toolbar';
import { PropertyPanel } from '@/components/PropertyPanel';
import { StatusBar } from '@/components/StatusBar';
import { GameOverlay } from '@/game/GameOverlay';
import { useEditorStore } from '@/state/editorStore';

export function App() {
  const isTesting = useEditorStore((s) => s.isTesting);
  const showPropPanel = useEditorStore((s) => s.showPropPanel);
  const setShowPropPanel = useEditorStore((s) => s.setShowPropPanel);

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
