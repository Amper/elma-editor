import type { Level } from 'elmajs';
import { ObjectType } from 'elmajs';

const OBJECT_RADIUS = 0.4;

const OBJ_COLORS: Record<number, string> = {
  [ObjectType.Apple]: '#e02020',
  [ObjectType.Exit]: '#d0d000',
  [ObjectType.Killer]: '#505050',
  [ObjectType.Start]: '#5090d0',
};

export function levelToSvg(level: Level): string {
  // Compute bounding box
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

  for (const poly of level.polygons) {
    for (const v of poly.vertices) {
      if (v.x < minX) minX = v.x;
      if (v.y < minY) minY = v.y;
      if (v.x > maxX) maxX = v.x;
      if (v.y > maxY) maxY = v.y;
    }
  }
  for (const obj of level.objects) {
    const r = OBJECT_RADIUS;
    if (obj.position.x - r < minX) minX = obj.position.x - r;
    if (obj.position.y - r < minY) minY = obj.position.y - r;
    if (obj.position.x + r > maxX) maxX = obj.position.x + r;
    if (obj.position.y + r > maxY) maxY = obj.position.y + r;
  }

  if (!isFinite(minX)) { minX = 0; minY = 0; maxX = 10; maxY = 10; }

  // Add padding
  const w = maxX - minX || 1;
  const h = maxY - minY || 1;
  const pad = Math.max(w, h) * 0.05;
  const vbX = minX - pad;
  const vbY = minY - pad;
  const vbW = w + pad * 2;
  const vbH = h + pad * 2;

  const parts: string[] = [];
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vbX} ${vbY} ${vbW} ${vbH}">`);

  // Background (sky)
  parts.push(`<rect x="${vbX}" y="${vbY}" width="${vbW}" height="${vbH}" fill="#3a5068"/>`);

  // Ground polygons (non-grass)
  const groundPaths: string[] = [];
  for (const poly of level.polygons) {
    if (poly.grass) continue;
    const d = poly.vertices.map((v, i) => `${i === 0 ? 'M' : 'L'}${v.x} ${v.y}`).join(' ') + ' Z';
    groundPaths.push(d);
  }
  if (groundPaths.length > 0) {
    parts.push(`<path d="${groundPaths.join(' ')}" fill="#c8d8e8" fill-rule="evenodd" stroke="#3a5a7a" stroke-width="${Math.max(w, h) * 0.003}"/>`);
  }

  // Grass polygons
  for (const poly of level.polygons) {
    if (!poly.grass) continue;
    const d = poly.vertices.map((v, i) => `${i === 0 ? 'M' : 'L'}${v.x} ${v.y}`).join(' ') + ' Z';
    parts.push(`<path d="${d}" fill="none" stroke="#4a9e4a" stroke-width="${Math.max(w, h) * 0.004}"/>`);
  }

  // Objects
  const objR = OBJECT_RADIUS * 0.6;
  for (const obj of level.objects) {
    const color = OBJ_COLORS[obj.type] ?? '#888';
    parts.push(`<circle cx="${obj.position.x}" cy="${obj.position.y}" r="${objR}" fill="${color}"/>`);
  }

  parts.push('</svg>');
  return parts.join('');
}
