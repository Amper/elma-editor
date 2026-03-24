/**
 * Pre-renders the bike at rest pose onto an OffscreenCanvas.
 * Ports the essential math from BikeRenderer (KIRAJ320.CPP) to Canvas 2D.
 *
 * The resulting bitmap is positioned relative to the LEFT WHEEL,
 * since the start object marks the left wheel spawn point.
 */
import type { BikePartSet } from '@/game/engine/formats/LgrFormat';
import type { DecodedImage } from '@/game/engine/formats/PcxDecoder';

// ── Constants from BikeRenderer / Constants.ts ──
const Mx = 390;
const My = 420;
const malfa = 0.62;
const mmeret = 0.0045;
const WHEEL_RENDER_RADIUS = 0.395;
const HEAD_RADIUS = 0.238;

const BODY_BOXES: [number, number, number, number][] = [
  [3, 36, 147, 184],
  [32, 183, 147, 297],
  [146, 141, 273, 264],
  [272, 181, 353, 244],
];

// Relative offsets from bike center (Y-up physics coords)
const LEFT_WHEEL_DX = -0.85;
const LEFT_WHEEL_DY = -0.6;
const RIGHT_WHEEL_DX = 0.85;
const RIGHT_WHEEL_DY = -0.6;
const BODY_DY = 0.44;

// ── Minimal vector math ──
interface V { x: number; y: number }
const v = (x: number, y: number): V => ({ x, y });
const vadd = (a: V, b: V): V => ({ x: a.x + b.x, y: a.y + b.y });
const vsub = (a: V, b: V): V => ({ x: a.x - b.x, y: a.y - b.y });
const vscale = (a: V, s: number): V => ({ x: a.x * s, y: a.y * s });
const vlen = (a: V): number => Math.sqrt(a.x * a.x + a.y * a.y);
const rot90 = (a: V): V => ({ x: -a.y, y: a.x });
const rotM90 = (a: V): V => ({ x: a.y, y: -a.x });

function circlesIntersect(r1: V, r2: V, l1: number, l2: number): V {
  const d = vsub(r2, r1);
  let l = vlen(d);
  if (l >= l1 + l2) l = l1 + l2 - 1e-6;
  if (l1 >= l + l2) l1 = l + l2 - 1e-5;
  if (l2 >= l + l1) l2 = l + l1 - 1e-5;
  const u = vscale(d, 1 / l);
  const n = rot90(u);
  const x = (l1 * l1 - l2 * l2 + l * l) / (2 * l);
  const m = Math.sqrt(Math.max(0, l1 * l1 - x * x));
  return vadd(r1, vadd(vscale(u, x), vscale(n, m)));
}

/** World-space extent of the pre-rendered bike bitmap (meters). */
export const BIKE_PREVIEW_SIZE = 5.0;

/**
 * Pre-renders the bike at rest pose and returns an ImageBitmap.
 * The bitmap is centered on the LEFT WHEEL position (= start object).
 */
