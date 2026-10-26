/* ==========================================================================
   storyboard.js — storyboard player: one big screen, an edit timeline to jump
   between shots, and the description of the shot on screen
   --------------------------------------------------------------------------
   Content comes from data/storyboard.json. Each shot has a "sketch" key that
   picks one of the SVG generators below. Sketches are deliberately schematic
   (line drawings, a few moving parts): they propose an idea, not a final look.
   ========================================================================== */

import { CONFIG } from './config.js';
import { sunPosition, sunVector } from './sun.js';
import { rectsToOutline, insideRects, bounds } from './deckshape.js';
import { VIENNA } from './vienna.js';

const C30 = Math.cos(Math.PI / 6);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const tc = (s) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(Math.round(s % 60)).padStart(2, '0')}`;
const f = (n) => n.toFixed(1);
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

/* -------------------------------------------------------------------------
   Tiny isometric helpers for the sketches (camera from the south-west)
   ------------------------------------------------------------------------- */

/** Projection: world metres (x east, y north, z up) → SVG coordinates (true isometric). */
const isoP = (ox, oy, s) => (x, y, z = 0) => [ox + (x - y) * C30 * s, oy - ((x + y) * 0.5 + z) * s];
const pts = (P, list) => list.map(([x, y, z]) => P(x, y, z).map(f).join(',')).join(' ');

/* Solids are drawn in the line style of the Hairline figures (js/hairline/): a rounded footprint,
   one filled silhouette (the hull of its base and top rings) with no vertical corner lines, the
   top face as a fill only, and one dim crease along the top's near edges. Colour stays in the
   fills: f-s (sides) and f-t (top); k-sil is the silhouette's stroke, k-cr the crease's. */

/** A rounded rectangle as a ring of samples {x, y, nx, ny}, counter-clockwise. */
function ringPts(x0, y0, x1, y1, r, n = 3) {
  r = Math.max(0, Math.min(r, (x1 - x0) / 2, (y1 - y0) / 2));
  const out = [];
  for (const [cx, cy, a0] of [[x1 - r, y0 + r, -0.5], [x1 - r, y1 - r, 0], [x0 + r, y1 - r, 0.5], [x0 + r, y0 + r, 1]]) {
    for (let k = 0; k <= n; k++) {
      const a = (a0 + k / n / 2) * Math.PI;
      out.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r, nx: Math.cos(a), ny: Math.sin(a) });
    }
  }
  return out;
}

/** The samples that face the south-west camera, as one run in ring order. */
function frontRun(ring) {
  const fr = (q) => -q.nx - q.ny > 1e-6, n = ring.length;
  const s = ring.findIndex((q, i) => fr(q) && !fr(ring[(i - 1 + n) % n]));
  const out = [];
  for (let i = s; out.length < n && fr(ring[i % n]); i++) out.push(ring[i % n]);
  return out;
}

/** Convex hull of screen points (monotone chain). */
function hull(ps) {
  const p = ps.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const half = (list) => {
    const h = [];
    for (const q of list) { while (h.length > 1 && cross(h[h.length - 2], h[h.length - 1], q) <= 0) h.pop(); h.push(q); }
    return h.slice(0, -1);
  };
  return half(p).concat(half(p.reverse()));
}
const dPath = (ps, close = true) => `M${ps.map((q) => q.map(f).join(',')).join(' L')}${close ? 'Z' : ''}`;

function box(P, b, cls = '') {
  const { x0, y0, x1, y1, z0 = 0, z1 } = b;
  const w = Math.min(x1 - x0, y1 - y0), r = Math.min(2.5, w / 4), ins = Math.min(0.9, w / 6);
  const ring = ringPts(x0, y0, x1, y1, r);
  const sil = dPath(hull(ring.flatMap((q) => [P(q.x, q.y, z0), P(q.x, q.y, z1)])));
  const top = dPath(ring.map((q) => P(q.x, q.y, z1)));
  const crease = dPath(frontRun(ringPts(x0 + ins, y0 + ins, x1 - ins, y1 - ins, r - ins)).map((q) => P(q.x, q.y, z1)), false);
  return `<g class="${cls}"><path class="f-s" d="${sil}"/><path class="f-t" d="${top}"/><path class="k-sil nf" d="${sil}"/><path class="k-cr nf" d="${crease}"/></g>`;
}

/** SVG path for several loops (outline + holes), to be filled with fill-rule evenodd. */
const loopsPath = (P, loops, z, dx = 0, dy = 0) =>
  loops.map((l) => `M${l.map(([x, y]) => P(x + dx, y + dy, z).map(f).join(',')).join(' L')}Z`).join(' ');

/**
 * A thin slab from outline loops (outer outline + holes), drawn as the Hairline figures draw a
 * plate: its underside as a second outline for the thickness (dim), then the top surface with
 * its openings and the silhouette stroke.
 */
function slab(P, loops, z0, z1, cls = '') {
  return `<g class="${cls}"><path class="f-s k-cr" fill-rule="evenodd" d="${loopsPath(P, loops, z0)}"/>
    <path class="f-t k-sil" fill-rule="evenodd" d="${loopsPath(P, loops, z1)}"/></g>`;
}

/* A schematic Westbahnhof district on a straight isometric grid. Its footprint is irregular: a
   stepped cluster of Gründerzeit perimeter blocks (one house per parcel, varied depths and eave
   heights, pitched roofs, open courtyards, now and then an inner wing or one large building),
   the station hall and two parks, on a base plate that follows the blocks. Around it the rest
   of the city is only hinted at as faint footprints. The proposal stays plain boxes: a branching
   deck on 6 pylons along the streets. */
const DISTRICT = (() => {
  let seed = 7;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
  const split = (len) => {                           // parcel widths along a street front
    const out = [];
    for (let t = 0; t < len;) {
      let w = [11, 13, 15, 17][Math.floor(rnd() * 4)];
      if (len - t - w < 9) w = len - t;
      out.push([t, t + w]);
      t += w;
    }
    return out;
  };
  const parcels = [];
  const parcel = (x0, y0, x1, y1, ridge, floorsMin = 4) => {
    const floors = floorsMin + Math.floor(rnd() * 3);  // 4–6 storeys
    const flat = !ridge || rnd() < 0.12;             // occasional later infill with a flat roof
    parcels.push({
      x0, y0, x1, y1, z0: 0,
      z1: +(4.5 + floors * 3.4 + (flat ? 2 : 0)).toFixed(1),
      ridge: flat ? null : ridge,
      rh: flat ? 0 : 4 + rnd() * 2.5,
      chimney: !flat && rnd() < 0.5,
    });
  };

  // Blocks on the 80 m grid (block 60 m + street 20 m). The irregular, stepped footprint comes
  // from which blocks belong to the district: [i, j, kind]
  const CELLS = [
    [2, -1], [3, -1, 'park'],
    [0, 0, 'hall'], [1, 0, 'hall'], [2, 0], [3, 0],
    [-1, 1], [0, 1], [1, 1], [2, 1], [3, 1],
    [-1, 2, 'park'], [0, 2], [1, 2], [2, 2], [3, 2],
    [0, 3], [1, 3], [2, 3],
  ];
  const parks = [];
  for (const [i, j, kind] of CELLS) {
    const bx = i * 80, by = j * 80;
    if (kind === 'hall') continue;
    if (kind === 'park') {
      const trees = Array.from({ length: 9 }, () => [bx + 8 + rnd() * 44, by + 8 + rnd() * 44, 3 + rnd() * 2.5]);
      parks.push({ x0: bx, y0: by, x1: bx + 60, y1: by + 60, trees });
      continue;
    }
    if (rnd() < 0.12) {                              // one large later building on the whole block
      parcel(bx + 4, by + 4, bx + 56, by + 56, null, 6);
      continue;
    }
    const DEPTH = 11 + Math.floor(rnd() * 5);        // 11–15 m deep street fronts
    const open = rnd() < 0.18 ? Math.floor(rnd() * 2) : -1;   // sometimes one side stays open
    split(60).forEach(([a, b]) => parcel(bx + a, by, bx + b, by + DEPTH, 'x'));
    if (open !== 0) split(60).forEach(([a, b]) => parcel(bx + a, by + 60 - DEPTH, bx + b, by + 60, 'x'));
    split(60 - 2 * DEPTH).forEach(([a, b]) => parcel(bx, by + DEPTH + a, bx + DEPTH, by + DEPTH + b, 'y'));
    if (open !== 1) split(60 - 2 * DEPTH).forEach(([a, b]) => parcel(bx + 60 - DEPTH, by + DEPTH + a, bx + 60, by + DEPTH + b, 'y'));
    if (rnd() < 0.35) {                              // an inner wing across the courtyard
      const y = by + 26 + rnd() * 8;
      parcel(bx + DEPTH, y, bx + 60 - DEPTH, y + 9, 'x');
    }
  }
  const hall = { x0: 0, y0: 0, x1: 140, y1: 60, z1: 14, hall: true };

  // Base plate: every block plus half the street around it, merged into one stepped outline.
  const plateRects = CELLS.map(([i, j]) => [i * 80 - 12, j * 80 - 12, i * 80 + 72, j * 80 + 72]);
  const plate = { rects: plateRects, loops: rectsToOutline(plateRects), ...bounds(plateRects) };
  // Context: the surrounding city as faint footprints.
  const inDistrict = new Set(CELLS.map(([i, j]) => `${i},${j}`));
  const context = [];
  for (let i = -4; i <= 7; i++) for (let j = -4; j <= 6; j++) {
    if (!inDistrict.has(`${i},${j}`)) context.push({ x0: i * 80, y0: j * 80, x1: i * 80 + 60, y1: j * 80 + 60 });
  }

  // The Raumpark grows along the streets (x = 70 / 150 / 230, y = 70 / 150):
  // arms over the streets, platforms over the intersections, plug-ins over the blocks.
  const rects = [
    [40, 58, 260, 82], [56, 138, 284, 162],               // arms along the east-west streets
    [58, 50, 82, 178], [138, 26, 162, 196], [218, 40, 242, 170], // arms along the north-south streets
    [46, 46, 96, 94], [206, 48, 256, 96], [48, 130, 92, 172], [210, 128, 258, 174], // intersection platforms
    [118, 118, 190, 184],                                 // central platform
    [96, 84, 120, 104], [186, 96, 214, 122], [162, 40, 186, 58], [256, 170, 276, 188], [100, 160, 118, 188], // plug-ins
  ];
  const loops = rectsToOutline(rects);
  // Deck height is not fixed yet: the sketches use a neutral height and never label it.
  const deck = { rects, loops, outline: loops[0], z0: 43, z1: 46, ...bounds(rects) };
  const pylons = [[70, 70], [150, 70], [230, 70], [70, 150], [150, 150], [230, 150]]
    .map(([x, y]) => ({ x0: x - 4, y0: y - 4, x1: x + 4, y1: y + 4, z1: 43, pylon: true }));
  return { parcels, hall, parks, plate, context, deck, pylons, center: [110, 110] };
})();

/**
 * A Gründerzeit house in the same line style: walls and pitched roof are one convex solid, so one
 * silhouette; the roof planes and the gable are fills only; one dim crease runs along the eave,
 * up the gable and along the ridge. Maybe a chimney.
 */
function house(P, b) {
  const { x0, y0, x1, y1, z0 = 0, z1, ridge, rh } = b;
  if (!ridge) return box(P, b, 'sb-block');
  const poly = (cls, list) => `<polygon class="${cls}" points="${pts(P, list)}"/>`;
  const zr = z1 + rh, xc = (x0 + x1) / 2, yc = (y0 + y1) / 2;
  const R = ridge === 'x' ? [[x0, yc, zr], [x1, yc, zr]] : [[xc, y0, zr], [xc, y1, zr]];
  const corners = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]].flatMap(([x, y]) => [P(x, y, z0), P(x, y, z1)]);
  const sil = dPath(hull([...corners, ...R.map((q) => P(...q))]));
  let s = `<g class="sb-block"><path class="f-s" d="${sil}"/>`;
  let crease, chimney = null;
  if (ridge === 'x') {
    s += poly('sb-roof r-back', [[x0, yc, zr], [x1, yc, zr], [x1, y1, z1], [x0, y1, z1]])
      + poly('sb-roof r-front', [[x0, y0, z1], [x1, y0, z1], [x1, yc, zr], [x0, yc, zr]])
      + poly('r-gable', [[x0, y0, z1], [x0, y1, z1], [x0, yc, zr]]);
    crease = [[x1, y0, z1], [x0, y0, z1], [x0, yc, zr], [x1, yc, zr]];
    if (b.chimney) { const cx = x0 + (x1 - x0) * 0.3; chimney = { x0: cx - 0.8, x1: cx + 0.8, y0: yc - 0.8, y1: yc + 0.8 }; }
  } else {
    s += poly('sb-roof r-back', [[xc, y0, zr], [xc, y1, zr], [x1, y1, z1], [x1, y0, z1]])
      + poly('sb-roof r-front', [[x0, y0, z1], [x0, y1, z1], [xc, y1, zr], [xc, y0, zr]])
      + poly('r-gable', [[x0, y0, z1], [x1, y0, z1], [xc, y0, zr]]);
    crease = [[x0, y1, z1], [x0, y0, z1], [xc, y0, zr], [xc, y1, zr]];
    if (b.chimney) { const cy = y0 + (y1 - y0) * 0.6; chimney = { x0: xc - 0.8, x1: xc + 0.8, y0: cy - 0.8, y1: cy + 0.8 }; }
  }
  s += `<path class="k-sil nf" d="${sil}"/><path class="k-cr nf" d="${dPath(crease.map((q) => P(...q)), false)}"/></g>`;
  if (chimney) s += box(P, { ...chimney, z0: zr - 1, z1: zr + 1.6 }, 'sb-chimney');
  return s;
}

/** Existing city (+ optional extras such as pylons), sorted far → near. */
function drawCity(P, extras = []) {
  return [...DISTRICT.parcels, DISTRICT.hall, ...extras]
    .sort((a, b) => (b.x0 + b.x1 + b.y0 + b.y1) - (a.x0 + a.x1 + a.y0 + a.y1))
    .map((b) => (b.hall ? box(P, b, 'sb-hall') : b.pylon ? box(P, b, 'sb-pylon') : house(P, b)))
    .join('');
}

function deckSlab(P, dz = 0) {
  const d = DISTRICT.deck;
  return slab(P, d.loops, d.z0 + dz, d.z1 + dz, 'sb-deck');
}

/** The ground: faint context footprints, the district's stepped base plate and its parks. */
function groundSvg(P, { context = true } = {}) {
  const D = DISTRICT;
  const quad = (b, z = 0) => pts(P, [[b.x0, b.y0, z], [b.x1, b.y0, z], [b.x1, b.y1, z], [b.x0, b.y1, z]]);
  const contextSvg = D.context.map((b) => `<polygon class="sb-context" points="${quad(b)}"/>`).join('');
  const parks = D.parks.map((pk) => `<polygon class="sb-park" points="${quad(pk, 0.2)}"/>` + pk.trees
    .slice().sort((a, b) => (b[0] + b[1]) - (a[0] + a[1]))
    .map(([x, y, r]) => { const [cx, cy] = P(x, y, r); return `<circle class="sb-tree" cx="${f(cx)}" cy="${f(cy)}" r="${f((r * (P(1, 0)[0] - P(0, 0)[0])) / C30)}"/>`; })
    .join('')).join('');
  // district outline: the ground plate flat at street level with one crisp edge
  const outline = `<path class="sb-ground sb-plate-edge" fill-rule="evenodd" d="${loopsPath(P, D.plate.loops, 0)}"/>`;
  return `${context ? `<g class="sb-context-g">${contextSvg}</g>` : ''}${outline}${parks}${context ? northArrow(P, 345, -45) : ''}`;
}

function districtBase(P, { deck = true, mark = null, context = true } = {}) {
  const D = DISTRICT;
  const ground = groundSvg(P, { context });
  let city = drawCity(P, D.pylons);
  if (mark) {
    const [x, y, z] = mark;
    const [mx, my] = P(x, y, z);
    city += `<circle class="sb-mark" cx="${f(mx)}" cy="${f(my)}" r="3.2"/><circle class="sb-mark-ring" cx="${f(mx)}" cy="${f(my)}" r="6"/>`;
  }
  return { ground, city, deck: deck ? deckSlab(P) : '' };
}

/* The sketch district's grid is turned against true north (like the real streets
   around Westbahnhof). Viewed from the south-west the sun's daily arc would be seen
   almost edge-on; with the grid turned, the camera looks from the east-south-east
   and the arc opens up. GRID_TURN is added to every sun azimuth. */
const GRID_TURN = 120 * Math.PI / 180;

/**
 * North arrow lying on the ground: a circle (an ellipse in isometric) with one line from its
 * centre to true north. The sketch grid is turned against true north (GRID_TURN).
 */
function northArrow(P, x, y, r = 16) {
  const ring = [];
  for (let k = 0; k < 48; k++) {
    const a = (k / 48) * Math.PI * 2;
    ring.push(P(x + Math.cos(a) * r, y + Math.sin(a) * r, 0).map(f).join(','));
  }
  const [cx, cy] = P(x, y, 0);
  const [nx, ny] = P(x + Math.sin(GRID_TURN) * r * 1.25, y + Math.cos(GRID_TURN) * r * 1.25, 0);
  return `<g class="sb-north"><polygon points="${ring.join(' ')}"/><path d="M${f(cx)} ${f(cy)} L${f(nx)} ${f(ny)}"/></g>`;
}

/** Sun samples for one key date, every 30 min while the sun is clearly up (real Vienna sun positions). */
function sunSamples(dateId = 'jun') {
  const date = CONFIG.sun.dates.find((d) => d.id === dateId);
  const out = [];
  for (let m = 4 * 60; m <= 21 * 60; m += 30) {
    const p = sunPosition(date.day, m, date.tz, CONFIG.site.latitude, CONFIG.site.longitude);
    if (p.altitude > 4 * Math.PI / 180) out.push({ m, ...p, v: sunVector(p.altitude, p.azimuth + GRID_TURN) });
  }
  return out;
}

/** Animated sun on its arc + the deck's shadow sweeping the ground, in sync (21 June by default). */
function sunLayer(P, dur, idp, dateId = 'jun') {
  const D = DISTRICT, S = sunSamples(dateId), R = 150, [cx, cy] = D.center;
  const sunPts = S.map((s) => P(cx + s.v[0] * R, cy + s.v[1] * R, s.v[2] * R));
  const shadowPolys = S.map((s) => {
    // The deck outline pushed away from the sun onto the ground (length capped for low sun).
    const t = Math.min(D.deck.z1 / s.v[2], 140 / Math.hypot(s.v[0], s.v[1]));
    const dx = -s.v[0] * t, dy = -s.v[1] * t;
    return loopsPath(P, D.deck.loops, 0, dx, dy);
  });
  // full day arc (dashed), hour dots
  const arc = [];
  const date = CONFIG.sun.dates.find((d) => d.id === dateId);
  for (let m = 4 * 60; m <= 21 * 60; m += 15) {
    const p = sunPosition(date.day, m, date.tz, CONFIG.site.latitude, CONFIG.site.longitude);
    if (p.altitude <= 0) continue;
    const v = sunVector(p.altitude, p.azimuth + GRID_TURN);
    arc.push(P(cx + v[0] * R, cy + v[1] * R, v[2] * R).map(f).join(','));
  }
  const ticks = sunPts.map(([x, y]) => `<circle class="sb-tick" cx="${f(x)}" cy="${f(y)}" r="1.2"/>`).join('');
  const kt = S.map((_, i) => (i / (S.length - 1)).toFixed(3)).join(';');
  const shadow = `<path class="sb-shadow" fill-rule="evenodd" d="${shadowPolys[0]}">
      <animate id="${idp}-a" attributeName="d" dur="${dur}s" repeatCount="indefinite" keyTimes="${kt}" values="${shadowPolys.join(';')}"/></path>`;
  const arcSvg = `<polyline class="sb-arc" points="${arc.join(' ')}"/>${ticks}`;
  const disc = `<g class="sb-sun"><circle r="7" class="sb-sun-halo"/><circle r="4"/>
      <animateMotion dur="${dur}s" repeatCount="indefinite" keyTimes="${kt}" keyPoints="${kt}" calcMode="linear"
        path="M${sunPts.map(([x, y]) => `${f(x)},${f(y)}`).join(' L')}"/></g>`;
  return { shadow, sun: arcSvg + disc, arc: arcSvg, disc };
}

/* -------------------------------------------------------------------------
   Uses on the deck: every use is a cluster of plain boxes ([x0, y0, x1, y1, h]
   in world metres on the deck top), shared by the use shots, the solar
   diagram and the layer explosion.
   ------------------------------------------------------------------------- */

const USES = (() => {
  const z = DISTRICT.deck.z1;
  const defs = {
    culture: { n: 1, label: 'CULTURE', tags: 'PAVILIONS · EVENT SPACE',
      boxes: [[50, 50, 72, 66, 7], [76, 52, 92, 64, 5], [52, 72, 66, 90, 6], [98, 86, 116, 100, 4]] },
    health: { n: 2, label: 'HEALTH & WELLBEING', tags: 'SPORT · POOL · WELLBEING',
      boxes: [[210, 52, 234, 66, 4], [238, 54, 252, 90, 1.5], [212, 74, 228, 92, 6], [190, 98, 210, 114, 5]] },
    res: { n: 3, label: 'RESIDENTIAL', tags: 'HOUSING VOLUMES',
      boxes: [[122, 160, 150, 182, 14], [156, 164, 186, 182, 11], [124, 122, 144, 140, 16], [160, 122, 186, 140, 9]] },
    green: { n: 4, label: 'GREEN AREAS', tags: 'PLANTED AREAS · SHADE',
      boxes: [[50, 134, 90, 148, 2], [52, 152, 70, 170, 3], [74, 154, 90, 170, 1.5], [212, 132, 236, 150, 2.5], [240, 150, 256, 172, 2],
        [100, 140, 116, 160, 2], [102, 166, 116, 186, 3], [140, 186, 160, 196, 2], [104, 62, 128, 78, 2], [170, 62, 200, 78, 2.5]] },
  };
  for (const [k, u] of Object.entries(defs)) {
    u.items = u.boxes.map(([x0, y0, x1, y1, h]) => ({ x0, y0, x1, y1, z0: z, z1: z + h, use: k }));
  }
  return defs;
})();
const ALL_USE_BOXES = Object.values(USES).flatMap((u) => u.items);
const byDepth = (a, b) => (b.x0 + b.x1 + b.y0 + b.y1) - (a.x0 + a.x1 + a.y0 + a.y1);

/** All use boxes; `focus` (a use key, 'all' or null) decides which ones get colour. */
function useBoxes(P, focus, dz = 0) {
  return ALL_USE_BOXES.slice().sort(byDepth).map((b, i) => {
    const lit = focus === 'all' || b.use === focus;
    const svg = box(P, { ...b, z0: b.z0 + dz, z1: b.z1 + dz }, `use-box use-${b.use} ${lit ? 'is-focus' : 'is-muted'}`);
    return lit && focus !== 'all' ? `<g class="use-fade" style="--d:${(i % 6) * 0.2}s">${svg}</g>` : svg;
  }).join('');
}

/** Mini plan of the deck outline (grid north up) with the focused use's boxes. */
function locator(focus) {
  const d = DISTRICT.deck, k = 48 / (d.x1 - d.x0);
  const pl = (x, y) => `${f((x - d.x0) * k)},${f((d.y1 - y) * k)}`;
  const outline = d.loops.map((l) => `M${l.map(([x, y]) => pl(x, y)).join(' L')}Z`).join(' ');
  const boxes = ALL_USE_BOXES.map((b) =>
    `<rect class="use-loc use-${b.use}${b.use === focus ? ' is-focus' : ''}" x="${f((b.x0 - d.x0) * k)}" y="${f((d.y1 - b.y1) * k)}" width="${f((b.x1 - b.x0) * k)}" height="${f((b.y1 - b.y0) * k)}"/>`).join('');
  return `<g transform="translate(258 10)">
    <path class="use-loc-deck" fill-rule="evenodd" d="${outline}"/>${boxes}
