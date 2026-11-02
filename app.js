// Browser UI for bitmap2font. All conversion logic lives in ./core (shared with the Node CLI).
import {
  decodeBitmapFont, parseNumber, parseTextBytes, glyphByteSize,
  PRESETS, buildMapping, parseCharSpec, formatCharSpec, uPlus,
  buildFont, glyphToSvgPath, postscriptName,
  buildTTF, buildWOFF, buildUFOZip, buildGlyphsFile, sampleFontBytes,
  decodeImageSheet, guessImageLayout,
} from './core/index.js';

const IMAGE_EXT = /\.(png|gif|bmp|webp|jpe?g|ico|avif)$/i;

const $ = (id) => document.getElementById(id);
const SVGNS = 'http://www.w3.org/2000/svg';

const state = {
  bytes: null,
  image: null,          // {width, height, data} when the source is a font sheet image
  fileName: '',
  bitmap: null,
  baseMapping: [],
  overrides: new Map(), // glyph index -> code point | null
  font: null,
  fontSettingsTouched: false,
};

// ---------------------------------------------------------------- utilities
function debounce(fn, ms = 120) {
  let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}
function toast(msg) {
  const el = $('toast'); el.textContent = msg; el.hidden = false;
  clearTimeout(toast.t); toast.t = setTimeout(() => (el.hidden = true), 2600);
}
function download(data, name, type) {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
const hex = (n, w = 2) => n.toString(16).toUpperCase().padStart(w, '0');

// ------------------------------------------------------------------ step 1
function decodeOptions() {
  return {
    width: Math.max(1, parseInt($('dWidth').value, 10) || 8),
    height: Math.max(1, parseInt($('dHeight').value, 10) || 8),
    offset: Math.max(0, parseNumber($('dOffset').value) || 0),
    count: Math.max(0, parseInt($('dCount').value, 10) || 0),
    stride: Math.max(0, parseInt($('dStride').value, 10) || 0),
    layout: $('dLayout').value,
    packing: $('dPacking').value,
    bitOrder: $('dBitOrder').value,
    invert: $('dInvert').checked,
  };
}

function imageOptions() {
  const int = (id, d = 0) => Math.max(0, parseInt($(id).value, 10) || d);
  return {
    width: Math.max(1, parseInt($('dWidth').value, 10) || 8),
    height: Math.max(1, parseInt($('dHeight').value, 10) || 8),
    count: int('dCount'),
    scale: Math.max(1, int('iScale', 1)),
    columns: int('iCols'),
    offsetX: int('iOffX'), offsetY: int('iOffY'),
    gapX: int('iGapX'), gapY: int('iGapY'),
    ink: $('iInk').value,
    threshold: +$('iThresh').value,
    invert: $('dInvert').checked,
  };
}

function setMode(image) {
  document.body.classList.toggle('mode-image', image);
}

function familyFromName(name) {
  const base = name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim();
  return base ? base.replace(/\b\w/g, (c) => c.toUpperCase()) : undefined;
}

function applyImageGuess() {
  const g = guessImageLayout(state.image, { ink: $('iInk').value, threshold: +$('iThresh').value });
  $('iScale').value = g.scale;
  $('dWidth').value = g.width;
  $('dHeight').value = g.height;
  $('iCols').value = '';
  for (const id of ['iOffX', 'iOffY', 'iGapX', 'iGapY']) $(id).value = 0;
  return g;
}

function loadImage(image, name) {
  state.image = image;
  state.bytes = null;
  state.fileName = name;
  state.overrides.clear();
  setMode(true);
  $('dCount').value = '';
  $('dInvert').checked = false;
  $('iInk').value = 'auto';
  const g = applyImageGuess();
  const fam = familyFromName(name);
  if (fam) $('fFamily').value = fam;
  $('fileinfo').textContent = `${name} · ${image.width}×${image.height} image`;
  state.fontSettingsTouched = false;
  redecode();
  toast(`Detected ${g.width}×${g.height} glyphs` + (g.scale > 1 ? ` at ${g.scale}× scale` : '') + ' — adjust if needed.');
}

async function imageFromFile(file) {
  const bmp = await createImageBitmap(file);
  const cv = document.createElement('canvas');
  cv.width = bmp.width; cv.height = bmp.height;
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bmp, 0, 0);
  const { data } = ctx.getImageData(0, 0, bmp.width, bmp.height);
  return { width: bmp.width, height: bmp.height, data };
}

