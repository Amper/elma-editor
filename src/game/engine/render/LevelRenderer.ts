/**
 * Level renderer: polygon triangulation, tiled ground texture, sky parallax.
 *
 * Rendering convention (matching original Elma):
 *   - Polygon interiors = sky (the cavity where the bike rides)
 *   - Outside polygons  = ground (solid terrain)
 *
 * We use a stencil buffer to achieve this:
 *   1. Draw sky fullscreen (parallax background)
 *   2. Mark polygon interiors in stencil
 *   3. Draw ground only OUTSIDE polygon interiors (stencil test)
 */
import type { GLContext } from './GLContext';
import type { LevelData, Polygon } from '../level/Level';
import type { LgrData } from '../formats/LgrFormat';
import type { Camera } from '../game/Camera';

/** Pixel-to-meter conversion (matching original Elma: 48 pixels per meter) */
const PIXELS_TO_METERS = 1 / 48;

interface LevelMesh {
  vao: WebGLVertexArrayObject;
  indexCount: number;
}

interface GrassMesh {
  vao: WebGLVertexArrayObject;
  indexCount: number;
}

export class LevelRenderer {
  private ctx: GLContext;
  private groundMesh: LevelMesh | null = null;
  private groundFillMesh: LevelMesh | null = null;
  private grassMesh: GrassMesh | null = null;
  private groundTexture: WebGLTexture | null = null;
  private skyTexture: WebGLTexture | null = null;
  private grassTexture: WebGLTexture | null = null;
  private groundTextureSize = new Float32Array(2);
  private skyTextureSize = new Float32Array(2);
  private grassTextureSize = new Float32Array(2);
  private hasTextures = false;
  private hasGrassTexture = false;

  constructor(ctx: GLContext) {
    this.ctx = ctx;
  }

  /** Build static geometry from level data */
  buildLevel(level: LevelData): void {
    this.buildGroundMesh(level);
    this.buildGrassMesh(level);
    this.buildGroundFillQuad();
  }

  /** Load textures from LGR data */
  loadTextures(level: LevelData, lgr: LgrData): void {
    const gl = this.ctx.gl;

    // Load ground texture (foreground = solid terrain texture)
    const fgName = level.foregroundName.toLowerCase();
    const fgImage = lgr.textures.get(fgName);
    if (fgImage) {
      if (this.groundTexture) gl.deleteTexture(this.groundTexture);
      this.groundTexture = this.ctx.createTexture(
        fgImage.rgba, fgImage.width, fgImage.height,
        gl.REPEAT, gl.REPEAT
      );
      this.groundTextureSize[0] = fgImage.width * PIXELS_TO_METERS;
      this.groundTextureSize[1] = fgImage.height * PIXELS_TO_METERS;
    }

    // Load sky/background texture
    const bgName = level.backgroundName.toLowerCase();
    const bgImage = lgr.textures.get(bgName);
    if (bgImage) {
      if (this.skyTexture) gl.deleteTexture(this.skyTexture);
      this.skyTexture = this.ctx.createTexture(
        bgImage.rgba, bgImage.width, bgImage.height,
        gl.REPEAT, gl.REPEAT
      );
      this.skyTextureSize[0] = bgImage.width;
      this.skyTextureSize[1] = bgImage.height;
    }

    // Load qgrass texture (green grass fill, separate from ground)
    const grassImage = lgr.textures.get('qgrass');
    if (grassImage) {
      if (this.grassTexture) gl.deleteTexture(this.grassTexture);
      this.grassTexture = this.ctx.createTexture(
        grassImage.rgba, grassImage.width, grassImage.height,
        gl.REPEAT, gl.REPEAT
      );
      this.grassTextureSize[0] = grassImage.width * PIXELS_TO_METERS;
      this.grassTextureSize[1] = grassImage.height * PIXELS_TO_METERS;
      this.hasGrassTexture = true;
    }

    this.hasTextures = !!(this.groundTexture && this.skyTexture);
  }

