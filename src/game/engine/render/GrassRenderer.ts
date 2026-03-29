/**
 * Grass edge sprite renderer: places QUP/QDOWN sprites along grass polygon edges.
 *
 * The algorithm (from recplayer/original Elma):
 *   1. For each grass polygon, find the "top edge" path from leftmost to rightmost vertex
 *   2. Walk along this edge in pixel space (48px/meter), selecting the best-fitting
 *      QUP or QDOWN sprite at each step based on slope matching
 *   3. Render the qgrass texture clipped by sprite border shapes
 *   4. Render placed sprites as alpha-blended quads on top
 */
import type { GLContext } from './GLContext';
import type { TextureAtlas, AtlasRegion } from './TextureAtlas';
import type { GrassSprite } from '../formats/LgrFormat';
import type { LevelData, Polygon } from '../level/Level';

const SCALE = 48; // pixels per meter (matching original Elma)
const BASELINE = 41; // baseline offset within grass sprites where ground line sits
const PX_TO_M = 1 / SCALE;

interface GrassSpriteInfo {
  region: AtlasRegion;
  width: number;   // pixels
  height: number;  // pixels
  isUp: boolean;
  borders: number[];  // per-column first non-transparent row
}

interface GrassPlacement {
  x: number;        // physics-space X (same as level X)
  y: number;        // physics-space Y (bottom of sprite, Y-up)
  spriteIdx: number; // index into allSprites
  wMeters: number;
  hMeters: number;
}

export class GrassRenderer {
  private ctx: GLContext;
  private allSprites: GrassSpriteInfo[] = [];
  private upIndices: number[] = [];
  private downIndices: number[] = [];
  private placements: GrassPlacement[] = [];
  private atlasRef: TextureAtlas | null = null;

  // qgrass fill mesh: triangulated border shapes
  private grassFillVAO: WebGLVertexArrayObject | null = null;
  private grassFillIndexCount = 0;
  private grassTexture: WebGLTexture | null = null;
  private grassTextureSize = new Float32Array(2);

  constructor(ctx: GLContext) {
    this.ctx = ctx;
  }

  loadGrassSprites(sprites: GrassSprite[], atlas: TextureAtlas): void {
    this.atlasRef = atlas;
    this.allSprites = [];
    this.upIndices = [];
    this.downIndices = [];

    for (let i = 0; i < sprites.length; i++) {
      const s = sprites[i]!;
      const region = atlas.add(`grass_${s.isUp ? 'up' : 'down'}_${i}`, s.image);
      this.allSprites.push({
        region,
        width: s.image.width,
        height: s.image.height,
        isUp: s.isUp,
        borders: s.borders,
      });
      if (s.isUp) {
        this.upIndices.push(i);
      } else {
        this.downIndices.push(i);
      }
    }
  }

  /** Load the qgrass tiling texture for the fill beneath blade sprites */
  loadGrassTexture(image: { rgba: Uint8Array; width: number; height: number } | undefined): void {
    if (!image) return;
    const gl = this.ctx.gl;
    if (this.grassTexture) gl.deleteTexture(this.grassTexture);
    this.grassTexture = this.ctx.createTexture(
      image.rgba, image.width, image.height,
      gl.REPEAT, gl.REPEAT,
    );
    this.grassTextureSize[0] = image.width * PX_TO_M;
    this.grassTextureSize[1] = image.height * PX_TO_M;
  }

  computePlacements(level: LevelData): void {
    this.placements = [];

    if (this.allSprites.length === 0) return;
    if (this.upIndices.length === 0 && this.downIndices.length === 0) return;

    for (const poly of level.polygons) {
      if (!poly.isGrass) continue;
      if (poly.vertices.length < 3) continue;
      this.computeGrassForPolygon(poly);
    }

    this.buildGrassFillMesh();
  }

