import { ObjectType, OBJECT_RADIUS } from 'elmajs';
import type { Vec2 } from '@/types';
import { applyViewportTransform } from './viewport';
import { getTheme } from './themeColors';
import { computeBBox } from '@/utils/geometry';
import type { LibraryItem } from '@/state/libraryStore';

const LINE_WIDTH = 0.02;

export function renderLibraryPreview(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  item: LibraryItem,
): void {
  const t = getTheme();

  // Collect all points for bounding box
  const points: Vec2[] = [];
  for (const p of item.polygons) {
    for (const v of p.vertices) points.push(v);
  }
  for (const o of item.objects) points.push({ x: o.x, y: o.y });
  for (const pic of item.pictures) points.push({ x: pic.x, y: pic.y });

  if (points.length === 0) return;

  const bbox = computeBBox(points);
  const bboxW = bbox.maxX - bbox.minX || 1;
  const bboxH = bbox.maxY - bbox.minY || 1;
  const pad = 1.2;
  const zoom = Math.min(width / (bboxW * pad), height / (bboxH * pad));
  const centerX = (bbox.minX + bbox.maxX) / 2;
  const centerY = (bbox.minY + bbox.maxY) / 2;

  ctx.resetTransform();
  ctx.fillStyle = t.sky;
  ctx.fillRect(0, 0, width, height);

  ctx.save();
  applyViewportTransform(ctx, { centerX, centerY, zoom }, width, height);

  // Ground polygons (even-odd fill)
  const groundPolygons = item.polygons.filter((p) => !p.grass && p.vertices.length >= 3);
  if (groundPolygons.length > 0) {
    const halfW = width / (2 * zoom);
    const halfH = height / (2 * zoom);
    const p = Math.max(halfW, halfH) * 2;
    const left = centerX - halfW - p;
    const top = centerY - halfH - p;
    const rectW = (halfW + p) * 2;
    const rectH = (halfH + p) * 2;

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

  // Grass polygons
  for (const poly of item.polygons) {
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
  for (const obj of item.objects) {
    ctx.beginPath();
    ctx.arc(obj.x, obj.y, OBJECT_RADIUS, 0, Math.PI * 2);
    switch (obj.type) {
      case ObjectType.Exit: ctx.fillStyle = t.objExit; break;
      case ObjectType.Apple: ctx.fillStyle = t.objApple; break;
      case ObjectType.Killer: ctx.fillStyle = t.objKiller; break;
      case ObjectType.Start: ctx.fillStyle = t.objStart; break;
      default: ctx.fillStyle = '#888';
    }
    ctx.fill();
  }

  // Pictures as small rectangles
  for (const pic of item.pictures) {
    ctx.fillStyle = 'rgba(128, 128, 200, 0.5)';
    ctx.fillRect(pic.x - 0.3, pic.y - 0.3, 0.6, 0.6);
    ctx.strokeStyle = 'rgba(128, 128, 200, 0.8)';
    ctx.lineWidth = LINE_WIDTH;
    ctx.strokeRect(pic.x - 0.3, pic.y - 0.3, 0.6, 0.6);
  }

  ctx.restore();
}
