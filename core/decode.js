// Decoding raw bitmap font bytes into per-glyph pixel grids.
// Pure JS, no DOM. Each glyph is a Uint8Array of width*height (row-major, 1 = ink).

/** Parse "0x1F", "$1F", "&H1F", "1Fh" or decimal. Returns NaN on failure. */
export function parseNumber(str) {
  if (typeof str === 'number') return str;
  const s = String(str ?? '').trim();
  if (s === '') return NaN;
  let m;
  if ((m = s.match(/^(?:0x|\$|&h)([0-9a-f]+)$/i))) return parseInt(m[1], 16);
  if ((m = s.match(/^([0-9a-f]+)h$/i))) return parseInt(m[1], 16);
  if (/^\d+$/.test(s)) return parseInt(s, 10);
  return NaN;
}

/**
 * Parse hex dumps / C arrays / BASIC DATA lines into bytes.
 * radix 'hex': accepts 0x.., $.., &H.., or bare hex pairs. radix 'dec': decimal numbers.
 */
export function parseTextBytes(text, radix = 'hex') {
  const out = [];
  // strip C/C++ comments
  const src = String(text).replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/.*$/gm, ' ');
  if (radix === 'dec') {
    for (const m of src.matchAll(/\b\d+\b/g)) out.push(parseInt(m[0], 10) & 255);
    return new Uint8Array(out);
  }
  const prefixed = [...src.matchAll(/(?:0x|\$|&h)([0-9a-f]{1,2})\b/gi)];
  if (prefixed.length) {
    for (const m of prefixed) out.push(parseInt(m[1], 16));
  } else {
    // bare hex: split on non-hex, and break long runs into pairs
    for (const tok of src.split(/[^0-9a-f]+/i)) {
      if (!tok) continue;
      if (tok.length <= 2) out.push(parseInt(tok, 16));
      else for (let i = 0; i + 1 < tok.length; i += 2) out.push(parseInt(tok.slice(i, i + 2), 16));
    }
  }
  return new Uint8Array(out);
}

export const DEFAULT_DECODE = Object.freeze({
  offset: 0,          // bytes to skip at start of data
  width: 8,           // glyph width in pixels
  height: 8,          // glyph height in pixels
  count: 0,           // number of glyphs (0 = as many as fit)
  layout: 'rows',     // 'rows': each byte holds horizontal pixels; 'cols': each byte holds vertical pixels
  packing: 'padded',  // 'padded': each row/column starts on a byte; 'stream': continuous bitstream
  bitOrder: 'msb',    // 'msb': bit 7 is leftmost/topmost pixel; 'lsb': bit 0 is
  invert: false,      // swap ink/paper
  stride: 0,          // bytes from one glyph to the next (0 = auto)
});

/** Bytes each glyph occupies with the given options (before any custom stride). */
export function glyphByteSize(o) {
  const rows = o.layout !== 'cols';
  const minorLen = rows ? o.width : o.height;
  const majorLen = rows ? o.height : o.width;
  if (o.packing === 'stream') return (o.width * o.height) / 8;
  return Math.ceil(minorLen / 8) * majorLen;
}

/**
 * Decode glyph bitmaps.
 * @param {Uint8Array} bytes
 * @param {object} options see DEFAULT_DECODE
 * @returns {{width:number,height:number,glyphs:Uint8Array[],strideBits:number,available:number}}
 */
export function decodeBitmapFont(bytes, options = {}) {
  const o = { ...DEFAULT_DECODE, ...options };
  const w = Math.max(1, o.width | 0), h = Math.max(1, o.height | 0);
  const rows = o.layout !== 'cols';
  const minorLen = rows ? w : h;
  const majorLen = rows ? h : w;
  const unitBytes = Math.ceil(minorLen / 8);
  const charBits = o.packing === 'stream' ? w * h : unitBytes * majorLen * 8;
  const strideBits = o.stride > 0 ? o.stride * 8 : charBits;
  const offset = Math.max(0, o.offset | 0);
  const totalBits = bytes.length * 8;
  const availBits = totalBits - offset * 8;
  const available = availBits >= charBits ? Math.floor((availBits - charBits) / strideBits) + 1 : 0;
  const count = Math.min(o.count > 0 ? o.count : available, available, 65535);

  const bitAt = (bitIdx) => {
    const b = bytes[bitIdx >> 3];
    const k = bitIdx & 7;
    return o.bitOrder === 'lsb' ? (b >> k) & 1 : (b >> (7 - k)) & 1;
  };

  const glyphs = [];
  for (let i = 0; i < count; i++) {
    const base = offset * 8 + i * strideBits;
    const g = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const major = rows ? y : x, minor = rows ? x : y;
        let bitIdx;
        if (o.packing === 'stream') bitIdx = base + major * minorLen + minor;
        else bitIdx = base + (major * unitBytes + (minor >> 3)) * 8 + (minor & 7);
        let v = bitIdx < totalBits ? bitAt(bitIdx) : 0;
        if (o.invert) v ^= 1;
        g[y * w + x] = v;
      }
    }
    glyphs.push(g);
  }
  return { width: w, height: h, glyphs, strideBits, available };
}

/** Ink bounds of a glyph bitmap, or null if empty. */
export function inkBounds(bits, w, h) {
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      if (bits[y * w + x]) {
        if (x < x0) x0 = x; if (x > x1) x1 = x;
        if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
  return x1 < 0 ? null : { x0, y0, x1, y1 };
}