  private buildGroundMesh(level: LevelData): void {
    const gl = this.ctx.gl;
    const allVertices: number[] = [];
    const allIndices: number[] = [];
    let vertexOffset = 0;

    for (const poly of level.polygons) {
      if (poly.isGrass) continue;
      const tris = earClipTriangulate(poly);
      if (!tris) continue;

      // Vertices in physics space (negate Y from level space)
      for (const v of poly.vertices) {
        allVertices.push(v.x, -v.y);
      }
      for (const idx of tris) {
        allIndices.push(idx + vertexOffset);
      }
      vertexOffset += poly.vertices.length;
    }

    if (allVertices.length === 0) return;

    const vao = gl.createVertexArray()!;
    gl.bindVertexArray(vao);

    const vbo = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(allVertices), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    const ibo = gl.createBuffer()!;
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(allIndices), gl.STATIC_DRAW);

    gl.bindVertexArray(null);
    this.groundMesh = { vao, indexCount: allIndices.length };
  }

  /** Build a large world-space quad for the ground fill pass */
  private buildGroundFillQuad(): void {
    const gl = this.ctx.gl;
    // Large quad covering a huge world area (Elma levels fit within this)
    const S = 500;
    const verts = new Float32Array([
      -S, -S,
      S, -S,
      S,  S,
      -S,  S,
    ]);
    const indices = new Uint16Array([0, 1, 2, 0, 2, 3]);

    const vao = gl.createVertexArray()!;
    gl.bindVertexArray(vao);

    const vbo = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, verts, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    const ibo = gl.createBuffer()!;
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);

    gl.bindVertexArray(null);
    this.groundFillMesh = { vao, indexCount: 6 };
  }

  /**
   * Build grass mesh by triangulating grass polygon interiors.
   * In the original Elma, QUP/QDOWN sprites add blade shapes along the upper
   * edge, but the qgrass texture fill covers the polygon interior area.
   * The polygon boundaries define exactly where grass appears.
   */
  private buildGrassMesh(level: LevelData): void {
    const gl = this.ctx.gl;
    const allVertices: number[] = [];
    const allIndices: number[] = [];
    let vertexOffset = 0;

    for (const poly of level.polygons) {
      if (!poly.isGrass) continue;
      const tris = earClipTriangulate(poly);
      if (!tris) continue;

      for (const v of poly.vertices) {
        allVertices.push(v.x, -v.y);
      }
      for (const idx of tris) {
        allIndices.push(idx + vertexOffset);
      }
      vertexOffset += poly.vertices.length;
    }

    if (allVertices.length === 0) return;

    const vao = gl.createVertexArray()!;
    gl.bindVertexArray(vao);

    const vbo = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(allVertices), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    const ibo = gl.createBuffer()!;
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(allIndices), gl.STATIC_DRAW);

    gl.bindVertexArray(null);
    this.grassMesh = { vao, indexCount: allIndices.length };
  }

  drawSky(camera: Camera, _pixelsPerMeter: number): void {
    const ctx = this.ctx;
    const gl = ctx.gl;

    if (!this.skyTexture) return;

    ctx.useProgram(ctx.skyProgram);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.skyTexture);
    ctx.setUniformInt(ctx.skyProgram, 'u_texture', 0);

    // Parallax: camera moves sky at half speed
    const parallaxFactor = 0.5;
    ctx.setUniform(ctx.skyProgram, 'u_cameraOffset', new Float32Array([
      camera.x * 48 * parallaxFactor,
      -camera.y * 48 * parallaxFactor,
    ]));
    ctx.setUniform(ctx.skyProgram, 'u_textureSize', this.skyTextureSize);
    ctx.setUniform(ctx.skyProgram, 'u_viewportSize', new Float32Array([ctx.viewWidth, ctx.viewHeight]));

    gl.bindVertexArray(ctx.fullscreenVAO);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.bindVertexArray(null);
  }

  drawGround(viewProj: Float32Array, showTextures = true): void {
    if (!this.groundMesh) return;

    if (showTextures && this.hasTextures && this.groundFillMesh) {
      this.drawGroundTextured(viewProj);
    } else {
      this.drawGroundFallback(viewProj);
    }
  }

  /** Textured ground using stencil buffer:
   *  1. Mark polygon interiors in stencil (these are SKY areas)
   *  2. Draw ground fill quad only OUTSIDE polygon interiors
   */
  private drawGroundTextured(viewProj: Float32Array): void {
    const ctx = this.ctx;
    const gl = ctx.gl;
    const prog = ctx.polygonProgram;

    ctx.useProgram(prog);
    ctx.setUniform(prog, 'u_viewProjection', viewProj);

    // Step 1: Mark polygon interiors in stencil buffer using even-odd rule.
    // INVERT makes overlapping polygons (internal ground) flip stencil back to 0.
    gl.enable(gl.STENCIL_TEST);
    gl.stencilFunc(gl.ALWAYS, 0, 0xFF);
    gl.stencilOp(gl.KEEP, gl.KEEP, gl.INVERT);
    gl.colorMask(false, false, false, false); // Don't write color

    // Draw polygon geometry to stencil only
    ctx.setUniform(prog, 'u_hasTexture', false);
    ctx.setUniform(prog, 'u_color', new Float32Array([0, 0, 0, 0]));

    gl.bindVertexArray(this.groundMesh!.vao);
    gl.drawElements(gl.TRIANGLES, this.groundMesh!.indexCount, gl.UNSIGNED_SHORT, 0);
    gl.bindVertexArray(null);

    // Step 2: Draw ground fill where stencil == 0 (outside sky, or inside internal polygons)
    gl.stencilFunc(gl.EQUAL, 0, 0xFF);
    gl.stencilOp(gl.KEEP, gl.KEEP, gl.KEEP);
    gl.colorMask(true, true, true, true);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.groundTexture!);
    ctx.setUniformInt(prog, 'u_texture', 0);
    ctx.setUniform(prog, 'u_textureSize', this.groundTextureSize);
    ctx.setUniform(prog, 'u_hasTexture', true);

    gl.bindVertexArray(this.groundFillMesh!.vao);
    gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0);
    gl.bindVertexArray(null);

    gl.disable(gl.STENCIL_TEST);
  }

  /** Fallback: fill ground with solid color using even-odd stencil (no LGR) */
  private drawGroundFallback(viewProj: Float32Array): void {
    const ctx = this.ctx;
    const gl = ctx.gl;
    const prog = ctx.polygonProgram;

    ctx.useProgram(prog);
    ctx.setUniform(prog, 'u_viewProjection', viewProj);

    // Step 1: Mark sky areas in stencil using even-odd rule
    gl.enable(gl.STENCIL_TEST);
    gl.stencilFunc(gl.ALWAYS, 0, 0xFF);
    gl.stencilOp(gl.KEEP, gl.KEEP, gl.INVERT);
    gl.colorMask(false, false, false, false);

    ctx.setUniform(prog, 'u_hasTexture', false);
    ctx.setUniform(prog, 'u_color', new Float32Array([0, 0, 0, 0]));

    gl.bindVertexArray(this.groundMesh!.vao);
    gl.drawElements(gl.TRIANGLES, this.groundMesh!.indexCount, gl.UNSIGNED_SHORT, 0);
    gl.bindVertexArray(null);

    // Step 2: Draw ground color where stencil == 0
    gl.stencilFunc(gl.EQUAL, 0, 0xFF);
    gl.stencilOp(gl.KEEP, gl.KEEP, gl.KEEP);
    gl.colorMask(true, true, true, true);

    ctx.setUniform(prog, 'u_color', new Float32Array([0.227, 0.227, 0.29, 1.0]));

    gl.bindVertexArray(this.groundFillMesh!.vao);
    gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0);
    gl.bindVertexArray(null);

    gl.disable(gl.STENCIL_TEST);
  }

  /**
   * Draw grass polygons clipped to ground areas only.
   * In the original Elma, grass is drawn with Clipping::Ground which prevents
   * it from appearing in sky areas. The stencil buffer from the ground pass
   * already marks sky (non-zero) vs ground (zero), so we reuse it here.
   */
  drawGrass(viewProj: Float32Array, showTextures = true): void {
    if (!this.grassMesh) return;

    const ctx = this.ctx;
    const gl = ctx.gl;
    const prog = ctx.polygonProgram;

    ctx.useProgram(prog);
    ctx.setUniform(prog, 'u_viewProjection', viewProj);

    if (showTextures && this.hasGrassTexture) {
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.grassTexture!);
      ctx.setUniformInt(prog, 'u_texture', 0);
      ctx.setUniform(prog, 'u_textureSize', this.grassTextureSize);
      ctx.setUniform(prog, 'u_hasTexture', true);
    } else if (showTextures && this.hasTextures) {
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.groundTexture!);
      ctx.setUniformInt(prog, 'u_texture', 0);
      ctx.setUniform(prog, 'u_textureSize', this.groundTextureSize);
      ctx.setUniform(prog, 'u_hasTexture', true);
    } else {
      ctx.setUniform(prog, 'u_hasTexture', false);
      ctx.setUniform(prog, 'u_color', new Float32Array([0.176, 0.416, 0.176, 1.0]));
    }

    // Clip grass to ground areas only (matching original Elma's Clipping::Ground).
    // The stencil buffer from drawGround still has: 0 = ground, non-zero = sky.
    gl.enable(gl.STENCIL_TEST);
    gl.stencilFunc(gl.EQUAL, 0, 0xFF);
    gl.stencilOp(gl.KEEP, gl.KEEP, gl.KEEP);

    gl.bindVertexArray(this.grassMesh.vao);
    gl.drawElements(gl.TRIANGLES, this.grassMesh.indexCount, gl.UNSIGNED_SHORT, 0);
    gl.bindVertexArray(null);

    gl.disable(gl.STENCIL_TEST);
  }

  /** Whether textures from LGR are loaded */
  get texturesLoaded(): boolean {
    return this.hasTextures;
  }

  destroy(): void {
    const gl = this.ctx.gl;
    if (this.groundTexture) gl.deleteTexture(this.groundTexture);
    if (this.skyTexture) gl.deleteTexture(this.skyTexture);
    if (this.grassTexture) gl.deleteTexture(this.grassTexture);
  }
}

