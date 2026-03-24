import type { Vec2 } from '@/types';

// ── Types ────────────────────────────────────────────────────────────────────

export interface AutoGrassConfig {
  /** Perpendicular thickness of the grass strip in world units. */
  thickness: number;
  /** Maximum edge slope (degrees from horizontal) for grass. */
  maxAngle: number;
}

export const DEFAULT_AUTO_GRASS_CONFIG: AutoGrassConfig = {
  thickness: 0.8,
  maxAngle: 60,
};

// ── Algorithm ────────────────────────────────────────────────────────────────

/**
 * Generate grass polygon strips for a ground polygon.
 *
 * Ground polygons are CW in the editor's Y-down coords and define
 * the air space. Grass polygons must overlap with the air space, so
 * we offset inward using the normal (-dy, dx). Grassable edges are
 * floor-facing (dx < 0, going right-to-left) with slope <= maxAngle.
 *
 * Returns arrays of vertices for each grass polygon strip.
 */
export function autoGrassPolygon(
  vertices: Vec2[],
  config: AutoGrassConfig,
): Vec2[][] {
  const n = vertices.length;
  if (n < 3) return [];

  const maxAngleRad = (config.maxAngle * Math.PI) / 180;

  // 1. Classify each edge as grassable or not.
  // In the editor (Y-down), the visual floor is at the bottom of the polygon.
  // Floor-facing edges go right-to-left (dx < 0) — their inward normal
  // (-dy, dx) points upward on screen, into the air space.
  const grassable: boolean[] = [];
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const dx = vertices[j]!.x - vertices[i]!.x;
    const dy = vertices[j]!.y - vertices[i]!.y;

    // dx < 0 means this edge faces the visual floor (bottom of polygon)
    if (dx >= 0) {
      grassable.push(false);
      continue;
    }

    // Slope angle from horizontal, direction-independent
    const slopeAngle = Math.atan2(Math.abs(dy), Math.abs(dx));
    grassable.push(slopeAngle <= maxAngleRad);
  }

  // 2. Find runs of consecutive grassable edges
  const runs = findGrassableRuns(grassable, n);
  if (runs.length === 0) return [];

  // 3. For each run, build a grass polygon strip
  const result: Vec2[][] = [];
  for (const run of runs) {
    const strip = buildGrassStrip(vertices, run.start, run.count, config.thickness, n);
    if (strip && strip.length >= 3) {
      result.push(strip);
    }
  }

  return result;
}

// ── Run detection ────────────────────────────────────────────────────────────

interface EdgeRun {
  start: number; // Index of the first grassable edge
  count: number; // Number of consecutive grassable edges
}

function findGrassableRuns(grassable: boolean[], n: number): EdgeRun[] {
  // Find first non-grassable edge to break the cycle
  let firstNonGrassable = -1;
  for (let i = 0; i < n; i++) {
    if (!grassable[i]) {
      firstNonGrassable = i;
      break;
    }
  }

  if (firstNonGrassable === -1) {
    // ALL edges are grassable — one run covering everything
    return [{ start: 0, count: n }];
  }

  const runs: EdgeRun[] = [];
  let visited = 0;

  while (visited < n) {
    const idx = (firstNonGrassable + visited) % n;
    if (grassable[idx]) {
      const start = idx;
      let count = 0;
      while (visited < n && grassable[(firstNonGrassable + visited) % n]) {
        count++;
        visited++;
      }
      runs.push({ start, count });
    } else {
      visited++;
    }
  }

  return runs;
}

// ── Strip construction ──────────────────────────────────────────────────────

function buildGrassStrip(
  vertices: Vec2[],
  startEdge: number,
  edgeCount: number,
  thickness: number,
  n: number,
): Vec2[] | null {
  // The run covers edges [startEdge .. startEdge+edgeCount-1].
  // Vertices involved: startEdge, startEdge+1, ..., startEdge+edgeCount
  // (all modulo n for the closed polygon).
  //
  // The grass strip is centered on the ground edge: half extends inward
  // (into air space) and half extends outward (into ground).

  const halfThickness = thickness / 2;
  const innerVerts: Vec2[] = []; // offset inward (into air space)
  const outerVerts: Vec2[] = []; // offset outward (into ground)

  const vertexCount = edgeCount + (edgeCount < n ? 1 : 0);

  for (let k = 0; k < vertexCount; k++) {
    const vIdx = (startEdge + k) % n;

    // Inner offset (into air space) — positive thickness
    const innerPos = computeOffsetVertex(vertices, vIdx, k, edgeCount, halfThickness, n);
    if (!innerPos) return null;
    innerVerts.push(innerPos);

    // Outer offset (into ground) — negative thickness
    const outerPos = computeOffsetVertex(vertices, vIdx, k, edgeCount, -halfThickness, n);
    if (!outerPos) return null;
    outerVerts.push(outerPos);
  }

  if (innerVerts.length < 2 || outerVerts.length < 2) return null;

  if (edgeCount >= n) {
    // All edges grassable — return just the inner offset polygon (closed ring)
    return innerVerts;
  }

  // Taper the endpoints: inset both ends along the edge tangent.
  // The outer (ground) side is inset more than the inner (air) side,
  // making the bottom of the grass narrower than the top.
  const innerInset = thickness * 0.3;
  const outerInset = thickness * 0.8;

  // Taper at the start of the run
  {
    const a = vertices[startEdge % n]!;
    const b = vertices[(startEdge + 1) % n]!;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len > 1e-10) {
      const tx = dx / len;
      const ty = dy / len;
      const maxInset = len * 0.4;
      const iIn = Math.min(innerInset, maxInset);
      const oIn = Math.min(outerInset, maxInset);
      innerVerts[0] = { x: innerVerts[0]!.x + tx * iIn, y: innerVerts[0]!.y + ty * iIn };
      outerVerts[0] = { x: outerVerts[0]!.x + tx * oIn, y: outerVerts[0]!.y + ty * oIn };
    }
  }

  // Taper at the end of the run
  {
    const lastEdgeIdx = (startEdge + edgeCount - 1) % n;
    const a = vertices[lastEdgeIdx]!;
    const b = vertices[(lastEdgeIdx + 1) % n]!;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len > 1e-10) {
      const tx = dx / len;
      const ty = dy / len;
      const maxInset = len * 0.4;
      const iIn = Math.min(innerInset, maxInset);
      const oIn = Math.min(outerInset, maxInset);
      const last = innerVerts.length - 1;
      innerVerts[last] = { x: innerVerts[last]!.x - tx * iIn, y: innerVerts[last]!.y - ty * iIn };
      outerVerts[last] = { x: outerVerts[last]!.x - tx * oIn, y: outerVerts[last]!.y - ty * oIn };
    }
  }

  // Grass polygon = outer vertices forward + inner vertices reversed
  return [...outerVerts, ...innerVerts.reverse()];
}

