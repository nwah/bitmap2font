// Builds the web UI's own fonts with bitmap2font: node fonts/build.mjs
//   fonts/lakeshore.woff     12px proportional UI font, drawn in fonts/src/lakeshore.txt
//   fonts/sampler-mono.woff  the built-in 5x7 demo font plus a few symbols, monospaced, for numbers and hex
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  decodeBitmapFont, buildMapping, buildFont, buildTTF, buildWOFF, parseCharSpec, sampleFontBytes,
} from '../core/index.js';

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const W = 12, H = 12; // cell size; each row is packed into 2 bytes, MSB = leftmost pixel

/** Parse the block format described at the top of lakeshore.txt into [{ code, rows }]. */
export function parseGlyphSource(text) {
  const glyphs = [];
  let block = null;
  const flush = () => {
    if (!block) return;
    block.chars.forEach((code, i) => {
      const rows = block.rows.map((r) => r[i]);
      const width = rows[0]?.length ?? 1;
      if (rows.some((r) => r.length !== width)) throw new Error(`${String.fromCodePoint(code)}: rows differ in width`);
      if (width > W) throw new Error(`${String.fromCodePoint(code)}: wider than ${W}px`);
      glyphs.push({ code, rows });
    });
    block = null;
  };
  text.split('\n').forEach((raw, n) => {
    const line = raw.trim();
    if (!line || line.startsWith('//')) return flush();
    if (line.startsWith(':')) {
      flush();
      const chars = line.slice(1).trim().split(/\s+/).map((t) => {
        const c = parseCharSpec(t);
        if (c == null) throw new Error(`line ${n + 1}: bad character "${t}"`);
        return c;
      });
      block = { chars, rows: [] };
      return;
    }
    if (!block) throw new Error(`line ${n + 1}: pixel row outside a block`);
    const toks = line.split(/\s+/);
    if (toks.length !== block.chars.length) throw new Error(`line ${n + 1}: ${toks.length} glyphs, header has ${block.chars.length}`);
    if (block.rows.length === H) throw new Error(`line ${n + 1}: more than ${H} rows`);
    if (toks.some((t) => /[^#.]/.test(t))) throw new Error(`line ${n + 1}: use only # and .`);
    block.rows.push(toks);
  });
  flush();
  return glyphs;
}

/** Pack glyphs into a plain bitmap-font binary, the same kind of data the tool imports. */
function packBinary(glyphs) {
  const bytes = new Uint8Array(glyphs.length * H * 2);
  glyphs.forEach((g, i) => g.rows.forEach((row, y) => {
    let bits = 0;
    for (let x = 0; x < row.length; x++) if (row[x] === '#') bits |= 0x8000 >> x;
    bytes[(i * H + y) * 2] = bits >> 8;
    bytes[(i * H + y) * 2 + 1] = bits & 0xFF;
  }));
  return bytes;
}

async function writeFont(font, file) {
  const woff = await buildWOFF(buildTTF(font));
  writeFileSync(here(file), woff);
  console.log(`${file}: ${font.glyphs.length} glyphs, ${woff.length} bytes`);
}

const glyphs = parseGlyphSource(readFileSync(here('./src/lakeshore.txt'), 'utf8'));
const bitmap = decodeBitmapFont(packBinary(glyphs), { width: W, height: H });
await writeFont(buildFont(bitmap, glyphs.map((g) => g.code), {
  familyName: 'Lakeshore', descent: 3, proportional: true, gap: 1, advance: 4, // advance = space width
}), './lakeshore.woff');

// The demo font is plain ASCII; add the few symbols the UI prints in mono text, in the same 5x7 style.
const MONO_EXTRAS = `
: · × → ← … – — ÷
..... ..... ..... ..... ..... ..... ...... .....
..... #...# ..#.. ..#.. ..... ..... ...... ..#..
..... .#.#. ...#. .#... ..... ..... ...... .....
..#.. ..#.. ##### ##### ..... ##### ###### #####
..... .#.#. ...#. .#... ..... ..... ...... .....
..... #...# ..#.. ..#.. ..... ..... ...... ..#..
..... ..... ..... ..... #.#.# ..... ...... .....
`;
const extras = parseGlyphSource(MONO_EXTRAS);
const sampleBytes = sampleFontBytes();
const monoBytes = new Uint8Array(sampleBytes.length + extras.length * 8);
monoBytes.set(sampleBytes);
extras.forEach((g, i) => g.rows.forEach((row, y) => {
  // 5px glyphs sit in columns 1–5 like the demo font; a 6px rule starts at column 0 so dashes join up
  const shift = row.length < 6 ? 1 : 0;
  monoBytes[sampleBytes.length + i * 8 + y] = parseInt(row.replace(/#/g, '1').replace(/\./g, '0'), 2) << (8 - row.length - shift);
}));
const sample = decodeBitmapFont(monoBytes, { width: 8, height: 8 });
const monoMap = buildMapping('ascii', sampleBytes.length / 8, { firstCode: 32 }).concat(extras.map((g) => g.code));
await writeFont(buildFont(sample, monoMap, {
  familyName: 'Sampler Mono', descent: 1, advance: 6,
}), './sampler-mono.woff');