export async function preRenderBikePreview(
  bikeParts: BikePartSet,
  palette: Uint8Array,
): Promise<ImageBitmap> {
  const RENDER_SCALE = 64; // px per world unit
  const CANVAS_PX = Math.round(BIKE_PREVIEW_SIZE * RENDER_SCALE);
  // Center of canvas = left wheel position
  const CX = CANVAS_PX / 2;
  const CY = CANVAS_PX / 2;

  const canvas = new OffscreenCanvas(CANVAS_PX, CANVAS_PX);
  const ctx = canvas.getContext('2d')!;

  // Convert all bike parts to ImageBitmaps
  async function toBitmap(img: DecodedImage): Promise<ImageBitmap> {
    const data = new ImageData(
      new Uint8ClampedArray(img.rgba.buffer, img.rgba.byteOffset, img.rgba.byteLength),
      img.width,
      img.height,
    );
    return createImageBitmap(data);
  }

  const bitmaps = {
    body: await Promise.all(bikeParts.body.map(toBitmap)),
    wheel: await toBitmap(bikeParts.wheel),
    susp1: await toBitmap(bikeParts.susp1),
    susp2: await toBitmap(bikeParts.susp2),
    head: await toBitmap(bikeParts.head),
    thigh: await toBitmap(bikeParts.thigh),
    leg: await toBitmap(bikeParts.leg),
    forearm: await toBitmap(bikeParts.forearm),
    upperArm: await toBitmap(bikeParts.upperArm),
    torso: await toBitmap(bikeParts.torso),
  };

  // ── Rest pose in Y-up physics coords, relative to LEFT WHEEL at (0,0) ──
  const bikeCenter = v(-LEFT_WHEEL_DX, -LEFT_WHEEL_DY); // (0.85, 0.6)
  const leftWheelR = v(0, 0);
  const rightWheelR = v(RIGHT_WHEEL_DX - LEFT_WHEEL_DX, RIGHT_WHEEL_DY - LEFT_WHEEL_DY); // (1.7, 0)
  const bodyR = v(bikeCenter.x, bikeCenter.y + BODY_DY); // (0.85, 1.04)
  const headR = v(bikeCenter.x - 0.09, bikeCenter.y + BODY_DY + 0.63); // (0.76, 1.67)

  // Coordinate basis at rotation=0
  const jobbra = v(1, 0);
  const fel = rot90(jobbra); // (0, 1)
  const Mi = vadd(vscale(jobbra, mmeret * Math.cos(malfa)), vscale(fel, mmeret * Math.sin(malfa)));
  const Mj = rot90(Mi);
  const Mr = bikeCenter;

  // ── Canvas 2D sprite drawing (maps Y-up world → Y-down canvas) ──
  // The game's WebGL shader has a built-in V-flip (image V coordinate is inverted).
  // To match, we shift origin by extentV and negate extentV, so the image is
  // drawn from the opposite V corner — equivalent to the shader's V-flip.
  function drawSprite(bmp: ImageBitmap, origin: V, extentU: V, extentV: V) {
    const w = bmp.width;
    const h = bmp.height;
    const s = RENDER_SCALE;
    // V-flip: shift origin to (origin + extentV), negate extentV
    const o = vadd(origin, extentV);
    const fv: V = { x: -extentV.x, y: -extentV.y };
    ctx.setTransform(
      (extentU.x / w) * s,
      (-extentU.y / w) * s,
      (fv.x / h) * s,
      (-fv.y / h) * s,
      o.x * s + CX,
      -o.y * s + CY,
    );
    ctx.drawImage(bmp, 0, 0);
  }

  function drawBox(
    a: V, b: V, halfWidth: number, bmp: ImageBitmap,
    overA: number, overB: number, mirror: boolean,
  ) {
    const dir = vsub(b, a);
    const len = vlen(dir);
    if (len < 0.001) return;
    const ud = vscale(dir, 1 / len);
    const aExt = vsub(a, vscale(ud, overA));
    const bExt = vadd(b, vscale(ud, overB));
    const vLength = vsub(bExt, aExt);
    const v2fel = vscale(mirror ? rot90(ud) : rotM90(ud), halfWidth);
    const origin = vadd(aExt, v2fel);
    const extentU = vLength;
    const extentV = vscale(v2fel, -2);
    drawSprite(bmp, origin, extentU, extentV);
  }

  function drawRotatedSquare(center: V, radius: number, rotation: number, bmp: ImageBitmap, mirror: boolean) {
    const vfel = v(Math.cos(rotation) * radius, Math.sin(rotation) * radius);
    if (mirror) {
      drawBox(vadd(center, vfel), vsub(center, vfel), radius, bmp, 0, 0, true);
    } else {
      drawBox(vsub(center, vfel), vadd(center, vfel), radius, bmp, 0, 0, false);
    }
  }

  function drawBodyPart(box: number[], bmp: ImageBitmap) {
    const [x1, y1, x2, y2] = box as [number, number, number, number];
    const origin = vadd(vadd(vscale(Mi, x1 + 260 - Mx), vscale(Mj, My - 260 - y2)), Mr);
    const extentU = vscale(Mi, x2 - x1);
    const extentV = vscale(Mj, y2 - y1);
    drawSprite(bmp, origin, extentU, extentV);
  }

  // ── Draw bike parts (matching BikeRenderer.drawBikeParts at rest) ──
  ctx.clearRect(0, 0, CANVAS_PX, CANVAS_PX);

  // 1-2. Wheels (background layer)
  drawRotatedSquare(rightWheelR, WHEEL_RENDER_RADIUS, 0, bitmaps.wheel, false);
  drawRotatedSquare(leftWheelR, WHEEL_RENDER_RADIUS, 0, bitmaps.wheel, false);

  // 3. Front suspension: left wheel to handlebar
  const handlebarPoint = vadd(vadd(vscale(Mi, 365 - Mx), vscale(Mj, My - 292)), Mr);
  drawBox(leftWheelR, handlebarPoint, 0.06, bitmaps.susp1, 0.05, 0.03, false);

  // 4. Rear suspension: rear pivot to right wheel
  const rearPivot = vadd(vadd(vscale(Mi, 370 - Mx), vscale(Mj, My - 520)), Mr);
  drawBox(rearPivot, rightWheelR, 0.06, bitmaps.susp2, 0.0, 0.1, false);

  // 5. Body parts (4 pieces)
  for (let i = 0; i < 4; i++) {
    drawBodyPart(BODY_BOXES[i]!, bitmaps.body[i]!);
  }

  // 6. Rider joint positions
  const hipPos = vadd(bodyR, vadd(vscale(Mi, 75), vscale(Mj, -47)));
  const shoulderPos = vadd(bodyR, vadd(vscale(Mi, 47), vscale(Mj, 65)));
  const shoulderTorso = vadd(bodyR, vadd(vscale(Mi, 41), vscale(Mj, 70)));
  const footPos = vadd(vadd(vscale(Mi, 346 - Mx), vscale(Mj, My - 514)), Mr);
  const handPos = handlebarPoint;

  const knee = circlesIntersect(footPos, hipPos, 0.51, 0.51);
  const elbow = circlesIntersect(shoulderPos, handPos, 0.328 * 1.05, 0.308 * 1.05);

  // 7. Head
  drawRotatedSquare(headR, HEAD_RADIUS, 0, bitmaps.head, false);

  // 8. Thigh: knee to hip
  drawBox(knee, hipPos, 0.14, bitmaps.thigh, 0.03, 0.1, false);

  // 9. Leg: foot to knee
  drawBox(footPos, knee, 0.21, bitmaps.leg, 0.03, 0.03, false);

  // 10. Torso: hip to shoulder
  drawBox(hipPos, shoulderTorso, 0.2, bitmaps.torso, 0.1, 0.05, false);

  // 11. Upper arm: elbow to shoulder
  drawBox(elbow, shoulderPos, 0.11, bitmaps.upperArm, 0.08, 0.1, true);

  // 12. Forearm: hand to elbow
  drawBox(handPos, elbow, 0.076, bitmaps.forearm, 0.08, 0.1, false);

  // 13-14. Wheels (front layer)
  drawRotatedSquare(rightWheelR, WHEEL_RENDER_RADIUS, 0, bitmaps.wheel, false);
  drawRotatedSquare(leftWheelR, WHEEL_RENDER_RADIUS, 0, bitmaps.wheel, false);

  // Reset transform
  ctx.setTransform(1, 0, 0, 1, 0, 0);

  return createImageBitmap(canvas);
}
