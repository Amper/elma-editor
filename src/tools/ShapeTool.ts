import type { EditorTool, CanvasPointerEvent } from './Tool';
import type { EditorState } from '@/state/editorStore';
import type { Vec2, ShapeConfig } from '@/types';
import { RUBBER_BAND_SHAPES } from '@/types';
import { getTheme, withAlpha } from '@/canvas/themeColors';
import { fillWithPreviewTexture } from './texturePreview';

type ShapeState = 'idle' | 'placing';

interface RandomTemplate {
  /** Absolute angle for each vertex (sorted, 0..2PI). */
  angles: number[];
  /** Radius fraction for each vertex (0.3..1.0). */
  radii: number[];
}

/** Generate a random polygon template with the given vertex range. */
function generateRandomTemplate(minVerts: number, maxVerts: number): RandomTemplate {
  const n = minVerts + Math.floor(Math.random() * (maxVerts - minVerts + 1));
  const sectorSize = (2 * Math.PI) / n;
  const jitter = 0.3;
  const angles: number[] = [];
  for (let i = 0; i < n; i++) {
    const base = sectorSize * i;
    const offset = (Math.random() * 2 - 1) * jitter * sectorSize;
    angles.push(base + offset);
  }
  angles.sort((a, b) => a - b);
  const radii = angles.map(() => 0.3 + Math.random() * 0.7);
  return { angles, radii };
}

/** Compute vertices of a regular polygon. */
function regularPolygon(center: Vec2, sides: number, radius: number, rotation: number): Vec2[] {
  return Array.from({ length: sides }, (_, i) => {
    const angle = rotation + (2 * Math.PI * i) / sides;
    return { x: center.x + Math.cos(angle) * radius, y: center.y + Math.sin(angle) * radius };
  });
}

/** Rotate a set of vertices around a center. */
function rotateVertices(verts: Vec2[], center: Vec2, angle: number): Vec2[] {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return verts.map((v) => {
    const dx = v.x - center.x;
    const dy = v.y - center.y;
    return { x: center.x + dx * cos - dy * sin, y: center.y + dx * sin + dy * cos };
  });
}

/** Generate vertices for a shape based on config and two points. */
function generateShapeVertices(config: ShapeConfig, startPos: Vec2, currentPos: Vec2, randomTemplate?: RandomTemplate): Vec2[] | null {
  const dx = currentPos.x - startPos.x;
  const dy = currentPos.y - startPos.y;
  const isRubberBand = RUBBER_BAND_SHAPES.has(config.type);

  if (isRubberBand) {
    const w = Math.abs(dx);
    const h = Math.abs(dy);
    if (w < 1e-6 && h < 1e-6) return null;

    // Bounding box corners (min/max)
    const minX = Math.min(startPos.x, currentPos.x);
    const minY = Math.min(startPos.y, currentPos.y);
    const maxX = Math.max(startPos.x, currentPos.x);
    const maxY = Math.max(startPos.y, currentPos.y);

    switch (config.type) {
      case 'rectangle':
        return [
          { x: minX, y: minY }, { x: maxX, y: minY },
          { x: maxX, y: maxY }, { x: minX, y: maxY },
        ];

      case 'trapezoid': {
        const ratio = config.topRatio / 100;
        const topW = w * ratio;
        const inset = (w - topW) / 2;
        return [
          { x: minX + inset, y: minY }, { x: maxX - inset, y: minY },
          { x: maxX, y: maxY }, { x: minX, y: maxY },
        ];
      }

      case 'parallelogram': {
        const offset = h * Math.tan((config.tiltAngle * Math.PI) / 180);
        return [
          { x: minX + offset, y: minY }, { x: maxX + offset, y: minY },
          { x: maxX, y: maxY }, { x: minX, y: maxY },
        ];
      }

      case 'ellipse': {
        const cx = (minX + maxX) / 2;
        const cy = (minY + maxY) / 2;
        const rx = w / 2;
        const ry = h / 2;
        const n = config.segments;
        return Array.from({ length: n }, (_, i) => {
          const angle = (2 * Math.PI * i) / n;
          return { x: cx + Math.cos(angle) * rx, y: cy + Math.sin(angle) * ry };
        });
      }

      default:
        return null;
    }
  } else {
    // Center + radius mode
    const radius = Math.sqrt(dx * dx + dy * dy);
    if (radius < 1e-6) return null;
    const angle = Math.atan2(dy, dx);

    switch (config.type) {
      case 'triangle':
        return regularPolygon(startPos, 3, radius, angle);
      case 'square':
        return regularPolygon(startPos, 4, radius, angle);
      case 'circle':
        return regularPolygon(startPos, config.segments, radius, angle);
      case 'polygon':
        return regularPolygon(startPos, config.sides, radius, angle);
      case 'star': {
        const n = config.starPoints;
        const innerRadius = radius * (1 - config.starDepth / 100);
        const verts: Vec2[] = [];
        for (let i = 0; i < n * 2; i++) {
          const a = angle + (Math.PI * i) / n;
          const r = i % 2 === 0 ? radius : innerRadius;
          verts.push({ x: startPos.x + Math.cos(a) * r, y: startPos.y + Math.sin(a) * r });
        }
        return verts;
      }
      case 'random': {
        if (!randomTemplate) return null;
        return randomTemplate.angles.map((a, i) => ({
          x: startPos.x + Math.cos(angle + a) * radius * randomTemplate.radii[i]!,
          y: startPos.y + Math.sin(angle + a) * radius * randomTemplate.radii[i]!,
        }));
      }
      default:
        return null;
    }
  }
}

