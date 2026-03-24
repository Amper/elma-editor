import { useRef, useEffect, useCallback } from 'react';
import { useEditorStore } from '@/state/editorStore';
import { renderFrame } from './renderer';
import { screenToWorld, zoomAtPoint, panByScreenDelta, fitLevel } from './viewport';
import { ToolManager } from '@/tools/ToolManager';
import type { CanvasPointerEvent } from '@/tools/Tool';
import type { Vec2 } from '@/types';
import { ToolId } from '@/types';
import { undo, redo } from '@/state/selectors';
import { readLevelFile, downloadLevel } from '@/io/fileIO';
import { loadEditorLgr } from './lgrCache';

export function EditorCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animFrameRef = useRef(0);
  const toolManagerRef = useRef<ToolManager | null>(null);
  const isPanningRef = useRef(false);
  const panStartRef = useRef<Vec2>({ x: 0, y: 0 });
  const prevToolRef = useRef<ToolId | null>(null);
  const spaceHeldRef = useRef(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Ensure ToolManager exists
  if (!toolManagerRef.current) {
    toolManagerRef.current = new ToolManager(
      () => useEditorStore.getState(),
    );
    toolManagerRef.current.setActiveTool(ToolId.Select);
  }

  // Subscribe to store for re-render triggers
  const level = useEditorStore((s) => s.level);
  const viewport = useEditorStore((s) => s.viewport);
  const selection = useEditorStore((s) => s.selection);
  const grid = useEditorStore((s) => s.grid);
  const topologyErrors = useEditorStore((s) => s.topologyErrors);
  const activeTool = useEditorStore((s) => s.activeTool);
  const showGrass = useEditorStore((s) => s.showGrass);
  const showPictures = useEditorStore((s) => s.showPictures);
  const showTextures = useEditorStore((s) => s.showTextures);
  const showObjects = useEditorStore((s) => s.showObjects);

  // Sync tool manager with store's active tool
  useEffect(() => {
    toolManagerRef.current?.setActiveTool(activeTool);
  }, [activeTool]);

  // Load LGR textures for editor rendering (fire-and-forget)
  useEffect(() => { loadEditorLgr(); }, []);

  // Resize canvas to fill container with devicePixelRatio
  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      const { width, height } = container.getBoundingClientRect();
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
    };

    const observer = new ResizeObserver(resize);
    observer.observe(container);
    resize();
    return () => observer.disconnect();
  }, []);

  // Render loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const draw = () => {
      // Skip rendering while game test mode is active
      if (useEditorStore.getState().isTesting) {
        animFrameRef.current = requestAnimationFrame(draw);
        return;
      }

      renderFrame(ctx, canvas.width, canvas.height, {
        level,
        viewport,
        selection,
        grid,
        topologyErrors,
        activeTool,
        showGrass,
        showPictures,
        showTextures,
        showObjects,
      });

      // Draw tool overlay in world space
      if (level && toolManagerRef.current) {
        const dpr = window.devicePixelRatio || 1;
        ctx.save();
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        const cssW = canvas.width / dpr;
        const cssH = canvas.height / dpr;
        ctx.translate(cssW / 2, cssH / 2);
        ctx.scale(viewport.zoom, viewport.zoom);
        ctx.translate(-viewport.centerX, -viewport.centerY);
        toolManagerRef.current.renderOverlay(ctx);
        ctx.restore();
      }

      animFrameRef.current = requestAnimationFrame(draw);
    };
    animFrameRef.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(animFrameRef.current);
  }, [level, viewport, selection, grid, topologyErrors, activeTool, showGrass, showPictures, showTextures, showObjects]);

  // ── Mouse wheel -> zoom ──
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const screenPoint = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      const delta = e.deltaY < 0 ? 1 : -1;
      const store = useEditorStore.getState();
      const newVp = zoomAtPoint(
        store.viewport,
        screenPoint,
        delta,
        rect.width,
        rect.height,
      );
      store.setViewport(newVp);
    };

    canvas.addEventListener('wheel', handleWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', handleWheel);
  }, []);

  // ── Build pointer event ──
  const makePointerEvent = useCallback(
    (e: React.PointerEvent | React.MouseEvent): CanvasPointerEvent => {
      const canvas = canvasRef.current!;
      const rect = canvas.getBoundingClientRect();
      const screenPos = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      const store = useEditorStore.getState();
      const worldPos = screenToWorld(
        screenPos,
        store.viewport,
        rect.width,
        rect.height,
      );
      return {
        screenPos,
        worldPos,
        button: e.button,
        shiftKey: e.shiftKey,
        ctrlKey: e.ctrlKey || e.metaKey,
        altKey: e.altKey,
      };
    },
    [],
  );

  // ── Pointer handlers (unified mouse + touch) ──
  const activePointersRef = useRef<Map<number, Vec2>>(new Map());
  const pinchDistRef = useRef(0);
  const pinchMidRef = useRef<Vec2>({ x: 0, y: 0 });
  const wasPinchingRef = useRef(false);
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressStartRef = useRef<Vec2>({ x: 0, y: 0 });

  const clearLongPress = useCallback(() => {
    if (longPressTimerRef.current !== null) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  }, []);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      // Focus canvas for keyboard events
      canvasRef.current?.focus();

      // Track active pointer
      activePointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

      // Two-finger gesture start
      if (activePointersRef.current.size === 2) {
        clearLongPress();
        wasPinchingRef.current = true;
        // Abort any in-progress single-pointer tool interaction
        if (toolManagerRef.current) {
          const pe = makePointerEvent(e);
          toolManagerRef.current.onPointerUp(pe);
        }
        const pts = [...activePointersRef.current.values()];
        const dx = pts[1]!.x - pts[0]!.x;
        const dy = pts[1]!.y - pts[0]!.y;
        pinchDistRef.current = Math.hypot(dx, dy);
        pinchMidRef.current = { x: (pts[0]!.x + pts[1]!.x) / 2, y: (pts[0]!.y + pts[1]!.y) / 2 };
        return;
      }

      // Middle-mouse -> pan
      if (e.button === 1) {
        e.preventDefault();
        isPanningRef.current = true;
        panStartRef.current = { x: e.clientX, y: e.clientY };
        return;
      }

      // Long-press detection for touch (simulates right-click)
      if (e.pointerType === 'touch') {
        longPressStartRef.current = { x: e.clientX, y: e.clientY };
        clearLongPress();
        longPressTimerRef.current = setTimeout(() => {
          longPressTimerRef.current = null;
          const canvas = canvasRef.current;
          if (!canvas) return;
          const rect = canvas.getBoundingClientRect();
          const screenPos = {
            x: longPressStartRef.current.x - rect.left,
            y: longPressStartRef.current.y - rect.top,
          };
          const store = useEditorStore.getState();
          const worldPos = screenToWorld(screenPos, store.viewport, rect.width, rect.height);
          const syntheticEvent: CanvasPointerEvent = {
            screenPos,
            worldPos,
            button: 0,
            shiftKey: false,
            ctrlKey: false,
            altKey: false,
          };
          // Abort the in-progress left-click action before dispatching right-click
          toolManagerRef.current?.onPointerUp(syntheticEvent);
          toolManagerRef.current?.onPointerDown({
            ...syntheticEvent,
            button: 2,
          });
        }, 500);
      }

      // Delegate to tool
      const pe = makePointerEvent(e);
      toolManagerRef.current?.onPointerDown(pe);

      // Update cursor immediately
      if (canvasRef.current) {
        canvasRef.current.style.cursor =
          toolManagerRef.current?.getCursor() ?? 'default';
      }
    },
    [makePointerEvent, clearLongPress],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      // Update tracked pointer
      if (activePointersRef.current.has(e.pointerId)) {
        activePointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      }

      // Cancel long-press if finger moved too far
      if (longPressTimerRef.current !== null) {
        const dx = e.clientX - longPressStartRef.current.x;
        const dy = e.clientY - longPressStartRef.current.y;
        if (Math.hypot(dx, dy) > 8) {
          clearLongPress();
        }
      }

      // Two-finger pinch/pan
      if (activePointersRef.current.size === 2) {
        const pts = [...activePointersRef.current.values()];
        const dx = pts[1]!.x - pts[0]!.x;
        const dy = pts[1]!.y - pts[0]!.y;
        const newDist = Math.hypot(dx, dy);
        const newMid: Vec2 = { x: (pts[0]!.x + pts[1]!.x) / 2, y: (pts[0]!.y + pts[1]!.y) / 2 };

        const canvas = canvasRef.current;
        if (canvas) {
          const rect = canvas.getBoundingClientRect();
          const store = useEditorStore.getState();

          // Pinch zoom
          if (pinchDistRef.current > 0) {
            const scale = newDist / pinchDistRef.current;
            if (Math.abs(scale - 1) > 0.01) {
              const screenPoint = { x: newMid.x - rect.left, y: newMid.y - rect.top };
              const delta = scale > 1 ? 1 : -1;
              const factor = Math.abs(scale - 1) * 3; // Amplify for responsiveness
              for (let i = 0; i < Math.max(1, Math.round(factor)); i++) {
                const vp = zoomAtPoint(store.viewport, screenPoint, delta, rect.width, rect.height);
                store.setViewport(vp);
              }
            }
          }

          // Two-finger pan
          const panDx = newMid.x - pinchMidRef.current.x;
          const panDy = newMid.y - pinchMidRef.current.y;
          if (Math.abs(panDx) > 0.5 || Math.abs(panDy) > 0.5) {
            store.setViewport(panByScreenDelta(store.viewport, panDx, panDy));
          }
        }

        pinchDistRef.current = newDist;
        pinchMidRef.current = newMid;
        return;
      }

      // Update cursor world position for status bar
      const pe = makePointerEvent(e);
      useEditorStore.getState().setCursorWorld(pe.worldPos);

      // Middle-mouse pan
      if (isPanningRef.current) {
        const dx = e.clientX - panStartRef.current.x;
        const dy = e.clientY - panStartRef.current.y;
        panStartRef.current = { x: e.clientX, y: e.clientY };
        const store = useEditorStore.getState();
        store.setViewport(panByScreenDelta(store.viewport, dx, dy));
        if (canvasRef.current) canvasRef.current.style.cursor = 'grabbing';
        return;
      }

      // Delegate to tool
      toolManagerRef.current?.onPointerMove(pe);

      // Update cursor immediately from tool state (avoids waiting for React re-render)
      if (canvasRef.current) {
        canvasRef.current.style.cursor =
          toolManagerRef.current?.getCursor() ?? 'default';
      }
    },
    [makePointerEvent, clearLongPress],
  );

  const handlePointerUp = useCallback(
    (e: React.PointerEvent) => {
      activePointersRef.current.delete(e.pointerId);
      clearLongPress();

      // End pinch if was two-finger gesture
      if (activePointersRef.current.size < 2) {
        pinchDistRef.current = 0;
      }

      // Suppress unmatched pointer-up after pinch gesture
      if (wasPinchingRef.current && e.pointerType === 'touch') {
        if (activePointersRef.current.size === 0) {
          wasPinchingRef.current = false;
        }
        return;
      }

      if (e.button === 1) {
        isPanningRef.current = false;
        if (canvasRef.current) {
          canvasRef.current.style.cursor =
            toolManagerRef.current?.getCursor() ?? 'default';
        }
        return;
      }

      const pe = makePointerEvent(e);
      toolManagerRef.current?.onPointerUp(pe);

      // Update cursor immediately
      if (canvasRef.current) {
        canvasRef.current.style.cursor =
          toolManagerRef.current?.getCursor() ?? 'default';
      }
    },
    [makePointerEvent, clearLongPress],
  );

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    // Right-click: dispatch to tool (for polygon closing, etc.)
    const pe = makePointerEvent(e);
    // Simulate a right-click pointer down
    toolManagerRef.current?.onPointerDown({
      ...pe,
      button: 2,
    });
  }, [makePointerEvent]);

  // ── Keyboard handlers ──
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't capture if typing in an input
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        e.target instanceof HTMLSelectElement
      ) {
        return;
      }

      // Start testing (default F5)
      const restartKey = useEditorStore.getState().testConfig.restartKey;
      if (e.code === restartKey) {
        e.preventDefault();
        const store = useEditorStore.getState();
        if (store.level && !store.isTesting) {
          store.startTesting();
        }
        return;
      }

      // Disable all editor shortcuts while testing
      if (useEditorStore.getState().isTesting) return;

      const ctrl = e.ctrlKey || e.metaKey;

      // Undo/Redo
      if (ctrl && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        undo();
        return;
      }
      if (ctrl && (e.key === 'y' || (e.shiftKey && e.key === 'Z'))) {
        e.preventDefault();
        redo();
        return;
      }

      // Save
      if (ctrl && e.key === 's') {
        e.preventDefault();
        const store = useEditorStore.getState();
        if (store.level && store.fileName) {
          downloadLevel(store.level, store.fileName);
        }
        return;
      }

      // New level
      if (ctrl && e.key === 'n') {
        e.preventDefault();
        useEditorStore.getState().newLevel();
        return;
      }

      // Copy / Cut / Paste
      if (ctrl && e.key === 'c') {
        e.preventDefault();
        useEditorStore.getState().copySelection();
        return;
      }
      if (ctrl && e.key === 'x') {
        e.preventDefault();
        useEditorStore.getState().cutSelection();
        return;
      }
      if (ctrl && e.key === 'v') {
        e.preventDefault();
        useEditorStore.getState().pasteClipboard();
        return;
      }

      // Space -> temporary pan
      if (e.key === ' ' && !spaceHeldRef.current) {
        e.preventDefault();
        spaceHeldRef.current = true;
        prevToolRef.current = useEditorStore.getState().activeTool;
        useEditorStore.getState().setActiveTool(ToolId.Pan);
        return;
      }

      // Grid visibility toggle
      if (e.key.toLowerCase() === 'g' && !ctrl && !e.altKey) {
        const store = useEditorStore.getState();
        store.setGrid({ visible: !store.grid.visible });
        return;
      }

      // Auto-grass
      if (e.key.toLowerCase() === 't' && !ctrl && !e.altKey) {
        useEditorStore.getState().autoGrassSelectedPolygons();
        return;
      }

      // Tool shortcuts (only when a level is loaded)
      if (!ctrl && !e.altKey && useEditorStore.getState().level) {
        const toolMap: Record<string, ToolId> = {
          s: ToolId.Select,
          d: ToolId.DrawPolygon,
          p: ToolId.Pipe,
          r: ToolId.Shape,
          o: ToolId.DrawObject,
          v: ToolId.Vertex,
          h: ToolId.Pan,
          q: ToolId.DrawPicture,
          m: ToolId.DrawMask,
          i: ToolId.ImageImport,
        };
        const tool = toolMap[e.key.toLowerCase()];
        if (tool) {
          useEditorStore.getState().setActiveTool(tool);
          return;
        }
      }

      // Select all (skip hidden elements)
      if (ctrl && e.key === 'a') {
        e.preventDefault();
        const store = useEditorStore.getState();
        if (!store.level) return;
        const visiblePolyIndices = store.level.polygons
          .map((p, i) => ({ p, i }))
          .filter(({ p }) => store.showGrass || !p.grass)
          .map(({ i }) => i);
        const sel = {
          polygonIndices: new Set(visiblePolyIndices),
          vertexIndices: new Map(
            visiblePolyIndices.map((i) => [
              i,
              new Set(store.level!.polygons[i]!.vertices.map((_, vi) => vi)),
            ]),
          ),
          objectIndices: store.showObjects
            ? new Set(store.level.objects.map((_, i) => i))
            : new Set<number>(),
          pictureIndices: new Set(
            store.level.pictures
              .map((p, i) => ({ p, i }))
              .filter(({ p }) => {
                const isTexMask = !!(p.texture && p.mask);
                return isTexMask ? store.showTextures : store.showPictures;
              })
              .map(({ i }) => i),
          ),
        };
        store.setSelection(sel);
        return;
      }

      // Escape
      if (e.key === 'Escape') {
        useEditorStore.getState().clearSelection();
      }

      // Delegate to tool
      toolManagerRef.current?.onKeyDown(e);
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (useEditorStore.getState().isTesting) return;

      // Space release -> restore previous tool
      if (e.key === ' ' && spaceHeldRef.current) {
        spaceHeldRef.current = false;
        if (prevToolRef.current) {
          useEditorStore.getState().setActiveTool(prevToolRef.current);
          prevToolRef.current = null;
        }
        return;
      }
      toolManagerRef.current?.onKeyUp(e);
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, []);

  // ── Start page handlers ──
  const handleNewLevel = useCallback(() => {
    useEditorStore.getState().newLevel();
  }, []);

  const handleOpenLevel = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileInputChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const { level: lev, fileName } = await readLevelFile(file);
      const store = useEditorStore.getState();
      store.loadLevel(lev, fileName);
      const canvas = canvasRef.current;
      if (canvas) {
        const rect = canvas.getBoundingClientRect();
        store.setViewport(fitLevel(lev.polygons, rect.width, rect.height));
      }
      e.target.value = '';
    },
    [],
  );

  // ── Drag-and-drop ──
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  }, []);

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (!file || !file.name.endsWith('.lev')) return;

    const { level, fileName } = await readLevelFile(file);
    const store = useEditorStore.getState();
    store.loadLevel(level, fileName);

    // Fit level to canvas
    const canvas = canvasRef.current;
    if (canvas) {
      const rect = canvas.getBoundingClientRect();
      const vp = fitLevel(level.polygons, rect.width, rect.height);
      store.setViewport(vp);
    }
  }, []);

  return (
    <div
      ref={containerRef}
      style={{ width: '100%', height: '100%', position: 'relative' }}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      <canvas
        ref={canvasRef}
        tabIndex={0}
        style={{
          display: 'block',
          outline: 'none',
          touchAction: 'none',
        }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={(e) => {
          activePointersRef.current.delete(e.pointerId);
          clearLongPress();
        }}
        onContextMenu={handleContextMenu}
      />
      {!level && (
        <div className="start-page">
          <h1 className="start-page__title">Elma Level Editor</h1>
          <p className="start-page__subtitle">
            Create a new level or open an existing one
          </p>
          <div className="start-page__actions">
            <button className="btn start-page__btn" onClick={handleNewLevel}>
              New Level
            </button>
            <button className="btn start-page__btn" onClick={handleOpenLevel}>
              Open Level
            </button>
          </div>
          <p className="start-page__hint">or drag a .lev file here</p>
          <input
            ref={fileInputRef}
            type="file"
            accept=".lev"
            style={{ display: 'none' }}
            onChange={handleFileInputChange}
          />
        </div>
      )}
    </div>
  );
}
