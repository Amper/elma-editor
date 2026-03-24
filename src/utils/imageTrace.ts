import type { Vec2 } from '@/types';

// ── Types ────────────────────────────────────────────────────────────────────

export interface TraceConfig {
  /** Brightness threshold 0-255 for binary conversion. */
  threshold: number;
  /** Ramer-Douglas-Peucker tolerance in pixels. */
  simplifyTolerance: number;
  /** World units per pixel. */
  scale: number;
  /** Trace white regions instead of black. */
  invert: boolean;
}

export const DEFAULT_TRACE_CONFIG: TraceConfig = {
  threshold: 128,
  simplifyTolerance: 2.0,
  scale: 0.1,
  invert: false,
};

export interface TraceResult {
  polygons: Vec2[][];
  sourceWidth: number;
  sourceHeight: number;
}

// ── Image loading ────────────────────────────────────────────────────────────

const MAX_DIM = 1024;

export function loadImageToBitmap(file: File): Promise<ImageData> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      let w = img.width;
      let h = img.height;

      // Down-scale large images for performance
      if (w > MAX_DIM || h > MAX_DIM) {
        const ratio = Math.min(MAX_DIM / w, MAX_DIM / h);
        w = Math.round(w * ratio);
        h = Math.round(h * ratio);
      }

      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(img.src);
      resolve(ctx.getImageData(0, 0, w, h));
    };
    img.onerror = () => {
      URL.revokeObjectURL(img.src);
      reject(new Error('Failed to load image'));
    };
    img.src = URL.createObjectURL(file);
  });
}

// ── Binarization ─────────────────────────────────────────────────────────────

export function toBinaryBitmap(
  imageData: ImageData,
  threshold: number,
  invert: boolean,
): Uint8Array {
  const { data, width, height } = imageData;
  const bitmap = new Uint8Array(width * height);
  for (let i = 0; i < width * height; i++) {
    const r = data[i * 4]!;
    const g = data[i * 4 + 1]!;
    const b = data[i * 4 + 2]!;
    const a = data[i * 4 + 3]!;
    if (a < 128) {
      bitmap[i] = invert ? 1 : 0;
      continue;
    }
    const gray = 0.299 * r + 0.587 * g + 0.114 * b;
    const isFg = invert ? gray >= threshold : gray < threshold;
    bitmap[i] = isFg ? 1 : 0;
  }
  return bitmap;
}

// ── Contour tracing (Moore neighbor) ─────────────────────────────────────────

// 8-connected neighbor offsets (clockwise from right)
// 0=right, 1=down-right, 2=down, 3=down-left, 4=left, 5=up-left, 6=up, 7=up-right
const DX = [1, 1, 0, -1, -1, -1, 0, 1];
const DY = [0, 1, 1, 1, 0, -1, -1, -1];

function mooreTrace(
  bitmap: Uint8Array,
  width: number,
  height: number,
  startX: number,
  startY: number,
  visited: Uint8Array,
): Vec2[] {
  const points: Vec2[] = [];
  let cx = startX;
  let cy = startY;
  // Entry direction: we came from the left (dir=4 means "came from left")
  let dir = 4;

  const maxIter = width * height * 2; // safety limit
  let iter = 0;

  do {
    points.push({ x: cx, y: cy });
    visited[cy * width + cx] = 1;

    // Search clockwise starting one step past the backtrack direction
    const searchStart = (dir + 1) % 8;
    let found = false;

    for (let i = 0; i < 8; i++) {
      const d = (searchStart + i) % 8;
      const nx = cx + DX[d]!;
      const ny = cy + DY[d]!;
      if (
        nx >= 0 &&
        nx < width &&
        ny >= 0 &&
        ny < height &&
        bitmap[ny * width + nx] === 1
      ) {
        dir = (d + 4) % 8; // direction we came FROM is opposite
        cx = nx;
        cy = ny;
        found = true;
        break;
      }
    }

    if (!found) break; // isolated pixel
    if (++iter > maxIter) break;
  } while (cx !== startX || cy !== startY);

  return points;
}

export function traceContours(
  bitmap: Uint8Array,
  width: number,
  height: number,
): Vec2[][] {
  // Pad bitmap with 1px border of 0s to ensure all contours are closed
  const pw = width + 2;
  const ph = height + 2;
  const padded = new Uint8Array(pw * ph);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      padded[(y + 1) * pw + (x + 1)] = bitmap[y * width + x]!;
    }
  }

  const visited = new Uint8Array(pw * ph);
  const contours: Vec2[][] = [];

  for (let y = 1; y < ph - 1; y++) {
    for (let x = 1; x < pw - 1; x++) {
      const idx = y * pw + x;
      // Outer contour: background → foreground transition
      if (padded[idx] === 1 && padded[idx - 1] === 0 && !visited[idx]) {
        const raw = mooreTrace(padded, pw, ph, x, y, visited);
        if (raw.length >= 3) {
          // Convert from padded coords back to original
          contours.push(raw.map((p) => ({ x: p.x - 1, y: p.y - 1 })));
        }
      }
    }
  }

  return contours;
}

