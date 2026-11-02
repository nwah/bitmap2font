// Minimal TrueType (glyf) font writer, plus WOFF 1.0 wrapper.

import { postscriptName } from './font.js';

class Writer {
  constructor(size = 1024) { this.buf = new Uint8Array(size); this.view = new DataView(this.buf.buffer); this.pos = 0; }
  ensure(n) {
    if (this.pos + n <= this.buf.length) return;
    let len = this.buf.length * 2; while (len < this.pos + n) len *= 2;
    const nb = new Uint8Array(len); nb.set(this.buf); this.buf = nb; this.view = new DataView(nb.buffer);
  }
  u8(v) { this.ensure(1); this.view.setUint8(this.pos, v); this.pos += 1; return this; }
  i8(v) { this.ensure(1); this.view.setInt8(this.pos, v); this.pos += 1; return this; }
  u16(v) { this.ensure(2); this.view.setUint16(this.pos, v & 0xFFFF); this.pos += 2; return this; }
  i16(v) { this.ensure(2); this.view.setInt16(this.pos, v); this.pos += 2; return this; }
  u32(v) { this.ensure(4); this.view.setUint32(this.pos, v >>> 0); this.pos += 4; return this; }
  i32(v) { this.ensure(4); this.view.setInt32(this.pos, v); this.pos += 4; return this; }
  tag(s) { for (let i = 0; i < 4; i++) this.u8(s.charCodeAt(i) || 32); return this; }
  bytes(b) { this.ensure(b.length); this.buf.set(b, this.pos); this.pos += b.length; return this; }
  pad4() { while (this.pos % 4) this.u8(0); return this; }
  done() { return this.buf.slice(0, this.pos); }
}

function checksum(bytes) {
  const n = Math.ceil(bytes.length / 4) * 4;
  let sum = 0;
  for (let i = 0; i < n; i += 4) {
    const v = ((bytes[i] || 0) << 24) | ((bytes[i + 1] || 0) << 16) | ((bytes[i + 2] || 0) << 8) | (bytes[i + 3] || 0);
    sum = (sum + (v >>> 0)) >>> 0;
  }
  return sum;
}

const clampI16 = (v) => Math.max(-32768, Math.min(32767, Math.round(v)));

// Seconds between 1904-01-01 and 1970-01-01.
const MAC_EPOCH = 2082844800;
function longDateTime(w, date) {
  const secs = Math.floor(date.getTime() / 1000) + MAC_EPOCH;
  w.u32(Math.floor(secs / 4294967296)); w.u32(secs >>> 0);
}

function encodeGlyph(g) {
  if (!g.contours.length) return { data: new Uint8Array(0), xMin: 0, yMin: 0, xMax: 0, yMax: 0, points: 0 };
  // TrueType wants clockwise outer contours: reverse the PostScript-direction model contours.
  const contours = g.contours.map((c) => [c[0], ...c.slice(1).reverse()]);
  let xMin = Infinity, yMin = Infinity, xMax = -Infinity, yMax = -Infinity;
  const pts = [];
  const ends = [];
  for (const c of contours) {
    for (const p of c) {
      pts.push(p);
      if (p.x < xMin) xMin = p.x; if (p.x > xMax) xMax = p.x;
      if (p.y < yMin) yMin = p.y; if (p.y > yMax) yMax = p.y;
    }
    ends.push(pts.length - 1);
  }
  const w = new Writer(64 + pts.length * 5);
  w.i16(contours.length).i16(xMin).i16(yMin).i16(xMax).i16(yMax);
  for (const e of ends) w.u16(e);
  w.u16(0); // instructionLength
  const flags = [], xs = new Writer(), ys = new Writer();
  let px = 0, py = 0;
  for (const p of pts) {
    let f = 0x01; // on-curve
    const dx = p.x - px, dy = p.y - py;
    if (dx === 0) f |= 0x10;
    else if (Math.abs(dx) < 256) { f |= 0x02; if (dx > 0) f |= 0x10; xs.u8(Math.abs(dx)); }
    else xs.i16(dx);
    if (dy === 0) f |= 0x20;
    else if (Math.abs(dy) < 256) { f |= 0x04; if (dy > 0) f |= 0x20; ys.u8(Math.abs(dy)); }
    else ys.i16(dy);
    flags.push(f);
    px = p.x; py = p.y;
  }
  // run-length compress flags
  for (let i = 0; i < flags.length;) {
    let run = 1;
    while (i + run < flags.length && flags[i + run] === flags[i] && run < 256) run++;
    if (run > 1) { w.u8(flags[i] | 0x08).u8(run - 1); i += run; }
    else { w.u8(flags[i]); i++; }
  }
  w.bytes(xs.done()).bytes(ys.done());
  return { data: w.done(), xMin, yMin, xMax, yMax, points: pts.length, contours: contours.length };
}