  private computeGrassForPolygon(poly: Polygon): void {
    const verts = poly.vertices;
    const n = verts.length;

    // Step 1: Find leftmost and rightmost vertices by X
    let minX = Infinity, maxX = -Infinity;
    let minXi = 0, maxXi = 0;
    for (let z = 0; z < n; z++) {
      const v = verts[z]!;
      if (v.x < minX) { minX = v.x; minXi = z; }
      if (v.x > maxX) { maxX = v.x; maxXi = z; }
    }

    if (maxX - minX < PX_TO_M) return; // polygon too narrow

    // Step 2: Choose traversal direction
    let maxW = 0;
    for (let z = minXi; z % n !== maxXi; z++) {
      maxW = Math.max(maxW, Math.abs(verts[z % n]!.x - verts[(z + 1) % n]!.x));
    }

    let dir = -1;
    for (let z = n + minXi; z % n !== maxXi; z--) {
      const w = Math.abs(verts[z % n]!.x - verts[((z - 1) % n + n) % n]!.x);
      if (w > maxW) {
        maxW = w;
        dir = 1;
      }
    }

    // Step 3: yAt(x) interpolation along chosen path
    const yAt = (x: number): number | undefined => {
      for (let z = n + minXi; ; z += dir) {
        const zi = ((z % n) + n) % n;
        if (zi === maxXi) break;
        const ni = (((z + dir) % n) + n) % n;
        const from = verts[zi]!;
        const to = verts[ni]!;
        if (from.x <= x && x < to.x) {
          const m = (to.y - from.y) / (to.x - from.x);
          return m * (x - from.x) + from.y;
        }
      }
      return undefined;
    };

    // Step 4: Sprite placement loop in pixel space
    let curX = verts[minXi]!.x * SCALE;
    let curY = verts[minXi]!.y * SCALE;
    const maxXpx = maxX * SCALE;

    while (curX < maxXpx) {
      let bestDist = Infinity;
      let bestIdx = -1;

      for (const idx of this.upIndices) {
        const s = this.allSprites[idx]!;
        if (curX + s.width >= maxXpx) continue;
        const nextY = yAt((curX + s.width) / SCALE);
        if (nextY === undefined) continue;
        const dist = Math.abs(nextY * SCALE - (curY - (s.height - BASELINE)));
        if (dist < bestDist) {
          bestDist = dist;
          bestIdx = idx;
        }
      }

      for (const idx of this.downIndices) {
        const s = this.allSprites[idx]!;
        if (curX + s.width >= maxXpx) continue;
        const nextY = yAt((curX + s.width) / SCALE);
        if (nextY === undefined) continue;
        const dist = Math.abs(nextY * SCALE - (curY + (s.height - BASELINE)));
        if (dist < bestDist) {
          bestDist = dist;
          bestIdx = idx;
        }
      }

      if (bestIdx < 0) {
        curX++;
        continue;
      }

      const spr = this.allSprites[bestIdx]!;
      const fall = (spr.height - BASELINE) * (spr.isUp ? -1 : 1);
      const fcx = Math.floor(curX);
      const fcyTop = Math.floor(curY) - Math.ceil((spr.height - fall) / 2);

      this.placements.push({
        x: fcx * PX_TO_M,
        y: -(fcyTop * PX_TO_M) - spr.height * PX_TO_M,
        spriteIdx: bestIdx,
        wMeters: spr.width * PX_TO_M,
        hMeters: spr.height * PX_TO_M,
      });

      curX += spr.width;
      curY += fall;
    }
  }

