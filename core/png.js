// Dependency-free PNG decoder (all bit depths and color types, Adam7 included).
// Used by the Node CLI; the browser decodes images natively via canvas.

async function zlibInflate(bytes) {
  const ds = new DecompressionStream('deflate');
  const stream = new Blob([bytes]).stream().pipeThrough(ds);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

const SIG = [137, 80, 78, 71, 13, 10, 26, 10];
const CHANNELS = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };
const ADAM7 = [[0, 0, 8, 8], [4, 0, 8, 8], [0, 4, 4, 8], [2, 0, 4, 4], [0, 2, 2, 4], [1, 0, 2, 2], [0, 1, 1, 2]];

export const isPNG = (b) => SIG.every((v, i) => b[i] === v);

/**
 * @param {Uint8Array} bytes
 * @returns {Promise<{width:number,height:number,data:Uint8ClampedArray}>} RGBA
 */
export async function decodePNG(bytes, inflate = zlibInflate) {
  if (!isPNG(bytes)) throw new Error('not a PNG file');
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let pos = 8, ihdr = null, palette = null, trns = null;
  const idat = [];
  while (pos + 8 <= bytes.length) {
    const len = dv.getUint32(pos);
    const type = String.fromCharCode(...bytes.subarray(pos + 4, pos + 8));
    const body = bytes.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') {
      ihdr = { width: dv.getUint32(pos + 8), height: dv.getUint32(pos + 12), depth: body[8], color: body[9], interlace: body[12] };
    } else if (type === 'PLTE') palette = body;
    else if (type === 'tRNS') trns = body;
    else if (type === 'IDAT') idat.push(body);
    else if (type === 'IEND') break;
    pos += 12 + len;
  }
  if (!ihdr) throw new Error('PNG has no IHDR');
  const { width, height, depth, color, interlace } = ihdr;
  const ch = CHANNELS[color];
  if (!ch) throw new Error(`unsupported PNG color type ${color}`);
  const joined = new Uint8Array(idat.reduce((a, b) => a + b.length, 0));
  let o = 0; for (const c of idat) { joined.set(c, o); o += c.length; }
  const raw = await inflate(joined);

  const out = new Uint8ClampedArray(width * height * 4);
  const bpp = Math.max(1, (ch * depth) >> 3);
  const maxV = (1 << depth) - 1;
  let rp = 0;

  const pass = (x0, y0, dx, dy) => {
    const pw = Math.ceil((width - x0) / dx), ph = Math.ceil((height - y0) / dy);
    if (pw <= 0 || ph <= 0) return;
    const stride = Math.ceil((pw * ch * depth) / 8);
    let prev = new Uint8Array(stride), cur = new Uint8Array(stride);
    for (let y = 0; y < ph; y++) {
      const filter = raw[rp++];
      cur.set(raw.subarray(rp, rp + stride)); rp += stride;
      for (let i = 0; i < stride; i++) {
        const a = i >= bpp ? cur[i - bpp] : 0, b = prev[i], c = i >= bpp ? prev[i - bpp] : 0;
        let v = cur[i];
        if (filter === 1) v += a;
        else if (filter === 2) v += b;
        else if (filter === 3) v += (a + b) >> 1;
        else if (filter === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
        cur[i] = v & 255;
      }
      const sample = (idx) => {
        if (depth === 8) return cur[idx];
        if (depth === 16) return (cur[idx * 2] << 8) | cur[idx * 2 + 1];
        const bit = idx * depth;
        return (cur[bit >> 3] >> (8 - depth - (bit & 7))) & maxV;
      };
      const to8 = (v) => (depth === 16 ? v >> 8 : depth === 8 ? v : Math.round((v * 255) / maxV));
      for (let x = 0; x < pw; x++) {
        const di = (((y0 + y * dy) * width) + x0 + x * dx) * 4;
        const s = x * ch;
        let r, g, b, al = 255;
        if (color === 0 || color === 4) {
          const v = sample(s); r = g = b = to8(v);
          if (color === 4) al = to8(sample(s + 1));
          else if (trns && trns.length >= 2 && v === ((trns[0] << 8) | trns[1])) al = 0;
        } else if (color === 2 || color === 6) {
          const rv = sample(s), gv = sample(s + 1), bv = sample(s + 2);
          r = to8(rv); g = to8(gv); b = to8(bv);
          if (color === 6) al = to8(sample(s + 3));
          else if (trns && trns.length >= 6 && rv === ((trns[0] << 8) | trns[1]) && gv === ((trns[2] << 8) | trns[3]) && bv === ((trns[4] << 8) | trns[5])) al = 0;
        } else {
          const idx = sample(s);
          r = palette?.[idx * 3] ?? 0; g = palette?.[idx * 3 + 1] ?? 0; b = palette?.[idx * 3 + 2] ?? 0;
          if (trns && idx < trns.length) al = trns[idx];
        }
        out[di] = r; out[di + 1] = g; out[di + 2] = b; out[di + 3] = al;
      }
      [prev, cur] = [cur, prev];
    }
  };
  if (interlace) for (const p of ADAM7) pass(...p);
  else pass(0, 0, 1, 1);
  return { width, height, data: out };
}