function drawSheet() {
  const img = state.image, bm = state.bitmap;
  if (!img || !bm) return;
  const cv = $('sheetCanvas');
  const zoom = Math.max(1, Math.min(8, Math.floor(900 / img.width)));
  cv.width = img.width * zoom; cv.height = img.height * zoom;
  cv.style.width = cv.width + 'px';
  const ctx = cv.getContext('2d');
  const tmp = new OffscreenCanvas(img.width, img.height);
  tmp.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(img.data), img.width, img.height), 0, 0);
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, cv.width, cv.height);
  ctx.drawImage(tmp, 0, 0, cv.width, cv.height);
  // Cell grid drawn in XOR, like a QuickDraw selection: it inverts whatever lies under it.
  const o = imageOptions();
  ctx.globalCompositeOperation = 'difference';
  ctx.strokeStyle = '#fff'; ctx.lineWidth = 1;
  const { w, h, stepX, stepY } = bm.cell;
  for (let i = 0; i < bm.glyphs.length; i++) {
    const x = o.offsetX + (i % bm.columns) * stepX, y = o.offsetY + Math.floor(i / bm.columns) * stepY;
    ctx.strokeRect(x * zoom + 0.5, y * zoom + 0.5, w * zoom - 1, h * zoom - 1);
  }
  ctx.globalCompositeOperation = 'source-over';
  $('sheetInfo').textContent = `· ${img.width}×${img.height}px, ${bm.columns}×${bm.rows} cells`;
}

function loadBytes(bytes, name, hints = {}) {
  state.bytes = bytes;
  state.image = null;
  setMode(false);
  state.fileName = name;
  state.overrides.clear();
  if (hints.offset != null) $('dOffset').value = hints.offset;
  if (hints.width) $('dWidth').value = hints.width;
  if (hints.height) $('dHeight').value = hints.height;
  if (hints.preset) $('mPreset').value = hints.preset;
  if (hints.firstCode != null) $('mFirst').value = '0x' + hints.firstCode.toString(16).toUpperCase();
  if (hints.family) $('fFamily').value = hints.family;
  $('fileinfo').textContent = `${name} · ${bytes.length.toLocaleString()} bytes`;
  state.fontSettingsTouched = false;
  redecode();
}

function guessHints(name, bytes) {
  const ext = name.toLowerCase().split('.').pop();
  const base = name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim();
  const hints = { family: base ? base.replace(/\b\w/g, (c) => c.toUpperCase()) : undefined, offset: 0 };
  // C64 charset files usually carry a 2-byte load address.
  if ((ext === '64c' || ext === 'prg') && bytes.length % 8 === 2) hints.offset = 2;
  if (bytes.length === 4096 || bytes.length === 4098) hints.preset = 'c64upper';
  return hints;
}

function redecode() {
  if (state.image) {
    state.bitmap = decodeImageSheet(state.image, imageOptions());
    const n = state.bitmap.glyphs.length;
    $('decodeInfo').textContent = n
      ? `${n} glyphs from ${state.bitmap.columns}×${state.bitmap.rows} cells of ${state.bitmap.cell.w}×${state.bitmap.cell.h} image px`
      : 'No cells fit in the image with these settings.';
    for (const k of [...state.overrides.keys()]) if (k >= n) state.overrides.delete(k);
    drawSheet();
    remap();
    return;
  }
  if (!state.bytes) return;
  const o = decodeOptions();
  state.bitmap = decodeBitmapFont(state.bytes, o);
  const n = state.bitmap.glyphs.length;
  const per = o.stride || glyphByteSize(o);
  const used = o.offset + n * per;
  $('decodeInfo').textContent = n
    ? `${n} glyphs × ${per} bytes = ${(n * per).toLocaleString()} bytes` +
      (state.bytes.length - used > 0 ? ` · ${(state.bytes.length - used).toLocaleString()} bytes left over` : '')
    : 'Not enough data for one glyph with these settings.';
  for (const k of [...state.overrides.keys()]) if (k >= n) state.overrides.delete(k);
  remap();
}

