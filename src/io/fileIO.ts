import { Level, Polygon, Position, ElmaObject } from 'elmajs';
import type { Position as Pos } from 'elmajs';
import {generateId} from "@/utils/generateId.ts";

/** Read a .lev file from a File object (drag-drop or input). */
export async function readLevelFile(file: File): Promise<{ level: Level; fileName: string }> {
  const arrayBuffer = await file.arrayBuffer();
  const level = Level.from(arrayBuffer);
  return { level, fileName: file.name };
}

/** Check if polygon vertices are in clockwise order (shoelace formula). */
function isPolygonClockwise(vertices: Pos[]): boolean {
  let sum = 0;
  for (let i = 0; i < vertices.length; i++) {
    const curr = vertices[i]!;
    const next = vertices[((i + 1) === vertices.length) ? 0 : i + 1]!;
    sum += (next.x - curr.x) * (next.y + curr.y);
  }
  return sum > 0;
}

/** Ray-casting point-in-polygon test. */
function pointInPolygon(x: number, y: number, vertices: Pos[]): boolean {
  let inside = false;
  for (let i = 0, j = vertices.length - 1; i < vertices.length; j = i++) {
    const vi = vertices[i]!;
    const vj = vertices[j]!;
    if (
      vi.y > y !== vj.y > y &&
      x < ((vj.x - vi.x) * (y - vi.y)) / (vj.y - vi.y) + vi.x
    ) {
      inside = !inside;
    }
  }
  return inside;
}

/**
 * Determine if a polygon should be treated as ground based on nesting.
 * A polygon whose first vertex lies inside an odd number of other polygons
 * is ground (solid); even count means it's a platform/hole.
 */
function shouldPolygonBeGround(polygon: Polygon, allPolygons: Polygon[]): boolean {
  const testPoint = polygon.vertices[0];
  if (!testPoint) return false;
  let count = 0;
  for (const other of allPolygons) {
    if (other.id === polygon.id) continue;
    if (pointInPolygon(testPoint.x, testPoint.y, other.vertices)) {
      count++;
    }
  }
  // Odd nesting = ground (matches reference level-editor shouldPolygonBeGround)
  return count % 2 !== 0;
}

/**
 * Prepare a level for export by fixing polygon vertex winding order.
 * Ground polygons must be clockwise; platform/hole polygons counter-clockwise.
 * Based on the createBinary() method from elmadev/level-editor.
 */
function prepareLevelForExport(level: Level): Level {
  const exportLevel = new Level();

  // Copy level metadata
  exportLevel.version = level.version;
  exportLevel.lgr = level.lgr;
  exportLevel.name = level.name;
  exportLevel.ground = level.ground;
  exportLevel.sky = level.sky;
  exportLevel.top10 = level.top10;

  // Copy objects as-is
  exportLevel.objects = level.objects.map((o) => {
    const co = new ElmaObject();
    co.id = o.id || generateId();
    co.position = new Position(o.position.x, o.position.y);
    co.type = o.type;
    co.gravity = o.gravity;
    co.animation = o.animation;
    return co;
  });

  // Copy pictures as-is
  exportLevel.pictures = [...level.pictures];

  // Copy polygons with winding correction (matches createBinary from level-editor)
  const polygonsCopy = level.polygons.map((p) => {
    const cp = new Polygon();
    cp.id = p.id || generateId();
    cp.grass = p.grass;
    cp.vertices = p.vertices.map((v) => new Position(v.x, v.y));
    return cp;
  });

  exportLevel.polygons = polygonsCopy.map((p) => {
    const cp = new Polygon();
    cp.id = p.id || generateId();
    cp.grass = p.grass;
    cp.vertices = p.vertices.map((v) => new Position(v.x, v.y));
    if (shouldPolygonBeGround(p, polygonsCopy) !== isPolygonClockwise(p.vertices)) {
      cp.vertices = cp.vertices.slice(0).reverse();
    }
    return cp;
  });

  return exportLevel;
}

/** Serialize a Level to .lev binary and trigger a browser download. */
export function downloadLevel(level: Level, fileName: string): void {
  const exportLevel = prepareLevelForExport(level);
  const buffer = exportLevel.toBuffer();
  const blob = new Blob([buffer], { type: 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName.endsWith('.lev') ? fileName : `${fileName}.lev`;
  a.click();
  URL.revokeObjectURL(url);
}
