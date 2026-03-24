/**
 * Shelf-packing texture atlas builder.
 * Packs multiple images into a single GPU texture for batched rendering.
 */
import type { GLContext } from './GLContext';
import type { DecodedImage } from '../formats/PcxDecoder';

export interface AtlasRegion {
  u0: number; v0: number;
  u1: number; v1: number;
}

interface Shelf {
  y: number;
  height: number;
  x: number; // Current x cursor
}

export class TextureAtlas {
  readonly width: number;
  readonly height: number;
  texture: WebGLTexture | null = null;
  private regions = new Map<string, AtlasRegion>();
  private rgba: Uint8Array;
  private shelves: Shelf[] = [];
  private nextShelfY = 0;

  constructor(width = 4096, height = 4096) {
    this.width = width;
    this.height = height;
    this.rgba = new Uint8Array(width * height * 4);
  }

  /**
   * Add an image to the atlas. Returns its UV region.
   */
  add(name: string, image: DecodedImage): AtlasRegion {
    const existing = this.regions.get(name);
    if (existing) return existing;

    const { width: imgW, height: imgH } = image;
    const placed = this.placeRect(imgW, imgH);
    if (!placed) {
      throw new Error(`Atlas full: cannot fit ${name} (${imgW}x${imgH})`);
    }

    const [px, py] = placed;

    // Copy image data into atlas
    for (let y = 0; y < imgH; y++) {
      const srcOff = y * imgW * 4;
      const dstOff = ((py + y) * this.width + px) * 4;
      this.rgba.set(image.rgba.subarray(srcOff, srcOff + imgW * 4), dstOff);
    }

    const region: AtlasRegion = {
      u0: px / this.width,
      v0: py / this.height,
      u1: (px + imgW) / this.width,
      v1: (py + imgH) / this.height,
    };
    this.regions.set(name, region);
    return region;
  }

  private placeRect(w: number, h: number): [number, number] | null {
    // Try to fit on an existing shelf
    for (const shelf of this.shelves) {
      if (shelf.height >= h && shelf.x + w <= this.width) {
        const x = shelf.x;
        shelf.x += w;
        return [x, shelf.y];
      }
    }
    // Create new shelf
    if (this.nextShelfY + h > this.height) return null;
    const shelf: Shelf = { y: this.nextShelfY, height: h, x: w };
    this.shelves.push(shelf);
    const result: [number, number] = [0, this.nextShelfY];
    this.nextShelfY += h;
    return result;
  }

  /** Get a region by name */
  get(name: string): AtlasRegion | undefined {
    return this.regions.get(name);
  }

  /** Upload the packed atlas to the GPU */
  upload(ctx: GLContext): void {
    if (this.texture) {
      ctx.gl.deleteTexture(this.texture);
    }
    this.texture = ctx.createTexture(this.rgba, this.width, this.height);
  }

  /** Sort images by height descending and add them all */
  addAll(images: Map<string, DecodedImage>): void {
    const sorted = [...images.entries()].sort(
      (a, b) => b[1].height - a[1].height
    );
    for (const [name, img] of sorted) {
      this.add(name, img);
    }
  }
}