function remap() {
  if (!state.bitmap) return;
  state.baseMapping = buildMapping($('mPreset').value, state.bitmap.glyphs.length, {
    firstCode: Number.isNaN(parseNumber($('mFirst').value)) ? undefined : parseNumber($('mFirst').value),
    puaForUnmapped: $('mPua').checked,
  });
  renderGlyphGrid();
}

const effective = (i) => (state.overrides.has(i) ? state.overrides.get(i) : state.baseMapping[i]);
const currentMapping = () => state.baseMapping.map((_, i) => effective(i));

function renderGlyphGrid() {
  const grid = $('glyphGrid');
  const bm = state.bitmap;
  grid.textContent = '';
  if (!bm || !bm.glyphs.length) {
    grid.innerHTML = '<div class="empty">No glyphs — check the width, height and offset.</div>';
    updateMapStats();
    return;
  }
  const zoom = +$('zoom').value;
  grid.style.setProperty('--card', Math.max(64, bm.width * zoom + 12) + 'px');
  const frag = document.createDocumentFragment();
  const ink = getComputedStyle(document.documentElement).getPropertyValue('--ink').trim() || '#000';
  bm.glyphs.forEach((bits, i) => {
    const card = document.createElement('div');
    card.className = 'card';
    card.dataset.i = i;
    const cv = document.createElement('canvas');
    cv.width = bm.width; cv.height = bm.height;
    cv.style.width = bm.width * zoom + 'px';
    cv.style.height = bm.height * zoom + 'px';
    const ctx = cv.getContext('2d');
    ctx.fillStyle = ink;
    for (let y = 0; y < bm.height; y++)
      for (let x = 0; x < bm.width; x++) if (bits[y * bm.width + x]) ctx.fillRect(x, y, 1, 1);
    const idx = document.createElement('div');
    idx.className = 'idx'; idx.textContent = `#${i} · $${hex(i)}`;
    const input = document.createElement('input');
    input.type = 'text'; input.spellcheck = false; input.autocomplete = 'off';
    input.setAttribute('aria-label', `Character for glyph ${i}`);
    input.value = formatCharSpec(effective(i));
    const cp = document.createElement('div'); cp.className = 'cp';
    card.append(cv, idx, input, cp);
    frag.appendChild(card);
  });
  grid.appendChild(frag);
  refreshCards();
}

function refreshCards() {
  const counts = new Map();
  const map = currentMapping();
  for (const c of map) if (c != null) counts.set(c, (counts.get(c) || 0) + 1);
  const hide = $('hideUnmapped').checked;
  for (const card of $('glyphGrid').querySelectorAll('.card')) {
    const i = +card.dataset.i;
    const c = map[i];
    const input = card.querySelector('input');
    if (!card.classList.contains('invalid')) {
      card.querySelector('.cp').textContent = c == null ? '—' : uPlus(c);
    }
    input.classList.toggle('wide', input.value.length > 2);
    card.classList.toggle('unmapped', c == null);
    card.classList.toggle('edited', state.overrides.has(i));
    card.classList.toggle('dup', c != null && counts.get(c) > 1);
    card.hidden = hide && c == null && !card.contains(document.activeElement);
  }
  updateMapStats(map, counts);
}

function updateMapStats(map = currentMapping(), counts) {
  const n = map.length;
  const mapped = map.filter((c) => c != null).length;
  const dups = counts ? [...counts.values()].filter((v) => v > 1).length : 0;
  $('mapStats').innerHTML = n
    ? `<b>${mapped}</b> of ${n} glyphs mapped` +
      (state.overrides.size ? ` · ${state.overrides.size} edited` : '') +
      (dups ? ` · <span class="bad">${dups} duplicate code point${dups > 1 ? 's' : ''}</span>` : '')
    : '';
  $('toStep2').disabled = mapped === 0;
}

