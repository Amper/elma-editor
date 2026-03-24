/**
 * Canvas 2D renderer - initial implementation for development.
 * Will be replaced by WebGL2 renderer later.
 */
import { Vec2 } from '../core/Vec2';
import type { GameState } from '../game/GameLoop';
import { formatTime, getTimeCentiseconds } from '../game/GameLoop';
import type { LevelData, Polygon } from '../level/Level';
import type { MotorState } from '../physics/MotorState';
import { OBJECT_RADIUS } from '../core/Constants';
import type { ObjectProperty } from '../level/Level';

export class CanvasRenderer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private pixelsPerMeter = 48;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Failed to get 2D context');
    this.ctx = ctx;
  }

  resize(): void {
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = this.canvas.clientWidth * dpr;
    this.canvas.height = this.canvas.clientHeight * dpr;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  render(state: GameState, _options?: { showGrass?: boolean; showPictures?: boolean; showTextures?: boolean }): void {
    const { ctx, canvas } = this;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    const cam = state.camera;
    const ppm = this.pixelsPerMeter * cam.zoom;

    // Clear
    ctx.fillStyle = '#1a1a2e';
    ctx.fillRect(0, 0, width, height);

    ctx.save();
    // Transform: center on camera, flip Y so physics Y-up maps to screen Y-down
    ctx.translate(width / 2, height / 2);
    ctx.scale(ppm, -ppm); // Negative Y scale flips to Y-up coordinate system
    ctx.translate(-cam.x, -cam.y);

    // Draw polygons (level space -> physics space via -y)
    this.drawPolygons(state.level);

    // Draw objects (already in physics space)
    this.drawObjects(state.level);

    // Draw bike (physics space)
    this.drawBike(state.motor);

    ctx.restore();

    // HUD (screen space)
    this.drawHUD(state);
  }

  private drawPolygons(level: LevelData): void {
    for (const poly of level.polygons) {
      if (poly.isGrass) {
        this.drawPolygonOutline(poly, '#2d6a2d');
      } else {
        this.drawPolygonFilled(poly);
      }
    }
  }

  private drawPolygonFilled(poly: Polygon): void {
    const ctx = this.ctx;
    const verts = poly.vertices;
    if (verts.length < 3) return;

    ctx.beginPath();
    // Convert from level space to physics space: negate Y
    ctx.moveTo(verts[0]!.x, -verts[0]!.y);
    for (let i = 1; i < verts.length; i++) {
      ctx.lineTo(verts[i]!.x, -verts[i]!.y);
    }
    ctx.closePath();
    ctx.fillStyle = '#3a3a4a';
    ctx.fill();
    ctx.strokeStyle = '#666';
    ctx.lineWidth = 0.02;
    ctx.stroke();
  }

  private drawPolygonOutline(poly: Polygon, color: string): void {
    const ctx = this.ctx;
    const verts = poly.vertices;
    if (verts.length < 2) return;

    ctx.beginPath();
    ctx.moveTo(verts[0]!.x, -verts[0]!.y);
    for (let i = 1; i < verts.length; i++) {
      ctx.lineTo(verts[i]!.x, -verts[i]!.y);
    }
    ctx.closePath();
    ctx.strokeStyle = color;
    ctx.lineWidth = 0.03;
    ctx.stroke();
  }

  private drawObjects(level: LevelData): void {
    const ctx = this.ctx;

    for (const obj of level.objects) {
      if (!obj.active) continue;

      // Objects are already in physics space (Y-inverted by GameLoop)
      const x = obj.r.x;
      const y = obj.r.y;

      ctx.beginPath();
      ctx.arc(x, y, OBJECT_RADIUS, 0, Math.PI * 2);

      switch (obj.type) {
        case 'exit':
          ctx.strokeStyle = '#ffcc00';
          ctx.lineWidth = 0.04;
          ctx.stroke();
          break;
        case 'food':
          ctx.fillStyle = '#ff3333';
          ctx.fill();
          if (obj.property !== 'none') {
            this.drawGravityArrow(x, y, obj.property);
          }
          break;
        case 'killer':
          ctx.fillStyle = '#888888';
          ctx.fill();
          ctx.strokeStyle = '#ff0000';
          ctx.lineWidth = 0.03;
          ctx.stroke();
          break;
      }
    }
  }

  private drawGravityArrow(x: number, y: number, property: ObjectProperty): void {
    // Direction in Y-up physics space
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

  private drawBike(motor: MotorState): void {
    const ctx = this.ctx;

    // Draw wheels
    ctx.beginPath();
    ctx.arc(motor.leftWheel.r.x, motor.leftWheel.r.y, motor.leftWheel.radius, 0, Math.PI * 2);
    ctx.strokeStyle = '#00cc00';
    ctx.lineWidth = 0.03;
    ctx.stroke();

    // Wheel spoke
    const leftSpokeEnd = new Vec2(
      motor.leftWheel.r.x + Math.cos(motor.leftWheel.rotation) * motor.leftWheel.radius,
      motor.leftWheel.r.y + Math.sin(motor.leftWheel.rotation) * motor.leftWheel.radius
    );
    ctx.beginPath();
    ctx.moveTo(motor.leftWheel.r.x, motor.leftWheel.r.y);
    ctx.lineTo(leftSpokeEnd.x, leftSpokeEnd.y);
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(motor.rightWheel.r.x, motor.rightWheel.r.y, motor.rightWheel.radius, 0, Math.PI * 2);
    ctx.strokeStyle = '#00cc00';
    ctx.lineWidth = 0.03;
    ctx.stroke();

    const rightSpokeEnd = new Vec2(
      motor.rightWheel.r.x + Math.cos(motor.rightWheel.rotation) * motor.rightWheel.radius,
      motor.rightWheel.r.y + Math.sin(motor.rightWheel.rotation) * motor.rightWheel.radius
    );
    ctx.beginPath();
    ctx.moveTo(motor.rightWheel.r.x, motor.rightWheel.r.y);
    ctx.lineTo(rightSpokeEnd.x, rightSpokeEnd.y);
    ctx.stroke();

    // Draw bike frame
    ctx.beginPath();
    ctx.moveTo(motor.leftWheel.r.x, motor.leftWheel.r.y);
    ctx.lineTo(motor.bike.r.x, motor.bike.r.y);
    ctx.lineTo(motor.rightWheel.r.x, motor.rightWheel.r.y);
    ctx.strokeStyle = '#cccccc';
    ctx.lineWidth = 0.04;
    ctx.stroke();

    // Draw body/rider
    ctx.beginPath();
    ctx.moveTo(motor.bike.r.x, motor.bike.r.y);
    ctx.lineTo(motor.bodyR.x, motor.bodyR.y);
    ctx.strokeStyle = '#ffaa00';
    ctx.lineWidth = 0.05;
    ctx.stroke();

    // Draw head
    ctx.beginPath();
    ctx.arc(motor.headR.x, motor.headR.y, 0.238, 0, Math.PI * 2);
    ctx.fillStyle = '#ffcc88';
    ctx.fill();
  }

  /** Draw a remote player's bike (public for collab mode). */
  drawRemoteBike(motor: MotorState, alpha = 1.0): void {
    const prev = this.ctx.globalAlpha;
    this.ctx.globalAlpha = alpha;
    this.drawBike(motor);
    this.ctx.globalAlpha = prev;
  }

  private drawHUD(state: GameState): void {
    const ctx = this.ctx;
    const width = this.canvas.clientWidth;

    // Timer
    const cs = getTimeCentiseconds(state);
    const timeStr = formatTime(cs);

    ctx.font = 'bold 24px monospace';
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'right';
    ctx.fillText(timeStr, width - 20, 35);

    // Apple count
    ctx.textAlign = 'left';
    ctx.fillText(`Apples: ${state.appleCount}/${state.requiredApples}`, 20, 35);

    // Result overlay
    if (state.result === 'dead') {
      ctx.fillStyle = 'rgba(255, 0, 0, 0.5)';
      ctx.font = 'bold 48px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('DEAD - Press Escape to restart', width / 2, this.canvas.clientHeight / 2);
    } else if (state.result === 'won') {
      ctx.fillStyle = 'rgba(0, 255, 0, 0.5)';
      ctx.font = 'bold 48px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(`WIN: ${formatTime(state.winTime)}`, width / 2, this.canvas.clientHeight / 2);
    }
  }
}