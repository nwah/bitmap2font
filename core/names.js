// Production glyph names (AGL-compatible for ASCII, uniXXXX otherwise).

const ASCII_NAMES = [
  'space', 'exclam', 'quotedbl', 'numbersign', 'dollar', 'percent', 'ampersand', 'quotesingle',
  'parenleft', 'parenright', 'asterisk', 'plus', 'comma', 'hyphen', 'period', 'slash',
  'zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine',
  'colon', 'semicolon', 'less', 'equal', 'greater', 'question', 'at',
];
const EXTRA = {
  0x5B: 'bracketleft', 0x5C: 'backslash', 0x5D: 'bracketright', 0x5E: 'asciicircum',
  0x5F: 'underscore', 0x60: 'grave', 0x7B: 'braceleft', 0x7C: 'bar', 0x7D: 'braceright',
  0x7E: 'asciitilde', 0xA0: 'uni00A0', 0xA3: 'sterling', 0xA9: 'copyright',
};

export function glyphNameFor(code) {
  if (code >= 0x20 && code <= 0x40) return ASCII_NAMES[code - 0x20];
  if ((code >= 0x41 && code <= 0x5A) || (code >= 0x61 && code <= 0x7A)) return String.fromCharCode(code);
  if (EXTRA[code]) return EXTRA[code];
  const hex = code.toString(16).toUpperCase();
  return code <= 0xFFFF ? 'uni' + hex.padStart(4, '0') : 'u' + hex.padStart(5, '0');
}

/** UFO user-name-to-file-name convention (UFO 3 spec). */
export function ufoFileName(name, existing) {
  const illegal = /["*+/:<>?[\\\]|\u0000-\u001F\u007F]/g;
  let base = name.replace(illegal, '_');
  if (base.startsWith('.')) base = '_' + base.slice(1);
  base = base.replace(/[A-Z]/g, (c) => c + '_');
  const reserved = /^(con|prn|aux|clock\$|nul|a:-z:|com\d|lpt\d)$/i;
  base = base.split('.').map((p) => (reserved.test(p) ? '_' + p : p)).join('.');
  base = base.slice(0, 250);
  let file = base + '.glif';
  let n = 1;
  while (existing && existing.has(file.toLowerCase())) file = `${base}${String(n++).padStart(15, '0')}.glif`;
  existing?.add(file.toLowerCase());
  return file;
}
