# Raumpark Vienna — visualisation proposal

Single-page site presenting the animation & infographic proposal for Raumpark Vienna:
a short intro, the storyboard (Package 1, 3 minutes, 10 shots) and the timetable.
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
js/storyboard.js     storyboard player: big screen, clickable edit timeline, shot description, SVG sketches
js/deckshape.js      merges the deck rectangles into one irregular outline (with openings)
js/sun.js            solar position (NOAA), used for the sun arc, shadows and solar income
js/config.js         site location and key dates for the sun calculations
js/vienna.js         Vienna's outline and the Danube for S1 (© OpenStreetMap contributors, ODbL) and its 23 districts (Stadt Wien – data.wien.gv.at, CC BY 4.0)
js/gantt.js          timetable built from data/timeline.json
js/hairline/         Hairline engine and line figure (not used by the storyboard at the moment, see below)
data/storyboard.json shots S1–S10: duration, scale, idea, camera, graphics, data
data/timeline.json   18-week Gantt: two packages, holiday break, milestones
```

## Editing the storyboard

**Fullscreen:** the "Fullscreen" button in the player bar (or F, or a double click on the screen)
shows the screen alone; there a click plays / pauses, ← → step through the shots, Esc leaves.

**Arranging the shots:** press "Arrange shots" above the strip, then drag the frames (or use ← →)
into a new order; the player, timeline and shot numbers follow at once. The order is kept in this
browser only. "Export storyboard.json" downloads the data in the new order: save it over
`data/storyboard.json` to make it permanent (then "Reset order"). The timetable's shot labels in
`data/timeline.json` are not renumbered automatically.

Above the screen, a storyboard strip shows every shot as a small frame with only the basic
outline of its content (Vienna's contour, the district outline, the window); click one to jump there.
The storyboard is a player: one big screen shows the current shot, the playhead runs through the
3 minutes in real time and switches shots on its own. Click a shot in the timeline to play from its
start, click the time ruler or scale track to jump to that moment, the ← / → buttons or arrow keys step between
shots, space plays / pauses. The text under the timeline describes the shot on screen.

Edit `data/storyboard.json`. Durations drive the timeline widths and timecodes; `scale` sets the
zoom-level track (`city`, `district`, `street`, `room`; two values = split screen);
`tier: "optional"` draws the shot hatched/dashed. Sketches are picked by the `sketch` key
(`heatmap`, `district-border`, `raumpark-rise`, `district-heat`, `sun`, `split`, `layers`, `sun-hours`,
`solar`, `green-living`) in `js/storyboard.js`. A shot with a `figure` key shows a Hairline figure from
`js/hairline/` instead; its `sketch` key then only picks the strip thumbnail.

## Hairline figures

S6 (layers) is now an SVG sketch on the same district as the other shots. The Hairline figure
`layers.js` stays in the repo and can be put back with `"figure": "layers"`. It is drawn on the engine of [Hairline](https://github.com/lucasmarkes/hairline)
(MIT, © Lucas Marques): isometric line figures that answer the pointer. `js/hairline/kernel.js` is the
engine, copied unchanged from the `hairline-create` skill and loaded as a classic script (global `HL`);
`layers.js` is the figure. The figures are made to answer a pointer; here the pointer
is scripted. A shot's `motion` keyframes (`t` in seconds into the shot, `at` a point in the figure's
400 × 320 viewBox or `null` for rest, optional `value` for its intensity number) are played against
the playhead, so the figure is a pre-made animation that pauses and scrubs with the player. The mouse
is ignored. Colours come from the site tokens via `--hairline-*` in `css/style.css`.

The sketch district lives in `DISTRICT` in `js/storyboard.js`: Gründerzeit perimeter blocks
(white, outlines only) and the Raumpark deck as a list of rectangles `[x0, y0, x1, y1]`
(multiples of 2 m) whose union becomes the irregular outline, including openings where arms
close around a block. The uses on the deck are plain boxes `[x0, y0, x1, y1, height]` in `USES`.
Rectangles that only touch at a corner give an odd outline, so let pieces overlap a little.

## Editing the timetable

Edit `data/timeline.json`: `phases` (the two packages), `groups` → `tasks` (start/end dates,
`tone` for the colour, `optional` / `tag` for hatched bars), `breaks` and `milestones`.