function buildCmap(font) {
  const pairs = [];
  font.glyphs.forEach((g, gid) => g.codes.forEach((c) => pairs.push([c, gid])));
  pairs.sort((a, b) => a[0] - b[0]);
  const bmp = pairs.filter(([c]) => c <= 0xFFFF);
  const needs12 = pairs.some(([c]) => c > 0xFFFF);

  // Format 4: merge runs where both code and gid are consecutive.
  const segs = [];
  for (const [c, g] of bmp) {
    const last = segs[segs.length - 1];
    if (last && c === last.end + 1 && g - c === last.delta) last.end = c;
    else segs.push({ start: c, end: c, delta: g - c });
  }
  segs.push({ start: 0xFFFF, end: 0xFFFF, delta: 1 });
  const segX2 = segs.length * 2;
  const es = Math.floor(Math.log2(segs.length));
  const sr = 2 * 2 ** es;
  const f4 = new Writer();
  f4.u16(4).u16(16 + segs.length * 8).u16(0).u16(segX2).u16(sr).u16(es).u16(segX2 - sr);
  for (const s of segs) f4.u16(s.end);
  f4.u16(0);
  for (const s of segs) f4.u16(s.start);
  for (const s of segs) f4.u16(s.delta & 0xFFFF);
  for (const _ of segs) f4.u16(0);
  const f4b = f4.done();

  let f12b = null;
  if (needs12) {
    const groups = [];
    for (const [c, g] of pairs) {
      const last = groups[groups.length - 1];
      if (last && c === last.end + 1 && g === last.gid + (c - last.start)) last.end = c;
      else groups.push({ start: c, end: c, gid: g });
    }
    const f12 = new Writer();
    f12.u16(12).u16(0).u32(16 + groups.length * 12).u32(0).u32(groups.length);
    for (const gr of groups) f12.u32(gr.start).u32(gr.end).u32(gr.gid);
    f12b = f12.done();
  }

  const recs = [[0, 3, f4b], [3, 1, f4b]];
  if (f12b) recs.push([0, 4, f12b], [3, 10, f12b]);
  const w = new Writer();
  w.u16(0).u16(recs.length);
  let off = 4 + recs.length * 8;
  const offsets = new Map();
  for (const [, , sub] of recs) if (!offsets.has(sub)) { offsets.set(sub, off); off += sub.length; }
  for (const [p, e, sub] of recs) w.u16(p).u16(e).u32(offsets.get(sub));
  for (const sub of offsets.keys()) w.bytes(sub);
  return w.done();
}

function buildName(font) {
  const ps = postscriptName(font);
  const full = font.styleName === 'Regular' ? font.familyName : `${font.familyName} ${font.styleName}`;
  const records = [
    [1, font.familyName],
    [2, font.styleName],
    [3, `${font.version};${ps}`],
    [4, full],
    [5, `Version ${font.version}`],
    [6, ps],
    [10, 'Generated by bitmap2font'],
  ];
  const strings = records.map(([id, s]) => {
    const w = new Writer();
    for (const ch of s) {
      const cp = ch.codePointAt(0);
      if (cp > 0xFFFF) { const v = cp - 0x10000; w.u16(0xD800 + (v >> 10)).u16(0xDC00 + (v & 0x3FF)); }
      else w.u16(cp);
    }
    return [id, w.done()];
  });
  const w = new Writer();
  w.u16(0).u16(strings.length).u16(6 + strings.length * 12);
  let off = 0;
  for (const [id, b] of strings) { w.u16(3).u16(1).u16(0x409).u16(id).u16(b.length).u16(off); off += b.length; }
  for (const [, b] of strings) w.bytes(b);
  return w.done();
}

/**
 * Serialize a font model (from buildFont) as a TrueType .ttf.
 * @returns {Uint8Array}
 */