export class ShapeTool implements EditorTool {
  private state: ShapeState = 'idle';
  private startPos: Vec2 = { x: 0, y: 0 };
  private currentPos: Vec2 = { x: 0, y: 0 };
  private randomTemplate: RandomTemplate = generateRandomTemplate(5, 10);

  constructor(private getStore: () => EditorState) {}

  activate() {
    this.state = 'idle';
    this.regenerateRandom();
  }
  deactivate() { this.state = 'idle'; }

  private regenerateRandom() {
    const cfg = this.getStore().shapeConfig;
    this.randomTemplate = generateRandomTemplate(cfg.randomMinVertices, cfg.randomMaxVertices);
  }

  onPointerDown(e: CanvasPointerEvent) {
    if (e.button === 2) { this.state = 'idle'; return; }
    if (e.button !== 0) return;

    if (this.state === 'idle') {
      this.startPos = e.worldPos;
      this.currentPos = e.worldPos;
      this.state = 'placing';
    } else if (this.state === 'placing') {
      this.commitShape();
    }
  }

  onPointerMove(e: CanvasPointerEvent) {
    if (this.state === 'placing') {
      this.currentPos = e.worldPos;
    }
  }

  onPointerUp() {}

  onKeyDown(e: KeyboardEvent) {
    if (e.key === 'Escape') { this.state = 'idle'; }
    else if (e.key === 'Enter' && this.state === 'placing') { this.commitShape(); }
    else if (e.key === ' ' && this.getStore().shapeConfig.type === 'random') {
      e.preventDefault();
      this.regenerateRandom();
    }
  }

  onKeyUp() {}

  renderOverlay(ctx: CanvasRenderingContext2D) {
    if (this.state !== 'placing') return;

    const t = getTheme();
    const store = this.getStore();
    const zoom = store.viewport.zoom;
    const vertices = generateShapeVertices(store.shapeConfig, this.startPos, this.currentPos, this.randomTemplate);

    if (!vertices || vertices.length < 3) return;

    // Preview fill
    if (!fillWithPreviewTexture(ctx, store.level, vertices)) {
      ctx.beginPath();
      ctx.moveTo(vertices[0]!.x, vertices[0]!.y);
      for (let i = 1; i < vertices.length; i++) ctx.lineTo(vertices[i]!.x, vertices[i]!.y);
      ctx.closePath();
      ctx.fillStyle = withAlpha(t.toolPrimary, 0.1);
      ctx.fill();
    }

    // Stroke outline
    ctx.beginPath();
    ctx.moveTo(vertices[0]!.x, vertices[0]!.y);
    for (let i = 1; i < vertices.length; i++) ctx.lineTo(vertices[i]!.x, vertices[i]!.y);
    ctx.closePath();
    ctx.setLineDash([6 / zoom, 3 / zoom]);
    ctx.strokeStyle = withAlpha(t.toolPrimary, 0.8);
    ctx.lineWidth = 1.5 / zoom;
    ctx.stroke();
    ctx.setLineDash([]);

    // Vertex dots
    const dotR = 3 / zoom;
    ctx.fillStyle = withAlpha(t.toolPrimary, 0.9);
    for (const v of vertices) {
      ctx.beginPath();
      ctx.arc(v.x, v.y, dotR, 0, Math.PI * 2);
      ctx.fill();
    }

    // Center/start crosshair
    const ch = 6 / zoom;
    ctx.strokeStyle = withAlpha(t.toolPrimary, 0.5);
    ctx.lineWidth = 1 / zoom;
    ctx.beginPath();
    ctx.moveTo(this.startPos.x - ch, this.startPos.y);
    ctx.lineTo(this.startPos.x + ch, this.startPos.y);
    ctx.moveTo(this.startPos.x, this.startPos.y - ch);
    ctx.lineTo(this.startPos.x, this.startPos.y + ch);
    ctx.stroke();
  }

  getCursor() { return 'crosshair'; }

  wantsContextMenu(): boolean {
    return this.state === 'idle';
  }

  private commitShape() {
    const store = this.getStore();
    const vertices = generateShapeVertices(store.shapeConfig, this.startPos, this.currentPos, this.randomTemplate);
    if (!vertices || vertices.length < 3) { this.state = 'idle'; return; }
    store.addPolygon({ grass: false, vertices });
    this.state = 'idle';
    if (store.shapeConfig.type === 'random') this.regenerateRandom();
  }
}
