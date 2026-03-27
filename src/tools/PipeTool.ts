import type { EditorTool, CanvasPointerEvent } from './Tool';
import type { EditorState } from '@/state/editorStore';
import type { Vec2 } from '@/types';
import { snapToGrid } from '@/utils/snap';
import { getTheme, withAlpha } from '@/canvas/themeColors';
import { fillWithPreviewTexture } from './texturePreview';

/**
 * Pipe tool — similar to Smibu's Level Editor (SLE).
 *
 * Click to place spine (center-line) points. The tool automatically
 * generates a polygon with parallel walls on both sides of the spine
 * at a configurable radius. Right-click or Enter to commit the pipe
 * as a ground polygon.
 */
export class PipeTool implements EditorTool {
  /** Committed spine points. */
  private spine: Vec2[] = [];
  /** Live cursor position (snapped). */
  private previewPoint: Vec2 | null = null;

  constructor(private getStore: () => EditorState) {}

  activate() {
    this.spine = [];
    this.previewPoint = null;
  }

  deactivate() {
    this.spine = [];
    this.previewPoint = null;
  }

  onPointerDown(e: CanvasPointerEvent) {
    if (e.button === 0) {
      const store = this.getStore();
      const snapped = snapToGrid(e.worldPos, store.grid);
      this.spine.push(snapped);
    } else if (e.button === 2) {
      this.commitPipe();
    }
  }

  onPointerMove(e: CanvasPointerEvent) {
    this.previewPoint = snapToGrid(e.worldPos, this.getStore().grid);
  }

  onPointerUp() {}

