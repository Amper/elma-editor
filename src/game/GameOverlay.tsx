import { useRef, useEffect } from 'react';
import { useEditorStore } from '@/state/editorStore';
import { convertLevelToGameData } from './levelConverter';
import { InputManager, DEFAULT_KEYS, type KeyBindings } from './engine/input/InputManager';
import { CanvasRenderer } from './engine/render/CanvasRenderer';
import { WebGLRenderer } from './engine/render/WebGLRenderer';
import { loadLgrData } from '@/canvas/lgrCache';
import { createGame, gameFrame, type GameState } from './engine/game/GameLoop';
import type { LevelData } from './engine/level/Level';
import { gameCameraRef } from './gameCameraRef';

export function GameOverlay() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const level = useEditorStore.getState().level;
    if (!level) {
      useEditorStore.getState().stopTesting();
      return;
    }

    // Convert editor level to game format
    let levelData: LevelData;
    try {
      levelData = convertLevelToGameData(level);
    } catch (err) {
      console.error('Failed to convert level for testing:', err);
      useEditorStore.getState().stopTesting();
      return;
    }

    // Initialize game systems
    const tc = useEditorStore.getState().testConfig;
    const input = new InputManager([tc.exitKey, tc.restartKey]);

    // Try WebGL first, fall back to Canvas2D
    let renderer: WebGLRenderer | CanvasRenderer;
    let isWebGL = false;
    try {
      renderer = new WebGLRenderer(canvas);
      isWebGL = true;
    } catch {
      console.warn('WebGL2 not available, falling back to Canvas2D');
      renderer = new CanvasRenderer(canvas);
    }

    // Build level geometry for WebGL renderer
    if (isWebGL) {
      (renderer as WebGLRenderer).buildLevel(levelData);
    }

    // Resize canvas to fill container
    const resize = () => {
      const { width, height } = container.getBoundingClientRect();
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      if (!isWebGL) {
        const dpr = window.devicePixelRatio || 1;
        canvas.width = width * dpr;
        canvas.height = height * dpr;
      }
      renderer.resize();
    };

    const observer = new ResizeObserver(resize);
    observer.observe(container);
    resize();

    // Build key bindings from test config
    const keys: KeyBindings = {
      ...DEFAULT_KEYS,
      gas: tc.gasKey,
      brake: tc.brakeKey,
      turn: tc.turnKey,
      alovolt: tc.alovoltKey,
      leftVolt: tc.leftVoltKey,
      rightVolt: tc.rightVoltKey,
      escape: tc.exitKey,
    };

    // Create game state
    let gameState: GameState = createGame(levelData, input, keys);
    let animFrame = 0;

    // Sync zoom from editor viewport
    const PIXELS_PER_METER = 48;
    const editorZoom = useEditorStore.getState().viewport.zoom;
    gameState.camera.zoom = editorZoom / PIXELS_PER_METER;

    // Mouse wheel zoom — syncs back to editor viewport
    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
      gameState.camera.zoom = Math.max(0.2, Math.min(5, gameState.camera.zoom * factor));
      const vp = useEditorStore.getState().viewport;
      useEditorStore.getState().setViewport({ ...vp, zoom: gameState.camera.zoom * PIXELS_PER_METER });
    };
    canvas.addEventListener('wheel', handleWheel, { passive: false });

    const renderOpts = { showGrass: tc.showGrass, showPictures: tc.showPictures, showTextures: tc.showTextures, objectsAnimation: tc.objectsAnimation };

    const loop = (timestamp: number) => {
      gameFrame(gameState, timestamp);
      gameCameraRef.x = gameState.camera.x;
      gameCameraRef.y = gameState.camera.y;
      gameCameraRef.active = true;
      renderer.render(gameState, renderOpts);

      // Restart key restarts the game at any time
      if (input.wasJustPressed(tc.restartKey)) {
        const prevZoom = gameState.camera.zoom;
        gameState = createGame(levelData, input, keys);
        gameState.camera.zoom = prevZoom;
        if (isWebGL) {
          (renderer as WebGLRenderer).buildLevel(levelData);
        }
      }

      // Handle game end states
      if (gameState.result === 'escaped') {
        useEditorStore.getState().stopTesting();
        return;
      }

      if (gameState.result === 'dead' || gameState.result === 'won') {
        if (input.wasJustPressed(tc.exitKey) || input.wasJustPressed('Enter')) {
          const prevZoom = gameState.camera.zoom;
          gameState = createGame(levelData, input, keys);
          gameState.camera.zoom = prevZoom;
          if (isWebGL) {
            (renderer as WebGLRenderer).buildLevel(levelData);
          }
        }
      }

      input.update();
      animFrame = requestAnimationFrame(loop);
    };

    // Await LGR before starting game loop (already cached from editor mount)
    let aborted = false;
    if (isWebGL) {
      loadLgrData()
        .then((lgr) => {
          if (aborted) return;
          (renderer as WebGLRenderer).loadLgr(lgr, levelData);
          animFrame = requestAnimationFrame(loop);
        })
        .catch((err) => {
          console.warn('Failed to load LGR:', err);
          if (!aborted) animFrame = requestAnimationFrame(loop);
        });
    } else {
      animFrame = requestAnimationFrame(loop);
    }

    return () => {
      aborted = true;
      gameCameraRef.active = false;
      cancelAnimationFrame(animFrame);
      canvas.removeEventListener('wheel', handleWheel);
      observer.disconnect();
      input.destroy();
      if (isWebGL) {
        (renderer as WebGLRenderer).destroy();
      }
    };
  }, []);

  return (
    <div
      ref={containerRef}
      style={{
        position: 'absolute',
        inset: 0,
        zIndex: 10,
      }}
    >
      <div style={{ position: 'relative', width: '100%', height: '100%' }}>
        <canvas
          ref={canvasRef}
          style={{ display: 'block', outline: 'none' }}
        />
      </div>
    </div>
  );
}
