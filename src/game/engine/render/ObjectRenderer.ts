/**
 * Object renderer: animated food/exit/killer sprites with bobbing.
 */
import { OBJECT_RADIUS } from '../core/Constants';
import { Vec2 } from '../core/Vec2';
import type { GLContext } from './GLContext';
import type { TextureAtlas, AtlasRegion } from './TextureAtlas';
import type { ObjectAnimations } from '../formats/LgrFormat';
import type { LevelData } from '../level/Level';

/** Object size in world space: 40 original pixels → meters */
const OBJECT_SIZE = 40 / 48;

/** Animation rate: ~30 fps matching original game display rate */
const ANIM_FPS = 30;

interface ObjectAtlasRegions {
  foodSets: AtlasRegion[][];  // Separate sets per qfood (different rotations)
  killer: AtlasRegion[];
  exit: AtlasRegion[];
}

export class ObjectRenderer {
  private ctx: GLContext;
  private atlas: TextureAtlas | null = null;
  private regions: ObjectAtlasRegions | null = null;
  private hasLgr = false;

  constructor(ctx: GLContext) {
    this.ctx = ctx;
  }

  loadObjectAnims(anims: ObjectAnimations, atlas: TextureAtlas): void {
    this.atlas = atlas;
    this.regions = {
      foodSets: anims.foodSets.map((set, si) =>
        set.map((img, fi) => atlas.add(`obj_food_${si}_${fi}`, img))
      ),
      killer: anims.killer.map((img, i) => atlas.add(`obj_killer_${i}`, img)),
      exit: anims.exit.map((img, i) => atlas.add(`obj_exit_${i}`, img)),
    };
    this.hasLgr = true;
  }

  draw(level: LevelData, gameTime: number, viewProj: Float32Array, showTextures = true): void {
    if (!showTextures || !this.hasLgr || !this.atlas?.texture || !this.regions) {
      this.drawFallback(level, gameTime, viewProj);
      return;
    }

    const ctx = this.ctx;
    const gl = ctx.gl;

    ctx.useProgram(ctx.spriteProgram);
    ctx.setUniform(ctx.spriteProgram, 'u_viewProjection', viewProj);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.atlas.texture);
    ctx.setUniformInt(ctx.spriteProgram, 'u_atlas', 0);

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    // Convert gameTime to real seconds for animation
    const animSeconds = gameTime / (1000 * 0.182 * 0.0024);

    for (const obj of level.objects) {
      if (!obj.active) continue;

      let frames: AtlasRegion[];

      switch (obj.type) {
        case 'food': {
          // Each food object selects its animation set via obj.animation
          // (matching original: Lgr->food[pker->animation % Lgr->food_count])
          const sets = this.regions.foodSets;
          if (sets.length === 0) continue;
          frames = sets[obj.animation % sets.length]!;
          break;
        }
        case 'killer':
          frames = this.regions.killer;
          break;
        case 'exit':
          frames = this.regions.exit;
          break;
        default:
          continue;
      }

      if (frames.length === 0) continue;

      // Frame selection
      const frameIndex = Math.floor(animSeconds * ANIM_FPS) % frames.length;
      const region = frames[frameIndex];

      // Draw as axis-aligned quad
      const halfSize = OBJECT_SIZE / 2;
      const origin = new Vec2(obj.r.x - halfSize, obj.r.y - halfSize);
      const extentU = new Vec2(OBJECT_SIZE, 0);
      const extentV = new Vec2(0, OBJECT_SIZE);

      this.drawSprite(origin, extentU, extentV, region!);
    }

    gl.disable(gl.BLEND);
  }

  private drawSprite(origin: Vec2, extentU: Vec2, extentV: Vec2, region: AtlasRegion): void {
    const ctx = this.ctx;
    const prog = ctx.spriteProgram;

    ctx.setUniform(prog, 'u_origin', new Float32Array([origin.x, origin.y]));
    ctx.setUniform(prog, 'u_extentU', new Float32Array([extentU.x, extentU.y]));
    ctx.setUniform(prog, 'u_extentV', new Float32Array([extentV.x, extentV.y]));
    ctx.setUniform(prog, 'u_uvRect', new Float32Array([
      region.u0, region.v0,
      region.u1 - region.u0, region.v1 - region.v0,
    ]));

    const gl = ctx.gl;
    gl.bindVertexArray(ctx.quadVAO);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.bindVertexArray(null);
  }

  /** Fallback: draw objects as colored circles (same as CanvasRenderer) */
  private drawFallback(level: LevelData, _gameTime: number, viewProj: Float32Array): void {
    const ctx = this.ctx;
    const prog = ctx.fallbackProgram;

    ctx.useProgram(prog);
    ctx.setUniform(prog, 'u_viewProjection', viewProj);

    for (const obj of level.objects) {
      if (!obj.active) continue;

      let color: Float32Array;
      let fill = false;

      switch (obj.type) {
        case 'exit':
          color = new Float32Array([1.0, 0.8, 0.0, 1.0]);
          break;
        case 'food':
          color = new Float32Array([1.0, 0.2, 0.2, 1.0]);
          fill = true;
          break;
        case 'killer':
          color = new Float32Array([0.53, 0.53, 0.53, 1.0]);
          fill = true;
          break;
        default:
          continue;
      }

      ctx.setUniform(prog, 'u_color', color);
      this.drawCircleFallback(obj.r, OBJECT_RADIUS, fill);
    }
  }

  private drawCircleFallback(center: Vec2, radius: number, fill: boolean): void {
    const gl = this.ctx.gl;
    const segments = 24;
    const verts = new Float32Array(segments * 2);

    for (let i = 0; i < segments; i++) {
      const angle = (i / segments) * Math.PI * 2;
      verts[i * 2] = center.x + Math.cos(angle) * radius;
      verts[i * 2 + 1] = center.y + Math.sin(angle) * radius;
    }

    const vao = gl.createVertexArray()!;
    gl.bindVertexArray(vao);
    const vbo = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, verts, gl.STREAM_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    if (fill) {
      gl.drawArrays(gl.TRIANGLE_FAN, 0, segments);
    } else {
      gl.drawArrays(gl.LINE_LOOP, 0, segments);
    }

    gl.bindVertexArray(null);
    gl.deleteBuffer(vbo);
    gl.deleteVertexArray(vao);
  }
}