export function buildTTF(font, { date = new Date() } = {}) {
  const enc = font.glyphs.map(encodeGlyph);
  const numGlyphs = font.glyphs.length;

  // glyf + loca (long offsets)
  const glyf = new Writer();
  const loca = new Writer();
  for (const e of enc) { loca.u32(glyf.pos); glyf.bytes(e.data); glyf.pad4(); }
  loca.u32(glyf.pos);

  const bb = font.bbox;
  let maxPoints = 0, maxContours = 0, advMax = 0, minLsb = 32767, minRsb = 32767, xMaxExtent = -32768, advSum = 0, advCount = 0;
  font.glyphs.forEach((g, i) => {
    const e = enc[i];
    maxPoints = Math.max(maxPoints, e.points);
    maxContours = Math.max(maxContours, g.contours.length);
    advMax = Math.max(advMax, g.advance);
    if (g.advance > 0) { advSum += g.advance; advCount++; }
    if (g.contours.length) {
      minLsb = Math.min(minLsb, e.xMin);
      minRsb = Math.min(minRsb, g.advance - e.xMax);
      xMaxExtent = Math.max(xMaxExtent, e.xMax);
    }
  });
  if (minLsb === 32767) { minLsb = 0; minRsb = 0; xMaxExtent = 0; }

  const head = new Writer();
  head.u32(0x00010000).u32(0x00010000).u32(0).u32(0x5F0F3CF5)
    .u16(0x0009).u16(font.unitsPerEm);
  longDateTime(head, date); longDateTime(head, date);
  head.i16(clampI16(bb.xMin)).i16(clampI16(bb.yMin)).i16(clampI16(bb.xMax)).i16(clampI16(bb.yMax))
    .u16(0).u16(8).i16(2).i16(1).i16(0);

  const hhea = new Writer();
  hhea.u32(0x00010000).i16(font.ascender).i16(font.descender).i16(font.lineGap)
    .u16(advMax).i16(minLsb).i16(minRsb).i16(xMaxExtent)
    .i16(1).i16(0).i16(0).i16(0).i16(0).i16(0).i16(0).i16(0).u16(numGlyphs);

  const hmtx = new Writer();
  font.glyphs.forEach((g, i) => hmtx.u16(Math.max(0, g.advance)).i16(enc[i].data.length ? enc[i].xMin : 0));

  const maxp = new Writer();
  maxp.u32(0x00010000).u16(numGlyphs).u16(maxPoints).u16(maxContours).u16(0).u16(0)
    .u16(2).u16(0).u16(0).u16(0).u16(0).u16(0).u16(0).u16(0).u16(0);

  const codes = font.glyphs.flatMap((g) => g.codes).sort((a, b) => a - b);
  const os2 = new Writer();
  const upm = font.unitsPerEm;
  const winAscent = Math.max(font.ascender, bb.yMax, 0);
  const winDescent = Math.max(-font.descender, -bb.yMin, 0);
  os2.u16(4)
    .i16(advCount ? Math.round(advSum / advCount) : 0) // xAvgCharWidth
    .u16(400).u16(5).u16(0) // weight, width, fsType (installable)
    .i16(Math.round(upm * 0.65)).i16(Math.round(upm * 0.6)).i16(0).i16(Math.round(upm * 0.075)) // subscript
    .i16(Math.round(upm * 0.65)).i16(Math.round(upm * 0.6)).i16(0).i16(Math.round(upm * 0.35)) // superscript
    .i16(font.pixelHeight).i16(Math.round(font.xHeight / 2)) // strikeout size, position
    .i16(0); // sFamilyClass
  os2.bytes(new Uint8Array([2, 0, 5, 0, 0, 0, 0, 0, 0, 0]).map((v, i) => (i === 3 && font.isFixedPitch ? 9 : v)));
  const ur = unicodeRanges(codes);
  os2.u32(ur[0]).u32(ur[1]).u32(ur[2]).u32(ur[3]);
  os2.tag('B2F ');
  os2.u16(0x40 | 0x80) // REGULAR | USE_TYPO_METRICS
    .u16(Math.min(codes[0] ?? 0x20, 0xFFFF)).u16(Math.min(codes[codes.length - 1] ?? 0x20, 0xFFFF))
    .i16(font.ascender).i16(font.descender).i16(font.lineGap)
    .u16(winAscent).u16(winDescent)
    .u32(0x00000001).u32(0) // ulCodePageRange: Latin 1
    .i16(font.xHeight).i16(font.capHeight).u16(0).u16(0x20).u16(1);

  const post = new Writer();
  post.u32(0x00030000).u32(0)
    .i16(-Math.round(font.pixelHeight)).i16(font.pixelHeight)
    .u32(font.isFixedPitch ? 1 : 0).u32(0).u32(0).u32(0).u32(0);

  const tables = {
    'OS/2': os2.done(), cmap: buildCmap(font), glyf: glyf.done(), head: head.done(),
    hhea: hhea.done(), hmtx: hmtx.done(), loca: loca.done(), maxp: maxp.done(),
    name: buildName(font), post: post.done(),
  };
  return assembleSfnt(tables);
}

