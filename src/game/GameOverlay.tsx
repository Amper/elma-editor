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
import { Vec2 } from './engine/core/Vec2';
import type { MotorState } from './engine/physics/MotorState';
import { MotorGravity } from './engine/physics/MotorState';
import { calculateHeadPosition } from './engine/physics/Stepper';
import type { BikeSnapshot } from '@/collab/protocol';
import type { DebugStartConfig, TrajectoryPoint } from '@/types';
import {
  WHEEL_RADIUS, BIKE_RADIUS, WHEEL_MASS, WHEEL_INERTIA, BIKE_MASS, BIKE_INERTIA,
  LEFT_WHEEL_DX, LEFT_WHEEL_DY, RIGHT_WHEEL_DX, RIGHT_WHEEL_DY, BODY_DY,
} from './engine/core/Constants';
import { updateCamera } from './engine/game/Camera';

const BIKE_BROADCAST_INTERVAL = 50; // ~20Hz

/** Extract a compact snapshot from the local bike's motor state. */
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

/** Recreate a MotorState from a network snapshot (positions only, no velocities). */
function snapshotToMotor(snap: BikeSnapshot): MotorState {
  return {
    bike: { r: new Vec2(snap.bikeX, snap.bikeY), v: new Vec2(0, 0), rotation: snap.bikeRot, angularVelocity: 0, radius: BIKE_RADIUS, mass: BIKE_MASS, inertia: BIKE_INERTIA },
    leftWheel: { r: new Vec2(snap.lwX, snap.lwY), v: new Vec2(0, 0), rotation: snap.lwRot, angularVelocity: 0, radius: WHEEL_RADIUS, mass: WHEEL_MASS, inertia: WHEEL_INERTIA },
    rightWheel: { r: new Vec2(snap.rwX, snap.rwY), v: new Vec2(0, 0), rotation: snap.rwRot, angularVelocity: 0, radius: WHEEL_RADIUS, mass: WHEEL_MASS, inertia: WHEEL_INERTIA },
    bodyR: new Vec2(snap.bodyX, snap.bodyY),
    bodyV: new Vec2(0, 0),
    headR: new Vec2(snap.headX, snap.headY),
    flippedBike: snap.flipped,
    flippedCamera: snap.flipped,
    gravityDirection: MotorGravity.Down,
    appleCount: 0, lastAppleTime: 0,
    prevBrake: false, leftWheelBrakeRotation: 0, rightWheelBrakeRotation: 0,
    voltingRight: false, voltingLeft: false, rightVoltTime: -1, leftVoltTime: -1,
    angularVelocityPreRightVolt: -1, angularVelocityPreLeftVolt: -1,
  };
}

function gravityToString(g: MotorGravity): DebugStartConfig['gravityDirection'] {
  switch (g) {
    case MotorGravity.Up: return 'up';
    case MotorGravity.Down: return 'down';
    case MotorGravity.Left: return 'left';
    case MotorGravity.Right: return 'right';
  }
}

function gravityFromConfig(dir: DebugStartConfig['gravityDirection']): MotorGravity {
  switch (dir) {
    case 'up': return MotorGravity.Up;
    case 'down': return MotorGravity.Down;
    case 'left': return MotorGravity.Left;
    case 'right': return MotorGravity.Right;
  }
}

/**
 * Override the motor state to start from the debug start position
 * with the configured bike parameters.
 */
