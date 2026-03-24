import type { Level } from 'elmajs';
import type { ViewportState, SelectionState, GridConfig, TopologyError, ToolId } from '@/types';
import { applyViewportTransform } from './viewport';
import { renderGroundPolygons, renderGrassEdges } from './renderPolygons';
import { renderObjects, renderPictures } from './renderObjects';
import { renderGrid } from './renderGrid';
import { renderOverlays } from './renderOverlays';
import { getTheme } from './themeColors';
import { getEditorLgr } from './lgrCache';

export interface RenderContext {
  level: Level | null;
  viewport: ViewportState;
  selection: SelectionState;
  grid: GridConfig;
  topologyErrors: TopologyError[];
  activeTool: ToolId;
  showGrass: boolean;
  showPictures: boolean;
  showTextures: boolean;
  showObjects: boolean;
}

export function renderFrame(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  rc: RenderContext,
): void {
  const dpr = window.devicePixelRatio || 1;
  const cssW = width / dpr;
  const cssH = height / dpr;

  const lgrAssets = getEditorLgr();

  // Clear and draw sky background
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const skyTextureName = rc.level?.sky ?? 'sky';
  const skyPattern = rc.showTextures ? lgrAssets?.texturePatterns.get(skyTextureName) : null;
  if (skyPattern) {
    // Game sky shader tiles at 1:1 screen pixels with camera offset scroll.
    // CTM is scale(dpr), so user coords = CSS pixels.
    // Pattern transform scrolls by camera position (48 px/m) in CSS space.
    const vp = rc.viewport;
    skyPattern.setTransform(
      new DOMMatrix().translateSelf(-vp.centerX * 48, -vp.centerY * 48),
    );
    ctx.fillStyle = skyPattern;
    ctx.fillRect(0, 0, cssW, cssH);
  } else {
    ctx.fillStyle = getTheme().sky;
    ctx.fillRect(0, 0, cssW, cssH);
  }

  if (!rc.level) return;

  const groundTextureName = rc.level.ground ?? 'ground';

  // Apply world transform
  ctx.save();
  applyViewportTransform(ctx, rc.viewport, cssW, cssH);

  // Layer 1: Ground polygons (even-odd fill — needs viewport for bounds)
  renderGroundPolygons(ctx, rc.level.polygons, rc.viewport, cssW, cssH,
    rc.showTextures ? lgrAssets : null, groundTextureName);

  // Layer 2: Grid (drawn on top of ground so visible in sky areas)
  if (rc.grid.visible) {
    renderGrid(ctx, rc.viewport, cssW, cssH, rc.grid.size);
  }

  // Layer 3: Grass edges
  if (rc.showGrass) {
    renderGrassEdges(ctx, rc.level.polygons);
  }

  // Layer 3.5: Pictures (between grass and objects, matching game render order)
  if (rc.showPictures || rc.showTextures) {
    renderPictures(ctx, rc.level.pictures, rc.level.polygons, rc.viewport, cssW, cssH,
      lgrAssets, rc.showPictures, rc.showTextures);
  }

  // Layer 4: Objects (simplified circle fallback when textures hidden)
  if (rc.showObjects) {
    renderObjects(ctx, rc.level.objects, rc.showTextures ? lgrAssets : null);
  }

  // Layer 5: Overlays (selection, topology errors)
  renderOverlays(ctx, {
    level: rc.level,
    viewport: rc.viewport,
    selection: rc.selection,
    topologyErrors: rc.topologyErrors,
    timestamp: performance.now(),
    activeTool: rc.activeTool,
  });

  ctx.restore();
}
