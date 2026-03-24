import type { Vec2, ViewportState } from '@/types';

/**
 * Convert world coordinates to canvas pixel coordinates.
 * Elma Y increases downward, matching screen coordinates — no flip needed.
 */
export function worldToScreen(
  world: Vec2,
  vp: ViewportState,
  canvasW: number,
  canvasH: number,
): Vec2 {
  return {
    x: (world.x - vp.centerX) * vp.zoom + canvasW / 2,
    y: (world.y - vp.centerY) * vp.zoom + canvasH / 2,
  };
}

/** Convert canvas pixel coordinates to world coordinates. */
export function screenToWorld(
  screen: Vec2,
  vp: ViewportState,
  canvasW: number,
  canvasH: number,
): Vec2 {
  return {
    x: (screen.x - canvasW / 2) / vp.zoom + vp.centerX,
    y: (screen.y - canvasH / 2) / vp.zoom + vp.centerY,
  };
}

/**
 * Apply viewport transform to Canvas 2D context.
 * Called once at the start of each frame before any world-space drawing.
 */
export function applyViewportTransform(
  ctx: CanvasRenderingContext2D,
  vp: ViewportState,
  canvasW: number,
  canvasH: number,
): void {
  ctx.translate(canvasW / 2, canvasH / 2);
  ctx.scale(vp.zoom, vp.zoom);
  ctx.translate(-vp.centerX, -vp.centerY);
}

/**
 * Zoom toward a screen-space point (e.g., the mouse cursor).
 * The world-space position under the cursor stays fixed.
 */
export function zoomAtPoint(
  vp: ViewportState,
  screenPoint: Vec2,
  delta: number,
  canvasW: number,
  canvasH: number,
): ViewportState {
  const factor = delta > 0 ? 1.1 : 1 / 1.1;
  const newZoom = Math.max(1, Math.min(10000, vp.zoom * factor));

  // World-space point under cursor before zoom
  const worldBefore = screenToWorld(screenPoint, vp, canvasW, canvasH);

  // After zoom, the same screen point should map to the same world point.
  // screenPoint = (worldBefore - newCenter) * newZoom + canvas/2
  // => newCenter = worldBefore - (screenPoint - canvas/2) / newZoom
  const newCenterX = worldBefore.x - (screenPoint.x - canvasW / 2) / newZoom;
  const newCenterY = worldBefore.y - (screenPoint.y - canvasH / 2) / newZoom;

  return { centerX: newCenterX, centerY: newCenterY, zoom: newZoom };
}

/** Pan by a screen-space pixel delta. */
export function panByScreenDelta(
  vp: ViewportState,
  dx: number,
  dy: number,
): ViewportState {
  return {
    centerX: vp.centerX - dx / vp.zoom,
    centerY: vp.centerY - dy / vp.zoom,
    zoom: vp.zoom,
  };
}

/** Compute viewport that fits all level geometry into the canvas. */
export function fitLevel(
  polygons: Array<{ vertices: Array<{ x: number; y: number }> }>,
  canvasW: number,
  canvasH: number,
  padding = 0.1,
): ViewportState {
  if (polygons.length === 0 || canvasW === 0 || canvasH === 0) {
    return { centerX: 0, centerY: 0, zoom: 50 };
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const poly of polygons) {
    for (const v of poly.vertices) {
      if (v.x < minX) minX = v.x;
      if (v.y < minY) minY = v.y;
      if (v.x > maxX) maxX = v.x;
      if (v.y > maxY) maxY = v.y;
    }
  }

  const levelW = maxX - minX || 1;
  const levelH = maxY - minY || 1;
  const zoom = Math.min(
    canvasW / (levelW * (1 + padding)),
    canvasH / (levelH * (1 + padding)),
  );

  return {
    centerX: (minX + maxX) / 2,
    centerY: (minY + maxY) / 2,
    zoom,
  };
}
