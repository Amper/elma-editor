import type { ElmaObject, Picture, Polygon } from 'elmajs';
import { ObjectType, Gravity, OBJECT_RADIUS, Clip } from 'elmajs';
import type { ViewportState } from '@/types';
import { getTheme, type ThemeColors } from './themeColors';
import { BIKE_PREVIEW_SIZE, type LgrEditorAssets } from './lgrCache';

/** Cache composited texture-within-mask bitmaps to avoid re-compositing every frame. */
const textureMaskCache = new Map<string, ImageBitmap>();

function getOrCreateTextureMaskBitmap(
  texture: string,
  mask: string,
  lgrAssets: LgrEditorAssets,
): { bitmap: ImageBitmap; worldW: number; worldH: number } | null {
  const maskData = lgrAssets.masks.get(mask);
  const texPattern = lgrAssets.texturePatterns.get(texture);
  if (!maskData || !texPattern) return null;

  const cacheKey = `${texture}:${mask}`;
  const cached = textureMaskCache.get(cacheKey);
  if (cached) {
    return { bitmap: cached, worldW: maskData.worldW, worldH: maskData.worldH };
  }

  const pw = maskData.bitmap.width;
  const ph = maskData.bitmap.height;
  const oc = new OffscreenCanvas(pw, ph);
  const octx = oc.getContext('2d')!;

  texPattern.setTransform(new DOMMatrix());
  octx.fillStyle = texPattern;
  octx.fillRect(0, 0, pw, ph);

  octx.globalCompositeOperation = 'destination-in';
  octx.drawImage(maskData.bitmap, 0, 0);

  const bitmap = oc.transferToImageBitmap();
  textureMaskCache.set(cacheKey, bitmap);
  return { bitmap, worldW: maskData.worldW, worldH: maskData.worldH };
}

/** Object size in world space: 40 original pixels / 48 pixels-per-meter */
const OBJECT_WORLD_SIZE = 40 / 48;

function objectColor(type: number, t: ThemeColors): string {
  switch (type) {
    case ObjectType.Exit: return t.objExit;
    case ObjectType.Apple: return t.objApple;
    case ObjectType.Killer: return t.objKiller;
    case ObjectType.Start: return t.objStart;
    default: return '#888888';
  }
}

function drawGravityArrow(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  gravity: number,
): void {
  // Direction vectors in editor space (Y-down)
  let dx = 0, dy = 0;
  switch (gravity) {
    case Gravity.Up:    dy = -1; break;
    case Gravity.Down:  dy =  1; break;
    case Gravity.Left:  dx = -1; break;
    case Gravity.Right: dx =  1; break;
    default: return;
  }
  const r = OBJECT_RADIUS;
  const shaft = r * 0.55;
  const head = r * 0.3;

  ctx.beginPath();
  ctx.moveTo(x - dx * shaft * 0.3, y - dy * shaft * 0.3);
  ctx.lineTo(x + dx * shaft, y + dy * shaft);
  ctx.moveTo(x + dx * shaft, y + dy * shaft);
  ctx.lineTo(x + dx * shaft - dx * head - dy * head * 0.5, y + dy * shaft - dy * head + dx * head * 0.5);
  ctx.moveTo(x + dx * shaft, y + dy * shaft);
  ctx.lineTo(x + dx * shaft - dx * head + dy * head * 0.5, y + dy * shaft - dy * head - dx * head * 0.5);
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 0.05;
  ctx.stroke();
}

function drawCircleFallback(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  color: string,
): void {
  const r = OBJECT_RADIUS;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.globalAlpha = 0.7;
  ctx.fill();
  ctx.globalAlpha = 1.0;

  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.strokeStyle = color;
  ctx.lineWidth = 0.04;
  ctx.stroke();
}

function getSpriteForType(type: number, lgrAssets: LgrEditorAssets): ImageBitmap | null {
  switch (type) {
    case ObjectType.Exit: return lgrAssets.sprites.exit;
    case ObjectType.Apple: return lgrAssets.sprites.food;
    case ObjectType.Killer: return lgrAssets.sprites.killer;
    default: return null;
  }
}

