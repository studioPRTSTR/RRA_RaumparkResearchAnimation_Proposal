/* ==========================================================================
   main.js — page bootstrap: theme, storyboard, timetable
   ========================================================================== */

import { initGantt } from './gantt.js';
import { initStoryboard } from './storyboard.js';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/* ---- theme toggle (light / dark, remembered per browser) ---- */
function initTheme() {
  const btn = document.querySelector('#theme-toggle');
  const root = document.documentElement;
  let stored = null;
  try { stored = localStorage.getItem('rpv-theme'); } catch { /* storage unavailable */ }
  const forced = new URLSearchParams(location.search).get('theme'); // ?theme=light|dark
  if (forced === 'light' || forced === 'dark') stored = forced;
  if (stored) root.dataset.theme = stored;
  const current = () => root.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  const sync = () => {
    const t = current();
    btn.setAttribute('aria-label', `Switch to ${t === 'dark' ? 'light' : 'dark'} mode`);
    btn.querySelector('span').textContent = t === 'dark' ? 'Light' : 'Dark';
    document.dispatchEvent(new Event('themechange'));
  };
  btn.addEventListener('click', () => {
    root.dataset.theme = current() === 'dark' ? 'light' : 'dark';
    try { localStorage.setItem('rpv-theme', root.dataset.theme); } catch { /* ignore */ }
    sync();
  });
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', sync);
  sync();
}

/* ---- reveal-on-scroll (skipped entirely with reduced motion via CSS) ---- */
const revealObserver = 'IntersectionObserver' in window
  ? new IntersectionObserver((entries) => {
    for (const e of entries) if (e.isIntersecting) { e.target.classList.add('is-in'); revealObserver.unobserve(e.target); }
  }, { rootMargin: '0px 0px -8% 0px' })
  : null;
function observeReveals(scope = document) {
  scope.querySelectorAll('.reveal:not(.is-in)').forEach((n) => (revealObserver ? revealObserver.observe(n) : n.classList.add('is-in')));
}

/* ---- highlight the current section in the nav ---- */
function initNav() {
  const links = [...document.querySelectorAll('.nav a[href^="#"]')];
  const map = new Map(links.map((a) => [a.getAttribute('href').slice(1), a]));
  const obs = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      links.forEach((a) => a.removeAttribute('aria-current'));
      map.get(e.target.id)?.setAttribute('aria-current', 'true');
    }
  }, { rootMargin: '-45% 0px -50% 0px' });
  map.forEach((_, id) => { const s = document.getElementById(id); if (s) obs.observe(s); });
}

function loadError(el, err) {
  console.error(err);
  el.innerHTML = `<p class="load-error">Could not load data (${esc(err.message)}). Open the page through a local server, e.g. VS Code “Live Server”, not as a file:// URL.</p>`;
}

initTheme();
initNav();
observeReveals();
const boardEl = document.querySelector('#storyboard-board');
initStoryboard(boardEl, 'data/storyboard.json').then(() => observeReveals(boardEl)).catch((e) => loadError(boardEl, e));
const ganttEl = document.querySelector('#gantt');
initGantt(ganttEl, 'data/timeline.json').catch((e) => loadError(ganttEl, e));
