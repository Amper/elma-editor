import { Clip } from 'elmajs';
import type { Vec2 } from '@/types';
import { pointInPolygon, computeBBox } from '@/utils/geometry';
import { segmentsIntersect } from '@/utils/topology';

// ── Types ────────────────────────────────────────────────────────────────────

export interface MaskSpec {
  name: string;
  worldW: number;
  worldH: number;
  area: number;
}

interface BlockingPolygon {
  vertices: Vec2[];
  bbox: { minX: number; minY: number; maxX: number; maxY: number };
}

interface CoverageGrid {
  cellSize: number;
  cols: number;
  rows: number;
  originX: number;
  originY: number;
  cells: Uint8Array;
}

export interface Placement {
  x: number;
  y: number;
  maskName: string;
  worldW: number;
  worldH: number;
}

export interface FillTextureResult {
  placements: Placement[];
}

// ── Rectangle-polygon tests ──────────────────────────────────────────────────

/** Check if a rectangle is entirely inside a polygon (4 corners + edge samples). */
function isRectInsidePolygon(
  x: number,
  y: number,
  w: number,
  h: number,
  vertices: Vec2[],
): boolean {
  // 4 corners
  if (!pointInPolygon({ x, y }, vertices)) return false;
  if (!pointInPolygon({ x: x + w, y }, vertices)) return false;
  if (!pointInPolygon({ x, y: y + h }, vertices)) return false;
  if (!pointInPolygon({ x: x + w, y: y + h }, vertices)) return false;

  // 3 samples per edge (catches concavities)
  for (let i = 1; i <= 3; i++) {
    const t = i / 4;
    if (!pointInPolygon({ x: x + w * t, y }, vertices)) return false;
    if (!pointInPolygon({ x: x + w * t, y: y + h }, vertices)) return false;
    if (!pointInPolygon({ x, y: y + h * t }, vertices)) return false;
    if (!pointInPolygon({ x: x + w, y: y + h * t }, vertices)) return false;
  }

  return true;
}

/** Check if a rectangle overlaps a blocking polygon. */
function doesRectOverlapBlocker(
  rx: number,
  ry: number,
  rw: number,
  rh: number,
  blocker: BlockingPolygon,
): boolean {
  const b = blocker.bbox;

  // 1. Quick bbox reject
  if (rx + rw <= b.minX || rx >= b.maxX) return false;
  if (ry + rh <= b.minY || ry >= b.maxY) return false;

  const verts = blocker.vertices;

  // 2. Any blocker vertex inside the rect?
  for (const v of verts) {
    if (v.x >= rx && v.x <= rx + rw && v.y >= ry && v.y <= ry + rh) {
      return true;
    }
  }

  // 3. Any rect corner inside the blocker polygon?
  const corners: Vec2[] = [
    { x: rx, y: ry },
    { x: rx + rw, y: ry },
    { x: rx, y: ry + rh },
    { x: rx + rw, y: ry + rh },
  ];
  for (const c of corners) {
    if (pointInPolygon(c, verts)) return true;
  }

  // 4. Edge-edge intersection (rect edges vs polygon edges)
  const rectEdges: [Vec2, Vec2][] = [
    [{ x: rx, y: ry }, { x: rx + rw, y: ry }],
    [{ x: rx + rw, y: ry }, { x: rx + rw, y: ry + rh }],
    [{ x: rx + rw, y: ry + rh }, { x: rx, y: ry + rh }],
    [{ x: rx, y: ry + rh }, { x: rx, y: ry }],
  ];
  for (const [ra, rb] of rectEdges) {
    for (let i = 0; i < verts.length; i++) {
      const j = (i + 1) % verts.length;
      if (segmentsIntersect(ra, rb, verts[i]!, verts[j]!) !== null) {
        return true;
      }
    }
  }

  return false;
}

function doesRectOverlapAnyBlocker(
  rx: number,
  ry: number,
  rw: number,
  rh: number,
  blockers: BlockingPolygon[],
): boolean {
  for (const b of blockers) {
    if (doesRectOverlapBlocker(rx, ry, rw, rh, b)) return true;
  }
  return false;
}

// ── Coverage grid ────────────────────────────────────────────────────────────

function createCoverageGrid(
  bbox: { minX: number; minY: number; maxX: number; maxY: number },
  cellSize: number,
): CoverageGrid {
  const cols = Math.ceil((bbox.maxX - bbox.minX) / cellSize) + 1;
  const rows = Math.ceil((bbox.maxY - bbox.minY) / cellSize) + 1;
  return {
    cellSize,
    cols,
    rows,
    originX: bbox.minX,
    originY: bbox.minY,
    cells: new Uint8Array(cols * rows),
  };
}