export function renderObjects(
  ctx: CanvasRenderingContext2D,
  objects: ElmaObject[],
  lgrAssets?: LgrEditorAssets | null,
): void {
  const t = getTheme();

  for (const obj of objects) {
    const { x, y } = obj.position;

    // Start objects: draw bike preview or circle fallback
    if (obj.type === ObjectType.Start) {
      if (lgrAssets?.bikeSprite) {
        const half = BIKE_PREVIEW_SIZE / 2;
        ctx.drawImage(lgrAssets.bikeSprite, x - half, y - half, BIKE_PREVIEW_SIZE, BIKE_PREVIEW_SIZE);
      } else {
        drawCircleFallback(ctx, x, y, objectColor(obj.type, t));
      }
      continue;
    }

    const sprite = lgrAssets ? getSpriteForType(obj.type, lgrAssets) : null;

    if (sprite) {
      const half = OBJECT_WORLD_SIZE / 2;
      ctx.drawImage(sprite, x - half, y - half, OBJECT_WORLD_SIZE, OBJECT_WORLD_SIZE);
    } else {
      drawCircleFallback(ctx, x, y, objectColor(obj.type, t));
    }

    // Gravity arrow for apples
    if (obj.type === ObjectType.Apple && obj.gravity !== Gravity.None) {
      drawGravityArrow(ctx, x, y, obj.gravity);
    }
  }
}

/**
 * Build a clipping path for ground or sky areas using even-odd fill.
 * Ground = outside polygon cutouts, Sky = inside polygon cutouts.
 */
function buildClipPath(
  ctx: CanvasRenderingContext2D,
  polygons: Polygon[],
  viewport: ViewportState,
  canvasW: number,
  canvasH: number,
): void {
  const groundPolygons = polygons.filter((p) => !p.grass && p.vertices.length >= 3);

  // Large outer rectangle covering the viewport
  const halfW = canvasW / (2 * viewport.zoom);
  const halfH = canvasH / (2 * viewport.zoom);
  const pad = Math.max(halfW, halfH) * 2;
  const left = viewport.centerX - halfW - pad;
  const top = viewport.centerY - halfH - pad;
  const width = (halfW + pad) * 2;
  const height = (halfH + pad) * 2;

  ctx.beginPath();
  ctx.rect(left, top, width, height);
  for (const poly of groundPolygons) {
    ctx.moveTo(poly.vertices[0]!.x, poly.vertices[0]!.y);
    for (let i = 1; i < poly.vertices.length; i++) {
      ctx.lineTo(poly.vertices[i]!.x, poly.vertices[i]!.y);
    }
    ctx.closePath();
  }
}

export function renderPictures(
  ctx: CanvasRenderingContext2D,
  pictures: Picture[],
  polygons: Polygon[],
  viewport: ViewportState,
  canvasW: number,
  canvasH: number,
  lgrAssets?: LgrEditorAssets | null,
  showPictures = true,
  showTextures = true,
): void {
  if (!lgrAssets || pictures.length === 0) return;

  // Sort by distance (lower = further back = render first)
  const sorted = [...pictures].sort((a, b) => a.distance - b.distance);

  // Group by clip mode to minimize clip path changes
  const unclipped: Picture[] = [];
  const groundClipped: Picture[] = [];
  const skyClipped: Picture[] = [];
  for (const pic of sorted) {
    if (pic.clip === Clip.Ground) groundClipped.push(pic);
    else if (pic.clip === Clip.Sky) skyClipped.push(pic);
    else unclipped.push(pic);
  }

  function drawPic(pic: Picture) {
    if (pic.texture && pic.mask) {
      if (!showTextures) return;
      const result = getOrCreateTextureMaskBitmap(pic.texture, pic.mask, lgrAssets!);
      if (!result) return;
      ctx.drawImage(result.bitmap, pic.position.x, pic.position.y, result.worldW, result.worldH);
    } else {
      if (!showPictures) return;
      const data = lgrAssets!.pictures.get(pic.name);
      if (!data) return;
      ctx.drawImage(data.bitmap, pic.position.x, pic.position.y, data.worldW, data.worldH);
    }
  }

  // 1. Unclipped pictures
  for (const pic of unclipped) drawPic(pic);

  // 2. Ground-clipped pictures (only visible in ground areas)
  if (groundClipped.length > 0) {
    ctx.save();
    buildClipPath(ctx, polygons, viewport, canvasW, canvasH);
    ctx.clip('evenodd');
    for (const pic of groundClipped) drawPic(pic);
    ctx.restore();
  }

  // 3. Sky-clipped pictures (only visible in sky/polygon interior areas)
  if (skyClipped.length > 0) {
    ctx.save();
    const groundPolygons = polygons.filter((p) => !p.grass && p.vertices.length >= 3);
    ctx.beginPath();
    for (const poly of groundPolygons) {
      ctx.moveTo(poly.vertices[0]!.x, poly.vertices[0]!.y);
      for (let i = 1; i < poly.vertices.length; i++) {
        ctx.lineTo(poly.vertices[i]!.x, poly.vertices[i]!.y);
      }
      ctx.closePath();
    }
    ctx.clip('evenodd');
    for (const pic of skyClipped) drawPic(pic);
    ctx.restore();
  }
}
