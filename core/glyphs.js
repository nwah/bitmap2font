// Glyphs 3 (.glyphs) source writer.

const BARE = /^[A-Za-z_.][A-Za-z0-9_.]*$/;
const str = (s) => {
  s = String(s);
  if (BARE.test(s) && !/^\.?\d/.test(s)) return s;
  return '"' + s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n') + '"';
};

function metricValue(pos, over) {
  const parts = [];
  if (over) parts.push(`over = ${over};`);
  if (pos) parts.push(`pos = ${pos};`);
  return `{\n${parts.join('\n')}${parts.length ? '\n' : ''}}`;
}

/**
 * Serialize a font model (from buildFont) as a Glyphs 3 file.
 * @returns {string}
 */
export function buildGlyphsFile(font, { date = new Date() } = {}) {
  const [maj, min] = String(font.version).split('.').map((n) => parseInt(n, 10) || 0);
  const px = font.pixelHeight;
  const d = date.toISOString().replace('T', ' ').replace(/\.\d+Z$/, ' +0000');

  const glyphs = font.glyphs.map((g) => {
    const shapes = g.contours.map((c) =>
      `{\nclosed = 1;\nnodes = (\n${c.map((p) => `(${p.x},${p.y},l)`).join(',\n')}\n);\n}`);
    const layer = `{\nlayerId = m01;\n${shapes.length ? `shapes = (\n${shapes.join(',\n')}\n);\n` : ''}width = ${g.advance};\n}`;
    let uni = '';
    if (g.codes.length === 1) uni = `unicode = ${g.codes[0]};\n`;
    else if (g.codes.length > 1) uni = `unicode = (${g.codes.join(',')});\n`;
    return `{\nglyphname = ${str(g.name)};\nlayers = (\n${layer}\n);\n${uni}}`;
  });

  return `{
.appVersion = "3260";
.formatVersion = 3;
customParameters = (
{
name = "Use Typo Metrics";
value = 1;
},
{
name = isFixedPitch;
value = ${font.isFixedPitch ? 1 : 0};
}
);
date = ${str(d)};
familyName = ${str(font.familyName)};
fontMaster = (
{
id = m01;
metricValues = (
${metricValue(font.ascender, px)},
${metricValue(font.capHeight, px)},
${metricValue(font.xHeight, px)},
${metricValue(0, -px)},
${metricValue(font.descender, -px)}
);
name = ${str(font.styleName)};
}
);
glyphs = (
${glyphs.join(',\n')}
);
metrics = (
{
type = ascender;
},
{
type = "cap height";
},
{
type = "x-height";
},
{
type = baseline;
},
{
type = descender;
}
);
unitsPerEm = ${font.unitsPerEm};
versionMajor = ${maj};
versionMinor = ${min};
}
`;
}
