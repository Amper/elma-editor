import { useRef, useEffect, useCallback } from 'react';
import { useEditorStore } from '@/state/editorStore';
import { renderMinimap } from '@/canvas/renderMinimap';
import { fitLevel, screenToWorld } from '@/canvas/viewport';
import { gameCameraRef } from '@/game/gameCameraRef';

const MINIMAP_W = 200;
const MINIMAP_H = 150;
const PIXELS_PER_METER = 48;

export function Minimap() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const levelCacheRef = useRef<OffscreenCanvas | null>(null);
  const cachedLevelRef = useRef<unknown>(null);
  const cachedVpRef = useRef<{ centerX: number; centerY: number; zoom: number } | null>(null);
  const animFrameRef = useRef(0);
  const isDraggingRef = useRef(false);

  const level = useEditorStore((s) => s.level);
  const viewport = useEditorStore((s) => s.viewport);
  const isTesting = useEditorStore((s) => s.isTesting);
  const showLevelScreen = useEditorStore((s) => s.showLevelScreen);
  const showMinimap = useEditorStore((s) => s.showMinimap);
  const minimapOpacity = useEditorStore((s) => s.minimapOpacity);

  // Compute minimap viewport that fits the entire level
  const getMinimapVp = useCallback(() => {
    if (!level) return null;
    const dpr = window.devicePixelRatio || 1;
    return fitLevel(level.polygons, MINIMAP_W * dpr, MINIMAP_H * dpr, 0.15);
  }, [level]);

  // Render the level to the offscreen cache
  const renderLevelCache = useCallback(() => {
    if (!level) return;
    const minimapVp = getMinimapVp();
    if (!minimapVp) return;

    const dpr = window.devicePixelRatio || 1;
    const w = MINIMAP_W * dpr;
    const h = MINIMAP_H * dpr;

    if (!levelCacheRef.current || levelCacheRef.current.width !== w || levelCacheRef.current.height !== h) {
      levelCacheRef.current = new OffscreenCanvas(w, h);
    }

    const ctx = levelCacheRef.current.getContext('2d');
    if (!ctx) return;

    renderMinimap(ctx as unknown as CanvasRenderingContext2D, w, h, level, minimapVp);
    cachedLevelRef.current = level;
    cachedVpRef.current = minimapVp;
  }, [level, getMinimapVp]);

  // Animation loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const draw = () => {
      const currentLevel = useEditorStore.getState().level;
      if (!currentLevel) {
        animFrameRef.current = requestAnimationFrame(draw);
        return;
      }

      const dpr = window.devicePixelRatio || 1;
      const w = MINIMAP_W * dpr;
      const h = MINIMAP_H * dpr;

      // Ensure canvas buffer matches expected size (handles late mount & DPR changes)
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }

      // Re-render level cache if level changed
      if (cachedLevelRef.current !== currentLevel) {
        renderLevelCache();
      }

      const minimapVp = cachedVpRef.current;
      if (!minimapVp || !levelCacheRef.current) {
        animFrameRef.current = requestAnimationFrame(draw);
        return;
      }

      // Draw cached level
      ctx.resetTransform();
      ctx.clearRect(0, 0, w, h);
      ctx.drawImage(levelCacheRef.current, 0, 0);

      // Draw overlay indicators
      const currentVp = useEditorStore.getState().viewport;
      const currentTesting = useEditorStore.getState().isTesting;

      // Get main canvas dimensions for viewport rect calculation
      const canvasArea = canvas.parentElement?.parentElement;
      const mainW = canvasArea?.clientWidth ?? 800;
      const mainH = canvasArea?.clientHeight ?? 600;

      // Apply minimap viewport transform for world-space drawing
      ctx.save();
      ctx.translate(w / 2, h / 2);
      ctx.scale(minimapVp.zoom, minimapVp.zoom);
      ctx.translate(-minimapVp.centerX, -minimapVp.centerY);

      if (currentTesting && gameCameraRef.active) {
        // Test mode: draw bike dot + camera viewport rect
        const bikeX = gameCameraRef.x;
        const bikeY = -gameCameraRef.y; // Physics Y-up → editor Y-down

        // Camera viewport rectangle
        const gameZoom = currentVp.zoom; // editor viewport zoom stays synced
        const camVisW = mainW / gameZoom;
        const camVisH = mainH / gameZoom;
        ctx.strokeStyle = 'rgba(0, 180, 255, 0.8)';
        ctx.lineWidth = 1.5 / minimapVp.zoom;
        ctx.strokeRect(bikeX - camVisW / 2, bikeY - camVisH / 2, camVisW, camVisH);

        // Bike position dot
        ctx.beginPath();
        ctx.arc(bikeX, bikeY, 3 / minimapVp.zoom, 0, Math.PI * 2);
        ctx.fillStyle = '#ff4444';
        ctx.fill();
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1 / minimapVp.zoom;
        ctx.stroke();
      } else {
        // Editor mode: draw viewport indicator rectangle
        const visW = mainW / currentVp.zoom;
        const visH = mainH / currentVp.zoom;
        ctx.strokeStyle = 'rgba(0, 180, 255, 0.9)';
        ctx.lineWidth = 1.5 / minimapVp.zoom;
        ctx.strokeRect(
          currentVp.centerX - visW / 2,
          currentVp.centerY - visH / 2,
          visW,
          visH,
        );
      }

      ctx.restore();

      animFrameRef.current = requestAnimationFrame(draw);
    };

    animFrameRef.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(animFrameRef.current);
  }, [renderLevelCache, showLevelScreen, showMinimap]);

  // Click/drag to navigate (editor mode only)
  const navigateToPoint = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    if (useEditorStore.getState().isTesting) return;
    const minimapVp = cachedVpRef.current;
    if (!minimapVp) return;

    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const px = (e.clientX - rect.left) * dpr;
    const py = (e.clientY - rect.top) * dpr;

    const world = screenToWorld(
      { x: px, y: py },
      minimapVp,
      MINIMAP_W * dpr,
      MINIMAP_H * dpr,
    );

    const currentVp = useEditorStore.getState().viewport;
    useEditorStore.getState().setViewport({
      centerX: world.x,
      centerY: world.y,
      zoom: currentVp.zoom,
    });
  }, []);

  const handlePointerDown = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    e.stopPropagation();
    e.preventDefault();
    isDraggingRef.current = true;
    (e.target as HTMLCanvasElement).setPointerCapture(e.pointerId);
    navigateToPoint(e);
  }, [navigateToPoint]);

  const handlePointerMove = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    e.stopPropagation();
    if (!isDraggingRef.current) return;
    navigateToPoint(e);
  }, [navigateToPoint]);

  const handlePointerUp = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    e.stopPropagation();
    isDraggingRef.current = false;
  }, []);

  if (!level || showLevelScreen || !showMinimap) return null;

  return (
    <canvas
      ref={canvasRef}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      style={{
        position: 'absolute',
        bottom: 8,
        right: 8,
        width: MINIMAP_W,
        height: MINIMAP_H,
        zIndex: 20,
        borderRadius: 4,
        border: '1px solid rgba(255, 255, 255, 0.2)',
        opacity: minimapOpacity / 100,
        cursor: 'crosshair',
        touchAction: 'none',
      }}
    />
  );
}
