/**
 * Picture renderer: level decoration sprites (background/foreground images).
 * In the original Elma, pictures are placed in levels with position, clipping
 * mode (ground/sky/unclipped), and distance for z-ordering.
 * Ground-clipped pictures only render in ground areas, sky-clipped only in sky.
 *
 * Also renders texture-mask sprites: a tiling texture clipped by a mask shape.
 */
import type { GLContext } from './GLContext';
import type { TextureAtlas, AtlasRegion } from './TextureAtlas';
import type { DecodedImage } from '../formats/PcxDecoder';
import type { LevelData } from '../level/Level';

/** Pixels to meters conversion (48 pixels per meter in Elma) */
const PX_TO_M = 1 / 48;

export class PictureRenderer {
  private ctx: GLContext;
  private atlas: TextureAtlas | null = null;
  private regions = new Map<string, AtlasRegion>();
  private picSizes = new Map<string, { w: number; h: number }>();
  private hasLgr = false;

  /** Mask regions in the atlas (keyed by mask name). */
  private maskRegions = new Map<string, AtlasRegion>();
  private maskSizes = new Map<string, { w: number; h: number }>();

  /** Tiling textures as separate GL textures with GL_REPEAT wrapping. */
  private tilingTextures = new Map<string, { glTex: WebGLTexture; w: number; h: number }>();

  constructor(ctx: GLContext) {
    this.ctx = ctx;
  }

  loadPictures(pictures: Map<string, DecodedImage>, atlas: TextureAtlas): void {
    this.atlas = atlas;
    this.regions.clear();
    this.picSizes.clear();

    for (const [name, img] of pictures) {
      const region = atlas.add(`pic_${name}`, img);
      this.regions.set(name, region);
      this.picSizes.set(name, { w: img.width, h: img.height });
    }

    this.hasLgr = true;
  }

  /** Load mask shapes (type 102) into the shared atlas. */
  loadMasks(masks: Map<string, DecodedImage>, atlas: TextureAtlas): void {
    this.maskRegions.clear();
    this.maskSizes.clear();

    for (const [name, img] of masks) {
      const region = atlas.add(`mask_${name}`, img);
      this.maskRegions.set(name, region);
      this.maskSizes.set(name, { w: img.width, h: img.height });
    }
  }

  /** Create separate GL textures for tiling textures (need GL_REPEAT wrapping). */
  loadTilingTextures(textures: Map<string, DecodedImage>): void {
    const gl = this.ctx.gl;

    // Clean up old textures
    for (const entry of this.tilingTextures.values()) {
      gl.deleteTexture(entry.glTex);
    }
    this.tilingTextures.clear();

    for (const [name, img] of textures) {
      // Force fully opaque (textures have no transparency)
      const opaque = new Uint8Array(img.rgba.length);
      opaque.set(img.rgba);
      for (let i = 3; i < opaque.length; i += 4) {
        opaque[i] = 255;
      }

      const glTex = this.ctx.createTexture(opaque, img.width, img.height, gl.REPEAT, gl.REPEAT);
      this.tilingTextures.set(name, { glTex, w: img.width, h: img.height });
    }
  }

  /**
   * Draw level pictures/sprites with clipping support.
   * Clipping modes match the original Elma:
   *   0 = Unclipped (render everywhere)
   *   1 = Ground only (stencil == 0)
   *   2 = Sky only (stencil != 0)
   * The stencil buffer from the ground pass is reused.
   */
  draw(level: LevelData, viewProj: Float32Array, showPictures = true, showTextures = true): void {
    if (!this.hasLgr || !this.atlas?.texture) return;
    if (level.sprites.length === 0) return;

    const ctx = this.ctx;
    const gl = ctx.gl;

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    // Sort by distance (lower distance = further back = render first)
    const sorted = [...level.sprites].sort((a, b) => a.distance - b.distance);

    // Separate regular pictures from texture-mask sprites
    const regularSprites = sorted.filter((s) => !s.textureName || !s.maskName);
    const maskSprites = sorted.filter((s) => s.textureName && s.maskName);

    // ── Draw regular pictures with sprite shader (skipped when showPictures is off) ──
    if (showPictures && regularSprites.length > 0) {
      ctx.useProgram(ctx.spriteProgram);
      ctx.setUniform(ctx.spriteProgram, 'u_viewProjection', viewProj);
      ctx.setUniform(ctx.spriteProgram, 'u_alpha', 1.0);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.atlas.texture);
      ctx.setUniformInt(ctx.spriteProgram, 'u_atlas', 0);

      for (const sprite of regularSprites) {
        const region = this.regions.get(sprite.pictureName.toLowerCase());
        if (!region) continue;
        const size = this.picSizes.get(sprite.pictureName.toLowerCase());
        if (!size) continue;

        this.applyClipping(gl, sprite.clipping);

        const wMeters = size.w * PX_TO_M;
        const hMeters = size.h * PX_TO_M;
        const originX = sprite.r.x;
        const originY = -sprite.r.y - hMeters;

        this.drawSprite(originX, originY, wMeters, hMeters, region);
      }
    }

