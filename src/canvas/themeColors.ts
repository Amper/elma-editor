/**
 * Bridge between CSS custom properties (theme.css) and Canvas 2D rendering.
 * Reads :root variables once and caches them. Call refreshTheme() to re-read.
 */

export interface ThemeColors {
  // Canvas
  sky: string;
  ground: string;
  groundStroke: string;
  grass: string;
  grassFill: string;

  // Objects
  objExit: string;
  objApple: string;
  objKiller: string;
  objStart: string;

  // Grid
  gridDot: string;
  gridMajor: string;

  // Selection
  selection: string;
  selectionFill: string;

  // Errors
  error: string;

  // Tool overlays
  toolPrimary: string;
  toolDrawGround: string;
  toolDrawGrass: string;
  toolVertexHover: string;
  toolVertexActive: string;
  toolImport: string;
  handle: string;
}

const VAR_MAP: Record<keyof ThemeColors, string> = {
  sky: '--color-sky',
  ground: '--color-ground',
  groundStroke: '--color-ground-stroke',
  grass: '--color-grass',
  grassFill: '--color-grass-fill',
  objExit: '--color-obj-exit',
  objApple: '--color-obj-apple',
  objKiller: '--color-obj-killer',
  objStart: '--color-obj-start',
  gridDot: '--color-grid-dot',
  gridMajor: '--color-grid-major',
  selection: '--color-selection',
  selectionFill: '--color-selection-fill',
  error: '--color-error',
  toolPrimary: '--color-tool-primary',
  toolDrawGround: '--color-tool-draw-ground',
  toolDrawGrass: '--color-tool-draw-grass',
  toolVertexHover: '--color-tool-vertex-hover',
  toolVertexActive: '--color-tool-vertex-active',
  toolImport: '--color-tool-import',
  handle: '--color-handle',
};

let cached: ThemeColors | null = null;

/** Get the current theme colors (reads from CSS on first call, then cached). */
export function getTheme(): ThemeColors {
  if (!cached) {
    const style = getComputedStyle(document.documentElement);
    const result = {} as ThemeColors;
    for (const [key, varName] of Object.entries(VAR_MAP)) {
      (result as unknown as Record<string, string>)[key] = style.getPropertyValue(varName).trim();
    }
    cached = result;
  }
  return cached;
}

/** Force re-reading of theme variables (call after changing CSS variables). */
export function refreshTheme(): void {
  cached = null;
}

/** Create an rgba color string from a hex/rgb color with the given alpha. */
export function withAlpha(color: string, alpha: number): string {
  const [r, g, b] = parseRgb(color);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function parseRgb(color: string): [number, number, number] {
  if (color.startsWith('#')) {
    const h = color.slice(1);
    if (h.length === 3) {
      return [
        parseInt(h[0]! + h[0]!, 16),
        parseInt(h[1]! + h[1]!, 16),
        parseInt(h[2]! + h[2]!, 16),
      ];
    }
    return [
      parseInt(h.slice(0, 2), 16),
      parseInt(h.slice(2, 4), 16),
      parseInt(h.slice(4, 6), 16),
    ];
  }
  const match = color.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
  if (match) {
    return [parseInt(match[1]!), parseInt(match[2]!), parseInt(match[3]!)];
  }
  return [0, 0, 0];
}
