/* ==========================================================================
   storyboard.js — proposed story as an edit timeline + schematic shot sketches
   --------------------------------------------------------------------------
   Content comes from data/storyboard.json. Each shot has a "sketch" key that
   picks one of the SVG generators below. Sketches are deliberately schematic
   (line drawings, a few moving parts): they propose an idea, not a final look.
   ========================================================================== */

import { CONFIG } from './config.js';
import { sunPosition, sunVector } from './sun.js';
import { rectsToOutline, insideRects, deckArea, bounds } from './deckshape.js';

const C30 = Math.cos(Math.PI / 6);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const tc = (s) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(Math.round(s % 60)).padStart(2, '0')}`;
const f = (n) => n.toFixed(1);
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

/* -------------------------------------------------------------------------
   Tiny isometric helpers for the sketches (camera from the south-west)
   ------------------------------------------------------------------------- */

/** Projection: world metres (x east, y north, z up) → SVG coordinates. */
const isoP = (ox, oy, s) => (x, y, z = 0) => [ox + (x - y) * C30 * s, oy - ((x + y) * 0.5 + z) * s];
const pts = (P, list) => list.map(([x, y, z]) => P(x, y, z).map(f).join(',')).join(' ');

function box(P, b, cls = '') {
  const { x0, y0, x1, y1, z0 = 0, z1 } = b;
  return `<g class="${cls}">
    <polygon class="f-w" points="${pts(P, [[x0, y1, z0], [x0, y0, z0], [x0, y0, z1], [x0, y1, z1]])}"/>
    <polygon class="f-s" points="${pts(P, [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]])}"/>
    <polygon class="f-t" points="${pts(P, [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]])}"/>
  </g>`;
}

/** SVG path for several loops (outline + holes), to be filled with fill-rule evenodd. */
const loopsPath = (P, loops, z, dx = 0, dy = 0) =>
  loops.map((l) => `M${l.map(([x, y]) => P(x + dx, y + dy, z).map(f).join(',')).join(' L')}Z`).join(' ');

/**
 * A slab extruded from outline loops (outer outline + holes; the deck is always
 * on the left of each loop): the side faces that face the camera, far → near,
 * then the top surface with its openings.
 */
function slab(P, loops, z0, z1, cls = '') {
  const faces = [];
  for (const loop of loops) for (let i = 0; i < loop.length; i++) {
    const [ax, ay] = loop[i], [bx, by] = loop[(i + 1) % loop.length];
    const nx = by - ay, ny = ax - bx;             // outward normal of a CCW edge
    if (-nx - ny <= 0) continue;                  // faces away from the south-west camera
    faces.push({ d: ax + bx + ay + by, cls: ny < 0 ? 'f-s' : 'f-w', p: [[ax, ay, z0], [bx, by, z0], [bx, by, z1], [ax, ay, z1]] });
  }
  faces.sort((a, b) => b.d - a.d);
  return `<g class="${cls}">${faces.map((fc) => `<polygon class="${fc.cls}" points="${pts(P, fc.p)}"/>`).join('')}
    <path class="f-t" fill-rule="evenodd" d="${loopsPath(P, loops, z1)}"/></g>`;
}

/* A schematic Westbahnhof district: 4 × 3 Gründerzeit perimeter blocks (one house
   per parcel, varied eave heights, pitched roofs, open courtyards) and the station
   hall. The proposal is kept as plain boxes: a branching deck on 6 pylons. */
const DISTRICT = (() => {
  let seed = 7;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
  const DEPTH = 13;                                  // depth of a street-front house
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
  const parcel = (x0, y0, x1, y1, ridge) => {
    const floors = 4 + Math.floor(rnd() * 3);        // 4–6 storeys
    const flat = rnd() < 0.12;                       // occasional later infill with a flat roof
    parcels.push({
      x0, y0, x1, y1, z0: 0,
      z1: +(4.5 + floors * 3.4 + (flat ? 2 : 0)).toFixed(1),
      ridge: flat ? null : ridge,
      rh: flat ? 0 : 4 + rnd() * 2.5,
      chimney: !flat && rnd() < 0.5,
    });
  };
  for (let j = 0; j < 3; j++) {
    for (let i = 0; i < 4; i++) {
      if (j === 0 && i < 2) continue;                // station hall takes these two plots
      const bx = i * 80, by = j * 80;
      split(60).forEach(([a, b]) => parcel(bx + a, by, bx + b, by + DEPTH, 'x'));
      split(60).forEach(([a, b]) => parcel(bx + a, by + 60 - DEPTH, bx + b, by + 60, 'x'));
      split(60 - 2 * DEPTH).forEach(([a, b]) => parcel(bx, by + DEPTH + a, bx + DEPTH, by + DEPTH + b, 'y'));
      split(60 - 2 * DEPTH).forEach(([a, b]) => parcel(bx + 60 - DEPTH, by + DEPTH + a, bx + 60, by + DEPTH + b, 'y'));
    }
  }
  const hall = { x0: 0, y0: 0, x1: 140, y1: 60, z1: 14, hall: true };

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
  const deck = { rects, loops, outline: loops[0], z0: 43, z1: 46, ...bounds(rects) };
  const pylons = [[70, 70], [150, 70], [230, 70], [70, 150], [150, 150], [230, 150]]
    .map(([x, y]) => ({ x0: x - 4, y0: y - 4, x1: x + 4, y1: y + 4, z1: 43, pylon: true }));
  return { parcels, hall, deck, pylons, ground: { x0: -18, y0: -18, x1: 318, y1: 238 }, center: [150, 110] };
})();

/** A Gründerzeit house: walls, floor lines, pitched roof with gable, maybe a chimney. */
function house(P, b) {
  const { x0, y0, x1, y1, z1, ridge, rh } = b;
  const poly = (cls, list) => `<polygon class="${cls}" points="${pts(P, list)}"/>`;
  let s = box(P, b, 'sb-block');
  let floors = '';
  for (let z = 4.5; z < z1 - 1; z += 3.4) {
    floors += `M${P(x0, y0, z).map(f)} L${P(x1, y0, z).map(f)} M${P(x0, y1, z).map(f)} L${P(x0, y0, z).map(f)} `;
  }
  s += `<path class="sb-floors" d="${floors}"/>`;
  const zr = z1 + rh;
  if (ridge === 'x') {
    const yc = (y0 + y1) / 2;
    s += poly('sb-roof r-back', [[x0, yc, zr], [x1, yc, zr], [x1, y1, z1], [x0, y1, z1]])
      + poly('sb-roof r-front', [[x0, y0, z1], [x1, y0, z1], [x1, yc, zr], [x0, yc, zr]])
      + poly('sb-roof r-gable', [[x0, y0, z1], [x0, y1, z1], [x0, yc, zr]]);
    if (b.chimney) { const cx = x0 + (x1 - x0) * 0.3; s += box(P, { x0: cx - 0.8, x1: cx + 0.8, y0: yc - 0.8, y1: yc + 0.8, z0: zr - 1, z1: zr + 1.6 }, 'sb-chimney'); }
  } else if (ridge === 'y') {
    const xc = (x0 + x1) / 2;
    s += poly('sb-roof r-back', [[xc, y0, zr], [xc, y1, zr], [x1, y1, z1], [x1, y0, z1]])
      + poly('sb-roof r-front', [[x0, y0, z1], [x0, y1, z1], [xc, y1, zr], [xc, y0, zr]])
      + poly('sb-roof r-gable', [[x0, y0, z1], [x1, y0, z1], [xc, y0, zr]]);
    if (b.chimney) { const cy = y0 + (y1 - y0) * 0.6; s += box(P, { x0: xc - 0.8, x1: xc + 0.8, y0: cy - 0.8, y1: cy + 0.8, z0: zr - 1, z1: zr + 1.6 }, 'sb-chimney'); }
  }
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

function districtBase(P, { deck = true, mark = null } = {}) {
  const D = DISTRICT, g = D.ground;
  const ground = `<polygon class="sb-ground" points="${pts(P, [[g.x0, g.y0, 0], [g.x1, g.y0, 0], [g.x1, g.y1, 0], [g.x0, g.y1, 0]])}"/>`;
  let city = drawCity(P, D.pylons);
  if (mark) {
    const [x, y, z] = mark;
    const [mx, my] = P(x, y, z);
    city += `<circle class="sb-mark" cx="${f(mx)}" cy="${f(my)}" r="3.2"/><circle class="sb-mark-ring" cx="${f(mx)}" cy="${f(my)}" r="6"/>`;
  }
  const hallLabel = P(70, 10, 16);
  return { ground, city, deck: deck ? deckSlab(P) : '', hallLabel };
}

/* The sketch district's grid is turned against true north (like the real streets
   around Westbahnhof). Viewed from the south-west the sun's daily arc would be seen
   almost edge-on; with the grid turned, the camera looks from the east-south-east
   and the arc opens up. GRID_TURN is added to every sun azimuth. */
const GRID_TURN = 120 * Math.PI / 180;

/** Small north arrow pointing to true north in a turned sketch. */
function northArrow(P, x, y) {
  const [ax, ay] = P(x, y, 0);
  const [bx, by] = P(x + Math.sin(GRID_TURN) * 24, y + Math.cos(GRID_TURN) * 24, 0);
  const a = Math.atan2(by - ay, bx - ax);
  const head = [[bx, by], [bx - Math.cos(a - 0.5) * 5, by - Math.sin(a - 0.5) * 5], [bx - Math.cos(a + 0.5) * 5, by - Math.sin(a + 0.5) * 5]];
  return `<g class="sb-north"><path d="M${f(ax)} ${f(ay)} L${f(bx)} ${f(by)}"/><polygon points="${head.map((q) => q.map(f).join(',')).join(' ')}"/>
    <text class="sb-t" x="${f(bx + Math.cos(a) * 8)}" y="${f(by + Math.sin(a) * 8 + 2)}" text-anchor="middle">N</text></g>`;
}

/** Sun samples for 21 June, 07:00 – 19:00 (real Vienna sun positions). */
function sunSamples() {
  const date = CONFIG.sun.dates.find((d) => d.id === 'jun');
  const out = [];
  for (let h = 7; h <= 19; h += 1) {
    const p = sunPosition(date.day, h * 60, date.tz, CONFIG.site.latitude, CONFIG.site.longitude);
    out.push({ h, ...p, v: sunVector(p.altitude, p.azimuth + GRID_TURN) });
  }
  return out;
}

/** Animated sun on its arc + the deck's shadow sweeping the ground, in sync. */
function sunLayer(P, dur, idp) {
  const D = DISTRICT, S = sunSamples(), R = 150, [cx, cy] = D.center;
  const sunPts = S.map((s) => P(cx + s.v[0] * R, cy + s.v[1] * R, s.v[2] * R));
  const shadowPolys = S.map((s) => {
    // The deck outline pushed away from the sun onto the ground (length capped for low sun).
    const t = Math.min(D.deck.z1 / s.v[2], 140 / Math.hypot(s.v[0], s.v[1]));
    const dx = -s.v[0] * t, dy = -s.v[1] * t;
    return loopsPath(P, D.deck.loops, 0, dx, dy);
  });
  // full day arc (dashed), hour dots
  const arc = [];
  const date = CONFIG.sun.dates.find((d) => d.id === 'jun');
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
  const sun = `<polyline class="sb-arc" points="${arc.join(' ')}"/>${ticks}
    <g class="sb-sun"><circle r="7" class="sb-sun-halo"/><circle r="4"/>
      <animateMotion dur="${dur}s" repeatCount="indefinite" keyTimes="${kt}" keyPoints="${kt}" calcMode="linear"
        path="M${sunPts.map(([x, y]) => `${f(x)},${f(y)}`).join(' L')}"/></g>`;
  return { shadow, sun };
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
    return lit && focus !== 'all' ? `<g class="use-rise" style="--d:${(i % 6) * 0.15}s">${svg}</g>` : svg;
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
    <text class="sb-t" x="24" y="${f((d.y1 - d.y0) * k + 9)}" text-anchor="middle">PLAN · USE ${USES[focus].n}/4</text></g>`;
}