function onCardInput(e) {
  const input = e.target.closest('.card input');
  if (!input) return;
  const card = input.closest('.card');
  const i = +card.dataset.i;
  const v = parseCharSpec(input.value);
  card.classList.toggle('invalid', v === undefined);
  if (v === undefined) { card.querySelector('.cp').textContent = 'one char or U+XXXX'; return; }
  if (v === state.baseMapping[i]) state.overrides.delete(i); else state.overrides.set(i, v);
  refreshCards();
}
function onCardBlur(e) {
  const input = e.target.closest?.('.card input');
  if (!input) return;
  const card = input.closest('.card');
  if (card.classList.contains('invalid')) return;
  input.value = formatCharSpec(effective(+card.dataset.i));
  refreshCards();
}

// ------------------------------------------------------------------ step 2
function fontSettings() {
  const num = (id) => { const v = parseFloat($(id).value); return Number.isFinite(v) ? v : null; };
  return {
    familyName: $('fFamily').value,
    styleName: $('fStyle').value,
    lineHeight: num('fLine'),
    advance: num('fAdvance'),
    descent: num('fDescent'),
    aspect: num('fAspect') || 1,
    proportional: $('fProp').checked,
    gap: num('fGap') ?? 1,
  };
}

function enterStep2() {
  const bm = state.bitmap;
  if (!state.fontSettingsTouched) {
    $('fLine').value = bm.height;
    $('fAdvance').value = bm.width;
    $('fDescent').value = Math.round(bm.height / 8);
  }
  showStep(2);
  rebuildFont();
}

function showStep(n) {
  $('step1').hidden = n !== 1;
  $('step2').hidden = n !== 2;
  document.querySelectorAll('.step').forEach((b) => b.classList.toggle('active', +b.dataset.step === n));
  document.querySelector('.step[data-step="2"]').disabled = !state.font && n !== 2;
  window.scrollTo(0, 0);
}

let fontFaceSeq = 0;
function rebuildFont() {
  if (!state.bitmap) return;
  state.font = buildFont(state.bitmap, currentMapping(), fontSettings());
  const f = state.font;
  const enc = f.glyphs.filter((g) => g.codes.length).length;
  $('metricsInfo').textContent =
    `${f.unitsPerEm} units/em · pixel ${+f.pixelWidth.toFixed(2)}×${f.pixelHeight} units · ` +
    `${f.isFixedPitch ? 'monospaced' : 'proportional'}`;
  $('glyphCount').textContent = `(${enc} encoded + .notdef)`;
  const ul = $('warnings'); ul.textContent = '';
  for (const w of f.warnings) { const li = document.createElement('li'); li.textContent = w; ul.appendChild(li); }
  renderSample();
  renderVectorGrid();
  renderFontTest();
}

function glyphLookup(font) {
  const m = new Map();
  for (const g of font.glyphs) for (const c of g.codes) m.set(c, g);
  return m;
}

function renderSample() {
  const f = state.font;
  const scale = +$('pScale').value / f.pixelHeight; // screen px per font unit
  const guides = $('pGuides').checked;
  const cmap = glyphLookup(f);
  const notdef = f.glyphs[0];
  const lineAdv = f.ascender - f.descender + f.lineGap;
  const lines = $('sampleText').value.split('\n');
  let maxW = 0;
  const paths = [];
  const guideEls = [];
  lines.forEach((line, li) => {
    const base = f.ascender + li * lineAdv;
    let x = 0;
    for (const ch of line) {
      const g = cmap.get(ch.codePointAt(0)) || notdef;
      if (g.contours.length) paths.push(glyphToSvgPath(g, x, base));
      x += g.advance;
    }
    maxW = Math.max(maxW, x);
    if (guides) guideEls.push({ base, top: li * lineAdv });
  });
  const W = Math.max(maxW, f.pixelHeight);
  const H = Math.max(1, lines.length) * lineAdv;
  $('svgPreview').innerHTML =
    `<svg xmlns="${SVGNS}" viewBox="0 0 ${W} ${H}" width="${W * scale}" height="${H * scale}" shape-rendering="crispEdges">` +
    guideEls.map(({ base, top }) =>
      `<rect class="guide" x="0" y="${top}" width="${W}" height="${lineAdv}"/>` +
      [f.capHeight, f.xHeight].map((h) => `<line class="guide" x1="0" x2="${W}" y1="${base - h}" y2="${base - h}"/>`).join('') +
      `<line class="guide base" x1="0" x2="${W}" y1="${base}" y2="${base}"/>`).join('') +
    `<path class="glyph" d="${paths.join('')}"/></svg>`;
}

