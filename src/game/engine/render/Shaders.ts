/**
 * GLSL ES 3.0 shader source strings for the WebGL2 rendering pipeline.
 */

// ── Sky shader: full-screen quad with parallax scrolling ──

export const SKY_VERT = `#version 300 es
in vec2 a_position;
out vec2 v_uv;
void main() {
  v_uv = a_position * 0.5 + 0.5;
  gl_Position = vec4(a_position, 0.0, 1.0);
}
`;

export const SKY_FRAG = `#version 300 es
precision mediump float;
in vec2 v_uv;
uniform sampler2D u_texture;
uniform vec2 u_cameraOffset;
uniform vec2 u_textureSize;
uniform vec2 u_viewportSize;
out vec4 fragColor;
void main() {
  vec2 texCoord = (v_uv * u_viewportSize + u_cameraOffset) / u_textureSize;
  texCoord.y = 1.0 - texCoord.y;
  fragColor = texture(u_texture, texCoord);
}
`;

// ── Polygon shader: triangulated ground with tiled texture ──

export const POLYGON_VERT = `#version 300 es
in vec2 a_position;
uniform mat3 u_viewProjection;
out vec2 v_worldPos;
void main() {
  v_worldPos = a_position;
  vec3 pos = u_viewProjection * vec3(a_position, 1.0);
  gl_Position = vec4(pos.xy, 0.0, 1.0);
}
`;

export const POLYGON_FRAG = `#version 300 es
precision mediump float;
in vec2 v_worldPos;
uniform sampler2D u_texture;
uniform vec2 u_textureSize;
uniform bool u_hasTexture;
uniform vec4 u_color;
out vec4 fragColor;
void main() {
  if (u_hasTexture) {
    vec2 texCoord = v_worldPos / u_textureSize;
    texCoord.y = -texCoord.y;
    fragColor = texture(u_texture, texCoord);
  } else {
    fragColor = u_color;
  }
}
`;

// ── Sprite shader: textured quads with affine transform ──

export const SPRITE_VERT = `#version 300 es
in vec2 a_position;
uniform mat3 u_viewProjection;
uniform vec2 u_origin;
uniform vec2 u_extentU;
uniform vec2 u_extentV;
out vec2 v_uv;
void main() {
  // a_position is (0,0), (1,0), (0,1), (1,1) unit quad
  vec2 worldPos = u_origin + a_position.x * u_extentU + a_position.y * u_extentV;
  vec3 pos = u_viewProjection * vec3(worldPos, 1.0);
  gl_Position = vec4(pos.xy, 0.0, 1.0);
  v_uv = a_position;
}
`;

export const SPRITE_FRAG = `#version 300 es
precision mediump float;
in vec2 v_uv;
uniform sampler2D u_atlas;
uniform vec4 u_uvRect;
uniform float u_alpha;
out vec4 fragColor;
void main() {
  // Flip V: PCX row 0 is image-top stored at V=0 in GPU.
  // extentV points up in world, so v_uv.y=0 is world-bottom.
  // We want world-bottom → image-bottom (high V), world-top → image-top (low V).
  vec2 texCoord = u_uvRect.xy + vec2(v_uv.x, 1.0 - v_uv.y) * u_uvRect.zw;
  fragColor = texture(u_atlas, texCoord);
  if (fragColor.a < 0.01) discard;
  fragColor.a *= u_alpha;
}
`;

// ── Masked-texture sprite shader: tiling texture clipped by mask shape ──

export const MASK_SPRITE_VERT = `#version 300 es
in vec2 a_position;
uniform mat3 u_viewProjection;
uniform vec2 u_origin;
uniform vec2 u_extentU;
uniform vec2 u_extentV;
out vec2 v_uv;
out vec2 v_worldPos;
void main() {
  vec2 worldPos = u_origin + a_position.x * u_extentU + a_position.y * u_extentV;
  vec3 pos = u_viewProjection * vec3(worldPos, 1.0);
  gl_Position = vec4(pos.xy, 0.0, 1.0);
  v_uv = a_position;
  v_worldPos = worldPos;
}
`;

export const MASK_SPRITE_FRAG = `#version 300 es
precision mediump float;
in vec2 v_uv;
in vec2 v_worldPos;
uniform sampler2D u_maskAtlas;
uniform sampler2D u_texture;
uniform vec4 u_uvRect;
uniform vec2 u_textureSize;
out vec4 fragColor;
void main() {
  // Sample mask from atlas (same UV logic as sprite shader)
  vec2 maskUV = u_uvRect.xy + vec2(v_uv.x, 1.0 - v_uv.y) * u_uvRect.zw;
  vec4 maskColor = texture(u_maskAtlas, maskUV);
  if (maskColor.a < 0.01) discard;

  // Tile the texture in world space (same as polygon shader)
  vec2 texCoord = v_worldPos / u_textureSize;
  texCoord.y = -texCoord.y;
  fragColor = texture(u_texture, texCoord);
}
`;

// ── Fallback shader: colored primitives (no-LGR mode) ──

export const FALLBACK_VERT = `#version 300 es
in vec2 a_position;
uniform mat3 u_viewProjection;
void main() {
  vec3 pos = u_viewProjection * vec3(a_position, 1.0);
  gl_Position = vec4(pos.xy, 0.0, 1.0);
}
`;

export const FALLBACK_FRAG = `#version 300 es
precision mediump float;
uniform vec4 u_color;
uniform float u_alpha;
out vec4 fragColor;
void main() {
  fragColor = u_color;
  fragColor.a *= u_alpha;
}
`;