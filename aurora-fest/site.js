import { createTicketStage } from './stage.js';
import { priceOf } from './art.js';
import { startHolo } from './holo.js';
import { setLang, storedLang, d } from './i18n.js';
import { initMotion } from './motion.js';

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
const fmt = (n) => `₸${n.toLocaleString('en-US')}`;
const TAU = Math.PI * 2;

// ---- pass desk ----------------------------------------------------------------------------
const desk = { tier: 0, access: 0, qty: 1, phase: 'intact', fibres: 25, printLabel: 'print', back: false };
const ui = {
  status: $('#status'), statusText: $('#status-text'), tear: $('#tear-btn'), printLabel: $('#print-label'),
  print: $('#print-btn'), flip: $('#flip-btn'), flipLabel: $('#flip-label'), total: $('#total'), qty: $('#qty'),
  minus: $('#qty-minus'), plus: $('#qty-plus'), heroHint: $('#hero-hint'), sound: $('#sound-btn'),
  soundLabel: $('#sound-label'), theme: $('#theme-btn'),
};

function renderStatus() {
  const p = desk.phase;
  ui.tear.hidden = p !== 'printed';
  ui.status.dataset.state = p === 'verified' ? 'verified' : 'preview';
  let text = d('preview');
  if (p === 'printed') text = desk.qty > 1 ? d('printedN', { n: desk.qty }) : d('printed');
  else if (p === 'tearing' || p === 'detached') text = desk.fibres > 0 && desk.fibres < 25 ? d('fibres', { n: desk.fibres }) : d('tearing');
  else if (p === 'verified') text = d('verified', { date: d('dates')[desk.access] });
  ui.statusText.textContent = text;
  ui.printLabel.textContent = d(desk.printLabel);
  ui.flipLabel.textContent = d(desk.back ? 'front' : 'back');
  ui.soundLabel.textContent = d(stage.sound ? 'soundOn' : 'soundOff');
}

function onPhase(phase) {
  desk.phase = phase;
  if (phase === 'printed') { desk.printLabel = 'printAgain'; desk.fibres = 25; }
  if (phase === 'verified') {
    desk.printLabel = 'printNew';
    ui.heroHint.textContent = d('heroDone');
  }
  if (stage) renderStatus();
}
function onFibres(left) {
  desk.fibres = left;
  if (stage) renderStatus();
}

let stage = null;
stage = createTicketStage({
  canvas: $('#ticket-layer'),
  slots: [$('#slot-hero'), $('#slot-desk')],
  onPhase,
  onFibers: onFibres,
});

const motion = initMotion();
let shownTotal = priceOf(0, 0);
function refreshDesk() {
  $$('.tier-price').forEach((el) => { el.textContent = fmt(priceOf(+el.dataset.tier, desk.access)); });
  const total = priceOf(desk.tier, desk.access) * desk.qty;
  motion.counter(ui.total, shownTotal, total, fmt);
  shownTotal = total;
  ui.qty.textContent = desk.qty;
  ui.minus.disabled = desk.qty <= 1;
  ui.plus.disabled = desk.qty >= 6;
}
$$('input[name="tier"]').forEach((inp) => inp.addEventListener('change', () => {
  desk.tier = +inp.value;
  stage.setTicket(desk.tier, desk.access);
  refreshDesk();
}));
$$('input[name="access"]').forEach((inp) => inp.addEventListener('change', () => {
  desk.access = +inp.value;
  stage.setTicket(desk.tier, desk.access);
  refreshDesk();
}));
ui.minus.addEventListener('click', () => { desk.qty = Math.max(1, desk.qty - 1); refreshDesk(); });
ui.plus.addEventListener('click', () => { desk.qty = Math.min(6, desk.qty + 1); refreshDesk(); });
ui.print.addEventListener('click', () => { stage.ensureAudio(); stage.print(); });
ui.tear.addEventListener('click', () => { stage.ensureAudio(); stage.tear(); });
ui.flip.addEventListener('click', () => {
  stage.ensureAudio();
  desk.back = stage.flip();
  renderStatus();
});
ui.sound.addEventListener('click', () => {
  stage.ensureAudio();
  stage.setSound(!stage.sound);
  ui.sound.setAttribute('aria-pressed', String(stage.sound));
  renderStatus();
});
refreshDesk();

