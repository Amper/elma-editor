import type { Level } from 'elmajs';
import { type ViewportState, type SelectionState, type TopologyError, ToolId } from '@/types';
import type { RemoteUser } from '@/state/editorStore';
import { getTheme, withAlpha } from './themeColors';
import { getEditorLgr } from './lgrCache';

export interface OverlayContext {
  level: Level;
  viewport: ViewportState;
  selection: SelectionState;
  topologyErrors: TopologyError[];
  timestamp: number;
  activeTool: ToolId;
}

export function renderOverlays(
  ctx: CanvasRenderingContext2D,
  oc: OverlayContext,
): void {
  renderSelectionHighlights(ctx, oc);
  renderTopologyErrors(ctx, oc);
}

function renderSelectionHighlights(
  ctx: CanvasRenderingContext2D,
  oc: OverlayContext,
): void {
  const { level, viewport, selection, timestamp } = oc;
  const t = getTheme();
  const handleRadius = 4 / viewport.zoom;
  const handleStroke = 1.5 / viewport.zoom;

  // Marching-ants animation: dash pattern that scrolls over time
  const dashLen = 6 / viewport.zoom;
  const dashGap = 4 / viewport.zoom;
  const dashOffset = (timestamp * 0.001) % (dashLen + dashGap);

  // Highlight selected polygons: translucent fill + animated outline
  for (const polyId of selection.polygonIds) {
    const poly = level.polygons.find(p => p.id === polyId);
    if (!poly || poly.vertices.length < 2) continue;

    ctx.beginPath();
    ctx.moveTo(poly.vertices[0]!.x, poly.vertices[0]!.y);
    for (let i = 1; i < poly.vertices.length; i++) {
      ctx.lineTo(poly.vertices[i]!.x, poly.vertices[i]!.y);
    }
    ctx.closePath();

    // Translucent amber fill
    ctx.fillStyle = t.selectionFill;
    ctx.fill();

    // Animated marching-ants outline
    ctx.strokeStyle = t.selection;
    ctx.lineWidth = 2.5 / viewport.zoom;
    ctx.setLineDash([dashLen, dashGap]);
    ctx.lineDashOffset = -dashOffset;
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // Highlight selected vertices: circles with white stroke ring
  // Skip in Select mode — it works with whole polygons, not individual vertices
  if (oc.activeTool !== ToolId.Select) {
    for (const [polyId, vertSet] of selection.vertexSelections) {
      const poly = level.polygons.find(p => p.id === polyId);
      if (!poly) continue;
      for (const vi of vertSet) {
        const v = poly.vertices[vi];
        if (!v) continue;

        // White outer ring
        ctx.beginPath();
        ctx.arc(v.x, v.y, handleRadius + handleStroke, 0, Math.PI * 2);
        ctx.fillStyle = t.handle;
        ctx.fill();

        // Orange inner circle
        ctx.beginPath();
        ctx.arc(v.x, v.y, handleRadius, 0, Math.PI * 2);
        ctx.fillStyle = t.selection;
        ctx.fill();
      }
    }
  }

  // Highlight selected objects: animated ring
  for (const objId of selection.objectIds) {
    const obj = level.objects.find(o => o.id === objId);
    if (!obj) continue;

    // Outer glow ring
    ctx.beginPath();
    ctx.arc(obj.position.x, obj.position.y, 0.6, 0, Math.PI * 2);
    ctx.strokeStyle = withAlpha(t.selection, 0.2);
    ctx.lineWidth = 3 / viewport.zoom;
    ctx.stroke();

    // Animated inner selection ring
    ctx.beginPath();
    ctx.arc(obj.position.x, obj.position.y, 0.5, 0, Math.PI * 2);
    ctx.strokeStyle = t.selection;
    ctx.lineWidth = 2 / viewport.zoom;
    ctx.setLineDash([dashLen, dashGap]);
    ctx.lineDashOffset = -dashOffset;
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // Highlight selected pictures: selection rectangle (position = top-left)
  const lgrAssets = getEditorLgr();
  for (const picId of selection.pictureIds) {
    const pic = level.pictures.find(p => p.id === picId);
    if (!pic) continue;
    const picData = (pic.texture && pic.mask)
      ? lgrAssets?.masks.get(pic.mask)
      : lgrAssets?.pictures.get(pic.name);
    const w = picData ? picData.worldW : 0.6;
    const h = picData ? picData.worldH : 0.6;

    ctx.strokeStyle = t.selection;
    ctx.lineWidth = 2 / viewport.zoom;
    ctx.setLineDash([dashLen, dashGap]);
    ctx.lineDashOffset = -dashOffset;
    ctx.strokeRect(pic.position.x, pic.position.y, w, h);
    ctx.setLineDash([]);
  }
}

function renderTopologyErrors(
  ctx: CanvasRenderingContext2D,
  oc: OverlayContext,
): void {
  const { viewport, topologyErrors, timestamp } = oc;
  if (topologyErrors.length === 0) return;

  const t = getTheme();

  // Pulsing animation: sin oscillation with period ~1.9s
  const pulse = Math.sin(timestamp * 0.0033) * 0.5 + 0.5; // 0..1
  const baseSize = 8 / viewport.zoom;
  const pulseScale = 1 + pulse * 0.3; // 1..1.3

  for (const error of topologyErrors) {
    if (!error.position) continue;
    const { x, y } = error.position;

    // Pulsing red disc behind the marker
    const discRadius = baseSize * pulseScale;
    ctx.beginPath();
    ctx.arc(x, y, discRadius, 0, Math.PI * 2);
    ctx.fillStyle = withAlpha(t.error, 0.15 + pulse * 0.15);
    ctx.fill();

    // Red X marker
    const xSize = baseSize * 0.7;
    ctx.strokeStyle = t.error;
    ctx.lineWidth = (2 + pulse * 0.5) / viewport.zoom;
    ctx.beginPath();
    ctx.moveTo(x - xSize, y - xSize);
    ctx.lineTo(x + xSize, y + xSize);
    ctx.moveTo(x + xSize, y - xSize);
    ctx.lineTo(x - xSize, y + xSize);
    ctx.stroke();
  }
}

// ── Remote cursors & selections ─────────────────────────────────────────────

export function renderRemoteCursors(
  ctx: CanvasRenderingContext2D,
  level: Level,
  remoteUsers: Map<string, RemoteUser>,
  zoom: number,
  timestamp: number,
): void {
  if (remoteUsers.size === 0) return;

  // Marching-ants for remote selection outlines
  const dashLen = 6 / zoom;
  const dashGap = 4 / zoom;
  const dashOffset = (timestamp * 0.001) % (dashLen + dashGap);

  for (const user of remoteUsers.values()) {
    const c = user.color;

    // ── Remote polygon selections ──
    for (const polyId of user.selectedPolygonIds) {
      const poly = level.polygons.find(p => p.id === polyId);
      if (!poly || poly.vertices.length < 2) continue;

      ctx.beginPath();
      ctx.moveTo(poly.vertices[0]!.x, poly.vertices[0]!.y);
      for (let i = 1; i < poly.vertices.length; i++) {
        ctx.lineTo(poly.vertices[i]!.x, poly.vertices[i]!.y);
      }
      ctx.closePath();

      // Translucent fill in user color
      ctx.fillStyle = withAlpha(c, 0.08);
      ctx.fill();

      // Colored border
      ctx.strokeStyle = withAlpha(c, 0.4);
      ctx.lineWidth = 2 / zoom;
      ctx.setLineDash([dashLen, dashGap]);
      ctx.lineDashOffset = -dashOffset;
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // ── Remote object selections ──
    for (const objId of user.selectedObjectIds) {
      const obj = level.objects.find(o => o.id === objId);
      if (!obj) continue;

      ctx.beginPath();
      ctx.arc(obj.position.x, obj.position.y, 0.5, 0, Math.PI * 2);
      ctx.strokeStyle = withAlpha(c, 0.6);
      ctx.lineWidth = 2.5 / zoom;
      ctx.stroke();
    }

    // ── Remote cursor ──
    if (user.cursor) {
      const { x, y } = user.cursor;
      const s = 1 / zoom; // base unit: 1 CSS pixel in world coords

      // Arrow cursor shape (pointing top-left)
      ctx.beginPath();
      ctx.moveTo(x, y);                            // tip
      ctx.lineTo(x, y + 14 * s);                   // down
      ctx.lineTo(x + 4 * s, y + 10.5 * s);        // notch right
      ctx.lineTo(x + 9 * s, y + 16 * s);           // tail out
      ctx.lineTo(x + 11 * s, y + 14.5 * s);        // tail cap
      ctx.lineTo(x + 5.5 * s, y + 8.5 * s);        // notch back
      ctx.lineTo(x + 10 * s, y + 8.5 * s);         // right wing
      ctx.closePath();

      ctx.fillStyle = c;
      ctx.fill();
      ctx.strokeStyle = '#000';
      ctx.lineWidth = 1 * s;
      ctx.stroke();

      // Username label below-right of cursor
      const fontSize = 12 / zoom;
      ctx.font = `${fontSize}px sans-serif`;
      const labelX = x + 12 * s;
      const labelY = y + 18 * s;

      // Label background pill for readability
      const textMetrics = ctx.measureText(user.userName);
      const padH = 3 * s;
      const padV = 2 * s;
      const bgX = labelX - padH;
      const bgY = labelY - fontSize + padV;
      const bgW = textMetrics.width + padH * 2;
      const bgH = fontSize + padV * 2;
      const bgR = 3 * s;

      ctx.beginPath();
      ctx.roundRect(bgX, bgY, bgW, bgH, bgR);
      ctx.fillStyle = c;
      ctx.fill();

      // Label text
      ctx.fillStyle = '#fff';
      ctx.textBaseline = 'alphabetic';
      ctx.fillText(user.userName, labelX, labelY);
    }
  }
}
