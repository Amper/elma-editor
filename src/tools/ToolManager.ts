import type { EditorTool, CanvasPointerEvent } from './Tool';
import type { EditorState } from '@/state/editorStore';
import { ToolId } from '@/types';
import { SelectTool } from './SelectTool';
import { DrawPolygonTool } from './DrawPolygonTool';
import { DrawObjectTool } from './DrawObjectTool';
import { PanTool } from './PanTool';
import { VertexTool } from './VertexTool';
import { PipeTool } from './PipeTool';
import { ShapeTool } from './ShapeTool';
import { ImageImportTool } from './ImageImportTool';
import { DrawPictureTool } from './DrawPictureTool';
import { DrawMaskTool } from './DrawMaskTool';

export class ToolManager {
  private tools: Map<ToolId, EditorTool>;
  private activeTool: EditorTool | null = null;

  constructor(private getStore: () => EditorState) {
    this.tools = new Map<ToolId, EditorTool>([
      [ToolId.Select, new SelectTool(getStore)],
      [ToolId.DrawPolygon, new DrawPolygonTool(getStore)],
      [ToolId.DrawObject, new DrawObjectTool(getStore)],
      [ToolId.Pipe, new PipeTool(getStore)],
      [ToolId.Shape, new ShapeTool(getStore)],
      [ToolId.Pan, new PanTool(getStore)],
      [ToolId.Vertex, new VertexTool(getStore)],
      [ToolId.DrawPicture, new DrawPictureTool(getStore)],
      [ToolId.ImageImport, new ImageImportTool(getStore)],
      [ToolId.DrawMask, new DrawMaskTool(getStore)],
    ]);
  }

  setActiveTool(id: ToolId): void {
    if (this.activeTool) this.activeTool.deactivate();
    this.activeTool = this.tools.get(id) ?? null;
    if (this.activeTool) this.activeTool.activate();
  }

  onPointerDown(e: CanvasPointerEvent): void {
    this.activeTool?.onPointerDown(e);
  }
  onPointerMove(e: CanvasPointerEvent): void {
    this.activeTool?.onPointerMove(e);
  }
  onPointerUp(e: CanvasPointerEvent): void {
    this.activeTool?.onPointerUp(e);
  }
  onKeyDown(e: KeyboardEvent): void {
    this.activeTool?.onKeyDown(e);
  }
  onKeyUp(e: KeyboardEvent): void {
    this.activeTool?.onKeyUp(e);
  }
  renderOverlay(ctx: CanvasRenderingContext2D): void {
    this.activeTool?.renderOverlay(ctx);
  }
  getCursor(): string {
    return this.activeTool?.getCursor() ?? 'default';
  }
}