  /**
   * Build a triangle mesh for the qgrass fill area.
   * For each sprite placement, the fill covers the transparent area ABOVE the
   * blade tips — from the sprite top down to the border line (first opaque row).
   * This matches the recplayer's clip path which fills the space between sky
   * boundary and blade tops with qgrass texture.
   */
  private buildGrassFillMesh(): void {
    const gl = this.ctx.gl;
    const allVerts: number[] = [];
    const allIndices: number[] = [];
    let vertOffset = 0;

    for (const p of this.placements) {
      const spr = this.allSprites[p.spriteIdx]!;
      const borders = spr.borders;
      const sprW = spr.width;

      const topY = p.y + p.hMeters; // sprite top in physics space (Y-up)
      const leftX = p.x;

      const cols = Math.min(borders.length, sprW);
      if (cols < 2) continue;

      // Sample borders at reduced resolution to limit vertex count
      const step = Math.max(1, Math.floor(cols / 32));

      const startVert = vertOffset;
      for (let c = 0; c <= cols; c += step) {
        const ci = Math.min(c, cols - 1);
        const borderRow = borders[ci]!;

        const wx = leftX + (c / SCALE);
        // Border position: top of sprite minus border rows (going down in physics Y-up)
        const borderY = topY - (borderRow * PX_TO_M);

        // Top vertex: at sprite top (could extend further with margin)
        allVerts.push(wx, topY);
        // Bottom vertex: at border line (where blade art starts)
        allVerts.push(wx, borderY);
        vertOffset += 2;
      }

      // Generate triangles
      const numCols = Math.floor((vertOffset - startVert) / 2);
      for (let i = 0; i < numCols - 1; i++) {
        const tl = startVert + i * 2;
        const bl = tl + 1;
        const tr = tl + 2;
        const br = tl + 3;
        allIndices.push(tl, bl, tr);
        allIndices.push(tr, bl, br);
      }
    }

    if (allVerts.length === 0) return;

    if (this.grassFillVAO) {
      gl.deleteVertexArray(this.grassFillVAO);
    }

    const vao = gl.createVertexArray()!;
    gl.bindVertexArray(vao);

    const vbo = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(allVerts), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    const ibo = gl.createBuffer()!;
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint32Array(allIndices), gl.STATIC_DRAW);

    gl.bindVertexArray(null);
    this.grassFillVAO = vao;
    this.grassFillIndexCount = allIndices.length;
  }

  draw(viewProj: Float32Array): void {
    if (this.placements.length === 0) return;
    if (!this.atlasRef?.texture) return;

    const ctx = this.ctx;
    const gl = ctx.gl;

    // Clip to ground areas only (stencil from ground pass: 0 = ground)
    gl.enable(gl.STENCIL_TEST);
    gl.stencilFunc(gl.EQUAL, 0, 0xFF);
    gl.stencilOp(gl.KEEP, gl.KEEP, gl.KEEP);

    // Pass 1: Draw qgrass fill beneath the blades
    if (this.grassFillVAO && this.grassFillIndexCount > 0 && this.grassTexture) {
      const fillProg = ctx.polygonProgram;
      ctx.useProgram(fillProg);
      ctx.setUniform(fillProg, 'u_viewProjection', viewProj);
      ctx.setUniform(fillProg, 'u_hasTexture', true);

      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.grassTexture);
      ctx.setUniformInt(fillProg, 'u_texture', 0);
      ctx.setUniform(fillProg, 'u_textureSize', this.grassTextureSize);

      gl.bindVertexArray(this.grassFillVAO);
      gl.drawElements(gl.TRIANGLES, this.grassFillIndexCount, gl.UNSIGNED_INT, 0);
      gl.bindVertexArray(null);
    }

    // Pass 2: Draw grass blade sprites on top
    const prog = ctx.spriteProgram;
    ctx.useProgram(prog);
    ctx.setUniform(prog, 'u_viewProjection', viewProj);
    ctx.setUniform(prog, 'u_alpha', 1.0);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.atlasRef.texture);
    ctx.setUniformInt(prog, 'u_atlas', 0);

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    for (const p of this.placements) {
      const spr = this.allSprites[p.spriteIdx]!;

      ctx.setUniform(prog, 'u_origin', new Float32Array([p.x, p.y]));
      ctx.setUniform(prog, 'u_extentU', new Float32Array([p.wMeters, 0]));
      ctx.setUniform(prog, 'u_extentV', new Float32Array([0, p.hMeters]));
      ctx.setUniform(prog, 'u_uvRect', new Float32Array([
        spr.region.u0, spr.region.v0,
        spr.region.u1 - spr.region.u0, spr.region.v1 - spr.region.v0,
      ]));

      gl.bindVertexArray(ctx.quadVAO);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      gl.bindVertexArray(null);
    }

    gl.disable(gl.STENCIL_TEST);
    gl.disable(gl.BLEND);
  }
}
