/**
 * WebGL2 renderer - top-level orchestrator.
 * Replaces CanvasRenderer with GPU-accelerated rendering.
 */
import { GLContext } from './GLContext';
import { LevelRenderer } from './LevelRenderer';
import { BikeRenderer } from './BikeRenderer';
import { ObjectRenderer } from './ObjectRenderer';
import { PictureRenderer } from './PictureRenderer';
import { HUDRenderer } from './HUDRenderer';
import { TextureAtlas } from './TextureAtlas';
import type { GameState } from '../game/GameLoop';
import type { LgrData } from '../formats/LgrFormat';
import type { LevelData } from '../level/Level';

const PIXELS_PER_METER = 48;

export class WebGLRenderer {
  readonly glCtx: GLContext;
  readonly bikeRenderer: BikeRenderer;
  private levelRenderer: LevelRenderer;
  private objectRenderer: ObjectRenderer;
  private pictureRenderer: PictureRenderer;
  private hudRenderer: HUDRenderer;
  private atlas: TextureAtlas;
  private lgrLoaded = false;

  constructor(canvas: HTMLCanvasElement) {
    this.glCtx = new GLContext(canvas);
    this.levelRenderer = new LevelRenderer(this.glCtx);
    this.bikeRenderer = new BikeRenderer(this.glCtx);
    this.objectRenderer = new ObjectRenderer(this.glCtx);
    this.pictureRenderer = new PictureRenderer(this.glCtx);

    // HUD canvas needs a positioned parent container
    const parent = canvas.parentElement!;
    parent.style.position = 'relative';
    this.hudRenderer = new HUDRenderer(parent);

    this.atlas = new TextureAtlas();
  }

  resize(): void {
    this.glCtx.resize();
    this.hudRenderer.resize();
  }

  /** Build level geometry (call on level load) */
  buildLevel(level: LevelData): void {
    this.levelRenderer.buildLevel(level);
  }

  /** Load LGR graphics data */
  loadLgr(lgr: LgrData, level: LevelData): void {
    // Reset atlas
    this.atlas = new TextureAtlas();

    // Load bike parts into atlas
    this.bikeRenderer.loadBikeParts(lgr.bikeParts, this.atlas);

    // Load object animations into atlas
    this.objectRenderer.loadObjectAnims(lgr.objectAnims, this.atlas);

    // Load level pictures and masks into atlas
    this.pictureRenderer.loadPictures(lgr.pictures, this.atlas);
    this.pictureRenderer.loadMasks(lgr.masks, this.atlas);

    // Upload atlas to GPU
    this.atlas.upload(this.glCtx);

    // Load tiling textures (separate from atlas — need GL_REPEAT wrapping)
    this.pictureRenderer.loadTilingTextures(lgr.textures);

    // Load level textures (ground/sky separate from atlas)
    this.levelRenderer.loadTextures(level, lgr);

    this.lgrLoaded = true;
  }

  render(state: GameState, options?: { showGrass?: boolean; showPictures?: boolean; showTextures?: boolean; objectsAnimation?: boolean }): void {
    const gl = this.glCtx.gl;
    const cam = state.camera;

    // Build view-projection matrix
    const viewProj = this.glCtx.buildViewProjection(cam.x, cam.y, PIXELS_PER_METER * cam.zoom);

    // 1. Clear (color + stencil for ground/sky stencil pass)
    gl.clearColor(0.1, 0.1, 0.18, 1.0);
    gl.clearStencil(0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.STENCIL_BUFFER_BIT);

    const showGrass = options?.showGrass ?? true;
    const showTextures = options?.showTextures ?? true;
    const showPictures = options?.showPictures ?? true;

    // 2. Sky (parallax background)
    if (this.lgrLoaded && showTextures) {
      this.levelRenderer.drawSky(cam, PIXELS_PER_METER * cam.zoom);
    }

    // 3. Ground (textured or colored polygons)
    this.levelRenderer.drawGround(viewProj, showTextures);

    // 4. Grass (qgrass textured, clipped to ground)
    if (showGrass) {
      this.levelRenderer.drawGrass(viewProj, showTextures);
    }

    // 5. Pictures (level decoration sprites with clipping)
    this.pictureRenderer.draw(state.level, viewProj, showPictures, showTextures);

    // 6. Objects (animated sprites or colored circles)
    const objectsAnimation = options?.objectsAnimation ?? true;
    this.objectRenderer.draw(state.level, state.gameTime, viewProj, showTextures, objectsAnimation);

    // 7. Bike (textured parts or wireframe fallback)
    this.bikeRenderer.draw(state.motor, viewProj, showTextures);

    // 8. HUD (canvas2D overlay)
    this.hudRenderer.draw(state);
  }

  destroy(): void {
    this.levelRenderer.destroy();
    this.hudRenderer.destroy();
  }
}