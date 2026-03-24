import type { Vec2, GridConfig } from '@/types';

/** Snap a point to the nearest grid intersection. */
export function snapToGrid(point: Vec2, grid: GridConfig): Vec2 {
  if (!grid.enabled) return point;
  return {
    x: Math.round(point.x / grid.size) * grid.size,
    y: Math.round(point.y / grid.size) * grid.size,
  };
}
