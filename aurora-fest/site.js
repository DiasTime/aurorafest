import { createTicketStage } from './stage.js';
import { priceOf } from './art.js';
import { startAurora } from './aurora.js';

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
const fmt = (n) => `₸${n.toLocaleString('en-US')}`;
const NIGHT_LINE = ['December 11', 'Friday, December 11', 'Saturday, December 12', 'Sunday, December 13'];

// ---- the pass desk state --------------------------------------------------------------------
const desk = { tier: 0, access: 0, qty: 1, printed: false };
const ui = {
  status: $('#status'), statusText: $('#status-text'), tear: $('#tear-btn'), print: $('#print-btn'),
  flip: $('#flip-btn'), total: $('#total'), qty: $('#qty'), minus: $('#qty-minus'), plus: $('#qty-plus'),
  heroHint: $('#hero-hint'), sound: $('#sound-btn'), theme: $('#theme-btn'),
};

function setStatus(text, state = 'preview') {
  ui.statusText.textContent = text;
  ui.status.dataset.state = state;
}

function onPhase(phase) {
  ui.tear.hidden = phase !== 'printed';
  if (phase === 'intact') {
    setStatus('This is a live preview. Print it to watch it come off the press.');
  } else if (phase === 'printed') {
    setStatus(desk.qty > 1 ? `${desk.qty} passes printed. Tear a stub to check in at the gate.` : 'Printed. Tear the stub to check in at the gate.');
    setPrintLabel('Print again');
  } else if (phase === 'tearing' || phase === 'detached') {
    setStatus('Checking in at Gate 01.');
  } else if (phase === 'verified') {
    setStatus(`Checked in. See you on ${NIGHT_LINE[desk.access]}.`, 'verified');
    setPrintLabel('Print a new pass');
    ui.heroHint.textContent = 'Checked in. Print a new pass in the pass desk.';
  }
}
function onFibers(left) {
  if (left > 0 && left < 25) setStatus(`Checking in at Gate 01. ${left} of 25 fibres left.`);
}
function setPrintLabel(text) {
  ui.print.firstChild.textContent = `${text} `;
}

const stage = createTicketStage({
  canvas: $('#ticket-layer'),
  slots: [$('#slot-hero'), $('#slot-desk')],
  onPhase,
  onFibers,
});

function refreshDesk() {
  $$('.tier-price').forEach((el) => { el.textContent = fmt(priceOf(+el.dataset.tier, desk.access)); });
  ui.total.textContent = fmt(priceOf(desk.tier, desk.access) * desk.qty);
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
  ui.flip.textContent = stage.flip() ? 'See the front' : 'See the back';
});
refreshDesk();

// ---- sound and theme ----------------------------------------------------------------------------
ui.sound.addEventListener('click', () => {
  stage.ensureAudio();
  stage.setSound(!stage.sound);
  ui.sound.setAttribute('aria-pressed', String(stage.sound));
  ui.sound.textContent = stage.sound ? 'Sound on' : 'Sound off';
});

const root = document.documentElement;
const lightMQ = matchMedia('(prefers-color-scheme: light)');
const isNight = () => (root.dataset.theme ? root.dataset.theme === 'dark' : !lightMQ.matches);
const aurora = startAurora($('#aurora'));
const palette = {};
function readPalette() {
  const cs = getComputedStyle(root);
  for (const k of ['accent', 'ink', 'ink-3', 'line-2']) palette[k] = cs.getPropertyValue(`--${k}`).trim();
}
function syncTheme() {
  const night = isNight();
  ui.theme.setAttribute('aria-pressed', String(night));
  stage.setDark(night);
  aurora.setDay(!night);
  readPalette();
}
ui.theme.addEventListener('click', () => { root.dataset.theme = isNight() ? 'light' : 'dark'; syncTheme(); });
lightMQ.addEventListener('change', syncTheme);
new MutationObserver(syncTheme).observe(root, { attributes: true, attributeFilter: ['data-theme'] });
syncTheme();

// ---- lineup tabs ------------------------------------------------------------------------------------
const tabs = $$('[role="tab"]');
function selectTab(tab, focus) {
  tabs.forEach((t) => {
    const on = t === tab;
    t.setAttribute('aria-selected', String(on));
    t.tabIndex = on ? 0 : -1;
    document.getElementById(t.getAttribute('aria-controls')).hidden = !on;
  });
  if (focus) tab.focus();
}
tabs.forEach((tab, i) => {
  tab.addEventListener('click', () => selectTab(tab));
  tab.addEventListener('keydown', (e) => {
    const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (!d) return;
    e.preventDefault();
    selectTab(tabs[(i + d + tabs.length) % tabs.length], true);
  });
});