// ---- language ---------------------------------------------------------------------------------
const langBtns = $$('[data-lang]');
function applyLang(lang) {
  const l = setLang(lang);
  langBtns.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.lang === l)));
  if (desk.phase === 'verified') ui.heroHint.textContent = d('heroDone');
  renderStatus();
  mapLoop?.redraw();
  motion.onLang();
}
langBtns.forEach((b) => b.addEventListener('click', () => applyLang(b.dataset.lang)));

// ---- theme ---------------------------------------------------------------------------------------
const root = document.documentElement;
const lightMQ = matchMedia('(prefers-color-scheme: light)');
const isNight = () => (root.dataset.theme ? root.dataset.theme === 'dark' : !lightMQ.matches);
const holo = startHolo($('#holo'));
const palette = {};
function readPalette() {
  const cs = getComputedStyle(root);
  for (const k of ['accent', 'ink', 'ink-2', 'ink-3', 'line', 'line-2', 'surface', 'bg']) palette[k] = cs.getPropertyValue(`--${k}`).trim();
}
function syncTheme() {
  const night = isNight();
  ui.theme.setAttribute('aria-pressed', String(night));
  stage.setDark(night);
  holo.setDay(!night);
  readPalette();
  for (const l of loops) l.redraw();
}
ui.theme.addEventListener('click', () => { root.dataset.theme = isNight() ? 'light' : 'dark'; syncTheme(); });
lightMQ.addEventListener('change', syncTheme);
new MutationObserver(syncTheme).observe(root, { attributes: true, attributeFilter: ['data-theme'] });

// ---- stickers you can peel and move ------------------------------------------------------------
$$('.sticker').forEach((el) => {
  let id = null, sx = 0, sy = 0, ox = 0, oy = 0;
  el.addEventListener('pointerdown', (e) => {
    id = e.pointerId;
    el.setPointerCapture(id);
    sx = e.clientX - ox;
    sy = e.clientY - oy;
    el.classList.add('is-drag');
    stage.ensureAudio();
  });
  el.addEventListener('pointermove', (e) => {
    if (e.pointerId !== id) return;
    ox = e.clientX - sx;
    oy = e.clientY - sy;
    el.style.translate = `${ox}px ${oy}px`;
  });
  const end = (e) => { if (e.pointerId === id) { id = null; el.classList.remove('is-drag'); } };
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);
});

// ---- lineup tabs ---------------------------------------------------------------------------------
const tabs = $$('[role="tab"]');
function selectTab(tab, focus) {
  tabs.forEach((t) => {
    const on = t === tab;
    t.setAttribute('aria-selected', String(on));
    t.tabIndex = on ? 0 : -1;
    const panel = document.getElementById(t.getAttribute('aria-controls'));
    const wasHidden = panel.hidden;
    panel.hidden = !on;
    if (on && wasHidden) motion.tab(panel);
  });
  if (focus) tab.focus();
}
tabs.forEach((tab, i) => {
  tab.addEventListener('click', () => selectTab(tab));
  tab.addEventListener('keydown', (e) => {
    const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    selectTab(tabs[(i + step + tabs.length) % tabs.length], true);
  });
});

// ---- canvases ----------------------------------------------------------------------------------------
const loops = [];
function canvasLoop(canvas, draw) {
  if (!canvas) return null;
  const ctx = canvas.getContext('2d');
  let w = 0, h = 0, visible = false, raf = 0;
  const render = (now) => { ctx.clearRect(0, 0, w, h); draw(ctx, w, h, reduce ? 14 : now / 1000); };
  const size = () => {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    w = canvas.clientWidth;
    h = canvas.clientHeight;
    canvas.width = Math.max(1, Math.round(w * dpr));
    canvas.height = Math.max(1, Math.round(h * dpr));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    render(performance.now());
  };
  const loop = (now) => { raf = 0; if (!visible) return; render(now); if (!reduce) raf = requestAnimationFrame(loop); };
  new ResizeObserver(size).observe(canvas);
  new IntersectionObserver(([e]) => { visible = e.isIntersecting; if (visible && !raf) raf = requestAnimationFrame(loop); }).observe(canvas);
  const api = { redraw: () => { if (w) render(performance.now()); } };
  loops.push(api);
  return api;
}

