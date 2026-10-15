/* ==========================================================================
   scene.js — isometric model of the Raumpark (Canvas 2D)
   --------------------------------------------------------------------------
   • buildScene()   turns CONFIG into boxes (blocks, pylons, the irregular deck, use volumes)
   • View           projects world metres to screen pixels (true isometric, rotatable)
   • ModelScene     draws the three tabs: sun study, wind flow, isometric layers
   • initModel()    wires the tabs, controls, read-outs and the Record button
   ========================================================================== */

import { CONFIG } from './config.js';
import * as Sun from './sun.js';
import { WindSim } from './wind.js';
import { Recorder } from './recorder.js';
import { rectsToOutline, insideRects, deckArea, bounds } from './deckshape.js';

const COS30 = Math.cos(Math.PI / 6);
const ISO_RX = Math.SQRT2 * COS30;   // screen radius factor of a horizontal circle (x)
const ISO_RY = Math.SQRT1_2;         // … and (y)
const DEFAULT_LIGHT = normalize([-0.45, -0.7, 0.9]);
const MONO = '"IBM Plex Mono", ui-monospace, Menlo, Consolas, monospace';

/* -------------------------------------------------------------------------
   Geometry
   ------------------------------------------------------------------------- */

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function buildScene(cfg) {
  const g = cfg.grid;
  const pitch = g.block + g.street;
  const width = g.cols * g.block + (g.cols - 1) * g.street;
  const depth = g.rows * g.block + (g.rows - 1) * g.street;
  const rnd = mulberry32(g.seed);

  const blocks = [];
  for (let j = 0; j < g.rows; j++) {
    for (let i = 0; i < g.cols; i++) {
      const h = g.heights?.[j]?.[i] ?? Math.round(g.heightMin + rnd() * (g.heightMax - g.heightMin));
      blocks.push({ x0: i * pitch, y0: j * pitch, x1: i * pitch + g.block, y1: j * pitch + g.block, z0: 0, z1: h, layer: 'city' });
    }
  }

  const ground = { x0: -g.margin, y0: -g.margin, x1: width + g.margin, y1: depth + g.margin };
  // The deck: union of rectangles along the streets → one irregular outline.
  const D = cfg.deck;
  const loops = rectsToOutline(D.rects);
  const z0 = D.elevation - D.thickness, z1 = D.elevation;
  const deck = {
    rects: D.rects, loops, outline: loops[0], area: deckArea(loops),
    boxes: D.rects.map(([x0, y0, x1, y1]) => ({ x0, y0, x1, y1, z0, z1 })),
    ...bounds(D.rects), z0, z1, layer: 'deck',
  };

  // Pylons: explicit positions, or evenly picked street intersections under the deck.
  let positions = cfg.pylons.positions;
  if (!positions) {
    const pick = (lines, lo, hi, n) => {
      const inside = lines.filter((v) => v > lo && v < hi);
      if (inside.length <= n) return inside;
      if (n === 1) return [inside[Math.floor(inside.length / 2)]];
      return Array.from({ length: n }, (_, k) => inside[Math.round((k * (inside.length - 1)) / (n - 1))]);
    };
    const sx = Array.from({ length: g.cols - 1 }, (_, i) => i * pitch + g.block + g.street / 2);
    const sy = Array.from({ length: g.rows - 1 }, (_, j) => j * pitch + g.block + g.street / 2);
    const xs = pick(sx, deck.x0 + 5, deck.x1 - 5, cfg.pylons.cols);
    const ys = pick(sy, deck.y0 + 5, deck.y1 - 5, cfg.pylons.rows);
    positions = xs.flatMap((x) => ys.map((y) => [x, y]));
  }
  const ps = cfg.pylons.size / 2;
  const pylons = positions.map(([x, y]) => ({ x0: x - ps, x1: x + ps, y0: y - ps, y1: y + ps, z0: 0, z1: deck.z0, layer: 'structure' }));

  // Uses on the deck: plain boxes, one colour per use.
  const uses = Object.entries(cfg.uses).flatMap(([use, u]) => u.boxes.map(([x0, y0, x1, y1, h]) =>
    ({ x0, y0, x1, y1, z0: deck.z1, z1: deck.z1 + h, use, layer: 'programme' })));

  const center = [(ground.x0 + ground.x1) / 2, (ground.y0 + ground.y1) / 2];
  const R = Math.hypot(ground.x1 - ground.x0, ground.y1 - ground.y0) / 2;
  return { blocks, pylons, deck, uses, ground, width, depth, center, R };
}

/* -------------------------------------------------------------------------
   Isometric view
   ------------------------------------------------------------------------- */

class View {
  constructor(center) {
    this.cx = center[0]; this.cy = center[1];
    this.scale = 1; this.ox = 0; this.oy = 0;
    this.setAzimuth(0);
  }

  /** View rotation that puts the camera at a compass bearing (degrees) from the model. */
  static azimuthForBearing(deg) {
    const b = deg * Math.PI / 180;
    return Math.atan2(Math.cos(b) - Math.sin(b), -(Math.sin(b) + Math.cos(b)));
  }

  /** Rotate the model around its centre (radians; 0 = looking from the south-west). */
  setAzimuth(a) {
    this.az = a; this.c = Math.cos(a); this.s = Math.sin(a);
    // Horizontal direction from the model towards the camera, in world axes.
    this.cam = [-(this.c + this.s), this.s - this.c];
  }

  /** World (x, y, z) in metres → screen [px, py]. */
  p(x, y, z) {
    const dx = x - this.cx, dy = y - this.cy;
    const rx = dx * this.c - dy * this.s;
    const ry = dx * this.s + dy * this.c;
    return [this.ox + (rx - ry) * COS30 * this.scale, this.oy - ((rx + ry) * 0.5 + z) * this.scale];
  }

  /** Painter's-algorithm key: larger = further from the camera (drawn first). */
  depth(x, y, z) {
    const dx = x - this.cx, dy = y - this.cy;
    return (dx * this.c - dy * this.s) + (dx * this.s + dy * this.c) - z;
  }
}

/* -------------------------------------------------------------------------
   Colour helpers (palette comes from the CSS custom properties)
   ------------------------------------------------------------------------- */

