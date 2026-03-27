/**
 * LGR loading, caching, and Canvas 2D asset creation for the editor.
 * Reuses parseLgrFile() from the game engine.
 */
import { parseLgrFile, type LgrData } from '@/game/engine/formats/LgrFormat';
import type { DecodedImage } from '@/game/engine/formats/PcxDecoder';
import { preRenderBikePreview, BIKE_PREVIEW_SIZE } from './renderBikePreview';

/** Each texture pixel = 1/48 world units (matching game's PIXELS_PER_METER). */
export const TEXTURE_SCALE = 1 / 48;

export { BIKE_PREVIEW_SIZE };

export interface LgrEditorAssets {
  texturePatterns: Map<string, CanvasPattern>;
  sprites: {
    food: ImageBitmap | null;
    killer: ImageBitmap | null;
    exit: ImageBitmap | null;
  };
  bikeSprite: ImageBitmap | null;
  /** Picture sprites from the LGR, keyed by name. Each has bitmap + world size. */
  pictures: Map<string, { bitmap: ImageBitmap; worldW: number; worldH: number }>;
  /** Mask shapes from the LGR (type 102), keyed by name. */
  masks: Map<string, { bitmap: ImageBitmap; worldW: number; worldH: number }>;
}

let cachedAssets: LgrEditorAssets | null = null;
let loading = false;
let lgrDataPromise: Promise<LgrData> | null = null;

/**
 * Fetch and parse the LGR file, returning cached LgrData.
 * Used by GameOverlay for test mode.
 */
export function loadLgrData(): Promise<LgrData> {
  if (!lgrDataPromise) {
    lgrDataPromise = fetch('/lgr/Default.lgr')
      .then((res) => {
        if (!res.ok) throw new Error(`LGR fetch failed: ${res.status}`);
        return res.arrayBuffer();
      })
      .then((buf) => parseLgrFile(buf));
  }
  return lgrDataPromise;
}

/** Convert DecodedImage to ImageData, keeping original alpha (for sprites). */
function decodedImageToImageData(img: DecodedImage): ImageData {
  return new ImageData(new Uint8ClampedArray(img.rgba.buffer, img.rgba.byteOffset, img.rgba.byteLength), img.width, img.height);
}

/** Convert DecodedImage to fully opaque ImageData (for textures — no transparency). */
function decodedImageToOpaqueImageData(img: DecodedImage): ImageData {
  const opaque = new Uint8ClampedArray(img.rgba.length);
  opaque.set(img.rgba);
  // Force all alpha to 255
  for (let i = 3; i < opaque.length; i += 4) {
    opaque[i] = 255;
  }
  return new ImageData(opaque, img.width, img.height);
}

async function buildAssets(lgr: LgrData): Promise<LgrEditorAssets> {
  // Create an offscreen context for building patterns
  const oc = new OffscreenCanvas(1, 1);
  const octx = oc.getContext('2d')!;

  // Convert all textures to tiling CanvasPatterns (fully opaque — no transparency for textures)
  const texturePatterns = new Map<string, CanvasPattern>();
  for (const [name, img] of lgr.textures) {
    const bitmap = await createImageBitmap(decodedImageToOpaqueImageData(img));
    const pattern = octx.createPattern(bitmap, 'repeat');
    if (pattern) {
      texturePatterns.set(name, pattern);
    }
  }

  // Convert first frame of object animations to ImageBitmap
  async function firstFrame(frames: DecodedImage[]): Promise<ImageBitmap | null> {
    if (frames.length === 0) return null;
    return createImageBitmap(decodedImageToImageData(frames[0]!));
  }

  const sprites = {
    food: await firstFrame(lgr.objectAnims.foodSets[0] ?? []),
    killer: await firstFrame(lgr.objectAnims.killer),
    exit: await firstFrame(lgr.objectAnims.exit),
  };

  // Pre-render bike at rest pose for start object preview
  let bikeSprite: ImageBitmap | null = null;
  try {
    bikeSprite = await preRenderBikePreview(lgr.bikeParts, lgr.palette);
  } catch (err) {
    console.warn('Failed to pre-render bike preview:', err);
  }

  // Convert LGR pictures to ImageBitmaps with world sizes
  const pictures = new Map<string, { bitmap: ImageBitmap; worldW: number; worldH: number }>();
  for (const [name, img] of lgr.pictures) {
    const bitmap = await createImageBitmap(decodedImageToImageData(img));
    pictures.set(name, {
      bitmap,
      worldW: img.width / 48,
      worldH: img.height / 48,
    });
  }

  // Convert LGR masks (type 102) to ImageBitmaps with world sizes
  const masks = new Map<string, { bitmap: ImageBitmap; worldW: number; worldH: number }>();
  for (const [name, img] of lgr.masks) {
    const bitmap = await createImageBitmap(decodedImageToImageData(img));
    masks.set(name, {
      bitmap,
      worldW: img.width / 48,
      worldH: img.height / 48,
    });
  }

  return { texturePatterns, sprites, bikeSprite, pictures, masks };
}

/**
 * Switch to a different LGR by URL.
 * Invalidates the cache, downloads, parses, and rebuilds all editor assets.
 */
export async function switchLgr(url: string): Promise<void> {
  cachedAssets = null;
  lgrDataPromise = null;
  loading = true;

  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`LGR fetch failed: ${res.status}`);
    const buf = await res.arrayBuffer();
    const lgr = parseLgrFile(buf);
    lgrDataPromise = Promise.resolve(lgr);
    cachedAssets = await buildAssets(lgr);
  } finally {
    loading = false;
  }
}

/** Fire-and-forget LGR loader. Call once at editor mount. */
export function loadEditorLgr(): void {
  if (cachedAssets || loading) return;
  loading = true;

  loadLgrData()
    .then((lgr) => buildAssets(lgr))
    .then((assets) => {
      cachedAssets = assets;
    })
    .catch((err) => {
      console.warn('Failed to load editor LGR:', err);
    })
    .finally(() => {
      loading = false;
    });
}

/** Returns cached LGR assets, or null if not yet loaded. */
export function getEditorLgr(): LgrEditorAssets | null {
  return cachedAssets;
}