function computeOffsetVertex(
  vertices: Vec2[],
  vIdx: number,
  posInRun: number,
  edgeCount: number,
  thickness: number,
  n: number,
): Vec2 | null {
  const v = vertices[vIdx]!;

  if (edgeCount >= n) {
    // All-grassable: every vertex is an interior vertex with miter
    const prevIdx = (vIdx - 1 + n) % n;
    const nextIdx = (vIdx + 1) % n;
    return miterOffset(v, vertices[prevIdx]!, vertices[nextIdx]!, thickness);
  }

  if (posInRun === 0) {
    // First vertex of the run — use normal of the first edge only
    const nextIdx = (vIdx + 1) % n;
    return simpleOffset(v, vertices[vIdx]!, vertices[nextIdx]!, thickness);
  }

  if (posInRun === edgeCount) {
    // Last vertex of the run — use normal of the last edge only
    const prevIdx = (vIdx - 1 + n) % n;
    return simpleOffset(v, vertices[prevIdx]!, vertices[vIdx]!, thickness);
  }

  // Interior vertex — use miter join between incoming and outgoing edges
  const prevIdx = (vIdx - 1 + n) % n;
  const nextIdx = (vIdx + 1) % n;
  return miterOffset(v, vertices[prevIdx]!, vertices[nextIdx]!, thickness);
}

/** Offset along the inward normal (into air space) of a single edge. */
function simpleOffset(vertex: Vec2, edgeStart: Vec2, edgeEnd: Vec2, thickness: number): Vec2 {
  const dx = edgeEnd.x - edgeStart.x;
  const dy = edgeEnd.y - edgeStart.y;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len < 1e-10) return { x: vertex.x, y: vertex.y };

  // Inward normal (into air space) for CW polygon: (-dy, dx)
  return {
    x: vertex.x + (-dy / len) * thickness,
    y: vertex.y + (dx / len) * thickness,
  };
}

/** Miter join: offset along the bisector of two edges' inward normals. */
function miterOffset(vertex: Vec2, prev: Vec2, next: Vec2, thickness: number): Vec2 {
  // Incoming edge (prev → vertex)
  const dx1 = vertex.x - prev.x;
  const dy1 = vertex.y - prev.y;
  const len1 = Math.sqrt(dx1 * dx1 + dy1 * dy1);

  // Outgoing edge (vertex → next)
  const dx2 = next.x - vertex.x;
  const dy2 = next.y - vertex.y;
  const len2 = Math.sqrt(dx2 * dx2 + dy2 * dy2);

  if (len1 < 1e-10 || len2 < 1e-10) {
    // Degenerate — fall back to simple offset of whichever edge is valid
    if (len2 >= 1e-10) return simpleOffset(vertex, vertex, next, thickness);
    if (len1 >= 1e-10) return simpleOffset(vertex, prev, vertex, thickness);
    return { x: vertex.x, y: vertex.y };
  }

  // Inward normals (-dy, dx) normalized — points into the air space
  const n1x = -dy1 / len1;
  const n1y = dx1 / len1;
  const n2x = -dy2 / len2;
  const n2y = dx2 / len2;

  // Bisector of the two normals
  const bx = n1x + n2x;
  const by = n1y + n2y;
  const bLen = Math.sqrt(bx * bx + by * by);

  if (bLen < 1e-6) {
    // Normals point in opposite directions (U-turn) — use edge 2 normal
    return {
      x: vertex.x + n2x * thickness,
      y: vertex.y + n2y * thickness,
    };
  }

  const bisectorX = bx / bLen;
  const bisectorY = by / bLen;
  const dot = bisectorX * n1x + bisectorY * n1y;

  // Miter length, capped to prevent extreme spikes at sharp corners
  let miterLen = thickness / Math.max(dot, 0.15);
  const maxMiter = Math.abs(thickness) * 4;
  if (Math.abs(miterLen) > maxMiter) {
    miterLen = Math.sign(miterLen) * maxMiter;
  }

  return {
    x: vertex.x + bisectorX * miterLen,
    y: vertex.y + bisectorY * miterLen,
  };
}