</g>`;
}

/** One use shot: the same isometric view of the whole deck, one use's boxes in colour. */
function useShot(focus) {
  const P = isoP(122, 190, 0.68);
  return `
    <rect class="sb-bg" width="320" height="180"/>
    <g class="use-below">${drawCity(P, DISTRICT.pylons)}</g>
    ${deckSlab(P)}
    ${useBoxes(P, focus)}
    ${locator(focus)}`;
}

/* -------------------------------------------------------------------------
   Solar income on the deck: relative yearly sun on each 6 m cell
   ------------------------------------------------------------------------- */

/** Ray from p in direction v hits an axis-aligned box? (slab method) */
function rayBox(p, v, b) {
  let t0 = 0, t1 = Infinity;
  for (const [o, d, lo, hi] of [[p[0], v[0], b.x0, b.x1], [p[1], v[1], b.y0, b.y1], [p[2], v[2], b.z0, b.z1]]) {
    if (Math.abs(d) < 1e-9) { if (o < lo || o > hi) return false; continue; }
    let a = (lo - o) / d, c = (hi - o) / d;
    if (a > c) [a, c] = [c, a];
    t0 = Math.max(t0, a); t1 = Math.min(t1, c);
    if (t0 > t1) return false;
  }
  return true;
}

/**
 * For every 6 m deck cell: share of the year's sun (4 key dates, every 30 min,
 * weighted by sin(altitude) ≈ irradiance on a horizontal surface) that is
 * not blocked by the use volumes on the deck. 1 = fully open sky.
 */
const SOLAR = (() => {
  const dk = DISTRICT.deck, z = dk.z1, cell = 6;
  const samples = [];
  for (const d of CONFIG.sun.dates) {
    for (let m = 5 * 60; m <= 20 * 60; m += 30) {
      const p = sunPosition(d.day, m, d.tz, CONFIG.site.latitude, CONFIG.site.longitude);
      if (p.altitude > 3 * Math.PI / 180) samples.push({ v: sunVector(p.altitude, p.azimuth + GRID_TURN), w: Math.sin(p.altitude) });
    }
  }
  const total = samples.reduce((n, s) => n + s.w, 0);
  const blockers = ALL_USE_BOXES.filter((b) => b.z1 - b.z0 > 3.5);   // low planting boxes don't shade
  const cells = [];
  for (let x = dk.x0; x < dk.x1 - 1; x += cell) {
    for (let y = dk.y0; y < dk.y1 - 1; y += cell) {
      const x1 = x + cell, y1 = y + cell;
      const c = [(x + x1) / 2, (y + y1) / 2, z + 0.3];
      // keep every cell that touches the deck; the drawing is clipped to the outline
      if (![[x + 0.5, y + 0.5], [x1 - 0.5, y + 0.5], [x + 0.5, y1 - 0.5], [x1 - 0.5, y1 - 0.5], c].some(([px, py]) => insideRects(dk.rects, px, py))) continue;
      const under = blockers.some((b) => c[0] > b.x0 && c[0] < b.x1 && c[1] > b.y0 && c[1] < b.y1);
      let got = 0;
      if (!under) for (const s of samples) if (!blockers.some((b) => rayBox(c, s.v, b))) got += s.w;
      cells.push({ x0: x, y0: y, x1, y1, v: under ? 0 : got / total, under });
    }
  }
  return cells;
})();

/* -------------------------------------------------------------------------
   Sketch generators (viewBox 320 × 180, i.e. 16:9)
   ------------------------------------------------------------------------- */

const SKETCHES = {
  /* S1 — Vienna from above: real city outline (OSM) with a schematic heat map, zoom target on Westbahnhof */
  heatmap() {
    const V = VIENNA, S = V.pxPerKm, [cx, cy] = V.centre, WB = V.westbahnhof;
    const km = (x, y) => [(x - cx) / S, -(y - cy) / S];          // frame → km from Stephansplatz (east, north)
    const inside = (x, y) => {                                     // point in the city outline (ray casting)
      let c = false;
      for (let i = 0, j = V.outline.length - 1; i < V.outline.length; j = i++) {
        const [xi, yi] = V.outline[i], [xj, yj] = V.outline[j];
        if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
      }
      return c;
    };
    const distToLines = (x, y, lines) => {
      let d = Infinity;
      for (const l of lines) for (let i = 1; i < l.length; i++) {
        const [ax, ay] = l[i - 1], [bx, by] = l[i];
        const t = Math.max(0, Math.min(1, ((x - ax) * (bx - ax) + (y - ay) * (by - ay)) / ((bx - ax) ** 2 + (by - ay) ** 2 || 1)));
        d = Math.min(d, Math.hypot(x - ax - t * (bx - ax), y - ay - t * (by - ay)));
      }
      return d / S;                                                // km
    };
    const box = (e, n, [e0, n0, e1, n1]) => e > e0 && e < e1 && n > n0 && n < n1;
    const [wbE, wbN] = km(...WB);

    // Schematic heat (not measured): dense centre and inner west hot, green and water cool.
    let dots = '';
    for (let y = 8; y <= 172; y += 6) {
      for (let x = 60; x <= 272; x += 6) {
        if (!inside(x, y)) continue;
        const [e, n] = km(x, y);
        let v = 1 - Math.min(1, Math.hypot(e, n) / 13) * 0.75;               // urban core hottest
        v += 0.4 * Math.exp(-((e - wbE) ** 2 + (n - wbN) ** 2) / 6);            // dense inner west around Westbahnhof
        if (e < -7.6 || (n > 3.5 && e < -3.2)) v -= 0.4;                        // Wienerwald and the north-western hills
        if (box(e, n, [-12, -5.3, -7.6, -2])) v -= 0.25;                        // Lainzer Tiergarten
        if (box(e, n, [2, -2, 5.7, 0.7])) v -= 0.35;                            // Prater
        if (box(e, n, [8, -7.6, 14, -3.1])) v -= 0.4;                           // Lobau
        if (e > 4 && n > 2) v -= 0.12;                                          // looser north-east
        const w = distToLines(x, y, V.danube);
        if (w < 1.3) v -= 0.4 * (1 - w / 1.3);                                  // Danube and Donauinsel
        v += Math.sin(x * 0.37 + y * 0.21) * 0.06;                              // texture
        const k = Math.max(1, Math.min(5, Math.round(v * 5)));
        const d = Math.hypot(x - WB[0], y - WB[1]);
        dots += `<circle class="h${k}" cx="${x}" cy="${y}" r="2.1" style="--d:${(d * 9).toFixed(0)}ms"/>`;
      }
    }

    const path = (pts, close) => `M${pts.map((q) => q.map(f).join(',')).join(' L')}${close ? 'Z' : ''}`;
    // Gürtel: schematic arc through Westbahnhof around the west and south of the centre
    const rG = Math.hypot(WB[0] - cx, WB[1] - cy), guertel = [];
    for (let a = -15; a >= -250; a -= 5) {
      const r = a * Math.PI / 180;
      guertel.push([cx + Math.sin(r) * rG, cy - Math.cos(r) * rG]);
    }

    return `
      <rect class="sb-bg" width="320" height="180"/>
      <g class="sb-heat">${dots}</g>
      <path class="sb-city" d="${path(V.outline, true)}"/>
      ${V.danube.map((l) => `<path class="sb-river" d="${path(l)}"/>`).join('')}
      ${V.canal.map((l) => `<path class="sb-canal" d="${path(l)}"/>`).join('')}
      <circle class="sb-line" cx="${f(cx)}" cy="${f(cy)}" r="${f(0.9 * S)}"/>
      <path class="sb-line sb-dash" d="${path(guertel)}"/>
      <g class="sb-zoom">
        <rect x="${f(WB[0] - 16)}" y="${f(WB[1] - 10)}" width="32" height="20"/>
        <path class="sb-dash" d="M${f(WB[0] - 16)} ${f(WB[1] - 10)} L0 0 M${f(WB[0] + 16)} ${f(WB[1] - 10)} L320 0 M${f(WB[0] - 16)} ${f(WB[1] + 10)} L0 180 M${f(WB[0] + 16)} ${f(WB[1] + 10)} L320 180"/>
      </g>
      <circle class="sb-mark" cx="${f(WB[0])}" cy="${f(WB[1])}" r="2.4"/>
      <g transform="translate(14 150)">
        ${[1, 2, 3, 4, 5].map((k) => `<rect class="h${k}" x="${(k - 1) * 12}" y="0" width="12" height="5"/>`).join('')}
      </g>
      <g class="sb-north"><circle cx="300" cy="24" r="8"/><path d="M300 24 V12"/></g>`;
  },

  /* S3 — the district's heat without the Raumpark, then with it: a soft blue → red heat map on
     streets and courtyards; the deck fades in (semi-transparent) and the ground below it cools. */
  'district-heat'(id, shot = 15) {
    const P = isoP(160, 139, 0.39);
    const T = shot, D = DISTRICT, g = D.plate, CELL = 8;
    const loop = `dur="${T}s" fill="freeze"`;
    const inParcel = (x, y) => D.parcels.some((b) => x > b.x0 && x < b.x1 && y > b.y0 && y < b.y1)
      || (x > D.hall.x0 && x < D.hall.x1 && y > D.hall.y0 && y < D.hall.y1);
    const inBlock = (x, y) => ((x % 80) + 80) % 80 < 60 && ((y % 80) + 80) % 80 < 60;  // courtyard, not street
    const nearDeck = (x, y) => [[10, 0], [-10, 0], [0, 10], [0, -10]].some(([dx, dy]) => insideRects(D.deck.rects, x + dx, y + dy));
    const step = (v) => Math.max(1, Math.min(7, Math.round(v * 6) + 1));    // 1 = cool blue … 4 = neutral … 7 = warm red

    // Schematic surface heat (not measured): paved streets hottest, courtyards milder;
    // under the deck and close to it the ground is shaded and cooler.
    let without = '', withDeck = '';
    for (let x = g.x0; x < g.x1; x += CELL) {
      for (let y = g.y0; y < g.y1; y += CELL) {
        const cx = x + CELL / 2, cy = y + CELL / 2;
        if (!insideRects(g.rects, cx, cy) || inParcel(cx, cy)) continue;
        const park = D.parks.some((pk) => cx > pk.x0 && cx < pk.x1 && cy > pk.y0 && cy < pk.y1);
        let v = park ? 0.12 : inBlock(cx, cy) ? 0.55 : 0.82;                   // park vs. courtyard vs. street
        if (cy < 70 && cx < 150) v += 0.08;                                     // station forecourt
        v += Math.sin(cx * 0.21 + cy * 0.13) * 0.06;
        let w = v;
        if (insideRects(D.deck.rects, cx, cy)) w -= 0.6;
        else if (nearDeck(cx, cy)) w -= 0.18;
        const quad = pts(P, [[x, y, 0], [x + CELL, y, 0], [x + CELL, y + CELL, 0], [x, y + CELL, 0]]);
        without += `<polygon class="dh dh${step(v)}" points="${quad}"/>`;
        withDeck += `<polygon class="dh dh${step(w)}" points="${quad}"/>`;
      }
    }
    // without → (deck fades in, heat cross-fades) → with, held to the end of the shot; the city is drawn a second time
    // with the pylons so the houses in front still hide them
    const fadeIn = `<animate attributeName="opacity" ${loop} values="0;0;1;1" keyTimes="0;0.4;0.55;1"/>`;
    return `
      <rect class="sb-bg" width="320" height="180"/>
      ${groundSvg(P)}
      <g>${without}</g>
      <g opacity="0">${fadeIn}${withDeck}</g>
      ${drawCity(P)}
      <g opacity="0">${fadeIn}${drawCity(P, D.pylons)}</g>
      <g class="dh-deck" opacity="0">${fadeIn}${deckSlab(P)}</g>
      <g transform="translate(14 160)">
        ${[1, 2, 3, 4, 5, 6, 7].map((k) => `<rect class="dh dh${k}" x="${(k - 1) * 10}" y="0" width="10" height="5"/>`).join('')}
      </g>`;
  },

  /* S2 — Westbahnhof isometric with an animated sun and the deck's shadow */
  sun(id, shot = 20) {
    // Summer (21 June) then winter (21 December), half the shot each. Both day arcs stay visible:
    // the active season's arc is strong, the other one fades back.
    const P = isoP(160, 139, 0.39);
    const base = districtBase(P);
    const DAY = shot / 2, loop = `dur="${shot}s" fill="freeze"`;
    const summer = sunLayer(P, DAY, `${id}s`, 'jun');
    const winter = sunLayer(P, DAY, `${id}w`, 'dec');
    const on = (first) => `<animate attributeName="opacity" ${loop} values="${first ? '1;1;0;0' : '0;0;1;1'}" keyTimes="0;0.48;0.5;1"/>`;
    const strong = (first) => `<animate attributeName="opacity" ${loop} values="${first ? '1;1;0.25;0.25' : '0.25;0.25;1;1'}" keyTimes="0;0.48;0.5;1"/>`;
    return `
      <rect class="sb-bg" width="320" height="180"/>
      ${base.ground}
      <g>${on(true)}${summer.shadow}</g>
      <g opacity="0">${on(false)}${winter.shadow}</g>
      ${base.city}${base.deck}
      <g class="sb-season sb-season--summer">${strong(true)}${summer.arc}</g>
      <g class="sb-season sb-season--winter" opacity="0.25">${strong(false)}${winter.arc}</g>
      <g>${on(true)}${summer.disc}</g>
      <g opacity="0">${on(false)}${winter.disc}</g>
