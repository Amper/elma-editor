/**
 * Level data structures - ported from level.h, polygon.h, object.h
 */
import { Vec2, segmentsIntersect } from '../core/Vec2';

export type ObjectType = 'exit' | 'food' | 'killer' | 'start';
export type ObjectProperty = 'none' | 'gravity_up' | 'gravity_down' | 'gravity_left' | 'gravity_right';

export interface GameObject {
  r: Vec2;
  type: ObjectType;
  property: ObjectProperty;
  animation: number;
  active: boolean;
  floatingPhase: number;
}

export interface Polygon {
  vertices: Vec2[];
  isGrass: boolean;
}

export interface Sprite {
  r: Vec2;
  pictureName: string;
  maskName: string;
  textureName: string;
  clipping: number;
  distance: number;
}

export interface TopTenEntry {
  time: number;
  name1: string;
  name2: string;
}

export interface TopTen {
  timesCount: number;
  times: number[];
  names1: string[];
  names2: string[];
}

export interface TopTenSet {
  single: TopTen;
  multi: TopTen;
}

export interface LevelData {
  levelId: number;
  levelName: string;
  lgrName: string;
  foregroundName: string;
  backgroundName: string;
  polygons: Polygon[];
  objects: GameObject[];
  sprites: Sprite[];
  topTens: TopTenSet;
  topologyErrors: boolean;
}

/** Check if a point is in "sky" (vs ground) using ray casting even-odd rule */
export function isSky(
  level: LevelData,
  point: Vec2,
  skipPolygon?: Polygon
): boolean {
  const v = new Vec2(27654.475374565578, 37850.5364775);
  let intersections = 0;
  for (const poly of level.polygons) {
    if (poly.isGrass) continue;
    if (poly === skipPolygon) continue;
    intersections += countPolygonIntersections(poly, point, v);
  }
  return intersections % 2 === 1;
}

/** Count intersections of a ray from r1 along v1 with a polygon */
function countPolygonIntersections(poly: Polygon, r1: Vec2, v1: Vec2): number {
  let count = 0;
  const verts = poly.vertices;
  for (let i = 0; i < verts.length; i++) {
    const r2 = verts[i]!;
    const v2 = verts[(i + 1) % verts.length]!.sub(r2);
    if (segmentsIntersect(r1, v1, r2, v2)) {
      count++;
    }
  }
  return count;
}

/** Sort objects: Killer, Food, Exit, Start */
export function sortObjects(objects: GameObject[]): void {
  const order = (type: ObjectType): number => {
    switch (type) {
      case 'killer': return 1;
      case 'food': return 2;
      case 'exit': return 3;
      case 'start': return 10;
    }
  };
  objects.sort((a, b) => order(a.type) - order(b.type));
}

/** Initialize objects for gameplay: find start, offset bike, count apples */
export function initializeObjects(
  objects: GameObject[],
  _bikeR: Vec2,
  leftWheelR: Vec2,
  _rightWheelR: Vec2,
  _bodyR: Vec2
): { appleCount: number; offset: Vec2 } {
  let appleCount = 0;
  let offset = new Vec2(0, 0);
  let startFound = false;

  for (const obj of objects) {
    obj.floatingPhase = Math.random() * 2.0 * Math.PI;
    obj.active = true;

    if (obj.type === 'food') appleCount++;
    if (obj.type === 'start') {
      if (startFound) throw new Error('Level has multiple Start objects');
      startFound = true;
      obj.active = false;
      offset = obj.r.sub(leftWheelR);
    }
  }

  if (!startFound) throw new Error('Level has no Start object');
  return { appleCount, offset };
}

