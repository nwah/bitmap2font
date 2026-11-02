// Build a format-neutral vector font model from decoded bitmaps + a character mapping.

import { traceBitmap } from './outline.js';
import { inkBounds } from './decode.js';
import { glyphNameFor, } from './names.js';

export const DEFAULT_SETTINGS = Object.freeze({
  familyName: 'Bitmap Font',
  styleName: 'Regular',
  lineHeight: null,   // px; default = glyph height
  advance: null,      // px (letter spacing); default = glyph width
  aspect: 1,          // pixel aspect ratio, width ÷ height
  descent: null,      // pixel rows below the baseline; default = round(height / 8)
  proportional: false,// trim each glyph to its ink and add `gap` px
  gap: 1,             // px of spacing for proportional mode
  unitsPerPixel: 100, // font units per pixel row
  version: '1.000',
});

export function resolveSettings(width, height, settings = {}) {
  const s = { ...DEFAULT_SETTINGS };
  for (const [k, v] of Object.entries(settings)) if (v !== undefined && v !== null && v !== '') s[k] = v;
  s.lineHeight = +(s.lineHeight ?? height) || height;
  s.advance = +(s.advance ?? width);
  if (!Number.isFinite(s.advance)) s.advance = width;
  s.aspect = +s.aspect > 0 ? +s.aspect : 1;
  s.descent = s.descent == null ? Math.round(height / 8) : Math.max(0, Math.min(height, s.descent | 0));
  s.gap = +s.gap || 0;
  return s;
}

/**
 * @param {{width:number,height:number,glyphs:Uint8Array[]}} bitmap from decodeBitmapFont
 * @param {(number|null)[]} mapping code point per glyph index (null = skip)
 * @param {object} settings see DEFAULT_SETTINGS
 */
export function buildFont(bitmap, mapping, settings = {}) {
  const { width: w, height: h } = bitmap;
  const s = resolveSettings(w, h, settings);
  const pxH = Math.max(1, Math.min(s.unitsPerPixel | 0 || 100, Math.floor(16384 / Math.max(h, s.lineHeight))));
  const pxW = pxH * s.aspect;
  const upm = h * pxH;
  const X = (col) => Math.round(col * pxW);
  const baseRow = h - s.descent; // pixel row index whose top edge is the baseline
  const warnings = [];

  const glyphs = [];
  const seen = new Map();
  const names = new Set();
  const uniqueName = (n) => { let u = n, i = 1; while (names.has(u)) u = `${n}.${i++}`; names.add(u); return u; };

  let minLsb = Infinity;
  bitmap.glyphs.forEach((bits, index) => {
    const code = mapping[index];
    if (code == null) return;
    if (seen.has(code)) {
      warnings.push(`Glyph #${index} duplicates U+${code.toString(16).toUpperCase().padStart(4, '0')} (already used by #${seen.get(code)}); skipped.`);
      return;
    }
    seen.set(code, index);
    const ink = inkBounds(bits, w, h);
    let shiftCols = 0;
    let advance = X(s.advance);
    if (s.proportional && ink) {
      shiftCols = ink.x0;
      advance = X(ink.x1 - ink.x0 + 1 + s.gap);
    }
    const contours = traceBitmap(bits, w, h).map((c) => {
      const pts = c.map(([cx, cy]) => ({ x: X(cx - shiftCols), y: (baseRow - cy) * pxH }));
      return rotateToStart(pts);
    });
    glyphs.push({ name: uniqueName(glyphNameFor(code)), codes: [code], advance, contours, sourceIndex: index });
  });

  // Always provide a space.
  if (!seen.has(0x20)) {
    glyphs.unshift({ name: uniqueName('space'), codes: [0x20], advance: X(s.advance), contours: [], sourceIndex: -1 });
  }

  // Metrics
  const ascentPx = h - s.descent;
  const extra = (s.lineHeight - h) * pxH;
  const ascender = Math.round(ascentPx * pxH + extra / 2);
  const descender = -Math.round(s.descent * pxH + extra - Math.round(extra / 2));
  const topOf = (code) => {
    const i = seen.get(code);
    if (i == null) return null;
    const b = inkBounds(bitmap.glyphs[i], w, h);
    return b ? (baseRow - b.y0) * pxH : null;
  };
  const capHeight = topOf(0x48) ?? topOf(0x49) ?? ascentPx * pxH;
  const xHeight = topOf(0x78) ?? topOf(0x6F) ?? Math.round(capHeight * 0.7 / pxH) * pxH;

  // .notdef: hollow box
  const nd = { name: '.notdef', codes: [], advance: X(s.advance), contours: [], sourceIndex: -1 };
  const bx0 = X(0.5), bx1 = nd.advance - X(0.5), by0 = 0, by1 = capHeight, t = pxH * 0.5;
  if (bx1 - bx0 > 2 * t && by1 - by0 > 2 * t) {
    nd.contours.push(rotateToStart([{ x: bx0, y: by0 }, { x: bx1, y: by0 }, { x: bx1, y: by1 }, { x: bx0, y: by1 }]));
    nd.contours.push(rotateToStart([
      { x: bx0 + t, y: by0 + t }, { x: bx0 + t, y: by1 - t }, { x: bx1 - t, y: by1 - t }, { x: bx1 - t, y: by0 + t },
    ].map((p) => ({ x: Math.round(p.x), y: Math.round(p.y) }))));
  }
  glyphs.unshift(nd);

  let xMin = Infinity, yMin = Infinity, xMax = -Infinity, yMax = -Infinity;
  for (const g of glyphs) {
    for (const c of g.contours) for (const p of c) {
      if (p.x < xMin) xMin = p.x; if (p.x > xMax) xMax = p.x;
      if (p.y < yMin) yMin = p.y; if (p.y > yMax) yMax = p.y;
    }
  }
  if (xMin === Infinity) xMin = yMin = xMax = yMax = 0;
  const advances = new Set(glyphs.map((g) => g.advance));

  return {
    familyName: String(s.familyName).trim() || 'Bitmap Font',
    styleName: String(s.styleName).trim() || 'Regular',
    version: s.version,
    unitsPerEm: upm,
    pixelWidth: pxW,
    pixelHeight: pxH,
    ascender,
    descender,
    lineGap: 0,
    capHeight,
    xHeight,
    isFixedPitch: advances.size === 1,
    bbox: { xMin, yMin, xMax, yMax },
    glyphs,
    warnings,
    settings: s,
    source: { width: w, height: h },
  };
}

// Start each contour at its lowest-then-leftmost point for stable output.
function rotateToStart(pts) {
  let best = 0;
  for (let i = 1; i < pts.length; i++) {
    const p = pts[i], b = pts[best];
    if (p.y < b.y || (p.y === b.y && p.x < b.x)) best = i;
  }
  return pts.slice(best).concat(pts.slice(0, best));
}

export function postscriptName(font) {
  const clean = (s) => s.replace(/[^\x21-\x7E]|[[\](){}<>/%]/g, '').replace(/\s+/g, '');
  return (clean(font.familyName) + '-' + clean(font.styleName)).slice(0, 63) || 'BitmapFont-Regular';
}

/** SVG path data for a glyph in font units, y flipped so it draws upright with origin at the baseline. */
export function glyphToSvgPath(glyph, dx = 0, dy = 0) {
  return glyph.contours
    .map((c) => 'M' + c.map((p) => `${p.x + dx} ${dy - p.y}`).join('L') + 'Z')
    .join('');
}
