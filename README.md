# Raumpark Vienna — visualisation proposal

Single-page site presenting the animation & infographic proposal for Raumpark Vienna.
Plain HTML, CSS and ES-module JavaScript, with no build step.

## Run

Open the folder in VS Code → right-click `index.html` → **Open with Live Server**.
(Any static server works, e.g. `python -m http.server`. Opening the file directly via `file://`
fails because the JSON data and ES modules need HTTP.)

URL parameters, handy in the meeting:

| Parameter | Example | Effect |
|---|---|---|
| `view` | `?view=layers` | open the model on `sun`, `wind` or `layers` |
| `date` | `?date=dec` | sun study date: `mar`, `jun`, `sep`, `dec` |
| `time` | `?time=16:30` | sun study clock time (pauses the time-lapse) |
| `theme` | `?theme=dark` | force `light` or `dark` |

## Files

```
index.html          page structure and copy
css/style.css       drawing-set styles, light/dark tokens, responsive, reduced motion
js/config.js        ALL model dimensions (grid, deck, pylons, pavilions, sun dates, wind)
js/scene.js         isometric renderer, the three tabs, controls, Record button
js/sun.js           solar position (NOAA) + shadow projection, commented for explanation
js/wind.js          schematic wind particles (profile, deflection, channelling, wake)
js/recorder.js      canvas → WebM export via MediaRecorder
js/deckshape.js     merges the deck rectangles into one irregular outline (with openings)
js/gantt.js         timetable built from data/timeline.json
js/storyboard.js    storyboard: edit timeline (tracks + playhead) and schematic SVG shot sketches
js/main.js          bootstrap: theme toggle, reveal-on-scroll, section loading
data/storyboard.json shots S1–S10: duration, scale, idea, camera, graphics, data
data/timeline.json  14-week Gantt: tasks, holiday break, milestones
```

## Editing the storyboard

Edit `data/storyboard.json`. Durations drive the timeline widths and timecodes; `scale` sets the
zoom-level track (`city`, `district`, `street`, `room`; two values = split screen); `view` adds a
"Try it in the model" button that opens that tab; `tier: "optional"` draws the shot hatched/dashed.
Sketches are picked by the `sketch` key (`heatmap`, `sun`, `wind`, `split`, `use-culture`, `use-health`, `use-res`, `use-green`, `solar`, `layers`) in `js/storyboard.js`.

## Swapping in real dimensions

Edit `js/config.js`. Units are metres, x = east, y = north. `grid.heights` accepts a
rows × cols array of real eave heights; `pylons.positions` accepts explicit `[x, y]` points.

The deck is `deck.rects`: a list of rectangles `[x0, y0, x1, y1]` (multiples of 2 m) whose union
becomes the irregular outline, including any openings where arms close around a block
(`js/deckshape.js` traces it). The uses on the deck are `uses.<name>.boxes`: plain volumes
`[x0, y0, x1, y1, height]`. The storyboard sketches have their own small district with the same
logic in `DISTRICT` and `USES` in `js/storyboard.js`.

## Record → After Effects

**Record** renders the current tab off-screen at the chosen size (default 1920×1080, 30 fps)
and downloads a `.webm` when you press **Stop**. Start the time-lapse or wind first, or
scrub the sliders while recording.

Browser WebM files are variable-frame-rate and have no duration header. If After Effects
won't import one, or it drifts, convert it to ProRes first:

```
ffmpeg -i raumpark_sun.webm -r 30 -c:v prores_ks -profile:v 3 -pix_fmt yuv422p10le raumpark_sun.mov
```
