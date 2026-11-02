#!/usr/bin/env node
// Offline command-line front end for the bitmap2font core.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import path from 'node:path';
import {
  decodeBitmapFont, parseNumber, parseTextBytes, buildMapping, parseCharSpec, PRESETS,
  buildFont, buildTTF, buildWOFF, buildUFOFiles, buildUFOZip, buildGlyphsFile, postscriptName, sampleFontBytes,
  isPNG, decodePNG, decodeImageSheet, guessImageLayout,
} from '../core/index.js';

const HELP = `Usage: bitmap2font <input> [options]

Input
  <input>                 binary font file, or a .png font sheet
                          (use --hex/--dec for text dumps, --sample for the demo font)
  --hex | --dec           treat input as a text dump of hex (0x.., $.., bare) or decimal bytes
  --sample                use the built-in 5x7 demo font (ASCII from 32)

Decoding
  -w, --width <px>        glyph width            (default 8)
  -h, --height <px>       glyph height           (default 8)
  --offset <bytes>        bytes to skip, e.g. 2 for C64 .64c/.prg load address (dec, 0x.., $..)
  --count <n>             number of glyphs       (default: all that fit)
  --stride <bytes>        bytes per glyph        (default: auto)
  --layout rows|cols      byte orientation       (default rows)
  --packing padded|stream rows start on byte boundaries, or continuous bitstream (default padded)
  --bit-order msb|lsb     which bit is the first pixel (default msb)
  --invert                swap ink and paper

Font sheet images (PNG)       glyph size, scale and ink are auto-detected unless given
  --scale <n>             image pixels per font pixel
  --columns <n>           cells per row (default: as many as fit)
  --margin-x/--margin-y <px>   image px before the first cell
  --gutter-x/--gutter-y <px>   image px between cells
  --ink auto|dark|light|opaque
  --threshold <0..1>      luminance threshold (default 0.5)
  (--width/--height/--count/--invert apply as above)

Character mapping
  --preset <name>         ${Object.keys(PRESETS).join(', ')} (default ascii)
  --first-code <n>        code of glyph #0 for ascii/latin1/cp437 presets
                          (default 0x20 = data starts at space; cp437 defaults to 0)
  --pua                   map otherwise-unmapped glyphs to U+E000 + index
  --chars <string>        assign these characters to consecutive glyphs...
  --chars-start <n>       ...starting at this glyph index (default 0)
  --map <file.json>       {"<index>": "A" | "U+0041" | ""} overrides

Font
  --family <name>         family name (default "Bitmap Font")
  --style <name>          style name  (default Regular)
  --line-height <px>      default: glyph height
  --advance <px>          letter spacing / advance width, default: glyph width
  --aspect <w/h>          pixel aspect ratio, e.g. 0.75 or 4:3 (default 1)
  --descent <rows>        pixel rows below the baseline (default height/8)
  --proportional          trim glyphs to their ink; --gap <px> spacing (default 1)

Output
  -o, --out <dir>         output directory (default .)
  --formats <list>        comma list of ttf,woff,ufo,ufozip,glyphs (default ttf,woff,ufo,glyphs)
`;

const { values: a, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    help: { type: 'boolean' }, hex: { type: 'boolean' }, dec: { type: 'boolean' }, sample: { type: 'boolean' },
    width: { type: 'string', short: 'w' }, height: { type: 'string', short: 'h' },
    offset: { type: 'string' }, count: { type: 'string' }, stride: { type: 'string' },
    layout: { type: 'string' }, packing: { type: 'string' }, 'bit-order': { type: 'string' }, invert: { type: 'boolean' },
    preset: { type: 'string' }, 'first-code': { type: 'string' }, pua: { type: 'boolean' },
    chars: { type: 'string' }, 'chars-start': { type: 'string' }, map: { type: 'string' },
    family: { type: 'string' }, style: { type: 'string' }, 'line-height': { type: 'string' },
    advance: { type: 'string' }, aspect: { type: 'string' }, descent: { type: 'string' },
    proportional: { type: 'boolean' }, gap: { type: 'string' },
    out: { type: 'string', short: 'o' }, formats: { type: 'string' },
    scale: { type: 'string' }, columns: { type: 'string' }, 'margin-x': { type: 'string' }, 'margin-y': { type: 'string' },
    'gutter-x': { type: 'string' }, 'gutter-y': { type: 'string' }, ink: { type: 'string' }, threshold: { type: 'string' },
  },
});

if (a.help || (!positionals.length && !a.sample)) { process.stdout.write(HELP); process.exit(a.help ? 0 : 1); }

const num = (v, d) => { if (v == null) return d; const n = parseNumber(v); if (Number.isNaN(n)) die(`Bad number: ${v}`); return n; };
const float = (v, d) => { if (v == null) return d; const n = Number(v); if (!Number.isFinite(n)) die(`Bad number: ${v}`); return n; };
function die(msg) { console.error('bitmap2font: ' + msg); process.exit(1); }
function aspect(v) {
  if (v == null) return 1;
  const m = String(v).match(/^\s*([\d.]+)\s*[:/]\s*([\d.]+)\s*$/);
  return m ? +m[1] / +m[2] : float(v, 1);
}