/** One use shot: the same isometric view of the whole deck, one use's boxes in colour. */
function useShot(focus) {
  const u = USES[focus];
  const P = isoP(122, 190, 0.68);
  return `
    <rect class="sb-bg" width="320" height="180"/>
    <g class="use-below">${drawCity(P, DISTRICT.pylons)}</g>
    ${deckSlab(P)}
    ${useBoxes(P, focus)}
    <g class="use-title use-${focus}">
      <rect class="use-swatch" x="12" y="11" width="7" height="7"/>
      <text class="sb-t sb-t--strong use-title__name" x="23" y="18">${u.label}</text>
      <text class="sb-t" x="12" y="29">${u.tags}</text>
    </g>
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
  /* S1 — Vienna from above with a heat map, zoom target on Westbahnhof */
  heatmap() {
    const cx = 166, cy = 92, WB = [134, 98];
    // Danube runs NW → SE, north-east of the centre.
    const danube = (x) => 8 + (x - 60) * 0.56;
    let dots = '';
    for (let y = 14; y <= 172; y += 7) {
      for (let x = 14; x <= 306; x += 7) {
        const e = ((x - cx) / 132) ** 2 + ((y - cy) / 78) ** 2;
        if (e > 1) continue;                                    // city boundary (ellipse)
        let v = 1 - Math.sqrt(e) * 0.75;                         // denser = hotter towards the centre
        v += 0.45 * Math.exp(-(((x - WB[0]) ** 2 + (y - WB[1]) ** 2) / 900)); // inner west hot spot
        if (x < 70) v -= 0.35;                                   // Wienerwald: cooler
        const dd = Math.abs(y - danube(x));
        if (dd < 12) v -= 0.4 * (1 - dd / 12);                   // river: cooler
        v += Math.sin(x * 0.37 + y * 0.21) * 0.08;               // texture
        const k = Math.max(1, Math.min(5, Math.round(v * 5)));
        const d = Math.hypot(x - WB[0], y - WB[1]);
        dots += `<circle class="h${k}" cx="${x}" cy="${y}" r="2.4" style="--d:${(d * 9).toFixed(0)}ms"/>`;
      }
    }
    return `
      <rect class="sb-bg" width="320" height="180"/>
      <g class="sb-heat">${dots}</g>
      <path class="sb-river" d="M60 8 C 130 40, 190 52, 300 128"/>
      <path class="sb-canal" d="M150 62 C 168 72, 180 84, 196 104"/>
      <circle class="sb-line" cx="${cx}" cy="${cy}" r="11"/>
      <path class="sb-line sb-dash" d="M190 64 A 34 34 0 1 0 196 118"/>
      <text class="sb-t" x="238" y="74">DONAU</text>
      <text class="sb-t" x="174" y="140">GÜRTEL</text>
      <g class="sb-zoom">
        <rect x="${WB[0] - 20}" y="${WB[1] - 12}" width="40" height="24"/>
        <path class="sb-dash" d="M${WB[0] - 20} ${WB[1] - 12} L0 0 M${WB[0] + 20} ${WB[1] - 12} L320 0 M${WB[0] - 20} ${WB[1] + 12} L0 180 M${WB[0] + 20} ${WB[1] + 12} L320 180"/>
      </g>
      <circle class="sb-mark" cx="${WB[0]}" cy="${WB[1]}" r="2.6"/>
      <text class="sb-t sb-t--strong" x="${WB[0] - 20}" y="${WB[1] + 24}">WESTBAHNHOF</text>
      <g transform="translate(14 158)">
        ${[1, 2, 3, 4, 5].map((k) => `<rect class="h${k}" x="${(k - 1) * 12}" y="0" width="12" height="5"/>`).join('')}
        <text class="sb-t" x="0" y="15">COOL</text><text class="sb-t" x="60" y="15" text-anchor="end">HOT</text>
      </g>
      <g class="sb-north" transform="translate(300 22)"><path d="M0 8 L0 -8 M-3 -3 L0 -8 L3 -3"/><text class="sb-t" x="0" y="17" text-anchor="middle">N</text></g>`;
  },

  /* S2 — Westbahnhof isometric with an animated sun and the deck's shadow */
  sun(id) {
    const P = isoP(142, 168, 0.5);
    const base = districtBase(P);
    const { shadow, sun } = sunLayer(P, 10, id);
    return `
      <rect class="sb-bg" width="320" height="180"/>
      ${base.ground}${shadow}${base.city}${base.deck}${sun}
      <text class="sb-t" x="${f(base.hallLabel[0])}" y="${f(base.hallLabel[1])}" text-anchor="middle">WESTBAHNHOF</text>
      ${northArrow(P, 300, -8)}
      <text class="sb-t" x="12" y="18">21 JUN · 07:00 → 19:00</text>
      <text class="sb-t sb-t--park" x="308" y="18" text-anchor="end">DECK +46 M</text>`;
  },

  /* S3 — same view, wind lines at street level and deck level */
  wind() {
    const P = isoP(142, 168, 0.5);
    const base = districtBase(P);
    const line = (y, z, cls, wob) => {
      const p = [];
      for (let x = -18; x <= 318; x += 12) p.push(P(x, y + Math.sin(x * 0.05 + y) * wob, z).map(f).join(','));
      return `<polyline class="${cls}" points="${p.join(' ')}"/>`;
    };
    const street = [-9, 70, 150, 229].map((y) => line(y, 1, 'sb-flow', 2)).join('');
    const deck = [62, 86, 110, 134, 158].map((y) => line(y, 52, 'sb-flow sb-flow--fast', 3)).join('');
    const eddies = [[70, 30], [150, 110], [230, 190]].map(([x, y]) => {
      const [ex, ey] = P(x, y, 1);
      return `<ellipse class="sb-eddy" cx="${f(ex)}" cy="${f(ey)}" rx="6" ry="3.5"/>`;
    }).join('');
    const [ax, ay] = P(-40, 110, 0);
    return `
      <rect class="sb-bg" width="320" height="180"/>
      ${base.ground}${street}${eddies}${base.city}${base.deck}${deck}
      <g class="sb-windarrow" transform="translate(${f(ax - 6)} ${f(ay - 4)}) rotate(-30)"><path d="M-14 0 H8 M2 -4 L8 0 L2 4"/></g>
      <text class="sb-t sb-t--wind" x="12" y="18">FROM W · STREET +2 M ≈ 3 M/S</text>
      <text class="sb-t sb-t--wind" x="308" y="18" text-anchor="end">DECK +48 M ≈ 8 M/S</text>`;
  },

  /* S4 — split screen: window view (left) and isometric sun study (right), in sync */
  split(id) {
    const dur = 10;
    // left: interior with a window; the sun patch on the floor drifts as the sun moves
    const patch = [
      '30,180 64,148 112,148 92,180', '60,180 82,148 128,148 120,180', '96,180 100,148 140,148 150,180',
    ];
    const left = `
      <rect class="sb-wall" x="0" y="0" width="158" height="180"/>
      <rect class="sb-sky" x="22" y="18" width="114" height="112"/>
      <rect class="sb-deck-under" x="22" y="18" width="114" height="20"/>
      <rect class="sb-deck-edge" x="22" y="36" width="114" height="4"/>
      <rect class="sb-pylon-flat" x="104" y="40" width="9" height="90"/>
      <rect class="sb-facade-bg" x="22" y="68" width="114" height="62"/>
      <g class="sb-facade">${[0, 1, 2, 3].map((r) => [0, 1, 2, 3, 4, 5].map((c) =>
        `<rect x="${28 + c * 17}" y="${76 + r * 13}" width="9" height="7"/>`).join('')).join('')}</g>
      <rect class="sb-passing" x="22" y="40" width="40" height="90">
        <animate attributeName="x" dur="${dur}s" repeatCount="indefinite" values="-40;22;96;150" keyTimes="0;0.35;0.65;1"/>
      </rect>
      <rect class="sb-window" x="22" y="18" width="114" height="112"/>
      <path class="sb-mullion" d="M79 18 V130 M22 74 H136"/>
      <rect class="sb-floor" x="0" y="140" width="158" height="40"/>
      <polygon class="sb-patch" points="${patch[0]}">
        <animate attributeName="points" dur="${dur}s" repeatCount="indefinite" values="${patch.join(';')};${patch[0]}" keyTimes="0;0.45;0.9;1"/>
      </polygon>
      <text class="sb-t" x="10" y="12">INSIDE · 3RD FLOOR</text>`;
    // right: small isometric with the same sun timing and a window marker
    const P = isoP(220, 150, 0.3);
    const base = districtBase(P, { mark: [190, 80, 12] });
    const { shadow, sun } = sunLayer(P, dur, id);
    const right = `${base.ground}${shadow}${base.city}${base.deck}${sun}
      <text class="sb-t" x="308" y="12" text-anchor="end">MODEL · SAME MOMENT</text>`;
    return `
      <rect class="sb-bg" width="320" height="180"/>
      <clipPath id="${id}-clip"><rect x="162" y="0" width="158" height="180"/></clipPath>
      ${left}
      <g clip-path="url(#${id}-clip)">${right}</g>
      <line class="sb-split" x1="160" y1="0" x2="160" y2="180"/>
      <g class="sb-sync"><rect x="146" y="82" width="28" height="16" rx="2"/><text x="160" y="93" text-anchor="middle">SYNC</text></g>`;
  },

  /* S5–S8 — one shot per use: whole deck, that use's boxes in colour */
  'use-culture': () => useShot('culture'),
  'use-health': () => useShot('health'),
  'use-res': () => useShot('res'),
  'use-green': () => useShot('green'),

  /* S9 — greenery & solar income: heat map of yearly sun on the deck + what to plant / where PV pays */
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
      <text class="sb-t" x="0" y="${52 + i * 26}">${r.label}</text>
      <rect class="sol-track" x="0" y="${55 + i * 26}" width="96" height="6"/>
      <rect class="sol ${r.cls} sol-bar" style="--d:${600 + i * 250}ms" x="0" y="${55 + i * 26}" width="${(r.p / 100) * 96}" height="6"/>
      <text class="sb-t sb-t--strong" x="100" y="${61 + i * 26}">${r.p} %</text>`).join('');

    return `
      <rect class="sb-bg" width="320" height="180"/>
      ${clip}
      ${pylons}${deckSlab(P)}
      <g class="sol-cells" clip-path="url(#sol-clip)">${cells}</g>
      ${objects}
      <g transform="translate(196 18)">
        <text class="sb-t sb-t--strong" x="0" y="0">SOLAR INCOME ON THE DECK</text>
        <text class="sb-t" x="0" y="9">YEARLY SUN, RELATIVE · SCHEMATIC</text>
        ${[1, 2, 3, 4, 5, 6].map((k) => `<rect class="sol s${k}" x="${(k - 1) * 16}" y="16" width="16" height="6"/>`).join('')}
        <text class="sb-t" x="0" y="31">LOW</text><text class="sb-t" x="96" y="31" text-anchor="end">HIGH</text>
        ${bars}
        <line class="sol-pv" x1="0" y1="${132}" x2="10" y2="${132}"/><line class="sol-pv" x1="0" y1="${135}" x2="10" y2="${135}"/>
        <text class="sb-t" x="14" y="${136}">PV ON HOUSING ROOFS</text>
      </g>`;
  },

  /* S10 — layers lift off, key figures */
  layers() {
    const P = isoP(118, 160, 0.42);
    const D = DISTRICT;
    const city = drawCity(P);
    const pyl = D.pylons.map((b) => box(P, b, 'sb-pylon')).join('');
    const g = D.ground;
    const ground = `<polygon class="sb-ground" points="${pts(P, [[g.x0, g.y0, 0], [g.x1, g.y0, 0], [g.x1, g.y1, 0], [g.x0, g.y1, 0]])}"/>`;
    const area = deckArea(D.deck.loops).toLocaleString('en-GB').replace(/,/g, ' ');
    return `
      <rect class="sb-bg" width="320" height="180"/>
      ${ground}${city}
      <g class="sb-lift sb-lift--1">${pyl}</g>
      <g class="sb-lift sb-lift--2">${deckSlab(P)}</g>
      <g class="sb-lift sb-lift--3">${useBoxes(P, 'all')}</g>
      <g class="sb-figures" transform="translate(236 40)">
        <text class="sb-num" y="0">+46 m</text><text class="sb-t" y="9">DECK LEVEL</text>
        <text class="sb-num" y="34">${area} m²</text><text class="sb-t" y="43">DECK SURFACE (SKETCH)</text>
        <text class="sb-num" y="68">${D.pylons.length}</text><text class="sb-t" y="77">PYLONS</text>
      </g>`;
  },
};

