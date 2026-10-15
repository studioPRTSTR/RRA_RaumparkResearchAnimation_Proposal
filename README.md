# Raumpark Vienna — visualisation proposal

Single-page site presenting the animation & infographic proposal for Raumpark Vienna:
a short intro, the storyboard (Package 1, 3 minutes, 11 shots) and the timetable.
Plain HTML, CSS and ES-module JavaScript, with no build step.

Proposal by Manuel Gruber · _studiogruber

## Run

Open the folder in VS Code → right-click `index.html` → **Open with Live Server**.
(Any static server works, e.g. `python -m http.server`. Opening the file directly via `file://`
fails because the JSON data and ES modules need HTTP.) After code changes, hard-reload
(Ctrl+Shift+R) so the browser doesn't use cached scripts.

`?theme=light` or `?theme=dark` forces a colour theme.

## Files

```
index.html           page structure and copy
css/style.css        drawing-set styles, light/dark tokens, responsive, reduced motion
js/main.js           bootstrap: theme toggle, reveal-on-scroll, section loading
js/storyboard.js     storyboard: edit timeline (tracks + playhead) and schematic SVG shot sketches
js/deckshape.js      merges the deck rectangles into one irregular outline (with openings)
js/sun.js            solar position (NOAA), used for the sun arc, shadows and solar income
js/config.js         site location and key dates for the sun calculations
js/gantt.js          timetable built from data/timeline.json
data/storyboard.json shots S1–S11: duration, scale, idea, camera, graphics, data
data/timeline.json   18-week Gantt: two packages, holiday break, milestones
```

## Editing the storyboard

Edit `data/storyboard.json`. Durations drive the timeline widths and timecodes; `scale` sets the
zoom-level track (`city`, `district`, `street`, `room`; two values = split screen);
`tier: "optional"` draws the shot hatched/dashed. Sketches are picked by the `sketch` key
(`heatmap`, `sun`, `wind`, `split`, `use-culture`, `use-health`, `use-res`, `use-green`, `circulation`,
`solar`, `layers`) in `js/storyboard.js`.

The sketch district lives in `DISTRICT` in `js/storyboard.js`: Gründerzeit perimeter blocks
(white, outlines only) and the Raumpark deck as a list of rectangles `[x0, y0, x1, y1]`
(multiples of 2 m) whose union becomes the irregular outline, including openings where arms
close around a block. The uses on the deck are plain boxes `[x0, y0, x1, y1, height]` in `USES`.
Rectangles that only touch at a corner give an odd outline, so let pieces overlap a little.

## Editing the timetable

Edit `data/timeline.json`: `phases` (the two packages), `groups` → `tasks` (start/end dates,
`tone` for the colour, `optional` / `tag` for hatched bars), `breaks` and `milestones`.