function markCovered(
  grid: CoverageGrid,
  rx: number,
  ry: number,
  rw: number,
  rh: number,
): void {
  const c0 = Math.max(0, Math.floor((rx - grid.originX) / grid.cellSize));
  const c1 = Math.min(grid.cols - 1, Math.floor((rx + rw - grid.originX) / grid.cellSize));
  const r0 = Math.max(0, Math.floor((ry - grid.originY) / grid.cellSize));
  const r1 = Math.min(grid.rows - 1, Math.floor((ry + rh - grid.originY) / grid.cellSize));

  for (let r = r0; r <= r1; r++) {
    for (let c = c0; c <= c1; c++) {
      grid.cells[r * grid.cols + c] = 1;
    }
  }
}

/** Check what fraction of cells in a rect region are already covered. */
function coverageFraction(
  grid: CoverageGrid,
  rx: number,
  ry: number,
  rw: number,
  rh: number,
): number {
  const c0 = Math.max(0, Math.floor((rx - grid.originX) / grid.cellSize));
  const c1 = Math.min(grid.cols - 1, Math.floor((rx + rw - grid.originX) / grid.cellSize));
  const r0 = Math.max(0, Math.floor((ry - grid.originY) / grid.cellSize));
  const r1 = Math.min(grid.rows - 1, Math.floor((ry + rh - grid.originY) / grid.cellSize));

  let total = 0;
  let covered = 0;
  for (let r = r0; r <= r1; r++) {
    for (let c = c0; c <= c1; c++) {
      total++;
      if (grid.cells[r * grid.cols + c]) covered++;
    }
  }
  return total > 0 ? covered / total : 1;
}

/** Find uncovered cell centers that are inside the target polygon. */
function findUncoveredCells(
  grid: CoverageGrid,
  targetVertices: Vec2[],
): Vec2[] {
  const uncovered: Vec2[] = [];
  for (let r = 0; r < grid.rows; r++) {
    for (let c = 0; c < grid.cols; c++) {
      if (grid.cells[r * grid.cols + c]) continue;
      const cx = grid.originX + c * grid.cellSize + grid.cellSize / 2;
      const cy = grid.originY + r * grid.cellSize + grid.cellSize / 2;
      if (pointInPolygon({ x: cx, y: cy }, targetVertices)) {
        uncovered.push({ x: cx, y: cy });
      }
    }
  }
  return uncovered;
}

// ── Blocking polygon collection ──────────────────────────────────────────────

function collectBlockingPolygons(
  allPolygons: Array<{ vertices: Vec2[]; grass: boolean; id: string }>,
  targetId: string,
  clip: number,
  expandedBBox: { minX: number; minY: number; maxX: number; maxY: number },
): BlockingPolygon[] {
  // For Unclipped, no blocking is needed
  if (clip === Clip.Unclipped) return [];

  const blockers: BlockingPolygon[] = [];
  for (const poly of allPolygons) {
    if (poly.id === targetId) continue;
    if (poly.grass) continue;
    if (poly.vertices.length < 3) continue;

    const bbox = computeBBox(poly.vertices);

    // Skip polygons far from the target
    if (bbox.maxX < expandedBBox.minX || bbox.minX > expandedBBox.maxX) continue;
    if (bbox.maxY < expandedBBox.minY || bbox.minY > expandedBBox.maxY) continue;

    blockers.push({ vertices: poly.vertices, bbox });
  }
  return blockers;
}

// ── Main algorithm ───────────────────────────────────────────────────────────

const OVERLAP_FACTOR = 0.85;
const COVERAGE_SKIP_THRESHOLD = 0.9;

/**
 * Fill a polygon with texture masks using a multi-pass grid algorithm.
 *
 * Places large masks in the interior and smaller masks near edges and
 * neighboring polygons. Returns null if no placements can be made.
 */