function renderVectorGrid() {
  const f = state.font;
  const grid = $('vectorGrid');
  grid.textContent = '';
  const top = Math.max(f.ascender, f.bbox.yMax), bottom = Math.min(f.descender, f.bbox.yMin);
  const frag = document.createDocumentFragment();
  for (const g of f.glyphs) {
    const cell = document.createElement('div');
    cell.className = 'vcell';
    const w = Math.max(g.advance, f.pixelHeight);
    const pad = f.pixelHeight / 2;
    cell.innerHTML =
      `<svg viewBox="${-pad} ${-top - pad} ${w + pad * 2} ${top - bottom + pad * 2}" preserveAspectRatio="xMidYMid meet">` +
      `<rect class="adv" x="0" y="${-f.ascender}" width="${g.advance}" height="${f.ascender - f.descender}"/>` +
      `<line class="guide base" x1="${-pad}" x2="${w + pad}" y1="0" y2="0"/>` +
      `<path d="${glyphToSvgPath(g)}"/></svg>` +
      `<div class="nm" title="${g.name}">${g.codes.length ? uPlus(g.codes[0]) : g.name}</div>`;
    frag.appendChild(cell);
  }
  grid.appendChild(frag);
}

async function renderFontTest() {
  const f = state.font;
  const el = $('fontTest');
  const family = `b2f-preview-${++fontFaceSeq}`;
  try {
    const face = new FontFace(family, buildTTF(f));
    await face.load();
    if (family !== `b2f-preview-${fontFaceSeq}`) return; // superseded
    for (const old of [...document.fonts]) if (old.family.startsWith('b2f-preview-')) document.fonts.delete(old);
    document.fonts.add(face);
    el.style.fontFamily = `"${family}", monospace`;
    el.style.fontSize = (+$('pScale').value * f.source.height) + 'px';
    el.textContent = $('sampleText').value;
  } catch (err) {
    el.textContent = 'The browser could not load the generated font: ' + err.message;
  }
}

async function doExport(kind) {
  const f = state.font;
  if (!f) return;
  const base = postscriptName(f);
  try {
    if (kind === 'ttf') download(buildTTF(f), `${base}.ttf`, 'font/ttf');
    else if (kind === 'woff') download(await buildWOFF(buildTTF(f)), `${base}.woff`, 'font/woff');
    else if (kind === 'ufo') download(buildUFOZip(f), `${base}.ufo.zip`, 'application/zip');
    else if (kind === 'glyphs') download(buildGlyphsFile(f), `${base}.glyphs`, 'text/plain');
  } catch (err) {
    console.error(err);
    toast('Export failed: ' + err.message);
  }
}

