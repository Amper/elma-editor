import { Position } from 'elmajs';

/**
 * Chaikin's corner-cutting algorithm for smoothing a closed polygon.
 * Replaces each vertex with two new points at 25% and 75% along each edge,
 * rounding corners while roughly doubling the vertex count.
 */
export function smoothPolygonVertices(vertices: Position[]): Position[] {
  const n = vertices.length;
  if (n < 3) return vertices.map((v) => new Position(v.x, v.y));

  const result: Position[] = [];
  for (let i = 0; i < n; i++) {
    const curr = vertices[i]!;
    const next = vertices[(i + 1) % n]!;
    result.push(new Position(0.75 * curr.x + 0.25 * next.x, 0.75 * curr.y + 0.25 * next.y));
    result.push(new Position(0.25 * curr.x + 0.75 * next.x, 0.25 * curr.y + 0.75 * next.y));
  }
  return result;
}
