// Slicing glyphs out of bitmap font sheet images (PNG, GIF, …).
// Works on plain RGBA pixel data: {width, height, data} as from canvas getImageData or decodePNG.

export const DEFAULT_IMAGE = Object.freeze({
  width: 8,          // glyph width in font pixels
  height: 8,         // glyph height in font pixels
  scale: 1,          // image pixels per font pixel (for upscaled sheets)
  offsetX: 0,        // image px before the first cell (left margin)
  offsetY: 0,        // image px before the first cell (top margin)
  gapX: 0,           // image px between cells horizontally
  gapY: 0,           // image px between cells vertically
  columns: 0,        // cells per row (0 = as many as fit)
  count: 0,          // glyphs to read (0 = all cells)
  ink: 'auto',       // 'auto' | 'dark' | 'light' | 'opaque'
  threshold: 0.5,    // luminance threshold 0..1 for dark/light
  invert: false,
});

const lum = (d, i) => (0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]) / 255;

/** Resolve 'auto' ink mode to a concrete one by looking at the image. */
export function detectInkMode(image) {
  const { data, width, height } = image;
  const n = width * height;
  let transparent = 0;
  const counts = new Map();
  for (let i = 0; i < n; i++) {
    const a = data[i * 4 + 3];
    if (a < 128) { transparent++; continue; }
    const key = ((data[i * 4] >> 4) << 8) | ((data[i * 4 + 1] >> 4) << 4) | (data[i * 4 + 2] >> 4);
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  if (transparent > n * 0.1) return 'opaque';
  let bgKey = 0, best = -1;
  for (const [k, c] of counts) if (c > best) { best = c; bgKey = k; }
  const bgL = (0.2126 * ((bgKey >> 8) & 15) + 0.7152 * ((bgKey >> 4) & 15) + 0.0722 * (bgKey & 15)) / 15;
  return bgL >= 0.5 ? 'dark' : 'light';
}

/** Image → Uint8Array (1 = ink) at image resolution. */
export function binarizeImage(image, opts = {}) {
  const { data, width, height } = image;
  const threshold = opts.threshold ?? 0.5;
  const mode = !opts.ink || opts.ink === 'auto' ? detectInkMode(image) : opts.ink;
  const out = new Uint8Array(width * height);
  for (let p = 0, i = 0; p < out.length; p++, i += 4) {
    const opaque = data[i + 3] >= 128;
    let v;
    if (mode === 'opaque') v = opaque;
    else if (!opaque) v = false;
    else v = mode === 'dark' ? lum(data, i) < threshold : lum(data, i) >= threshold;
    out[p] = (v ? 1 : 0) ^ (opts.invert ? 1 : 0);
  }
  return out;
}

const gcd = (a, b) => { while (b) [a, b] = [b, a % b]; return a; };

/**
 * Size of one font pixel in image pixels for upscaled sheets: the GCD of all
 * ink/paper run lengths that do not touch the image edge.
 */
export function detectPixelScale(bin, width, height) {
  let g = 0;
  const scan = (len, get) => {
    let run = 0, start = 0;
    for (let k = 0; k <= len; k++) {
      if (k > 0 && (k === len || get(k) !== get(k - 1))) {
        if (start > 0 && k < len) { g = gcd(g, run); if (g === 1) return true; }
        start = k; run = 0;
      }
      run++;
    }
    return false;
  };
  for (let y = 0; y < height; y++) if (scan(width, (x) => bin[y * width + x])) return 1;
  for (let x = 0; x < width; x++) if (scan(height, (y) => bin[y * width + x])) return 1;
  return g || 1;
}

/**
 * Guess scale, glyph size and columns for a sheet that has no margins or gutters.
 */
export function guessImageLayout(image, opts = {}) {
  const bin = binarizeImage(image, opts);
  const scale = detectPixelScale(bin, image.width, image.height);
  const W = Math.floor(image.width / scale), H = Math.floor(image.height / scale);
  // Score every (w, h) that tiles the image exactly. Prefer near-square cells,
  // 16/32 columns and the glyph counts typical of 8-bit fonts.
  const COMMON_COUNTS = new Set([59, 60, 64, 94, 95, 96, 128, 160, 192, 224, 256, 512]);
  let best = null;
  for (let w = 3; w <= 32; w++) {
    if (W % w) continue;
    for (let h = 3; h <= 32; h++) {
      if (H % h) continue;
      const cols = W / w, cells = cols * (H / h);
      const score = Math.abs(Math.log(h / w / 1.1)) * 2 +
        ([16, 32].includes(cols) ? 0 : [8, 10, 12, 20, 24, 64].includes(cols) ? 0.5 : 1) +
        (COMMON_COUNTS.has(cells) ? 0 : 1.5) + (w === 8 ? 0 : 0.25);
      if (!best || score < best.score) best = { score, w, h, cols };
    }
  }
  const width = best ? best.w : Math.min(W, 8);
  const height = best ? best.h : Math.min(H, 8);
  const columns = best ? best.cols : 0;
  return { scale, width, height, columns, ink: opts.ink && opts.ink !== 'auto' ? opts.ink : detectInkMode(image) };
}

/**
 * Slice a sheet into glyph bitmaps (same shape as decodeBitmapFont's result).
 * @returns {{width:number,height:number,glyphs:Uint8Array[],columns:number,rows:number,available:number,cell:{w:number,h:number}}}
 */
export function decodeImageSheet(image, options = {}) {
  const o = { ...DEFAULT_IMAGE, ...options };
  const w = Math.max(1, o.width | 0), h = Math.max(1, o.height | 0);
  const scale = Math.max(1, +o.scale || 1);
  const cellW = w * scale, cellH = h * scale;
  const stepX = cellW + (o.gapX | 0), stepY = cellH + (o.gapY | 0);
  const offX = o.offsetX | 0, offY = o.offsetY | 0;
  const fitCols = Math.max(0, Math.floor((image.width - offX - cellW) / stepX) + 1);
  const columns = o.columns > 0 ? Math.min(o.columns | 0, fitCols) : fitCols;
  const rows = Math.max(0, Math.floor((image.height - offY - cellH) / stepY) + 1);
  const available = columns * rows;
  const count = Math.min(o.count > 0 ? o.count : available, available, 65535);
  const bin = binarizeImage(image, o);
  const half = Math.floor(scale / 2);
  const glyphs = [];
  for (let i = 0; i < count; i++) {
    const cx = offX + (i % columns) * stepX, cy = offY + Math.floor(i / columns) * stepY;
    const g = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
      const iy = Math.min(image.height - 1, Math.floor(cy + y * scale + half));
      for (let x = 0; x < w; x++) {
        const ix = Math.min(image.width - 1, Math.floor(cx + x * scale + half));
        g[y * w + x] = bin[iy * image.width + ix];
      }
    }
    glyphs.push(g);
  }
  return { width: w, height: h, glyphs, columns, rows, available, cell: { w: cellW, h: cellH, stepX, stepY } };
}