/* -------------------------------------------------------------------------
   Rendering
   ------------------------------------------------------------------------- */

export async function initStoryboard(el, url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  render(el, await res.json());
}

function render(el, data) {
  const shots = data.shots;
  let t = 0;
  for (const s of shots) { s.start = t; t += s.duration; }
  const total = t;
  const core = shots.filter((s) => s.tier !== 'optional').reduce((n, s) => n + s.duration, 0);
  const cols = shots.map((s) => `${s.duration}fr`).join(' ');
  const pct = (x) => (x / total) * 100;

  /* ---- overview: edit timeline with tracks ---- */
  const lane = (cls, fn) => `<div class="sb-lane ${cls}" style="grid-template-columns:${cols}">${shots.map((s, i) =>
    `<button type="button" class="sb-cell${s.tier === 'optional' ? ' is-optional' : ''}" data-shot="${i}" title="${esc(s.code)} · ${esc(s.title)}">${fn(s)}</button>`).join('')}</div>`;

  let ticks = '';
  for (let x = 0; x <= total; x += data.tick) {
    ticks += `<span class="sb-tickmark" style="left:${pct(x)}%">${tc(x)}</span>`;
  }

  // scale track: one step per scale used in a shot (split screen = two parallel lines)
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

  const overview = `
    <div class="sb-overview">
      <div class="sb-overview__bar">
        <button class="btn btn--play" id="sb-play" type="button" aria-pressed="false"><i aria-hidden="true"></i><span>Play</span></button>
        <span class="sb-timecode" id="sb-tc">00:00</span>
        <span class="sb-total">Package 1 · ${shots.length} shots · ${tc(total)}${total > core ? ` (optional ${tc(total - core)})` : ''}</span>
      </div>
      <div class="sb-scroll">
        <div class="sb-tracks">
          <div class="sb-track"><span class="sb-track__label">Time</span><div class="sb-ruler">${ticks}</div></div>
          <div class="sb-track sb-track--picture"><span class="sb-track__label">Picture</span>
            ${lane('', (s) => `<b>${esc(s.code)}</b><span>${esc(s.title)}</span>`)}</div>
          <div class="sb-track sb-track--scale"><span class="sb-track__label">Scale
              ${levels.map((l) => `<small style="top:${(yOf(l) / 80) * 100}%">${esc(l)}</small>`).join('')}</span>
            <svg class="sb-scale" viewBox="0 0 100 80" preserveAspectRatio="none" aria-hidden="true">
              ${levels.map((l) => `<line class="sb-scale-grid" x1="0" x2="100" y1="${yOf(l)}" y2="${yOf(l)}"/>`).join('')}
              ${scaleLines}
            </svg></div>
          <div class="sb-track"><span class="sb-track__label">Graphics</span>${lane('sb-lane--small', (s) => esc(s.graphics))}</div>
          <div class="sb-track"><span class="sb-track__label">Data</span>${lane('sb-lane--small', (s) => esc(s.data))}</div>
          <div class="sb-playhead-area" aria-hidden="true"><div class="sb-playhead" id="sb-playhead"></div></div>
        </div>
      </div>
    </div>`;

  /* ---- shot list ---- */
  const list = shots.map((s, i) => `
    <li class="sb-shot reveal${s.tier === 'optional' ? ' is-optional' : ''}" id="shot-${i}">
      <div class="sb-shot__time">
        <span class="sb-shot__code">${esc(s.code)}</span>
        <span>${tc(s.start)}</span>
        <span class="sb-shot__dur">${s.duration} s</span>
      </div>
      <figure class="sb-frame">
        <svg viewBox="0 0 320 180" role="img" aria-label="Sketch: ${esc(s.title)}">${SKETCHES[s.sketch]?.(`sk${i}`) ?? ''}</svg>
        <figcaption><span>${esc(s.kicker)}</span><span>${s.tier === 'optional' ? 'Optional' : 'Sketch · not final look'}</span></figcaption>
      </figure>
      <div class="sb-notes">
        <h3>${esc(s.title)}</h3>
        <p>${esc(s.idea)}</p>
        <dl>
          <div><dt>Camera</dt><dd>${esc(s.camera)}</dd></div>
          <div><dt>Data</dt><dd>${esc(s.data)}</dd></div>
        </dl>
        ${s.view ? `<button type="button" class="btn sb-try" data-view="${s.view}">Try it in the model ↑</button>` : ''}
      </div>
      ${s.transition && i < shots.length - 1 ? `<p class="sb-transition"><span>↓ ${esc(s.transition)}</span></p>` : ''}
    </li>`).join('');

  el.innerHTML = `${overview}<ol class="sb-shots">${list}</ol>`;

  /* ---- interactions ---- */
  el.querySelectorAll('[data-shot]').forEach((b) => b.addEventListener('click', () => {
    document.getElementById(`shot-${b.dataset.shot}`)?.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'center' });
  }));
  el.querySelectorAll('[data-view]').forEach((b) => b.addEventListener('click', () => {
    document.querySelector(`[role="tab"][data-mode="${b.dataset.view}"]`)?.click();
    document.getElementById('model')?.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'center' });
  }));

  // Reduced motion: freeze SMIL animations on a representative frame.
  if (reduced) el.querySelectorAll('.sb-frame svg').forEach((svg) => { svg.setCurrentTime?.(5.5); svg.pauseAnimations?.(); });

  /* ---- playhead: runs through the edit at 8× speed ---- */
  const SPEED = 8;
  const head = el.querySelector('#sb-playhead'), tcEl = el.querySelector('#sb-tc'), play = el.querySelector('#sb-play');
  const cells = [...el.querySelectorAll('.sb-cell')];
  let pos = 0, playing = false, last = 0, visible = false;
  const draw = () => {
    head.style.left = `${pct(pos)}%`;
    tcEl.textContent = tc(pos);
    const idx = shots.findIndex((s) => pos >= s.start && pos < s.start + s.duration);
    cells.forEach((c) => c.classList.toggle('is-active', +c.dataset.shot === idx));
  };
  const loop = (now) => {
    if (playing && visible) {
      pos = (pos + ((now - last) / 1000) * SPEED) % total;
      draw();
    }
    last = now;
    requestAnimationFrame(loop);
  };
  const setPlaying = (on) => {
    playing = on;
    play.setAttribute('aria-pressed', on);
    play.querySelector('span').textContent = on ? 'Pause' : 'Play';
  };
  play.addEventListener('click', () => setPlaying(!playing));
  new IntersectionObserver(([e]) => { visible = e.isIntersecting; }).observe(el.querySelector('.sb-overview'));
  setPlaying(!reduced);
  draw();
  requestAnimationFrame((n) => { last = n; loop(n); });
}