`;
  },

  /* S4 — same view, wind lines at street level and deck level */
  wind() {
    const P = isoP(160, 139, 0.39);
    const base = districtBase(P);
    // a wind line, split into pieces wherever it would leave the given area
    const line = (y, z, cls, wob, from, to, inside) => {
      const runs = [];
      let run = [];
      for (let x = from; x <= to; x += 8) {
        if (inside(x, y)) run.push(P(x, y + Math.sin(x * 0.05 + y) * wob, z).map(f).join(','));
        else if (run.length) { runs.push(run); run = []; }
      }
      if (run.length) runs.push(run);
      return runs.filter((r) => r.length > 1).map((r) => `<polyline class="${cls}" points="${r.join(' ')}"/>`).join('');
    };
    const onPlate = (x, y) => insideRects(DISTRICT.plate.rects, x, y);
    const street = [-10, 70, 150, 230].map((y) => line(y, 1, 'sb-flow', 2, -96, 316, onPlate)).join('');
    const deck = [62, 86, 110, 134, 158].map((y) => line(y, 52, 'sb-flow sb-flow--fast', 3, 20, 300, () => true)).join('');
    const eddies = [[70, 30], [150, 110], [230, 190]].map(([x, y]) => {
      const [ex, ey] = P(x, y, 1);
      return `<ellipse class="sb-eddy" cx="${f(ex)}" cy="${f(ey)}" rx="6" ry="3.5"/>`;
    }).join('');
    const [ax, ay] = P(-125, 110, 0);
    return `
      <rect class="sb-bg" width="320" height="180"/>
      ${base.ground}${street}${eddies}${base.city}${base.deck}${deck}
      <g class="sb-windarrow" transform="translate(${f(ax - 6)} ${f(ay - 4)}) rotate(-30)"><path d="M-14 0 H8 M2 -4 L8 0 L2 4"/></g>