// Headliner covers: one generative artwork per artist, same in both themes.
const COVERS = {
  sun(ctx, w, h, t) {
    const bg = ctx.createLinearGradient(0, 0, 0, h);
    bg.addColorStop(0, '#190a2b'); bg.addColorStop(0.55, '#6d1a57'); bg.addColorStop(1, '#ff7b5c');
    ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h);
    const cx = w * 0.5, cy = h * 0.4, r = w * 0.34;
    const sg = ctx.createLinearGradient(0, cy - r, 0, cy + r);
    sg.addColorStop(0, '#ffe37c'); sg.addColorStop(1, '#ff4f8f');
    ctx.save();
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, TAU); ctx.clip();
    ctx.fillStyle = sg; ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
    ctx.fillStyle = bg;
    for (let i = 0; i < 8; i++) {
      const k = (i / 8 + t * 0.035) % 1;
      ctx.fillRect(cx - r, cy + k * r, r * 2, 1.5 + k * 9);
    }
    ctx.restore();
    const hz = h * 0.74;
    ctx.strokeStyle = 'rgba(255, 196, 222, 0.4)';
    ctx.lineWidth = 1;
    for (let i = 0; i < 9; i++) {
      const y = hz + Math.pow(((i + (t * 0.4) % 1) / 9), 2) * (h - hz);
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
    }
    for (let i = -8; i <= 8; i++) {
      ctx.beginPath(); ctx.moveTo(cx + i * 6, hz); ctx.lineTo(cx + i * w * 0.18, h); ctx.stroke();
    }
  },
  steppe(ctx, w, h, t) {
    const bg = ctx.createLinearGradient(0, 0, 0, h);
    bg.addColorStop(0, '#03131a'); bg.addColorStop(0.5, '#0c4152'); bg.addColorStop(0.75, '#3fc6da'); bg.addColorStop(1, '#bff4ff');
    ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h);
    const mx = w * 0.7, my = h * 0.22, mr = w * 0.085;
    const glow = ctx.createRadialGradient(mx, my, mr * 0.5, mx, my, mr * 4);
    glow.addColorStop(0, 'rgba(225, 250, 255, 0.35)'); glow.addColorStop(1, 'rgba(225, 250, 255, 0)');
    ctx.fillStyle = glow; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#eafcff';
    ctx.beginPath(); ctx.arc(mx, my, mr, 0, TAU); ctx.fill();
    for (let k = 0; k < 9; k++) {
      const y0 = h * (0.5 + k * 0.058);
      ctx.beginPath();
      ctx.moveTo(0, h);
      for (let x = 0; x <= w; x += 6) {
        const y = y0 + Math.sin(x * 0.012 + k * 1.7 + t * 0.22) * (6 + k * 2.2) + Math.sin(x * 0.033 - t * 0.35 + k * 2) * 3;
        ctx.lineTo(x, y);
      }
      ctx.lineTo(w, h);
      ctx.closePath();
      const shade = 8 + k * 2;
      ctx.fillStyle = `rgb(${shade}, ${40 - k * 3}, ${52 - k * 4})`;
      ctx.fill();
      ctx.strokeStyle = `rgba(120, 230, 245, ${0.55 - k * 0.045})`;
      ctx.lineWidth = 1.2;
      ctx.stroke();
    }
  },
  orbit(ctx, w, h, t) {
    const cx = w * 0.5, cy = h * 0.38;
    const bg = ctx.createRadialGradient(cx, cy, 0, cx, cy, h * 0.8);
    bg.addColorStop(0, '#ff6aa8'); bg.addColorStop(0.28, '#5a1748'); bg.addColorStop(1, '#0a0b1c');
    ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h);
    for (let k = 0; k < 7; k++) {
      ctx.strokeStyle = `rgba(255, 255, 255, ${0.42 - k * 0.045})`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.ellipse(cx, cy, w * (0.16 + k * 0.07), w * (0.05 + k * 0.024), -0.32 + Math.sin(t * 0.18 + k) * 0.04, 0, TAU);
      ctx.stroke();
    }
    const a = t * 0.55, rx = w * 0.37, ry = w * 0.122;
    const px = cx + Math.cos(a) * rx * Math.cos(-0.32) - Math.sin(a) * ry * Math.sin(-0.32);
    const py = cy + Math.cos(a) * rx * Math.sin(-0.32) + Math.sin(a) * ry * Math.cos(-0.32);
    const dg = ctx.createRadialGradient(px, py, 0, px, py, 22);
    dg.addColorStop(0, 'rgba(255, 233, 140, 1)'); dg.addColorStop(1, 'rgba(255, 233, 140, 0)');
    ctx.fillStyle = dg; ctx.beginPath(); ctx.arc(px, py, 22, 0, TAU); ctx.fill();
    const core = ctx.createRadialGradient(cx, cy, 0, cx, cy, w * 0.11);
    core.addColorStop(0, '#fff4fa'); core.addColorStop(1, 'rgba(255, 106, 168, 0)');
    ctx.fillStyle = core; ctx.beginPath(); ctx.arc(cx, cy, w * 0.11, 0, TAU); ctx.fill();
  },
};
$$('canvas[data-cover]').forEach((c) => canvasLoop(c, COVERS[c.dataset.cover]));

