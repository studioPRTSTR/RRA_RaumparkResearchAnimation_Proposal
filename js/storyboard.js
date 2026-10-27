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
const f2 = (n) => n.toFixed(3);
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

/**
 * A building block as ONE mass: its footprint outline (outer edge and courtyard holes, from
 * rectsToOutline) extruded to one height. Only the walls facing the camera are drawn, far → near,
 * then the roof with its courtyard openings. Because the block is one outline, the lines where
 * the houses of a block meet disappear, and the block reads as one.
 */
function prism(P, loops, z0, z1, cls = '') {
  const faces = [];
  for (const loop of loops) for (let i = 0; i < loop.length; i++) {
    const [ax, ay] = loop[i], [bx, by] = loop[(i + 1) % loop.length];
    if (-(by - ay) - (ax - bx) <= 0) continue;     // outward normal faces away from the south-west camera
    faces.push({ d: ax + bx + ay + by, p: [[ax, ay, z0], [bx, by, z0], [bx, by, z1], [ax, ay, z1]] });
  }
  faces.sort((a, b) => b.d - a.d);
  return `<g class="${cls}">${faces.map((fc) => `<path class="f-s k-cr" d="${dPath(fc.p.map((q) => P(...q)))}"/>`).join('')}
    <path class="f-t k-sil" fill-rule="evenodd" d="${loopsPath(P, loops, z1)}"/></g>`;
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
   stepped cluster of Gründerzeit perimeter blocks as simplified boxes (four flat wings per block,
   one eave height per block, varied depths, now and then an open side or one large building),
   the station hall and two parks, on a base plate that follows the blocks. Around it the rest
   of the city is only hinted at as faint footprints. The proposal stays plain boxes: a branching
   deck on 6 pylons along the streets. */
const DISTRICT = (() => {
  let seed = 7;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
  const parcels = [], blocks = [];
  let cell = null;                                   // wings of the block being built
  const parcel = (x0, y0, x1, y1, z1) => { parcels.push({ x0, y0, x1, y1, z0: 0, z1 }); cell?.push([x0, y0, x1, y1]); };
  // one mass per block: all its wings merged into one outline (1 m raster, depths are odd numbers)
  const mass = (rects, z1, extra = {}) => ({ loops: rectsToOutline(rects, 1), ...bounds(rects), z0: 0, z1, block: true, ...extra });

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
    const z = +(4.5 + (4 + Math.floor(rnd() * 3)) * 3.4).toFixed(1);   // one eave height per block, 4–6 storeys
    cell = [];
    if (rnd() < 0.12) {                              // one large later building on the whole block
      parcel(bx + 4, by + 4, bx + 56, by + 56, z);
      blocks.push(mass(cell, z)); cell = null;
      continue;
    }
    const DEPTH = 11 + Math.floor(rnd() * 5);        // 11–15 m deep street fronts
    const open = rnd() < 0.18 ? Math.floor(rnd() * 2) : -1;   // sometimes one side stays open
    // the perimeter block as four plain wings around the courtyard
    parcel(bx, by, bx + 60, by + DEPTH, z);
    if (open !== 0) parcel(bx, by + 60 - DEPTH, bx + 60, by + 60, z);
    parcel(bx, by + DEPTH, bx + DEPTH, by + 60 - DEPTH, z);
    if (open !== 1) parcel(bx + 60 - DEPTH, by + DEPTH, bx + 60, by + 60 - DEPTH, z);
    blocks.push(mass(cell, z)); cell = null;
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
  // The surrounding city as volumes, for the overview (S2) that greys it out around the district.
  // Every block in view gets a form of its own: perimeter blocks of different depths and sizes,
  // U and L shapes, two bars with a lane, solid blocks, blocks split in two, the odd tower and
  // empty lot; each one mass with its own height.
  let cseed = 23;
  const crnd = () => { cseed = (cseed * 16807) % 2147483647; return (cseed - 1) / 2147483646; };
  const ri = (a, b) => a + Math.floor(crnd() * (b - a + 1));
  const contextBlocks = [];
  const inView = (x, y) => {                         // the S2 camera: isoP(160, 124, 0.3), with a margin
    const sx = 160 + (x - y) * C30 * 0.3, sy = 124 - ((x + y) / 2) * 0.3;
    return sx > -60 && sx < 380 && sy > -40 && sy < 230;
  };
  for (let i = -9; i <= 12; i++) for (let j = -9; j <= 12; j++) {
    if (inDistrict.has(`${i},${j}`) || !inView(i * 80 + 30, j * 80 + 30)) continue;
    // a slightly different footprint inside each 60 m block
    const x0 = i * 80 + ri(0, 6), y0 = j * 80 + ri(0, 6), x1 = i * 80 + 60 - ri(0, 6), y1 = j * 80 + 60 - ri(0, 6);
    const dep = ri(10, 16), h = () => +(15 + crnd() * 13).toFixed(1), r = crnd();
    const add = (rects, z1) => contextBlocks.push(mass(rects, z1, { ctx: true }));
    const ring = [[x0, y0, x1, y0 + dep], [x0, y1 - dep, x1, y1], [x0, y0, x0 + dep, y1], [x1 - dep, y0, x1, y1]];
    if (r < 0.07) continue;                                                  // empty lot
    else if (r < 0.19) add([[x0, y0, x1, y1]], h());                         // solid block
    else if (r < 0.31) { add([ring[0]], h()); add([ring[1]], h()); }         // two bars with a lane
    else if (r < 0.43) add(ring.filter((_, k) => k !== ri(0, 3)), h());      // U shape
    else if (r < 0.52) add([ring[ri(0, 1)], ring[2 + ri(0, 1)]], h());       // L shape
    else if (r < 0.62) {                                                     // split in two blocks
      const xm = Math.round((x0 + x1) / 2);
      add([[x0, y0, xm - 4, y1]], h()); add([[xm + 4, y0, x1, y1]], h());
    } else add(ring, h());                                                   // perimeter block
    if (crnd() < 0.05) add([[x1 - 16, y0, x1, y0 + 16]], +(36 + crnd() * 16).toFixed(1));   // a later tower
  }

  // The Raumpark grows along the streets (x = 70 / 150 / 230, y = 70 / 150):
  // arms over the streets, platforms over the intersections, plug-ins over the blocks.
  const rects = [
    [40, 50, 256, 94], [48, 128, 262, 172],               // two wide bands along the east-west streets
    [58, 94, 82, 128], [138, 26, 162, 196], [218, 94, 242, 128], // connectors along the north-south streets
  ];
  const loops = rectsToOutline(rects);
  // Deck height is not fixed yet: the sketches use a neutral height and never label it.
  const deck = { rects, loops, outline: loops[0], z0: 43, z1: 46, ...bounds(rects) };
  const pylons = [[70, 70], [150, 70], [230, 70], [70, 150], [150, 150], [230, 150]]
    .map(([x, y]) => ({ x0: x - 4, y0: y - 4, x1: x + 4, y1: y + 4, z1: 43, pylon: true }));
  return { parcels, blocks, hall, parks, plate, context, contextBlocks, deck, pylons, center: [110, 110] };
})();

/** Existing city (+ optional extras such as pylons), sorted far → near. */
function drawCity(P, extras = []) {
  return [...DISTRICT.blocks, DISTRICT.hall, ...extras]
    .sort((a, b) => (b.x0 + b.x1 + b.y0 + b.y1) - (a.x0 + a.x1 + a.y0 + a.y1))
    .map((b) => drawPiece(P, b))
    .join('');
}

/** One piece of the city: a block mass, the station hall or a pylon. */
function drawPiece(P, b, extraCls = '') {
  if (b.block) return prism(P, b.loops, b.z0, b.z1, `sb-block${extraCls}`);
  return box(P, b, b.hall ? 'sb-hall' : b.pylon ? 'sb-pylon' : 'sb-block');
}

function deckSlab(P, dz = 0) {
  const d = DISTRICT.deck;
  return slab(P, d.loops, d.z0 + dz, d.z1 + dz, 'sb-deck');
}

/** The ground: faint context footprints, the district's stepped base plate and its parks. */
function groundSvg(P, { context = true, edge = true } = {}) {
  const D = DISTRICT;
  const quad = (b, z = 0) => pts(P, [[b.x0, b.y0, z], [b.x1, b.y0, z], [b.x1, b.y1, z], [b.x0, b.y1, z]]);
  const contextSvg = D.context.map((b) => `<polygon class="sb-context" points="${quad(b)}"/>`).join('');
  const parks = D.parks.map((pk) => `<polygon class="sb-park" points="${quad(pk, 0.2)}"/>` + pk.trees
    .slice().sort((a, b) => (b[0] + b[1]) - (a[0] + a[1]))
    .map(([x, y, r]) => { const [cx, cy] = P(x, y, r); return `<circle class="sb-tree" cx="${f(cx)}" cy="${f(cy)}" r="${f((r * (P(1, 0)[0] - P(0, 0)[0])) / C30)}"/>`; })
    .join('')).join('');
  // district outline: the ground plate flat at street level with one crisp edge
  const outline = `<path class="sb-ground${edge ? ' sb-plate-edge' : ' sb-ground--open'}" fill-rule="evenodd" d="${loopsPath(P, D.plate.loops, 0)}"/>`;
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

/* North points to the top left of the isometric frames (the grid's +y axis), so the camera
   looks from the south-west: the sun rises top right, passes the front at noon and sets
   bottom left. GRID_TURN is added to every sun azimuth (0: the grid is not turned). */
const GRID_TURN = 0;

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
function sunLayer(P, dur, idp, dateId = 'jun', hours = true) {
  // with north top left the camera looks along the arc's plane; its height is drawn 1.5× (schematic) so the day opens up
  const D = DISTRICT, S = sunSamples(dateId), R = 130, ZK = 1.5, [cx, cy] = D.center;
  const sunPts = S.map((s) => P(cx + s.v[0] * R, cy + s.v[1] * R, s.v[2] * R * ZK));
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
    arc.push(P(cx + v[0] * R, cy + v[1] * R, v[2] * R * ZK).map(f).join(','));
  }
  const ticks = sunPts.map(([x, y]) => `<circle class="sb-tick" cx="${f(x)}" cy="${f(y)}" r="1.2"/>`).join('');
  // the time of day along the arc, every two hours (local clock time); noon first, then outwards
  let times = '';
  const placed = [];
  for (const h of hours ? [12, 8, 16, 6, 18, 10, 14, 20, 4, 22] : []) {
    const p = sunPosition(date.day, h * 60, date.tz, CONFIG.site.latitude, CONFIG.site.longitude);
    if (p.altitude <= 2 * Math.PI / 180) continue;
    const v = sunVector(p.altitude, p.azimuth + GRID_TURN);
    const [x, y] = P(cx + v[0] * R, cy + v[1] * R, v[2] * R * ZK);
    if (placed.some(([px, py]) => Math.abs(px - x) < 15 && Math.abs(py - y) < 7)) continue;   // where the arc recedes, keep labels apart
    placed.push([x, y]);
    times += `<circle class="sb-hour-dot" cx="${f(x)}" cy="${f(y)}" r="0.9"/><text class="sb-hour" x="${f(x)}" y="${f(y - 3.5)}">${h}:00</text>`;
  }
  const kt = S.map((_, i) => (i / (S.length - 1)).toFixed(3)).join(';');
  const shadow = `<path class="sb-shadow" fill-rule="evenodd" d="${shadowPolys[0]}">
      <animate id="${idp}-a" attributeName="d" dur="${dur}s" repeatCount="indefinite" keyTimes="${kt}" values="${shadowPolys.join(';')}"/></path>`;
  const arcSvg = `<polyline class="sb-arc" points="${arc.join(' ')}"/>${ticks}${times}`;
  const disc = `<g class="sb-sun"><circle r="7" class="sb-sun-halo"/><circle r="4"/>
      <animateMotion dur="${dur}s" repeatCount="indefinite" keyTimes="${kt}" keyPoints="${kt}" calcMode="linear"
        path="M${sunPts.map(([x, y]) => `${f(x)},${f(y)}`).join(' L')}"/></g>`;
  return { shadow, sun: arcSvg + disc, arc: arcSvg, disc };
}

/* -------------------------------------------------------------------------
   Uses on the deck: every use is ONE solid, a capped pyramid on an irregular
   polygonal base (world metres on the deck top), and the four embrace each
   other: the green spine runs up the middle connector, culture and health
   hook round its foot from both sides on the southern band, and the housing
   on the northern band wraps round its head like a U. Shared by the use
   shots, the solar diagram and the layer explosion.
   ------------------------------------------------------------------------- */

/** A counter-clockwise polygon moved inwards by d on every side (the top of a capped pyramid); its
    notches stay notches, so d must stay well below the narrowest part. */
function inset(poly, d) {
  const n = poly.length;
  const line = (i) => {                                    // edge i shifted inwards: point + direction
    const [ax, ay] = poly[i], [bx, by] = poly[(i + 1) % n], l = Math.hypot(bx - ax, by - ay);
    return { p: [ax - (by - ay) / l * d, ay + (bx - ax) / l * d], v: [(bx - ax) / l, (by - ay) / l] };
  };
  return poly.map((_, i) => {
    const a = line((i - 1 + n) % n), b = line(i);
    const den = a.v[0] * b.v[1] - a.v[1] * b.v[0];
    if (Math.abs(den) < 1e-9) return b.p;
    const t = ((b.p[0] - a.p[0]) * b.v[1] - (b.p[1] - a.p[1]) * b.v[0]) / den;
    return [a.p[0] + a.v[0] * t, a.p[1] + a.v[1] * t];
  });
}

/**
 * A plain box with the same number of corners as poly, in the same order: each corner of poly,
 * seen from its centre, pushed out to the rectangle r. So a box can deform into the polygon.
 */
function rectLike({ x0, y0, x1, y1 }, poly) {
  const cx = poly.reduce((a, q) => a + q[0], 0) / poly.length, cy = poly.reduce((a, q) => a + q[1], 0) / poly.length;
  const mx = (x0 + x1) / 2, my = (y0 + y1) / 2, hw = (x1 - x0) / 2, hd = (y1 - y0) / 2;
  return poly.map(([x, y]) => {
    const a = Math.atan2(y - cy, x - cx), c = Math.cos(a), sn = Math.sin(a);
    const t = Math.min(Math.abs(c) > 1e-9 ? hw / Math.abs(c) : Infinity, Math.abs(sn) > 1e-9 ? hd / Math.abs(sn) : Infinity);
    return [mx + c * t, my + sn * t];
  });
}

/**
 * A capped pyramid: base polygon at z0, top polygon at z1, as one solid (the base may have notches).
 * The faces turned away from the camera come first, then the others far → near; `order` keeps
 * that sequence, so a morph between two such volumes can keep the same paths.
 */
function frustum(P, base, top, z0, z1) {
  const B = base.map(([x, y]) => P(x, y, z0)), T = top.map(([x, y]) => P(x, y, z1));
  const area = (q) => q.reduce((a, p, i) => { const r = q[(i + 1) % q.length]; return a + p[0] * r[1] - r[0] * p[1]; }, 0);
  const up = Math.sign(area(T)) || 1;
  const sides = base.map((_, i) => { const j = (i + 1) % base.length; return [B[i], B[j], T[j], T[i]]; });
  const depth = (i) => { const j = (i + 1) % base.length; return base[i][0] + base[i][1] + base[j][0] + base[j][1]; };
  const order = sides.map((q, i) => ({ i, front: Math.sign(area(q)) === up ? 1 : 0, d: depth(i) }))
    .sort((a, b) => a.front - b.front || b.d - a.d).map((o) => o.i);
  const front = order.filter((i) => Math.sign(area(sides[i])) === up);
  return { sides: sides.map((q) => dPath(q)), top: dPath(T), order, front };
}
/** One use volume (a capped pyramid on its polygon), styled by cls like a box. */
function useVolume(P, b, cls, dz = 0) {
  const F = frustum(P, b.poly, b.top, b.z0 + dz, b.z1 + dz);
  return `<g class="${cls}">${F.order.map((i) => `<path class="f-s ${F.front.includes(i) ? 'k-sil' : 'k-cr'}" d="${F.sides[i]}"/>`).join('')}<path class="f-t k-sil" d="${F.top}"/></g>`;
}

const USES = (() => {
  const z = DISTRICT.deck.z1;
  const defs = {
    // poly: the base, counter-clockwise; h: height; slope: how far the sides step in per metre of height
    culture: { n: 1, label: 'CULTURE', tags: 'PAVILIONS · EVENT SPACE',          // hooks round the green's foot from the west
      poly: [[42, 72], [70, 54], [118, 52], [150, 66], [128, 74], [138, 94], [96, 92], [52, 90]], h: 7, slope: 0.6 },
    health: { n: 2, label: 'HEALTH & WELLBEING', tags: 'SPORT · POOL · WELLBEING',  // … and from the east
      poly: [[150, 66], [196, 52], [244, 56], [256, 74], [246, 92], [200, 94], [164, 94], [172, 76]], h: 6, slope: 0.6 },
    green: { n: 4, label: 'GREEN AREAS', tags: 'PLANTED AREAS · SHADE',          // the spine up the middle connector
      poly: [[128, 74], [150, 66], [172, 76], [162, 96], [162, 128], [168, 140], [160, 156], [140, 158], [130, 142], [138, 128], [138, 96]], h: 3, slope: 0.6 },
    res: { n: 3, label: 'RESIDENTIAL', tags: 'HOUSING VOLUMES',                  // a U round the green's head
      poly: [[94, 138], [122, 130], [138, 128], [130, 142], [140, 158], [160, 156], [168, 140], [162, 128], [178, 130], [206, 136],
        [212, 154], [196, 170], [150, 170], [104, 170], [88, 156]], h: 14, slope: 0.25 },
  };
  for (const [k, u] of Object.entries(defs)) {
    const xs = u.poly.map((q) => q[0]), ys = u.poly.map((q) => q[1]);
    u.items = [{ x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys),
      z0: z, z1: z + u.h, use: k, poly: u.poly, top: inset(u.poly, u.h * u.slope) }];
  }
  return defs;
})();
const ALL_USE_BOXES = Object.values(USES).flatMap((u) => u.items);
const USE_ORDER = ['culture', 'health', 'res', 'green'];
const byDepth = (a, b) => (b.x0 + b.x1 + b.y0 + b.y1) - (a.x0 + a.x1 + a.y0 + a.y1);

