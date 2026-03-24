import type { Level } from 'elmajs';
import { type ViewportState, type SelectionState, type TopologyError, ToolId } from '@/types';
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
  for (const pi of selection.polygonIndices) {
    const poly = level.polygons[pi];
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
    for (const [pi, vertSet] of selection.vertexIndices) {
      const poly = level.polygons[pi];
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
  for (const oi of selection.objectIndices) {
    const obj = level.objects[oi];
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
  for (const pi of selection.pictureIndices) {
    const pic = level.pictures[pi];
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
