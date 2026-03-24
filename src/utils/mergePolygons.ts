import { Polygon, Position } from 'elmajs';
import polygonClipping from 'polygon-clipping';
import type { Polygon as ClipPolygon, Ring, Pair } from 'polygon-clipping';

/**
 * Merge multiple Elma polygons into one (boolean union).
 *
 * Returns an array of Elma Polygons representing the merged result,
 * or `null` if the polygons are fully disjoint (no overlap or shared edge).
 *
 * The result may contain multiple polygons if the union produces holes
 * (each hole becomes a separate polygon for Elma's even-odd fill).
 */
export function mergePolygons(polygons: Polygon[]): Polygon[] | null {
  if (polygons.length < 1) return null;

  // Single self-intersecting polygon: union with itself to clean it up
  if (polygons.length === 1) {
    return selfMergePolygon(polygons[0]!);
  }

  // Convert Elma polygons to polygon-clipping format
  const clipPolygons: ClipPolygon[] = polygons.map(elmaToClip);

  // Compute boolean union
  let result;
  try {
    result = polygonClipping.union(clipPolygons[0]!, ...clipPolygons.slice(1));
  } catch {
    // polygon-clipping can throw on degenerate input
    return null;
  }

  // If the union produces the same number of separate polygons as input,
  // the polygons are disjoint — don't merge
  if (result.length >= polygons.length) {
    return null;
  }

  // Convert result back to Elma polygons
  const merged: Polygon[] = [];
  for (const multiPoly of result) {
    // multiPoly = [outerRing, ...holeRings]
    for (const ring of multiPoly) {
      const elmaPoly = clipToElma(ring);
      if (elmaPoly) merged.push(elmaPoly);
    }
  }

  return merged.length > 0 ? merged : null;
}

/** Convert an Elma Polygon to polygon-clipping format. */
export function elmaToClip(poly: Polygon): ClipPolygon {
  const ring: Ring = poly.vertices.map(
    (v) => [v.x, v.y] as Pair,
  );
  // polygon-clipping expects a closed ring (first == last) for some edge cases,
  // but also handles non-closed rings. Let's ensure it's properly closed.
  if (ring.length > 0) {
    const first = ring[0]!;
    const last = ring[ring.length - 1]!;
    if (first[0] !== last[0] || first[1] !== last[1]) {
      ring.push([first[0], first[1]]);
    }
  }
  return [ring];
}

/** Convert a polygon-clipping ring back to an Elma Polygon. */
export function clipToElma(ring: Ring): Polygon | null {
  // Remove the closing vertex if it duplicates the first
  let vertices = ring;
  if (vertices.length > 1) {
    const first = vertices[0]!;
    const last = vertices[vertices.length - 1]!;
    if (first[0] === last[0] && first[1] === last[1]) {
      vertices = vertices.slice(0, -1);
    }
  }

  if (vertices.length < 3) return null;

  const poly = new Polygon();
  poly.grass = false;
  poly.vertices = vertices.map(([x, y]) => new Position(x, y));
  return poly;
}

/**
 * Merge a single self-intersecting polygon with itself.
 * Uses boolean union to resolve self-intersections into a clean outline.
 * Returns cleaned polygon(s) or null if the polygon isn't self-intersecting.
 */
function selfMergePolygon(poly: Polygon): Polygon[] | null {
  const clip = elmaToClip(poly);

  let result;
  try {
    result = polygonClipping.union(clip);
  } catch {
    return null;
  }

  // Count total rings in the result
  let totalRings = 0;
  for (const mp of result) totalRings += mp.length;

  // If the result is just 1 ring with the same vertex count, nothing changed
  if (totalRings === 1 && result.length === 1) {
    const outRing = result[0]![0]!;
    // Remove closing vertex for comparison
    let outLen = outRing.length;
    if (outLen > 1) {
      const f = outRing[0]!;
      const l = outRing[outLen - 1]!;
      if (f[0] === l[0] && f[1] === l[1]) outLen--;
    }
    if (outLen === poly.vertices.length) return null;
  }

  const merged: Polygon[] = [];
  for (const multiPoly of result) {
    for (const ring of multiPoly) {
      const elmaPoly = clipToElma(ring);
      if (elmaPoly) {
        elmaPoly.grass = poly.grass;
        merged.push(elmaPoly);
      }
    }
  }

  return merged.length > 0 ? merged : null;
}
