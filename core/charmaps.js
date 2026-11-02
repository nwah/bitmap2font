// Character-index → Unicode code point presets for common 8-bit machines.

const CP437_LOW = '\u0000☺☻♥♦♣♠•◘○◙♂♀♪♫☼►◄↕‼¶§▬↨↑↓→←∟↔▲▼';
const CP437_HIGH =
  'ÇüéâäàåçêëèïîìÄÅ' + 'ÉæÆôöòûùÿÖÜ¢£¥₧ƒ' + 'áíóúñÑªº¿⌐¬½¼¡«»' +
  '░▒▓│┤╡╢╖╕╣║╗╝╜╛┐' + '└┴┬├─┼╞╟╚╔╩╦╠═╬╧' + '╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀' +
  'αßΓπΣσµτΦΘΩδ∞φε∩' + '≡±≥≤⌠⌡÷≈°∙·√ⁿ²■ ';

const cp = (s) => s.codePointAt(0);

function cp437(code) {
  if (code < 0 || code > 255) return null;
  if (code === 0) return null;
  if (code < 32) return cp(CP437_LOW[code]);
  if (code === 127) return 0x2302; // ⌂
  if (code < 127) return code;
  return cp(CP437_HIGH[code - 128]);
}

// C64 screen codes 0-63 (shared by both character sets except 1-26).
function c64Common(i) {
  if (i === 0) return 0x40;           // @
  if (i === 27) return 0x5B;          // [
  if (i === 28) return 0xA3;          // £
  if (i === 29) return 0x5D;          // ]
  if (i === 30) return 0x2191;        // ↑
  if (i === 31) return 0x2190;        // ←
  if (i >= 32 && i <= 63) return i;   // space, punctuation, digits
  if (i === 64) return 0x2500;        // ─
  return null;
}

export const PRESETS = {
  ascii: {
    label: 'ASCII (printable 32–126)',
    usesFirstCode: true,
    defaultFirstCode: 0x20,
    map: (i, first) => { const c = first + i; return c >= 32 && c <= 126 ? c : null; },
  },
  latin1: {
    label: 'ISO-8859-1 / Latin-1',
    usesFirstCode: true,
    defaultFirstCode: 0x20,
    map: (i, first) => { const c = first + i; return (c >= 32 && c <= 126) || (c >= 160 && c <= 255) ? c : null; },
  },
  cp437: {
    label: 'IBM PC code page 437',
    usesFirstCode: true,
    defaultFirstCode: 0,
    map: (i, first) => cp437(first + i),
  },
  c64upper: {
    label: 'C64 screen codes (upper/graphics)',
    map: (i) => {
      if (i >= 1 && i <= 26) return 0x40 + i; // A-Z
      return c64Common(i);
    },
  },
  c64lower: {
    label: 'C64 screen codes (lower/upper)',
    map: (i) => {
      if (i >= 1 && i <= 26) return 0x60 + i;  // a-z
      if (i >= 65 && i <= 90) return i;        // A-Z
      return c64Common(i);
    },
  },
  atari: {
    label: 'Atari 8-bit internal codes',
    map: (i) => {
      if (i < 64) return i + 32;                // space .. _
      if (i === 96) return 0x2666;              // ♦
      if (i >= 97 && i <= 122) return i;        // a-z
      if (i === 123) return 0x2660;             // ♠
      if (i === 124) return 0x7C;               // |
      if (i === 126) return 0x25C0;             // ◀
      if (i === 127) return 0x25B6;             // ▶
      return null;
    },
  },
  zx: {
    label: 'ZX Spectrum (ROM font from 32)',
    map: (i) => {
      const c = 32 + i;
      if (c === 0x60) return 0xA3;  // £
      if (c === 0x7F) return 0xA9;  // ©
      return c <= 0x7F ? c : null;
    },
  },
  none: { label: 'None (assign manually)', map: () => null },
};

/**
 * Build a code point array for `count` glyphs.
 * @param {string} preset key of PRESETS
 * @param {number} count
 * @param {{firstCode?:number, puaForUnmapped?:boolean}} opts firstCode = code of glyph #0
 *   (defaults to the preset's default: 0x20 for ASCII/Latin-1, i.e. data starting at space)
 * @returns {(number|null)[]}
 */
export function buildMapping(preset, count, opts = {}) {
  const p = PRESETS[preset] || PRESETS.ascii;
  const first = opts.firstCode ?? p.defaultFirstCode ?? 0x20;
  const out = [];
  for (let i = 0; i < count; i++) {
    let c = p.map(i, first);
    if (c == null && opts.puaForUnmapped) c = 0xE000 + i;
    out.push(c ?? null);
  }
  return out;
}

/**
 * Parse a user-entered character spec. Accepts a single character, "U+XXXX", or "" for none.
 * @returns {number|null|undefined} code point, null for "unmapped", undefined if invalid
 */
export function parseCharSpec(str) {
  if (str == null || str === '') return null;
  const m = String(str).trim().match(/^(?:U\+|\\u|0x)([0-9a-f]{1,6})$/i);
  if (m) {
    const v = parseInt(m[1], 16);
    return v <= 0x10FFFF ? v : undefined;
  }
  const chars = [...String(str)];
  if (chars.length === 1) return chars[0].codePointAt(0);
  return undefined;
}

/** Display form for a code point in an editable field. */
export function formatCharSpec(code) {
  if (code == null) return '';
  // whitespace, controls, combining marks and private-use are shown as U+XXXX
  const ch = String.fromCodePoint(code);
  if (/[\s\p{C}\p{M}]/u.test(ch)) return 'U+' + code.toString(16).toUpperCase().padStart(4, '0');
  return ch;
}

export const uPlus = (code) => 'U+' + code.toString(16).toUpperCase().padStart(4, '0');