let bytes;
if (a.sample) bytes = sampleFontBytes();
else {
  const buf = await readFile(positionals[0]);
  bytes = a.hex || a.dec ? parseTextBytes(buf.toString('utf8'), a.dec ? 'dec' : 'hex') : new Uint8Array(buf);
}

let bitmap;
if (!a.hex && !a.dec && isPNG(bytes)) {
  const image = await decodePNG(bytes);
  const ink = a.ink || 'auto', threshold = float(a.threshold, 0.5);
  const guess = guessImageLayout(image, { ink, threshold });
  bitmap = decodeImageSheet(image, {
    width: num(a.width, guess.width), height: num(a.height, guess.height), count: num(a.count, 0),
    scale: num(a.scale, guess.scale), columns: num(a.columns, 0),
    offsetX: num(a['margin-x'], 0), offsetY: num(a['margin-y'], 0),
    gapX: num(a['gutter-x'], 0), gapY: num(a['gutter-y'], 0),
    ink, threshold, invert: !!a.invert,
  });
  console.log(`sheet ${image.width}x${image.height}: ${bitmap.columns}x${bitmap.rows} cells, ` +
    `scale ${num(a.scale, guess.scale)}, ink ${ink === 'auto' ? guess.ink : ink}`);
} else {
  bitmap = decodeBitmapFont(bytes, {
    width: num(a.width, 8), height: num(a.height, 8), offset: num(a.offset, 0), count: num(a.count, 0),
    stride: num(a.stride, 0), layout: a.layout || 'rows', packing: a.packing || 'padded',
    bitOrder: a['bit-order'] || 'msb', invert: !!a.invert,
  });
}
if (!bitmap.glyphs.length) die('no glyphs decoded — check width/height/offset');

const preset = a.preset || 'ascii';
if (!PRESETS[preset]) die(`unknown preset "${preset}"`);
const mapping = buildMapping(preset, bitmap.glyphs.length, {
  firstCode: a['first-code'] != null ? num(a['first-code']) : undefined, puaForUnmapped: !!a.pua,
});
if (a.chars != null) {
  const start = num(a['chars-start'], 0);
  [...a.chars].forEach((ch, i) => { if (start + i < mapping.length) mapping[start + i] = ch.codePointAt(0); });
}
if (a.map) {
  const overrides = JSON.parse(await readFile(a.map, 'utf8'));
  for (const [k, v] of Object.entries(overrides)) {
    const cp = parseCharSpec(v);
    if (cp === undefined) die(`--map: bad value for ${k}: ${JSON.stringify(v)}`);
    mapping[+k] = cp;
  }
}

const font = buildFont(bitmap, mapping, {
  familyName: a.family, styleName: a.style,
  lineHeight: a['line-height'] != null ? float(a['line-height']) : null,
  advance: a.advance != null ? float(a.advance) : null,
  aspect: aspect(a.aspect),
  descent: a.descent != null ? num(a.descent) : null,
  proportional: !!a.proportional, gap: float(a.gap, 1),
});
for (const w of font.warnings) console.warn('warning: ' + w);

const outDir = a.out || '.';
await mkdir(outDir, { recursive: true });
const base = postscriptName(font);
const formats = (a.formats || 'ttf,woff,ufo,glyphs').split(',').map((s) => s.trim().toLowerCase());
const written = [];
let ttf;
for (const f of formats) {
  if (f === 'ttf' || f === 'woff') ttf ??= buildTTF(font);
  if (f === 'ttf') { const p = path.join(outDir, base + '.ttf'); await writeFile(p, ttf); written.push(p); }
  else if (f === 'woff') { const p = path.join(outDir, base + '.woff'); await writeFile(p, await buildWOFF(ttf)); written.push(p); }
  else if (f === 'glyphs') { const p = path.join(outDir, base + '.glyphs'); await writeFile(p, buildGlyphsFile(font)); written.push(p); }
  else if (f === 'ufozip') { const p = path.join(outDir, base + '.ufo.zip'); await writeFile(p, buildUFOZip(font)); written.push(p); }
  else if (f === 'ufo') {
    const { dirName, files } = buildUFOFiles(font);
    const root = path.join(outDir, dirName);
    for (const file of files) {
      const p = path.join(root, file.path);
      await mkdir(path.dirname(p), { recursive: true });
      await writeFile(p, file.data);
    }
    written.push(root + '/');
  } else die(`unknown format "${f}"`);
}
const enc = font.glyphs.filter((g) => g.codes.length).length;
console.log(`${bitmap.glyphs.length} glyphs decoded (${bitmap.width}x${bitmap.height}), ${enc} encoded in font, UPM ${font.unitsPerEm}`);
for (const p of written) console.log('  ' + p);
