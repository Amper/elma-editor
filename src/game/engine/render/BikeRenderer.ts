/**
 * Bike renderer: 14 bike parts as affine-transformed textured quads.
 * Ported from kibike() / kidoboz() / kitag() / kidobozkerek() in KIRAJ320.CPP.
 */
import { Vec2, circlesIntersection, rotate90deg, rotateMinus90deg } from '../core/Vec2';
import { WHEEL_BACKGROUND_RENDER_RADIUS, HEAD_RADIUS } from '../core/Constants';
import type { GLContext } from './GLContext';
import type { TextureAtlas, AtlasRegion } from './TextureAtlas';
import type { MotorState } from '../physics/MotorState';
import type { BikePartSet } from '../formats/LgrFormat';

/** Original coordinate system constants from KIRAJ320.CPP */
const Mx = 390;
const My = 420;
const malfa = 0.62;
const mmeret = 0.0045;

/** Bike body box coordinates for kitag() calls */
const BODY_BOXES: [number, number, number, number][] = [
  [3, 36, 147, 184],
  [32, 183, 147, 297],
  [146, 141, 273, 264],
  [272, 181, 353, 244],
];

interface BikeAtlasRegions {
  body: AtlasRegion[];
  wheel: AtlasRegion;
  susp1: AtlasRegion;
  susp2: AtlasRegion;
  head: AtlasRegion;
  thigh: AtlasRegion;
  leg: AtlasRegion;
  forearm: AtlasRegion;
  upperArm: AtlasRegion;
  torso: AtlasRegion;
}

export class BikeRenderer {
  private ctx: GLContext;
  private atlas: TextureAtlas | null = null;
  private regions: BikeAtlasRegions | null = null;
  private hasLgr = false;

  constructor(ctx: GLContext) {
    this.ctx = ctx;
  }

  loadBikeParts(bikeParts: BikePartSet, atlas: TextureAtlas): void {
    this.atlas = atlas;
    this.regions = {
      body: [
        atlas.add('bike_body0', bikeParts.body[0]!),
        atlas.add('bike_body1', bikeParts.body[1]!),
        atlas.add('bike_body2', bikeParts.body[2]!),
        atlas.add('bike_body3', bikeParts.body[3]!),
      ],
      wheel: atlas.add('bike_wheel', bikeParts.wheel),
      susp1: atlas.add('bike_susp1', bikeParts.susp1),
      susp2: atlas.add('bike_susp2', bikeParts.susp2),
      head: atlas.add('bike_head', bikeParts.head),
      thigh: atlas.add('bike_thigh', bikeParts.thigh),
      leg: atlas.add('bike_leg', bikeParts.leg),
      forearm: atlas.add('bike_forearm', bikeParts.forearm),
      upperArm: atlas.add('bike_upperarm', bikeParts.upperArm),
      torso: atlas.add('bike_torso', bikeParts.torso),
    };
    this.hasLgr = true;
  }