// ---- bento canvases -------------------------------------------------------------------------------------
function canvasLoop(canvas, draw) {
  const ctx = canvas.getContext('2d');
  let w = 0, h = 0, visible = false, raf = 0;
  const render = (now) => { ctx.clearRect(0, 0, w, h); draw(ctx, w, h, reduce ? 14 : now / 1000); };
  const size = () => {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    w = canvas.clientWidth; h = canvas.clientHeight;
    canvas.width = Math.max(1, Math.round(w * dpr));
    canvas.height = Math.max(1, Math.round(h * dpr));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    render(performance.now());
  };
  const loop = (now) => { raf = 0; if (!visible) return; render(now); if (!reduce) raf = requestAnimationFrame(loop); };
  new ResizeObserver(size).observe(canvas);
  new IntersectionObserver(([e]) => { visible = e.isIntersecting; if (visible && !raf) raf = requestAnimationFrame(loop); }).observe(canvas);
}

// The projection dome: a slowly turning wireframe with "pixels" of projected image sweeping over it.
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
      const a = P(th, (s / 64) * Math.PI * 2), b = P(th, ((s + 1) / 64) * Math.PI * 2);
      ctx.globalAlpha = a[2] > 0 ? 1 : 0.35;
      ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
    }
  }
  for (let j = 0; j < 24; j++) {
    const ph = (j / 24) * Math.PI * 2;
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
      const ph = (i / 56) * Math.PI * 2;
      const wave = 0.5 + 0.5 * Math.sin(ph * 3 - t * 0.9 + th * 5);
      let band = ((ph + rot - t * 0.35) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
      band = Math.exp(-band * band * 1.6);
      const f = Math.min(1, wave * 0.5 + band * 0.9);
      const p = P(th, ph);
      const front = p[2] > 0;
      ctx.globalAlpha = f * (front ? 0.95 : 0.22);
      ctx.beginPath(); ctx.arc(p[0], p[1], (front ? 1.2 : 0.8) + f * (front ? 2.2 : 1), 0, Math.PI * 2); ctx.fill();
    }
  }
  ctx.globalAlpha = 0.5;
  ctx.strokeStyle = palette['ink-3'];
  ctx.beginPath(); ctx.ellipse(cx, cy, R * 1.08, R * 1.08 * st * 0.5, 0, 0, Math.PI * 2); ctx.stroke();
  ctx.globalAlpha = 1;
});

// The sound ring: 64 speakers seen from above, a source orbiting, wavefronts spreading from it.
canvasLoop($('#ring-canvas'), (ctx, w, h, t) => {
  const cx = w * 0.5, cy = h * 0.4, r = Math.min(w * 0.34, h * 0.3);
  const s = (t * 0.8) % (Math.PI * 2);
  ctx.lineWidth = 1;
  ctx.strokeStyle = palette['line-2'];
  for (let k = 1; k <= 3; k++) { ctx.beginPath(); ctx.arc(cx, cy, (r * k) / 3, 0, Math.PI * 2); ctx.stroke(); }
  ctx.strokeStyle = palette.accent;
  for (let n = 0; n < 4; n++) {
    const age = (t * 0.7 + n / 4) % 1;
    const a = s - age * 0.56;
    ctx.globalAlpha = (1 - age) * 0.4;
    ctx.beginPath(); ctx.arc(cx + Math.cos(a) * r, cy + Math.sin(a) * r, age * r * 1.5, 0, Math.PI * 2); ctx.stroke();
  }
  for (let i = 0; i < 64; i++) {
    const a = (i / 64) * Math.PI * 2;
    let d = Math.abs(a - s) % (Math.PI * 2);
    if (d > Math.PI) d = Math.PI * 2 - d;
    const b = Math.exp(-d * d * 7);
    const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r;
    ctx.globalAlpha = 0.55;
    ctx.fillStyle = palette['ink-3'];
    ctx.beginPath(); ctx.arc(x, y, 1.6, 0, Math.PI * 2); ctx.fill();
    if (b > 0.02) {
      ctx.globalAlpha = b;
      ctx.fillStyle = palette.accent;
      ctx.beginPath(); ctx.arc(x, y, 1.6 + b * 2.8, 0, Math.PI * 2); ctx.fill();
    }
  }
  ctx.globalAlpha = 1;
  ctx.fillStyle = palette.ink;
  ctx.beginPath(); ctx.arc(cx, cy, 3, 0, Math.PI * 2); ctx.fill();
});
