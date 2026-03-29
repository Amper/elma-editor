/** 2D vector / point. Plain object for serializability. */
export interface Vec2 {
  x: number;
  y: number;
}

/** Axis-aligned bounding box. */
export interface BBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** Line segment between two points. */
export interface Segment {
  a: Vec2;
  b: Vec2;
}

/** Result of a hit-test against level geometry. */
export type HitTestResult =
  | { kind: 'vertex'; polygonIndex: number; polygonId: string; vertexIndex: number; position: Vec2 }
  | { kind: 'edge'; polygonIndex: number; polygonId: string; edgeIndex: number; position: Vec2; t: number }
  | { kind: 'object'; objectIndex: number; objectId: string; position: Vec2 }
  | { kind: 'picture'; pictureIndex: number; pictureId: string; position: Vec2 }
  | { kind: 'polygon'; polygonIndex: number; polygonId: string; position: Vec2 }
  | { kind: 'debugStart'; position: Vec2 }
  | { kind: 'none' };

// ── Transform frame types ────────────────────────────────────────────────────

/** Identifies one of the 8 resize handles on the transform frame. */
export type ResizeHandleId =
  | 'nw' | 'n' | 'ne'
  | 'w'       | 'e'
  | 'sw' | 's' | 'se';

/** Result of hit-testing against the transform frame. */
export type FrameHandleHit =
  | { kind: 'resize'; handle: ResizeHandleId }
  | { kind: 'rotate' }
  | { kind: 'inside' }
  | { kind: 'none' };

/** The computed transform frame: an axis-aligned bounding box with center. */
export interface TransformFrame {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  cx: number;
  cy: number;
}
