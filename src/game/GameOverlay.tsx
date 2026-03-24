import { useRef, useEffect } from 'react';
import { useEditorStore } from '@/state/editorStore';
import { convertLevelToGameData } from './levelConverter';
import { InputManager, DEFAULT_KEYS, type KeyBindings } from './engine/input/InputManager';
import { CanvasRenderer } from './engine/render/CanvasRenderer';
import { WebGLRenderer } from './engine/render/WebGLRenderer';
import { loadLgrData } from '@/canvas/lgrCache';
import { createGame, gameFrame, type GameState } from './engine/game/GameLoop';
import type { LevelData } from './engine/level/Level';
import type { BikeSnapshot } from '@/collab/protocol';
import type { MotorState } from './engine/physics/MotorState';
import { Vec2 } from './engine/core/Vec2';

/** Extract a compact bike snapshot from the full motor state. */
function motorToSnapshot(motor: MotorState, alive: boolean): BikeSnapshot {
  return {
    bikeX: motor.bike.r.x, bikeY: motor.bike.r.y, bikeRot: motor.bike.rotation,
    lwX: motor.leftWheel.r.x, lwY: motor.leftWheel.r.y, lwRot: motor.leftWheel.rotation,
    rwX: motor.rightWheel.r.x, rwY: motor.rightWheel.r.y, rwRot: motor.rightWheel.rotation,
    bodyX: motor.bodyR.x, bodyY: motor.bodyR.y,
    headX: motor.headR.x, headY: motor.headR.y,
    flipped: motor.flippedBike,
    alive,
  };
}

/** Create a synthetic MotorState from a network snapshot for rendering. */
function snapshotToMotor(snap: BikeSnapshot): MotorState {
  return {
    bike: { r: new Vec2(snap.bikeX, snap.bikeY), v: new Vec2(0, 0), rotation: snap.bikeRot, angularVelocity: 0, radius: 0.3, mass: 1, inertia: 1 },
    leftWheel: { r: new Vec2(snap.lwX, snap.lwY), v: new Vec2(0, 0), rotation: snap.lwRot, angularVelocity: 0, radius: 0.4, mass: 1, inertia: 1 },
    rightWheel: { r: new Vec2(snap.rwX, snap.rwY), v: new Vec2(0, 0), rotation: snap.rwRot, angularVelocity: 0, radius: 0.4, mass: 1, inertia: 1 },
    bodyR: new Vec2(snap.bodyX, snap.bodyY),
    bodyV: new Vec2(0, 0),
    headR: new Vec2(snap.headX, snap.headY),
    flippedBike: snap.flipped,
    flippedCamera: snap.flipped,
    gravityDirection: 1,
    appleCount: 0,
    lastAppleTime: 0,
    prevBrake: false,
    leftWheelBrakeRotation: 0,
    rightWheelBrakeRotation: 0,
    voltingRight: false,
    voltingLeft: false,
    rightVoltTime: 0,
    leftVoltTime: 0,
    angularVelocityPreRightVolt: 0,
    angularVelocityPreLeftVolt: 0,
  };
}

const BIKE_BROADCAST_INTERVAL = 50; // ~20Hz

export function GameOverlay() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const store = useEditorStore.getState();
    const level = store.level;
    if (!level) {
      store.stopTesting();
      return;
    }

    // Notify collab peers that we started testing
    if (store.collabClient?.connected) {
      store.collabClient.send({ type: 'testingStarted' });
    }

    // Convert editor level to game format
    let levelData: LevelData;
    try {
      levelData = convertLevelToGameData(level);
    } catch {
      store.stopTesting();
      return;
    }

    // Initialize game systems
    const tc = store.testConfig;
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
    const editorZoom = store.viewport.zoom;
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

    const renderOpts = { showGrass: tc.showGrass, showPictures: tc.showPictures, showTextures: tc.showTextures };

    // Bike state broadcast throttle
    let lastBikeBroadcast = 0;

    const loop = (timestamp: number) => {
      gameFrame(gameState, timestamp);
      renderer.render(gameState, renderOpts);

      // Render remote bikes (semi-transparent to distinguish from local)
      {
        const remoteUsers = useEditorStore.getState().remoteUsers;
        for (const user of remoteUsers.values()) {
          if (user.isTesting && user.bikeState) {
            try {
              const remoteMotor = snapshotToMotor(user.bikeState);
              if (isWebGL) {
                const webgl = renderer as WebGLRenderer;
                const viewProj = webgl.glCtx.buildViewProjection(
                  gameState.camera.x, gameState.camera.y,
                  PIXELS_PER_METER * gameState.camera.zoom,
                );
                webgl.bikeRenderer.alpha = 0.75;
                webgl.bikeRenderer.draw(remoteMotor, viewProj, renderOpts.showTextures);
                webgl.bikeRenderer.alpha = 1.0;
              } else {
                (renderer as CanvasRenderer).drawRemoteBike(remoteMotor, 0.75);
              }
            } catch {
              // silently skip render errors for remote bikes
            }
          }
        }
      }

      // Broadcast local bike state to collab peers (~20Hz)
      try {
        const client = useEditorStore.getState().collabClient;
        if (client?.connected && timestamp - lastBikeBroadcast > BIKE_BROADCAST_INTERVAL) {
          lastBikeBroadcast = timestamp;
          const alive = gameState.result === 'playing';
          client.send({ type: 'bikeState', bike: motorToSnapshot(gameState.motor, alive) });
        }
      } catch {
        // Don't crash the game loop
      }

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
        // Defer to let React unmount cleanly before the next frame
        setTimeout(() => useEditorStore.getState().stopTesting(), 0);
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
      cancelAnimationFrame(animFrame);
      canvas.removeEventListener('wheel', handleWheel);
      observer.disconnect();
      input.destroy();
      if (isWebGL) {
        (renderer as WebGLRenderer).destroy();
      }
      // Notify collab peers that we stopped testing
      try {
        const cc = useEditorStore.getState().collabClient;
        if (cc?.connected) cc.send({ type: 'testingStopped' });
      } catch { /* ignore */ }
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