  draw(motor: MotorState, viewProj: Float32Array, showTextures = true): void {
    if (!showTextures || !this.hasLgr || !this.atlas?.texture || !this.regions) {
      this.drawFallback(motor, viewProj);
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

    this.drawBikeParts(motor);

    gl.disable(gl.BLEND);
  }

  private drawBikeParts(motor: MotorState): void {
    const regions = this.regions!;
    const flipped = motor.flippedBike;

    // Build coordinate system matching C++ kibike() exactly:
    // 1. Compute jobbra and fel from bike rotation
    // 2. If flipped, negate jobbra (but NOT fel) and swap wheels
    // 3. Compute Mi from (possibly negated) jobbra and original fel
    // 4. Compute Mj = rotate90deg(Mi), then negate Mj if flipped
    let jobbra = new Vec2(Math.cos(motor.bike.rotation), Math.sin(motor.bike.rotation));
    const fel = rotate90deg(jobbra);

    let leftWheel = motor.leftWheel;
    let rightWheel = motor.rightWheel;

    if (flipped) {
      jobbra = jobbra.scale(-1);
      leftWheel = motor.rightWheel;
      rightWheel = motor.leftWheel;
    }

    const Mi = jobbra.scale(mmeret * Math.cos(malfa)).add(fel.scale(mmeret * Math.sin(malfa)));
    let Mj = rotate90deg(Mi);
    if (flipped) {
      Mj = Mj.scale(-1);
    }
    const Mr = motor.bike.r;

    // 1. Rear wheel (behind layer)
    this.drawRotatedSquare(rightWheel.r, WHEEL_BACKGROUND_RENDER_RADIUS, rightWheel.rotation, regions.wheel, false);

    // 2. Front wheel (behind layer)
    this.drawRotatedSquare(leftWheel.r, WHEEL_BACKGROUND_RENDER_RADIUS, leftWheel.rotation, regions.wheel, false);

    // 3. Front suspension: left wheel to handlebar
    const handlebarPoint = Mi.scale(365 - Mx).add(Mj.scale(My - 292)).add(Mr);
    this.drawBox(leftWheel.r, handlebarPoint, 0.06, regions.susp1, 0.05, 0.03, false);

    // 4. Rear suspension: rear pivot to right wheel
    const rearPivot = Mi.scale(370 - Mx).add(Mj.scale(My - 520)).add(Mr);
    this.drawBox(rearPivot, rightWheel.r, 0.06, regions.susp2, 0.0, 0.1, false);

    // 5. Bike body parts (4 pieces) — kitag with +260 offset
    for (let i = 0; i < 4; i++) {
      this.drawBodyPart(Mi, Mj, Mr, BODY_BOXES[i]!, regions.body[i]!);
    }

    // Rider joint positions
    const bodyR = motor.bodyR;
    const hipPos = bodyR.add(Mi.scale(75)).add(Mj.scale(-47));
    const shoulderPos = bodyR.add(Mi.scale(47)).add(Mj.scale(65));
    const shoulderTorso = bodyR.add(Mi.scale(41)).add(Mj.scale(70));
    const footPos = Mi.scale(346 - Mx).add(Mj.scale(My - 514)).add(Mr);
    const handPos = handlebarPoint;

    // Knee: argument order depends on flip state (matching C++ exactly)
    let knee: Vec2;
    if (flipped) {
      knee = circlesIntersection(hipPos, footPos, 0.51, 0.51);
    } else {
      knee = circlesIntersection(footPos, hipPos, 0.51, 0.51);
    }

    // 6. Head — kidobozkerek with HEAD_RADIUS
    this.drawRotatedSquare(motor.headR, HEAD_RADIUS, motor.bike.rotation, regions.head, flipped);

    // Elbow: argument order depends on flip state
    let elbow: Vec2;
    if (flipped) {
      elbow = circlesIntersection(handPos, shoulderPos, 0.308 * 1.05, 0.328 * 1.05);
    } else {
      elbow = circlesIntersection(shoulderPos, handPos, 0.328 * 1.05, 0.308 * 1.05);
    }

    // 7. Thigh: knee to hip
    this.drawBox(knee, hipPos, 0.14, regions.thigh, 0.03, 0.1, flipped);

    // 8. Leg: foot to knee
    this.drawBox(footPos, knee, 0.21, regions.leg, 0.03, 0.03, flipped);

    // 9. Torso: hip to shoulder (torso variant)
    this.drawBox(hipPos, shoulderTorso, 0.2, regions.torso, 0.1, 0.05, flipped);

    // 10. Upper arm: elbow to shoulder (NOTE: !flipped for mirror)
    this.drawBox(elbow, shoulderPos, 0.11, regions.upperArm, 0.08, 0.1, !flipped);

    // 11. Forearm: hand to elbow
    this.drawBox(handPos, elbow, 0.076, regions.forearm, 0.08, 0.1, flipped);

    // 12. Deferred wheels (front layer)
    this.drawRotatedSquare(rightWheel.r, WHEEL_BACKGROUND_RENDER_RADIUS, rightWheel.rotation, regions.wheel, false);
    this.drawRotatedSquare(leftWheel.r, WHEEL_BACKGROUND_RENDER_RADIUS, leftWheel.rotation, regions.wheel, false);
  }

  /**
   * Matches C++ kitag() with the critical +260 pixel offset.
   * C++ formula: r = Mi*(x1+260-Mx) + Mj*(My-(y1+260)) + Mr
   *              u = Mi*(x2-x1), v = Mj*(y1-y2)
   * Converted to our shader: origin = r+v, extentU = u, extentV = -v
   */
  private drawBodyPart(Mi: Vec2, Mj: Vec2, Mr: Vec2, box: number[], region: AtlasRegion): void {
    const [x1, y1, x2, y2] = box as [number, number, number, number];
    const origin = Mi.scale(x1 + 260 - Mx).add(Mj.scale(My - 260 - y2)).add(Mr);
    const extentU = Mi.scale(x2 - x1);
    const extentV = Mj.scale(y2 - y1);
    this.drawSprite(origin, extentU, extentV, region);
  }

  /**
   * Matches C++ kidoboz() — draw image between two points with explicit width and overhangs.
   * C++ convention: draw_affine_pic(pic, pk, vLength, v2fel*2, corner)
   * Our convention: origin = corner + v2fel*2, extentU = vLength, extentV = -v2fel*2
   */
  private drawBox(a: Vec2, b: Vec2, halfWidth: number, region: AtlasRegion,
                  overA: number, overB: number, mirror: boolean): void {
    const dir = b.sub(a);
    const len = dir.length();
    if (len < 0.001) return;

    const ud = dir.scale(1 / len);

    // Extend endpoints (tulloga / tullogb)
    const aExt = a.sub(ud.scale(overA));
    const bExt = b.add(ud.scale(overB));
    const vLength = bExt.sub(aExt);

    // Half-width perpendicular vector
    let v2fel: Vec2;
    if (mirror) {
      v2fel = rotate90deg(ud).scale(halfWidth);
    } else {
      v2fel = rotateMinus90deg(ud).scale(halfWidth);
    }

    // Map from C++ draw_affine_pic to our V-flip sprite shader
    const origin = aExt.add(v2fel);
    const extentU = vLength;
    const extentV = v2fel.scale(-2);

    this.drawSprite(origin, extentU, extentV, region);
  }

  /**
   * Matches C++ kidobozkerek() — draw rotated square centered at a point.
   * Used for wheels and head.
   */
  private drawRotatedSquare(center: Vec2, radius: number, rotation: number,
                            region: AtlasRegion, mirror: boolean): void {
    const vfel = new Vec2(Math.cos(rotation) * radius, Math.sin(rotation) * radius);
    if (mirror) {
      this.drawBox(center.add(vfel), center.sub(vfel), radius, region, 0, 0, true);
    } else {
      this.drawBox(center.sub(vfel), center.add(vfel), radius, region, 0, 0, false);
    }
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

  /** Fallback wireframe bike (same as CanvasRenderer) */
  private drawFallback(motor: MotorState, viewProj: Float32Array): void {
    const ctx = this.ctx;
    const prog = ctx.fallbackProgram;

    ctx.useProgram(prog);
    ctx.setUniform(prog, 'u_viewProjection', viewProj);

    // Draw wheels as circle outlines
    this.drawCircle(motor.leftWheel.r, motor.leftWheel.radius, [0, 0.8, 0, 1]);
    this.drawCircle(motor.rightWheel.r, motor.rightWheel.radius, [0, 0.8, 0, 1]);

    // Draw bike frame lines
    ctx.setUniform(prog, 'u_color', new Float32Array([0.8, 0.8, 0.8, 1]));
    this.drawLine(motor.leftWheel.r, motor.bike.r);
    this.drawLine(motor.bike.r, motor.rightWheel.r);

    // Draw body
    ctx.setUniform(prog, 'u_color', new Float32Array([1.0, 0.67, 0, 1]));
    this.drawLine(motor.bike.r, motor.bodyR);

    // Draw head
    this.drawCircle(motor.headR, 0.238, [1.0, 0.8, 0.53, 1]);
  }

  private drawCircle(center: Vec2, radius: number, color: number[]): void {
    const ctx = this.ctx;
    const gl = ctx.gl;
    const prog = ctx.fallbackProgram;

    const segments = 24;
    const verts = new Float32Array(segments * 2);
    for (let i = 0; i < segments; i++) {
      const angle = (i / segments) * Math.PI * 2;
      verts[i * 2] = center.x + Math.cos(angle) * radius;
      verts[i * 2 + 1] = center.y + Math.sin(angle) * radius;
    }

    ctx.setUniform(prog, 'u_color', new Float32Array(color));

    const vao = gl.createVertexArray()!;
    gl.bindVertexArray(vao);
    const vbo = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, verts, gl.STREAM_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.LINE_LOOP, 0, segments);
    gl.bindVertexArray(null);
    gl.deleteBuffer(vbo);
    gl.deleteVertexArray(vao);
  }

  private drawLine(from: Vec2, to: Vec2): void {
    const ctx = this.ctx;
    const gl = ctx.gl;

    const verts = new Float32Array([from.x, from.y, to.x, to.y]);
    const vao = gl.createVertexArray()!;
    gl.bindVertexArray(vao);
    const vbo = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, verts, gl.STREAM_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.LINES, 0, 2);
    gl.bindVertexArray(null);
    gl.deleteBuffer(vbo);
    gl.deleteVertexArray(vao);
  }
}