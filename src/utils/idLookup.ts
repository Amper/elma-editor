import type { Level } from 'elmajs';

export function polyIdToIndex(level: Level, id: string): number {
  return level.polygons.findIndex((p) => p.id === id);
}

export function objectIdToIndex(level: Level, id: string): number {
  return level.objects.findIndex((o) => o.id === id);
}

export function pictureIdToIndex(level: Level, id: string): number {
  return level.pictures.findIndex((p) => p.id === id);
}