`;
  },

  /* S5 — overview → the Raumpark turns transparent → push-in on one window → the view out of
     that window fills the frame, with the isometric sun study as a synced inset bottom right */
  split(id, shot = 20) {
    const dur = shot / 2;    // sun cycle: two per shot, the second one on the window view
    const T = shot;          // the whole sequence, once per shot
    const loop = `dur="${T}s" fill="freeze"`;
    // ---- steps 1–3: overview, deck fades, push-in on the window
    const PA = isoP(160, 139, 0.39);
    const base = districtBase(PA);
    const WIN = [190, 80, 12];                                   // a window on a Gründerzeit facade below the deck
    const [wx, wy] = PA(...WIN);
    const winQuad = pts(PA, [[188.5, 80, 9.5], [191.5, 80, 9.5], [191.5, 80, 14.5], [188.5, 80, 14.5]]);
    const k = 4.5, tx = 160 - k * wx, ty = 96 - k * wy;          // zoom so the window lands mid-frame
    const zoomKT = '0;0.3;0.44;1', zoomKS = '0 0 1 1;.45 0 .2 1;0 0 1 1';
    const overview = `
      <g class="s4-overview">
        <animate attributeName="opacity" ${loop} values="1;1;0;0" keyTimes="0;0.5;0.56;1"/>
        <g><animateTransform attributeName="transform" type="translate" ${loop} values="0 0;0 0;${f(tx)} ${f(ty)};${f(tx)} ${f(ty)}" keyTimes="${zoomKT}" calcMode="spline" keySplines="${zoomKS}"/>
          <g><animateTransform attributeName="transform" type="scale" ${loop} values="1;1;${k};${k}" keyTimes="${zoomKT}" calcMode="spline" keySplines="${zoomKS}"/>
            ${base.ground}${base.city}
            <g class="s4-deck">
              <animate attributeName="opacity" ${loop} values="1;1;0.12;0.12" keyTimes="0;0.16;0.28;1"/>
              ${base.deck}
            </g>
            <polygon class="s4-window" points="${winQuad}"/>
            <circle class="sb-mark-ring" cx="${f(wx)}" cy="${f(wy)}" r="6"/>
          </g>
        </g>
      </g>`;

    // ---- step 4: the window fills the frame, the model sits as an inset bottom right
    // A tall Gründerzeit casement window with a transom (x 80–156, y 8–146). The right casement
    // stands open into the room, and a sheer curtain on the rod billows in the breeze through it.
    // The sun patch on the floor drifts as the sun moves; the deck's shadow passes the window.
    const W = { x0: 80, x1: 156, y0: 8, y1: 146, tr: 40, mid: 118 };
    const patch = [
      '22,180 64,150 150,150 114,180', '68,180 92,150 178,150 160,180', '124,180 122,150 204,150 218,180',
    ];
    // the curtain's outline and two folds; every frame has the same commands, so SMIL can tween them
    const breeze = `dur="${shot / 4}s" repeatCount="indefinite" calcMode="spline" keyTimes="0;0.3;0.6;1" keySplines=".45 0 .55 1;.45 0 .55 1;.45 0 .55 1"`;
    const curtain = [
      'M188,6 L226,6 C231,50 240,98 236,152 Q226,157 215,152 Q205,148 196,153 C192,100 185,52 188,6 Z',
      'M188,6 L226,6 C240,44 256,90 252,146 Q241,155 228,147 Q219,141 206,149 C198,98 187,48 188,6 Z',
      'M188,6 L226,6 C238,48 252,96 248,150 Q236,157 222,150 Q209,145 199,152 C194,99 186,50 188,6 Z',
    ];
    const folds = [
      'M200,7 C204,60 210,110 212,152 M214,7 C220,58 228,108 228,152',
      'M200,7 C208,56 220,104 222,148 M214,7 C226,52 240,100 242,146',
      'M200,7 C206,58 216,106 218,151 M214,7 C224,55 238,104 238,150',
    ];
    const loopVals = (fr) => [...fr, fr[0]].join(';');
    const interior = `
      <rect class="sb-wall" x="0" y="0" width="320" height="180"/>
      <rect class="sb-sky" x="${W.x0}" y="${W.y0}" width="${W.x1 - W.x0}" height="${W.y1 - W.y0}"/>
      <rect class="sb-deck-under" x="${W.x0}" y="${W.y0}" width="${W.x1 - W.x0}" height="18"/>
      <rect class="sb-deck-edge" x="${W.x0}" y="${W.y0 + 16}" width="${W.x1 - W.x0}" height="4"/>
      <rect class="sb-facade-bg" x="${W.x0}" y="70" width="${W.x1 - W.x0}" height="${W.y1 - 70}"/>
      <g class="sb-facade">${[0, 1, 2, 3].map((r) => Array.from({ length: 4 }, (_, c) =>
        `<rect x="${85 + c * 19}" y="${76 + r * 17}" width="7" height="11"/>`).join('')).join('')}</g>
      <rect class="sb-pylon-flat" x="132" y="${W.y0 + 20}" width="11" height="${W.y1 - W.y0 - 20}"/>
      <rect class="sb-passing" x="${W.x0}" y="32" width="60" height="112" clip-path="url(#${id}-win)">
        <animate attributeName="x" dur="${dur}s" repeatCount="indefinite" values="20;80;130;170" keyTimes="0;0.35;0.65;1"/>
      </rect>
      <rect class="sb-glass" x="${W.x0}" y="${W.y0}" width="${W.x1 - W.x0}" height="${W.tr - W.y0}"/>
      <rect class="sb-glass" x="${W.x0}" y="${W.tr}" width="${W.mid - W.x0}" height="${W.y1 - W.tr}"/>
      <rect class="sb-window" x="${W.x0}" y="${W.y0}" width="${W.x1 - W.x0}" height="${W.y1 - W.y0}"/>
      <path class="sb-mullion" d="M${W.x0} ${W.tr} H${W.x1} M${W.mid} ${W.tr} V${W.y1}"/>
      <rect class="sb-sill" x="${W.x0 - 6}" y="${W.y1}" width="${W.x1 - W.x0 + 12}" height="3"/>
      <rect class="sb-floor" x="0" y="150" width="320" height="30"/>
      <polygon class="sb-patch" points="${patch[0]}">
        <animate attributeName="points" dur="${dur}s" repeatCount="indefinite" values="${patch.join(';')};${patch[0]}" keyTimes="0;0.45;0.9;1"/>
      </polygon>
      <g class="sb-sash">
        <polygon class="sb-glass" points="${W.x1},${W.tr} 182,${W.tr - 8} 182,${W.y1 + 10} ${W.x1},${W.y1}"/>
        <polygon class="sb-sash-frame" points="${W.x1},${W.tr} 182,${W.tr - 8} 182,${W.y1 + 10} ${W.x1},${W.y1}"/>
        <path class="sb-sash-bar" d="M${W.x1} ${(W.tr + W.y1) / 2} L182 ${(W.tr + W.y1) / 2 + 1}"/>
      </g>
      <path class="sb-rod" d="M${W.x0 - 10} 5 H${W.x1 + 34}"/>
      <g transform="translate(-42 0)"><path class="sb-curtain" d="${curtain[0]}"><animate attributeName="d" ${breeze} values="${loopVals(curtain)}"/></path>
      <path class="sb-curtain-fold" d="${folds[0]}"><animate attributeName="d" ${breeze} values="${loopVals(folds)}"/></path></g>