/** All use boxes; `focus` (a use key, 'all' or null) decides which ones get colour. */
function useBoxes(P, focus, dz = 0) {
  return ALL_USE_BOXES.slice().sort(byDepth).map((b, i) => {
    const lit = focus === 'all' || b.use === focus;
    const svg = useVolume(P, b, `use-box use-${b.use} ${lit ? 'is-focus' : 'is-muted'}`, dz);
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

/**
 * Uses and circulation in one shot: the whole deck in isometric, every volume transparent. A route
 * builds up from the street, up a stair core, along the deck's arms and down again; each use
 * volume takes its colour the moment the line reaches it, so the programme appears along the way.
 * The plan in the corner follows.
 */
function usesShot(id, shot = 55) {
  const P = isoP(122, 190, 0.68), D = DISTRICT;
  const z = D.deck.z1 + 0.4, DRAW = 0.85, FADE = 0.025;            // the line draws in 85 % of the shot, then holds
  // route in world metres: [x, y, z] (street → stair up → deck arms → stair down → street)
  const route = [
    [230, -14, 0.3], [230, 62, 0.3], [230, 62, z],                  // street, then up the stair core at (230, 70)
    [230, 70, z], [150, 70, z], [70, 70, z],                        // along the southern arm
    [70, 150, z], [150, 150, z], [230, 150, z],                     // western arm, then the northern arm
    [230, 158, z], [230, 158, 0.3], [230, 236, 0.3],                // down the stair core at (230, 150), out to the street
  ];
  const scr = route.map((q) => P(...q));
  const seg = scr.slice(1).map((q, i) => Math.hypot(q[0] - scr[i][0], q[1] - scr[i][1]));
  const total = seg.reduce((a, b) => a + b, 0);
  const before = seg.map((_, i) => seg.slice(0, i).reduce((a, b) => a + b, 0));
  const d = `M${scr.map((q) => q.map(f).join(',')).join(' L')}`;
  // when the line passes closest to a volume (on the deck), as a share of the shot
  const reach = (b) => {
    const cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2;
    let best = Infinity, t = 0;
    for (let i = 0; i < route.length - 1; i++) {
      const [ax, ay, az] = route[i], [bx, by, bz] = route[i + 1], L2 = (bx - ax) ** 2 + (by - ay) ** 2;
      if (az < z || bz < z || !L2) continue;
      const k = Math.max(0, Math.min(1, ((cx - ax) * (bx - ax) + (cy - ay) * (by - ay)) / L2));
      const dd = Math.hypot(ax + k * (bx - ax) - cx, ay + k * (by - ay) - cy);
      if (dd < best) { best = dd; t = (before[i] + k * seg[i]) / total; }
    }
    return t * DRAW;
  };
  const appear = (b) => {
    const a = reach(b);
    return `<animate attributeName="opacity" dur="${shot}s" fill="freeze" values="0;0;1;1" keyTimes="0;${f2(a)};${f2(a + FADE)};1"/>`;
  };
  // each volume: its transparent outline, and over it the coloured version that fades in when reached
  const boxes = ALL_USE_BOXES.slice().sort(byDepth).map((b) =>
    useVolume(P, b, `use-box use-${b.use} is-muted`)
    + `<g opacity="0">${appear(b)}${useVolume(P, b, `use-box use-${b.use} is-focus`)}</g>`).join('');
  // stair cores at every pylon: a switchback from street to deck, the two used ones stronger
  const used = ['230,70', '230,150'];
  const stairs = D.pylons.map((b) => {
    const [px, py] = [(b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2], p = [];
    for (let k = 0; k <= 12; k++) p.push(P(px + (k % 2 ? 5 : -5), py - 7, (k / 12) * D.deck.z0).map(f).join(','));
    return `<polyline class="circ-stair${used.includes(`${px},${py}`) ? ' is-used' : ''}" points="${p.join(' ')}"/>`;
  }).join('');
  const dk = D.deck, k = 48 / (dk.x1 - dk.x0);
  const outline = dk.loops.map((l) => `M${l.map(([x, y]) => `${f((x - dk.x0) * k)},${f((dk.y1 - y) * k)}`).join(' L')}Z`).join(' ');
  const rect = (b, cls) => `<polygon class="use-loc use-${b.use}${cls}" points="${b.poly.map(([x, y]) => `${f((x - dk.x0) * k)},${f((dk.y1 - y) * k)}`).join(' ')}"/>`;
  const plan = `<g transform="translate(258 10)">
    <path class="use-loc-deck" fill-rule="evenodd" d="${outline}"/>
    ${ALL_USE_BOXES.map((b) => rect(b, '')).join('')}
    ${ALL_USE_BOXES.map((b) => `<g opacity="0">${appear(b)}${rect(b, ' is-focus')}</g>`).join('')}
  </g>`;
  return `
    <rect class="sb-bg" width="320" height="180"/>
    <g class="use-below">${drawCity(P, D.pylons)}</g>
    ${deckSlab(P)}
    ${boxes}
    ${stairs}
    <path class="circ-route" d="${d}" pathLength="100" stroke-dasharray="100" stroke-dashoffset="100">
      <animate attributeName="stroke-dashoffset" dur="${shot}s" fill="freeze" values="100;0;0" keyTimes="0;${DRAW};1"/>
    </path>
    <circle class="circ-head" r="2.6">
      <animateMotion dur="${shot}s" fill="freeze" path="${d}" keyPoints="0;1;1" keyTimes="0;${DRAW};1" calcMode="linear"/>
    </circle>
    ${plan}`;
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
   Heat of the district (S4), drawn like a solar irradiation study: every
   surface gets the share of the sun it receives over 21 June and the equinox
   (every 30 min, weighted by the angle of the sun on it), shaded by the
   buildings and, with the Raumpark, by its deck and pylons. Blue-violet is
   shade, then red and orange, yellow is full sun. Ground and roofs are one
   raster in plan, mapped into the isometric view; each wall runs from its
   value at the street to its value under the eaves.
   ------------------------------------------------------------------------- */

const PLASMA = [[0, [44, 28, 168]], [0.3, [128, 22, 176]], [0.55, [214, 46, 84]], [0.78, [247, 130, 26]], [1, [255, 233, 44]]];
function plasma(v) {
  v = Math.max(0, Math.min(1, v));
  const i = Math.max(1, PLASMA.findIndex(([t]) => t >= v));
  const [t0, a] = PLASMA[i - 1], [t1, b] = PLASMA[i], k = (v - t0) / (t1 - t0);
  return a.map((c, n) => Math.round(c + (b[n] - c) * k));
}
const rgb = (v) => `rgb(${plasma(v).join(',')})`;

/** The camera-facing walls of a mass, far → near, each with its outward normal. */
function frontFaces(loops, z0, z1) {
  const faces = [];
  for (const loop of loops) for (let i = 0; i < loop.length; i++) {
    const [ax, ay] = loop[i], [bx, by] = loop[(i + 1) % loop.length];
    if (-(by - ay) - (ax - bx) <= 0) continue;
    const l = Math.hypot(bx - ax, by - ay);
    faces.push({ d: ax + bx + ay + by, a: [ax, ay], b: [bx, by], n: [(by - ay) / l, -(bx - ax) / l], z0, z1 });
  }
  return faces.sort((p, q) => q.d - p.d);
}

let heatCache = null;
/** Both states (without / with the Raumpark): a plan raster as an image, and the walls' values. */
function heatMaps() {
  if (heatCache) return heatCache;
  const D = DISTRICT, g = D.plate, RES = 2;
  const W = Math.ceil((g.x1 - g.x0) / RES), H = Math.ceil((g.y1 - g.y0) / RES);
  const samples = [];
  for (const id of ['jun', 'mar']) {
    const d = CONFIG.sun.dates.find((x) => x.id === id);
    for (let m = 5 * 60; m <= 20 * 60; m += 30) {
      const p = sunPosition(d.day, m, d.tz, CONFIG.site.latitude, CONFIG.site.longitude);
      if (p.altitude > 5 * Math.PI / 180) samples.push(sunVector(p.altitude, p.azimuth + GRID_TURN));
    }
  }
  const full = samples.reduce((n, v) => n + v[2], 0);   // a flat roof in open sky
  const hall = { ...D.hall, z0: 0, block: true, loops: rectsToOutline([[D.hall.x0, D.hall.y0, D.hall.x1, D.hall.y1]], 1) };
  const pieces = [...D.blocks, hall];
  const city = [...D.parcels, { ...D.hall, z0: 0 }];
  const raumpark = [...D.deck.rects.map(([x0, y0, x1, y1]) => ({ x0, y0, x1, y1, z0: D.deck.z0, z1: D.deck.z1 })),
    ...D.pylons.map((p) => ({ ...p, z0: 0 }))];
  // the surface height of every pixel: a roof, or the ground (streets, courtyards, parks)
  const zOf = new Float64Array(W * H), park = new Uint8Array(W * H);
  for (let v = 0; v < H; v++) for (let u = 0; u < W; u++) {
    const x = g.x0 + (u + 0.5) * RES, y = g.y0 + (v + 0.5) * RES;
    const b = city.find((q) => x > q.x0 && x < q.x1 && y > q.y0 && y < q.y1);
    zOf[v * W + u] = b ? b.z1 : 0;
    park[v * W + u] = D.parks.some((pk) => x > pk.x0 && x < pk.x1 && y > pk.y0 && y < pk.y1) ? 1 : 0;
  }
  const heights = [...new Set(zOf)];
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d', { willReadFrequently: true });

  const state = (solids) => {
    const acc = new Float32Array(W * H);
    for (const sv of samples) {
      const kx = -sv[0] / sv[2], ky = -sv[1] / sv[2];       // shadow offset on a plane per metre of height
      for (const zr of heights) {
        // the shadows the solids throw onto the plane at height zr
        ctx.clearRect(0, 0, W, H);
        ctx.fillStyle = '#000';
        ctx.beginPath();
        for (const b of solids) {
          const lo = Math.max(b.z0, zr) - zr, hi = b.z1 - zr;
          if (hi <= 0) continue;
          const c = [];
          for (const t of [lo, hi]) for (const [x, y] of [[b.x0, b.y0], [b.x1, b.y0], [b.x1, b.y1], [b.x0, b.y1]]) {
            c.push([(x + kx * t - g.x0) / RES, (y + ky * t - g.y0) / RES]);
          }
          const hl = hull(c);
          ctx.moveTo(...hl[0]);
          for (const q of hl.slice(1)) ctx.lineTo(...q);
          ctx.closePath();
        }
        ctx.fill('nonzero');
        const px = ctx.getImageData(0, 0, W, H).data;
        for (let i = 0; i < W * H; i++) if (zOf[i] === zr) acc[i] += sv[2] * (1 - px[i * 4 + 3] / 255);
      }
    }
    const img = ctx.createImageData(W, H);
    for (let i = 0; i < W * H; i++) {
      const c = plasma(acc[i] / full - (park[i] && !zOf[i] ? 0.12 : 0));
      img.data.set([...c, 255], i * 4);
    }
    ctx.putImageData(img, 0, 0);
    const url = cv.toDataURL();
    // walls: sun on the wall (by its normal) at the street and under the eaves, rays against the solids
    const lit = (p, n) => {
      let got = 0;
      for (const sv of samples) {
        const c = n[0] * sv[0] + n[1] * sv[1];
        if (c > 0 && !solids.some((b) => rayBox(p, sv, b))) got += c;
      }
      return Math.min(1, (got / full) * 1.6);
    };
    const walls = pieces.map((pc) => frontFaces(pc.loops, 0, pc.z1).map((fc) => {
      const m = [(fc.a[0] + fc.b[0]) / 2 + fc.n[0] * 0.4, (fc.a[1] + fc.b[1]) / 2 + fc.n[1] * 0.4];
      return [lit([...m, 1], fc.n), lit([...m, pc.z1 - 1], fc.n)];
    }));
    return { url, walls };
  };
  heatCache = { W, H, RES, x0: g.x0, y0: g.y0, pieces, without: state(city), with: state([...city, ...raumpark]) };
  return heatCache;
}

/* -------------------------------------------------------------------------
   Quality of sunlight (S9): sun hours on 20 March, the equinox, the usual day
   for daylight studies. A time-lapse from morning to evening: the ground and
   roofs of the city and the deck top add up the hours they are in the sun,
   shaded by the city, the deck, its pylons and the use solids. One raster per
   hour, each the total so far: below the deck in plan, and on the deck.
   ------------------------------------------------------------------------- */

/** Sun hours over the day: sky blue (little direct sun) → pale → light orange (sun all day). */
const HOURS = [[0, [112, 172, 224]], [0.35, [170, 206, 232]], [0.6, [242, 232, 214]], [0.82, [248, 200, 150]], [1, [246, 166, 102]]];
function hoursColour(v) {
  v = Math.max(0, Math.min(1, v));
  const i = Math.max(1, HOURS.findIndex(([t]) => t >= v));
  const [t0, a] = HOURS[i - 1], [t1, b] = HOURS[i], k = (v - t0) / (t1 - t0);
  return a.map((c, n) => Math.round(c + (b[n] - c) * k));
}

let hoursCache = null;
/** The sun hours of 20 March (sunrise to sunset), below the deck and on it, as two images. */
function sunHoursMaps() {
  if (hoursCache) return hoursCache;
  const D = DISTRICT, g = D.plate, dk = D.deck, RES = 2.5;
  const W = Math.ceil((g.x1 - g.x0) / RES), H = Math.ceil((g.y1 - g.y0) / RES);
  const date = CONFIG.sun.dates.find((x) => x.id === 'mar');
  const sunAt = (m) => { const q = sunPosition(date.day, m, date.tz, CONFIG.site.latitude, CONFIG.site.longitude);
    return q.altitude > 2 * Math.PI / 180 ? sunVector(q.altitude, q.azimuth + GRID_TURN) : null; };
  const city = [...D.parcels, { ...D.hall, z0: 0 }];
  const solids = [...city,
    ...dk.rects.map(([x0, y0, x1, y1]) => ({ x0, y0, x1, y1, z0: dk.z0, z1: dk.z1 })),
    ...D.pylons.map((q) => ({ ...q, z0: 0 })),
    ...ALL_USE_BOXES];                                            // the use solids throw the shadow of their own shape
  // the surface of every pixel: below the deck a roof or the ground, above it the deck top
  const zLow = new Float64Array(W * H), onDeck = new Uint8Array(W * H);
  for (let v = 0; v < H; v++) for (let u = 0; u < W; u++) {
    const x = g.x0 + (u + 0.5) * RES, y = g.y0 + (v + 0.5) * RES;
    const b = city.find((q) => x > q.x0 && x < q.x1 && y > q.y0 && y < q.y1);
    zLow[v * W + u] = b ? b.z1 : 0;
    onDeck[v * W + u] = insideRects(dk.rects, x, y) ? 1 : 0;
  }
  const heights = [...new Set(zLow)];
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  // the shadows the solids throw onto the plane at height zr, as alpha
  const shadow = (sv, zr) => {
    const kx = -sv[0] / sv[2], ky = -sv[1] / sv[2];
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#000';
    ctx.beginPath();
    for (const b of solids) {
      const lo = Math.max(b.z0, zr) - zr, hi = b.z1 - zr;
      if (hi <= 0) continue;
      const c = [];
      const at = (ring, t) => ring.forEach(([x, y]) => c.push([(x + kx * t - g.x0) / RES, (y + ky * t - g.y0) / RES]));
      if (b.poly) { at(b.poly, lo); at(b.top, hi); }
      else for (const t of [lo, hi]) at([[b.x0, b.y0], [b.x1, b.y0], [b.x1, b.y1], [b.x0, b.y1]], t);
      const hl = hull(c);
      ctx.moveTo(...hl[0]);
      for (const q of hl.slice(1)) ctx.lineTo(...q);
      ctx.closePath();
    }
    ctx.fill('nonzero');
    return ctx.getImageData(0, 0, W, H).data;
  };
  const STEP = 15, low = new Float32Array(W * H), up = new Float32Array(W * H);
  const image = (acc, mask) => {
    const img = ctx.createImageData(W, H);
    for (let i = 0; i < W * H; i++) {
      if (mask && !mask[i]) continue;                                // transparent off the deck
      img.data.set([...hoursColour(acc[i] / 11), 255], i * 4);         // 11 h of sun = the top of the scale
    }
    ctx.putImageData(img, 0, 0);
    return cv.toDataURL();
  };
  for (let m = 5 * 60; m <= 20 * 60; m += STEP) {
    const sv = sunAt(m);
    if (sv) {
      for (const zr of heights) {
        const px = shadow(sv, zr);
        for (let i = 0; i < W * H; i++) if (zLow[i] === zr) low[i] += (STEP / 60) * (1 - px[i * 4 + 3] / 255);
      }
      const px = shadow(sv, dk.z1);
      for (let i = 0; i < W * H; i++) if (onDeck[i]) up[i] += (STEP / 60) * (1 - px[i * 4 + 3] / 255);
    }
  }
  const day = { low: image(low), up: image(up, onDeck) };
  const hall = { ...D.hall, z0: 0, block: true, loops: rectsToOutline([[D.hall.x0, D.hall.y0, D.hall.x1, D.hall.y1]], 1) };
  hoursCache = { W, H, RES, x0: g.x0, y0: g.y0, day, pieces: [...D.blocks, hall] };
  return hoursCache;
}

/* -------------------------------------------------------------------------
   Sketch generators (viewBox 320 × 180, i.e. 16:9)
   ------------------------------------------------------------------------- */

const SKETCHES = {
  /* S1 — Vienna from above: real city outline (OSM) with a schematic heat map, zoom target on Westbahnhof */
  heatmap(id) {
    const V = VIENNA, S = V.pxPerKm, [cx, cy] = V.centre, WB = V.westbahnhof;
    const km = (x, y) => [(x - cx) / S, -(y - cy) / S];          // frame → km from Stephansplatz (east, north)
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
    for (let y = 2; y <= 178; y += 6) {
      for (let x = 54; x <= 280; x += 6) {
        // the field runs a little past the city edge; it is blurred and clipped to the outline
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
        dots += `<circle class="h${k}" cx="${x}" cy="${y}" r="5" style="--d:${(d * 9).toFixed(0)}ms"/>`;
      }
    }

    const path = (pts, close) => `M${pts.map((q) => q.map(f).join(',')).join(' L')}${close ? 'Z' : ''}`;

    return `
      <rect class="sb-bg" width="320" height="180"/>
      <defs>
        <clipPath id="${id}-city"><path d="${path(V.outline, true)}"/></clipPath>
        <filter id="${id}-soft" x="-5%" y="-5%" width="110%" height="110%"><feGaussianBlur stdDeviation="4.5"/></filter>
      </defs>
      <g clip-path="url(#${id}-city)"><g class="sb-heat" filter="url(#${id}-soft)">${dots}</g></g>
      <path class="sb-city" d="${path(V.outline, true)}"/>
      ${V.danube.map((l) => `<path class="sb-river" d="${path(l)}"/>`).join('')}
      ${V.canal.map((l) => `<path class="sb-canal" d="${path(l)}"/>`).join('')}
      <circle class="sb-line" cx="${f(cx)}" cy="${f(cy)}" r="${f(0.9 * S)}"/>
      <g class="sb-zoom">
        <rect x="${f(WB[0] - 16)}" y="${f(WB[1] - 10)}" width="32" height="20"/>
      </g>
      <circle class="sb-mark" cx="${f(WB[0])}" cy="${f(WB[1])}" r="2.4"/>
      <g transform="translate(14 150)">
        ${[1, 2, 3, 4, 5].map((k) => `<rect class="h${k}" x="${(k - 1) * 12}" y="0" width="12" height="5"/>`).join('')}
      </g>
      <g class="sb-north"><circle cx="300" cy="24" r="8"/><path d="M300 24 V12"/></g>`;
  },

  /* S2 — the district as it is today (no Raumpark). A wider view shows every building of the
     area around Westbahnhof alike; then the buildings outside the district fade back, and the
     district used in all the other shots stands out. */
  'district-border'(id, shot = 15) {
    const P = isoP(160, 124, 0.3);
    const D = DISTRICT;
    // district and surroundings sorted together, so they hide each other correctly
    const buildings = [...D.contextBlocks, ...D.blocks, D.hall]
      .sort((p, q) => (q.x0 + q.x1 + q.y0 + q.y1) - (p.x0 + p.x1 + p.y0 + p.y1))
      .map((b) => drawPiece(P, b, b.ctx ? ' db-ctx' : ''))
      .join('');
    return `
      <rect class="sb-bg" width="320" height="180"/>
      ${groundSvg(P, { context: false, edge: false })}
      ${buildings}`;
  },

  /* S3 — Raumpark: city design is climate design. Urban expansion and densification as populated
     green space above, and interlinked with, the existing city. Some blocks of the existing city
     take the colours of the uses; the pylons rise, green climbing them, and the deck spreads out
     along the streets; then the coloured blocks' volumes are duplicated, lift off and deform into
     the volumes on the deck: what the city has, taken up one level and reshaped to fit. */
  'raumpark-rise'(id, shot = 15) {
    const sc = 0.39, P = isoP(160, 139, sc), D = DISTRICT, dk = D.deck;
    const dur = `dur="${shot}s" fill="freeze"`;
    const fade = (a, b) => `<animate attributeName="opacity" ${dur} values="0;0;1;1" keyTimes="0;${f2(a)};${f2(b)};1"/>`;
    // grow something upwards from a base point (a vertical scale about that point)
    const grow = (base, svg, a, len) => {
      const [bx, by] = P(...base);
      return `<g transform="translate(${f(bx)} ${f(by)})"><g transform="scale(1 0)">
        <animateTransform attributeName="transform" type="scale" ${dur} calcMode="spline"
          values="1 0;1 0;1 1;1 1" keyTimes="0;${f2(a)};${f2(a + len)};1" keySplines="0 0 1 1;.3 0 .2 1;0 0 1 1"/>
        <g transform="translate(${f(-bx)} ${f(-by)})">${svg}</g></g></g>`;
    };
    const mid = (b) => [(b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2];

    // 1 · some blocks of the existing city take the colours of the uses (0.06 → 0.2):
    // per use one block, picked from the blocks near that use's part of the deck
    const taken = new Set();
    const sources = USE_ORDER.map((use, n) => {
      const c = USES[use].items.reduce((m, b) => [m[0] + mid(b)[0] / USES[use].items.length, m[1] + mid(b)[1] / USES[use].items.length], [0, 0]);
      const blk = D.blocks.filter((q) => !taken.has(q))
        .sort((p, q) => Math.hypot(...mid(p).map((v, k) => v - c[k])) - Math.hypot(...mid(q).map((v, k) => v - c[k])))[n % 2];
      taken.add(blk);
      return { use, blk, a: 0.06 + n * 0.035 };
    });
    const tinted = sources.map((sr) => `<g opacity="0">${fade(sr.a, sr.a + 0.04)}${prism(P, sr.blk.loops, 0, sr.blk.z1, `use-box use-${sr.use} is-focus rp-src`)}</g>`).join('');

    // 2 · the structure (0.2 → 0.46): pylons with climbing green, cores from the roofs, the deck
    const pylons = D.pylons.slice().sort(byDepth).map((b, i) => {
      const [x, y] = mid(b), a = 0.2 + i * 0.02;
      const climb = [];
      for (let k = 0; k <= 16; k++) climb.push(P(x + (k % 2 ? 4.4 : -4.4), b.y0 - 0.3, (k / 16) * dk.z0).map(f).join(','));
      return grow([x, y, 0], box(P, b, 'sb-pylon'), a, 0.07)
        + `<polyline class="rp-climb" points="${climb.join(' ')}" pathLength="100" stroke-dasharray="100" stroke-dashoffset="100">
          <animate attributeName="stroke-dashoffset" ${dur} values="100;100;0;0" keyTimes="0;${f2(a + 0.04)};${f2(a + 0.14)};1"/></polyline>`;
    }).join('');
    const cores = D.parcels.filter((b, i) => i % 5 === 2 && insideRects(dk.rects, ...mid(b)))
      .sort(byDepth).map((b, i) => {
        const [x, y] = mid(b), c = { x0: x - 4, y0: y - 4, x1: x + 4, y1: y + 4, z0: b.z1, z1: dk.z0 };
        return grow([x, y, b.z1], box(P, c, 'rp-core'), 0.22 + i * 0.012, 0.07);
      }).join('');
    const near = (r) => Math.min(...D.pylons.map((q) => Math.hypot((r[0] + r[2]) / 2 - mid(q)[0], (r[1] + r[3]) / 2 - mid(q)[1])));
    const pieces = dk.rects.map((r) => ({ r, d: near(r) }));
    const dmax = Math.max(...pieces.map((q) => q.d)) || 1;
    const deckParts = pieces.sort((p, q) => p.d - q.d).map(({ r, d }) => {
      const a = 0.3 + (d / dmax) * 0.12;
      return `<g opacity="0">${fade(a, a + 0.03)}${slab(P, rectsToOutline([r]), dk.z0, dk.z1, 'sb-deck')}</g>`;
    }).join('');
    const deck = `<g opacity="0">${fade(0.44, 0.46)}${deckSlab(P)}</g>`;

    // 3 · the coloured blocks' volumes are duplicated, lift off and deform into the deck's volumes
    // (0.48 → 0.86): from a wing of the block, up above the deck, into its place and shape there
    const moves = sources.map((sr, n) => {
      const u = USES[sr.use].items[0], w = sr.blk, lift = 16;
      // the block as a box with the volume's corners (same order), so it can deform into it
      const b = rectLike(w, u.poly);
      return {
        u, a: 0.48 + n * 0.08,
        from: frustum(P, b, b, 0, w.z1),
        up: frustum(P, b, b, dk.z1 + lift, dk.z1 + lift + w.z1),
        to: frustum(P, u.poly, u.top, u.z0, u.z1),
      };
    }).sort((p, q) => byDepth(p.u, q.u));
    // each duplicate is drawn twice: below the deck while it rises through it, above it after that
    const dupe = (m, show) => {
      const { from: fa, up: fu, to: ft } = m;
      const kt = `0;${f2(m.a)};${f2(m.a + 0.1)};${f2(m.a + 0.2)};1`;
      const morph = (get) => `<animate attributeName="d" ${dur} calcMode="spline" values="${get(fa)};${get(fa)};${get(fu)};${get(ft)};${get(ft)}"
        keyTimes="${kt}" keySplines="0 0 1 1;.45 0 .3 1;.45 0 .3 1;0 0 1 1"/>`;
      // the faces in the order of the finished volume: the hidden ones first
      const sides = ft.order.map((i) => `<path class="f-s k-sil" d="${fa.sides[i]}">${morph((F) => F.sides[i])}</path>`).join('');
      return `<g class="use-box use-${m.u.use} is-focus" opacity="0">${show}${sides}
        <path class="f-t k-sil" d="${fa.top}">${morph((F) => F.top)}</path></g>`;
    };
    const vis = (a, b) => `<animate attributeName="opacity" ${dur} values="0;0;1;1;0;0" keyTimes="0;${f2(a)};${f2(a + 0.005)};${f2(b)};${f2(b + 0.005)};1"/>`;
    const dupesBelow = moves.map((m) => dupe(m, vis(m.a, m.a + 0.07))).join('');
    const dupesAbove = moves.map((m) => dupe(m, fade(m.a + 0.07, m.a + 0.075))).join('');

    return `
      <rect class="sb-bg" width="320" height="180"/>
      ${groundSvg(P)}
      ${drawCity(P)}
      ${tinted}${dupesBelow}${cores}${pylons}
      ${deckParts}${deck}
      ${dupesAbove}`;
  },

  /* S5 — the district's heat without the Raumpark, then with it, as a solar irradiation map:
     ground, roofs and walls coloured by the sun they get (shade blue-violet → full sun yellow).
     The Raumpark fades in and its shadow cools the streets and courtyards below. */
  'district-heat'(id, shot = 15) {
    const sc = 0.39, P = isoP(160, 139, sc), D = DISTRICT, HM = heatMaps();
    const loop = `dur="${shot}s" fill="freeze"`;
    const fadeIn = `<animate attributeName="opacity" ${loop} values="0;0;1;1" keyTimes="0;0.4;0.55;1"/>`;
    const [ex, ey] = P(HM.x0, HM.y0), r = HM.RES * sc;
    const matrix = `matrix(${f(C30 * r)} ${f(-0.5 * r)} ${f(-C30 * r)} ${f(-0.5 * r)} ${f(ex)} ${f(ey)})`;
    const scene = (k, raumpark) => {
      const S = HM[k], img = `${id}-${k}`;
      const defs = [`<image id="${img}" href="${S.url}" width="${HM.W}" height="${HM.H}" preserveAspectRatio="none" transform="${matrix}"/>`];
      const pieces = HM.pieces.map((pc, i) => ({ ...pc, i })).concat(raumpark ? D.pylons : [])
        .sort((a, b) => (b.x0 + b.x1 + b.y0 + b.y1) - (a.x0 + a.x1 + a.y0 + a.y1));
      const drawn = pieces.map((pc) => {
        if (pc.pylon) return box(P, pc, 'hm-pylon');
        const walls = frontFaces(pc.loops, 0, pc.z1).map((fc, j) => {
          const [vb, vt] = S.walls[pc.i][j], gid = `${img}-${pc.i}-${j}`;
          const mx = (fc.a[0] + fc.b[0]) / 2, my = (fc.a[1] + fc.b[1]) / 2;
          const [x1, y1] = P(mx, my, 0), [x2, y2] = P(mx, my, pc.z1);
          defs.push(`<linearGradient id="${gid}" gradientUnits="userSpaceOnUse" x1="${f(x1)}" y1="${f(y1)}" x2="${f(x2)}" y2="${f(y2)}"><stop offset="0" stop-color="${rgb(vb)}"/><stop offset="1" stop-color="${rgb(vt)}"/></linearGradient>`);
          return `<path class="hm-edge" fill="url(#${gid})" d="${dPath([[...fc.a, 0], [...fc.b, 0], [...fc.b, pc.z1], [...fc.a, pc.z1]].map((q) => P(...q)))}"/>`;
        }).join('');
        const roof = loopsPath(P, pc.loops, pc.z1);
        defs.push(`<clipPath id="${img}-r${pc.i}"><path clip-rule="evenodd" d="${roof}"/></clipPath>`);
        return `${walls}<g clip-path="url(#${img}-r${pc.i})"><use href="#${img}" transform="translate(0 ${f(-pc.z1 * sc)})"/></g>
          <path class="hm-edge hm-roof" fill-rule="evenodd" d="${roof}"/>`;
      }).join('');
      return `<defs>${defs.join('')}</defs>
        <g clip-path="url(#${id}-plate)"><use href="#${img}"/></g>
        ${drawn}${raumpark ? `<g class="hm-deck">${deckSlab(P)}</g>` : ''}`;
    };
    return `
      <rect class="sb-bg" width="320" height="180"/>
      <defs>
        <clipPath id="${id}-plate"><path clip-rule="evenodd" d="${loopsPath(P, D.plate.loops, 0)}"/></clipPath>
        <linearGradient id="${id}-lg">${PLASMA.map(([t, c]) => `<stop offset="${t}" stop-color="rgb(${c.join(',')})"/>`).join('')}</linearGradient>
      </defs>
      ${groundSvg(P)}
      <g>${scene('without', false)}</g>
      <g opacity="0">${fadeIn}${scene('with', true)}</g>
      <rect x="14" y="160" width="70" height="5" fill="url(#${id}-lg)"/>`;
  },

  /* S3 — Westbahnhof isometric with an animated sun and the deck's shadow */
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

  /* S5 — same view, static wind vectors at street level and deck level */
  wind() {
    const P = isoP(160, 139, 0.39);
    const base = districtBase(P);
    // one wind vector: shaft along the (slightly veering) flow direction, arrowhead in screen space
    const vec = (x, y, z, len, cls) => {
      const a = Math.sin(x * 0.05 + y) * 0.22;
      const [x0, y0] = P(x, y, z);
      const [x1, y1] = P(x + len * Math.cos(a), y + len * Math.sin(a), z);
      const t = Math.atan2(y1 - y0, x1 - x0), h = 2.4;
      const head = (s) => `${f(x1 - h * Math.cos(t + s))} ${f(y1 - h * Math.sin(t + s))}`;
      return `<path class="${cls}" d="M${f(x0)} ${f(y0)} L${f(x1)} ${f(y1)} M${head(0.5)} L${f(x1)} ${f(y1)} L${head(-0.5)}"/>`;
    };
    // a row of vectors, kept where both tail and tip lie inside the given area
    const row = (y, z, len, cls, from, to, step, inside) => {
      let out = '';
      for (let x = from; x <= to; x += step) {
        const l = len * (0.75 + 0.25 * Math.sin(x * 0.03 + y * 0.1));   // speed varies along the row
        if (inside(x, y) && inside(x + l, y)) out += vec(x, y, z, l, cls);
      }
      return out;
    };
    const onPlate = (x, y) => insideRects(DISTRICT.plate.rects, x, y);
    const street = [-10, 70, 150, 230].map((y) => row(y, 1, 11, 'sb-vec', -96, 316, 22, onPlate)).join('');
    const deck = [62, 86, 110, 134, 158].map((y) => row(y, 52, 20, 'sb-vec sb-vec--deck', 20, 290, 30, () => true)).join('');
    // sheltered corners: a static curl with an arrowhead on its open end
    const eddies = [[70, 30], [150, 110], [230, 190]].map(([x, y]) => {
      const [ex, ey] = P(x, y, 1);
      const pt = (deg) => [ex + 6 * Math.cos(deg * Math.PI / 180), ey + 3.5 * Math.sin(deg * Math.PI / 180)];
      const [sx, sy] = pt(30), [tx, ty] = pt(330);
      return `<path class="sb-eddy" d="M${f(sx)} ${f(sy)} A6 3.5 0 1 1 ${f(tx)} ${f(ty)} M${f(tx - 2.4)} ${f(ty - 1.2)} L${f(tx)} ${f(ty)} L${f(tx - 0.6)} ${f(ty + 2.2)}"/>`;
    }).join('');
    const [ax, ay] = P(-125, 110, 0);
    return `
      <rect class="sb-bg" width="320" height="180"/>
      ${base.ground}${street}${eddies}${base.city}${base.deck}${deck}
      <g class="sb-windarrow" transform="translate(${f(ax - 6)} ${f(ay - 4)}) rotate(-30)"><path d="M-14 0 H8 M2 -4 L8 0 L2 4"/></g>
`;
  },

  /* S6 — layers: the same district taken apart. The city stays on the ground; the pylons, the
     deck and the uses lift away one after the other, thin lines mark where the pylons land, and
     the stack closes again. */
  layers(id, shot = 10) {
    const sc = 0.34, P = isoP(160, 168, sc), D = DISTRICT;
    const LIFT = [0, 24, 58, 92];                                     // world metres per layer when open
    const kt = (i) => { const d = i * 0.04; return `0;${f2(0.08 + d)};${f2(0.36 + d)};${f2(0.7 - d)};${f2(0.92 - d)};1`; };
    const SPL = '0 0 1 1;.45 0 .2 1;0 0 1 1;.45 0 .2 1;0 0 1 1';
    const lift = (i) => `<animateTransform attributeName="transform" type="translate" dur="${shot}s" fill="freeze" calcMode="spline"
        values="0 0;0 0;0 ${f(-LIFT[i] * sc)};0 ${f(-LIFT[i] * sc)};0 0;0 0" keyTimes="${kt(i)}" keySplines="${SPL}"/>`;
    // where the pylons land: a line from the ground up to the lifted pylon foot
    const drops = D.pylons.map((b) => {
      const x = (b.x0 + b.x1) / 2, y = (b.y0 + b.y1) / 2, [gx, gy] = P(x, y, 0);
      const d = (z) => `M${f(gx)} ${f(gy)} L${f(gx)} ${f(gy - z * sc)}`;
      return `<path class="ly-drop" d="${d(0)}"><animate attributeName="d" dur="${shot}s" fill="freeze" calcMode="spline"
        values="${d(0)};${d(0)};${d(LIFT[1])};${d(LIFT[1])};${d(0)};${d(0)}" keyTimes="${kt(1)}" keySplines="${SPL}"/></path>`;
    }).join('');
    const pylons = D.pylons.slice().sort(byDepth).map((b) => box(P, b, 'sb-pylon')).join('');
    return `
      <rect class="sb-bg" width="320" height="180"/>
      ${groundSvg(P, { context: false })}
      ${drawCity(P)}
      ${drops}
      <g>${lift(1)}${pylons}</g>
      <g>${lift(2)}${deckSlab(P)}</g>
      <g>${lift(3)}${useBoxes(P, 'all')}</g>`;
  },

  /* S7 — overview → the Raumpark turns transparent → push-in on one window → the view out of
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
    const { shadow, sun } = sunLayer(P, dur, id, 'jun', false);
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

  /* single-use variants (not in the storyboard any more) — one shot per use: whole deck, that use's boxes in colour */
  /* S8 — uses and circulation: the route draws, the uses appear where it reaches them */
  uses: (id, shot) => usesShot(id, shot),
  'use-culture': () => useShot('culture'),
  'use-health': () => useShot('health'),
  'use-res': () => useShot('res'),
  'use-green': () => useShot('green'),

  /* S9 — quality of sunlight: the whole of 20 March merged in one picture. The ground, the roofs and
     the deck show how many hours of direct sun they get over the day, sky blue (little) to light
     orange (all day), shaded by the city, the deck and the use solids; the day's sun arc above. */
  'sun-hours'(id) {
    const sc = 0.39, P = isoP(160, 139, sc), D = DISTRICT, dk = D.deck, SH = sunHoursMaps();
    const [ex, ey] = P(SH.x0, SH.y0), r = SH.RES * sc;
    const matrix = `matrix(${f(C30 * r)} ${f(-0.5 * r)} ${f(-C30 * r)} ${f(-0.5 * r)} ${f(ex)} ${f(ey)})`;
    const img = (key) => `<image href="${SH.day[key]}" width="${SH.W}" height="${SH.H}" preserveAspectRatio="none" transform="${matrix}"/>`;
    const defs = [`<g id="${id}-low">${img('low')}</g>`, `<g id="${id}-up">${img('up')}</g>`,
      `<clipPath id="${id}-plate"><path clip-rule="evenodd" d="${loopsPath(P, D.plate.loops, 0)}"/></clipPath>`,
      `<clipPath id="${id}-deck"><path clip-rule="evenodd" d="${loopsPath(P, dk.loops, dk.z1)}"/></clipPath>`,
      `<linearGradient id="${id}-lg">${HOURS.map(([t, c]) => `<stop offset="${t}" stop-color="rgb(${c.join(',')})"/>`).join('')}</linearGradient>`];
    // the city: each block's walls, then its roof in the sun-hours raster (far → near)
    const city = SH.pieces.map((pc, i) => ({ ...pc, i })).concat(D.pylons)
      .sort((a, b) => (b.x0 + b.x1 + b.y0 + b.y1) - (a.x0 + a.x1 + a.y0 + a.y1))
      .map((pc) => {
        if (pc.pylon) return box(P, pc, 'sb-pylon');
        const roof = loopsPath(P, pc.loops, pc.z1);
        defs.push(`<clipPath id="${id}-r${pc.i}"><path clip-rule="evenodd" d="${roof}"/></clipPath>`);
        return `${prism(P, pc.loops, 0, pc.z1, pc.hall ? 'sb-hall' : 'sb-block')}
          <g clip-path="url(#${id}-r${pc.i})"><use href="#${id}-low" transform="translate(0 ${f(-pc.z1 * sc)})"/></g>
          <path class="hm-edge hm-roof" fill-rule="evenodd" d="${roof}"/>`;
      }).join('');
    const { arc } = sunLayer(P, 20, `${id}a`, 'mar');
    const solids = ALL_USE_BOXES.slice().sort(byDepth).map((b) => useVolume(P, b, `use-box use-${b.use} is-focus`)).join('');
    return `
      <rect class="sb-bg" width="320" height="180"/>
      <defs>${defs.join('')}</defs>
      ${groundSvg(P)}
      <g clip-path="url(#${id}-plate)"><use href="#${id}-low"/></g>
      ${city}
      ${deckSlab(P)}
      <g clip-path="url(#${id}-deck)"><use href="#${id}-up" transform="translate(0 ${f(-dk.z1 * sc)})"/></g>
      <path class="sh-deck-edge" fill-rule="evenodd" d="${loopsPath(P, dk.loops, dk.z1)}"/>
      ${solids}
      <g class="sb-season">${arc}</g>
      <rect x="14" y="160" width="70" height="5" fill="url(#${id}-lg)"/>`;
  },

  /* S10 — greenery & solar income: heat map of yearly sun on the deck + what to plant / where PV pays */
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
    // use volumes: planting green, the rest neutral; PV on every sloped side that faces the sun
    // (outward normal towards south, east or west), as rows running up the slope
    const objects = ALL_USE_BOXES.slice().sort(byDepth).map((o) => {
      if (o.use === 'green') return useVolume(P, o, 'use-box use-green is-focus');
      let svg = useVolume(P, o, o.use === 'res' ? 'use-box use-res is-focus' : 'use-box sb-pav');
      const n = o.poly.length;
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n, [ax, ay] = o.poly[i], [bx, by] = o.poly[j], l = Math.hypot(bx - ax, by - ay);
        if (l < 6 || (bx - ax) / l < 0.25) continue;                // outward normal (dy, -dx)/l: keep the ones facing south-ish
        if (-(by - ay) - (ax - bx) <= 0) continue;                  // and only the sides the camera sees
        const [tax, tay] = o.top[i], [tbx, tby] = o.top[j];
        const face = [P(ax, ay, o.z0), P(bx, by, o.z0), P(tbx, tby, o.z1), P(tax, tay, o.z1)];
        svg += `<path class="sol-pv-face" d="${dPath(face)}"/>`;
        const rows = Math.max(2, Math.floor(l / 2.6));
        for (let k = 1; k < rows; k++) {
          const t = k / rows, lo = P(ax + (bx - ax) * t, ay + (by - ay) * t, o.z0 + 0.3), hi = P(tax + (tbx - tax) * t, tay + (tby - tay) * t, o.z1 - 0.3);
          svg += `<line class="sol-pv" x1="${f(lo[0])}" y1="${f(lo[1])}" x2="${f(hi[0])}" y2="${f(hi[1])}"/>`;
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

/* Arrange: the shot order can be changed in the page (drag the storyboard frames or use ← →).
   A static page can't write files, so the order is kept in this browser (localStorage) and
   "Export" downloads storyboard.json in the new order, to save over data/storyboard.json. */
const ORDER_KEY = 'rpv-shot-order';
const readOrder = () => { try { return JSON.parse(localStorage.getItem(ORDER_KEY) || 'null'); } catch { return null; } };
const writeOrder = (ids) => {
  try { if (ids) localStorage.setItem(ORDER_KEY, JSON.stringify(ids)); else localStorage.removeItem(ORDER_KEY); } catch { /* storage unavailable */ }
};

export async function initStoryboard(el, url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  const data = await res.json();
  const names = [...new Set(data.shots.map((s) => s.figure).filter(Boolean))];
  await Promise.all(names.map((n) => import(`./hairline/${n}.js`)));
  for (const s of data.shots) s.id = s.code;                 // stable id: the code in the JSON file

  // the shots in the saved order (unknown or new shots go to the end), renumbered S1, S2, …
  const arranged = () => {
    const ids = readOrder() ?? [];
    const byId = new Map(data.shots.map((s) => [s.id, s]));
    const list = [...ids.map((id) => byId.get(id)).filter(Boolean), ...data.shots.filter((s) => !ids.includes(s.id))];
    return { ...data, shots: list.map((s, i) => ({ ...s, code: `S${i + 1}` })) };
  };
  let arrange = false, stop = null;
  const mount = (focusId) => {
    stop?.();
    const d = arranged();
    stop = render(el, d, {
      arrange,
      custom: !!readOrder(),
      focus: d.shots.findIndex((s) => s.id === focusId),
      onArrange: (on) => { arrange = on; mount(); },
      onMove: (ids, movedId) => { writeOrder(ids); mount(movedId); },
      onReset: () => { writeOrder(null); mount(); },
      onExport: () => {
        const out = { ...data, shots: arranged().shots.map(({ id, start, ...shot }) => shot) };
        const a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob([`${JSON.stringify(out, null, 2)}\n`], { type: 'application/json' }));
        a.download = 'storyboard.json';
        document.body.append(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      },
    });
  };
  mount();
}

function render(el, data, ctl = {}) {
  const shots = data.shots;
  const arrange = !!ctl.arrange;
  let alive = true;
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
      <div class="sb-strip-bar">
        <button class="btn" id="sb-arrange" type="button" aria-pressed="${arrange}">${arrange ? 'Done' : 'Arrange shots'}</button>
        ${arrange ? `<span class="sb-strip-hint">Drag the frames or use ← → to change the order · saved in this browser</span>` : ''}
        ${arrange || ctl.custom ? `<button class="btn" id="sb-reset" type="button"${ctl.custom ? '' : ' disabled'}>Reset order</button>
        <button class="btn" id="sb-export" type="button">Export storyboard.json</button>` : ''}
        ${!arrange && ctl.custom ? '<span class="sb-strip-hint">Own order (saved in this browser)</span>' : ''}
      </div>
      <ol class="sb-strip${arrange ? ' is-arranging' : ''}" aria-label="Storyboard" style="--n:${shots.length}">${shots.map((s, i) => `
        <li data-index="${i}"${arrange ? ' draggable="true"' : ''}>
          <button type="button" class="sb-thumb" data-shot="${i}" title="${arrange ? 'Drag to move' : 'Play from'} ${esc(s.code)} · ${esc(s.title)}">
          ${thumb(s.sketch)}<span>${esc(s.code)}</span></button>
          ${arrange ? `<span class="sb-move">
            <button type="button" data-move="-1" aria-label="Move ${esc(s.code)} earlier"${i === 0 ? ' disabled' : ''}>←</button>
            <button type="button" data-move="1" aria-label="Move ${esc(s.code)} later"${i === shots.length - 1 ? ' disabled' : ''}>→</button>
          </span>` : ''}</li>`).join('')}
      </ol>
      <figure class="sb-frame sb-screen" id="sb-screen">
        <div class="sb-screen__view" id="sb-view" role="img"></div>
        <figcaption><span id="sb-cap"></span><span>Sketch · not final look</span></figcaption>
      </figure>

      <div class="sb-overview">
        <div class="sb-overview__bar">
          <button class="btn" id="sb-prev" type="button" aria-label="Previous shot">←</button>
          <button class="btn btn--play" id="sb-play" type="button" aria-pressed="false"><i aria-hidden="true"></i><span>Play</span></button>
          <button class="btn" id="sb-next" type="button" aria-label="Next shot">→</button>
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
  const STILL = { split: 12, 'district-heat': 12, sun: 5.5, layers: 4, 'district-border': 14, 'raumpark-rise': 14, uses: 38, 'sun-hours': 28 };
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
    if (arrange && c.classList.contains('sb-thumb')) return;   // while arranging, frames move instead of play
    cur = -1;                                       // restart the shot even if it is already on screen
    seek(shots[+c.dataset.shot].start);
  }));

  /* ---- arrange: move shots by drag and drop or with ← → ---- */
  const ids = shots.map((s) => s.id);
  const moveTo = (from, to) => {
    if (to < 0 || to >= ids.length || from === to) return;
    const next = ids.slice();
    const [id] = next.splice(from, 1);
    next.splice(to, 0, id);
    ctl.onMove?.(next, id);
  };
  $('#sb-arrange').addEventListener('click', () => ctl.onArrange?.(!arrange));
  $('#sb-reset')?.addEventListener('click', () => ctl.onReset?.());
  $('#sb-export')?.addEventListener('click', () => ctl.onExport?.());
  if (arrange) {
    const items = [...el.querySelectorAll('.sb-strip li')];
    let dragFrom = -1;
    items.forEach((li) => {
      const i = +li.dataset.index;
      li.querySelectorAll('[data-move]').forEach((b) => b.addEventListener('click', () => moveTo(i, i + +b.dataset.move)));
      li.addEventListener('dragstart', (e) => { dragFrom = i; li.classList.add('is-dragging'); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', String(i)); });
      li.addEventListener('dragend', () => { li.classList.remove('is-dragging'); items.forEach((n) => n.classList.remove('is-over')); });
      li.addEventListener('dragover', (e) => { e.preventDefault(); items.forEach((n) => n.classList.toggle('is-over', n === li)); });
      li.addEventListener('drop', (e) => { e.preventDefault(); moveTo(dragFrom, i); });
    });
  }
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
    if (!alive) return;                             // an old player after re-arranging
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
  const io = new IntersectionObserver(([e]) => { visible = e.isIntersecting; }, { threshold: 0.25 });
  io.observe(screen);
  if (ctl.focus >= 0) seek(shots[ctl.focus].start, { autoplay: false });   // stay on the shot just moved
  else show(0);
  draw();
  setPlaying(!reduced && !arrange);
  requestAnimationFrame((n) => { last = n; loop(n); });

  // stop this player before the strip is rebuilt in a new order
  return () => { alive = false; io.disconnect(); figure?.destroy(); };
}