export function fillPolygonWithTexture(
  targetVertices: Vec2[],
  allPolygons: Array<{ vertices: Vec2[]; grass: boolean; id: string }>,
  targetPolygonId: string,
  availableMasks: Map<string, { worldW: number; worldH: number }>,
  clip: number,
  maxPlacements: number,
): FillTextureResult | null {
  if (targetVertices.length < 3) return null;
  if (availableMasks.size === 0) return null;

  // Sort masks by area (largest first)
  const sortedMasks: MaskSpec[] = [];
  for (const [name, { worldW, worldH }] of availableMasks) {
    sortedMasks.push({ name, worldW, worldH, area: worldW * worldH });
  }
  sortedMasks.sort((a, b) => b.area - a.area);

  const smallestMask = sortedMasks[sortedMasks.length - 1]!;
  const largestMask = sortedMasks[0]!;
  const bbox = computeBBox(targetVertices);

  // Expand bbox by largest mask dimension for blocker search
  const largestDim = Math.max(largestMask.worldW, largestMask.worldH);
  const expandedBBox = {
    minX: bbox.minX - largestDim,
    minY: bbox.minY - largestDim,
    maxX: bbox.maxX + largestDim,
    maxY: bbox.maxY + largestDim,
  };

  const blockers = collectBlockingPolygons(allPolygons, targetPolygonId, clip, expandedBBox);

  // Coverage grid — cell size based on smallest mask, clamped to [0.05, 0.5]
  const cellSize = Math.max(0.05, Math.min(0.5,
    Math.min(smallestMask.worldW, smallestMask.worldH) * 0.5,
  ));
  const grid = createCoverageGrid(bbox, cellSize);

  const placements: Placement[] = [];

  // ── Phase 1: Grid fill with each mask size (large → small) ─────────────

  for (const mask of sortedMasks) {
    if (placements.length >= maxPlacements) break;

    const stepX = mask.worldW * OVERLAP_FACTOR;
    const stepY = mask.worldH * OVERLAP_FACTOR;

    // Two grid offsets: aligned and staggered (half-step)
    const offsets = [
      { dx: 0, dy: 0 },
      { dx: stepX * 0.5, dy: stepY * 0.5 },
    ];

    for (const { dx, dy } of offsets) {
      if (placements.length >= maxPlacements) break;

      const startX = bbox.minX - mask.worldW * 0.1 + dx;
      const startY = bbox.minY - mask.worldH * 0.1 + dy;

      for (let y = startY; y < bbox.maxY; y += stepY) {
        for (let x = startX; x < bbox.maxX; x += stepX) {
          if (placements.length >= maxPlacements) break;

          // Skip if mostly already covered
          if (coverageFraction(grid, x, y, mask.worldW, mask.worldH) > COVERAGE_SKIP_THRESHOLD) {
            continue;
          }

          // Rect must be entirely inside the target polygon
          if (!isRectInsidePolygon(x, y, mask.worldW, mask.worldH, targetVertices)) {
            continue;
          }

          // Must not overlap any blocking polygon
          if (doesRectOverlapAnyBlocker(x, y, mask.worldW, mask.worldH, blockers)) {
            continue;
          }

          placements.push({
            x,
            y,
            maskName: mask.name,
            worldW: mask.worldW,
            worldH: mask.worldH,
          });
          markCovered(grid, x, y, mask.worldW, mask.worldH);
        }
      }
    }
  }

  // ── Phase 2: Gap fill with smallest mask ───────────────────────────────

  const uncovered = findUncoveredCells(grid, targetVertices);

  // Deduplicate: for nearby uncovered cells, place one mask centered on the group
  // Use a simple approach: skip cells already covered by newly placed gap-fill masks
  for (const cell of uncovered) {
    if (placements.length >= maxPlacements) break;

    // Check if this cell is now covered by a recent gap-fill placement
    const ci = Math.floor((cell.x - grid.originX) / grid.cellSize);
    const ri = Math.floor((cell.y - grid.originY) / grid.cellSize);
    if (ci >= 0 && ci < grid.cols && ri >= 0 && ri < grid.rows) {
      if (grid.cells[ri * grid.cols + ci]) continue;
    }

    // Center mask on uncovered cell
    const placeX = cell.x - smallestMask.worldW / 2;
    const placeY = cell.y - smallestMask.worldH / 2;

    // Relaxed: only check center is in polygon (stencil clips the rest)
    if (!pointInPolygon(cell, targetVertices)) continue;

    // Still must not overlap blockers
    if (doesRectOverlapAnyBlocker(placeX, placeY, smallestMask.worldW, smallestMask.worldH, blockers)) {
      continue;
    }

    placements.push({
      x: placeX,
      y: placeY,
      maskName: smallestMask.name,
      worldW: smallestMask.worldW,
      worldH: smallestMask.worldH,
    });
    markCovered(grid, placeX, placeY, smallestMask.worldW, smallestMask.worldH);
  }

  return placements.length > 0 ? { placements } : null;
}
