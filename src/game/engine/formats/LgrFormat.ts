/**
 * LGR graphics archive parser.
 * Reads PCX entries, categorizes assets, chops bike sprites.
 *
 * Binary format (LGR12):
 *   "LGR12" (5 bytes)
 *   pcx_count (int32)
 *   unknown (int32) - possibly expected PCX count
 *   lst_count (int32)
 *   --- pictures.lst (column-oriented) ---
 *   lst_count * name (10 bytes each)
 *   lst_count * picture_type (int32 each) - 100=picture, 101=texture
 *   lst_count * distance (int32 each)
 *   lst_count * clipping (int32 each)
 *   lst_count * transparency (int32 each)
 *   --- PCX entries ---
 *   pcx_count * { name(20 bytes) + data_size(int32) + data(data_size bytes) }
 *   end_magic (int32) = 187565543
 */
import { BinaryReader } from '../core/BinaryReader';
import { decodePcx, pcxToRgba, extractSubImage, type DecodedPcx, type DecodedImage } from './PcxDecoder';

/** Bike body box coordinates for chopping q1bike.pcx */
const BIKE_BOXES: [number, number, number, number][] = [
  [3, 36, 147, 184],
  [32, 183, 147, 297],
  [146, 141, 273, 264],
  [272, 181, 353, 244],
];

/** Known bike part filenames (without .pcx, lowercase) */
const BIKE_PART_NAMES = [
  'q1body', 'q1thigh', 'q1leg', 'q1wheel',
  'q1susp1', 'q1susp2', 'q1forarm', 'q1up_arm', 'q1head',
];

/** Object animation sprite filenames (without .pcx, lowercase) */
const OBJECT_ANIM_NAMES = [
  'qfood1', 'qfood2', 'qfood3', 'qfood4', 'qfood5',
  'qfood6', 'qfood7', 'qfood8', 'qfood9',
  'qkiller', 'qexit',
];

export interface BikePartSet {
  body: DecodedImage[];  // 4 chopped body parts from q1bike.pcx
  wheel: DecodedImage;
  susp1: DecodedImage;
  susp2: DecodedImage;
  head: DecodedImage;
  thigh: DecodedImage;
  leg: DecodedImage;
  forearm: DecodedImage;
  upperArm: DecodedImage;
  torso: DecodedImage;   // Rider's body/torso from q1body.pcx
}

export interface ObjectAnimations {
  foodSets: DecodedImage[][];  // Separate animation sets per qfood (qfood1..qfood9)
  killer: DecodedImage[];      // Animation frames for killer
  exit: DecodedImage[];        // Animation frames for exit
}

export interface GrassSprite {
  image: DecodedImage;
  isUp: boolean;  // QUP = slopes up, QDOWN = slopes down
}

export interface LgrData {
  bikeParts: BikePartSet;
  objectAnims: ObjectAnimations;
  textures: Map<string, DecodedImage>;  // Tiled textures (for ground/sky)
  pictures: Map<string, DecodedImage>;  // Picture sprites
  masks: Map<string, DecodedImage>;     // Mask shapes (type 102)
  palette: Uint8Array;                  // Master palette from q1bike.pcx
  grassSprites: GrassSprite[];          // QUP/QDOWN grass edge sprites
}

interface PcxEntry {
  name: string;
  data: Uint8Array;
}

/**
 * Parse an LGR binary file.
 */
