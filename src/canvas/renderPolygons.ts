import type { Polygon } from 'elmajs';
import type { ViewportState } from '@/types';
import { getTheme } from './themeColors';
import { TEXTURE_SCALE, type LgrEditorAssets } from './lgrCache';

/** Reusable DOMMatrix for pattern transform — avoids allocation each frame */
const patternMatrix = new DOMMatrix();

const LINE_WIDTH = 0.02;

/**
 * Correct Elma ground/sky rendering using the even-odd fill rule.
 *
 * In Elma, the ENTIRE world is solid ground. Polygons define CUT-OUTS
 * (sky/air where the player rides). The canvas is pre-filled with sky
 * color by the renderer. We draw a large outer rectangle plus all
 * ground polygon sub-paths, then fill with even-odd rule — polygon
 * interiors stay as sky, everything else becomes ground.
 */
export function renderGroundPolygons(
  ctx: CanvasRenderingContext2D,
  polygons: Polygon[],
  viewport: ViewportState,
  canvasW: number,
  canvasH: number,
  lgrAssets?: LgrEditorAssets | null,
  groundTextureName?: string,
): void {
  const groundPolygons = polygons.filter((p) => !p.grass && p.vertices.length >= 3);
  if (groundPolygons.length === 0) return;

  const t = getTheme();

  // Compute visible world-space bounds with generous padding
  const halfW = canvasW / (2 * viewport.zoom);
  const halfH = canvasH / (2 * viewport.zoom);
  const pad = Math.max(halfW, halfH) * 2;
  const left = viewport.centerX - halfW - pad;
  const top = viewport.centerY - halfH - pad;
  const width = (halfW + pad) * 2;
  const height = (halfH + pad) * 2;

  // Build compound path: outer rect + polygon sub-paths
  ctx.beginPath();

  // Outer rectangle (covers beyond viewport)
  ctx.rect(left, top, width, height);

  // Each ground polygon as a sub-path
  for (const poly of groundPolygons) {
    ctx.moveTo(poly.vertices[0]!.x, poly.vertices[0]!.y);
    for (let i = 1; i < poly.vertices.length; i++) {
      ctx.lineTo(poly.vertices[i]!.x, poly.vertices[i]!.y);
    }
    ctx.closePath();
  }

  // Even-odd fill: polygon interiors = sky (cut out), exterior = ground
  const groundPattern = lgrAssets?.texturePatterns.get(groundTextureName ?? 'ground');
  if (groundPattern) {
    // Canvas2D composes: CTM * patternTransform. CTM already maps world→device,
    // so patternTransform just needs scale(1/48) to make each texture pixel = 1/48 world units.
    patternMatrix.a = TEXTURE_SCALE;
    patternMatrix.b = 0;
    patternMatrix.c = 0;
    patternMatrix.d = TEXTURE_SCALE;
    patternMatrix.e = 0;
    patternMatrix.f = 0;
    groundPattern.setTransform(patternMatrix);
    ctx.fillStyle = groundPattern;
  } else {
    ctx.fillStyle = t.ground;
  }
  ctx.fill('evenodd');

  // Stroke polygon edges
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

export function renderGrassEdges(
  ctx: CanvasRenderingContext2D,
  polygons: Polygon[],
): void {
  const t = getTheme();

  for (const poly of polygons) {
    if (!poly.grass || poly.vertices.length < 2) continue;

    ctx.beginPath();
    ctx.moveTo(poly.vertices[0]!.x, poly.vertices[0]!.y);
    for (let i = 1; i < poly.vertices.length; i++) {
      ctx.lineTo(poly.vertices[i]!.x, poly.vertices[i]!.y);
    }
    ctx.closePath();

    // Fill background
    ctx.fillStyle = t.grassFill;
    ctx.fill();

    // Stroke outline
    ctx.lineWidth = LINE_WIDTH * 2;
    ctx.strokeStyle = t.grass;
    ctx.stroke();
  }
}
