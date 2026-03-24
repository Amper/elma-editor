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

export class DrawMaskTool implements EditorTool {
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
      const config = store.maskConfig;
      store.addPicture({
        x: snapped.x,
        y: snapped.y,
        name: '',
        clip: config.clip,
        distance: config.distance,
        texture: config.texture,
        mask: config.mask,
      });
    }
  }

  onPointerMove(e: CanvasPointerEvent) {
    this.previewPos = snapToGrid(e.worldPos, this.getStore().grid);
  }

  onPointerUp() {}

  onKeyDown(e: KeyboardEvent) {
    if (e.key === 'c' || e.key === 'C') {
      const store = this.getStore();
      const current = store.maskConfig.clip;
      const next = current === Clip.Unclipped ? Clip.Ground
        : current === Clip.Ground ? Clip.Sky
        : Clip.Unclipped;
      store.setMaskConfig({ clip: next });
    }
  }

  onKeyUp() {}

  renderOverlay(ctx: CanvasRenderingContext2D) {
    if (!this.previewPos) return;

    const store = this.getStore();
    const { texture, mask, clip } = store.maskConfig;
    const { x, y } = this.previewPos;
    const t = getTheme();
    const zoom = store.viewport.zoom;

    const lgrAssets = getEditorLgr();
    const maskData = lgrAssets?.masks.get(mask);
    const texPattern = lgrAssets?.texturePatterns.get(texture);

    ctx.globalAlpha = 0.5;

    if (maskData && texPattern) {
      const pw = maskData.bitmap.width;
      const ph = maskData.bitmap.height;
      const oc = new OffscreenCanvas(pw, ph);
      const octx = oc.getContext('2d')!;

      texPattern.setTransform(new DOMMatrix());
      octx.fillStyle = texPattern;
      octx.fillRect(0, 0, pw, ph);

      octx.globalCompositeOperation = 'destination-in';
      octx.drawImage(maskData.bitmap, 0, 0);

      ctx.drawImage(oc, x, y, maskData.worldW, maskData.worldH);
    } else if (maskData) {
      ctx.drawImage(maskData.bitmap, x, y, maskData.worldW, maskData.worldH);
    } else {
      const size = 0.6;
      ctx.fillStyle = withAlpha(t.toolPrimary, 0.3);
      ctx.fillRect(x, y, size, size);
      ctx.strokeStyle = t.toolPrimary;
      ctx.lineWidth = 0.02;
      ctx.strokeRect(x, y, size, size);
    }

    ctx.globalAlpha = 1.0;

    const clipLabel = CLIP_LABELS[clip] ?? '?';
    ctx.fillStyle = t.handle;
    ctx.font = `${10 / zoom}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    const labelY = maskData ? y + maskData.worldH + 4 / zoom : y + 0.7;
    ctx.fillText(`${texture}/${mask} [${clipLabel}]`, x, labelY);
  }

  getCursor() {
    return 'crosshair';
  }
}
