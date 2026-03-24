/**
 * WebGL2 context wrapper: shader compilation, buffer/texture creation, resize.
 */
import {
  SKY_VERT, SKY_FRAG,
  POLYGON_VERT, POLYGON_FRAG,
  SPRITE_VERT, SPRITE_FRAG,
  MASK_SPRITE_VERT, MASK_SPRITE_FRAG,
  FALLBACK_VERT, FALLBACK_FRAG,
} from './Shaders';

export interface ShaderProgram {
  program: WebGLProgram;
  uniforms: Map<string, WebGLUniformLocation>;
  attribs: Map<string, number>;
}

export class GLContext {
  readonly gl: WebGL2RenderingContext;
  readonly canvas: HTMLCanvasElement;

  // Shader programs
  skyProgram!: ShaderProgram;
  polygonProgram!: ShaderProgram;
  spriteProgram!: ShaderProgram;
  maskSpriteProgram!: ShaderProgram;
  fallbackProgram!: ShaderProgram;

  // Shared geometry
  quadVAO!: WebGLVertexArrayObject;
  quadVBO!: WebGLBuffer;

  // Full-screen quad for sky
  fullscreenVAO!: WebGLVertexArrayObject;

  viewWidth = 0;
  viewHeight = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const gl = canvas.getContext('webgl2', {
      alpha: false,
      antialias: false,
      premultipliedAlpha: false,
      stencil: true,
    });
    if (!gl) throw new Error('WebGL2 not supported');
    this.gl = gl;

