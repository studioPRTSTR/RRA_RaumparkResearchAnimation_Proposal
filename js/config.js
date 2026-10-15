/* ==========================================================================
   Raumpark Vienna — shared settings
   --------------------------------------------------------------------------
   Site location and the key dates used by the storyboard's sun calculations
   (sun arc and shadow in S2/S4, yearly solar income in S9).
   ========================================================================== */

export const CONFIG = {
  site: {
    name: 'Raumpark Vienna',
    latitude: 48.21,   // ° N  (Vienna)
    longitude: 16.37,  // ° E
  },

  /* Key dates. tz = offset to UTC incl. daylight saving time (local clock time). */
  sun: {
    dates: [
      { id: 'mar', label: '20 Mar — spring equinox', short: '20 MAR', day: 79, tz: 1, zone: 'CET' },
      { id: 'jun', label: '21 Jun — summer solstice', short: '21 JUN', day: 172, tz: 2, zone: 'CEST' },
      { id: 'sep', label: '23 Sep — autumn equinox', short: '23 SEP', day: 266, tz: 2, zone: 'CEST' },
      { id: 'dec', label: '21 Dec — winter solstice', short: '21 DEC', day: 355, tz: 1, zone: 'CET' },
    ],
  },
};
