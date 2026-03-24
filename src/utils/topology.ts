import type { Polygon, ElmaObject, Picture } from 'elmajs';
import { ObjectType } from 'elmajs';
import type { Vec2, TopologyError } from '@/types';
import {
  MAX_POLYGONS,
  MAX_VERTICES,
  MAX_OBJECTS,
  MAX_SPRITES,
  LEVEL_MAX_SIZE,
} from '@/game/engine/core/Constants';

/** Check if two line segments intersect (excluding shared endpoints). */
export function segmentsIntersect(
  a1: Vec2,
  a2: Vec2,
  b1: Vec2,
  b2: Vec2,
): Vec2 | null {
  const d1x = a2.x - a1.x;
  const d1y = a2.y - a1.y;
  const d2x = b2.x - b1.x;
  const d2y = b2.y - b1.y;
  const cross = d1x * d2y - d1y * d2x;
  if (Math.abs(cross) < 1e-10) return null; // parallel

  const t = ((b1.x - a1.x) * d2y - (b1.y - a1.y) * d2x) / cross;
  const u = ((b1.x - a1.x) * d1y - (b1.y - a1.y) * d1x) / cross;

  const eps = 1e-8;
  if (t > eps && t < 1 - eps && u > eps && u < 1 - eps) {
    return { x: a1.x + t * d1x, y: a1.y + t * d1y };
  }
  return null;
}

/** Point-in-polygon test using ray casting. */
function isPointInPolygon(point: Vec2, vertices: Vec2[]): boolean {
  let inside = false;
  const n = vertices.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = vertices[i]!.x, yi = vertices[i]!.y;
    const xj = vertices[j]!.x, yj = vertices[j]!.y;
    if (
      ((yi > point.y) !== (yj > point.y)) &&
      (point.x < ((xj - xi) * (point.y - yi)) / (yj - yi) + xi)
    ) {
      inside = !inside;
    }
  }
  return inside;
}

/** Validate all topology rules. Returns an array of errors. */
export function validateTopology(
  polygons: Polygon[],
  objects: ElmaObject[],
  pictures?: Picture[],
): TopologyError[] {
  const errors: TopologyError[] = [];

  // ── Limit checks ──

  if (polygons.length > MAX_POLYGONS) {
    errors.push({
      type: 'too-many-polygons',
      message: `Too many polygons: ${polygons.length} (max ${MAX_POLYGONS})`,
    });
  }

  const totalVertices = polygons.reduce((sum, p) => sum + p.vertices.length, 0);
  if (totalVertices > MAX_VERTICES) {
    errors.push({
      type: 'too-many-vertices',
      message: `Too many vertices: ${totalVertices} (max ${MAX_VERTICES})`,
    });
  }

  if (objects.length > MAX_OBJECTS) {
    errors.push({
      type: 'too-many-objects',
      message: `Too many objects: ${objects.length} (max ${MAX_OBJECTS})`,
    });
  }

  if (pictures && pictures.length > MAX_SPRITES) {
    errors.push({
      type: 'too-many-sprites',
      message: `Too many pictures: ${pictures.length} (max ${MAX_SPRITES})`,
    });
  }

  // ── Level size check ──

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const poly of polygons) {
    for (const v of poly.vertices) {
      if (v.x < minX) minX = v.x;
      if (v.y < minY) minY = v.y;
      if (v.x > maxX) maxX = v.x;
      if (v.y > maxY) maxY = v.y;
    }
  }
  if (minX !== Infinity) {
    const width = maxX - minX;
    const height = maxY - minY;
    if (width > LEVEL_MAX_SIZE || height > LEVEL_MAX_SIZE) {
      errors.push({
        type: 'level-too-large',
        message: `Level too large: ${width.toFixed(1)} x ${height.toFixed(1)} (max ${LEVEL_MAX_SIZE} per axis)`,
      });
    }
  }

  // ── Edge intersection checks ──

  const groundPolys = polygons
    .map((p, i) => ({ polygon: p, index: i }))
    .filter(({ polygon }) => !polygon.grass);

  for (let i = 0; i < groundPolys.length; i++) {
    const polyA = groundPolys[i]!;
    const vertsA = polyA.polygon.vertices;

    for (let j = i; j < groundPolys.length; j++) {
      const polyB = groundPolys[j]!;
      const vertsB = polyB.polygon.vertices;

      for (let ei = 0; ei < vertsA.length; ei++) {
        const a1 = vertsA[ei]!;
        const a2 = vertsA[(ei + 1) % vertsA.length]!;
        // Skip adjacent edges when checking same polygon
        const startJ = i === j ? ei + 2 : 0;
        const endJ = i === j ? vertsB.length - (ei === 0 ? 1 : 0) : vertsB.length;

        for (let ej = startJ; ej < endJ; ej++) {
          const b1 = vertsB[ej]!;
          const b2 = vertsB[(ej + 1) % vertsB.length]!;
          const intersection = segmentsIntersect(a1, a2, b1, b2);
          if (intersection) {
            errors.push({
              type: 'edge-intersection',
              polygonIndices: [polyA.index, polyB.index],
              position: intersection,
              message: 'Ground polygon edges intersect',
            });
          }
        }
      }
    }
  }

  // ── Required objects ──

  const startCount = objects.filter((o) => o.type === ObjectType.Start).length;
  const hasFlower = objects.some((o) => o.type === ObjectType.Exit);

  if (startCount === 0) {
    errors.push({
      type: 'missing-start',
      message: 'Level requires exactly one Start object',
    });
  } else if (startCount > 1) {
    errors.push({
      type: 'multiple-starts',
      message: `Level has ${startCount} Start objects (exactly 1 required)`,
    });
  }

  if (!hasFlower) {
    errors.push({
      type: 'missing-flower',
      message: 'Level requires at least one Flower (Exit) object',
    });
  }

  return errors;
}
