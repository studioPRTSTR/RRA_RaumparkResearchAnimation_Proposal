/* ==========================================================================
   gantt.js — timetable rendered from data/timeline.json
   --------------------------------------------------------------------------
   Plain HTML/CSS (no SVG): every bar is positioned in % of the total time
   span, so the chart scales with its container. Bars are split automatically
   around breaks (e.g. the holiday), which are drawn as a hatched band.
   ========================================================================== */

const DAY = 864e5;
const fmt = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const fmtMonth = new Intl.DateTimeFormat('en-GB', { month: 'short', timeZone: 'UTC' });
const parse = (s) => { const [y, m, d] = s.split('-').map(Number); return Date.UTC(y, m - 1, d); };
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/** ISO-8601 calendar week (KW) of a UTC timestamp. */
function isoWeek(t) {
  const d = new Date(t);
  const day = (d.getUTCDay() + 6) % 7;            // Monday = 0
  d.setUTCDate(d.getUTCDate() - day + 3);         // Thursday of this week
  const firstThu = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  return 1 + Math.round((d - firstThu) / DAY / 7 - ((firstThu.getUTCDay() + 6) % 7 - 3) / 7);
}

/** Remove break intervals from [a, b) → list of [start, end) segments. */
function subtract(a, b, breaks) {
  let segs = [[a, b]];
  for (const [s, e] of breaks) {
    segs = segs.flatMap(([x, y]) => {
      if (e <= x || s >= y) return [[x, y]];
      const out = [];
      if (s > x) out.push([x, s]);
      if (e < y) out.push([e, y]);
      return out;
    });
  }
  return segs;
}

export async function initGantt(el, url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  renderGantt(el, await res.json());
}