/** Create a default empty level */
export function createDefaultLevel(): LevelData {
  // In Elma, the polygon interior (even-odd rule) = sky (where the bike rides).
  // Ground is outside the polygon. Level space has Y-down.
  // Large level with internal ground polygons as obstacles.
  return {
    levelId: 0,
    levelName: 'Default Test',
    lgrName: 'default',
    foregroundName: 'ground',
    backgroundName: 'sky',
    polygons: [
      // Outer boundary - large rectangular cavity
      {
        vertices: [
          new Vec2(-50, -20),
          new Vec2(50, -20),
          new Vec2(50, 5),
          new Vec2(-50, 5),
        ],
        isGrass: false,
      },
      // Floor platform (left area)
      {
        vertices: [
          new Vec2(-35, 0),
          new Vec2(-28, 0),
          new Vec2(-28, 4),
          new Vec2(-35, 4),
        ],
        isGrass: false,
      },
      // Tall pillar (center-left)
      {
        vertices: [
          new Vec2(-12, -14),
          new Vec2(-9, -14),
          new Vec2(-9, 4),
          new Vec2(-12, 4),
        ],
        isGrass: false,
      },
      // Floating platform (center, high)
      {
        vertices: [
          new Vec2(2, -8),
          new Vec2(14, -8),
          new Vec2(14, -6),
          new Vec2(2, -6),
        ],
        isGrass: false,
      },
      // Ramp/wedge (right area)
      {
        vertices: [
          new Vec2(22, 4),
          new Vec2(32, 4),
          new Vec2(32, -2),
        ],
        isGrass: false,
      },
      // Block (far right)
      {
        vertices: [
          new Vec2(38, -3),
          new Vec2(46, -3),
          new Vec2(46, 3),
          new Vec2(38, 3),
        ],
        isGrass: false,
      },
      // Grass: tuft on top of floor platform
      {
        vertices: [
          new Vec2(-36, 0),
          new Vec2(-35, -2),
          new Vec2(-33, -2.5),
          new Vec2(-31, -1.5),
          new Vec2(-29, -2.5),
          new Vec2(-27, 0),
        ],
        isGrass: true,
      },
      // Grass: vegetation on left side of pillar
      {
        vertices: [
          new Vec2(-15, 4),
          new Vec2(-14, 1),
          new Vec2(-12, 0),
          new Vec2(-12, 4),
        ],
        isGrass: true,
      },
      // Grass: tuft on ground floor (center)
      {
        vertices: [
          new Vec2(-3, 4),
          new Vec2(-2, 2),
          new Vec2(0, 1.5),
          new Vec2(2, 2),
          new Vec2(3, 4),
        ],
        isGrass: true,
      },
      // Grass: vegetation along ramp slope
      {
        vertices: [
          new Vec2(26, 2),
          new Vec2(28, -0.5),
          new Vec2(30, -1.5),
          new Vec2(32, -2),
          new Vec2(32, 2),
        ],
        isGrass: true,
      },
    ],
    objects: [
      { r: new Vec2(-45, 3.5), type: 'start', property: 'none', animation: 0, active: true, floatingPhase: 0 },
      { r: new Vec2(-31, -1.5), type: 'food', property: 'none', animation: 0, active: true, floatingPhase: 0 },
      { r: new Vec2(-20, 3.5), type: 'food', property: 'none', animation: 1, active: true, floatingPhase: 0 },
      { r: new Vec2(-5, 3.5), type: 'food', property: 'none', animation: 2, active: true, floatingPhase: 0 },
      { r: new Vec2(8, -9.5), type: 'food', property: 'none', animation: 3, active: true, floatingPhase: 0 },
      { r: new Vec2(18, 3.5), type: 'food', property: 'none', animation: 4, active: true, floatingPhase: 0 },
      { r: new Vec2(35, 0), type: 'food', property: 'none', animation: 5, active: true, floatingPhase: 0 },
      { r: new Vec2(42, -4.5), type: 'exit', property: 'none', animation: 0, active: true, floatingPhase: 0 },
    ],
    sprites: [
      // Sky-clipped decorations (visible in sky/play area, clipping=2)
      { r: new Vec2(-40, 2), pictureName: 'bush1', maskName: '', textureName: '', clipping: 2, distance: 400 },
      { r: new Vec2(-22, 2), pictureName: 'bush2', maskName: '', textureName: '', clipping: 2, distance: 380 },
      { r: new Vec2(0, 2), pictureName: 'sedge', maskName: '', textureName: '', clipping: 2, distance: 400 },
      { r: new Vec2(16, 2), pictureName: 'plantain', maskName: '', textureName: '', clipping: 2, distance: 420 },
      { r: new Vec2(-6, -5), pictureName: 'flag', maskName: '', textureName: '', clipping: 2, distance: 300 },
      { r: new Vec2(25, -8), pictureName: 'tree1', maskName: '', textureName: '', clipping: 2, distance: 350 },
      // Ground-clipped decorations (visible in ground area only, clipping=1)
      { r: new Vec2(-42, 7), pictureName: 'barrel', maskName: '', textureName: '', clipping: 1, distance: 500 },
      { r: new Vec2(-20, 7), pictureName: 'barrel', maskName: '', textureName: '', clipping: 1, distance: 500 },
      { r: new Vec2(10, 7), pictureName: 'mushroom', maskName: '', textureName: '', clipping: 1, distance: 450 },
      { r: new Vec2(35, 7), pictureName: 'log1', maskName: '', textureName: '', clipping: 1, distance: 500 },
    ],
    topTens: {
      single: { timesCount: 0, times: [], names1: [], names2: [] },
      multi: { timesCount: 0, times: [], names1: [], names2: [] },
    },
    topologyErrors: false,
  };
}