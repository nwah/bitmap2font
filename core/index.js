// bitmap2font core — pure ES modules, usable from the browser and Node (>= 18).
//
//   import { decodeBitmapFont, buildMapping, buildFont, buildTTF } from './core/index.js';
//   const bitmap = decodeBitmapFont(bytes, { width: 8, height: 8 });
//   const font = buildFont(bitmap, buildMapping('ascii', bitmap.glyphs.length), { familyName: 'My Font' });
//   const ttf = buildTTF(font);

export { parseNumber, parseTextBytes, decodeBitmapFont, glyphByteSize, inkBounds, DEFAULT_DECODE } from './decode.js';
export { PRESETS, buildMapping, parseCharSpec, formatCharSpec, uPlus } from './charmaps.js';
export { traceBitmap, signedArea } from './outline.js';
export { buildFont, resolveSettings, postscriptName, glyphToSvgPath, DEFAULT_SETTINGS } from './font.js';
export { buildTTF, buildWOFF } from './ttf.js';
export { buildUFOFiles, buildUFOZip, plist } from './ufo.js';
export { buildGlyphsFile } from './glyphs.js';
export { makeZip, crc32 } from './zip.js';
export { glyphNameFor, ufoFileName } from './names.js';
export { sampleFontBytes } from './sample.js';
export { decodeImageSheet, binarizeImage, detectPixelScale, detectInkMode, guessImageLayout, DEFAULT_IMAGE } from './image.js';
export { decodePNG, isPNG } from './png.js';
