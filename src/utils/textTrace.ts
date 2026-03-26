import type { Vec2 } from '@/types';
import { toBinaryBitmap, traceContours, normalizeContours } from './imageTrace';

export interface TextConfig {
  text: string;
  fontFamily: string;
  fontSize: number;
  bold: boolean;
  italic: boolean;
  simplifyTolerance: number;
}

// ── Font data ───────────────────────────────────────────────────────────────

export const SYSTEM_FONTS = [
  'Arial', 'Verdana', 'Georgia', 'Times New Roman', 'Courier New',
  'Impact', 'Trebuchet MS', 'Helvetica', 'Palatino', 'Garamond',
  'Comic Sans MS', 'Tahoma', 'Lucida Console',
];

export const GOOGLE_FONTS = [
  'Roboto', 'Open Sans', 'Lato', 'Montserrat', 'Oswald', 'Poppins',
  'Noto Sans', 'Raleway', 'Ubuntu', 'Merriweather', 'Playfair Display',
  'PT Sans', 'Nunito', 'Rubik', 'Work Sans', 'Fira Sans', 'Quicksand',
  'Barlow', 'Mulish', 'Inconsolata', 'Karla', 'Cabin', 'Bitter',
  'Josefin Sans', 'Arimo', 'Dosis', 'Libre Baskerville', 'Oxygen',
  'Catamaran', 'Hind', 'Archivo', 'Manrope', 'Space Grotesk',
  'IBM Plex Sans', 'IBM Plex Mono', 'Source Code Pro', 'JetBrains Mono',
  'Zilla Slab', 'Crimson Text', 'Cormorant Garamond', 'EB Garamond',
  'Spectral', 'Alegreya', 'PT Serif', 'Noto Serif', 'Lora',
  'Bebas Neue', 'Anton', 'Righteous', 'Abril Fatface', 'Alfa Slab One',
  'Lobster', 'Pacifico', 'Satisfy', 'Dancing Script', 'Great Vibes',
  'Permanent Marker', 'Bangers', 'Press Start 2P', 'VT323', 'Silkscreen',
  'Pixelify Sans', 'Black Ops One', 'Bungee', 'Orbitron', 'Audiowide',
  'Russo One', 'Teko', 'Chakra Petch', 'Rajdhani', 'Exo 2',
  'Titillium Web', 'Comfortaa', 'Baloo 2', 'Fredoka', 'Chewy',
  'Lilita One', 'Righteous', 'Passion One', 'Bree Serif', 'Crete Round',
  'Saira', 'Inter', 'DM Sans', 'Plus Jakarta Sans', 'Outfit',
  'Sora', 'Lexend', 'Figtree', 'Geist', 'Atkinson Hyperlegible',
];

// ── Google Fonts loader ─────────────────────────────────────────────────────

const loadedFonts = new Set<string>();
const previewFonts = new Set<string>();

/** Load a font fully (all weights/styles) for polygon generation. */
export async function loadGoogleFont(family: string): Promise<boolean> {
  if (loadedFonts.has(family)) return true;

  const url = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family)}:ital,wght@0,400;0,700;1,400;1,700&display=swap`;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = url;

  // Wait for the stylesheet to actually load before checking font availability
  try {
    await new Promise<void>((resolve, reject) => {
      link.onload = () => resolve();
      link.onerror = () => reject(new Error('Stylesheet load failed'));
      document.head.appendChild(link);
    });

    // Wait for all pending font-face loads to finish
    await document.fonts.ready;

    loadedFonts.add(family);
    return true;
  } catch {
    return false;
  }
}

/** Load a font subset for dropdown preview (only the chars in the font name). */
export function loadGoogleFontPreview(family: string): void {
  if (previewFonts.has(family) || loadedFonts.has(family)) return;
  previewFonts.add(family);

  const url = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family)}&display=swap&text=${encodeURIComponent(family)}`;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = url;
  document.head.appendChild(link);
}

// ── Text-to-polygon conversion ──────────────────────────────────────────────

const PIXELS_PER_UNIT = 100;
const MAX_CANVAS_WIDTH = 4096;
const PADDING = 4;

export function textToPolygons(config: TextConfig): Vec2[][] {
  const { text, fontFamily, fontSize, bold, italic, simplifyTolerance } = config;
  if (!text.trim()) return [];

  let pixelFontSize = fontSize * PIXELS_PER_UNIT;

  const buildFont = (size: number) =>
    `${italic ? 'italic ' : ''}${bold ? 'bold ' : ''}${size}px "${fontFamily}"`;

  // Measure text to determine canvas size (alphabetic baseline)
  const measure = document.createElement('canvas').getContext('2d')!;
  measure.font = buildFont(pixelFontSize);
  let metrics = measure.measureText(text);

  let canvasWidth = Math.ceil(metrics.width) + PADDING * 2;

  // Scale down if canvas would be too wide
  let scaleFactor = 1;
  if (canvasWidth > MAX_CANVAS_WIDTH) {
    scaleFactor = MAX_CANVAS_WIDTH / canvasWidth;
    pixelFontSize *= scaleFactor;
    measure.font = buildFont(pixelFontSize);
    metrics = measure.measureText(text);
    canvasWidth = Math.ceil(metrics.width) + PADDING * 2;
  }

  const ascent = Math.ceil(metrics.actualBoundingBoxAscent);
  const descent = Math.ceil(metrics.actualBoundingBoxDescent);
  const canvasHeight = ascent + descent + PADDING * 2;

  if (canvasWidth < 1 || canvasHeight < 1) return [];

  // Render text to offscreen canvas
  const canvas = document.createElement('canvas');
  canvas.width = canvasWidth;
  canvas.height = canvasHeight;
  const ctx = canvas.getContext('2d')!;

  // White background
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvasWidth, canvasHeight);

  // Black text — use alphabetic baseline so ascent/descent match measurement
  ctx.font = buildFont(pixelFontSize);
  ctx.fillStyle = '#000000';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(text, PADDING, PADDING + ascent);

  // Trace contours using existing pipeline
  const imageData = ctx.getImageData(0, 0, canvasWidth, canvasHeight);
  const binary = toBinaryBitmap(imageData, 128, false);
  const contours = traceContours(binary, canvasWidth, canvasHeight);

  const effectiveScale = 1 / (PIXELS_PER_UNIT * scaleFactor);
  return normalizeContours(contours, {
    threshold: 128,
    simplifyTolerance,
    scale: effectiveScale,
    invert: false,
  });
}