export function parseLgrFile(buffer: ArrayBuffer): LgrData {
  const reader = new BinaryReader(buffer);

  // Read magic: "LGR12" or "LGR13"
  const magic = reader.readString(5);
  const isLgr13 = magic === 'LGR13';
  if (magic !== 'LGR12' && magic !== 'LGR13') {
    throw new Error(`Invalid LGR magic: "${magic}"`);
  }

  const pcxCount = reader.readInt32();
  reader.readInt32(); // Unknown field (expected PCX count?)
  const lstCount = reader.readInt32();

  // ── Read pictures.lst (column-oriented) ──
  // Column 1: names (10 bytes each)
  const lstNames: string[] = [];
  for (let i = 0; i < lstCount; i++) {
    lstNames.push(reader.readString(10).toLowerCase());
  }
  // Column 2: picture types (int32 each) - 100=picture, 101=texture
  const lstTypes: number[] = [];
  for (let i = 0; i < lstCount; i++) {
    lstTypes.push(reader.readInt32());
  }
  // Column 3: distances (int32 each)
  reader.skip(lstCount * 4);
  // Column 4: clipping (int32 each)
  reader.skip(lstCount * 4);
  // Column 5: transparency (int32 each)
  reader.skip(lstCount * 4);

  // Build type lookup map
  const pictureListTypes = new Map<string, number>();
  for (let i = 0; i < lstCount; i++) {
    pictureListTypes.set(lstNames[i]!, lstTypes[i]!);
  }

  // ── Read PCX entries ──
  const entries: PcxEntry[] = [];
  for (let i = 0; i < pcxCount; i++) {
    const name = reader.readString(20).toLowerCase().replace('.pcx', '');
    if (isLgr13) {
      reader.skip(4); // target_w(i16) + target_h(i16)
    }
    const size = reader.readInt32();
    const data = reader.readBytes(size);
    entries.push({ name, data });
  }

  // Verify end magic
  if (reader.remaining >= 4) {
    const endMagic = reader.readInt32();
    if (endMagic !== 187565543) {
      console.warn(`LGR end magic mismatch: ${endMagic} (expected 187565543)`);
    }
  }

  // ── Decode all PCX entries ──
  const decodedPcx = new Map<string, DecodedPcx>();
  for (const entry of entries) {
    try {
      decodedPcx.set(entry.name, decodePcx(entry.data));
    } catch (e) {
      console.warn(`Failed to decode PCX: ${entry.name}`, e);
    }
  }

  // Get master palette from q1bike.pcx
  const bikePcx = decodedPcx.get('q1bike');
  if (!bikePcx) {
    throw new Error('LGR missing q1bike.pcx');
  }
  const palette = bikePcx.palette;

  // Chop bike body parts from q1bike.pcx
  const transparentIndex = bikePcx.pixels[0]!;
  const bodyParts: DecodedImage[] = BIKE_BOXES.map(([x1, y1, x2, y2]) =>
    extractSubImage(bikePcx, x1, y1, x2, y2, palette, transparentIndex)
  );

  // Decode bike part images
  function decodeBikePart(name: string): DecodedImage {
    const pcx = decodedPcx.get(name);
    if (!pcx) throw new Error(`LGR missing ${name}.pcx`);
    return pcxToRgba(pcx, palette);
  }

  const bikeParts: BikePartSet = {
    body: bodyParts,
    wheel: decodeBikePart('q1wheel'),
    susp1: decodeBikePart('q1susp1'),
    susp2: decodeBikePart('q1susp2'),
    head: decodeBikePart('q1head'),
    thigh: decodeBikePart('q1thigh'),
    leg: decodeBikePart('q1leg'),
    forearm: decodeBikePart('q1forarm'),
    upperArm: decodeBikePart('q1up_arm'),
    torso: decodeBikePart('q1body'),
  };

  // ── Decode object animation sprites ──
  const objectAnims: ObjectAnimations = {
    foodSets: [],
    killer: [],
    exit: [],
  };

  for (const animName of OBJECT_ANIM_NAMES) {
    const pcx = decodedPcx.get(animName);
    if (!pcx) continue;

    const img = pcxToRgba(pcx, palette);

    // Animation: frame_count = width / height (square frames)
    const frameSize = img.height;
    const frameCount = Math.max(1, Math.floor(img.width / frameSize));
    const frames: DecodedImage[] = [];

    for (let f = 0; f < frameCount; f++) {
      const frameRgba = new Uint8Array(frameSize * frameSize * 4);
      for (let y = 0; y < frameSize; y++) {
        const srcRow = y * img.width * 4 + f * frameSize * 4;
        const dstRow = y * frameSize * 4;
        frameRgba.set(img.rgba.subarray(srcRow, srcRow + frameSize * 4), dstRow);
      }
      frames.push({
        width: frameSize,
        height: frameSize,
        rgba: frameRgba,
        transparentIndex: img.transparentIndex,
      });
    }

    if (animName.startsWith('qfood')) {
      // Each qfood PCX is a separate animation set (different rotation directions)
      objectAnims.foodSets.push(frames);
    } else if (animName === 'qkiller') {
      objectAnims.killer = frames;
    } else if (animName === 'qexit') {
      objectAnims.exit = frames;
    }
  }

  // ── Decode QUP/QDOWN grass sprites ──
  const grassSprites: GrassSprite[] = [];

  // ── Decode textures and pictures ──
  const textures = new Map<string, DecodedImage>();
  const pictures = new Map<string, DecodedImage>();
  const masks = new Map<string, DecodedImage>();

  for (const entry of entries) {
    const name = entry.name;
    // Skip already-processed special images
    if (name === 'q1bike' || BIKE_PART_NAMES.includes(name) || OBJECT_ANIM_NAMES.includes(name)) {
      continue;
    }
    // Skip Q2 (multiplayer) bike parts
    if (name.startsWith('q2')) continue;
    if (name === 'qframe') continue;

    const pcx = decodedPcx.get(name);
    if (!pcx) continue;

    // QUP/QDOWN: grass edge sprites (not in PICTURES.LST)
    if (name.startsWith('qup_')) {
      grassSprites.push({ image: pcxToRgba(pcx, palette), isUp: true });
      continue;
    }
    if (name.startsWith('qdown_')) {
      grassSprites.push({ image: pcxToRgba(pcx, palette), isUp: false });
      continue;
    }

    // QGRASS: special texture not in PICTURES.LST (green grass fill)
    if (name === 'qgrass') {
      textures.set(name, pcxToRgba(pcx, palette));
      continue;
    }

    const picType = pictureListTypes.get(name);
    // 101 = texture (tiling), 100 = picture (sprite), 102 = mask (shape)
    if (picType === 101) {
      const img = pcxToRgba(pcx, palette);
      // No vertical flip: shaders handle Y-coordinate mapping.
      // No horizontal tiling: GL_REPEAT handles texture wrapping.
      textures.set(name, img);
    } else if (picType === 100) {
      const img = pcxToRgba(pcx, palette);
      pictures.set(name, img);
    } else if (picType === 102) {
      const img = pcxToRgba(pcx, palette);
      masks.set(name, img);
    }
    // Unknown types are skipped
  }

  return { bikeParts, objectAnims, textures, pictures, masks, palette, grassSprites };
}