function assembleSfnt(tables) {
  const tags = Object.keys(tables).sort();
  const n = tags.length;
  const es = Math.floor(Math.log2(n));
  const sr = 16 * 2 ** es;
  const w = new Writer();
  w.u32(0x00010000).u16(n).u16(sr).u16(es).u16(n * 16 - sr);
  let off = 12 + n * 16;
  const placed = [];
  for (const t of tags) {
    const data = tables[t];
    w.tag(t).u32(checksum(data)).u32(off).u32(data.length);
    placed.push([t, off, data]);
    off += Math.ceil(data.length / 4) * 4;
  }
  for (const [, , data] of placed) { w.bytes(data); w.pad4(); }
  const out = w.done();
  // head.checkSumAdjustment
  const headOff = placed.find(([t]) => t === 'head')[1];
  const adj = (0xB1B0AFBA - checksum(out)) >>> 0;
  new DataView(out.buffer).setUint32(headOff + 8, adj);
  return out;
}

// OS/2 ulUnicodeRange bits for common blocks.
function unicodeRanges(codes) {
  const r = [0, 0, 0, 0];
  const set = (bit) => { r[bit >> 5] |= 1 << (bit & 31); r[bit >> 5] >>>= 0; };
  const blocks = [
    [0x0000, 0x007F, 0], [0x0080, 0x00FF, 1], [0x0100, 0x017F, 2], [0x0370, 0x03FF, 7],
    [0x2000, 0x206F, 31], [0x20A0, 0x20CF, 33], [0x2190, 0x21FF, 37], [0x2200, 0x22FF, 38],
    [0x2300, 0x23FF, 39], [0x2500, 0x257F, 43], [0x2580, 0x259F, 44], [0x25A0, 0x25FF, 45],
    [0x2600, 0x26FF, 46], [0xE000, 0xF8FF, 60], [0x10000, 0x10FFFF, 57],
  ];
  for (const c of codes) for (const [a, b, bit] of blocks) if (c >= a && c <= b) set(bit);
  return r;
}

/** Wrap a TTF in WOFF 1.0 with zlib-compressed tables. Async (uses CompressionStream). */
export async function buildWOFF(ttf) {
  const dv = new DataView(ttf.buffer, ttf.byteOffset, ttf.byteLength);
  const numTables = dv.getUint16(4);
  const entries = [];
  for (let i = 0; i < numTables; i++) {
    const p = 12 + i * 16;
    const tag = String.fromCharCode(ttf[p], ttf[p + 1], ttf[p + 2], ttf[p + 3]);
    const csum = dv.getUint32(p + 4), off = dv.getUint32(p + 8), len = dv.getUint32(p + 12);
    const orig = ttf.slice(off, off + len);
    let comp = await zlibCompress(orig);
    if (comp.length >= orig.length) comp = orig;
    entries.push({ tag, csum, orig, comp });
  }
  const totalSfntSize = 12 + 16 * numTables + entries.reduce((a, e) => a + Math.ceil(e.orig.length / 4) * 4, 0);
  const w = new Writer();
  w.tag('wOFF').u32(0x00010000).u32(0).u16(numTables).u16(0).u32(totalSfntSize)
    .u16(1).u16(0).u32(0).u32(0).u32(0).u32(0).u32(0);
  let off = 44 + 20 * numTables;
  for (const e of entries) {
    w.tag(e.tag).u32(off).u32(e.comp.length).u32(e.orig.length).u32(e.csum);
    e.off = off; off += Math.ceil(e.comp.length / 4) * 4;
  }
  for (const e of entries) { w.bytes(e.comp); w.pad4(); }
  const out = w.done();
  new DataView(out.buffer).setUint32(8, out.length);
  return out;
}

async function zlibCompress(bytes) {
  const cs = new CompressionStream('deflate'); // RFC 1950 zlib, as WOFF requires
  const stream = new Blob([bytes]).stream().pipeThrough(cs);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
