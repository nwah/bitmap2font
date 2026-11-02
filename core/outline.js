// Trace pixel bitmaps into polygon outlines.
//
// Contours are built from the boundary edges of inked pixels and merged into
// the minimal set of corner points. Edges are walked clockwise on screen, then
// each loop is reversed so that, in font space (y up), outer contours run
// counter-clockwise: PostScript/UFO/Glyphs direction. Holes come out the other
// way automatically. Pixels touching only at a corner become separate
// contours.

/**
 * @param {Uint8Array} bits w*h row-major
 * @returns {Array<Array<[number,number]>>} contours of corner points in grid coords (y down)
 */
export function traceBitmap(bits, w, h) {
  const filled = (x, y) => x >= 0 && y >= 0 && x < w && y < h && bits[y * w + x] !== 0;
  const W1 = w + 1;
  const edges = [];          // {x,y,dx,dy}
  const outgoing = new Map(); // vertex key -> edge indices
  const add = (x, y, dx, dy) => {
    const k = y * W1 + x;
    const idx = edges.length;
    edges.push({ x, y, dx, dy });
    const list = outgoing.get(k);
    if (list) list.push(idx); else outgoing.set(k, [idx]);
  };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!filled(x, y)) continue;
      if (!filled(x, y - 1)) add(x, y, 1, 0);           // top, rightwards
      if (!filled(x + 1, y)) add(x + 1, y, 0, 1);       // right, downwards
      if (!filled(x, y + 1)) add(x + 1, y + 1, -1, 0);  // bottom, leftwards
      if (!filled(x - 1, y)) add(x, y + 1, 0, -1);      // left, upwards
    }
  }

  // Successor of an edge: at ambiguous (diagonal) vertices prefer a right turn,
  // which keeps diagonal neighbours in separate loops. The rule is a bijection,
  // so following successors always cycles back to the starting edge.
  const next = (e) => {
    const nx = e.x + e.dx, ny = e.y + e.dy;
    const list = outgoing.get(ny * W1 + nx);
    if (list.length === 1) return list[0];
    const prefs = [[-e.dy, e.dx], [e.dx, e.dy], [e.dy, -e.dx]];
    for (const [px, py] of prefs) {
      for (const i of list) if (edges[i].dx === px && edges[i].dy === py) return i;
    }
    return list[0];
  };

  const used = new Uint8Array(edges.length);
  const contours = [];
  for (let s = 0; s < edges.length; s++) {
    if (used[s]) continue;
    const pts = [];
    let i = s;
    do {
      used[i] = 1;
      const e = edges[i];
      pts.push([e.x, e.y, e.dx, e.dy]);
      i = next(e);
    } while (i !== s);
    // keep only corners (direction changes)
    const n = pts.length;
    const corners = [];
    for (let k = 0; k < n; k++) {
      const prev = pts[(k - 1 + n) % n];
      const cur = pts[k];
      if (prev[2] !== cur[2] || prev[3] !== cur[3]) corners.push([cur[0], cur[1]]);
    }
    contours.push(corners.reverse());
  }
  return contours;
}

/** Signed area of a polygon (positive = counter-clockwise in a y-up system). */
export function signedArea(pts) {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], q = pts[(i + 1) % pts.length];
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
}
