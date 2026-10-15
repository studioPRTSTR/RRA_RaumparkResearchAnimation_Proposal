/* ==========================================================================
   wind.js — schematic wind flow with particle trails
   --------------------------------------------------------------------------
   This is NOT a CFD simulation. It is a fast, explainable rule set that
   reproduces the effects a planner expects to see, so the animatic tells
   the right story until real CFD data arrives:

   1. WIND PROFILE — wind gets stronger with height. We use the standard
      power law  v(z) = v_ref · (z / 10 m)^α  with α ≈ 0.30 for city terrain.
      At +2 m (street) that gives ≈ 0.62 × the reference speed,
      at +48 m (deck) ≈ 1.6 × — the deck is roughly 2.5 × windier than the street.

   2. DEFLECTION — near a wall, the part of the flow that would run INTO the
      building is removed and turned sideways along the facade. Head-on flow
      splits to whichever side of the building the particle is on.

   3. CHANNELLING (speed-up) — the more walls a particle is close to, the
      faster it goes: air squeezed between two blocks must accelerate
      (continuity / Venturi effect). Streets parallel to the wind become jets.

   4. WAKE — directly downwind of a building the air is sheltered: slower,
      and more turbulent (we add a wobble that grows inside the wake).

   5. DECK EFFECTS — at deck level the flow speeds up over the upwind edges
      of the deck (edge acceleration), and the low planted volumes act as
      porous wind-breaks that slow it down.

   Particles are moved a little every frame along this velocity field and
   leave a fading trail behind them.
   ========================================================================== */

import { insideRects } from './deckshape.js';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

const INFLUENCE = 14;   // m — how far from a wall the deflection is felt
const TRAIL = 16;       // points per trail
const SAMPLE = 0.05;    // s between trail points

export class WindSim {
  /**
   * @param {object} scene  geometry from buildScene()
   * @param {object} cfg    CONFIG
   */
  constructor(scene, cfg) {
    this.cfg = cfg.wind;
    const deck = scene.deck;
    this.levels = {
      street: this.makeLevel({
        id: 'street',
        z: this.cfg.streetZ,
        region: scene.ground,
        obstacles: [...scene.blocks, ...scene.pylons],
        trees: [],
        deck: null,
        count: this.cfg.particles.street,
      }),
      deck: this.makeLevel({
        id: 'deck',
        z: deck.z1 + this.cfg.deckZ,
        region: { x0: deck.x0 - 50, y0: deck.y0 - 50, x1: deck.x1 + 50, y1: deck.y1 + 50 },
        obstacles: scene.uses.filter((b) => b.z1 - b.z0 > 3),     // volumes taller than the particles' height
        trees: scene.uses.filter((b) => b.use === 'green'),       // planting: porous, slows the flow
        deck,
        count: this.cfg.particles.deck,
      }),
    };
    this.time = 0;
    this.sampleClock = 0;
    this.setDirection(this.cfg.directions[this.cfg.defaultDirection]);
    this.setSpeed(this.cfg.defaultSpeed);
    for (const L of Object.values(this.levels)) {
      for (let i = 0; i < L.count; i++) this.respawn(L, i, true);
    }
  }

  makeLevel(o) {
    return {
      ...o,
      x: new Float32Array(o.count),
      y: new Float32Array(o.count),
      age: new Float32Array(o.count),
      life: new Float32Array(o.count),
      fast: new Uint8Array(o.count),
      trail: new Float32Array(o.count * TRAIL * 2),
      screen: new Float32Array(o.count * TRAIL * 2),
    };
  }

  /** @param {number} fromDeg meteorological direction the wind comes FROM (270 = west wind) */
  setDirection(fromDeg) {
    this.fromDeg = fromDeg;
    const r = fromDeg * Math.PI / 180;
    // Air moves TOWARDS the opposite bearing: a west wind (270°) blows to the east (+x).
    this.dir = [-Math.sin(r), -Math.cos(r)];
  }

  setSpeed(v) { this.refSpeed = v; }

  /** Mean wind speed at height z (power-law profile, see note 1 at the top). */
  levelSpeed(z) {
    return this.refSpeed * Math.pow(Math.max(z, 1) / 10, this.cfg.profileAlpha);
  }

