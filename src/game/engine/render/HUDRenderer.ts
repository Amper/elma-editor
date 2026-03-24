/**
 * HUD renderer: Canvas2D overlay for timer, apple count, and result display.
 * Rendered as a separate canvas overlaid on the WebGL canvas.
 */
import type { GameState } from '../game/GameLoop';
import { formatTime, getTimeCentiseconds } from '../game/GameLoop';
import { OBJECT_RADIUS } from '../core/Constants';
import type { ObjectProperty } from '../level/Level';

const PIXELS_PER_METER = 48;

export class HUDRenderer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;

  constructor(parent: HTMLElement) {
    this.canvas = document.createElement('canvas');
    this.canvas.style.position = 'absolute';
    this.canvas.style.top = '0';
    this.canvas.style.left = '0';
    this.canvas.style.width = '100%';
    this.canvas.style.height = '100%';
    this.canvas.style.pointerEvents = 'none';
    parent.appendChild(this.canvas);

    const ctx = this.canvas.getContext('2d');
    if (!ctx) throw new Error('Failed to get HUD 2D context');
    this.ctx = ctx;
  }

  resize(): void {
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = this.canvas.clientWidth * dpr;
    this.canvas.height = this.canvas.clientHeight * dpr;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  draw(state: GameState): void {
    const ctx = this.ctx;
    const width = this.canvas.clientWidth;
    const height = this.canvas.clientHeight;

    // Clear HUD layer
    ctx.clearRect(0, 0, width, height);

    // Timer (top-right)
    const cs = getTimeCentiseconds(state);
    const timeStr = formatTime(cs);

    ctx.font = 'bold 24px monospace';
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'right';
    ctx.fillText(timeStr, width - 20, 35);

    // Apple count (top-left)
    ctx.textAlign = 'left';
    ctx.fillText(`Apples: ${state.appleCount}/${state.requiredApples}`, 20, 35);

    // Gravity arrows on food objects (world-space overlay)
    this.drawGravityArrows(state);

    // Result overlay
    if (state.result === 'dead') {
      ctx.fillStyle = 'rgba(255, 0, 0, 0.5)';
      ctx.font = 'bold 48px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('DEAD - Press Escape to restart', width / 2, height / 2);
    } else if (state.result === 'won') {
      ctx.fillStyle = 'rgba(0, 255, 0, 0.5)';
      ctx.font = 'bold 48px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(`WIN: ${formatTime(state.winTime)}`, width / 2, height / 2);
    }
  }

  private drawGravityArrows(state: GameState): void {
    const ctx = this.ctx;
    const cam = state.camera;
    const ppm = PIXELS_PER_METER * cam.zoom;
    const width = this.canvas.clientWidth;
    const height = this.canvas.clientHeight;

    ctx.save();
    // Transform to Y-up physics world space
    ctx.translate(width / 2, height / 2);
    ctx.scale(ppm, -ppm);
    ctx.translate(-cam.x, -cam.y);

    for (const obj of state.level.objects) {
      if (!obj.active || obj.type !== 'food' || obj.property === 'none') continue;
      this.drawGravityArrow(obj.r.x, obj.r.y, obj.property);
    }

    ctx.restore();
  }

  private drawGravityArrow(x: number, y: number, property: ObjectProperty): void {
    let dx = 0, dy = 0;
    switch (property) {
      case 'gravity_up':    dy =  1; break;
      case 'gravity_down':  dy = -1; break;
      case 'gravity_left':  dx = -1; break;
      case 'gravity_right': dx =  1; break;
      default: return;
    }
    const ctx = this.ctx;
    const shaft = OBJECT_RADIUS * 0.55;
    const head = OBJECT_RADIUS * 0.3;

    ctx.beginPath();
    ctx.moveTo(x - dx * shaft * 0.3, y - dy * shaft * 0.3);
    ctx.lineTo(x + dx * shaft, y + dy * shaft);
    ctx.moveTo(x + dx * shaft, y + dy * shaft);
    ctx.lineTo(x + dx * shaft - dx * head - dy * head * 0.5, y + dy * shaft - dy * head + dx * head * 0.5);
    ctx.moveTo(x + dx * shaft, y + dy * shaft);
    ctx.lineTo(x + dx * shaft - dx * head + dy * head * 0.5, y + dy * shaft - dy * head - dx * head * 0.5);
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 0.05;
    ctx.stroke();
  }

  destroy(): void {
    this.canvas.remove();
  }
}