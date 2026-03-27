import type { ObjectType, Gravity, Clip } from 'elmajs';
import type { Vec2 } from './geometry';

/** Display mode for toolbar / actions bar buttons. */
export type ButtonViewMode = 'icons' | 'text' | 'both';

/** Button size for toolbar / actions bar. */
export type ButtonSize = 'small' | 'medium' | 'large';

/** Toolbar item configuration (order + visibility). */
export interface ToolbarItemConfig {
  id: ToolId;
  visible: boolean;
}

/** Enumeration of all editor tools. */
export enum ToolId {
  Select = 'select',
  DrawPolygon = 'draw-polygon',
  DrawObject = 'draw-object',
  DrawPicture = 'draw-picture',
  Pipe = 'pipe',
  Vertex = 'vertex',
  Pan = 'pan',
  Shape = 'shape',
  ImageImport = 'image-import',
  DrawMask = 'draw-mask',
  DrawGrass = 'draw-grass',
  Text = 'text',
}

/** What kind of object will be placed by the DrawObject tool. */
export interface ObjectPlacementConfig {
  type: ObjectType;
  gravity: Gravity;
  animation: number;
}

/** Configuration for picture placement. */
export interface PicturePlacementConfig {
  name: string;
  clip: Clip;
  distance: number;
}

/** Configuration for texture/mask picture placement. */
export interface MaskPlacementConfig {
  texture: string;
  mask: string;
  clip: Clip;
  distance: number;
}

/** Viewport transform state. */
export interface ViewportState {
  /** World-space center of the viewport. */
  centerX: number;
  centerY: number;
  /** Pixels per world unit. */
  zoom: number;
}

/** Grid snapping configuration. */
export interface GridConfig {
  enabled: boolean;
  /** World units between grid lines. */
  size: number;
  visible: boolean;
}

/** Selection state. */
export interface SelectionState {
  polygonIndices: Set<number>;
  vertexIndices: Map<number, Set<number>>;
  objectIndices: Set<number>;
  pictureIndices: Set<number>;
}

/** Shape tool types. */
export type ShapeType = 'triangle' | 'square' | 'rectangle' | 'trapezoid' | 'parallelogram' | 'circle' | 'ellipse' | 'polygon' | 'star' | 'random';

/** Shape tool configuration. */
export interface ShapeConfig {
  type: ShapeType;
  topRatio: number;     // Trapezoid: % of top/bottom (default 50)
  tiltAngle: number;    // Parallelogram: degrees (default 30)
  segments: number;     // Circle/Ellipse: vertex count (default 32)
  sides: number;        // Regular polygon: vertex count (default 5)
  starPoints: number;   // Star: point count (default 5)
  starDepth: number;    // Star: depression % (default 50)
  randomMinVertices: number;  // Random: minimum vertex count (default 5)
  randomMaxVertices: number;  // Random: maximum vertex count (default 10)
}

/** Shape types that use rubber band (bounding box) interaction. */
export const RUBBER_BAND_SHAPES = new Set<ShapeType>(['rectangle', 'trapezoid', 'parallelogram', 'ellipse']);

/** Topology error descriptor. */
export interface TopologyError {
  type:
    | 'edge-intersection'
    | 'self-intersection'
    | 'missing-start'
    | 'missing-flower'
    | 'multiple-starts'
    | 'object-in-ground'
    | 'too-many-polygons'
    | 'too-many-vertices'
    | 'too-many-objects'
    | 'too-many-sprites'
    | 'level-too-large'
    | 'overlapping-polygons';
  polygonIndices?: number[];
  edgeIndices?: [number, number][];
  objectIndex?: number;
  position?: Vec2;
  message: string;
}