    this.initShaders();
    this.initGeometry();
  }

  private initShaders(): void {
    this.skyProgram = this.createProgram(SKY_VERT, SKY_FRAG,
      ['u_texture', 'u_cameraOffset', 'u_textureSize', 'u_viewportSize'],
      ['a_position']);
    this.polygonProgram = this.createProgram(POLYGON_VERT, POLYGON_FRAG,
      ['u_viewProjection', 'u_texture', 'u_textureSize', 'u_hasTexture', 'u_color'],
      ['a_position']);
    this.spriteProgram = this.createProgram(SPRITE_VERT, SPRITE_FRAG,
      ['u_viewProjection', 'u_atlas', 'u_origin', 'u_extentU', 'u_extentV', 'u_uvRect', 'u_alpha'],
      ['a_position']);
    this.maskSpriteProgram = this.createProgram(MASK_SPRITE_VERT, MASK_SPRITE_FRAG,
      ['u_viewProjection', 'u_maskAtlas', 'u_texture', 'u_origin', 'u_extentU', 'u_extentV', 'u_uvRect', 'u_textureSize'],
      ['a_position']);
    this.fallbackProgram = this.createProgram(FALLBACK_VERT, FALLBACK_FRAG,
      ['u_viewProjection', 'u_color', 'u_alpha'],
      ['a_position']);
  }

  private initGeometry(): void {
    const gl = this.gl;

    // Unit quad (0,0)-(1,1) for sprites
    const quadData = new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]);
    this.quadVBO = gl.createBuffer()!;
    this.quadVAO = gl.createVertexArray()!;
    gl.bindVertexArray(this.quadVAO);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadVBO);
    gl.bufferData(gl.ARRAY_BUFFER, quadData, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);

    // Fullscreen quad (-1,-1)-(1,1) for sky
    const fsData = new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]);
    const fsVBO = gl.createBuffer()!;
    this.fullscreenVAO = gl.createVertexArray()!;
    gl.bindVertexArray(this.fullscreenVAO);
    gl.bindBuffer(gl.ARRAY_BUFFER, fsVBO);
    gl.bufferData(gl.ARRAY_BUFFER, fsData, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
  }

  private createProgram(
    vertSrc: string,
    fragSrc: string,
    uniformNames: string[],
    attribNames: string[]
  ): ShaderProgram {
    const gl = this.gl;
    const vert = this.compileShader(gl.VERTEX_SHADER, vertSrc);
    const frag = this.compileShader(gl.FRAGMENT_SHADER, fragSrc);

    const program = gl.createProgram()!;
    gl.attachShader(program, vert);
    gl.attachShader(program, frag);

    // Bind attrib locations before linking
    for (let i = 0; i < attribNames.length; i++) {
      gl.bindAttribLocation(program, i, attribNames[i]!);
    }

    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error(`Shader link error: ${gl.getProgramInfoLog(program)}`);
    }

    gl.deleteShader(vert);
    gl.deleteShader(frag);

    const uniforms = new Map<string, WebGLUniformLocation>();
    for (const name of uniformNames) {
      const loc = gl.getUniformLocation(program, name);
      if (loc !== null) uniforms.set(name, loc);
    }

    const attribs = new Map<string, number>();
    for (const name of attribNames) {
      attribs.set(name, gl.getAttribLocation(program, name));
    }

    return { program, uniforms, attribs };
  }

  private compileShader(type: number, src: string): WebGLShader {
    const gl = this.gl;
    const shader = gl.createShader(type)!;
    gl.shaderSource(shader, src);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const info = gl.getShaderInfoLog(shader);
      gl.deleteShader(shader);
      throw new Error(`Shader compile error: ${info}`);
    }
    return shader;
  }

  resize(): void {
    const dpr = window.devicePixelRatio || 1;
    const w = this.canvas.clientWidth * dpr;
    const h = this.canvas.clientHeight * dpr;
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    this.viewWidth = this.canvas.clientWidth;
    this.viewHeight = this.canvas.clientHeight;
    this.gl.viewport(0, 0, this.canvas.width, this.canvas.height);
  }

  /**
   * Build a 2D view-projection matrix (column-major mat3).
   * Maps world coords (Y-up) to clip space.
   */
  buildViewProjection(camX: number, camY: number, pixelsPerMeter: number): Float32Array {
    const sx = 2 * pixelsPerMeter / this.viewWidth;
    const sy = 2 * pixelsPerMeter / this.viewHeight;
    const tx = -camX * sx;
    const ty = -camY * sy;
    // Column-major mat3
    return new Float32Array([
      sx, 0, 0,
      0, sy, 0,
      tx, ty, 1,
    ]);
  }

  createTexture(
    rgba: Uint8Array,
    width: number,
    height: number,
    wrapS: number = this.gl.CLAMP_TO_EDGE,
    wrapT: number = this.gl.CLAMP_TO_EDGE
  ): WebGLTexture {
    const gl = this.gl;
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, rgba);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrapS);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrapT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    return tex;
  }

  createBuffer(data: Float32Array | Uint16Array, usage: number = this.gl.STATIC_DRAW): WebGLBuffer {
    const gl = this.gl;
    const buf = gl.createBuffer()!;
    const target = data instanceof Uint16Array ? gl.ELEMENT_ARRAY_BUFFER : gl.ARRAY_BUFFER;
    gl.bindBuffer(target, buf);
    gl.bufferData(target, data, usage);
    return buf;
  }

  useProgram(prog: ShaderProgram): void {
    this.gl.useProgram(prog.program);
  }

  setUniform(prog: ShaderProgram, name: string, value: number | Float32Array | boolean): void {
    const loc = prog.uniforms.get(name);
    if (!loc) return;
    const gl = this.gl;
    if (typeof value === 'boolean') {
      gl.uniform1i(loc, value ? 1 : 0);
    } else if (typeof value === 'number') {
      gl.uniform1f(loc, value);
    } else if (value.length === 2) {
      gl.uniform2fv(loc, value);
    } else if (value.length === 4) {
      gl.uniform4fv(loc, value);
    } else if (value.length === 9) {
      gl.uniformMatrix3fv(loc, false, value);
    }
  }

  setUniformInt(prog: ShaderProgram, name: string, value: number): void {
    const loc = prog.uniforms.get(name);
    if (loc) this.gl.uniform1i(loc, value);
  }
}