// ── Ear-clipping polygon triangulation ──

function earClipTriangulate(poly: Polygon): number[] | null {
  const verts = poly.vertices;
  const n = verts.length;
  if (n < 3) return null;
  if (n === 3) return [0, 1, 2];

  // Build index list
  const indices: number[] = [];
  for (let i = 0; i < n; i++) indices.push(i);

  // Determine polygon winding (level space is Y-down, we need CCW in physics space)
  const area = signedArea(verts);

  const result: number[] = [];
  const remaining = [...indices];

  let safety = n * n;
  while (remaining.length > 3 && safety-- > 0) {
    let earFound = false;

    for (let i = 0; i < remaining.length; i++) {
      const prev = remaining[(i - 1 + remaining.length) % remaining.length]!;
      const curr = remaining[i]!;
      const next = remaining[(i + 1) % remaining.length]!;

      const ax = verts[prev]!.x, ay = verts[prev]!.y;
      const bx = verts[curr]!.x, by = verts[curr]!.y;
      const cx = verts[next]!.x, cy = verts[next]!.y;

      // Check if this is a convex vertex (ear candidate)
      const cross = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
      const isConvex = area > 0 ? cross > 0 : cross < 0;
      if (!isConvex) continue;

      // Check no other vertex is inside this triangle
      let containsOther = false;
      for (let j = 0; j < remaining.length; j++) {
        const idx = remaining[j]!;
        if (idx === prev || idx === curr || idx === next) continue;
        if (pointInTriangle(verts[idx]!.x, verts[idx]!.y, ax, ay, bx, by, cx, cy)) {
          containsOther = true;
          break;
        }
      }

      if (!containsOther) {
        result.push(prev, curr, next);
        remaining.splice(i, 1);
        earFound = true;
        break;
      }
    }

    if (!earFound) break;
  }

  // Add last triangle
  if (remaining.length === 3) {
    result.push(remaining[0]!, remaining[1]!, remaining[2]!);
  }

  return result.length >= 3 ? result : null;
}

function signedArea(verts: { x: number; y: number }[]): number {
  let area = 0;
  for (let i = 0; i < verts.length; i++) {
    const j = (i + 1) % verts.length;
    area += verts[i]!.x * verts[j]!.y;
    area -= verts[j]!.x * verts[i]!.y;
  }
  return area / 2;
}

function pointInTriangle(
  px: number, py: number,
  ax: number, ay: number,
  bx: number, by: number,
  cx: number, cy: number
): boolean {
  const d1 = (px - bx) * (ay - by) - (ax - bx) * (py - by);
  const d2 = (px - cx) * (by - cy) - (bx - cx) * (py - cy);
  const d3 = (px - ax) * (cy - ay) - (cx - ax) * (py - ay);
  const hasNeg = (d1 < 0) || (d2 < 0) || (d3 < 0);
  const hasPos = (d1 > 0) || (d2 > 0) || (d3 > 0);
  return !(hasNeg && hasPos);
}