`;
    // inset: small isometric with the same sun timing and the window marked
    const P = isoP(254, 153, 0.16);
    const rbase = districtBase(P, { mark: WIN, context: false });
    const { shadow, sun } = sunLayer(P, dur, id);
    const inset = `
      ${rbase.ground}${shadow}${rbase.city}${rbase.deck}${sun}
`;
    const splitView = `
      <g class="s4-split" opacity="0">
        <animate attributeName="opacity" ${loop} values="0;0;1;1" keyTimes="0;0.5;0.56;1"/>
        <rect class="sb-bg" width="320" height="180"/>
        ${interior}
        ${inset}
      </g>`;

    return `
      <rect class="sb-bg" width="320" height="180"/>
      <clipPath id="${id}-win"><rect x="80" y="8" width="76" height="138"/></clipPath>
      ${overview}
      ${splitView}`;
  },

  /* S6–S9 — one shot per use: whole deck, that use's boxes in colour */
  'use-culture': () => useShot('culture'),
  'use-health': () => useShot('health'),
  'use-res': () => useShot('res'),
  'use-green': () => useShot('green'),

  /* S10 — circulation: a route builds up from the street, up a stair core, along the
     deck past every use and down again; each use lights up as the route reaches it. */
  circulation(id, shot = 15) {
    const P = isoP(122, 190, 0.68);
    const z = DISTRICT.deck.z1 + 0.4, DUR = shot, DRAW = 0.75;   // line draws in 75 % of the shot, then holds
    // route in world metres: [x, y, z] (street → stair up → deck arms → stair down → street)
    const route = [
      [230, -14, 0.3], [230, 62, 0.3], [230, 62, z],            // street, then up the stair core at (230, 70)
      [230, 70, z], [150, 70, z], [70, 70, z],                  // along the southern arm
      [70, 150, z], [150, 150, z], [230, 150, z],               // western arm, then the northern arm
      [230, 158, z], [230, 158, 0.3], [230, 236, 0.3],          // down the stair core at (230, 150), out to the street
    ];
    const scr = route.map(([x, y, zz]) => P(x, y, zz));
    const seg = scr.slice(1).map((q, i) => Math.hypot(q[0] - scr[i][0], q[1] - scr[i][1]));
    const total = seg.reduce((a, b) => a + b, 0);
    const at = (idx) => seg.slice(0, idx).reduce((a, b) => a + b, 0) / total;   // share of the route up to point idx
    const d = `M${scr.map((q) => q.map(f).join(',')).join(' L')}`;

    // stair cores at every pylon: a switchback from street to deck, the two used ones stronger
    const stair = ([px, py], used) => {
      const p = [];
      for (let k = 0; k <= 12; k++) p.push(P(px + (k % 2 ? 5 : -5), py - 7, (k / 12) * DISTRICT.deck.z0).map(f).join(','));
      return `<polyline class="circ-stair${used ? ' is-used' : ''}" points="${p.join(' ')}"/>`;
    };
    const used = ['230,70', '230,150'];
    const stairs = DISTRICT.pylons.map((b) => {
      const c = [(b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2];
      return stair(c, used.includes(c.join(',')));
    }).join('');

    // uses reached along the route: a node in the use colour appears as the line passes
    const stops = [
      { use: 'health', i: 3 },
      { use: 'culture', i: 5 },
      { use: 'green', i: 6 },
      { use: 'res', i: 7 },
    ];
    const kt = (t) => `0;${t.toFixed(3)};${(t + 0.02).toFixed(3)};1`;
    const nodes = stops.map((s) => {
      const [x, y] = scr[s.i], t = at(s.i) * DRAW;
      return `<g class="circ-stop use-${s.use}" opacity="0">
        <animate attributeName="opacity" dur="${DUR}s" fill="freeze" values="0;0;1;1" keyTimes="${kt(t)}"/>
        <circle class="circ-node" cx="${f(x)}" cy="${f(y)}" r="3.4"/>
