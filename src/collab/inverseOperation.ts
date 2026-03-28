import type { Level } from 'elmajs';
import type { Operation } from './operations';
import type { Vec2 } from '@/types';

/**
 * Compute the inverse of an operation given the level state BEFORE the operation is applied.
 * The inverse, when applied, undoes the original operation.
 */
export function computeInverse(level: Level, op: Operation): Operation {
  switch (op.type) {
    case 'addPolygon':
      return { type: 'removePolygons', ids: [op.id] };

    case 'addPolygons':
      return { type: 'removePolygons', ids: op.polygons.map((p) => p.id) };

    case 'removePolygons': {
      const polygons = level.polygons
        .filter((p) => op.ids.includes(p.id))
        .map((p) => ({
          id: p.id,
          grass: p.grass,
          vertices: p.vertices.map((v) => ({ x: v.x, y: v.y })),
        }));
      return { type: 'addPolygons', polygons };
    }

    case 'setPolygonGrass': {
      const poly = level.polygons.find((p) => p.id === op.id);
      return { type: 'setPolygonGrass', id: op.id, grass: poly?.grass ?? !op.grass };
    }

    case 'setPolygonsGrass': {
      const ops: Operation[] = [];
      for (const id of op.ids) {
        const poly = level.polygons.find((p) => p.id === id);
        if (poly) {
          ops.push({ type: 'setPolygonGrass', id, grass: poly.grass });
        }
      }
      return ops.length === 1 ? ops[0]! : { type: 'batch', operations: ops };
    }

    case 'moveVertices': {
      const inverseMoves: Array<{ polyId: string; vertIdx: number; newPos: Vec2 }> = [];
      for (const m of op.moves) {
        const poly = level.polygons.find((p) => p.id === m.polyId);
        if (!poly) continue;
        const vert = poly.vertices[m.vertIdx];
        if (vert) {
          inverseMoves.push({ polyId: m.polyId, vertIdx: m.vertIdx, newPos: { x: vert.x, y: vert.y } });
        }
      }
      return { type: 'moveVertices', moves: inverseMoves };
    }

    case 'insertVertex': {
      return { type: 'removeVertex', polyId: op.polyId, vertIdx: op.afterVertIdx };
    }

    case 'removeVertex': {
      const poly = level.polygons.find((p) => p.id === op.polyId);
      if (!poly) return { type: 'batch', operations: [] };
      const vert = poly.vertices[op.vertIdx];
      if (!vert) return { type: 'batch', operations: [] };
      return { type: 'insertVertex', polyId: op.polyId, afterVertIdx: op.vertIdx, pos: { x: vert.x, y: vert.y } };
    }

    case 'removeVertices': {
      const ops: Operation[] = [];
      for (const entry of op.verts) {
        const poly = level.polygons.find((p) => p.id === entry.polyId);
        if (!poly) continue;
        const sorted = [...entry.vertIndices].sort((a, b) => a - b);
        for (const vi of sorted) {
          const vert = poly.vertices[vi];
          if (vert) {
            ops.push({ type: 'insertVertex', polyId: entry.polyId, afterVertIdx: vi, pos: { x: vert.x, y: vert.y } });
          }
        }
      }
      return ops.length === 1 ? ops[0]! : { type: 'batch', operations: ops };
    }

    case 'addObject':
      return { type: 'removeObjects', ids: [op.id] };

    case 'removeObjects': {
      const ops: Operation[] = [];
      for (const id of op.ids) {
        const obj = level.objects.find((o) => o.id === id);
        if (obj) {
          ops.push({
            type: 'addObject',
            id: obj.id,
            x: obj.position.x,
            y: obj.position.y,
            objectType: obj.type,
            gravity: obj.gravity,
            animation: obj.animation,
          });
        }
      }
      return ops.length === 1 ? ops[0]! : { type: 'batch', operations: ops };
    }

    case 'moveObjects': {
      const inverseMoves: Array<{ objectId: string; newPos: Vec2 }> = [];
      for (const m of op.moves) {
        const obj = level.objects.find((o) => o.id === m.objectId);
        if (obj) {
          inverseMoves.push({ objectId: m.objectId, newPos: { x: obj.position.x, y: obj.position.y } });
        }
      }
      return { type: 'moveObjects', moves: inverseMoves };
    }

    case 'updateObjects': {
      const ops: Operation[] = [];
      for (const id of op.ids) {
        const obj = level.objects.find((o) => o.id === id);
        if (!obj) continue;
        const data: Operation & { type: 'updateObjects' } = {
          type: 'updateObjects',
          ids: [id],
          data: {},
        };
        if (op.data.type !== undefined) data.data.type = obj.type;
        if (op.data.gravity !== undefined) data.data.gravity = obj.gravity;
        if (op.data.animation !== undefined) data.data.animation = obj.animation;
        ops.push(data);
      }
      return ops.length === 1 ? ops[0]! : { type: 'batch', operations: ops };
    }

    case 'addPicture':
      return { type: 'removePictures', ids: [op.id] };

    case 'removePictures': {
      const ops: Operation[] = [];
      for (const id of op.ids) {
        const pic = level.pictures.find((p) => p.id === id);
        if (pic) {
          ops.push({
            type: 'addPicture',
            id: pic.id,
            x: pic.position.x,
            y: pic.position.y,
            name: pic.name,
            clip: pic.clip,
            distance: pic.distance,
            texture: pic.texture || undefined,
            mask: pic.mask || undefined,
          });
        }
      }
      return ops.length === 1 ? ops[0]! : { type: 'batch', operations: ops };
    }

    case 'movePictures': {
      const inverseMoves: Array<{ pictureId: string; newPos: Vec2 }> = [];
      for (const m of op.moves) {
        const pic = level.pictures.find((p) => p.id === m.pictureId);
        if (pic) {
          inverseMoves.push({ pictureId: m.pictureId, newPos: { x: pic.position.x, y: pic.position.y } });
        }
      }
      return { type: 'movePictures', moves: inverseMoves };
    }

    case 'updatePictures': {
      const ops: Operation[] = [];
      for (const id of op.ids) {
        const pic = level.pictures.find((p) => p.id === id);
        if (!pic) continue;
        const data: Operation & { type: 'updatePictures' } = {
          type: 'updatePictures',
          ids: [id],
          data: {},
        };
        if (op.data.name !== undefined) data.data.name = pic.name;
        if (op.data.clip !== undefined) data.data.clip = pic.clip;
        if (op.data.distance !== undefined) data.data.distance = pic.distance;
        if (op.data.texture !== undefined) data.data.texture = pic.texture;
        if (op.data.mask !== undefined) data.data.mask = pic.mask;
        ops.push(data);
      }
      return ops.length === 1 ? ops[0]! : { type: 'batch', operations: ops };
    }

    case 'setLevelName': {
      return { type: 'setLevelName', name: level.name ?? '' };
    }

    case 'setLevelGround': {
      return { type: 'setLevelGround', ground: level.ground ?? '' };
    }

    case 'setLevelSky': {
      return { type: 'setLevelSky', sky: level.sky ?? '' };
    }

    case 'replacePolygons': {
      const removedPolys = level.polygons
        .filter((p) => op.removeIds.includes(p.id))
        .map((p) => ({
          id: p.id,
          grass: p.grass,
          vertices: p.vertices.map((v) => ({ x: v.x, y: v.y })),
        }));
      return {
        type: 'replacePolygons',
        removeIds: op.add.map((p) => p.id),
        add: removedPolys,
      };
    }

    case 'batch': {
      const inverses = [...op.operations].reverse().map((subOp) => computeInverse(level, subOp));
      return { type: 'batch', operations: inverses };
    }
  }
}
