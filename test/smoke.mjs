// Quick self-check of the core: node test/smoke.mjs
import assert from 'node:assert/strict';
import {
  decodeBitmapFont, buildMapping, buildFont, buildTTF, buildWOFF, buildUFOFiles, buildGlyphsFile,
  traceBitmap, signedArea, sampleFontBytes, parseTextBytes, parseCharSpec, crc32,
} from '../core/index.js';

// decoding: MSB rows vs LSB columns describe the same "L" shape
const rows = decodeBitmapFont(new Uint8Array([0x80, 0x80, 0xC0]), { width: 2, height: 3 }).glyphs[0];
assert.deepEqual([...rows], [1, 0, 1, 0, 1, 1]);
const cols = decodeBitmapFont(new Uint8Array([0x07, 0x04]), { width: 2, height: 3, layout: 'cols', bitOrder: 'lsb' }).glyphs[0];
assert.deepEqual([...cols], [...rows]);
const stream = decodeBitmapFont(new Uint8Array([0b10101100, 0]), { width: 2, height: 3, packing: 'stream' });
assert.deepEqual([...stream.glyphs[0]], [1, 0, 1, 0, 1, 1]);
assert.equal(stream.glyphs.length, 2);

// text parsing
assert.deepEqual([...parseTextBytes('0x3C, 0x66 /* x */, $7E')], [0x3C, 0x66, 0x7E]);
assert.deepEqual([...parseTextBytes('DATA 60, 102', 'dec')], [60, 102]);
assert.equal(parseCharSpec('U+00A3'), 0xA3);
assert.equal(parseCharSpec('é'), 0xE9);
assert.equal(parseCharSpec('ab'), undefined);
assert.equal(crc32(new TextEncoder().encode('123456789')), 0xCBF43926);

// tracing: a ring has one CCW outer and one CW hole; diagonal pixels stay separate
const ring = new Uint8Array([1, 1, 1, 1, 0, 1, 1, 1, 1]);
const rc = traceBitmap(ring, 3, 3).map((c) => c.map(([x, y]) => ({ x, y: -y })));
assert.equal(rc.length, 2);
assert.deepEqual(rc.map((c) => Math.sign(signedArea(c))).sort(), [-1, 1]);
assert.equal(traceBitmap(new Uint8Array([1, 0, 0, 1]), 2, 2).length, 2);

// end to end
const bm = decodeBitmapFont(sampleFontBytes(), {});
assert.equal(bm.glyphs.length, 96);
const font = buildFont(bm, buildMapping('ascii', 96, { firstCode: 32 }), { familyName: 'Smoke', aspect: 0.75 });
assert.equal(font.glyphs[0].name, '.notdef');
assert.ok(font.glyphs.find((g) => g.name === 'A').contours.every((c) => c.length >= 4));
const ttf = buildTTF(font);
assert.equal(new DataView(ttf.buffer).getUint32(0), 0x00010000);
const woff = await buildWOFF(ttf);
assert.equal(new TextDecoder().decode(woff.slice(0, 4)), 'wOFF');
assert.ok(buildUFOFiles(font).files.some((f) => f.path === 'glyphs/A_.glif'));
assert.match(buildGlyphsFile(font), /glyphname = A;/);
console.log('ok —', font.glyphs.length, 'glyphs,', ttf.length, 'byte TTF,', woff.length, 'byte WOFF');