  onKeyDown(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      this.commitPipe();
    } else if (e.key === 'Escape') {
      this.spine = [];
      this.previewPoint = null;
    } else if (e.key === 'Backspace' && this.spine.length > 0) {
      this.spine.pop();
    }
  }

  onKeyUp() {}

  renderOverlay(ctx: CanvasRenderingContext2D) {
    const t = getTheme();
    const store = this.getStore();
    const zoom = store.viewport.zoom;
    const radius = store.pipeRadius;
    const round = store.pipeRoundCorners;

    // Build the full spine including the live preview point
    const fullSpine = [...this.spine];
    if (this.previewPoint) {
      fullSpine.push(this.previewPoint);
    }

    if (fullSpine.length === 0) return;

    // ── Draw pipe outline (the polygon that will be created) ──
    if (fullSpine.length >= 2) {
      const { left, right } = computeWallPoints(fullSpine, radius, round);

      // Fill the pipe area with texture preview
      const pipeOutline = [...left, ...([...right].reverse())];
      if (!fillWithPreviewTexture(ctx, store.level, pipeOutline)) {
        ctx.beginPath();
        ctx.moveTo(pipeOutline[0]!.x, pipeOutline[0]!.y);
        for (let i = 1; i < pipeOutline.length; i++) {
          ctx.lineTo(pipeOutline[i]!.x, pipeOutline[i]!.y);
        }
        ctx.closePath();
        ctx.fillStyle = withAlpha(t.toolPrimary, 0.1);
        ctx.fill();
      }

      // Left wall
      ctx.strokeStyle = t.toolPrimary;
      ctx.lineWidth = 1.5 / zoom;
      ctx.beginPath();
      ctx.moveTo(left[0]!.x, left[0]!.y);
      for (let i = 1; i < left.length; i++) {
        ctx.lineTo(left[i]!.x, left[i]!.y);
      }
      ctx.stroke();

      // Right wall
      ctx.beginPath();
      ctx.moveTo(right[0]!.x, right[0]!.y);
      for (let i = 1; i < right.length; i++) {
        ctx.lineTo(right[i]!.x, right[i]!.y);
      }
      ctx.stroke();

      // End caps (closing lines)
      ctx.setLineDash([4 / zoom, 3 / zoom]);
      ctx.strokeStyle = withAlpha(t.toolPrimary, 0.5);
      ctx.beginPath();
      // Start cap
      ctx.moveTo(left[0]!.x, left[0]!.y);
      ctx.lineTo(right[0]!.x, right[0]!.y);
      // End cap
      ctx.moveTo(left[left.length - 1]!.x, left[left.length - 1]!.y);
      ctx.lineTo(right[right.length - 1]!.x, right[right.length - 1]!.y);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // ── Draw spine center-line ──
    ctx.strokeStyle = withAlpha(t.handle, 0.4);
    ctx.lineWidth = 1 / zoom;
    ctx.setLineDash([3 / zoom, 3 / zoom]);
    ctx.beginPath();
    ctx.moveTo(fullSpine[0]!.x, fullSpine[0]!.y);
    for (let i = 1; i < fullSpine.length; i++) {
      ctx.lineTo(fullSpine[i]!.x, fullSpine[i]!.y);
    }
    ctx.stroke();
    ctx.setLineDash([]);

    // ── Draw spine vertex markers (committed only) ──
    const vertSize = 4 / zoom;
    ctx.fillStyle = t.handle;
    for (const v of this.spine) {
      ctx.fillRect(
        v.x - vertSize / 2,
        v.y - vertSize / 2,
        vertSize,
        vertSize,
      );
    }

    // ── Draw width indicator at cursor ──
    if (this.previewPoint && fullSpine.length >= 2) {
      const last = fullSpine[fullSpine.length - 1]!;
      const prev = fullSpine[fullSpine.length - 2]!;
      const normal = segmentNormal(prev, last);

      ctx.strokeStyle = withAlpha(t.handle, 0.3);
      ctx.lineWidth = 1 / zoom;
      ctx.beginPath();
      ctx.moveTo(last.x + normal.x * radius, last.y + normal.y * radius);
      ctx.lineTo(last.x - normal.x * radius, last.y - normal.y * radius);
      ctx.stroke();
    }

    // ── Width label near first spine point ──
    if (this.spine.length > 0) {
      ctx.fillStyle = withAlpha(t.toolPrimary, 0.8);
      ctx.font = `${11 / zoom}px sans-serif`;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.fillText(
        `W: ${(radius * 2).toFixed(2)}`,
        this.spine[0]!.x + 8 / zoom,
        this.spine[0]!.y + 8 / zoom,
      );
    }
  }

  getCursor() {
    return 'crosshair';
  }

  wantsContextMenu(): boolean {
    return this.spine.length === 0;
  }

  // ── Private helpers ──

  private commitPipe() {
    if (this.spine.length < 2) return;
    const store = this.getStore();
    const radius = store.pipeRadius;
    const round = store.pipeRoundCorners;

    const { left, right } = computeWallPoints(this.spine, radius, round);

    // Build polygon vertices: left side forward, right side backward
    const vertices: Vec2[] = [
      ...left,
      ...right.reverse(),
    ];

    store.addPolygon({ grass: false, vertices });

    this.spine = [];
    this.previewPoint = null;
  }
}

// ── Geometry helpers ──────────────────────────────────────────────────────────

/** Compute the unit normal (perpendicular) of a segment, rotated 90° CCW. */
function segmentNormal(a: Vec2, b: Vec2): Vec2 {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len === 0) return { x: 0, y: -1 };
  return { x: -dy / len, y: dx / len };
}

/** Normalize a vector. */
function normalize(v: Vec2): Vec2 {
  const len = Math.sqrt(v.x * v.x + v.y * v.y);
  if (len === 0) return { x: 0, y: 0 };
  return { x: v.x / len, y: v.y / len };
}

/**
 * Generate arc points from angle `startAngle` to `endAngle` (radians)
 * around a center point at the given radius.
 *
 * Takes the shortest arc direction automatically.
 */
function arcPoints(
  center: Vec2,
  radius: number,
  startAngle: number,
  endAngle: number,
  segments: number,
): Vec2[] {
  const points: Vec2[] = [];
  // Normalize the angular difference to [-PI, PI] for shortest arc
  let diff = endAngle - startAngle;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;

  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const angle = startAngle + diff * t;
    points.push({
      x: center.x + Math.cos(angle) * radius,
      y: center.y + Math.sin(angle) * radius,
    });
  }
  return points;
}

/**
 * Compute left and right wall points for a spine path at a given radius.
 *
 * When `round` is false (default), uses miter joins clamped to avoid spikes.
 * When `round` is true, inserts arc segments at interior spine points to
 * smoothly transition between wall directions.
 */