function applyDebugStart(gameState: GameState, config: DebugStartConfig): void {
  const motor = gameState.motor;

  // Debug start position marks the LEFT WHEEL in editor space
  // (matching the bike sprite which is centered on the left wheel).
  // Convert to physics space (negate Y).
  const lwPos = new Vec2(config.position.x, -config.position.y);

  // Editor angle: positive = clockwise in editor (Y-down).
  // Physics angle: positive = counter-clockwise (Y-up).
  const angleRad = -(config.angle * Math.PI) / 180;

  const cos = Math.cos(angleRad);
  const sin = Math.sin(angleRad);

  // Compute bike center from left wheel position.
  // Left wheel offset from bike center is always (LEFT_WHEEL_DX, LEFT_WHEEL_DY)
  // regardless of flip state — flip only affects which wheel drives and head rendering.
  const rotLwDx = LEFT_WHEEL_DX * cos - LEFT_WHEEL_DY * sin;
  const rotLwDy = LEFT_WHEEL_DX * sin + LEFT_WHEEL_DY * cos;
  const bikeX = lwPos.x - rotLwDx;
  const bikeY = lwPos.y - rotLwDy;
  const bikePos = new Vec2(bikeX, bikeY);

  // Compute other parts relative to bike center
  const rotRwX = RIGHT_WHEEL_DX * cos - RIGHT_WHEEL_DY * sin;
  const rotRwY = RIGHT_WHEEL_DX * sin + RIGHT_WHEEL_DY * cos;
  const rotBodyX = -BODY_DY * sin;
  const rotBodyY = BODY_DY * cos;

  // Set positions
  motor.bike.r = bikePos;
  motor.leftWheel.r = lwPos;
  motor.rightWheel.r = new Vec2(bikeX + rotRwX, bikeY + rotRwY);
  motor.bodyR = new Vec2(bikeX + rotBodyX, bikeY + rotBodyY);

  // Set rotation (physics space)
  motor.bike.rotation = angleRad;

  // Set flipped
  motor.flippedBike = config.flipped;
  motor.flippedCamera = config.flipped;

  // Set gravity
  motor.gravityDirection = gravityFromConfig(config.gravityDirection);

  // Set velocity (applied to all parts equally)
  if (config.speed > 0) {
    const speedAngleRad = -(config.speedAngle * Math.PI) / 180;
    const vx = config.speed * Math.cos(speedAngleRad);
    const vy = config.speed * Math.sin(speedAngleRad);
    const vel = new Vec2(vx, vy);
    motor.bike.v = vel;
    motor.leftWheel.v = new Vec2(vel.x, vel.y);
    motor.rightWheel.v = new Vec2(vel.x, vel.y);
    motor.bodyV = new Vec2(vel.x, vel.y);
  }

  // Recalculate head position based on new rotation and flip
  calculateHeadPosition(motor);

  // Update camera to new position
  updateCamera(gameState.camera, motor.bike.r.x, motor.bike.r.y);
}

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

    // Apply debug start if in debug mode with a debug start placed
    const storeState = useEditorStore.getState();
    const isDebugMode = storeState.testMode === 'debug';
    const hasDebugStart = isDebugMode && storeState.debugStart != null;
    if (hasDebugStart) {
      applyDebugStart(gameState, storeState.debugStart!);
    }

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

    // Click to exit test mode when dead
    const handleClick = () => {
      if (gameState.result === 'dead' || gameState.result === 'won') {
        if (isDebugMode && trajectoryPoints.length > 0) {
          useEditorStore.getState().setDebugTrajectory(trajectoryPoints);
        }
        useEditorStore.getState().stopTesting();
      }
    };
    canvas.addEventListener('click', handleClick);

    const renderOpts = { showGrass: tc.showGrass, showPictures: tc.showPictures, showTextures: tc.showTextures, objectsAnimation: tc.objectsAnimation };

    // Notify collab server that testing started
    const collabClient = useEditorStore.getState().collabClient;
    if (collabClient?.connected) {
      collabClient.send({ type: 'testingStarted' });
    }

    let lastBikeBroadcast = 0;

    // Trajectory recording for debug mode
    const trajectoryPoints: TrajectoryPoint[] = [];
    let lastRecordedBikeX = NaN;
    let lastRecordedBikeY = NaN;
    const TRAJECTORY_MIN_DIST_SQ = 0.05 * 0.05; // 0.05 world units squared

    const loop = (timestamp: number) => {
      gameFrame(gameState, timestamp);

      // Record trajectory point (debug mode only, distance-sampled)
      if (isDebugMode && gameState.result === 'playing') {
        const m = gameState.motor;
        const bx = m.bike.r.x;
        const by = m.bike.r.y;
        const dx = bx - lastRecordedBikeX;
        const dy = by - lastRecordedBikeY;
        if (dx !== dx || (dx * dx + dy * dy) > TRAJECTORY_MIN_DIST_SQ) { // NaN check || distance check
          lastRecordedBikeX = bx;
          lastRecordedBikeY = by;
          trajectoryPoints.push({
            headX: m.headR.x, headY: -m.headR.y,
            lwX: m.leftWheel.r.x, lwY: -m.leftWheel.r.y,
            rwX: m.rightWheel.r.x, rwY: -m.rightWheel.r.y,
            // Store left wheel position as the reference point (matches sprite center)
            bikeX: m.leftWheel.r.x, bikeY: -m.leftWheel.r.y,
            // Store rotation in editor space (negate physics angle)
            rotation: -m.bike.rotation,
            flipped: m.flippedBike,
            gravityDirection: gravityToString(m.gravityDirection),
            // Store velocity in editor space (negate Y)
            speedX: m.bike.v.x, speedY: -m.bike.v.y,
          });
        }
      }

      gameCameraRef.x = gameState.camera.x;
      gameCameraRef.y = gameState.camera.y;
      gameCameraRef.active = true;
      renderer.render(gameState, renderOpts);

      // Render remote bikes
      const store = useEditorStore.getState();
      if (store.isCollaborating) {
        for (const user of store.remoteUsers.values()) {
          if (user.isTesting && user.bikeState) {
            try {
              const remoteMotor = snapshotToMotor(user.bikeState);
              if (isWebGL) {
                const webgl = renderer as WebGLRenderer;
                const viewProj = webgl.glCtx.buildViewProjection(
                  gameState.camera.x, gameState.camera.y,
                  PIXELS_PER_METER * gameState.camera.zoom,
                );
                webgl.bikeRenderer.alpha = 0.8;
                webgl.bikeRenderer.draw(remoteMotor, viewProj, renderOpts.showTextures);
                webgl.bikeRenderer.alpha = 1.0;
              } else {
                (renderer as CanvasRenderer).drawRemoteBike(remoteMotor, gameState.camera, 0.8);
              }
            } catch {
              // silently skip render errors for remote bikes
            }
          }
        }

        // Broadcast local bike state throttled
        const now = performance.now();
        if (now - lastBikeBroadcast > BIKE_BROADCAST_INTERVAL) {
          lastBikeBroadcast = now;
          const client = store.collabClient;
          if (client?.connected) {
            const alive = gameState.result === 'playing';
            client.send({ type: 'bikeState', bike: motorToSnapshot(gameState.motor, alive) });
          }
        }
      }

      // Restart key restarts the game at any time
      if (input.wasJustPressed(tc.restartKey)) {
        const prevZoom = gameState.camera.zoom;
        gameState = createGame(levelData, input, keys);
        gameState.camera.zoom = prevZoom;
        if (hasDebugStart) applyDebugStart(gameState, storeState.debugStart!);
        if (isDebugMode) {
          trajectoryPoints.length = 0;
          lastRecordedBikeX = NaN;
          lastRecordedBikeY = NaN;
        }
        if (isWebGL) {
          (renderer as WebGLRenderer).buildLevel(levelData);
        }
      }

      // Handle game end states
      if (gameState.result === 'escaped') {
        if (isDebugMode && trajectoryPoints.length > 0) {
          useEditorStore.getState().setDebugTrajectory(trajectoryPoints);
        }
        useEditorStore.getState().stopTesting();
        return;
      }

      if (gameState.result === 'dead' || gameState.result === 'won') {
        if (input.wasJustPressed(tc.exitKey)) {
          // Exit to editor — save trajectory
          if (isDebugMode && trajectoryPoints.length > 0) {
            useEditorStore.getState().setDebugTrajectory(trajectoryPoints);
          }
          useEditorStore.getState().stopTesting();
          return;
        }
        if (input.wasJustPressed('Enter') || input.wasJustPressed(tc.restartKey)) {
          // Restart — clear trajectory for fresh run
          const prevZoom = gameState.camera.zoom;
          gameState = createGame(levelData, input, keys);
          gameState.camera.zoom = prevZoom;
          if (hasDebugStart) applyDebugStart(gameState, storeState.debugStart!);
          if (isDebugMode) {
            trajectoryPoints.length = 0;
            lastRecordedBikeX = NaN;
            lastRecordedBikeY = NaN;
          }
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
      canvas.removeEventListener('click', handleClick);
      observer.disconnect();
      input.destroy();
      if (isWebGL) {
        (renderer as WebGLRenderer).destroy();
      }
      // Save trajectory on cleanup (covers all exit paths)
      if (isDebugMode && trajectoryPoints.length > 0) {
        useEditorStore.getState().setDebugTrajectory(trajectoryPoints);
      }
      // Notify collab server that testing stopped
      const client = useEditorStore.getState().collabClient;
      if (client?.connected) {
        client.send({ type: 'testingStopped' });
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