    // ── Draw texture-mask sprites with mask shader (skipped when showTextures is off) ──
    if (showTextures && maskSprites.length > 0) {
      const prog = ctx.maskSpriteProgram;
      ctx.useProgram(prog);
      ctx.setUniform(prog, 'u_viewProjection', viewProj);

      // Bind mask atlas to TEXTURE0
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.atlas.texture);
      ctx.setUniformInt(prog, 'u_maskAtlas', 0);

      for (const sprite of maskSprites) {
        const maskName = sprite.maskName.toLowerCase();
        const texName = sprite.textureName.toLowerCase();

        const maskRegion = this.maskRegions.get(maskName);
        const maskSize = this.maskSizes.get(maskName);
        const tilingTex = this.tilingTextures.get(texName);
        if (!maskRegion || !maskSize || !tilingTex) continue;

        this.applyClipping(gl, sprite.clipping);

        // Bind tiling texture to TEXTURE1
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, tilingTex.glTex);
        ctx.setUniformInt(prog, 'u_texture', 1);

        // Texture size in world meters for tiling
        ctx.setUniform(prog, 'u_textureSize', new Float32Array([
          tilingTex.w * PX_TO_M,
          tilingTex.h * PX_TO_M,
        ]));

        const wMeters = maskSize.w * PX_TO_M;
        const hMeters = maskSize.h * PX_TO_M;
        const originX = sprite.r.x;
        const originY = -sprite.r.y - hMeters;

        // Set quad uniforms and draw
        ctx.setUniform(prog, 'u_origin', new Float32Array([originX, originY]));
        ctx.setUniform(prog, 'u_extentU', new Float32Array([wMeters, 0]));
        ctx.setUniform(prog, 'u_extentV', new Float32Array([0, hMeters]));
        ctx.setUniform(prog, 'u_uvRect', new Float32Array([
          maskRegion.u0, maskRegion.v0,
          maskRegion.u1 - maskRegion.u0, maskRegion.v1 - maskRegion.v0,
        ]));

        gl.bindVertexArray(ctx.quadVAO);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        gl.bindVertexArray(null);
      }

      // Restore active texture to TEXTURE0
      gl.activeTexture(gl.TEXTURE0);
    }

    gl.disable(gl.STENCIL_TEST);
    gl.disable(gl.BLEND);
  }

  private applyClipping(gl: WebGL2RenderingContext, clipping: number): void {
    if (clipping === 1) {
      gl.enable(gl.STENCIL_TEST);
      gl.stencilFunc(gl.EQUAL, 0, 0xFF);
      gl.stencilOp(gl.KEEP, gl.KEEP, gl.KEEP);
    } else if (clipping === 2) {
      gl.enable(gl.STENCIL_TEST);
      gl.stencilFunc(gl.NOTEQUAL, 0, 0xFF);
      gl.stencilOp(gl.KEEP, gl.KEEP, gl.KEEP);
    } else {
      gl.disable(gl.STENCIL_TEST);
    }
  }

  private drawSprite(
    ox: number, oy: number,
    w: number, h: number,
    region: AtlasRegion
  ): void {
    const ctx = this.ctx;
    const prog = ctx.spriteProgram;

    ctx.setUniform(prog, 'u_origin', new Float32Array([ox, oy]));
    ctx.setUniform(prog, 'u_extentU', new Float32Array([w, 0]));
    ctx.setUniform(prog, 'u_extentV', new Float32Array([0, h]));
    ctx.setUniform(prog, 'u_uvRect', new Float32Array([
      region.u0, region.v0,
      region.u1 - region.u0, region.v1 - region.v0,
    ]));

    const gl = ctx.gl;
    gl.bindVertexArray(ctx.quadVAO);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.bindVertexArray(null);
  }
}
