import type { ObjectType, Gravity, Clip } from 'elmajs';
import type { Vec2 } from '@/types';

/** Serializable operation types for level mutations. All reference entities by ID, never index. */
export type Operation =
  | { type: 'addPolygon'; id: string; grass: boolean; vertices: Vec2[] }
  | { type: 'addPolygons'; polygons: Array<{ id: string; grass: boolean; vertices: Vec2[] }> }
  | { type: 'removePolygons'; ids: string[] }
  | { type: 'setPolygonGrass'; id: string; grass: boolean }
  | { type: 'setPolygonsGrass'; ids: string[]; grass: boolean }
  | { type: 'moveVertices'; moves: Array<{ polyId: string; vertIdx: number; newPos: Vec2 }> }
  | { type: 'insertVertex'; polyId: string; afterVertIdx: number; pos: Vec2 }
  | { type: 'removeVertex'; polyId: string; vertIdx: number }
  | { type: 'removeVertices'; verts: Array<{ polyId: string; vertIndices: number[] }> }
  | { type: 'addObject'; id: string; x: number; y: number; objectType: ObjectType; gravity: Gravity; animation: number }
  | { type: 'removeObjects'; ids: string[] }
  | { type: 'moveObjects'; moves: Array<{ objectId: string; newPos: Vec2 }> }
  | { type: 'updateObjects'; ids: string[]; data: { type?: ObjectType; gravity?: Gravity; animation?: number } }
  | { type: 'addPicture'; id: string; x: number; y: number; name: string; clip: Clip; distance: number; texture?: string; mask?: string }
  | { type: 'removePictures'; ids: string[] }
  | { type: 'movePictures'; moves: Array<{ pictureId: string; newPos: Vec2 }> }
  | { type: 'updatePictures'; ids: string[]; data: { name?: string; clip?: Clip; distance?: number; texture?: string; mask?: string } }
  | { type: 'setLevelName'; name: string }
  | { type: 'setLevelGround'; ground: string }
  | { type: 'setLevelSky'; sky: string }
  | { type: 'replacePolygons'; removeIds: string[]; add: Array<{ id: string; grass: boolean; vertices: Vec2[] }> }
  | { type: 'batch'; operations: Operation[] };
