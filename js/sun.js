/* ==========================================================================
   sun.js — solar geometry and shadows for the sun study
   --------------------------------------------------------------------------
   How it works, in meeting language:

   1. For a date and clock time we work out where the sun is in the sky:
      its ALTITUDE (angle above the horizon) and AZIMUTH (compass bearing,
      0° = north, 90° = east, 180° = south, 270° = west).
      We use the NOAA "general solar position" equations, accurate to roughly
      ±0.5°, which is far more precise than any animation needs.

   2. Altitude + azimuth become a 3D direction vector pointing at the sun.

   3. Shadows: every corner of a building is pushed along that vector, away
      from the sun, until it hits the ground (or the deck). The outline
      (convex hull) of those points is the shadow. A 46 m deck with the sun
      at 30° altitude throws a shadow 46 / tan(30°) ≈ 80 m long.
   ========================================================================== */

const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;

/**
 * Sun position for Vienna (or any latitude/longitude).
 * @param {number} dayOfYear     1 … 365
 * @param {number} localMinutes  clock time in minutes after midnight (e.g. 15:30 → 930)
 * @param {number} tz            time-zone offset to UTC in hours (CET = 1, CEST = 2)
 * @param {number} lat           latitude in degrees (Vienna 48.21)
 * @param {number} lon           longitude in degrees east (Vienna 16.37)
 * @returns {{altitude:number, azimuth:number}} both in radians; azimuth clockwise from north
 */
export function sunPosition(dayOfYear, localMinutes, tz, lat, lon) {
  // 1. Fractional year γ: Earth's position on its orbit, as an angle (radians).
  const utcHours = localMinutes / 60 - tz;
  const g = (2 * Math.PI / 365) * (dayOfYear - 1 + (utcHours - 12) / 24);

  // 2. Equation of time (minutes): how far a sundial runs ahead of / behind the clock
  //    over the year, because the orbit is elliptical and Earth's axis is tilted.
  const eqTime = 229.18 * (0.000075
    + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g)
    - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g));

  // 3. Declination δ: the latitude where the sun is directly overhead today.
  //    +23.4° at the June solstice, 0° at the equinoxes, −23.4° in December.
  const decl = 0.006918
    - 0.399912 * Math.cos(g) + 0.070257 * Math.sin(g)
    - 0.006758 * Math.cos(2 * g) + 0.000907 * Math.sin(2 * g)
    - 0.002697 * Math.cos(3 * g) + 0.00148 * Math.sin(3 * g);

  // 4. True solar time: clock time corrected for
  //    • longitude: 4 minutes per degree east of the time zone's meridian (15° per hour)
  //    • the time-zone / daylight-saving offset
  //    • the equation of time
  //    At 12:00 true solar time the sun stands exactly due south.
  const trueSolarMinutes = localMinutes + eqTime + 4 * lon - 60 * tz;

  // 5. Hour angle: 0° at solar noon, −15° per hour before, +15° per hour after.
  const hourAngle = (trueSolarMinutes / 4 - 180) * RAD;

  // 6. Altitude from spherical trigonometry (the "sky triangle" between
  //    zenith, celestial pole and sun).
  const phi = lat * RAD;
  const sinAlt = Math.sin(phi) * Math.sin(decl)
    + Math.cos(phi) * Math.cos(decl) * Math.cos(hourAngle);
  const altitude = Math.asin(Math.max(-1, Math.min(1, sinAlt)));

  // 7. Azimuth, measured clockwise from north (atan2 picks the correct quadrant).
  let azimuth = Math.atan2(
    Math.sin(hourAngle),
    Math.cos(hourAngle) * Math.sin(phi) - Math.tan(decl) * Math.cos(phi),
  ) + Math.PI;
  azimuth = (azimuth + 2 * Math.PI) % (2 * Math.PI);

  return { altitude, azimuth };
}

/**
 * Unit vector pointing from the ground TOWARDS the sun, in world axes
 * (x east, y north, z up).
 */
