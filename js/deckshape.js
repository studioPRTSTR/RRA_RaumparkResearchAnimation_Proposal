/* ==========================================================================
   deckshape.js — the Raumpark's irregular, street-following outline
   --------------------------------------------------------------------------
   The deck is described as a set of overlapping rectangles (arms along the
   streets, platforms over the intersections, plug-in pieces over the blocks).
   This module merges them into one orthogonal polyline outline, the way a
   metabolist structure grows piece by piece along the street network.
   ========================================================================== */

/** Is (x, y) on the deck? */
export function insideRects(rects, x, y) {
  for (const [x0, y0, x1, y1] of rects) if (x >= x0 && x <= x1 && y >= y0 && y <= y1) return true;
  return false;
}

/**
 * Outline loops of the union of rectangles, counter-clockwise, with collinear
 * points removed. Rectangles are rasterised at `res` metres (coordinates should
 * be multiples of it), boundary cell edges are collected and chained into loops.
 * @returns {Array<Array<[number, number]>>}
 */
export function rectsToOutline(rects, res = 2) {
  const xs = rects.flatMap((r) => [r[0], r[2]]), ys = rects.flatMap((r) => [r[1], r[3]]);
  const X0 = Math.min(...xs), Y0 = Math.min(...ys);
  const W = Math.round((Math.max(...xs) - X0) / res), H = Math.round((Math.max(...ys) - Y0) / res);
  const filled = (i, j) => i >= 0 && j >= 0 && i < W && j < H
    && insideRects(rects, X0 + (i + 0.5) * res, Y0 + (j + 0.5) * res);
  const grid = Array.from({ length: W }, (_, i) => Array.from({ length: H }, (_, j) => filled(i, j)));
  const on = (i, j) => i >= 0 && j >= 0 && i < W && j < H && grid[i][j];

  // directed boundary edges with the deck on the left-hand side
  const next = new Map();
  const key = (i, j) => `${i},${j}`;
  // a vertex can have two outgoing edges where pieces touch only at a corner
  const add = (a, b) => { const k = key(...a); if (!next.has(k)) next.set(k, []); next.get(k).push(b); };
  for (let i = 0; i < W; i++) {
    for (let j = 0; j < H; j++) {
      if (!grid[i][j]) continue;
      if (!on(i, j - 1)) add([i, j], [i + 1, j]);         // south side, walking east
      if (!on(i + 1, j)) add([i + 1, j], [i + 1, j + 1]); // east side, walking north
      if (!on(i, j + 1)) add([i + 1, j + 1], [i, j + 1]); // north side, walking west
      if (!on(i - 1, j)) add([i, j + 1], [i, j]);         // west side, walking south
    }
  }

  const loops = [];
  while (next.size) {
    const [startKey] = next.keys();
    let cur = startKey.split(',').map(Number);
    const loop = [];
    for (;;) {
      const k = key(...cur);
      const list = next.get(k);
      if (!list) break;
      const n = list.pop();
      if (!list.length) next.delete(k);
      loop.push(cur);
      cur = n;
      if (key(...cur) === startKey) break;
    }
    // drop collinear points
    const pts = loop.filter((p, idx) => {
      const a = loop[(idx - 1 + loop.length) % loop.length], b = loop[(idx + 1) % loop.length];
      return (p[0] - a[0]) * (b[1] - p[1]) - (p[1] - a[1]) * (b[0] - p[0]) !== 0;
    });
    loops.push(pts.map(([i, j]) => [X0 + i * res, Y0 + j * res]));
  }
  // largest loop first (the outline; any others would be holes)
  return loops.sort((a, b) => Math.abs(area(b)) - Math.abs(area(a)));
}

/** Signed polygon area (shoelace). */
export function area(loop) {
  let s = 0;
  for (let i = 0; i < loop.length; i++) {
    const [x0, y0] = loop[i], [x1, y1] = loop[(i + 1) % loop.length];
    s += x0 * y1 - x1 * y0;
  }
  return s / 2;
}

/** Deck surface in m² (outline minus holes). */
export function deckArea(loops) {
  return Math.round(loops.reduce((n, l, i) => n + (i === 0 ? Math.abs(area(l)) : -Math.abs(area(l))), 0));
}

/** Bounding box of the rectangles. */
export function bounds(rects) {
  return {
    x0: Math.min(...rects.map((r) => r[0])), y0: Math.min(...rects.map((r) => r[1])),
    x1: Math.max(...rects.map((r) => r[2])), y1: Math.max(...rects.map((r) => r[3])),
  };
}
