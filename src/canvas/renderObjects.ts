import type { ElmaObject, Picture, Polygon } from 'elmajs';
import { ObjectType, Gravity, OBJECT_RADIUS, Clip } from 'elmajs';
import type { ViewportState, DebugStartConfig, TrajectoryPoint } from '@/types';
import { getTheme, type ThemeColors } from './themeColors';
import { BIKE_PREVIEW_SIZE, type LgrEditorAssets, getEditorLgr } from './lgrCache';
import { DEBUG_START_COLOR } from '@/tools/DrawObjectTool';

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

/** Animation rate: ~30 fps matching original game display rate. */
const ANIM_FPS = 30;

function getSpriteForType(type: number, lgrAssets: LgrEditorAssets, animationTime?: number): ImageBitmap | null {
  if (animationTime !== undefined) {
    const frameIndex = Math.floor((animationTime / 1000) * ANIM_FPS);
    switch (type) {
      case ObjectType.Exit: {
        const frames = lgrAssets.sprites.exitFrames;
        return frames.length > 0 ? frames[((frameIndex % frames.length) + frames.length) % frames.length]! : null;
      }
      case ObjectType.Apple: {
        const frames = lgrAssets.sprites.foodFrames;
        return frames.length > 0 ? frames[((frameIndex % frames.length) + frames.length) % frames.length]! : null;
      }
      case ObjectType.Killer: {
        const frames = lgrAssets.sprites.killerFrames;
        return frames.length > 0 ? frames[((frameIndex % frames.length) + frames.length) % frames.length]! : null;
      }
      default: return null;
    }
  }
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
  animationTime?: number,
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

    const sprite = lgrAssets ? getSpriteForType(obj.type, lgrAssets, animationTime) : null;

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

/** Cache for the horizontally flipped bike sprite. */
let flippedSpriteCache: { source: ImageBitmap; flipped: HTMLCanvasElement } | null = null;

/** Get a horizontally flipped version of the bike sprite (cached).
 *  Mirrors around the bike's visual center, not the bitmap center.
 *  The sprite is centered on the left wheel. The bike center (suspension)
 *  is 0.85 world units to the right, which is 0.85/5.0 = 17% of the sprite width
 *  to the right of the bitmap center. */
function getFlippedBikeSprite(source: ImageBitmap): HTMLCanvasElement {
  if (flippedSpriteCache && flippedSpriteCache.source === source) {
    return flippedSpriteCache.flipped;
  }
  const w = source.width;
  const h = source.height;
  // Bike visual center in pixels: bitmap center + offset
  const bikeCenterPx = w / 2 + 0.85 * (w / BIKE_PREVIEW_SIZE);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const fCtx = canvas.getContext('2d')!;
  // Mirror around bikeCenterPx: translate(2*cx, 0) then scale(-1, 1)
  fCtx.translate(2 * bikeCenterPx, 0);
  fCtx.scale(-1, 1);
  fCtx.drawImage(source, 0, 0);
  flippedSpriteCache = { source, flipped: canvas };
  return canvas;
}

/** Draw an arrowhead at (tipX, tipY) pointing in direction (dx, dy). */
function drawArrowhead(ctx: CanvasRenderingContext2D, tipX: number, tipY: number, dx: number, dy: number, size: number): void {
  const px = -dy, py = dx; // perpendicular
  ctx.moveTo(tipX, tipY);
  ctx.lineTo(tipX - dx * size + px * size * 0.4, tipY - dy * size + py * size * 0.4);
  ctx.moveTo(tipX, tipY);
  ctx.lineTo(tipX - dx * size - px * size * 0.4, tipY - dy * size - py * size * 0.4);
}

/** Render the virtual debug start object on the editor canvas. */
export function renderDebugStart(
  ctx: CanvasRenderingContext2D,
  debugStart: DebugStartConfig,
): void {
  const { x, y } = debugStart.position;
  const angleRad = (debugStart.angle * Math.PI) / 180;
  const lgrAssets = getEditorLgr();

  // ── Bike sprite (rotated, flipped, grayscale) ──
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angleRad);
  ctx.globalAlpha = 0.7;
  ctx.filter = 'grayscale(100%)';

  if (lgrAssets?.bikeSprite) {
    const half = BIKE_PREVIEW_SIZE / 2;
    const sprite = debugStart.flipped
      ? getFlippedBikeSprite(lgrAssets.bikeSprite)
      : lgrAssets.bikeSprite;
    ctx.drawImage(sprite, -half, -half, BIKE_PREVIEW_SIZE, BIKE_PREVIEW_SIZE);
  } else {
    // Fallback: simple circle
    const r = OBJECT_RADIUS;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fillStyle = '#888';
    ctx.fill();
  }
  ctx.filter = 'none';
  ctx.globalAlpha = 1.0;
  ctx.restore();

  // ── Gravity arrow ──
  if (debugStart.gravityDirection !== 'down') {
    let gx = 0, gy = 0;
    switch (debugStart.gravityDirection) {
      case 'up':    gy = -1; break;
      case 'left':  gx = -1; break;
      case 'right': gx =  1; break;
    }
    const gLen = 0.6;
    const gStartX = x + gx * 0.2;
    const gStartY = y + gy * 0.2;
    const gTipX = gStartX + gx * gLen;
    const gTipY = gStartY + gy * gLen;

    ctx.beginPath();
    ctx.moveTo(gStartX, gStartY);
    ctx.lineTo(gTipX, gTipY);
    drawArrowhead(ctx, gTipX, gTipY, gx, gy, 0.15);
    ctx.strokeStyle = '#ff80ff';
    ctx.lineWidth = 0.05;
    ctx.stroke();
  }

  // ── Speed arrow (green, length proportional to speed) ──
  if (debugStart.speed > 0.01) {
    const sAngleRad = (debugStart.speedAngle * Math.PI) / 180;
    const sx = Math.cos(sAngleRad);
    const sy = Math.sin(sAngleRad);
    // Scale: 0.3 base + speed * 0.15, capped at 3.0
    const sLen = Math.min(0.3 + debugStart.speed * 0.15, 3.0);
    const sTipX = x + sx * sLen;
    const sTipY = y + sy * sLen;

    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(sTipX, sTipY);
    drawArrowhead(ctx, sTipX, sTipY, sx, sy, 0.18);
    ctx.strokeStyle = '#80e080';
    ctx.lineWidth = 0.05;
    ctx.stroke();
  }

}

/** Render the ghost trajectory trails (head + both wheels) on the editor canvas. */
export function renderGhostTrajectory(
  ctx: CanvasRenderingContext2D,
  trajectory: TrajectoryPoint[],
): void {
  if (trajectory.length < 2) return;

  const tracks: Array<{ getX: (p: TrajectoryPoint) => number; getY: (p: TrajectoryPoint) => number; color: string }> = [
    { getX: (p) => p.headX, getY: (p) => p.headY, color: 'rgba(255,100,100,0.4)' },
    { getX: (p) => p.lwX,   getY: (p) => p.lwY,   color: 'rgba(100,100,255,0.4)' },
    { getX: (p) => p.rwX,   getY: (p) => p.rwY,   color: 'rgba(100,255,100,0.4)' },
  ];

  ctx.lineWidth = 0.03;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  for (const track of tracks) {
    ctx.beginPath();
    const first = trajectory[0]!;
    ctx.moveTo(track.getX(first), track.getY(first));
    for (let i = 1; i < trajectory.length; i++) {
      const p = trajectory[i]!;
      ctx.lineTo(track.getX(p), track.getY(p));
    }
    ctx.strokeStyle = track.color;
    ctx.stroke();
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