  /**
   * Velocity at a point on one level.
   * @returns {[number, number, number]} vx, vy in m/s and the local speed factor
   */
  velocity(L, x, y) {
    const U = this.dir;
    let vx = U[0], vy = U[1];         // start with the undisturbed flow direction
    let blockage = 0;                  // how hemmed-in the point is (channelling)
    let wake = 0;                      // 0 = open flow … 1 = right behind a building

    for (const o of L.obstacles) {
      const hx = (o.x1 - o.x0) / 2, hy = (o.y1 - o.y0) / 2;
      const cx = o.x0 + hx, cy = o.y0 + hy;
      const rx = x - cx, ry = y - cy;
      if (Math.abs(rx) > hx + 60 || Math.abs(ry) > hy + 60) continue; // too far away to matter

      // --- 2. deflection: distance to the nearest point of the footprint
      const dx = x - clamp(x, o.x0, o.x1);
      const dy = y - clamp(y, o.y0, o.y1);
      const d = Math.hypot(dx, dy);
      if (d < INFLUENCE && d > 1e-6) {
        const nx = dx / d, ny = dy / d;           // wall normal, pointing away from the building
        const w = (1 - d / INFLUENCE) ** 2;       // influence fades with distance
        const vn = vx * nx + vy * ny;             // flow component towards (−) / away from (+) the wall
        if (vn < 0) {
          // tangent along the facade, pointing away from the building's centre,
          // so head-on flow splits and goes around either side
          let tx = -ny, ty = nx;
          if (tx * rx + ty * ry < 0) { tx = -tx; ty = -ty; }
          vx += (-vn * nx + -vn * tx) * w;        // cancel the push into the wall …
          vy += (-vn * ny + -vn * ty) * w;        // … and redirect it along the wall
        }
        blockage += w;                            // --- 3. channelling
      }

      // --- 4. wake: a sheltered zone directly downwind of the obstacle
      const along = rx * U[0] + ry * U[1];        // distance downwind of the centre
      const across = rx * -U[1] + ry * U[0];      // sideways offset from the centreline
      const halfAlong = hx * Math.abs(U[0]) + hy * Math.abs(U[1]);
      const halfAcross = hx * Math.abs(U[1]) + hy * Math.abs(U[0]);
      const wakeLen = Math.min(45, 2.4 * halfAcross);
      const s = along - halfAlong;
      if (s > 0 && s < wakeLen && Math.abs(across) < halfAcross) {
        const edge = 1 - (Math.abs(across) / halfAcross) ** 4;
        wake = Math.max(wake, (1 - s / wakeLen) * edge);
      }
    }

    // --- 5. deck effects
    let deckFactor = 1;
    if (L.deck) {
      const D = L.deck;
      if (insideRects(D.rects, x, y)) {
        // edge acceleration: how far upwind is the deck's edge? (checked every 6 m up to 30 m)
        for (let s = 6; s <= 30; s += 6) {
          if (!insideRects(D.rects, x - U[0] * s, y - U[1] * s)) { deckFactor += 0.35 * (1 - s / 36); break; }
        }
      }
      for (const t of L.trees) {                          // planted volumes as porous wind-breaks
        if (x > t.x0 - 6 && x < t.x1 + 6 && y > t.y0 - 6 && y < t.y1 + 6) { deckFactor *= 0.7; break; }
      }
    }

    // Turbulence: a smooth pseudo-random wobble of the direction, stronger in wakes.
    const t = this.time;
    const n = Math.sin(x * 0.07 + t * 1.7) * Math.cos(y * 0.06 - t * 1.3)
      + 0.5 * Math.sin((x + y) * 0.11 + t * 2.3);
    const turn = n * (0.12 + 1.4 * wake);
    const len = Math.hypot(vx, vy) || 1;
    const c = Math.cos(turn), sn = Math.sin(turn);
    const ux = (vx * c - vy * sn) / len;
    const uy = (vx * sn + vy * c) / len;

    // Speed = profile speed × channelling × wake shelter × deck effects
    const factor = (1 + 0.8 * Math.min(blockage, 1)) * (1 - 0.7 * wake) * deckFactor;
    const v = this.levelSpeed(L.z) * factor;
    return [ux * v, uy * v, factor];
  }