function computeWallPoints(
  spine: Vec2[],
  radius: number,
  round: boolean,
): { left: Vec2[]; right: Vec2[] } {
  const n = spine.length;
  const left: Vec2[] = [];
  const right: Vec2[] = [];

  for (let i = 0; i < n; i++) {
    if (i === 0) {
      // First point: use the normal of the first segment
      const normal = segmentNormal(spine[0]!, spine[1]!);
      left.push({
        x: spine[0]!.x + normal.x * radius,
        y: spine[0]!.y + normal.y * radius,
      });
      right.push({
        x: spine[0]!.x - normal.x * radius,
        y: spine[0]!.y - normal.y * radius,
      });
    } else if (i === n - 1) {
      // Last point: use the normal of the last segment
      const normal = segmentNormal(spine[n - 2]!, spine[n - 1]!);
      left.push({
        x: spine[i]!.x + normal.x * radius,
        y: spine[i]!.y + normal.y * radius,
      });
      right.push({
        x: spine[i]!.x - normal.x * radius,
        y: spine[i]!.y - normal.y * radius,
      });
    } else {
      // Interior point
      const n1 = segmentNormal(spine[i - 1]!, spine[i]!);
      const n2 = segmentNormal(spine[i]!, spine[i + 1]!);

      if (round) {
        // Determine which side is outer vs inner via cross product
        const d1 = { x: spine[i]!.x - spine[i - 1]!.x, y: spine[i]!.y - spine[i - 1]!.y };
        const d2 = { x: spine[i + 1]!.x - spine[i]!.x, y: spine[i + 1]!.y - spine[i]!.y };
        const cross = d1.x * d2.y - d1.y * d2.x;

        // Arc angles for left (+n) and right (-n) walls
        const angleL1 = Math.atan2(n1.y, n1.x);
        const angleL2 = Math.atan2(n2.y, n2.x);
        const angleR1 = Math.atan2(-n1.y, -n1.x);
        const angleR2 = Math.atan2(-n2.y, -n2.x);

        // Number of arc segments based on angular difference
        let diff = angleL2 - angleL1;
        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;
        const segs = Math.max(2, Math.round(Math.abs(diff) / (Math.PI / 8)));

        // Miter bisector for inner fillet center
        const avg = normalize({ x: n1.x + n2.x, y: n1.y + n2.y });
        const dot = avg.x * n1.x + avg.y * n1.y;
        const miterScale = dot > 0.25 ? 1 / dot : 4;

        if (cross > 0) {
          // Right wall is outer (arc at spine), left wall is inner (fillet)
          right.push(...arcPoints(spine[i]!, radius, angleR1, angleR2, segs));
          // Fillet: circle tangent to both inner wall lines, radius = pipeRadius
          // Center is at miterScale * 2 * radius along bisector (like miter for double radius)
          const cx = spine[i]!.x + avg.x * miterScale * 2 * radius;
          const cy = spine[i]!.y + avg.y * miterScale * 2 * radius;
          left.push(...arcPoints({ x: cx, y: cy }, radius, angleR1, angleR2, segs));
        } else {
          // Left wall is outer (arc at spine), right wall is inner (fillet)
          left.push(...arcPoints(spine[i]!, radius, angleL1, angleL2, segs));
          const cx = spine[i]!.x - avg.x * miterScale * 2 * radius;
          const cy = spine[i]!.y - avg.y * miterScale * 2 * radius;
          right.push(...arcPoints({ x: cx, y: cy }, radius, angleL1, angleL2, segs));
        }
      } else {
        // Miter join
        const avg = normalize({ x: n1.x + n2.x, y: n1.y + n2.y });
        const dot = avg.x * n1.x + avg.y * n1.y;
        const miterScale = dot > 0.25 ? 1 / dot : 4;
        const normal = { x: avg.x * miterScale, y: avg.y * miterScale };

        left.push({
          x: spine[i]!.x + normal.x * radius,
          y: spine[i]!.y + normal.y * radius,
        });
        right.push({
          x: spine[i]!.x - normal.x * radius,
          y: spine[i]!.y - normal.y * radius,
        });
      }
    }
  }

  return { left, right };
}