</g>`;
    }).join('');

    return `
      <rect class="sb-bg" width="320" height="180"/>
      <g class="use-below">${drawCity(P, DISTRICT.pylons)}</g>
      ${deckSlab(P)}
      ${useBoxes(P, null)}
      ${stairs}
      <path class="circ-trace" d="${d}"/>
      <path class="circ-route" d="${d}" pathLength="100" stroke-dasharray="100" stroke-dashoffset="100">
        <animate attributeName="stroke-dashoffset" dur="${DUR}s" fill="freeze" values="100;0;0" keyTimes="0;${DRAW};1"/>
      </path>
      ${nodes}
      <circle class="circ-head" r="3">
        <animateMotion dur="${DUR}s" fill="freeze" path="${d}" keyPoints="0;1;1" keyTimes="0;${DRAW};1" calcMode="linear"/>
      </circle>
`;
  },

  /* S11 — greenery & solar income: heat map of yearly sun on the deck + what to plant / where PV pays */
  solar() {
    const P = isoP(78, 190, 0.53);
    const D = DISTRICT, dk = D.deck, z = dk.z1;
    const HI = 0.85, LO = 0.6;
    const bucket = (v) => Math.max(1, Math.min(6, Math.ceil(((v - 0.35) / 0.65) * 6)));
    const cells = SOLAR.map((c) => {
      const d = ((c.x0 - dk.x0) + (dk.y1 - c.y1)) * 7; // reveal sweeps from the south-east
      return `<polygon class="sol s${bucket(c.v)}" style="--d:${d.toFixed(0)}ms" points="${pts(P, [[c.x0, c.y0, z], [c.x1, c.y0, z], [c.x1, c.y1, z], [c.x0, c.y1, z]])}"/>`;
    }).join('');
    const pylons = D.pylons.map((b) => box(P, { ...b, z0: 30 }, 'sb-pylon')).join('');
    // use volumes: housing with PV on the roof, planting boxes green, the rest neutral
    const objects = ALL_USE_BOXES.slice().sort(byDepth).map((o) => {
      if (o.use === 'green') return box(P, o, 'use-box use-green is-focus');
      let svg = box(P, o, o.use === 'res' ? 'use-box use-res is-focus' : 'sb-pav');
      if (o.use === 'res') {
        for (let x = o.x0 + 2; x < o.x1 - 1; x += 3) {
          const [a, b] = [P(x, o.y0 + 1.5, o.z1), P(x, o.y1 - 1.5, o.z1)];
          svg += `<line class="sol-pv" x1="${f(a[0])}" y1="${f(a[1])}" x2="${f(b[0])}" y2="${f(b[1])}"/>`;
        }
      }
      return svg;
    }).join('');
    // the deck surface is clipped to its outline so the 8 m cells follow the polyline
    const clip = `<clipPath id="sol-clip"><path clip-rule="evenodd" d="${loopsPath(P, dk.loops, z)}"/></clipPath>`;

    // share of deck area per class → recommendation bars
    const open = SOLAR.filter((c) => !c.under);                     // cells under volumes don't count
    const share = (fn) => Math.round((open.filter(fn).length / open.length) * 100);
    const rows = [
      { cls: 's6', label: 'HIGH · PV & SUN MEADOW', p: share((c) => c.v >= HI) },
      { cls: 's4', label: 'MEDIUM · TREES & LAWNS', p: share((c) => c.v >= LO && c.v < HI) },
      { cls: 's2', label: 'LOW · SHADE PLANTING', p: share((c) => c.v < LO) },
    ];
    const bars = rows.map((r, i) => `
      <rect class="sol-track" x="0" y="${55 + i * 26}" width="96" height="6"/>
      <rect class="sol ${r.cls} sol-bar" style="--d:${600 + i * 250}ms" x="0" y="${55 + i * 26}" width="${(r.p / 100) * 96}" height="6"/>