// ── Polygon simplification (Ramer-Douglas-Peucker) ───────────────────────────

function perpendicularDistance(
  point: Vec2,
  lineStart: Vec2,
  lineEnd: Vec2,
): number {
  const dx = lineEnd.x - lineStart.x;
  const dy = lineEnd.y - lineStart.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0)
    return Math.hypot(point.x - lineStart.x, point.y - lineStart.y);
  const t =
    ((point.x - lineStart.x) * dx + (point.y - lineStart.y) * dy) / lenSq;
  const projX = lineStart.x + t * dx;
  const projY = lineStart.y + t * dy;
  return Math.hypot(point.x - projX, point.y - projY);
}

function rdpSimplify(points: Vec2[], tolerance: number): Vec2[] {
  if (points.length <= 2) return points;

  const first = points[0]!;
  const last = points[points.length - 1]!;

  let maxDist = 0;
  let maxIdx = 0;
  for (let i = 1; i < points.length - 1; i++) {
    const d = perpendicularDistance(points[i]!, first, last);
    if (d > maxDist) {
      maxDist = d;
      maxIdx = i;
    }
  }

  if (maxDist > tolerance) {
    const left = rdpSimplify(points.slice(0, maxIdx + 1), tolerance);
    const right = rdpSimplify(points.slice(maxIdx), tolerance);
    return left.slice(0, -1).concat(right);
  }

  return [first, last];
}

export function simplifyPolygon(points: Vec2[], tolerance: number): Vec2[] {
  if (points.length <= 3) return points;

  // For closed contours: split at the point farthest from the first point,
  // simplify each half, then merge
  const n = points.length;
  let maxDist = 0;
  let splitIdx = 0;
  for (let i = 1; i < n; i++) {
    const d = Math.hypot(
      points[i]!.x - points[0]!.x,
      points[i]!.y - points[0]!.y,
    );
    if (d > maxDist) {
      maxDist = d;
      splitIdx = i;
    }
  }

  const half1 = points.slice(0, splitIdx + 1);
  const half2 = points.slice(splitIdx).concat([points[0]!]);

  const simplified1 = rdpSimplify(half1, tolerance);
  const simplified2 = rdpSimplify(half2, tolerance);

  return simplified1.concat(simplified2.slice(1, -1));
}

// ── Normalization & winding ──────────────────────────────────────────────────

function signedArea(vertices: Vec2[]): number {
  let area = 0;
  for (let i = 0; i < vertices.length; i++) {
    const j = (i + 1) % vertices.length;
    area += vertices[i]!.x * vertices[j]!.y;
    area -= vertices[j]!.x * vertices[i]!.y;
  }
  return area / 2;
}

export function normalizeContours(
  contours: Vec2[][],
  config: TraceConfig,
): Vec2[][] {
  const results: Vec2[][] = [];

  for (const contour of contours) {
    const simplified = simplifyPolygon(contour, config.simplifyTolerance);
    if (simplified.length < 3) continue;

    // Scale to world units
    const scaled = simplified.map((p) => ({
      x: p.x * config.scale,
      y: p.y * config.scale,
    }));

    results.push(scaled);
  }

  if (results.length === 0) return [];

  // Compute bounding box of ALL polygons for centering
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const poly of results) {
    for (const p of poly) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
  }
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;

  // Center at origin and ensure clockwise winding (Elma ground polygons)
  return results.map((poly) => {
    const centered = poly.map((p) => ({ x: p.x - cx, y: p.y - cy }));
    // Signed area > 0 means CCW in screen coords → reverse to make CW
    if (signedArea(centered) > 0) centered.reverse();
    return centered;
  });
}

// ── Top-level pipeline ───────────────────────────────────────────────────────

export async function traceImage(
  file: File,
  config: TraceConfig,
): Promise<TraceResult> {
  const imageData = await loadImageToBitmap(file);
  const binary = toBinaryBitmap(imageData, config.threshold, config.invert);
  const contours = traceContours(binary, imageData.width, imageData.height);
  const polygons = normalizeContours(contours, config);
  return {
    polygons,
    sourceWidth: imageData.width,
    sourceHeight: imageData.height,
  };
}
