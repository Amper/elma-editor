/**
 * .lev binary parser - ported from level.cpp::from_file()
 *
 * Level file format (version 14):
 *   Header: "POT14" (5 bytes)
 *   Level ID checksum (2 bytes)
 *   Level ID (4 bytes)
 *   Integrity checksums (4 x float64)
 *   Level name (51 bytes, null-terminated)
 *   LGR name (16 bytes)
 *   Foreground texture name (10 bytes)
 *   Background texture name (10 bytes)
 *   Polygon count (float64, fractional encoding)
 *   Polygons...
 *   Object count (float64, fractional encoding)
 *   Objects...
 *   Sprite count (float64, fractional encoding)
 *   Sprites...
 *   Top-ten (encrypted)
 */
import { BinaryReader, decryptBytes } from '../core/BinaryReader';
import { Vec2 } from '../core/Vec2';
import type { LevelData, Polygon, GameObject, Sprite, TopTen, TopTenSet, ObjectType, ObjectProperty } from '../level/Level';

const TOP_TEN_HEADER = 6754362;
const TOP_TEN_FOOTER = 8674642;
const LEVEL_NAME_LENGTH = 50;
const LEVEL_NAME_LENGTH_OLD = 14;
const MAX_PLAYERNAME_LENGTH = 14;
const MAX_TIMES = 10;

function parseObjectType(value: number): ObjectType {
  switch (value) {
    case 1: return 'exit';
    case 2: return 'food';
    case 3: return 'killer';
    case 4: return 'start';
    default: throw new Error(`Unknown object type: ${value}`);
  }
}

function parseObjectProperty(value: number): ObjectProperty {
  switch (value) {
    case 0: return 'none';
    case 1: return 'gravity_up';
    case 2: return 'gravity_down';
    case 3: return 'gravity_left';
    case 4: return 'gravity_right';
    default: return 'none';
  }
}

function parseTopTen(reader: BinaryReader): TopTen {
  const timesCount = reader.readInt32();
  const times: number[] = [];
  for (let i = 0; i < MAX_TIMES; i++) {
    times.push(reader.readInt32());
  }
  const names1: string[] = [];
  for (let i = 0; i < MAX_TIMES; i++) {
    names1.push(reader.readString(MAX_PLAYERNAME_LENGTH + 1));
  }
  const names2: string[] = [];
  for (let i = 0; i < MAX_TIMES; i++) {
    names2.push(reader.readString(MAX_PLAYERNAME_LENGTH + 1));
  }
  return { timesCount, times, names1, names2 };
}