function normalize(v) { const l = Math.hypot(...v); return v.map((c) => c / l); }
function parseColor(str) {
  const s = str.trim();
  if (s.startsWith('#')) {
    let h = s.slice(1);
    if (h.length === 3) h = h.split('').map((c) => c + c).join('');
    const n = parseInt(h, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  const m = s.match(/[\d.]+/g);
  return m ? m.slice(0, 3).map(Number) : [128, 128, 128];
}
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
const rgb = (c, a = 1) => `rgba(${Math.round(c[0])},${Math.round(c[1])},${Math.round(c[2])},${a})`;
const shade = (c, f) => (f <= 1 ? c.map((v) => v * f) : mix(c, [255, 255, 255], Math.min(1, f - 1)));
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const smoothstep = (a, b, v) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

function pathPoly(ctx, pts) {
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.closePath();
}

/* -------------------------------------------------------------------------
   The model
   ------------------------------------------------------------------------- */

export class ModelScene {
  constructor(cfg = CONFIG) {
    this.cfg = cfg;
    this.geo = buildScene(cfg);
    this.view = new View(this.geo.center);
    this.view.setAzimuth(View.azimuthForBearing(cfg.view.bearing.sun));
    this.userRotated = false;
    this.reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.mode = 'sun';
    this.shadowCanvases = new Map();

    // Sun study state
    const S = cfg.sun;
    this.sunState = {
      date: S.dates.find((d) => d.id === S.defaultDate) ?? S.dates[0],
      minutes: S.defaultMinutes,
      playing: false,
    };
    this.setSunDate(this.sunState.date.id);

    // Wind state
    this.wind = new WindSim(this.geo, cfg);
    this.windDir = cfg.wind.defaultDirection;
    this.windLevels = { street: true, deck: true };
    this.windPlaying = !this.reduced;
    this.windWarm = false;

    // Layers state
    this.explode = { t: 1, anim: false };
    this.layersOn = { city: true, structure: true, deck: true, programme: true };

    this.zmax = this.targetZmax();
    this.rightK = 0;
    this.azTarget = null;
    this.readPalette();
  }

  readPalette() {
    const cs = getComputedStyle(document.documentElement);
    const get = (n) => parseColor(cs.getPropertyValue(n) || '#888');
    this.pal = {
      paper: get('--paper'), paper2: get('--paper-2'), ink: get('--ink'), ink2: get('--ink-2'),
      ink3: get('--ink-3'), rule: get('--rule'), stone: get('--stone'), stoneTop: get('--stone-top'), sun: get('--sun'),
      wind: get('--wind'), park: get('--park'), shadow: get('--shadow'),
      useCulture: get('--use-culture'), useHealth: get('--use-health'), useRes: get('--use-res'),
      shadowAlpha: parseFloat(cs.getPropertyValue('--shadow-alpha')) || 0.3,
    };
  }

  /* ---------------- state changes ---------------- */

  setMode(mode) {
    this.mode = mode;
    if (!this.userRotated) this.cameraTo(mode);
    if (mode === 'layers') this.replayExplode();
    if (mode === 'wind' && !this.windWarm) {
      // Pre-run the simulation so trails exist straight away (and for reduced motion).
      this.wind.warmUp(this.windPlaying ? 0.6 : 2, this.windLevels);
      this.windWarm = true;
    }
    if (this.reduced) this.zmax = this.targetZmax();
  }

  /** Turn the camera (shortest way round) to the tab's default bearing. */
  cameraTo(mode) {
    const target = View.azimuthForBearing(this.cfg.view.bearing[mode] ?? 225);
    const d = target - this.view.az;
    this.azTarget = this.view.az + Math.atan2(Math.sin(d), Math.cos(d));
  }

  setSunDate(id) {
    const S = this.cfg.sun, site = this.cfg.site;
    const date = S.dates.find((d) => d.id === id) ?? S.dates[0];
    this.sunState.date = date;
    this.sunTimes = Sun.sunTimes(date, site.latitude, site.longitude);
    this.sunPath = Sun.dayPath(date, site.latitude, site.longitude, 10);
    this.computeSun();
    if (this.reduced) this.zmax = this.targetZmax();
  }

  computeSun() {
    const st = this.sunState, site = this.cfg.site;
    const p = Sun.sunPosition(st.date.day, st.minutes, st.date.tz, site.latitude, site.longitude);
    this.sunNow = { ...p, vec: Sun.sunVector(p.altitude, p.azimuth) };
  }

  setWindDirection(key) {
    this.windDir = key;
    this.wind.setDirection(this.cfg.wind.directions[key]);
    if (!this.windPlaying) this.wind.warmUp(1.5, this.windLevels);
  }

  replayExplode() {
    if (this.reduced) { this.explode.t = 1; this.explode.anim = false; return; }
    this.explode.t = 0; this.explode.anim = true;
  }

  targetZmax() {
    const g = this.geo;
    const top = Math.max(...g.uses.map((p) => p.z1), g.deck.z1 + 4);
    if (this.mode === 'layers') return top + this.cfg.explode.programme + 6;
    if (this.mode === 'sun') return Math.max(top + 8, this.domeR() * Math.sin(this.sunTimes.maxAltitude) + 22);
    return top + 8;
  }

  domeR() { return this.geo.R * 0.95; }

  /* ---------------- per-frame update ---------------- */

  update(dt) {
    const S = this.cfg.sun;
    if (this.mode === 'sun' && this.sunState.playing) {
      let m = this.sunState.minutes + dt * 60 * S.hoursPerSecond;
      if (m > S.maxMinutes) m = S.minMinutes;
      this.sunState.minutes = m;
    }
    this.computeSun();

    if (this.mode === 'wind' && this.windPlaying) this.wind.step(dt, this.windLevels);

    if (this.explode.anim) {
      this.explode.t = Math.min(1, this.explode.t + dt / 2.4);
      if (this.explode.t >= 1) this.explode.anim = false;
    }

    // Smoothly re-frame the model when switching tabs.
    const k = this.reduced ? 1 : Math.min(1, dt * 4);
    this.zmax += (this.targetZmax() - this.zmax) * k;
    this.rightK += ((this.mode === 'layers' ? 1 : 0) - this.rightK) * k;

    if (this.azTarget !== null) {
      const a = this.view.az + (this.azTarget - this.view.az) * (this.reduced ? 1 : Math.min(1, dt * 6));
      this.view.setAzimuth(a);
      if (Math.abs(a - this.azTarget) < 1e-3) { this.view.setAzimuth(this.azTarget); this.azTarget = null; }
    }
  }

  /** Scale and centre the model in a W × H pixel frame (rotation-independent). */
  fit(W, H, u) {
    const R = this.geo.R;
    const padT = 50 * u, padB = 14 * u, padX = 14 * u;
    const right = this.rightK * Math.min(190 * u, W * 0.34);
    const availW = W - 2 * padX - right;
    const availH = H - padT - padB;
    const span = Math.SQRT2 * R + this.zmax;
    const s = Math.min(availW / (2 * ISO_RX * R), availH / span);
    this.view.scale = s;
    this.view.ox = padX + availW / 2;
    this.view.oy = padT + (availH - span * s) / 2 + (ISO_RY * R + this.zmax) * s;
  }

  /* ---------------- drawing primitives ---------------- */

  rectPts(r, z) {
    const v = this.view;
    return [v.p(r.x0, r.y0, z), v.p(r.x1, r.y0, z), v.p(r.x1, r.y1, z), v.p(r.x0, r.y1, z)];
  }

  /** Brightness of a face with normal n under the current light (sun or default). */
  light(n) {
    if (this.mode === 'sun') {
      if (this.sunNow.altitude <= 0) return 0.62;
      const L = this.sunNow.vec;
      return 0.6 + 0.48 * Math.max(0, n[0] * L[0] + n[1] * L[1] + n[2] * L[2]);
    }
    const L = DEFAULT_LIGHT;
    return 0.74 + 0.32 * Math.max(0, n[0] * L[0] + n[1] * L[1] + n[2] * L[2]);
  }

  /** Draw an axis-aligned box: the two side faces facing the camera, then the top. */
  drawBox(ctx, b, top, side, u, o = {}) {
    const v = this.view, dz = o.dz || 0;
    const z0 = b.z0 + dz, z1 = b.z1 + dz;
    const cam = v.cam;
    const faces = [];
    if (cam[1] < 0) faces.push([[0, -1, 0], [[b.x0, b.y0], [b.x1, b.y0]]]);
    if (cam[1] > 0) faces.push([[0, 1, 0], [[b.x1, b.y1], [b.x0, b.y1]]]);
    if (cam[0] < 0) faces.push([[-1, 0, 0], [[b.x0, b.y1], [b.x0, b.y0]]]);
    if (cam[0] > 0) faces.push([[1, 0, 0], [[b.x1, b.y0], [b.x1, b.y1]]]);
    ctx.lineWidth = (o.lw ?? 0.6) * u;
    ctx.strokeStyle = o.stroke ?? rgb(this.pal.ink, 0.45);
    ctx.globalAlpha = o.alpha ?? 1;
    for (const [n, [[ax, ay], [bx, by]]] of faces) {
      pathPoly(ctx, [v.p(ax, ay, z0), v.p(bx, by, z0), v.p(bx, by, z1), v.p(ax, ay, z1)]);
      ctx.fillStyle = rgb(shade(side, this.light(n)));
      ctx.fill(); ctx.stroke();
    }
    pathPoly(ctx, this.rectPts(b, z1));
    ctx.fillStyle = rgb(shade(top, this.light([0, 0, 1])));
    ctx.fill(); ctx.stroke();
    if (o.afterTop) o.afterTop(b);
    ctx.globalAlpha = 1;
  }

  /**
   * The deck slab: side faces of the irregular outline that face the camera
   * (far → near), then the top surface.
   */
  drawSlab(ctx, d, top, side, u, o = {}) {
    const v = this.view, dz = o.dz || 0, z0 = d.z0 + dz, z1 = d.z1 + dz;
    ctx.lineWidth = 0.6 * u;
    ctx.strokeStyle = rgb(this.pal.ink, 0.45);
    const faces = [];
    for (const L of d.loops) for (let i = 0; i < L.length; i++) {
      const [ax, ay] = L[i], [bx, by] = L[(i + 1) % L.length];
      const len = Math.hypot(bx - ax, by - ay);
      const n = [(by - ay) / len, (ax - bx) / len, 0];       // outward normal (the deck is left of every loop)
      if (n[0] * v.cam[0] + n[1] * v.cam[1] <= 0) continue;
      faces.push([v.depth((ax + bx) / 2, (ay + by) / 2, z0), n, [[ax, ay], [bx, by]]]);
    }
    faces.sort((p, q) => q[0] - p[0]);
    for (const [, n, [[ax, ay], [bx, by]]] of faces) {
      pathPoly(ctx, [v.p(ax, ay, z0), v.p(bx, by, z0), v.p(bx, by, z1), v.p(ax, ay, z1)]);
      ctx.fillStyle = rgb(shade(side, this.light(n)));
      ctx.fill(); ctx.stroke();
    }
    this.deckPath(ctx, z1);
    ctx.fillStyle = rgb(shade(top, this.light([0, 0, 1])));
    ctx.fill('evenodd'); ctx.stroke();
  }

  /** Path of the deck outline and its openings at height z (fill / clip with 'evenodd'). */
  deckPath(ctx, z) {
    ctx.beginPath();
    for (const L of this.geo.deck.loops) {
      L.forEach(([x, y], i) => { const q = this.view.p(x, y, z); if (i) ctx.lineTo(q[0], q[1]); else ctx.moveTo(q[0], q[1]); });
      ctx.closePath();
    }
  }

  outlinePts(z) {
    return this.geo.deck.outline.map(([x, y]) => this.view.p(x, y, z));
  }

  /** Use volumes, coloured by use. */
  drawUses(ctx, u, dz = 0) {
    const P = this.pal;
    const col = { culture: P.useCulture, health: P.useHealth, res: P.useRes, green: P.park };
    this.drawSorted(this.geo.uses, (b) => {
      const c = col[b.use] ?? P.stone;
      this.drawBox(ctx, b, mix(c, P.paper, 0.45), mix(c, P.paper, 0.15), u, { dz });
    }, () => dz);
  }

  /** Painter's algorithm: sort by distance from the camera, draw far → near. */
  drawSorted(items, fn, dzOf = () => 0) {
    const v = this.view;
    items
      .map((b) => [v.depth((b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2, (b.z0 + b.z1) / 2 + dzOf(b)), b])
      .sort((a, b) => b[0] - a[0])
      .forEach(([, b]) => fn(b));
  }

  shadowCanvas(W, H) {
    const key = `${W}x${H}`;
    let c = this.shadowCanvases.get(key);
    if (!c) { c = document.createElement('canvas'); c.width = W; c.height = H; this.shadowCanvases.set(key, c); }
    return c;
  }

  /**
   * Draw a set of shadow shapes lying on plane z = planeZ. Shapes are first
   * painted opaque on an off-screen canvas and then composited once with
   * transparency, so overlapping shadows don't get darker where they overlap.
   */
  drawShadowLayer(ctx, W, H, shapes, planeZ, clipPts, alpha) {
    const oc = this.shadowCanvas(W, H), o = oc.getContext('2d'), v = this.view;
    o.clearRect(0, 0, W, H);
    o.fillStyle = rgb(this.pal.shadow);
    for (const sh of shapes) {
      o.beginPath();
      if (sh.poly) {
        sh.poly.forEach(([x, y], i) => { const p = v.p(x, y, planeZ); if (i) o.lineTo(p[0], p[1]); else o.moveTo(p[0], p[1]); });
        o.closePath();
      } else {
        const p = v.p(sh.x, sh.y, planeZ);
        o.ellipse(p[0], p[1], ISO_RX * sh.r * v.scale, ISO_RY * sh.r * v.scale, 0, 0, Math.PI * 2);
      }
      o.fill();
    }
    ctx.save();
    if (typeof clipPts === 'function') { clipPts(ctx); ctx.clip('evenodd'); } else { pathPoly(ctx, clipPts); ctx.clip(); }
    ctx.globalAlpha = alpha;
    ctx.drawImage(oc, 0, 0);
    ctx.restore();
  }

  /* ---------------- shared scene parts ---------------- */

  drawGround(ctx, u, alpha = 1) {
    const g = this.geo, v = this.view, P = this.pal;
    ctx.globalAlpha = alpha;
    pathPoly(ctx, this.rectPts(g.ground, 0));
    ctx.fillStyle = rgb(P.paper2); ctx.fill();
    ctx.lineWidth = 0.75 * u; ctx.strokeStyle = rgb(P.ink, 0.35); ctx.stroke();

    // street centre lines (dashed, very light)
    const c = this.cfg.grid, pitch = c.block + c.street;
    ctx.setLineDash([4 * u, 5 * u]);
    ctx.strokeStyle = rgb(P.ink, 0.12); ctx.lineWidth = 0.6 * u;
    ctx.beginPath();
    for (let i = 0; i < c.cols - 1; i++) {
      const x = i * pitch + c.block + c.street / 2;
      const a = v.p(x, g.ground.y0, 0), b = v.p(x, g.ground.y1, 0);
      ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]);
    }
    for (let j = 0; j < c.rows - 1; j++) {
      const y = j * pitch + c.block + c.street / 2;
      const a = v.p(g.ground.x0, y, 0), b = v.p(g.ground.x1, y, 0);
      ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]);
    }
    ctx.stroke();
    ctx.setLineDash([]);

    // scale bar (0 – 50 – 100 m) along the south edge
    const y = g.ground.y0 + 14, x0 = g.ground.x0 + 14;
    ctx.strokeStyle = rgb(P.ink, 0.8); ctx.lineWidth = 1 * u;
    ctx.beginPath();
    const a = v.p(x0, y, 0), b = v.p(x0 + 100, y, 0);
    ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]);
    for (const d of [0, 50, 100]) {
      const p = v.p(x0 + d, y, 0), q = v.p(x0 + d, y + 5, 0);
      ctx.moveTo(p[0], p[1]); ctx.lineTo(q[0], q[1]);
    }
    ctx.stroke();
    ctx.font = `${8.5 * u}px ${MONO}`; ctx.fillStyle = rgb(P.ink2);
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    const lb = v.p(x0 + 100, y - 4, 0);
    ctx.fillText('100 m', lb[0], lb[1] + 2 * u);

    // north arrow in the south-east corner
    const nx = g.ground.x1 - 22, ny = g.ground.y0 + 10;
    const n0 = v.p(nx, ny, 0), n1 = v.p(nx, ny + 26, 0);
    const l = v.p(nx - 5, ny + 8, 0), r = v.p(nx + 5, ny + 8, 0);
    ctx.beginPath(); ctx.moveTo(n0[0], n0[1]); ctx.lineTo(n1[0], n1[1]); ctx.stroke();
    pathPoly(ctx, [n1, l, r]); ctx.fillStyle = rgb(P.ink); ctx.fill();
    const nl = v.p(nx, ny + 34, 0);
    ctx.textBaseline = 'middle';
    ctx.font = `600 ${9.5 * u}px ${MONO}`; ctx.fillText('N', nl[0], nl[1]);
    ctx.globalAlpha = 1;
  }

  drawCaption(ctx, W, H, u, line1, line2) {
    const P = this.pal;
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    ctx.font = `500 ${10.5 * u}px ${MONO}`; ctx.fillStyle = rgb(P.ink);
    ctx.fillText(line1, 14 * u, 22 * u);
    ctx.font = `${9.5 * u}px ${MONO}`; ctx.fillStyle = rgb(P.ink2);
    ctx.fillText(line2, 14 * u, 37 * u);
    ctx.textAlign = 'right'; ctx.fillStyle = rgb(P.ink3);
    if (W > 520 * u) ctx.fillText('AXONOMETRIC · N.T.S.', W - 14 * u, 22 * u);
  }

  /* ---------------- render ---------------- */

  /**
   * Render one frame into any 2D context (the on-page canvas or the
   * off-screen recording canvas). u = size of one "drawing pixel".
   */
  render(ctx, W, H, u) {
    this.fit(W, H, u);
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = rgb(this.pal.paper);
    ctx.fillRect(0, 0, W, H);
    ctx.lineJoin = 'round';
    if (this.mode === 'sun') this.renderSun(ctx, W, H, u);
    else if (this.mode === 'wind') this.renderWind(ctx, W, H, u);
    else this.renderLayers(ctx, W, H, u);
    ctx.restore();
  }

  colors() {
    const P = this.pal;
    return {
      blockTop: this.mode === 'wind' ? mix(P.stoneTop, P.paper, 0.3) : P.stoneTop,
      blockSide: this.mode === 'wind' ? mix(P.stone, P.paper, 0.3) : P.stone,
      pylon: mix(P.stone, P.ink, 0.3),
      deckTop: mix(P.park, P.paper, 0.35),
      deckSide: mix(P.stone, P.ink, 0.12),
    };
  }

  /* --- Sun study --- */
  renderSun(ctx, W, H, u) {
    const g = this.geo, v = this.view, P = this.pal, C = this.colors();
    const sun = this.sunNow, sv = sun.vec;
    const up = sun.altitude > 0;
    // Shadows fade in/out as the sun nears the horizon (and get absurdly long).
    const alpha = P.shadowAlpha * smoothstep(0, 6 * Math.PI / 180, sun.altitude);

    this.drawGround(ctx, u);
    this.drawHorizon(ctx, u);

    if (up) {
      // 1. Ground shadows: blocks, pylons and the deck, projected onto z = 0.
      //    (Use volumes' shadows below the deck are always inside the deck's own shadow.)
      const casters = [...g.blocks, ...g.pylons, ...g.deck.boxes];
      const shapes = casters.map((b) => ({ poly: Sun.boxShadow(b, sv, 0) }));
      this.drawShadowLayer(ctx, W, H, shapes, 0, this.rectPts(g.ground, 0), alpha);
    }

    // 2. Blocks and pylons; after each roof is drawn, add the deck's shadow on that roof.
    const deckOnRoof = (b) => {
      if (!up || b.layer !== 'city') return;
      ctx.save();
      pathPoly(ctx, this.rectPts(b, b.z1)); ctx.clip();
      ctx.beginPath();
      for (const db of g.deck.boxes) {               // one hull per deck piece, filled as one path
        const hull = Sun.boxShadow(db, sv, b.z1);
        hull.forEach(([x, y], i) => { const q = v.p(x, y, b.z1); if (i) ctx.lineTo(q[0], q[1]); else ctx.moveTo(q[0], q[1]); });
        ctx.closePath();
      }
      ctx.globalAlpha = alpha; ctx.fillStyle = rgb(P.shadow); ctx.fill('nonzero');
      ctx.restore();
    };
    this.drawSorted([...g.blocks, ...g.pylons], (b) => {
      if (b.layer === 'city') this.drawBox(ctx, b, C.blockTop, C.blockSide, u, { afterTop: deckOnRoof });
      else this.drawBox(ctx, b, C.pylon, C.pylon, u);
    });

    // 3. Deck, then the use volumes' shadows on the deck surface.
    this.drawSlab(ctx, g.deck, C.deckTop, C.deckSide, u);
    if (up) {
      const shapes = g.uses.map((p) => ({ poly: Sun.boxShadow(p, sv, g.deck.z1) }));
      this.drawShadowLayer(ctx, W, H, shapes, g.deck.z1, (c) => this.deckPath(c, g.deck.z1), alpha);
    }

    // 4. Use volumes on top.
    this.drawUses(ctx, u);

    // 5. Sun path and the sun itself.
    this.drawSunPath(ctx, u);

    const st = this.sunState;
    const az = Sun.toDeg(sun.azimuth);
    this.drawCaption(ctx, W, H, u, 'RAUMPARK VIENNA — SUN STUDY',
      `${st.date.short} · ${Sun.formatClock(st.minutes)} ${st.date.zone} · ` +
      (up ? `ALT ${Sun.toDeg(sun.altitude).toFixed(1)}° · AZ ${az.toFixed(0)}° ${Sun.compassLabel(sun.azimuth)}` : 'SUN BELOW HORIZON'));
  }

  /** Horizon circle of the sun-path "dome" with compass points. */
  drawHorizon(ctx, u) {
    const v = this.view, P = this.pal, Rd = this.domeR(), [cx, cy] = this.geo.center;
    ctx.strokeStyle = rgb(P.sun, 0.45); ctx.lineWidth = 0.75 * u;
    ctx.setLineDash([2 * u, 4 * u]);
    ctx.beginPath();
    for (let i = 0; i <= 96; i++) {
      const a = (i / 96) * Math.PI * 2;
      const p = v.p(cx + Math.sin(a) * Rd, cy + Math.cos(a) * Rd, 0);
      if (i) ctx.lineTo(p[0], p[1]); else ctx.moveTo(p[0], p[1]);
    }
    ctx.stroke(); ctx.setLineDash([]);
    ctx.font = `${8.5 * u}px ${MONO}`; ctx.fillStyle = rgb(P.sun);
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (const [lab, a] of [['N', 0], ['E', 90], ['S', 180], ['W', 270]]) {
      const r = a * Math.PI / 180;
      const p = v.p(cx + Math.sin(r) * Rd * 1.07, cy + Math.cos(r) * Rd * 1.07, 0);
      ctx.fillText(lab, p[0], p[1]);
    }
  }

  /**
   * The sun's daily arc drawn on a dome around the model: every sample of the
   * day path is placed at  centre + domeRadius × sunVector.
   */
  drawSunPath(ctx, u) {
    const v = this.view, P = this.pal, Rd = this.domeR(), [cx, cy] = this.geo.center;
    const pt = (alt, az) => { const s = Sun.sunVector(alt, az); return v.p(cx + s[0] * Rd, cy + s[1] * Rd, s[2] * Rd); };

    ctx.strokeStyle = rgb(P.sun, 0.85); ctx.lineWidth = 1 * u;
    ctx.setLineDash([5 * u, 4 * u]);
    ctx.beginPath();
    let pen = false;
    for (const s of this.sunPath) {
      if (s.altitude <= 0) { pen = false; continue; }
      const p = pt(s.altitude, s.azimuth);
      if (pen) ctx.lineTo(p[0], p[1]); else ctx.moveTo(p[0], p[1]);
      pen = true;
    }
    ctx.stroke(); ctx.setLineDash([]);

    // hour ticks, labelled every two hours
    ctx.font = `${8 * u}px ${MONO}`; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
    for (const s of this.sunPath) {
      if (s.minutes % 60 !== 0 || s.altitude <= 0) continue;
      const p = pt(s.altitude, s.azimuth);
      ctx.fillStyle = rgb(P.sun);
      ctx.beginPath(); ctx.arc(p[0], p[1], 1.8 * u, 0, Math.PI * 2); ctx.fill();
      if ((s.minutes / 60) % 2 === 0 && s.altitude > 4 * Math.PI / 180) {
        ctx.fillStyle = rgb(P.ink2);
        ctx.fillText(String(s.minutes / 60).padStart(2, '0'), p[0], p[1] - 4 * u);
      }
    }

    const sun = this.sunNow;
    if (sun.altitude > 0) {
      const p = pt(sun.altitude, sun.azimuth);
      const c = v.p(this.geo.deck.x0 + (this.geo.deck.x1 - this.geo.deck.x0) / 2, this.geo.deck.y0 + (this.geo.deck.y1 - this.geo.deck.y0) / 2, this.geo.deck.z1);
      ctx.strokeStyle = rgb(P.sun, 0.5); ctx.lineWidth = 0.75 * u;
      ctx.beginPath(); ctx.moveTo(p[0], p[1]); ctx.lineTo(c[0], c[1]); ctx.stroke();
      ctx.beginPath(); ctx.arc(p[0], p[1], 11 * u, 0, Math.PI * 2);
      ctx.strokeStyle = rgb(P.sun, 0.4); ctx.stroke();
      ctx.beginPath(); ctx.arc(p[0], p[1], 6.5 * u, 0, Math.PI * 2);
      ctx.fillStyle = rgb(P.sun); ctx.fill();
    }
  }

  /* --- Wind flow --- */
  renderWind(ctx, W, H, u) {
    const g = this.geo, P = this.pal, C = this.colors();
    this.drawGround(ctx, u);
    // Street-level trails go under the buildings, so the blocks hide the ones behind them.
    if (this.windLevels.street) this.wind.draw(ctx, this.view, 'street', rgb(P.wind), u);
    this.drawSorted([...g.blocks, ...g.pylons], (b) =>
      (b.layer === 'city' ? this.drawBox(ctx, b, C.blockTop, C.blockSide, u) : this.drawBox(ctx, b, C.pylon, C.pylon, u)));
    this.drawSlab(ctx, g.deck, C.deckTop, C.deckSide, u);
    this.drawUses(ctx, u);
    if (this.windLevels.deck) this.wind.draw(ctx, this.view, 'deck', rgb(shade(P.wind, 0.92)), u);

    this.drawWindRose(ctx, W, u);
    const w = this.wind, z = this.cfg.wind;
    this.drawCaption(ctx, W, H, u, 'RAUMPARK VIENNA — WIND FLOW (SCHEMATIC)',
      `FROM ${this.windDir} · ${w.refSpeed} M/S @ 10 M · STREET ${w.levelSpeed(z.streetZ).toFixed(1)} · DECK ${w.levelSpeed(w.levels.deck.z).toFixed(1)} M/S`);
  }

  /** Small compass in the top-right corner: north tick + flow arrow, follows rotation. */
  drawWindRose(ctx, W, u) {
    const v = this.view, P = this.pal;
    const r = 20 * u, cx = W - 14 * u - r, cy = 50 * u + r;
    const dirOnScreen = (dx, dy) => {
      const a = v.p(v.cx, v.cy, 0), b = v.p(v.cx + dx, v.cy + dy, 0);
      const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
      return [(b[0] - a[0]) / l, (b[1] - a[1]) / l];
    };
    ctx.strokeStyle = rgb(P.ink, 0.5); ctx.lineWidth = 0.75 * u;
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
    const n = dirOnScreen(0, 1);
    ctx.beginPath(); ctx.moveTo(cx + n[0] * r, cy + n[1] * r); ctx.lineTo(cx + n[0] * (r - 5 * u), cy + n[1] * (r - 5 * u)); ctx.stroke();
    ctx.font = `600 ${8.5 * u}px ${MONO}`; ctx.fillStyle = rgb(P.ink);
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('N', cx + n[0] * (r + 8 * u), cy + n[1] * (r + 8 * u));
    const d = dirOnScreen(this.wind.dir[0], this.wind.dir[1]);
    const tail = [cx - d[0] * r * 0.75, cy - d[1] * r * 0.75], head = [cx + d[0] * r * 0.75, cy + d[1] * r * 0.75];
    ctx.strokeStyle = rgb(P.wind); ctx.fillStyle = rgb(P.wind); ctx.lineWidth = 1.6 * u;
    ctx.beginPath(); ctx.moveTo(tail[0], tail[1]); ctx.lineTo(head[0], head[1]); ctx.stroke();
    const ang = Math.atan2(head[1] - tail[1], head[0] - tail[0]);
    ctx.beginPath();
    ctx.moveTo(head[0] + Math.cos(ang) * 4 * u, head[1] + Math.sin(ang) * 4 * u);
    ctx.lineTo(head[0] + Math.cos(ang + 2.5) * 6 * u, head[1] + Math.sin(ang + 2.5) * 6 * u);
    ctx.lineTo(head[0] + Math.cos(ang - 2.5) * 6 * u, head[1] + Math.sin(ang - 2.5) * 6 * u);
    ctx.closePath(); ctx.fill();
  }

  /* --- Isometric layers --- */
  layerOffsets() {
    const t = this.explode.t, E = this.cfg.explode;
    const e = (delay) => easeInOut(clamp((t - delay) / 0.7, 0, 1));
    return { city: 0, structure: E.structure * e(0), deck: E.deck * e(0.15), programme: E.programme * e(0.3) };
  }

  renderLayers(ctx, W, H, u) {
    const g = this.geo, v = this.view, P = this.pal, C = this.colors();
    const off = this.layerOffsets(), on = this.layersOn;
    const dim = (k) => (on[k] ? 1 : 0.12);

    this.drawGround(ctx, u, on.city ? 1 : 0.35);

    // Ghost footprint of the deck on the ground and at its real level (+46 m).
    ctx.setLineDash([4 * u, 4 * u]);
    ctx.strokeStyle = rgb(P.park, 0.9); ctx.lineWidth = 1 * u;
    this.deckPath(ctx, 0); ctx.stroke();
    ctx.setLineDash([]);

    if (on.city) this.drawSorted(g.blocks, (b) => this.drawBox(ctx, b, C.blockTop, C.blockSide, u));

    if (off.deck > 1) {
      ctx.setLineDash([2 * u, 4 * u]);
      ctx.strokeStyle = rgb(P.park, 0.8); ctx.lineWidth = 0.8 * u;
      this.deckPath(ctx, g.deck.z1); ctx.stroke();
      // vertical alignment lines from the footprint up to the lifted deck (at the outline's extreme points)
      ctx.strokeStyle = rgb(P.ink, 0.35);
      ctx.beginPath();
      const O = g.deck.outline;
      const extremes = [(q) => q[0], (q) => -q[0], (q) => q[1], (q) => -q[1]].map((fn) => O.reduce((m, q) => (fn(q) < fn(m) ? q : m)));
      for (const [x, y] of extremes) {
        const a = v.p(x, y, 0), b = v.p(x, y, g.deck.z0 + off.deck);
        ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]);
      }
      ctx.stroke(); ctx.setLineDash([]);
      // level marker ▽ +46.00 at the ghost deck's west corner
      const m = this.outlinePts(g.deck.z1).reduce((a, q) => (q[0] < a[0] ? q : a));
      ctx.fillStyle = rgb(P.park);
      pathPoly(ctx, [[m[0] - 4 * u, m[1] - 7 * u], [m[0] + 4 * u, m[1] - 7 * u], [m[0], m[1] - 1 * u]]); ctx.fill();
      ctx.font = `${8.5 * u}px ${MONO}`; ctx.textAlign = 'right'; ctx.textBaseline = 'bottom';
      ctx.fillText(`+${this.cfg.deck.elevation.toFixed(2)}`, m[0] - 7 * u, m[1] - 2 * u);
    }

    if (on.structure) this.drawSorted(g.pylons, (b) => this.drawBox(ctx, b, C.pylon, C.pylon, u, { dz: off.structure }), () => off.structure);
    if (on.deck) this.drawSlab(ctx, g.deck, C.deckTop, C.deckSide, u, { dz: off.deck });
    if (on.programme) this.drawUses(ctx, u, off.programme);

    this.drawLayerLabels(ctx, W, H, u, off, dim);
    this.drawCaption(ctx, W, H, u, 'RAUMPARK VIENNA — ISOMETRIC LAYERS',
      `EXPLODED AXONOMETRIC · DECK +${this.cfg.deck.elevation} M · ${Math.round(this.explode.t * 100)} %`);
  }

  drawLayerLabels(ctx, W, H, u, off, dim) {
    const g = this.geo, v = this.view, P = this.pal, cfg = this.cfg;
    const anchorOf = (boxes, dz, zSel) => {
      let best = null;
      for (const b of boxes) {
        const z = zSel(b) + dz;
        for (const [x, y] of [[b.x0, b.y0], [b.x1, b.y0], [b.x1, b.y1], [b.x0, b.y1]]) {
          const p = v.p(x, y, z);
          if (!best || p[0] > best[0]) best = p;
        }
      }
      return best;
    };
    const k = clamp(W / u / 640, 0.82, 1);
    const layers = [
      { key: 'programme', n: '04', title: 'USES', sub: `${Object.keys(cfg.uses).length} uses · ${g.uses.length} volumes`, color: P.useCulture,
        a: anchorOf(g.uses, off.programme, (b) => b.z1) },
      { key: 'deck', n: '03', title: 'RAUMPARK DECK', sub: `+${cfg.deck.elevation} m · ${g.deck.area.toLocaleString('en-GB').replace(/,/g, ' ')} m²`, color: P.park,
        a: anchorOf(g.deck.boxes, off.deck, (b) => b.z1) },
      { key: 'structure', n: '02', title: 'STRUCTURE', sub: `${g.pylons.length} pylons · ${cfg.pylons.size} × ${cfg.pylons.size} m`, color: P.ink2,
        a: anchorOf(g.pylons, off.structure, (b) => (b.z0 + b.z1) / 2) },
      { key: 'city', n: '01', title: 'EXISTING CITY', sub: `+0 m · ${cfg.grid.cols} × ${cfg.grid.rows} blocks`, color: P.stone,
        a: anchorOf(g.blocks, 0, (b) => b.z1 / 2) },
    ];
    // Resolve label positions top → bottom with a minimum gap.
    const gap = 34 * u * k;
    let y = 60 * u;
    for (const L of layers) { L.y = Math.max(L.a[1], y); y = L.y + gap; }
    const overflow = layers[layers.length - 1].y - (H - 26 * u);
    if (overflow > 0) for (const L of layers) L.y -= overflow;

    const xR = W - 14 * u;
    ctx.textAlign = 'right';
    for (const L of layers) {
      ctx.globalAlpha = dim(L.key);
      ctx.font = `500 ${10 * u * k}px ${MONO}`;
      const tw = Math.max(ctx.measureText(`${L.n}  ${L.title}`).width, (ctx.font = `${9 * u * k}px ${MONO}`, ctx.measureText(L.sub).width));
      const xL = xR - tw;
      // leader line with a dot on the layer
      ctx.strokeStyle = rgb(P.ink, 0.55); ctx.lineWidth = 0.75 * u;
      ctx.beginPath();
      ctx.moveTo(L.a[0], L.a[1]);
      ctx.lineTo(Math.min(L.a[0] + 16 * u, xL - 18 * u), L.y - 4 * u);
      ctx.lineTo(xL - 14 * u, L.y - 4 * u);
      ctx.stroke();
      ctx.fillStyle = rgb(P.ink);
      ctx.beginPath(); ctx.arc(L.a[0], L.a[1], 2.2 * u, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = rgb(L.color);
      ctx.fillRect(xL - 10 * u, L.y - 8 * u, 7 * u, 7 * u);
      ctx.textBaseline = 'alphabetic';
      ctx.font = `500 ${10 * u * k}px ${MONO}`; ctx.fillStyle = rgb(P.ink);
      ctx.fillText(`${L.n}  ${L.title}`, xR, L.y);
      ctx.font = `${9 * u * k}px ${MONO}`; ctx.fillStyle = rgb(P.ink2);
      ctx.fillText(L.sub, xR, L.y + 13 * u * k);
    }
    ctx.globalAlpha = 1;
  }
}