export function sunVector(altitude, azimuth) {
  const c = Math.cos(altitude);
  return [Math.sin(azimuth) * c, Math.cos(azimuth) * c, Math.sin(altitude)];
}

/** The sun's path for a whole day, sampled every `step` minutes (for the arc). */
export function dayPath(date, lat, lon, step = 10) {
  const pts = [];
  for (let m = 0; m <= 1440; m += step) {
    const p = sunPosition(date.day, m, date.tz, lat, lon);
    pts.push({ minutes: m, ...p });
  }
  return pts;
}

/**
 * Sunrise, sunset and the highest altitude of the day. Sunrise/sunset use the
 * standard −0.833° threshold (sun's radius + atmospheric refraction).
 */
export function sunTimes(date, lat, lon) {
  const limit = -0.833 * RAD;
  let rise = null, set = null, maxAlt = -Infinity, prev = null;
  for (let m = 0; m <= 1440; m += 1) {
    const { altitude } = sunPosition(date.day, m, date.tz, lat, lon);
    if (altitude > maxAlt) maxAlt = altitude;
    if (prev !== null) {
      if (prev < limit && altitude >= limit) rise = m - (altitude - limit) / (altitude - prev);
      if (prev >= limit && altitude < limit) set = m - (altitude - limit) / (altitude - prev);
    }
    prev = altitude;
  }
  return { sunrise: rise, sunset: set, maxAltitude: maxAlt };
}

/** Horizontal shadow length of an object of height h (∞ when the sun is down). */
export function shadowLength(h, altitude) {
  return altitude > 0 ? h / Math.tan(altitude) : Infinity;
}

/* -------------------------------------------------------------------------
   Shadow geometry
   ------------------------------------------------------------------------- */

/**
 * Push a 3D point along the sun direction until it lies on the horizontal
 * plane z = planeZ. Points already on the plane stay where they are.
 *   new x = x − (z − planeZ) · sx / sz      (same for y)
 * i.e. the higher the point and the lower the sun (small sz), the further it moves.
 */
export function projectToPlane(x, y, z, sun, planeZ) {
  const t = (z - planeZ) / sun[2];
  return [x - sun[0] * t, y - sun[1] * t];
}

/** Shadow outline of an axis-aligned box on plane z = planeZ (world x/y points). */
export function boxShadow(box, sun, planeZ = 0) {
  const pts = [];
  for (const z of [box.z0, box.z1]) {
    if (z < planeZ) continue;
    pts.push(
      projectToPlane(box.x0, box.y0, z, sun, planeZ),
      projectToPlane(box.x1, box.y0, z, sun, planeZ),
      projectToPlane(box.x1, box.y1, z, sun, planeZ),
      projectToPlane(box.x0, box.y1, z, sun, planeZ),
    );
  }
  return convexHull(pts);
}

/** Shadow of a tree canopy (a disc of radius r at height z) on plane planeZ. */
export function discShadow(tree, sun, planeZ) {
  const [x, y] = projectToPlane(tree.x, tree.y, tree.z1, sun, planeZ);
  return { x, y, r: tree.r };
}

/** Andrew's monotone-chain convex hull (2D). */
export function convexHull(points) {
  const p = points.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (p.length < 3) return p;
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = [], upper = [];
  for (const pt of p) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], pt) <= 0) lower.pop();
    lower.push(pt);
  }
  for (let i = p.length - 1; i >= 0; i--) {
    const pt = p[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], pt) <= 0) upper.pop();
    upper.push(pt);
  }
  upper.pop(); lower.pop();
  return lower.concat(upper);
}

/* -------------------------------------------------------------------------
   Formatting helpers for the read-outs
   ------------------------------------------------------------------------- */

export const toDeg = (r) => r * DEG;

export function formatClock(minutes) {
  if (minutes == null || !isFinite(minutes)) return '—';
  const m = Math.round(minutes);
  const h = Math.floor(m / 60) % 24;
  return `${String(h).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

export function compassLabel(azimuthRad) {
  const names = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  return names[Math.round(toDeg(azimuthRad) / 22.5) % 16];
}
