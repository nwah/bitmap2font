# bitmap2font

Turn bitmap font data from 8-bit computers (C64, ZX Spectrum, Atari, BBC Micro, MSX, CPC, PC BIOS ROMs, LCD fonts…) into vector fonts:

- **UFO 3** source (RoboFont, FontForge, fontmake): `.ufo.zip` from the browser, or a plain `.ufo` folder from the CLI
- **TrueType** `.ttf`
- **WOFF** `.woff`
- **Glyphs 3** `.glyphs`

No build step and no dependencies. Everything runs locally in the browser or under Node.

## Web tool

ES modules need to be served over HTTP; opening `index.html` from `file://` won't work. Any static server will do:

```sh
npm run serve        # python3 -m http.server 8000, then open http://localhost:8000
```

1. **Import & map**: drop a binary, a font sheet image (PNG, GIF, BMP, WebP…), or paste a hex dump / C array. Set the glyph width and height, a start offset (e.g. `2` for C64 `.64c` files with a load address), bit order, row or column byte layout, and byte-aligned or bitstream packing. For images, the tool auto-detects the pixel scale of upscaled sheets, the glyph size and columns, and the ink colour (dark on light, light on dark, or opaque on transparent). Margins and gutters between cells can be set by hand, and a grid overlay on the source image shows the alignment. Every decoded glyph appears as a pixel preview with an editable character field. By default the data is assumed to start at a space (0x20), followed by `!`, `"`, `#` and so on. Change “Code of glyph #0” if yours starts elsewhere. Presets cover ASCII, Latin-1, CP437, C64 screen codes (both sets), Atari internal codes and the ZX Spectrum ROM. You can type any character or `U+XXXX`, or assign a whole run of characters at once.
2. **Vector & export**: an SVG preview of your sample text and every glyph, plus the same text rendered by your browser from the generated TTF. Adjust the line height and letter spacing (they default to the glyph's pixel height and width), the descender rows (baseline), the pixel aspect ratio for non-square-pixel machines, and optional proportional spacing. Then export.

The interface is styled after System 6. Its two typefaces are produced by bitmap2font itself: **Lakeshore**, an original 12px UI font drawn as text in `fonts/src/lakeshore.txt`, and **Sampler Mono**, the built-in 5×7 demo font (plus a few symbols). `npm run fonts` rebuilds `fonts/*.woff` after editing the pixel source.

### Deploying to GitHub Pages

`.github/workflows/pages.yml` runs the tests, rebuilds the UI fonts and publishes `index.html`, `app.js`, `styles.css`, `core/` and `fonts/*.woff` on every push to `main`. Enable it once under the repo's **Settings → Pages → Source: GitHub Actions**.

## Node / offline use

The conversion code in `core/` is pure JS (ES modules, Node ≥ 18) and is shared by the web UI and the CLI.

```sh
node cli/bitmap2font.mjs chargen.bin -w 8 -h 8 --preset c64upper --count 128 \
     --family "Breadbin" --aspect 0.9365 -o out/
node cli/bitmap2font.mjs font.h --hex -w 8 -h 8 --formats ttf,woff          # data starts at space (0x20)
node cli/bitmap2font.mjs pcbios.rom --preset cp437 -h 8                     # full 256-char table from 0
node cli/bitmap2font.mjs sheet.png --family "Sheet Font"                    # PNG font sheet, layout auto-detected
node cli/bitmap2font.mjs sheet.png -w 8 -h 8 --margin-x 4 --gutter-x 2 --gutter-y 2
node cli/bitmap2font.mjs --help
```

```js
import { decodeBitmapFont, buildMapping, buildFont, buildTTF, buildWOFF,
         buildUFOFiles, buildGlyphsFile } from './core/index.js';

const bitmap = decodeBitmapFont(bytes, { width: 8, height: 8, offset: 0 });
const mapping = buildMapping('ascii', bitmap.glyphs.length);   // glyph #0 = space (0x20)
mapping[0x60 - 32] = 0xA3;                       // override single glyphs: index -> code point
const font = buildFont(bitmap, mapping, { familyName: 'My Font', aspect: 0.75 });
const ttf = buildTTF(font);                       // Uint8Array
const woff = await buildWOFF(ttf);                // Uint8Array
const { dirName, files } = buildUFOFiles(font);   // [{ path, data }]
const glyphs = buildGlyphsFile(font);             // string
```

| Module | Purpose |
| --- | --- |
| `core/decode.js` | bytes → per-glyph pixel grids; hex/C-array parsing |
| `core/image.js` | RGBA font sheet → glyph grids; ink/scale/layout detection |
| `core/png.js` | dependency-free PNG decoder (the CLI's image input; browsers use canvas) |
| `core/charmaps.js` | glyph index → Unicode presets, `U+XXXX` parsing |
| `core/outline.js` | pixel grid → merged polygon contours (no overlaps, correct winding) |
| `core/font.js` | builds the format-neutral font model: metrics, spacing, aspect ratio |
| `core/ttf.js` | TrueType (`glyf`) writer and WOFF 1.0 wrapper |
| `core/ufo.js`, `core/glyphs.js` | UFO 3 and Glyphs 3 source writers |
| `core/zip.js` | minimal ZIP writer used for the `.ufo.zip` download |

## How the outlines are built

Each pixel is `unitsPerPixel` (100) font units tall and `100 × aspect` wide. The em is the glyph cell height, so an 8-pixel font has 800 UPM and renders pixel-perfect at font sizes that are multiples of 8px. Adjacent pixels merge into single contours with only their corner points. Holes wind the opposite way, and pixels that touch only at a corner become separate contours, so there are no overlaps for downstream tools to remove. Any extra line height is split evenly above the ascender and below the descender (typo metrics are used, `USE_TYPO_METRICS` is set).

`npm test` runs a quick self-check of the core.
