import type { ObjectType, Gravity, Clip } from 'elmajs';
import type { Vec2 } from './geometry';

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