/* ==========================================================================
   UI wiring
   ========================================================================== */

export function initModel(root) {
  const scene = new ModelScene(CONFIG);
  const canvas = root.querySelector('#model-canvas');
  const ctx = canvas.getContext('2d');
  const $ = (s) => root.querySelector(s);
  const S = CONFIG.sun;

  /* ---- canvas size ---- */
  let dpr = 1;
  const resize = () => {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    const r = canvas.getBoundingClientRect();
    canvas.width = Math.max(1, Math.round(r.width * dpr));
    canvas.height = Math.max(1, Math.round(r.height * dpr));
  };
  new ResizeObserver(resize).observe(canvas);
  resize();

  const areaEl = document.getElementById('fig-deck-area');
  if (areaEl) areaEl.textContent = scene.geo.deck.area.toLocaleString('en-GB').replace(/,/g, ' ');

  /* ---- tabs ---- */
  const tabs = [...root.querySelectorAll('[role="tab"]')];
  const setMode = (mode) => {
    scene.setMode(mode);
    for (const t of tabs) {
      const on = t.dataset.mode === mode;
      t.setAttribute('aria-selected', on);
      t.tabIndex = on ? 0 : -1;
      root.querySelector(`#${t.getAttribute('aria-controls')}`).hidden = !on;
    }
    canvas.setAttribute('aria-label', {
      sun: 'Isometric model of the block grid and Raumpark deck with sun path and shadows',
      wind: 'Isometric model with wind particles at street and deck level',
      layers: 'Exploded axonometric: existing city, structure, Raumpark deck and use volumes',
    }[mode]);
  };
  tabs.forEach((t, i) => {
    t.addEventListener('click', () => setMode(t.dataset.mode));
    t.addEventListener('keydown', (e) => {
      const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
      if (!d) return;
      const n = tabs[(i + d + tabs.length) % tabs.length];
      n.focus(); setMode(n.dataset.mode);
    });
  });

  /* ---- sun controls ---- */
  const time = $('#sun-time'), timeOut = $('#sun-time-out'), date = $('#sun-date'), play = $('#sun-play');
  time.min = S.minMinutes; time.max = S.maxMinutes; time.value = scene.sunState.minutes;
  date.innerHTML = S.dates.map((d) => `<option value="${d.id}">${d.label}</option>`).join('');
  date.value = scene.sunState.date.id;
  time.addEventListener('input', () => { scene.sunState.minutes = +time.value; setPlaying(false); });
  date.addEventListener('change', () => scene.setSunDate(date.value));
  const setPlaying = (on) => {
    scene.sunState.playing = on;
    play.setAttribute('aria-pressed', on);
    play.querySelector('span').textContent = on ? 'Pause' : 'Play';
  };
  play.addEventListener('click', () => setPlaying(!scene.sunState.playing));
  setPlaying(!scene.reduced);

  /* ---- wind controls ---- */
  const dirBtns = [...root.querySelectorAll('[data-wind-dir]')];
  const setDir = (k) => {
    scene.setWindDirection(k);
    dirBtns.forEach((b) => b.setAttribute('aria-checked', b.dataset.windDir === k));
  };
  dirBtns.forEach((b) => b.addEventListener('click', () => setDir(b.dataset.windDir)));
  setDir(CONFIG.wind.defaultDirection);
  const speed = $('#wind-speed'), speedOut = $('#wind-speed-out');
  speed.value = CONFIG.wind.defaultSpeed;
  speed.addEventListener('input', () => scene.wind.setSpeed(+speed.value));
  for (const id of ['street', 'deck']) {
    const cb = $(`#wind-${id}`);
    cb.checked = true;
    cb.addEventListener('change', () => { scene.windLevels[id] = cb.checked; });
  }
  const windPlay = $('#wind-play');
  const setWindPlaying = (on) => {
    scene.windPlaying = on;
    windPlay.setAttribute('aria-pressed', on);
    windPlay.querySelector('span').textContent = on ? 'Pause' : 'Play';
  };
  windPlay.addEventListener('click', () => setWindPlaying(!scene.windPlaying));
  setWindPlaying(scene.windPlaying);

  /* ---- layer controls ---- */
  const explode = $('#layers-explode');
  explode.addEventListener('input', () => { scene.explode.anim = false; scene.explode.t = +explode.value / 100; });
  $('#layers-replay').addEventListener('click', () => scene.replayExplode());
  for (const cb of root.querySelectorAll('[data-layer]')) {
    cb.addEventListener('change', () => { scene.layersOn[cb.dataset.layer] = cb.checked; });
  }

  /* ---- rotate by dragging (horizontal), arrow keys, double-click resets ---- */
  let drag = null;
  canvas.addEventListener('pointerdown', (e) => {
    drag = { x: e.clientX, az: scene.view.az };
    canvas.setPointerCapture(e.pointerId);
    scene.azTarget = null;
    scene.userRotated = true;
  });
  canvas.addEventListener('pointermove', (e) => { if (drag) scene.view.setAzimuth(drag.az + (e.clientX - drag.x) * 0.008); });
  canvas.addEventListener('pointerup', () => { drag = null; });
  canvas.addEventListener('pointercancel', () => { drag = null; });
  canvas.addEventListener('dblclick', () => { scene.userRotated = false; scene.cameraTo(scene.mode); });
  canvas.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
      scene.userRotated = true;
      scene.azTarget = (scene.azTarget ?? scene.view.az) + (e.key === 'ArrowRight' ? 1 : -1) * Math.PI / 12;
    }
  });

  /* ---- theme ---- */
  document.addEventListener('themechange', () => scene.readPalette());

  /* ---- recording ---- */
  const recorder = new Recorder();
  const recBtn = $('#rec-btn'), recLabel = recBtn.querySelector('.rec-label'), recSize = $('#rec-size'), recNote = $('#rec-note');
  if (!Recorder.supported()) {
    recBtn.disabled = true;
    recNote.textContent = 'Recording needs a browser with MediaRecorder (Chrome, Edge, Firefox).';
  }
  recBtn.addEventListener('click', async () => {
    if (!recorder.active) {
      const [w, h] = recSize.value.split('x').map(Number);
      recorder.start(w, h, 30, (c, W, H) => scene.render(c, W, H, H / 620));
      recBtn.setAttribute('aria-pressed', 'true');
      recSize.disabled = true;
      recNote.textContent = `Recording ${w}×${h} · ${recorder.type.split(';')[0]}`;
    } else {
      const blob = await recorder.stop();
      recBtn.setAttribute('aria-pressed', 'false');
      recSize.disabled = false;
      recLabel.textContent = 'Record';
      const ext = recorder.type.includes('mp4') ? 'mp4' : 'webm';
      const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `raumpark_${scene.mode}_${stamp}.${ext}`;
      document.body.append(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      recNote.textContent = `Saved ${a.download} (${(blob.size / 1e6).toFixed(1)} MB)`;
    }
  });

  /* ---- read-outs ---- */
  const out = {
    alt: $('#ro-alt'), az: $('#ro-az'), rise: $('#ro-rise'), set: $('#ro-set'), shadow: $('#ro-shadow'),
    vStreet: $('#ro-v-street'), vDeck: $('#ro-v-deck'), ratio: $('#ro-v-ratio'), explodeOut: $('#layers-explode-out'),
  };
  const setText = (el, s) => { if (el.textContent !== s) el.textContent = s; };
  const updateReadouts = () => {
    const st = scene.sunState, sun = scene.sunNow;
    if (!st.playing || document.activeElement !== time) time.value = Math.round(st.minutes);
    setText(timeOut, `${Sun.formatClock(st.minutes)} ${st.date.zone}`);
    const up = sun.altitude > 0;
    setText(out.alt, up ? `${Sun.toDeg(sun.altitude).toFixed(1)}°` : 'below horizon');
    setText(out.az, `${Sun.toDeg(sun.azimuth).toFixed(0)}° ${Sun.compassLabel(sun.azimuth)}`);
    setText(out.rise, `${Sun.formatClock(scene.sunTimes.sunrise)}`);
    setText(out.set, `${Sun.formatClock(scene.sunTimes.sunset)}`);
    const L = Sun.shadowLength(CONFIG.deck.elevation, sun.altitude);
    setText(out.shadow, up && L < 2000 ? `${Math.round(L)} m` : '—');

    const w = scene.wind;
    const vs = w.levelSpeed(CONFIG.wind.streetZ), vd = w.levelSpeed(w.levels.deck.z);
    setText(speedOut, `${speed.value} m/s`);
    setText(out.vStreet, `${vs.toFixed(1)} m/s`);
    setText(out.vDeck, `${vd.toFixed(1)} m/s`);
    setText(out.ratio, `× ${(vd / vs).toFixed(2)}`);

    const pct = Math.round(scene.explode.t * 100);
    if (scene.explode.anim) explode.value = pct;
    setText(out.explodeOut, `${pct} %`);

    if (recorder.active) {
      const s = Math.floor(recorder.elapsed());
      setText(recLabel, `Stop ${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`);
    }
  };

  /* ---- render loop (paused while the model is off-screen, unless recording) ---- */
  let visible = true;
  new IntersectionObserver(([e]) => { visible = e.isIntersecting; }).observe(canvas);
  let last = performance.now();
  const frame = (now) => {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if ((visible && !document.hidden) || recorder.active) {
      scene.update(dt);
      scene.render(ctx, canvas.width, canvas.height, dpr);
      if (recorder.active) recorder.frame();
      updateReadouts();
    }
    requestAnimationFrame(frame);
  };
  // URL parameters for the meeting: ?view=wind|layers  ?date=mar|jun|sep|dec  ?time=16:30
  const params = new URLSearchParams(location.search);
  const startMode = params.get('view');
  if (S.dates.some((d) => d.id === params.get('date'))) { scene.setSunDate(params.get('date')); date.value = params.get('date'); }
  const tm = /^(\d{1,2}):(\d{2})$/.exec(params.get('time') ?? '');
  if (tm) { scene.sunState.minutes = clamp(+tm[1] * 60 + +tm[2], S.minMinutes, S.maxMinutes); setPlaying(false); }
  setMode(['sun', 'wind', 'layers'].includes(startMode) ? startMode : 'sun');
  if (scene.azTarget !== null) { scene.view.setAzimuth(scene.azTarget); scene.azTarget = null; }
  scene.zmax = scene.targetZmax();
  requestAnimationFrame(frame);
  return scene;
}
