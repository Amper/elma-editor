/**
 * Shared helpers for textured polygon preview in drawing tools.
 * Determines whether a point is on ground or sky (even-odd rule),
 * then fills the current path with the opposite texture.
 */
import type { Polygon } from 'elmajs';
import type { Level } from 'elmajs';
import { getEditorLgr, TEXTURE_SCALE } from '@/canvas/lgrCache';

/** Ray-casting point-in-polygon test */
function pointInPolygon(px: number, py: number, verts: Array<{ x: number; y: number }>): boolean {
  let inside = false;
  for (let i = 0, j = verts.length - 1; i < verts.length; j = i++) {
    const xi = verts[i]!.x, yi = verts[i]!.y;
    const xj = verts[j]!.x, yj = verts[j]!.y;
    if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

/** Even-odd test: even containing ground polygons = ground, odd = sky. */
export function isPointOnGround(px: number, py: number, polygons: Polygon[]): boolean {
  let count = 0;
  for (const poly of polygons) {
    if (poly.grass || poly.vertices.length < 3) continue;
    if (pointInPolygon(px, py, poly.vertices)) count++;
  }
  return count % 2 === 0;
}

const patternTransform = new DOMMatrix([TEXTURE_SCALE, 0, 0, TEXTURE_SCALE, 0, 0]);

/**
 * Fill a preview polygon with the textures it will have once committed.
 *
 * Uses two separate passes with even-odd clipping to isolate ground
 * and sky regions, then fills each with the opposite texture (since
 * adding a polygon flips the parity).
 *
 * @param previewVerts - vertices of the polygon being drawn
 */
export function fillWithPreviewTexture(
  ctx: CanvasRenderingContext2D,
  level: Level | null,
  previewVerts: Array<{ x: number; y: number }>,
): boolean {
  if (!level || previewVerts.length < 3) return false;
  const lgrAssets = getEditorLgr();
  if (!lgrAssets) return false;

  const groundPattern = lgrAssets.texturePatterns.get(level.ground ?? 'ground');
  const skyPattern = lgrAssets.texturePatterns.get(level.sky ?? 'sky');
  if (!groundPattern || !skyPattern) return false;

  const groundPolys = level.polygons.filter(
    (p) => !p.grass && p.vertices.length >= 3,
  );

  groundPattern.setTransform(patternTransform);
  skyPattern.setTransform(patternTransform);

  const clipToPreview = () => {
    ctx.beginPath();
    ctx.moveTo(previewVerts[0]!.x, previewVerts[0]!.y);
    for (let i = 1; i < previewVerts.length; i++) {
      ctx.lineTo(previewVerts[i]!.x, previewVerts[i]!.y);
    }
    ctx.closePath();
    ctx.clip();
  };

  const addPolySubpaths = () => {
    for (const poly of groundPolys) {
      ctx.moveTo(poly.vertices[0]!.x, poly.vertices[0]!.y);
      for (let i = 1; i < poly.vertices.length; i++) {
        ctx.lineTo(poly.vertices[i]!.x, poly.vertices[i]!.y);
      }
      ctx.closePath();
    }
  };

  // Pass 1: "currently ground" areas → fill with sky texture (ground becomes sky)
  // Even-odd clip of (outer rect + existing polys) → clips to ground areas
  ctx.save();
  clipToPreview();
  ctx.beginPath();
  ctx.rect(-10000, -10000, 20000, 20000);
  addPolySubpaths();
  ctx.clip('evenodd');
  ctx.globalAlpha = 0.3;
  ctx.fillStyle = skyPattern;
  ctx.fillRect(-10000, -10000, 20000, 20000);
  ctx.restore();

  // Pass 2: "currently sky" areas → fill with ground texture (sky becomes ground)
  // Even-odd clip of (just existing polys, no outer rect) → clips to sky areas
  if (groundPolys.length > 0) {
    ctx.save();
    clipToPreview();
    ctx.beginPath();
    addPolySubpaths();
    ctx.clip('evenodd');
    ctx.globalAlpha = 0.3;
    ctx.fillStyle = groundPattern;
    ctx.fillRect(-10000, -10000, 20000, 20000);
    ctx.restore();
  }

  return true;
}