`).join('');

    return `
      <rect class="sb-bg" width="320" height="180"/>
      ${clip}
      ${pylons}${deckSlab(P)}
      <g class="sol-cells" clip-path="url(#sol-clip)">${cells}</g>
      ${objects}
      <g transform="translate(196 18)">
        ${[1, 2, 3, 4, 5, 6].map((k) => `<rect class="sol s${k}" x="${(k - 1) * 16}" y="16" width="16" height="6"/>`).join('')}
        ${bars}
        <line class="sol-pv" x1="0" y1="${132}" x2="10" y2="${132}"/><line class="sol-pv" x1="0" y1="${135}" x2="10" y2="${135}"/>
      </g>`;
  },
};

/* -------------------------------------------------------------------------
   Hairline figures: a shot with a "figure" key shows a line figure instead of
   an SVG sketch (js/hairline/, drawn on the engine of @lucasmarkes/hairline,
   MIT). The engine (js/hairline/kernel.js) is loaded as a classic script by
   index.html and gives the global HL. Each figure file ends with
   hairline({ ... }); here that call registers the figure by name.
   The figures answer a pointer; here the pointer is scripted: the shot's
   "motion" keyframes ({ t, at: [x, y] in the 400 × 320 viewBox or null,
   value }) are played against the shot's own clock, so the figure is a
   pre-made animation that follows the playhead. Real pointer input is off.
   ------------------------------------------------------------------------- */

const FIGURES = new Map();
window.hairline = (fig) => { FIGURES.set(fig.name, fig); };

/** The scripted pointer and value at time t: each linear between the keyframes that set it, held past the last. */
function sampleMotion(motion, t) {
  const track = (has) => {
    const keys = motion.filter(has);
    const i = keys.findLastIndex((m) => m.t <= t);
    return [keys[i], keys[i + 1], (m) => (t - keys[i].t) / (m.t - keys[i].t)];
  };
  const [a, b, k] = track((m) => 'at' in m);
  const [va, vb, kv] = track((m) => m.value != null);
  const lerp = (p, q, s) => p + (q - p) * s;
  return {
    at: !a?.at ? null : b?.at ? [lerp(a.at[0], b.at[0], k(b)), lerp(a.at[1], b.at[1], k(b))] : a.at,
    value: !va ? null : vb ? lerp(va.value, vb.value, kv(vb)) : va.value,
  };
}

/** Mounts a figure into host; seek(t) puts it where its motion script is t seconds into the shot. */
function mountFigure(host, fig, motion = []) {
  HL.inject(document);
  const stage = document.createElement('div');
  stage.className = 'sb-figure';
  stage.dataset.hairline = fig.name;
  stage.setAttribute('role', 'img');
  stage.setAttribute('aria-label', fig.means);
  const out = document.createElement('span');
  out.className = 'sb-figure__read';
  host.append(stage, out);
  const svg = HL.mk('svg', { viewBox: '0 0 400 320', 'aria-hidden': 'true' }, stage);
  const read = { get textContent() { return out.textContent; }, set textContent(v) { out.textContent = v ?? ''; } };
  const handle = fig.mount({ stage, svg, read }, fig.range[1]);
  if (!out.textContent) out.textContent = 'rest';
  let value = fig.range[1], inside = false;
  const send = (type, at) => {
    const r = stage.getBoundingClientRect();
    stage.dispatchEvent(new PointerEvent(type, {
      pointerType: 'mouse', pointerId: 1, bubbles: type === 'pointermove',
      clientX: r.left + ((at?.[0] ?? 0) / 400) * r.width, clientY: r.top + ((at?.[1] ?? 0) / 320) * r.height,
    }));
  };
  return {
    seek(t) {
      const m = sampleMotion(motion, t);
      const v = m.value ?? fig.range[1];
      if (v !== value) { value = v; handle.set(v); }
      if (m.at) { send('pointermove', m.at); inside = true; }
      else if (inside) { send('pointerleave'); inside = false; }
    },
    destroy() { handle.destroy(); },
  };
}

/* -------------------------------------------------------------------------
   Storyboard strip: each shot reduced to the basic outline of its content
   inside the frame (Vienna's contour, the district outline, the window …)
   ------------------------------------------------------------------------- */

function thumb(sketch) {
  const path = (d) => `<path d="${d}"/>`;
  const line = (list) => `M${list.map((q) => q.map(f).join(',')).join(' L')}`;
  let content;
  if (sketch === 'heatmap') content = path(`${line(VIENNA.outline)}Z`);
  else if (sketch === 'split') content = path('M80 8 H156 V146 H80 Z M80 40 H156 M118 40 V146 M156 40 L182 32 V156 L156 146');
  else if (sketch === 'solar') content = path(loopsPath(isoP(78, 190, 0.53), DISTRICT.deck.loops, DISTRICT.deck.z1));
  else if (sketch === 'layers') {                 // the deck outline three times, stacked apart
    const P = isoP(160, 120, 0.3);
    content = [0, 1, 2].map((k) => path(loopsPath(P, DISTRICT.deck.loops, k * 70))).join('');
  }
  else content = path(loopsPath(isoP(160, 139, 0.39), DISTRICT.plate.loops, 0));
  return `<svg viewBox="0 0 320 180" aria-hidden="true"><rect class="sb-thumb__frame" x="0" y="0" width="320" height="180"/>${content}</svg>`;
}

/* -------------------------------------------------------------------------
   Rendering
   ------------------------------------------------------------------------- */

export async function initStoryboard(el, url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  const data = await res.json();
  const names = [...new Set(data.shots.map((s) => s.figure).filter(Boolean))];
  await Promise.all(names.map((n) => import(`./hairline/${n}.js`)));
  render(el, data);
}

function render(el, data) {
  const shots = data.shots;
  let t = 0;
  for (const s of shots) { s.start = t; t += s.duration; }
  const total = t;
  const cols = shots.map((s) => `${s.duration}fr`).join(' ');
  const pct = (x) => (x / total) * 100;

  /* ---- edit timeline with tracks ---- */
  const lane = (cls, fn) => `<div class="sb-lane ${cls}" style="grid-template-columns:${cols}">${shots.map((s, i) =>
    `<button type="button" class="sb-cell${s.tier === 'optional' ? ' is-optional' : ''}" data-shot="${i}" title="Play from ${esc(s.code)} · ${esc(s.title)}">${fn(s)}</button>`).join('')}</div>`;

  let ticks = '';
  for (let x = 0; x <= total; x += data.tick) {
    ticks += `<span class="sb-tickmark" style="left:${pct(x)}%">${tc(x)}</span>`;
  }

  // scale track: one step per scale used in a shot (two values = two parallel lines)
  const levels = data.scales;
  const yOf = (name) => 16 + (levels.indexOf(name) / (levels.length - 1)) * 56;
  let scaleLines = '';
  shots.forEach((s, i) => {
    const x0 = pct(s.start) + 0.6, x1 = pct(s.start + s.duration) - 0.6;
    s.scale.forEach((name) => {
      scaleLines += `<line class="sb-scale-seg${s.tier === 'optional' ? ' is-optional' : ''}" x1="${x0}" x2="${x1}" y1="${yOf(name)}" y2="${yOf(name)}"/>`;
    });
    const next = shots[i + 1];
    if (next) scaleLines += `<line class="sb-scale-link" x1="${x1}" x2="${pct(next.start) + 0.6}" y1="${yOf(s.scale[0])}" y2="${yOf(next.scale[0])}"/>`;
  });

  el.innerHTML = `
    <div class="sb-player" tabindex="-1">
      <ol class="sb-strip" aria-label="Storyboard" style="--n:${shots.length}">${shots.map((s, i) => `
        <li><button type="button" class="sb-thumb" data-shot="${i}" title="Play from ${esc(s.code)} · ${esc(s.title)}">
          ${thumb(s.sketch)}<span>${esc(s.code)}</span></button></li>`).join('')}
      </ol>
      <figure class="sb-frame sb-screen" id="sb-screen">
        <div class="sb-screen__view" id="sb-view" role="img"></div>
        <figcaption><span id="sb-cap"></span><span>Sketch · not final look</span></figcaption>
      </figure>

      <div class="sb-overview">
        <div class="sb-overview__bar">
          <button class="btn" id="sb-prev" type="button" aria-label="Previous shot">◂◂</button>
          <button class="btn btn--play" id="sb-play" type="button" aria-pressed="false"><i aria-hidden="true"></i><span>Play</span></button>
          <button class="btn" id="sb-next" type="button" aria-label="Next shot">▸▸</button>
          <span class="sb-timecode"><span id="sb-tc">00:00</span> / ${tc(total)}</span>
          <span class="sb-total">Package 1 · ${shots.length} shots · click the timeline to jump</span>
        </div>
        <div class="sb-scroll">
          <div class="sb-tracks" id="sb-tracks">
            <div class="sb-track"><span class="sb-track__label">Time</span><div class="sb-ruler sb-seek">${ticks}</div></div>
            <div class="sb-track sb-track--picture"><span class="sb-track__label">Picture</span>
              ${lane('', (s) => `<b>${esc(s.code)}</b><span>${esc(s.title)}</span>`)}</div>
            <div class="sb-track sb-track--scale"><span class="sb-track__label">Scale
                ${levels.map((l) => `<small style="top:${(yOf(l) / 80) * 100}%">${esc(l)}</small>`).join('')}</span>
              <svg class="sb-scale sb-seek" viewBox="0 0 100 80" preserveAspectRatio="none" aria-hidden="true">
                ${levels.map((l) => `<line class="sb-scale-grid" x1="0" x2="100" y1="${yOf(l)}" y2="${yOf(l)}"/>`).join('')}
                ${scaleLines}
              </svg></div>
            <div class="sb-track"><span class="sb-track__label">Graphics</span>${lane('sb-lane--small', (s) => esc(s.graphics))}</div>
            <div class="sb-track"><span class="sb-track__label">Data</span>${lane('sb-lane--small', (s) => esc(s.data))}</div>
            <div class="sb-playhead-area" aria-hidden="true"><div class="sb-playhead" id="sb-playhead"></div></div>
          </div>
        </div>
      </div>

      <div class="sb-info" id="sb-info" aria-live="polite"></div>
    </div>`;

  const $ = (sel) => el.querySelector(sel);
  const view = $('#sb-view'), screen = $('#sb-screen'), cap = $('#sb-cap'), info = $('#sb-info');
  const head = $('#sb-playhead'), tcEl = $('#sb-tc'), play = $('#sb-play');
  const cells = [...el.querySelectorAll('.sb-cell, .sb-thumb')];

  // Sequenced sketches pick the moment that tells the most when motion is reduced (e.g. the window view in S4).
  const STILL = { split: 12, 'district-heat': 8, sun: 5.5, layers: 4 };
  let pos = 0, cur = -1, playing = false, last = 0, visible = false, gen = 0, figure = null;
  const shotAt = (x) => Math.max(0, shots.findIndex((s) => x >= s.start && x < s.start + s.duration));

  /** Puts the sketch on screen at t seconds into its shot: its SMIL clock and its CSS animations. */
  const syncSketch = (t) => {
    const svg = view.querySelector('svg.sb-sketch');
    if (!svg) return;
    svg.setCurrentTime?.(t);
    for (const a of svg.getAnimations?.({ subtree: true }) ?? []) a.currentTime = t * 1000;
  };

  /** Put shot idx on the big screen (a fresh SVG, so its animation starts from the beginning). */
  const show = (idx) => {
    if (idx === cur) return;
    cur = idx;
    const s = shots[idx], next = shots[idx + 1];
    figure?.destroy();
    figure = null;
    const fig = FIGURES.get(s.figure);
    view.classList.toggle('is-figure', !!fig);
    if (fig) {
      view.innerHTML = '';
      figure = mountFigure(view, fig, s.motion);
      figure.seek(reduced ? STILL[s.sketch] ?? 0 : Math.max(0, pos - s.start));
    } else {
      // each sketch runs once over its shot: it gets the duration, and CSS reads it as --shot
      view.innerHTML = `<svg class="sb-sketch" viewBox="0 0 320 180" style="--shot:${s.duration}s" data-sketch="${esc(s.sketch)}" aria-label="Sketch: ${esc(s.title)}">${SKETCHES[s.sketch]?.(`sk${idx}-${++gen}`, s.duration) ?? ''}</svg>`;
      const svg = view.querySelector('svg');
      if (reduced) { svg.setCurrentTime?.(STILL[s.sketch] ?? 5.5); svg.pauseAnimations?.(); }
      else {
        if (!playing) svg.pauseAnimations?.();
        syncSketch(pos - s.start);
      }
    }
    view.setAttribute('aria-label', `${s.code}: ${s.title}`);
    cap.textContent = `${s.code} · ${s.kicker}`;
    info.innerHTML = `
      <div class="sb-info__head">
        <span class="sb-info__code">${esc(s.code)}</span>
        <div>
          <h3>${esc(s.title)}</h3>
          <p class="sb-info__meta">${tc(s.start)} – ${tc(s.start + s.duration)} · ${s.duration} s · ${esc(s.kicker)}</p>
        </div>
      </div>
      <p class="sb-info__idea">${esc(s.idea)}</p>
      <dl class="sb-info__specs">
        <div><dt>Camera</dt><dd>${esc(s.camera)}</dd></div>
        <div><dt>Graphics</dt><dd>${esc(s.graphics)}</dd></div>
        <div><dt>Data</dt><dd>${esc(s.data)}</dd></div>
        <div><dt>Next</dt><dd>${next ? `${esc(s.transition ?? 'Cut')} → ${esc(next.code)} ${esc(next.title)}` : 'End of Package 1'}</dd></div>
      </dl>`;
    cells.forEach((c) => c.classList.toggle('is-active', +c.dataset.shot === idx));
  };

  const draw = () => {
    head.style.left = `${pct(pos)}%`;
    tcEl.textContent = tc(pos);
    if (reduced) return;
    const t = pos - shots[cur].start;
    if (figure) figure.seek(t);
    // the sketch keeps its own clock; pull it back to the playhead when it drifts (a jump, a hidden tab)
    const svg = view.querySelector('svg.sb-sketch');
    if (svg?.getCurrentTime && Math.abs(svg.getCurrentTime() - t) > 0.15) syncSketch(t);
  };

  const setPlaying = (on) => {
    playing = on;
    play.setAttribute('aria-pressed', on);
    play.querySelector('span').textContent = on ? 'Pause' : 'Play';
    const svg = view.querySelector('svg');
    if (!reduced) { if (on) svg?.unpauseAnimations?.(); else svg?.pauseAnimations?.(); }
    screen.classList.toggle('is-paused', !on);
  };

  /** Jump to a time; clicking a shot starts it from its beginning. */
  const seek = (x, { autoplay = true } = {}) => {
    pos = Math.max(0, Math.min(total - 0.01, x));
    const idx = shotAt(pos);
    if (idx !== cur) show(idx);
    draw();
    if (autoplay && !reduced) setPlaying(true);
  };

  cells.forEach((c) => c.addEventListener('click', () => {
    cur = -1;                                       // restart the shot even if it is already on screen
    seek(shots[+c.dataset.shot].start);
  }));
  el.querySelectorAll('.sb-seek').forEach((n) => n.addEventListener('click', (e) => {
    const r = $('.sb-playhead-area').getBoundingClientRect();
    seek(((e.clientX - r.left) / r.width) * total);
  }));
  const step = (d) => { cur = -1; seek(shots[Math.max(0, Math.min(shots.length - 1, shotAt(pos) + d))].start); };
  $('#sb-prev').addEventListener('click', () => step(-1));
  $('#sb-next').addEventListener('click', () => step(1));
  play.addEventListener('click', () => setPlaying(!playing));
  $('.sb-player').addEventListener('keydown', (e) => {
    if (e.target.closest('button') && e.key === ' ') return;
    if (e.key === 'ArrowRight') { e.preventDefault(); step(1); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); step(-1); }
    else if (e.key === ' ') { e.preventDefault(); setPlaying(!playing); }
  });

  /* ---- playhead runs in real time; the screen follows it from shot to shot ---- */
  const loop = (now) => {
    if (playing && visible) {
      pos += (now - last) / 1000;
      if (pos >= total) pos = 0;
      const idx = shotAt(pos);
      if (idx !== cur) show(idx);
      draw();
    }
    last = now;
    requestAnimationFrame(loop);
  };
  new IntersectionObserver(([e]) => { visible = e.isIntersecting; }, { threshold: 0.25 }).observe(screen);
  show(0);
  draw();
  setPlaying(!reduced);
  requestAnimationFrame((n) => { last = n; loop(n); });
}
