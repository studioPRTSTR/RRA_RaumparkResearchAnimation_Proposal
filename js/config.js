/* ==========================================================================
   Raumpark Vienna — scene configuration
   --------------------------------------------------------------------------
   Every number that defines the model lives here, so the placeholder
   geometry can be swapped for real dimensions without touching the
   rendering code.

   Units:  metres and degrees.
   Axes:   x → east, y → north, z → up.
   Origin: south-west corner of the first (south-west) block.
   ========================================================================== */

export const CONFIG = {
  site: {
    name: 'Raumpark Vienna',
    latitude: 48.21,   // ° N  (Vienna)
    longitude: 16.37,  // ° E
  },

  /* Existing city: a regular block grid (placeholder for the real cadastre). */
  grid: {
    cols: 8,           // blocks west → east
    rows: 6,           // blocks south → north
    block: 60,         // block edge length
    street: 20,        // street width between blocks
    margin: 40,        // ground border drawn around the grid
    heightMin: 19,     // eave heights are randomised in this range …
    heightMax: 27,
    seed: 11,          // … with a fixed seed so the model is always the same
    heights: null,     // or a rows × cols array (south row first) of real heights
  },

  /* Raumpark deck: the elevated public landscape. Its irregular outline grows
     along the streets like a metabolist structure: it is the union of these
     rectangles [x0, y0, x1, y1] in world metres (multiples of 2 m). Street
     centre lines of the placeholder grid: x = 70 + 80·i, y = 70 + 80·j. */
  deck: {
    elevation: 46,     // top of deck above street level
    thickness: 3,
    rects: [
      // arms along the streets
      [130, 138, 490, 162], [140, 298, 420, 322], [210, 218, 330, 242],
      [138, 120, 162, 330], [298, 100, 322, 340], [458, 130, 482, 250], [378, 238, 402, 330],
      // platforms over the intersections
      [124, 124, 176, 176], [280, 200, 350, 262], [446, 128, 494, 172],
      [128, 290, 174, 334], [366, 288, 414, 334], [290, 128, 332, 170],
      // plug-ins over the blocks
      [170, 170, 206, 200], [334, 262, 360, 286], [420, 160, 446, 186], [230, 318, 262, 340],
    ],
  },

  /* Structure: pylons (service cores) carrying the deck, on street intersections.
     With positions: null they are picked automatically (cols × rows). */
  pylons: {
    size: 10,          // square section
    cols: 3,
    rows: 2,
    positions: [[150, 150], [310, 150], [470, 150], [150, 310], [310, 230], [390, 310]],
  },

  /* Uses on the deck, shown only as plain boxes [x0, y0, x1, y1, height]
     in world metres; they stand on the deck top. */
  uses: {
    culture: { label: 'Culture', boxes: [[128, 128, 150, 144, 7], [154, 130, 172, 142, 5], [128, 150, 144, 172, 6], [178, 178, 200, 196, 4]] },
    health: { label: 'Health & wellbeing', boxes: [[448, 132, 470, 146, 4], [474, 132, 490, 168, 1.5], [450, 150, 466, 168, 6], [424, 164, 442, 184, 5]] },
    res: { label: 'Residential', boxes: [[284, 204, 306, 224, 16], [314, 204, 346, 222, 12], [284, 236, 304, 258, 14], [316, 240, 346, 258, 9]] },
    green: { label: 'Green areas', boxes: [[132, 294, 170, 306, 2], [132, 312, 150, 330, 3], [156, 314, 172, 330, 1.5], [368, 292, 386, 306, 2.5],
      [392, 296, 412, 330, 2], [200, 140, 240, 158, 2], [340, 140, 380, 158, 2.5], [300, 104, 320, 124, 2], [140, 180, 160, 210, 2],
      [232, 300, 262, 320, 2], [460, 190, 480, 240, 2], [380, 262, 400, 286, 2.5]] },
  },

  /* Camera bearing per tab: compass direction FROM the model TO the viewer
     (225 = classic view from the south-west). The sun study looks from the
     east-south-east, because from the south-west the sun's daily arc is seen
     almost edge-on at Vienna's latitude. */
  view: { bearing: { sun: 105, wind: 225, layers: 225 } },

  /* Isometric layers tab: how far each layer lifts in the exploded view. */
  explode: { structure: 60, deck: 125, programme: 175 },

  /* Sun study: key dates. tz = offset to UTC incl. daylight saving time,
     so the slider shows the clock time people in Vienna would read. */
  sun: {
    dates: [
      { id: 'mar', label: '20 Mar — spring equinox', short: '20 MAR', day: 79, tz: 1, zone: 'CET' },
      { id: 'jun', label: '21 Jun — summer solstice', short: '21 JUN', day: 172, tz: 2, zone: 'CEST' },
      { id: 'sep', label: '23 Sep — autumn equinox', short: '23 SEP', day: 266, tz: 2, zone: 'CEST' },
      { id: 'dec', label: '21 Dec — winter solstice', short: '21 DEC', day: 355, tz: 1, zone: 'CET' },
    ],
    defaultDate: 'jun',
    defaultMinutes: 15 * 60,     // 15:00
    minMinutes: 4 * 60,          // slider range 04:00 …
    maxMinutes: 21 * 60,         // … 21:00
    hoursPerSecond: 1.1,         // time-lapse speed
  },

  /* Wind flow: meteorological directions (where the wind comes FROM). */
  wind: {
    directions: { W: 270, NW: 315, SE: 135 },
    defaultDirection: 'W',
    defaultSpeed: 5,             // m/s at 10 m reference height
    profileAlpha: 0.3,           // power-law exponent for urban terrain
    streetZ: 2,                  // particle height at street level
    deckZ: 1.5,                  // particle height above deck top
    particles: { street: 900, deck: 520 },
    timeScale: 8,                // particles move 8× real speed so flow reads on screen
  },
};