export function renderGantt(el, data) {
  const start = parse(data.start);
  const days = data.weeks * 7;
  const end = start + days * DAY;
  const pct = (t) => ((t - start) / DAY / days) * 100;
  // breaks cut the bars; a break with `work: true` (holidays worked through) is only shown
  const bands = (data.breaks ?? []).map((b) => [parse(b.start), parse(b.end) + DAY, b.label, !!b.work]);
  const breaks = bands.filter((b) => !b[3]);
  // working days (Mon–Fri) outside the breaks, as weeks of five days
  const weekdays = (x, y) => { let n = 0; for (let t = x; t < y; t += DAY) { const d = new Date(t).getUTCDay(); if (d > 0 && d < 6) n++; } return n; };
  const workingWeeks = (a, b) => Math.round(subtract(a, b, breaks).reduce((n, [x, y]) => n + weekdays(x, y), 0) / 5 * 10) / 10;

  /* ---- scale: months + weeks ---- */
  let months = '';
  for (let t = start; t < end;) {
    const d = new Date(t);
    const next = Math.min(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1), end);
    const roomy = next - t > 12 * DAY;
    const label = fmtMonth.format(t) + (roomy && (d.getUTCMonth() === 0 || t === start) ? ` ${d.getUTCFullYear()}` : '');
    months += `<span class="gantt__month" style="left:${pct(t)}%;width:${pct(next) - pct(t)}%">${label}</span>`;
    t = next;
  }
  const phases = (data.phases ?? []).map((p) => ({ ...p, a: parse(p.start), b: parse(p.end) + DAY }));
  const phaseRow = phases.map((p) =>
    `<span class="gantt__phase" style="left:${pct(p.a)}%;width:${pct(p.b) - pct(p.a)}%">${esc(p.label)}</span>`).join('');
  let weeks = '';
  for (let i = 0; i < data.weeks; i++) {
    const t = start + i * 7 * DAY;
    const d = new Date(t);
    weeks += `<span class="gantt__week" style="left:${(i / data.weeks) * 100}%;width:${100 / data.weeks}%">
      <b>W${i + 1}</b><i>${d.getUTCDate()}.${d.getUTCMonth() + 1}.</i><i>KW${isoWeek(t)}</i></span>`;
  }

  /* ---- overlay: breaks, milestone lines, today ---- */
  let overlay = bands.map(([s, e, label, work]) =>
    `<div class="gantt__break${work ? ' gantt__break--work' : ''}" style="left:${pct(s)}%;width:${pct(e) - pct(s)}%"><span>${esc(label)}</span></div>`).join('');
  overlay += phases.slice(1).map((p) => `<div class="gantt__phase-edge" style="left:${pct(p.a)}%"></div>`).join('');
  const ms = (data.milestones ?? []).map((m, i) => ({ ...m, n: i + 1, t: parse(m.date) }));
  overlay += ms.map((m) => `<div class="gantt__mline" style="left:${pct(m.t + DAY / 2)}%"></div>`).join('');
  const now = Date.now();
  if (now >= start && now < end) {
    overlay += `<div class="gantt__today" style="left:${pct(now)}%"><span>Today</span></div>`;
  }

  /* ---- rows ---- */
  let rows = `<div class="gantt__row gantt__row--ms">
    <div class="gantt__label">Milestones</div>
    <div class="gantt__track">${ms.map((m) => `
      <button class="gantt__ms" style="left:${pct(m.t + DAY / 2)}%"
        data-tip="M${m.n} · ${esc(m.label)}|${fmt.format(m.t)}" aria-label="Milestone M${m.n}: ${esc(m.label)}, ${fmt.format(m.t)}">
        <span class="gantt__diamond"></span><span class="gantt__msn">M${m.n}</span></button>`).join('')}
    </div></div>`;

  let delay = 0;
  for (const g of data.groups) {
    rows += `<div class="gantt__group"><span>${esc(g.label)}</span></div>`;
    for (const task of g.tasks) {
      const a = parse(task.start), b = parse(task.end) + DAY;
      const segs = subtract(a, b, breaks);
      const ww = workingWeeks(a, b);
      const tip = `${esc(task.label)}|${fmt.format(a)} – ${fmt.format(b - DAY)} · ${ww % 1 ? ww.toFixed(1) : ww} working wk${task.tag === 'tbd' ? ' · to be defined' : task.optional ? ' · optional' : ''}`;
      const bars = segs.map(([x, y]) =>
        `<span class="gantt__bar tone-${task.tone ?? 'neutral'}${task.optional ? ' is-optional' : ''}"
          style="left:${pct(x)}%;width:${pct(y) - pct(x)}%;--d:${delay}ms"></span>`).join('');
      rows += `<div class="gantt__row">
        <div class="gantt__label">${esc(task.label)}${task.tag ? ` <em>${esc(task.tag)}</em>` : ''}</div>
        <div class="gantt__track" tabindex="0" data-tip="${tip}" aria-label="${tip.replace('|', ': ')}">${bars}</div>
      </div>`;
      delay += 60;
    }
  }

  el.innerHTML = `
    <div class="gantt__scroll">
      <div class="gantt" style="--weeks:${data.weeks}">
        <div class="gantt__head">
          <div class="gantt__corner">${data.weeks} weeks${phases.length ? ` · ${phases.length} packages` : ''}</div>
          <div class="gantt__scale">${phases.length ? `<div class="gantt__phases">${phaseRow}</div>` : ''}<div class="gantt__months">${months}</div><div class="gantt__weeks">${weeks}</div></div>
        </div>
        <div class="gantt__body">
          <div class="gantt__overlay" aria-hidden="true">${overlay}</div>
          ${rows}
        </div>
      </div>
    </div>
    <div class="gantt__legend" aria-label="Legend">
      ${(data.legend ?? []).map((l) => `<span><i class="sw tone-${esc(l.tone)}"></i>${esc(l.label)}</span>`).join('')}
      <span><i class="sw is-optional"></i>Optional / to be defined</span>
      ${breaks.length ? '<span><i class="sw sw--break"></i>Holiday break</span>' : ''}
      ${bands.some((b) => b[3]) ? '<span><i class="sw sw--work"></i>Holidays · final render</span>' : ''}
      <span><i class="sw sw--ms"></i>Milestone</span>
    </div>
    <ol class="gantt__milestones">
      ${ms.map((m) => `<li><b>M${m.n}</b><time datetime="${m.date}">${fmt.format(m.t)}</time><span>${esc(m.label)}</span></li>`).join('')}
    </ol>
    <details class="gantt__table">
      <summary>Show timetable as a table</summary>
      <table>
        <thead><tr><th>Phase</th><th>Task</th><th>Start</th><th>End</th><th>Working weeks</th></tr></thead>
        <tbody>${data.groups.flatMap((g) => g.tasks.map((t) => {
          const a = parse(t.start), b = parse(t.end) + DAY;
          const ww = workingWeeks(a, b);
          return `<tr><td>${esc(g.label)}</td><td>${esc(t.label)}${t.optional ? ' (optional)' : ''}</td>
            <td>${fmt.format(a)}</td><td>${fmt.format(b - DAY)}</td><td>${ww % 1 ? ww.toFixed(1) : ww}</td></tr>`;
        })).join('')}</tbody>
      </table>
    </details>`;

  /* ---- tooltip ---- */
  const tipEl = document.createElement('div');
  tipEl.className = 'gantt__tip';
  tipEl.hidden = true;
  el.append(tipEl);
  const show = (target, x, y) => {
    const [title, sub] = target.dataset.tip.split('|');
    tipEl.innerHTML = `<b>${title}</b><span>${sub}</span>`;
    tipEl.hidden = false;
    const r = el.getBoundingClientRect();
    const w = tipEl.offsetWidth;
    tipEl.style.left = `${Math.min(Math.max(8, x - r.left + 14), r.width - w - 8)}px`;
    tipEl.style.top = `${y - r.top + 16}px`;
  };
  el.addEventListener('pointermove', (e) => {
    const t = e.target.closest('[data-tip]');
    if (t) show(t, e.clientX, e.clientY); else tipEl.hidden = true;
  });
  el.addEventListener('pointerleave', () => { tipEl.hidden = true; });
  el.addEventListener('focusin', (e) => {
    const t = e.target.closest('[data-tip]');
    if (!t) return;
    const r = t.getBoundingClientRect();
    show(t, r.left + Math.min(r.width / 2, 160), r.top + r.height / 2);
  });
  el.addEventListener('focusout', () => { tipEl.hidden = true; });

  /* ---- bars grow in when the chart scrolls into view ---- */
  const chart = el.querySelector('.gantt');
  new IntersectionObserver(([e], obs) => {
    if (e.isIntersecting) { chart.classList.add('is-in'); obs.disconnect(); }
  }, { threshold: 0.2 }).observe(chart);
}
