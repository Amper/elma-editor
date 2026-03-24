import type { EditorTool, CanvasPointerEvent } from './Tool';
import type { EditorState } from '@/state/editorStore';
import type { Vec2 } from '@/types';
import { Clip } from 'elmajs';
import { snapToGrid } from '@/utils/snap';
import { getTheme, withAlpha } from '@/canvas/themeColors';
import { getEditorLgr } from '@/canvas/lgrCache';

const CLIP_LABELS: Record<number, string> = {
  [Clip.Unclipped]: 'U',
  [Clip.Ground]: 'G',
  [Clip.Sky]: 'S',
};

export class DrawPictureTool implements EditorTool {
  private previewPos: Vec2 | null = null;

  constructor(private getStore: () => EditorState) {}

  activate() {
    this.previewPos = null;
  }
  deactivate() {
    this.previewPos = null;
  }

  onPointerDown(e: CanvasPointerEvent) {
    if (e.button === 0) {
      const store = this.getStore();
      const snapped = snapToGrid(e.worldPos, store.grid);
      const config = store.pictureConfig;
      store.addPicture({
        x: snapped.x,
        y: snapped.y,
        name: config.name,
        clip: config.clip,
        distance: config.distance,
      });
    }
  }

  onPointerMove(e: CanvasPointerEvent) {
    this.previewPos = snapToGrid(e.worldPos, this.getStore().grid);
  }

  onPointerUp() {}

  onKeyDown(e: KeyboardEvent) {
    // Cycle clip mode with C key
    if (e.key === 'c' || e.key === 'C') {
      const store = this.getStore();
      const current = store.pictureConfig.clip;
      const next = current === Clip.Unclipped ? Clip.Ground
        : current === Clip.Ground ? Clip.Sky
        : Clip.Unclipped;
      store.setPictureConfig({ clip: next });
    }
  }

  onKeyUp() {}

  renderOverlay(ctx: CanvasRenderingContext2D) {
    if (!this.previewPos) return;

    const store = this.getStore();
    const { name, clip } = store.pictureConfig;
    const { x, y } = this.previewPos;
    const t = getTheme();
    const zoom = store.viewport.zoom;

    const lgrAssets = getEditorLgr();
    const picData = lgrAssets?.pictures.get(name);

    ctx.globalAlpha = 0.5;

    if (picData) {
      // Position = top-left corner (matching Elma .lev format)
      ctx.drawImage(picData.bitmap, x, y, picData.worldW, picData.worldH);
    } else {
      const size = 0.6;
      ctx.fillStyle = withAlpha(t.toolPrimary, 0.3);
      ctx.fillRect(x, y, size, size);
      ctx.strokeStyle = t.toolPrimary;
      ctx.lineWidth = 0.02;
      ctx.strokeRect(x, y, size, size);
    }

    ctx.globalAlpha = 1.0;

    // Label: picture name + clip mode
    const clipLabel = CLIP_LABELS[clip] ?? '?';
    ctx.fillStyle = t.handle;
    ctx.font = `${10 / zoom}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    const labelY = picData ? y + picData.worldH + 4 / zoom : y + 0.7;
    ctx.fillText(`${name} [${clipLabel}]`, x, labelY);
  }

  getCursor() {
    return 'crosshair';
  }
}