export function parseLevelFile(buffer: ArrayBuffer, isInternal = false): LevelData {
  const reader = new BinaryReader(buffer);

  // Read header
  const header = reader.readString(5);
  let version: number;

  if (isInternal) {
    if (header !== '@@^!@') {
      throw new Error('Invalid internal level header');
    }
    version = 14;
  } else {
    if (!header.startsWith('POT')) {
      throw new Error('Invalid .LEV file header');
    }
    version = (header.charCodeAt(3) - 48) * 10 + (header.charCodeAt(4) - 48);
    if (version !== 6 && version !== 14) {
      throw new Error(`Unsupported level version: ${version}`);
    }
  }

  // Level ID
  if (version === 14) {
    reader.readUint16(); // level ID checksum
  }
  const levelId = reader.readInt32();

  // Integrity checksums
  const integrityChecksum = reader.readFloat64();
  const integrityShareware = reader.readFloat64();
  if (integrityShareware + integrityChecksum < 9786.0 ||
      integrityShareware + integrityChecksum > 36546.0) {
    throw new Error('Corrupt .LEV file (shareware check)');
  }

  const integrityTopology = reader.readFloat64();
  const topologyErrors = integrityTopology + integrityChecksum > 20000.0;

  reader.readFloat64(); // integrity_locked

  // Level name
  const levelNameLength = version === 6 ? LEVEL_NAME_LENGTH_OLD : LEVEL_NAME_LENGTH;
  const levelName = reader.readString(levelNameLength + 1);

  // LGR name
  let lgrName = 'default';
  if (version === 14) {
    lgrName = reader.readString(16);
  }

  // Texture names
  let foregroundName = 'ground';
  let backgroundName = 'sky';
  if (version === 14) {
    foregroundName = reader.readString(10);
    backgroundName = reader.readString(10);
  }

  if (version === 6 && !isInternal) {
    reader.seek(100);
  }

  // Polygon count (encoded as double with fractional offset)
  const encryptedPolygonCount = reader.readFloat64();

  // For internal .leb files, object count comes before polygons
  let encryptedObjectCount = 0;
  if (isInternal) {
    encryptedObjectCount = reader.readFloat64();
  }

  const polygonCount = Math.floor(encryptedPolygonCount);
  const polygons: Polygon[] = [];

  for (let i = 0; i < polygonCount; i++) {
    let isGrass = false;
    if (version === 14) {
      isGrass = reader.readInt32() !== 0;
    }
    const vertexCount = reader.readInt32();
    const vertices: Vec2[] = [];
    for (let j = 0; j < vertexCount; j++) {
      const x = reader.readFloat64();
      const y = reader.readFloat64();
      vertices.push(new Vec2(x, y));
    }
    polygons.push({ vertices, isGrass });
  }

  // External files have object count after polygons
  if (!isInternal) {
    encryptedObjectCount = reader.readFloat64();
  }

  const objectCount = Math.floor(encryptedObjectCount);
  const objects: GameObject[] = [];

  for (let i = 0; i < objectCount; i++) {
    const x = reader.readFloat64();
    const y = reader.readFloat64();
    const typeVal = reader.readInt32();

    let property: ObjectProperty = 'none';
    let animation = 0;
    if (version === 14) {
      property = parseObjectProperty(reader.readInt32());
      animation = reader.readInt32();
    }

    objects.push({
      r: new Vec2(x, y),
      type: parseObjectType(typeVal),
      property,
      animation: Math.max(0, Math.min(8, animation)),
      active: true,
      floatingPhase: 0,
    });
  }

  // Sprites (version 14 only)
  const sprites: Sprite[] = [];
  if (version === 14) {
    const encryptedSpriteCount = reader.readFloat64();
    const spriteCount = Math.floor(encryptedSpriteCount);

    for (let i = 0; i < spriteCount; i++) {
      const pictureName = reader.readString(10);
      const maskName = reader.readString(10);
      const textureName = reader.readString(10);
      const x = reader.readFloat64();
      const y = reader.readFloat64();
      const distance = reader.readInt32();
      const clipping = reader.readInt32();

      sprites.push({
        r: new Vec2(x, y),
        pictureName,
        maskName,
        textureName,
        distance,
        clipping,
      });
    }
  }

  // Top-ten (optional, external levels only)
  let topTens: TopTenSet = {
    single: { timesCount: 0, times: [], names1: [], names2: [] },
    multi: { timesCount: 0, times: [], names1: [], names2: [] },
  };

  if (!isInternal && reader.remaining >= 8) {
    const magicHeader = reader.readInt32();
    if (magicHeader === TOP_TEN_HEADER) {
      // Read encrypted top-ten data
      const topTenSize = 2 * (4 + MAX_TIMES * 4 + MAX_TIMES * (MAX_PLAYERNAME_LENGTH + 1) * 2);
      if (reader.remaining >= topTenSize + 4) {
        const encryptedData = reader.readBytes(topTenSize);
        const decryptedData = decryptBytes(encryptedData);
        const topTenReader = new BinaryReader(decryptedData.buffer as ArrayBuffer);

        const single = parseTopTen(topTenReader);
        const multi = parseTopTen(topTenReader);
        topTens = { single, multi };

        const magicFooter = reader.readInt32();
        if (magicFooter !== TOP_TEN_FOOTER) {
          // Invalid footer - reset top tens
          topTens = {
            single: { timesCount: 0, times: [], names1: [], names2: [] },
            multi: { timesCount: 0, times: [], names1: [], names2: [] },
          };
        }
      }
    }
  }

  return {
    levelId,
    levelName,
    lgrName,
    foregroundName,
    backgroundName,
    polygons,
    objects,
    sprites,
    topTens,
    topologyErrors,
  };
}

/** Calculate level checksum matching the original C++ implementation */
export function levelChecksum(level: LevelData): number {
  let sum = 0;
  for (const poly of level.polygons) {
    for (const v of poly.vertices) {
      sum += v.x;
      sum += v.y;
    }
  }
  for (const obj of level.objects) {
    sum += obj.r.x;
    sum += obj.r.y;
    const typeVal = obj.type === 'exit' ? 1 : obj.type === 'food' ? 2 : obj.type === 'killer' ? 3 : 4;
    sum += typeVal;
  }
  for (const spr of level.sprites) {
    sum += spr.r.x;
    sum += spr.r.y;
  }
  return 3247.764325643 * sum;
}