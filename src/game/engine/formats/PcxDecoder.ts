/**
 * PCX image decoder for Elma LGR files.
 * Decodes 8-bit indexed PCX with RLE compression and VGA palette.
 */

export interface DecodedPcx {
  width: number;
  height: number;
  pixels: Uint8Array;       // 8-bit indexed pixel data
  palette: Uint8Array;      // 768 bytes (256 RGB triplets)
}

export interface DecodedImage {
  width: number;
  height: number;
  rgba: Uint8Array;
  transparentIndex: number;
}

/**
 * Decode a PCX file to indexed pixel data + palette.
 */
export function decodePcx(data: Uint8Array): DecodedPcx {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);

  // Validate header
  const manufacturerId = data[0];
  const versionNum = data[1];
  const encoding = data[2];
  const bitsPerPlane = data[3];

  if (manufacturerId !== 10) {
    throw new Error(`Invalid PCX: ManufactId=${manufacturerId}, expected 10`);
  }
  if (versionNum !== 5) {
    throw new Error(`Invalid PCX: VersionNum=${versionNum}, expected 5`);
  }
  if (encoding !== 1) {
    throw new Error(`Invalid PCX: Encoding=${encoding}, expected 1 (RLE)`);
  }
  if (bitsPerPlane !== 8) {
    throw new Error(`Invalid PCX: BitsPerPlane=${bitsPerPlane}, expected 8`);
  }

  const xMin = view.getInt16(4, true);
  const yMin = view.getInt16(6, true);
  const xMax = view.getInt16(8, true);
  const yMax = view.getInt16(10, true);
  const bytesPerScanLine = view.getUint16(66, true);

  const width = xMax - xMin + 1;
  const height = yMax - yMin + 1;

  if (width <= 0 || height <= 0) {
    throw new Error(`Invalid PCX dimensions: ${width}x${height}`);
  }

  // RLE decode from offset 128
  const pixels = new Uint8Array(width * height);
  let srcOffset = 128;
  let dstOffset = 0;

  for (let y = 0; y < height; y++) {
    let x = 0;
    while (x < bytesPerScanLine) {
      const byte = data[srcOffset++];
      let count: number;
      let value: number;

      if ((byte! & 0xC0) === 0xC0) {
        count = byte! & 0x3F;
        value = data[srcOffset++]!;
      } else {
        count = 1;
        value = byte!;
      }

      for (let i = 0; i < count; i++) {
        if (x < width) {
          pixels[dstOffset++] = value;
        }
        x++;
      }
    }
  }

  // Read 256-color palette from end of file (0x0C marker + 768 bytes)
  const palette = new Uint8Array(768);
  const paletteStart = data.byteLength - 769;
  if (paletteStart > 0 && data[paletteStart] === 0x0C) {
    palette.set(data.subarray(paletteStart + 1, paletteStart + 769));
  }

  return { width, height, pixels, palette };
}

/**
 * Convert indexed PCX to RGBA image data.
 * Top-left pixel's palette index is treated as transparent.
 */
export function pcxToRgba(pcx: DecodedPcx, palette?: Uint8Array): DecodedImage {
  const pal = palette ?? pcx.palette;
  const transparentIndex = pcx.pixels[0]!;
  const rgba = new Uint8Array(pcx.width * pcx.height * 4);

  for (let i = 0; i < pcx.width * pcx.height; i++) {
    const idx = pcx.pixels[i]!;
    const palOffset = idx * 3;
    const rgbaOffset = i * 4;
    rgba[rgbaOffset] = pal[palOffset]!;
    rgba[rgbaOffset + 1] = pal[palOffset + 1]!;
    rgba[rgbaOffset + 2] = pal[palOffset + 2]!;
    rgba[rgbaOffset + 3] = idx === transparentIndex ? 0 : 255;
  }

  return {
    width: pcx.width,
    height: pcx.height,
    rgba,
    transparentIndex,
  };
}

/**
 * Extract a rectangular sub-image from decoded PCX pixels.
 * Coords are in pixel space: (x1,y1) top-left, (x2,y2) bottom-right exclusive.
 */
export function extractSubImage(
  pcx: DecodedPcx,
  x1: number, y1: number,
  x2: number, y2: number,
  palette: Uint8Array,
  transparentIndex: number
): DecodedImage {
  const w = x2 - x1;
  const h = y2 - y1;
  const rgba = new Uint8Array(w * h * 4);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const srcIdx = (y1 + y) * pcx.width + (x1 + x);
      const idx = pcx.pixels[srcIdx]!;
      const dstOffset = (y * w + x) * 4;
      const palOffset = idx * 3;
      rgba[dstOffset] = palette[palOffset]!;
      rgba[dstOffset + 1] = palette[palOffset + 1]!;
      rgba[dstOffset + 2] = palette[palOffset + 2]!;
      rgba[dstOffset + 3] = idx === transparentIndex ? 0 : 255;
    }
  }

  return { width: w, height: h, rgba, transparentIndex };
}