// The projection dome: a slowly turning wireframe with projected "pixels" sweeping over it.
canvasLoop($('#dome-canvas'), (ctx, w, h, t) => {
  const cx = w * 0.5, cy = h * 0.66, R = Math.min(w * 0.42, h * 0.56);
  const ct = Math.cos(0.42), st = Math.sin(0.42), rot = t * 0.07;
  const P = (th, ph) => {
    const x = R * Math.cos(th) * Math.cos(ph + rot), y = -R * Math.sin(th), z = R * Math.cos(th) * Math.sin(ph + rot);
    return [cx + x, cy + y * ct + z * st * 0.5, z * ct - y * st];
  };
  ctx.lineWidth = 1;
  ctx.strokeStyle = palette['line-2'];
  for (let k = 0; k < 7; k++) {
    const th = (k / 7) * Math.PI / 2;
    for (let s = 0; s < 64; s++) {
      const a = P(th, (s / 64) * TAU), b = P(th, ((s + 1) / 64) * TAU);
      ctx.globalAlpha = a[2] > 0 ? 1 : 0.35;
      ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
    }
  }
  for (let j = 0; j < 24; j++) {
    const ph = (j / 24) * TAU;
    for (let s = 0; s < 12; s++) {
      const a = P((s / 12) * Math.PI / 2, ph), b = P(((s + 1) / 12) * Math.PI / 2, ph);
      ctx.globalAlpha = a[2] > 0 ? 1 : 0.35;
      ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
    }
  }
  ctx.fillStyle = palette.accent;
  for (let j = 1; j < 11; j++) {
    const th = (j / 11) * Math.PI / 2;
    for (let i = 0; i < 56; i++) {
      const ph = (i / 56) * TAU;
      const wave = 0.5 + 0.5 * Math.sin(ph * 3 - t * 0.9 + th * 5);
      let band = ((ph + rot - t * 0.35) % TAU + TAU) % TAU - Math.PI;
      band = Math.exp(-band * band * 1.6);
      const f = Math.min(1, wave * 0.5 + band * 0.9);
      const p = P(th, ph);
      const front = p[2] > 0;
      ctx.globalAlpha = f * (front ? 0.95 : 0.22);
      ctx.beginPath(); ctx.arc(p[0], p[1], (front ? 1.2 : 0.8) + f * (front ? 2.2 : 1), 0, TAU); ctx.fill();
    }
  }
  ctx.globalAlpha = 0.5;
  ctx.strokeStyle = palette['ink-3'];
  ctx.beginPath(); ctx.ellipse(cx, cy, R * 1.08, R * 1.08 * st * 0.5, 0, 0, TAU); ctx.stroke();
  ctx.globalAlpha = 1;
});

