import type { Polygon, ElmaObject, Picture } from 'elmajs';
import { OBJECT_RADIUS } from 'elmajs';
import type { Vec2, HitTestResult } from '@/types';
import { getEditorLgr } from '@/canvas/lgrCache';

export function distance(a: Vec2, b: Vec2): number {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
}

export function distanceToSegment(
  p: Vec2,
  a: Vec2,
  b: Vec2,
): { dist: number; t: number } {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return { dist: distance(p, a), t: 0 };
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const proj = { x: a.x + t * dx, y: a.y + t * dy };
  return { dist: distance(p, proj), t };
}

/** Check if a point is inside a polygon (ray-casting algorithm). */
export function pointInPolygon(p: Vec2, vertices: Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = vertices.length - 1; i < vertices.length; j = i++) {
    const vi = vertices[i]!;
    const vj = vertices[j]!;
    if (
      vi.y > p.y !== vj.y > p.y &&
      p.x < ((vj.x - vi.x) * (p.y - vi.y)) / (vj.y - vi.y) + vi.x
    ) {
      inside = !inside;
    }
  }
  return inside;
}

/** Visibility flags for hit-testing — hidden elements are skipped. */
export interface HitTestVisibility {
  showGrass?: boolean;
  showObjects?: boolean;
  showPictures?: boolean;
  showTextures?: boolean;
}

/**
 * Hit-test against all level geometry. Returns the nearest hit.
 * captureRadius is in world units (should be ~10px / zoom).
 */
export function hitTest(
  worldPos: Vec2,
  polygons: Polygon[],
  objects: ElmaObject[],
  captureRadius: number,
  pictures?: Picture[],
  visibility?: HitTestVisibility,
): HitTestResult {
  let best: HitTestResult = { kind: 'none' };
  let bestDist = captureRadius;

  const showGrass = visibility?.showGrass ?? true;
  const showObjects = visibility?.showObjects ?? true;
  const showPictures = visibility?.showPictures ?? true;
  const showTextures = visibility?.showTextures ?? true;

  // Check vertices first (highest priority)
  for (let pi = 0; pi < polygons.length; pi++) {
    if (!showGrass && polygons[pi]!.grass) continue;
    const verts = polygons[pi]!.vertices;
    for (let vi = 0; vi < verts.length; vi++) {
      const d = distance(worldPos, verts[vi]!);
      if (d < bestDist) {
        bestDist = d;
        best = {
          kind: 'vertex',
          polygonIndex: pi,
          vertexIndex: vi,
          position: verts[vi]!,
        };
      }
    }
  }

  // Check objects (only override vertex if closer)
  if (showObjects) {
    for (let oi = 0; oi < objects.length; oi++) {
      const d = distance(worldPos, objects[oi]!.position);
      // Objects are always hittable within their visual OBJECT_RADIUS, but a
      // closer vertex still takes priority (bestDist was already narrowed).
      if (d < Math.max(OBJECT_RADIUS, captureRadius) && (d < bestDist || best.kind === 'none')) {
        bestDist = d;
        best = {
          kind: 'object',
          objectIndex: oi,
          position: objects[oi]!.position,
        };
      }
    }
  }

  // Check pictures (bounding box test, position = top-left corner)
  if (pictures) {
    const lgrAssets = getEditorLgr();
    for (let pi = 0; pi < pictures.length; pi++) {
      const pic = pictures[pi]!;
      const isTextureMask = !!(pic.texture && pic.mask);
      if (isTextureMask && !showTextures) continue;
      if (!isTextureMask && !showPictures) continue;
      const picData = isTextureMask
        ? lgrAssets?.masks.get(pic.mask)
        : lgrAssets?.pictures.get(pic.name);
      const w = picData ? picData.worldW : 0.6;
      const h = picData ? picData.worldH : 0.6;
      const px = pic.position.x, py = pic.position.y;
      if (
        worldPos.x >= px && worldPos.x <= px + w &&
        worldPos.y >= py && worldPos.y <= py + h
      ) {
        const center = { x: px + w / 2, y: py + h / 2 };
        const d = distance(worldPos, center);
        if (d < bestDist || best.kind === 'none') {
          bestDist = d;
          best = { kind: 'picture', pictureIndex: pi, position: pic.position };
        }
      }
    }
  }

  // Check edges (only if no vertex or object found)
  if (best.kind === 'none') {
    for (let pi = 0; pi < polygons.length; pi++) {
      if (!showGrass && polygons[pi]!.grass) continue;
      const verts = polygons[pi]!.vertices;
      for (let ei = 0; ei < verts.length; ei++) {
        const next = (ei + 1) % verts.length;
        const { dist, t } = distanceToSegment(
          worldPos,
          verts[ei]!,
          verts[next]!,
        );
        if (dist < bestDist) {
          bestDist = dist;
          const pos = {
            x: verts[ei]!.x + t * (verts[next]!.x - verts[ei]!.x),
            y: verts[ei]!.y + t * (verts[next]!.y - verts[ei]!.y),
          };
          best = {
            kind: 'edge',
            polygonIndex: pi,
            edgeIndex: ei,
            position: pos,
            t,
          };
        }
      }
    }
  }

  // Check polygon interiors (lowest priority — click inside area to select)
  // When multiple polygons overlap, pick the one with the smallest bounding-box
  // area. This ensures nested/inner polygons are selected over their parents.
  if (best.kind === 'none') {
    let bestArea = Infinity;
    let bestPoly = -1;

    for (let pi = 0; pi < polygons.length; pi++) {
      const poly = polygons[pi]!;
      if (poly.grass || poly.vertices.length < 3) continue;
      if (pointInPolygon(worldPos, poly.vertices)) {
        const bbox = computeBBox(poly.vertices);
        const area = (bbox.maxX - bbox.minX) * (bbox.maxY - bbox.minY);
        if (area < bestArea) {
          bestArea = area;
          bestPoly = pi;
        }
      }
    }

    if (bestPoly !== -1) {
      best = {
        kind: 'polygon',
        polygonIndex: bestPoly,
        position: worldPos,
      };
    }
  }

  return best;
}

