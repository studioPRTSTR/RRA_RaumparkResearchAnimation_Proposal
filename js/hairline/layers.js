/**
 * Layers: the Raumpark taken apart as an exploded axonometric in four plates.
 * At the bottom the city: a plinth with nine perimeter blocks, each with its
 * courtyard. Above it the structure: four pylons over the street crossings,
 * each with a flared head, dashed drops marking where they land. Then the
 * deck, one branching plate along the streets, and on top the uses, five
 * volumes. At rest the stack stands slightly apart and the deck is bright.
 * The pointer's height picks a layer: the layers above it lift away to open
 * it, staggered outwards, and it takes the bright edge. The slider is that
 * opening, in world units.
 *
 * The pattern: scrub and pick. Tweens per layer, a stagger by distance, and a
 * hit test on the layers' rest heights, which never move.
 */
const {
  Cam, facing, fillet, fit, poly, prism, proj, rings, ringAt, rrect, seg,
  tween, tset, tval, tdone, disposer, mk, pointer, put, register, solid,
} = HL;

const BLOCKS = [[0, 28], [40, 68], [80, 108]], CITY_H = [11, 14, 10, 13, 9, 12, 10, 12, 14];
const CROSS = [[34, 34], [74, 34], [34, 74], [74, 74]];
const PYL = 22, HEAD = 1.6, DECK = 2.4;
const BASE = [0, 21, 48, 59.4];                    // each layer's floor at rest: a slight, uneven explode
const MID = [6, 32, 49.2, 66];                     // each layer's middle at rest, for the hit test
const NAMES = ["city", "pylons", "deck", "uses"];
const OPEN_MAX = 38, TOP = BASE[3] + 13 + OPEN_MAX;
// the deck: one branching plate along the streets, traced round the union of its arms and its central platform
const DECK_PTS = [[4, 28], [68, 28], [68, 4], [80, 4], [80, 28], [104, 28], [104, 40], [80, 40], [80, 62], [86, 62],
  [86, 86], [80, 86], [80, 104], [68, 104], [68, 86], [62, 86], [62, 62], [68, 62], [68, 40], [40, 40], [40, 84],
  [28, 84], [28, 40], [4, 40]];
// the uses: [x0, y0, x1, y1, height] on the deck; the tall one is housing on the central platform
const USES = [[8, 30, 22, 38, 5], [70, 8, 78, 22, 7], [86, 30, 100, 38, 4], [30, 48, 38, 70, 2.5], [65, 65, 83, 83, 13]];
const byDepth = (a, b) => a[0] + a[1] + a[2] + a[3] - (b[0] + b[1] + b[2] + b[3]);