// The sound ring: 64 speakers from above, a source orbiting, wavefronts spreading from it.
canvasLoop($('#ring-canvas'), (ctx, w, h, t) => {
  const cx = w * 0.5, cy = h * 0.4, r = Math.min(w * 0.34, h * 0.3);
  const s = (t * 0.8) % TAU;
  ctx.lineWidth = 1;
  ctx.strokeStyle = palette['line-2'];
  for (let k = 1; k <= 3; k++) { ctx.beginPath(); ctx.arc(cx, cy, (r * k) / 3, 0, TAU); ctx.stroke(); }
  ctx.strokeStyle = palette.accent;
  for (let n = 0; n < 4; n++) {
    const age = (t * 0.7 + n / 4) % 1;
    const a = s - age * 0.56;
    ctx.globalAlpha = (1 - age) * 0.45;
    ctx.beginPath(); ctx.arc(cx + Math.cos(a) * r, cy + Math.sin(a) * r, age * r * 1.5, 0, TAU); ctx.stroke();
  }
  for (let i = 0; i < 64; i++) {
    const a = (i / 64) * TAU;
    let dd = Math.abs(a - s) % TAU;
    if (dd > Math.PI) dd = TAU - dd;
    const b = Math.exp(-dd * dd * 7);
    const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r;
    ctx.globalAlpha = 0.55;
    ctx.fillStyle = palette['ink-3'];
    ctx.beginPath(); ctx.arc(x, y, 1.6, 0, TAU); ctx.fill();
    if (b > 0.02) {
      ctx.globalAlpha = b;
      ctx.fillStyle = palette.accent;
      ctx.beginPath(); ctx.arc(x, y, 1.6 + b * 2.8, 0, TAU); ctx.fill();
    }
  }
  ctx.globalAlpha = 1;
  ctx.fillStyle = palette.ink;
  ctx.beginPath(); ctx.arc(cx, cy, 3, 0, TAU); ctx.fill();
});