// ── Transform utilities ──────────────────────────────────────────────────────

/** Rotate a point around a center by the given angle (radians). */
export function rotatePoint(p: Vec2, center: Vec2, angle: number): Vec2 {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const dx = p.x - center.x;
  const dy = p.y - center.y;
  return {
    x: center.x + dx * cos - dy * sin,
    y: center.y + dx * sin + dy * cos,
  };
}

/** Scale a point relative to an anchor by (sx, sy). */
export function scalePoint(
  p: Vec2,
  anchor: Vec2,
  sx: number,
  sy: number,
): Vec2 {
  return {
    x: anchor.x + (p.x - anchor.x) * sx,
    y: anchor.y + (p.y - anchor.y) * sy,
  };
}

/** Signed angle difference between vectors (center→a) and (center→b). */
export function angleBetween(a: Vec2, b: Vec2, center: Vec2): number {
  const a1 = Math.atan2(a.y - center.y, a.x - center.x);
  const a2 = Math.atan2(b.y - center.y, b.x - center.x);
  return a2 - a1;
}

// ── Signed area ─────────────────────────────────────────────────────────────

/** Signed area of a polygon (shoelace formula). Positive = CW in Y-down coords. */
export function computeSignedArea(vertices: Vec2[]): number {
  let area = 0;
  for (let i = 0; i < vertices.length; i++) {
    const j = (i + 1) % vertices.length;
    area += vertices[i]!.x * vertices[j]!.y;
    area -= vertices[j]!.x * vertices[i]!.y;
  }
  return area / 2;
}

// ── Bounding box ─────────────────────────────────────────────────────────────

/** Compute axis-aligned bounding box of a set of points. */
export function computeBBox(points: Vec2[]): {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
} {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY };
}