  respawn(L, i, randomAge = false) {
    const R = L.region;
    let x = 0, y = 0;
    for (let tries = 0; tries < 12; tries++) {
      x = R.x0 + Math.random() * (R.x1 - R.x0);
      y = R.y0 + Math.random() * (R.y1 - R.y0);
      if (!this.inside(L, x, y)) break;
    }
    L.x[i] = x; L.y[i] = y;
    L.life[i] = 2 + Math.random() * 4;
    L.age[i] = randomAge ? Math.random() * L.life[i] : 0;
    const b = i * TRAIL * 2;
    for (let k = 0; k < TRAIL; k++) { L.trail[b + k * 2] = x; L.trail[b + k * 2 + 1] = y; }
  }

  inside(L, x, y) {
    for (const o of L.obstacles) if (x > o.x0 && x < o.x1 && y > o.y0 && y < o.y1) return o;
    return null;
  }

  /** Advance all particles by dt seconds. */
  step(dt, enabled = { street: true, deck: true }) {
    dt = Math.min(dt, 1 / 20);
    this.time += dt;
    this.sampleClock += dt;
    const shift = this.sampleClock >= SAMPLE;
    if (shift) this.sampleClock %= SAMPLE;
    const k = this.cfg.timeScale;

    for (const L of Object.values(this.levels)) {
      if (!enabled[L.id]) continue;
      const R = L.region;
      for (let i = 0; i < L.count; i++) {
        const [vx, vy, f] = this.velocity(L, L.x[i], L.y[i]);
        let x = L.x[i] + vx * dt * k;
        let y = L.y[i] + vy * dt * k;
        // If a particle ended up inside a building, slide it out to the nearest facade.
        const o = this.inside(L, x, y);
        if (o) {
          const ex = [x - o.x0, o.x1 - x, y - o.y0, o.y1 - y];
          const m = Math.min(...ex);
          if (m === ex[0]) x = o.x0 - 0.1; else if (m === ex[1]) x = o.x1 + 0.1;
          else if (m === ex[2]) y = o.y0 - 0.1; else y = o.y1 + 0.1;
        }
        L.x[i] = x; L.y[i] = y;
        L.fast[i] = f > 1.2 ? 1 : 0;
        L.age[i] += dt;
        const b = i * TRAIL * 2;
        if (L.age[i] > L.life[i] || x < R.x0 || x > R.x1 || y < R.y0 || y > R.y1) {
          this.respawn(L, i);
          continue;
        }
        if (shift) L.trail.copyWithin(b + 2, b, b + (TRAIL - 1) * 2);
        L.trail[b] = x; L.trail[b + 1] = y;
      }
    }
  }

  /** Run the simulation for a while without drawing (static frame for reduced motion). */
  warmUp(seconds, enabled) {
    for (let t = 0; t < seconds; t += 1 / 30) this.step(1 / 30, enabled);
  }

  /**
   * Draw one level's trails. Trails are drawn in TRAIL "age buckets" so each
   * bucket is a single stroke call with its own opacity (fast to render).
   */
  draw(ctx, view, levelId, color, unit) {
    const L = this.levels[levelId];
    const n = L.count, buf = L.screen;
    for (let i = 0; i < n; i++) {
      const b = i * TRAIL * 2;
      for (let k = 0; k < TRAIL; k++) {
        const p = view.p(L.trail[b + k * 2], L.trail[b + k * 2 + 1], L.z);
        buf[b + k * 2] = p[0]; buf[b + k * 2 + 1] = p[1];
      }
    }
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineCap = 'round';
    for (const fast of [0, 1]) {
      ctx.lineWidth = (fast ? 1.6 : 0.9) * unit;
      const peak = fast ? 0.95 : 0.6;
      for (let k = 0; k < TRAIL - 1; k++) {
        ctx.globalAlpha = peak * (1 - k / (TRAIL - 1)) ** 1.3;
        ctx.beginPath();
        for (let i = 0; i < n; i++) {
          if (L.fast[i] !== fast) continue;
          const b = i * TRAIL * 2 + k * 2;
          const x0 = buf[b], y0 = buf[b + 1], x1 = buf[b + 2], y1 = buf[b + 3];
          if (x0 === x1 && y0 === y1) continue;
          ctx.moveTo(x0, y0); ctx.lineTo(x1, y1);
        }
        ctx.stroke();
      }
    }
    ctx.restore();
  }
}
