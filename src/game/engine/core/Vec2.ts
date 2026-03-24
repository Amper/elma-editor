/**
 * 2D vector math - ported from vect2.h/cpp
 * All operations match the original C++ implementation exactly.
 */
export class Vec2 {
  x: number;
  y: number;

  constructor(x = 0, y = 0) {
    this.x = x;
    this.y = y;
  }

  add(a: Vec2): Vec2 {
    return new Vec2(this.x + a.x, this.y + a.y);
  }

  sub(a: Vec2): Vec2 {
    return new Vec2(this.x - a.x, this.y - a.y);
  }

  /** Dot product */
  dot(a: Vec2): number {
    return this.x * a.x + this.y * a.y;
  }

  scale(s: number): Vec2 {
    return new Vec2(this.x * s, this.y * s);
  }

  rotate(rotation: number): Vec2 {
    const a = Math.sin(rotation);
    const b = Math.cos(rotation);
    return new Vec2(b * this.x - a * this.y, a * this.x + b * this.y);
  }

  /** Length using Newton-refined sqrt, matching original C++ behavior */
  length(): number {
    return squareRoot(this.x * this.x + this.y * this.y);
  }

  normalize(): Vec2 {
    const recip = 1 / this.length();
    return new Vec2(this.x * recip, this.y * recip);
  }

  clone(): Vec2 {
    return new Vec2(this.x, this.y);
  }
}

/** Newton-refined square root matching original C++ square_root() */
function squareRoot(a: number): number {
  if (a < 0) {
    return 1;
  }
  const x1 = Math.sqrt(a);
  if (x1 === 0) {
    return 0;
  }
  return 0.5 * (x1 + a / x1);
}

export const Vec2i = new Vec2(1.0, 0.0);
export const Vec2j = new Vec2(0.0, 1.0);
export const Vec2null = new Vec2(0.0, 0.0);

export function unitVector(a: Vec2): Vec2 {
  return a.scale(1 / a.length());
}

export function rotate90deg(v: Vec2): Vec2 {
  return new Vec2(-v.y, v.x);
}

export function rotateMinus90deg(v: Vec2): Vec2 {
  return new Vec2(v.y, -v.x);
}

/**
 * Intersection point of two infinite lines.
 * Line 1: passes through r1 with direction v1
 * Line 2: passes through r2 with direction v2
 */
export function intersection(r1: Vec2, v1: Vec2, r2: Vec2, v2: Vec2): Vec2 {
  let n = rotate90deg(v1);
  let nv2 = n.dot(v2);
  if (Math.abs(nv2) < 0.00000001) {
    // Parallel lines
    if (v1.dot(v2) < 0) {
      r2 = r2.add(v2);
    }
    if (r2.sub(r1).dot(v1) > 0) {
      return r2;
    } else {
      return r1;
    }
  }
  v1 = v1.normalize();
  v2 = v2.normalize();
  n = rotate90deg(v1);
  nv2 = n.dot(v2);
  const nr21 = n.dot(r2.sub(r1));
  return r2.sub(v2.scale(nr21 / nv2));
}

/** Distance between a point and a line segment */
export function pointSegmentDistance(
  pointR: Vec2,
  segmentR: Vec2,
  segmentV: Vec2
): number {
  const rr = pointR.sub(segmentR);
  const scalar = segmentV.dot(rr);
  if (scalar <= 0) {
    return rr.length();
  }
  if (scalar >= segmentV.dot(segmentV)) {
    return rr.sub(segmentV).length();
  }
  const n = rotate90deg(unitVector(segmentV));
  return Math.abs(n.dot(rr));
}

/** Distance between a point and an infinite line */
export function pointLineDistance(
  pointR: Vec2,
  segmentR: Vec2,
  segmentV: Vec2
): number {
  const rr = pointR.sub(segmentR);
  const n = rotate90deg(unitVector(segmentV));
  return Math.abs(n.dot(rr));
}

/** One intersection point of two circles */
export function circlesIntersection(
  r1: Vec2,
  r2: Vec2,
  l1: number,
  l2: number
): Vec2 {
  const v = r2.sub(r1);
  let l = v.length();
  if (l >= l1 + l2) {
    l = l1 + l2 - 0.000001;
  }
  if (l1 >= l + l2) {
    l1 = l + l2 - 0.00001;
  }
  if (l2 >= l + l1) {
    l2 = l + l1 - 0.00001;
  }
  const vUnit = v.scale(1 / l);
  const normal = rotate90deg(vUnit);
  const x = (l1 * l1 - l2 * l2 + l * l) / (2.0 * l);
  const m = squareRoot(l1 * l1 - x * x);
  return r1.add(vUnit.scale(x)).add(normal.scale(m));
}

function lineSegmentIntersects(v1: Vec2, r2: Vec2, v2: Vec2): boolean {
  const norm = rotate90deg(v1);
  const firstSide = r2.dot(norm) > 0 ? 1 : 0;
  const secondSide = r2.add(v2).dot(norm) > 0 ? 1 : 0;
  return (firstSide !== 0 && secondSide === 0) || (firstSide === 0 && secondSide !== 0);
}

function lineSegmentIntersectsInexact(v1: Vec2, r2: Vec2, v2: Vec2): boolean {
  const epsilon = 0.00000001;
  const norm = rotate90deg(v1);
  let firstSide = 0;
  const firstSideDist = r2.dot(norm);
  if (firstSideDist > epsilon) firstSide = 1;
  if (firstSideDist < -epsilon) firstSide = -1;
  let secondSide = 0;
  const secondSideDist = r2.add(v2).dot(norm);
  if (secondSideDist > epsilon) secondSide = 1;
  if (secondSideDist < -epsilon) secondSide = -1;
  if ((firstSide === -1 && secondSide === -1) || (firstSide === 1 && secondSide === 1)) {
    return false;
  }
  return true;
}

/** Returns true if two segments intersect */
export function segmentsIntersect(
  r1: Vec2,
  v1: Vec2,
  r2: Vec2,
  v2: Vec2
): boolean {
  return lineSegmentIntersects(v1, r2.sub(r1), v2) &&
         lineSegmentIntersects(v2, r1.sub(r2), v1);
}

/** Returns true if two segments intersect or are close */
export function segmentsIntersectInexact(
  r1: Vec2,
  v1: Vec2,
  r2: Vec2,
  v2: Vec2
): boolean {
  return lineSegmentIntersectsInexact(v1, r2.sub(r1), v2) &&
         lineSegmentIntersectsInexact(v2, r1.sub(r2), v1);
}

/** Returns true if an infinite line and a circle intersect */
export function lineCircleIntersection(
  lineR: Vec2,
  lineV: Vec2,
  circleR: Vec2,
  radius: number
): { intersects: boolean; point: Vec2 } {
  const r = circleR.sub(lineR);
  const normalizedLineV = lineV.normalize();
  const k = normalizedLineV.scale(normalizedLineV.dot(r));
  const distance = pointLineDistance(circleR, lineR, lineV);
  const squared = radius * radius - distance * distance;
  if (squared < 0.0) {
    return { intersects: false, point: new Vec2() };
  }
  const t = Math.sqrt(squared);
  const point = lineR.add(k).sub(normalizedLineV.scale(t));
  return { intersects: true, point };
}