// Getting there: a schematic of the city grid, the rivers, the Ile Alatau ridges and the shuttle.
const ridge = (x, k, w) => {
  const s = x / w;
  return (Math.abs(Math.sin(s * 9 + k * 1.3)) * 0.6 + Math.abs(Math.sin(s * 23 + k * 2.1)) * 0.25 + Math.sin(s * 3 + k) * 0.15);
};
const mapLoop = canvasLoop($('#map-canvas'), (ctx, w, h, t) => {
  const mono = '500 11px "Geist Mono", ui-monospace, monospace';
  ctx.lineCap = 'round';
  // city grid, slightly rotated like the real street plan
  ctx.save();
  ctx.translate(w * 0.42, h * 0.36);
  ctx.rotate(-0.1);
  ctx.strokeStyle = palette.line;
  for (let i = -16; i <= 16; i++) {
    ctx.lineWidth = i % 4 === 0 ? 2 : 1;
    ctx.globalAlpha = i % 4 === 0 ? 1 : 0.7;
    ctx.beginPath(); ctx.moveTo(i * w * 0.036, -h * 0.5); ctx.lineTo(i * w * 0.036, h * 0.42); ctx.stroke();
  }
  for (let j = -8; j <= 7; j++) {
    ctx.lineWidth = j % 3 === 0 ? 2 : 1;
    ctx.globalAlpha = j % 3 === 0 ? 1 : 0.7;
    ctx.beginPath(); ctx.moveTo(-w * 0.62, j * h * 0.062); ctx.lineTo(w * 0.62, j * h * 0.062); ctx.stroke();
  }
  ctx.restore();
  ctx.globalAlpha = 1;
  // rivers running down from the mountains
  ctx.strokeStyle = palette['ink-3'];
  ctx.globalAlpha = 0.45;
  ctx.lineWidth = 2.5;
  for (const [x0, x1, bend] of [[0.24, 0.12, 0.05], [0.58, 0.5, -0.06]]) {
    ctx.beginPath();
    ctx.moveTo(w * x0, h);
    ctx.bezierCurveTo(w * (x0 + bend), h * 0.66, w * (x1 - bend), h * 0.36, w * x1, 0);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  // mountain ridges, back to front, each one hiding what is behind it
  for (let k = 0; k < 6; k++) {
    const base = h * (0.7 + k * 0.055), amp = h * (0.16 - k * 0.012);
    ctx.beginPath();
    ctx.moveTo(0, h);
    for (let x = 0; x <= w; x += 4) ctx.lineTo(x, base - ridge(x, k, w) * amp);
    ctx.lineTo(w, h);
    ctx.closePath();
    ctx.fillStyle = palette.surface;
    ctx.fill();
    ctx.strokeStyle = palette['ink-3'];
    ctx.globalAlpha = 0.75 - k * 0.1;
    ctx.lineWidth = 1.2;
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
  // shuttle route
  const A = [w * 0.27, h * 0.3], D = [w * 0.73, h * 0.62];
  const C1 = [w * 0.42, h * 0.62], C2 = [w * 0.6, h * 0.28];
  ctx.strokeStyle = palette.accent;
  ctx.lineWidth = 2.5;
  ctx.setLineDash([2, 9]);
  ctx.lineDashOffset = -t * 24;
  ctx.beginPath(); ctx.moveTo(A[0], A[1]); ctx.bezierCurveTo(C1[0], C1[1], C2[0], C2[1], D[0], D[1]); ctx.stroke();
  ctx.setLineDash([]);
  const u = (t * 0.12) % 1, v = 1 - u;
  const bx = v * v * v * A[0] + 3 * v * v * u * C1[0] + 3 * v * u * u * C2[0] + u * u * u * D[0];
  const by = v * v * v * A[1] + 3 * v * v * u * C1[1] + 3 * v * u * u * C2[1] + u * u * u * D[1];
  ctx.fillStyle = palette.accent;
  ctx.beginPath(); ctx.arc(bx, by, 5, 0, TAU); ctx.fill();
  ctx.font = mono;
  ctx.fillStyle = palette['ink-2'];
  ctx.textAlign = 'left';
  ctx.fillText(d('mapShuttle'), bx + 10, by - 8);
  // city centre
  ctx.fillStyle = palette.ink;
  ctx.fillRect(A[0] - 6, A[1] - 6, 12, 12);
  ctx.font = '600 14px "Geist", ui-sans-serif, sans-serif';
  ctx.fillText(d('mapCentre'), A[0] + 14, A[1] + 5);
  // the dome with a pulse
  for (let n = 0; n < 2; n++) {
    const age = (t * 0.6 + n * 0.5) % 1;
    ctx.strokeStyle = palette.accent;
    ctx.globalAlpha = 1 - age;
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(D[0], D[1], 10 + age * 34, 0, TAU); ctx.stroke();
  }
  ctx.globalAlpha = 1;
  ctx.fillStyle = palette.accent;
  ctx.beginPath(); ctx.arc(D[0], D[1], 9, 0, TAU); ctx.fill();
  ctx.fillStyle = palette.bg;
  ctx.beginPath(); ctx.arc(D[0], D[1], 3.5, 0, TAU); ctx.fill();
  ctx.fillStyle = palette.ink;
  ctx.font = '800 22px "Fira Sans Extra Condensed", "Geist", sans-serif';
  ctx.fillText('ORBITA DOME', D[0] + 20, D[1] + 8);
  // mountains label and north arrow
  ctx.font = mono;
  ctx.fillStyle = palette['ink-3'];
  if ('letterSpacing' in ctx) ctx.letterSpacing = '3px';
  ctx.fillText(d('mapMountains'), w * 0.06, h - 18);
  if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
  ctx.textAlign = 'center';
  ctx.fillStyle = palette.ink;
  ctx.fillText('N', w - 34, 30);
  ctx.strokeStyle = palette.ink;
  ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(w - 34, 58); ctx.lineTo(w - 34, 38); ctx.moveTo(w - 39, 44); ctx.lineTo(w - 34, 38); ctx.lineTo(w - 29, 44); ctx.stroke();
});

// ---- boot --------------------------------------------------------------------------------------------
syncTheme();
applyLang(storedLang());
document.fonts?.ready?.then(() => { for (const l of loops) l.redraw(); });
