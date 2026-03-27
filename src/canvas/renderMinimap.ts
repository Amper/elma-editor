import type { Level } from 'elmajs';
import { ObjectType, OBJECT_RADIUS } from 'elmajs';
import type { ViewportState } from '@/types';
import { applyViewportTransform } from './viewport';
import { getTheme } from './themeColors';

const LINE_WIDTH = 0.02;

/**
 * Render a simplified level overview for the minimap canvas.
 * No textures, grid, overlays, or pictures — just geometry and objects.
 */
export function renderMinimap(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  level: Level,
  viewport: ViewportState,
): void {
  const t = getTheme();

  // Clear with sky color
  ctx.resetTransform();
  ctx.fillStyle = t.sky;
  ctx.fillRect(0, 0, width, height);

  // Apply minimap viewport transform
  ctx.save();
  applyViewportTransform(ctx, viewport, width, height);

  // Ground polygons (even-odd fill)
  const groundPolygons = level.polygons.filter((p) => !p.grass && p.vertices.length >= 3);
  if (groundPolygons.length > 0) {
    // Compute bounds for outer rectangle
    const halfW = width / (2 * viewport.zoom);
    const halfH = height / (2 * viewport.zoom);
    const pad = Math.max(halfW, halfH) * 2;
    const left = viewport.centerX - halfW - pad;
    const top = viewport.centerY - halfH - pad;
    const rectW = (halfW + pad) * 2;
    const rectH = (halfH + pad) * 2;

    ctx.beginPath();
    ctx.rect(left, top, rectW, rectH);
    for (const poly of groundPolygons) {
      ctx.moveTo(poly.vertices[0]!.x, poly.vertices[0]!.y);
      for (let i = 1; i < poly.vertices.length; i++) {
        ctx.lineTo(poly.vertices[i]!.x, poly.vertices[i]!.y);
      }
      ctx.closePath();
    }
    ctx.fillStyle = t.ground;
    ctx.fill('evenodd');

    // Stroke edges
    ctx.lineWidth = LINE_WIDTH;
    ctx.strokeStyle = t.groundStroke;
    for (const poly of groundPolygons) {
      ctx.beginPath();
      ctx.moveTo(poly.vertices[0]!.x, poly.vertices[0]!.y);
      for (let i = 1; i < poly.vertices.length; i++) {
        ctx.lineTo(poly.vertices[i]!.x, poly.vertices[i]!.y);
      }
      ctx.closePath();
      ctx.stroke();
    }
  }

  // Grass edges
  for (const poly of level.polygons) {
    if (!poly.grass || poly.vertices.length < 2) continue;
    ctx.beginPath();
    ctx.moveTo(poly.vertices[0]!.x, poly.vertices[0]!.y);
    for (let i = 1; i < poly.vertices.length; i++) {
      ctx.lineTo(poly.vertices[i]!.x, poly.vertices[i]!.y);
    }
    ctx.closePath();
    ctx.fillStyle = t.grassFill;
    ctx.fill();
    ctx.lineWidth = LINE_WIDTH * 2;
    ctx.strokeStyle = t.grass;
    ctx.stroke();
  }

  // Objects as colored dots
  for (const obj of level.objects) {
    ctx.beginPath();
    ctx.arc(obj.position.x, obj.position.y, OBJECT_RADIUS, 0, Math.PI * 2);
    switch (obj.type) {
      case ObjectType.Exit: ctx.fillStyle = t.objExit; break;
      case ObjectType.Apple: ctx.fillStyle = t.objApple; break;
      case ObjectType.Killer: ctx.fillStyle = t.objKiller; break;
      case ObjectType.Start: ctx.fillStyle = t.objStart; break;
      default: ctx.fillStyle = '#888';
    }
    ctx.fill();
  }

  ctx.restore();
}