// ------------------------------------------------------------------ wiring
function init() {
  const sel = $('mPreset');
  for (const [k, p] of Object.entries(PRESETS)) sel.add(new Option(p.label, k));
  const syncFirst = () => { $('mFirstWrap').hidden = !PRESETS[sel.value].usesFirstCode; };
  syncFirst();

  const fileInput = $('file');
  const drop = $('drop');
  const readFile = async (file) => {
    if (file.type.startsWith('image/') || IMAGE_EXT.test(file.name)) {
      try { return loadImage(await imageFromFile(file), file.name); } catch (err) {
        if (IMAGE_EXT.test(file.name)) return toast(`Could not decode image: ${err.message}`);
      }
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    loadBytes(bytes, file.name, guessHints(file.name, bytes));
  };
  fileInput.addEventListener('change', () => fileInput.files[0] && readFile(fileInput.files[0]));
  drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', (e) => {
    e.preventDefault(); drop.classList.remove('over');
    if (e.dataTransfer.files[0]) readFile(e.dataTransfer.files[0]);
  });
  $('pasteLoad').addEventListener('click', () => {
    const bytes = parseTextBytes($('pasteText').value, $('pasteRadix').value);
    if (!bytes.length) return toast('No bytes found in the pasted text.');
    loadBytes(bytes, 'pasted data', { offset: 0 });
  });
  $('loadSample').addEventListener('click', () => {
    $('dWidth').value = 8; $('dHeight').value = 8; $('dCount').value = ''; $('dStride').value = '';
    $('dLayout').value = 'rows'; $('dPacking').value = 'padded'; $('dBitOrder').value = 'msb'; $('dInvert').checked = false;
    loadBytes(sampleFontBytes(), 'demo font (5×7 in 8×8, ASCII from 32)', { offset: 0, preset: 'ascii', firstCode: 32, family: 'Demo Font' });
    syncFirst();
  });

  const re = debounce(redecode);
  for (const id of ['dWidth', 'dHeight', 'dOffset', 'dCount', 'dStride']) $(id).addEventListener('input', re);
  for (const id of ['dLayout', 'dPacking', 'dBitOrder', 'dInvert', 'iInk']) $(id).addEventListener('change', redecode);
  for (const id of ['iScale', 'iCols', 'iOffX', 'iOffY', 'iGapX', 'iGapY', 'iThresh']) $(id).addEventListener('input', re);
  $('iRedetect').addEventListener('click', () => { if (state.image) { applyImageGuess(); redecode(); } });

  sel.addEventListener('change', () => {
    state.overrides.clear();
    const d = PRESETS[sel.value].defaultFirstCode;
    if (d != null) $('mFirst').value = '0x' + d.toString(16).toUpperCase();
    syncFirst(); remap();
  });
  $('mFirst').addEventListener('input', debounce(() => { state.overrides.clear(); remap(); }));
  $('mPua').addEventListener('change', remap);
  $('mReset').addEventListener('click', () => { state.overrides.clear(); renderGlyphGrid(); });
  $('bulkApply').addEventListener('click', () => {
    if (!state.bitmap) return;
    const start = parseInt($('bulkStart').value, 10) || 0;
    const chars = [...$('bulkText').value];
    chars.forEach((ch, k) => { if (start + k < state.baseMapping.length) state.overrides.set(start + k, ch.codePointAt(0)); });
    renderGlyphGrid();
    toast(`Assigned ${Math.min(chars.length, state.baseMapping.length - start)} characters from #${start}.`);
  });

  const grid = $('glyphGrid');
  grid.addEventListener('input', onCardInput);
  grid.addEventListener('focusout', onCardBlur);
  $('zoom').addEventListener('input', debounce(renderGlyphGrid, 60));
  $('hideUnmapped').addEventListener('change', refreshCards);

  $('toStep2').addEventListener('click', enterStep2);
  $('back').addEventListener('click', () => showStep(1));
  document.querySelectorAll('.step').forEach((b) => b.addEventListener('click', () => {
    if (+b.dataset.step === 1) showStep(1); else if (state.bitmap) enterStep2();
  }));

  const rb = debounce(rebuildFont, 100);
  for (const id of ['fFamily', 'fStyle', 'fLine', 'fAdvance', 'fDescent', 'fGap']) {
    $(id).addEventListener('input', () => { state.fontSettingsTouched = true; rb(); });
  }
  $('fAspect').addEventListener('input', () => {
    state.fontSettingsTouched = true;
    const v = $('fAspect').value;
    $('fAspectPreset').value = [...$('fAspectPreset').options].some((o) => o.value === v) ? v : '';
    rb();
  });
  $('fAspectPreset').addEventListener('change', () => {
    if ($('fAspectPreset').value) { $('fAspect').value = $('fAspectPreset').value; rb(); }
  });
  $('fProp').addEventListener('change', () => { $('fGapWrap').hidden = !$('fProp').checked; rebuildFont(); });
  $('sampleText').addEventListener('input', debounce(() => { renderSample(); renderFontTest(); }, 80));
  $('pScale').addEventListener('input', () => { renderSample(); renderFontTest(); });
  $('pGuides').addEventListener('change', renderSample);
  document.querySelectorAll('[data-export]').forEach((b) => b.addEventListener('click', () => doExport(b.dataset.export)));
}

init();
