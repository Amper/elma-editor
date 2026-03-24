import type { Level } from 'elmajs';

/** Build a map from polygon ID to its current array index. */
export function buildPolygonIndex(level: Level): Map<string, number> {
  const map = new Map<string, number>();
  for (let i = 0; i < level.polygons.length; i++) {
    map.set(level.polygons[i]!.id, i);
  }
  return map;
}

/** Build a map from object ID to its current array index. */
export function buildObjectIndex(level: Level): Map<string, number> {
  const map = new Map<string, number>();
  for (let i = 0; i < level.objects.length; i++) {
    map.set(level.objects[i]!.id, i);
  }
  return map;
}

/** Build a map from picture ID to its current array index. */
export function buildPictureIndex(level: Level): Map<string, number> {
  const map = new Map<string, number>();
  for (let i = 0; i < level.pictures.length; i++) {
    map.set(level.pictures[i]!.id, i);
  }
  return map;
}

/** Find a polygon's current array index by its ID. Returns -1 if not found. */
export function polyIdToIndex(level: Level, id: string): number {
  for (let i = 0; i < level.polygons.length; i++) {
    if (level.polygons[i]!.id === id) return i;
  }
  return -1;
}

/** Find an object's current array index by its ID. Returns -1 if not found. */
export function objectIdToIndex(level: Level, id: string): number {
  for (let i = 0; i < level.objects.length; i++) {
    if (level.objects[i]!.id === id) return i;
  }
  return -1;
}

/** Find a picture's current array index by its ID. Returns -1 if not found. */
export function pictureIdToIndex(level: Level, id: string): number {
  for (let i = 0; i < level.pictures.length; i++) {
    if (level.pictures[i]!.id === id) return i;
  }
  return -1;
}