function mount({ stage, svg, read }, value) {
  const bag = disposer();
  let lift = value, act = -1;
  const C = Cam(45, 0.5, 1.5);
  fit(C, [[-6, -6, -4], [114, 114, -4], [114, -6, -4], [-6, 114, -4], [4, 28, TOP], [68, 4, TOP]], 200, 166);
  const P = proj(C), front = facing(C);

  const g = mk("g", {}, svg);
  const L = NAMES.map(() => ({ g: mk("g", {}, g), sils: [], lift: tween(0), drawn: NaN, draw: () => {} }));

  // City: the plinth, then the blocks and the pylons' landing drops, back to front.
  const [pr, pi] = rings(-6, -6, 114, 114, 8, 2.2);
  const plinth = solid(L[0].g);
  put(plinth, prism(P, front, pr, pi, -4, 0));
  L[0].sils.push(plinth.sil);
  const items = [];
  BLOCKS.forEach(([x0, x1], i) => BLOCKS.forEach(([y0, y1], j) => items.push({ k: x0 + x1 + y0 + y1, b: [x0, y0, x1, y1, CITY_H[i * 3 + j]] })));
  CROSS.forEach(([x, y]) => items.push({ k: 2 * (x + y) - 0.1, c: [x, y] }));
  items.sort((a, b) => a.k - b.k);
  const drops = [];
  for (const it of items) {
    if (it.c) { drops.push({ at: it.c, el: mk("path", { class: "nf dash" }, L[0].g) }); continue; }
    const [x0, y0, x1, y1, h] = it.b, [r, ri] = rings(x0, y0, x1, y1, 3, 1.2), s = solid(L[0].g);
    put(s, prism(P, front, r, ri, 0, h));
    mk("path", { d: poly(ringAt(P, rrect(x0 + 8, y0 + 8, x1 - 8, y1 - 8, 2, 4), h)), class: "nf lo" }, s.g);
    L[0].sils.push(s.sil);
  }

  // Structure: a shaft and a flared head per crossing.
  const pylons = CROSS.slice().sort((a, b) => a[0] + a[1] - b[0] - b[1]).map(([x, y]) => ({
    x, y, shaft: solid(L[1].g), head: solid(L[1].g),
    sr: rings(x - 3.5, y - 3.5, x + 3.5, y + 3.5, 1.6, 0.8), hr: rings(x - 6, y - 6, x + 6, y + 6, 2.4, 1),
  }));
  pylons.forEach((p) => L[1].sils.push(p.shaft.sil, p.head.sil));
  L[1].draw = (dz) => {
    const z0 = BASE[1] + dz;
    for (const p of pylons) {
      put(p.shaft, prism(P, front, p.sr[0], p.sr[1], z0, z0 + PYL - HEAD));
      put(p.head, prism(P, front, p.hr[0], p.hr[1], z0 + PYL - HEAD, z0 + PYL));
    }
    for (const d of drops) d.el.setAttribute("d", seg(P(d.at[0], d.at[1], 0), P(d.at[0], d.at[1], z0)));
  };

  // Deck: a thin plate, so its underside is a second outline and nothing more.
  const outline = fillet(DECK_PTS, DECK_PTS.map(() => 2.6), 3);
  const under = mk("path", {}, L[2].g), top = mk("path", { class: "sil" }, L[2].g);
  L[2].sils.push(top);
  L[2].draw = (dz) => {
    const z0 = BASE[2] + dz;
    under.setAttribute("d", poly(outline.map(([x, y]) => P(x, y, z0))));
    top.setAttribute("d", poly(outline.map(([x, y]) => P(x, y, z0 + DECK))));
  };

  // Uses: plain volumes on the deck, back to front.
  const vols = USES.slice().sort(byDepth).map((u) => ({ u, s: solid(L[3].g), r: rings(u[0], u[1], u[2], u[3], 1.6, 0.8) }));
  vols.forEach((v) => L[3].sils.push(v.s.sil));
  L[3].draw = (dz) => {
    for (const v of vols) put(v.s, prism(P, front, v.r[0], v.r[1], BASE[3] + dz, BASE[3] + dz + v.u[4]));
  };

  const B = register(stage, (_dt, now) => {
    let moving = false;
    for (const l of L) {
      const z = tval(l.lift, now);
      if (z !== l.drawn) { l.drawn = z; l.draw(z); }
      if (!tdone(l.lift, now)) moving = true;
    }
    return moving;
  });
  bag.add(B.unregister);

  const glow = (a) => L.forEach((l, i) => l.sils.forEach((el) => el.classList.toggle("hi", a < 0 ? i === 2 : i === a)));
  glow(-1);

  // The layers' middles at rest, on screen: the pointer's height picks the nearest. They never move.
  const bands = MID.map((z) => P(54, 54, z)[1]);
  const hit = ([, y]) => bands.reduce((best, v, i) => (Math.abs(v - y) < Math.abs(bands[best] - y) ? i : best), 0);

  /** Opens the stack above layer a (-1 closes it). The stagger spreads out from the layer picked, or the one let go. */
  function choose(a, force) {
    if (a === act && !force) return;
    const now = performance.now(), from = a >= 0 ? a : act;
    act = a;
    L.forEach((l, i) => tset(l.lift, a >= 0 && i > a ? lift : 0, now, Math.abs(i - from) * 45));
    glow(a);
    read.textContent = a < 0 ? "rest" : NAMES[a];
    B.wake();
  }

  bag.add(pointer(stage, { move: (p) => choose(hit(p)), leave: () => choose(-1) }));
  bag.add(() => svg.replaceChildren());

  return {
    set: (v) => { lift = v; if (act >= 0) choose(act, true); },
    destroy: bag.dispose,
  };
}

hairline({
  name: "layers",
  means: "The Raumpark in four layers, city, pylons, deck and uses: the pointer's height picks one and the layers above lift away.",
  rules: [1, 2, 5, 6],
  range: [12, 24, 38],
  tour: [[240, 137], [200, 218], [160, 159], null],
  mount,
});
