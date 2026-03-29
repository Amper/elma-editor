import type { Level } from 'elmajs';
import { OBJECT_RADIUS } from 'elmajs';
import { type ViewportState, type SelectionState, type TopologyError, type DebugStartConfig, ToolId, type Vec2 } from '@/types';
import { getTheme, withAlpha } from './themeColors';
import { getEditorLgr } from './lgrCache';

export interface OverlayContext {
  level: Level;
  viewport: ViewportState;
  selection: SelectionState;
  topologyErrors: TopologyError[];
  timestamp: number;
  activeTool: ToolId;
  debugStart: DebugStartConfig | null;
  debugStartSelected: boolean;
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
  for (const poly of level.polygons) {
    if (!selection.polygonIds.has(poly.id)) continue;
    if (poly.vertices.length < 2) continue;

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
      const poly = level.polygons.find((p) => p.id === polyId);
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
  for (const obj of level.objects) {
    if (!selection.objectIds.has(obj.id)) continue;

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

  // Highlight selected debug start: same style as regular objects
  if (oc.debugStartSelected && oc.debugStart) {
    const dp = oc.debugStart.position;
    ctx.beginPath();
    ctx.arc(dp.x, dp.y, 0.6, 0, Math.PI * 2);
    ctx.strokeStyle = withAlpha(t.selection, 0.2);
    ctx.lineWidth = 3 / viewport.zoom;
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(dp.x, dp.y, 0.5, 0, Math.PI * 2);
    ctx.strokeStyle = t.selection;
    ctx.lineWidth = 2 / viewport.zoom;
    ctx.setLineDash([dashLen, dashGap]);
    ctx.lineDashOffset = -dashOffset;
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // Highlight selected pictures: selection rectangle (position = top-left)
  const lgrAssets = getEditorLgr();
  for (const pic of level.pictures) {
    if (!selection.pictureIds.has(pic.id)) continue;
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

export function renderRemoteUsers(
  ctx: CanvasRenderingContext2D,
  remoteUsers: Map<string, any>,
  level: Level,
  toScreen: (p: Vec2) => Vec2,
): void {
  for (const user of remoteUsers.values()) {
    if (!user.cursor) continue;
    const screenPos = toScreen(user.cursor);

    // Draw cursor dot
    ctx.beginPath();
    ctx.arc(screenPos.x, screenPos.y, 5, 0, Math.PI * 2);
    ctx.fillStyle = user.color;
    ctx.fill();

    // Draw name label
    ctx.font = '11px sans-serif';
    ctx.fillStyle = user.color;
    ctx.fillText(user.userName, screenPos.x + 10, screenPos.y - 5);

    // Draw remote selections
    if (user.selectedPolygonIds?.size > 0) {
      ctx.strokeStyle = user.color;
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 4]);
      for (const poly of level.polygons) {
        if (!user.selectedPolygonIds.has(poly.id)) continue;
        const verts = poly.vertices;
        if (verts.length < 2) continue;
        ctx.beginPath();
        const first = toScreen(verts[0]!);
        ctx.moveTo(first.x, first.y);
        for (let i = 1; i < verts.length; i++) {
          const sv = toScreen(verts[i]!);
          ctx.lineTo(sv.x, sv.y);
        }
        ctx.closePath();
        ctx.stroke();
      }
      ctx.setLineDash([]);
    }
  }
}
