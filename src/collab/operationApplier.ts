import { Level, Polygon, Position, ElmaObject, Picture, ObjectType } from 'elmajs';
import type { Operation } from './operations';
import { generateId } from '@/utils/generateId';

/**
 * Shallow-clone a Level so zundo detects a new reference.
 * Deep-clones all mutable arrays (polygons, objects, pictures).
 */
function cloneLevel(level: Level): Level {
  const clone = Object.assign(
    Object.create(Object.getPrototypeOf(level) as object),
    level,
  ) as Level;
  clone.polygons = level.polygons.map((p) => {
    const cp = new Polygon();
    cp.id = p.id;
    cp.grass = p.grass;
    cp.vertices = p.vertices.map((v) => new Position(v.x, v.y));
    return cp;
  });
  clone.objects = level.objects.map((o) => {
    const co = new ElmaObject();
    co.id = o.id;
    co.position = new Position(o.position.x, o.position.y);
    co.type = o.type;
    co.gravity = o.gravity;
    co.animation = o.animation;
    return co;
  });
  clone.pictures = level.pictures.map((p) => {
    const cp = new Picture();
    cp.id = p.id;
    cp.name = p.name;
    cp.texture = p.texture;
    cp.mask = p.mask;
    cp.position = new Position(p.position.x, p.position.y);
    cp.distance = p.distance;
    cp.clip = p.clip;
    return cp;
  });
  return clone;
}

function findPolyIdx(level: Level, id: string): number {
  for (let i = 0; i < level.polygons.length; i++) {
    if (level.polygons[i]!.id === id) return i;
  }
  return -1;
}

function findObjIdx(level: Level, id: string): number {
  for (let i = 0; i < level.objects.length; i++) {
    if (level.objects[i]!.id === id) return i;
  }
  return -1;
}

function findPicIdx(level: Level, id: string): number {
  for (let i = 0; i < level.pictures.length; i++) {
    if (level.pictures[i]!.id === id) return i;
  }
  return -1;
}

/**
 * Apply an operation to a level, returning a new Level instance.
 * Handles missing IDs gracefully (skips, doesn't crash).
 */
