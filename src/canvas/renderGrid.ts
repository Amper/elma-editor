import type { ViewportState } from '@/types';
import { getTheme } from './themeColors';

/**
 * Dot grid — similar to Figma/modern design tools.
 * Normal dots at every grid intersection, slightly larger dots every 5th line.
 */
export function renderGrid(
  ctx: CanvasRenderingContext2D,
  vp: ViewportState,
  canvasW: number,
  canvasH: number,
  gridSize: number,
): void {
  // Skip rendering when dots would be too dense to be useful
  const screenGridSize = gridSize * vp.zoom;
  if (screenGridSize < 8) return;

  const t = getTheme();

  // Visible world-space bounds
  const halfW = canvasW / (2 * vp.zoom);
  const halfH = canvasH / (2 * vp.zoom);
  const left = vp.centerX - halfW;
  const right = vp.centerX + halfW;
  const top = vp.centerY - halfH;
  const bottom = vp.centerY + halfH;

  const startX = Math.floor(left / gridSize) * gridSize;
  const startY = Math.floor(top / gridSize) * gridSize;

  // Dot sizes in world coords
  const normalRadius = 1.5 / vp.zoom;
  const majorRadius = 2.0 / vp.zoom;
  const majorEvery = 5; // every 5th grid line is major

  // Use fillRect for dots (faster than arc at small sizes)
  for (let x = startX; x <= right; x += gridSize) {
    for (let y = startY; y <= bottom; y += gridSize) {
      const isMajorX = Math.abs(Math.round(x / gridSize)) % majorEvery === 0;
      const isMajorY = Math.abs(Math.round(y / gridSize)) % majorEvery === 0;
      const isMajor = isMajorX && isMajorY;

      const r = isMajor ? majorRadius : normalRadius;
      ctx.fillStyle = isMajor ? t.gridMajor : t.gridDot;
      ctx.fillRect(x - r, y - r, r * 2, r * 2);
    }
  }
}
