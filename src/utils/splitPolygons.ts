import { Polygon, Position } from 'elmajs';
import polygonClipping from 'polygon-clipping';
import { elmaToClip, clipToElma } from './mergePolygons';
import { segmentsIntersect } from './topology';
import type { Vec2 } from '@/types';

/**
 * Split a single self-intersecting polygon into separate closed loops
 * at ALL self-intersection points simultaneously.
 *
 * Uses a graph-based approach:
 * 1. Find all self-intersections
 * 2. Subdivide edges by inserting intersection points
 * 3. Swap "next" pointers at each crossing to uncross the polygon
 * 4. Trace separate loops through the resulting graph
 */
export function selfSplitPolygon(poly: Polygon): Polygon[] | null {
  const verts: Vec2[] = poly.vertices.map((v) => ({ x: v.x, y: v.y }));
  const loops = splitAtAllIntersections(verts);
  if (loops.length <= 1) return null;

  const result: Polygon[] = [];
  for (const loop of loops) {
    if (loop.length < 3) continue;
    const p = new Polygon();
    p.grass = poly.grass;
    p.vertices = loop.map((v) => new Position(v.x, v.y));
    result.push(p);
  }

  return result.length > 1 ? result : null;
}

/** Compute parameter t of point P along segment A→B. */
function paramOnEdge(a: Vec2, b: Vec2, p: Vec2): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  return Math.abs(dx) > Math.abs(dy) ? (p.x - a.x) / dx : (p.y - a.y) / dy;
}

/**
 * Find all self-intersections, subdivide edges, swap crossings,
 * and trace individual loops.
 */
function splitAtAllIntersections(verts: Vec2[]): Vec2[][] {
  const n = verts.length;
  if (n < 3) return [verts];

  // Step 1: Find ALL self-intersections
  interface IX { edgeI: number; edgeJ: number; point: Vec2 }
  const allIX: IX[] = [];

  for (let i = 0; i < n; i++) {
    const a1 = verts[i]!;
    const a2 = verts[(i + 1) % n]!;
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue;
      const b1 = verts[j]!;
      const b2 = verts[(j + 1) % n]!;
      const pt = segmentsIntersect(a1, a2, b1, b2);
      if (pt) allIX.push({ edgeI: i, edgeJ: j, point: pt });
    }
  }

  if (allIX.length === 0) return [verts];

  // Step 2: Group intersection points per edge, sorted by t
  const edgeIns = new Map<number, Array<{ t: number; pt: Vec2; ixId: number }>>();
  for (let id = 0; id < allIX.length; id++) {
    const ix = allIX[id]!;
    for (const edge of [ix.edgeI, ix.edgeJ]) {
      if (!edgeIns.has(edge)) edgeIns.set(edge, []);
      const a = verts[edge]!;
      const b = verts[(edge + 1) % n]!;
      edgeIns.get(edge)!.push({ t: paramOnEdge(a, b, ix.point), pt: ix.point, ixId: id });
    }
  }
  for (const ins of edgeIns.values()) ins.sort((a, b) => a.t - b.t);

  // Step 3: Build subdivided node list
  const nodes: Vec2[] = [];
  const ixPairs = new Map<number, number[]>(); // ixId → [nodeIdx, nodeIdx]

  for (let edge = 0; edge < n; edge++) {
    nodes.push(verts[edge]!);
    const ins = edgeIns.get(edge);
    if (ins) {
      for (const entry of ins) {
        const nodeIdx = nodes.length;
        nodes.push(entry.pt);
        if (!ixPairs.has(entry.ixId)) ixPairs.set(entry.ixId, []);
        ixPairs.get(entry.ixId)!.push(nodeIdx);
      }
    }
  }

  // Step 4: Build "next" array, then swap at each crossing
  const M = nodes.length;
  const next = new Array<number>(M);
  for (let i = 0; i < M; i++) next[i] = (i + 1) % M;

  for (const pair of ixPairs.values()) {
    const a = pair[0]!;
    const b = pair[1]!;
    const tmp = next[a]!;
    next[a] = next[b]!;
    next[b] = tmp;
  }

  // Step 5: Trace loops
  const visited = new Array<boolean>(M).fill(false);
  const loops: Vec2[][] = [];

  for (let start = 0; start < M; start++) {
    if (visited[start]) continue;
    const loop: Vec2[] = [];
    let cur = start;
    while (!visited[cur]) {
      visited[cur] = true;
      loop.push(nodes[cur]!);
      cur = next[cur]!;
    }
    if (loop.length >= 3) loops.push(loop);
  }

  return loops;
}

/**
 * Split two overlapping Elma polygons along their boundary intersection.
 *
 * Returns an array of Elma Polygons representing the non-overlapping pieces
 * (A−B and B−A), or `null` if the polygons are disjoint (no overlap).
 */
export function splitPolygons(a: Polygon, b: Polygon): Polygon[] | null {
  const clipA = elmaToClip(a);
  const clipB = elmaToClip(b);

  // Check if the polygons actually overlap
  let intersection;
  try {
    intersection = polygonClipping.intersection(clipA, clipB);
  } catch {
    return null;
  }

  if (intersection.length === 0) {
    // No overlap — nothing to split
    return null;
  }

  // Compute the non-overlapping parts
  let diffAB;
  let diffBA;
  try {
    diffAB = polygonClipping.difference(clipA, clipB);
    diffBA = polygonClipping.difference(clipB, clipA);
  } catch {
    return null;
  }

  // Convert results back to Elma polygons
  const result: Polygon[] = [];

  for (const multiPoly of diffAB) {
    for (const ring of multiPoly) {
      const elmaPoly = clipToElma(ring);
      if (elmaPoly) {
        elmaPoly.grass = a.grass;
        result.push(elmaPoly);
      }
    }
  }

  for (const multiPoly of diffBA) {
    for (const ring of multiPoly) {
      const elmaPoly = clipToElma(ring);
      if (elmaPoly) {
        elmaPoly.grass = b.grass;
        result.push(elmaPoly);
      }
    }
  }

  return result.length > 0 ? result : null;
}