export function applyOperation(level: Level, op: Operation): Level {
  const clone = cloneLevel(level);

  switch (op.type) {
    case 'addPolygon': {
      const poly = new Polygon();
      poly.id = op.id;
      poly.grass = op.grass;
      poly.vertices = op.vertices.map((v) => new Position(v.x, v.y));
      clone.polygons.push(poly);
      break;
    }

    case 'addPolygons': {
      for (const d of op.polygons) {
        const poly = new Polygon();
        poly.id = d.id;
        poly.grass = d.grass;
        poly.vertices = d.vertices.map((v) => new Position(v.x, v.y));
        clone.polygons.push(poly);
      }
      break;
    }

    case 'removePolygons': {
      const idSet = new Set(op.ids);
      clone.polygons = clone.polygons.filter((p) => !idSet.has(p.id));
      break;
    }

    case 'setPolygonGrass': {
      const poly = clone.polygons.find((p) => p.id === op.id);
      if (poly) poly.grass = op.grass;
      break;
    }

    case 'setPolygonsGrass': {
      const idSet = new Set(op.ids);
      for (const poly of clone.polygons) {
        if (idSet.has(poly.id)) poly.grass = op.grass;
      }
      break;
    }

    case 'moveVertices': {
      for (const m of op.moves) {
        const idx = findPolyIdx(clone, m.polyId);
        if (idx < 0) continue;
        const vert = clone.polygons[idx]!.vertices[m.vertIdx];
        if (vert) {
          vert.x = m.newPos.x;
          vert.y = m.newPos.y;
        }
      }
      break;
    }

    case 'insertVertex': {
      const idx = findPolyIdx(clone, op.polyId);
      if (idx >= 0) {
        clone.polygons[idx]!.vertices.splice(op.afterVertIdx, 0, new Position(op.pos.x, op.pos.y));
      }
      break;
    }

    case 'removeVertex': {
      const idx = findPolyIdx(clone, op.polyId);
      if (idx >= 0) {
        const poly = clone.polygons[idx]!;
        if (poly.vertices.length > 3) {
          poly.vertices.splice(op.vertIdx, 1);
        }
      }
      break;
    }

    case 'removeVertices': {
      for (const entry of op.verts) {
        const idx = findPolyIdx(clone, entry.polyId);
        if (idx < 0) continue;
        const poly = clone.polygons[idx]!;
        const remaining = poly.vertices.length - entry.vertIndices.length;
        if (remaining < 3) continue;
        const sorted = [...entry.vertIndices].sort((a, b) => b - a);
        for (const vi of sorted) {
          poly.vertices.splice(vi, 1);
        }
      }
      break;
    }

    case 'addObject': {
      // Prevent duplicate Start
      if (op.objectType === ObjectType.Start && clone.objects.some((o) => o.type === ObjectType.Start)) {
        break;
      }
      const obj = new ElmaObject();
      obj.id = op.id;
      obj.position = new Position(op.x, op.y);
      obj.type = op.objectType;
      obj.gravity = op.gravity;
      obj.animation = op.animation;
      clone.objects.push(obj);
      break;
    }

    case 'removeObjects': {
      const idSet = new Set(op.ids);
      clone.objects = clone.objects.filter((o) => !idSet.has(o.id));
      break;
    }

    case 'moveObjects': {
      for (const m of op.moves) {
        const idx = findObjIdx(clone, m.objectId);
        if (idx < 0) continue;
        const obj = clone.objects[idx]!;
        obj.position.x = m.newPos.x;
        obj.position.y = m.newPos.y;
      }
      break;
    }

    case 'updateObjects': {
      const idSet = new Set(op.ids);
      for (const obj of clone.objects) {
        if (!idSet.has(obj.id)) continue;
        if (op.data.type !== undefined) obj.type = op.data.type;
        if (op.data.gravity !== undefined) obj.gravity = op.data.gravity;
        if (op.data.animation !== undefined) obj.animation = op.data.animation;
      }
      break;
    }

    case 'addPicture': {
      const pic = new Picture();
      pic.id = op.id;
      pic.name = op.name;
      pic.position = new Position(op.x, op.y);
      pic.clip = op.clip;
      pic.distance = op.distance;
      if (op.texture) pic.texture = op.texture;
      if (op.mask) pic.mask = op.mask;
      if (op.texture && op.mask) pic.name = '';
      clone.pictures.push(pic);
      break;
    }

    case 'removePictures': {
      const idSet = new Set(op.ids);
      clone.pictures = clone.pictures.filter((p) => !idSet.has(p.id));
      break;
    }

    case 'movePictures': {
      for (const m of op.moves) {
        const idx = findPicIdx(clone, m.pictureId);
        if (idx < 0) continue;
        clone.pictures[idx]!.position = new Position(m.newPos.x, m.newPos.y);
      }
      break;
    }

    case 'updatePictures': {
      const idSet = new Set(op.ids);
      for (const pic of clone.pictures) {
        if (!idSet.has(pic.id)) continue;
        if (op.data.name !== undefined) pic.name = op.data.name;
        if (op.data.clip !== undefined) pic.clip = op.data.clip;
        if (op.data.distance !== undefined) pic.distance = op.data.distance;
        if (op.data.texture !== undefined) pic.texture = op.data.texture;
        if (op.data.mask !== undefined) pic.mask = op.data.mask;
      }
      break;
    }

    case 'setLevelName': {
      clone.name = op.name;
      break;
    }

    case 'setLevelGround': {
      clone.ground = op.ground;
      break;
    }

    case 'setLevelSky': {
      clone.sky = op.sky;
      break;
    }

    case 'replacePolygons': {
      const removeSet = new Set(op.removeIds);
      clone.polygons = clone.polygons.filter((p) => !removeSet.has(p.id));
      for (const d of op.add) {
        const poly = new Polygon();
        poly.id = d.id;
        poly.grass = d.grass;
        poly.vertices = d.vertices.map((v) => new Position(v.x, v.y));
        clone.polygons.push(poly);
      }
      break;
    }

    case 'batch': {
      let result = clone;
      for (const subOp of op.operations) {
        result = applyOperation(result, subOp);
      }
      return result;
    }
  }

  return clone;
}
