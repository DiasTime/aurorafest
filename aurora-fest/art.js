// Festival pass artwork drawn in Canvas 2D. Produces front and back albedo (alpha = die cut and
// perforation holes) and one foil mask: red channel = front foil, green channel = back foil.
import { ROWS, SEAM_ROW } from './sim.js';

export const TEX_W = 1024;
export const TEX_H = 2005;
const ROW_PX = TEX_H / (ROWS - 1);
const SEAM_Y = (SEAM_ROW + 0.5) * ROW_PX;
const BODY_END = SEAM_ROW * ROW_PX;
const STUB_TOP = (SEAM_ROW + 1) * ROW_PX;
const M = 44;

// stock: index into the audio module's paper tones (0 pearl card, 1 heavy obsidian, 2 laminated cobalt)
export const TIERS = [
  {
    name: 'CIRCUIT PASS', short: 'Circuit', code: '01', zone: 'MAIN FLOOR AND DOME', arc: null, ring: 1,
    paper: '#ecece7', paper2: '#e1e2dd', ink: '#1a1c20', ink2: '#5b5f66', foilMode: 0, stock: 0,
    prices: [48500, 19000, 19000, 19000],
  },
  {
    name: 'PRISM PASS', short: 'Prism', code: '02', zone: 'RESERVED RING SEAT', arc: [-118, -62], ring: 4,
    paper: '#172259', paper2: '#1e2b6a', ink: '#e4e9ff', ink2: '#9aa6d8', foilMode: 2, stock: 2,
    prices: [76000, 31000, 31000, 31000],
  },
  {
    name: 'FOUNDERS PASS', short: 'Founders', code: '03', zone: 'BALCONY BOX AND LOUNGE', arc: [62, 118], ring: 5,
    paper: '#151517', paper2: '#1e1e21', ink: '#ece5d2', ink2: '#9d978a', foilMode: 1, stock: 1,
    prices: [112000, 45000, 45000, 45000],
  },
];

export const ACCESS = [
  { label: 'ALL THREE NIGHTS', stub: '3-NIGHT PASS', date: 'DEC 11-13, 2026', dateSub: 'DOORS 18:00 EACH NIGHT', code: 'X3', stamp: '1112-1312' },
  { label: 'FRIDAY NIGHT', stub: 'FRI, DEC 11', date: 'FRI, DEC 11, 2026', dateSub: 'DOORS 18:00, GATE 01', code: 'D1', stamp: '1112' },
  { label: 'SATURDAY NIGHT', stub: 'SAT, DEC 12', date: 'SAT, DEC 12, 2026', dateSub: 'DOORS 18:00, GATE 01', code: 'D2', stamp: '1212' },
  { label: 'SUNDAY NIGHT', stub: 'SUN, DEC 13', date: 'SUN, DEC 13, 2026', dateSub: 'DOORS 18:00, GATE 01', code: 'D3', stamp: '1312' },
];

export const priceOf = (t, a) => TIERS[t].prices[a];
export const formatKzt = (n) => `KZT ${n.toLocaleString('en-US')}`;
export const serialFor = (t, a) => `AC-${TIERS[t].code}-${ACCESS[a].code}-4K`;

const make = () => { const c = document.createElement('canvas'); c.width = TEX_W; c.height = TEX_H; return c; };
export const canvases = { front: make(), back: make(), mask: make(), mFront: make(), mBack: make() };

function rng(seed) {
  let a = seed >>> 0;
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

function text(ctx, str, x, y, { font, color, align = 'left', spacing = 0 }) {
  ctx.font = font;
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = 'alphabetic';
  if ('letterSpacing' in ctx) ctx.letterSpacing = `${spacing}px`;
  ctx.fillText(str, x, y);
  if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
}

function fitText(ctx, str, x, y, maxW, opts) {
  let size = opts.size;
  ctx.font = `${opts.weight} ${size}px ${opts.family}`;
  if ('letterSpacing' in ctx) ctx.letterSpacing = `${opts.spacing || 0}px`;
  const w = ctx.measureText(str).width;
  if (w > maxW) size = Math.floor(size * maxW / w);
  text(ctx, str, x, y, { ...opts, font: `${opts.weight} ${size}px ${opts.family}` });
}

function rrect(ctx, x, y, w, h, r, begin = true) {
  if (begin) ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

const SANS = '"Geist", ui-sans-serif, system-ui, sans-serif';
const MONO = '"Geist Mono", ui-monospace, monospace';

function paper(ctx, t, seed) {
  ctx.clearRect(0, 0, TEX_W, TEX_H);
  ctx.fillStyle = t.paper;
  ctx.fillRect(0, 0, TEX_W, TEX_H);
  const r = rng(seed);
  ctx.globalAlpha = 0.05;
  ctx.strokeStyle = t.ink2;
  ctx.lineWidth = 1;
  for (let i = 0; i < 900; i++) {
    const x = r() * TEX_W, y = r() * TEX_H, a = r() * Math.PI, l = 6 + r() * 18;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.quadraticCurveTo(x + Math.cos(a) * l * 0.5 + (r() - 0.5) * 6, y + Math.sin(a) * l * 0.5, x + Math.cos(a) * l, y + Math.sin(a) * l);
    ctx.stroke();
  }
  ctx.globalAlpha = 0.07;
  ctx.fillStyle = t.paper2;
  for (let i = 0; i < 14000; i++) ctx.fillRect(r() * TEX_W, r() * TEX_H, 1.6, 1.6);
  ctx.globalAlpha = 0.08;
  ctx.fillStyle = t.ink2;
  ctx.fillRect(0, BODY_END, TEX_W, STUB_TOP - BODY_END);
  ctx.globalAlpha = 1;
}

function dieCut(ctx) {
  ctx.save();
  ctx.globalCompositeOperation = 'destination-out';
  ctx.beginPath();
  ctx.rect(-2, -2, TEX_W + 4, TEX_H + 4);
  rrect(ctx, 0, 0, TEX_W, TEX_H, 34, false);
  ctx.fill('evenodd');
  ctx.beginPath();
  ctx.arc(0, SEAM_Y, 24, 0, Math.PI * 2);
  ctx.arc(TEX_W, SEAM_Y, 24, 0, Math.PI * 2);
  ctx.fill();
  for (let x = 46; x < TEX_W - 40; x += 23) {
    ctx.beginPath();
    ctx.ellipse(x, SEAM_Y, 5.2, 4.2, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function frames(ctx, t) {
  ctx.strokeStyle = t.ink;
  ctx.globalAlpha = 0.5;
  ctx.lineWidth = 1.5;
  rrect(ctx, M, M, TEX_W - 2 * M, BODY_END - M - 26, 14); ctx.stroke();
  rrect(ctx, M, STUB_TOP + 22, TEX_W - 2 * M, TEX_H - STUB_TOP - 22 - M, 14); ctx.stroke();
  ctx.globalAlpha = 1;
}

function crosshair(ctx, x, y, color) {
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(x, y, 11, 0, Math.PI * 2);
  ctx.moveTo(x - 20, y); ctx.lineTo(x + 20, y);
  ctx.moveTo(x, y - 20); ctx.lineTo(x, y + 20);
  ctx.stroke();
}

function guilloche(ctx, cx, cy, R, lw) {
  ctx.lineWidth = lw;
  ctx.beginPath();
  for (let k = 0; k < 44; k++) {
    const rot = (k * Math.PI) / 44;
    ctx.moveTo(cx + R * Math.cos(rot), cy + R * Math.sin(rot));
    ctx.ellipse(cx, cy, R, R * 0.29, rot, 0, Math.PI * 2);
  }
  ctx.stroke();
  ctx.beginPath();
  for (let k = 0; k < 36; k++) {
    const a = (k * Math.PI * 2) / 36, rr = R * 0.36;
    const ox = cx + Math.cos(a) * rr, oy = cy + Math.sin(a) * rr;
    ctx.moveTo(ox + rr, oy);
    ctx.arc(ox, oy, rr, 0, Math.PI * 2);
  }
  ctx.stroke();
  for (let p = 0; p < 6; p++) {
    ctx.beginPath();
    for (let i = 0; i <= 720; i++) {
      const a = (i / 720) * Math.PI * 2;
      const rr = R * (1.08 + 0.045 * Math.sin(24 * a + p * 0.52));
      const x = cx + Math.cos(a) * rr, y = cy + Math.sin(a) * rr;
      i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    }
    ctx.stroke();
  }
}

function qrCode(ctx, x, y, size, seed, ink, bg) {
  const n = 25, m = size / n, r = rng(seed);
  const g = Array.from({ length: n }, () => Array.from({ length: n }, () => r() > 0.52));
  const finder = (ox, oy) => {
    for (let i = -1; i < 8; i++) for (let j = -1; j < 8; j++) {
      const gx = ox + i, gy = oy + j;
      if (gx < 0 || gy < 0 || gx >= n || gy >= n) continue;
      const edge = i === 0 || i === 6 || j === 0 || j === 6;
      const core = i >= 2 && i <= 4 && j >= 2 && j <= 4;
      g[gy][gx] = i >= 0 && i <= 6 && j >= 0 && j <= 6 && (edge || core);
    }
  };
  finder(0, 0); finder(n - 7, 0); finder(0, n - 7);
  for (let i = 8; i < n - 8; i++) { g[6][i] = i % 2 === 0; g[i][6] = i % 2 === 0; }
  for (let i = -2; i <= 2; i++) for (let j = -2; j <= 2; j++) g[n - 7 + j][n - 7 + i] = Math.max(Math.abs(i), Math.abs(j)) !== 1;
  ctx.fillStyle = bg;
  ctx.fillRect(x - 12, y - 12, size + 24, size + 24);
  ctx.fillStyle = ink;
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) if (g[j][i]) ctx.fillRect(x + i * m, y + j * m, m + 0.4, m + 0.4);
}

function barcode(ctx, x, y, w, h, seed, ink) {
  const r = rng(seed);
  ctx.fillStyle = ink;
  let cx = x;
  while (cx < x + w) {
    const bw = 1.6 + Math.floor(r() * 4) * 1.8;
    if (cx + bw > x + w) break;
    ctx.fillRect(cx, y, bw, h);
    cx += bw + 1.8 + Math.floor(r() * 3) * 1.8;
  }
}

function cell(ctx, t, x, y, label, value, sub) {
  text(ctx, label, x + 20, y + 34, { font: `500 15px ${MONO}`, color: t.ink2, spacing: 2 });
  fitText(ctx, value, x + 20, y + 78, 390, { weight: 700, size: 31, family: SANS, color: t.ink, spacing: -0.5 });
  text(ctx, sub, x + 20, y + 106, { font: `500 14px ${MONO}`, color: t.ink2, spacing: 1 });
}

function drawFront(t, a, ti, ai) {
  const ctx = canvases.front.getContext('2d');
  const mk = canvases.mFront.getContext('2d');
  const price = formatKzt(priceOf(ti, ai));
  const serial = serialFor(ti, ai);
  paper(ctx, t, 11);
  mk.fillStyle = '#000';
  mk.fillRect(0, 0, TEX_W, TEX_H);
  const FOIL = '#f00';
  frames(ctx, t);

  const bx = M + 12, by = M + 12, bw = TEX_W - 2 * M - 24, bh = 56;
  ctx.fillStyle = t.paper2;
  rrect(ctx, bx, by, bw, bh, 8); ctx.fill();
  mk.fillStyle = FOIL;
  rrect(mk, bx, by, bw, bh, 8); mk.fill();
  for (const c of [ctx, mk]) {
    const col = c === mk ? '#000' : t.ink;
    text(c, 'ADMIT ONE  /  FESTIVAL PASS', bx + 20, by + 36, { font: `600 19px ${MONO}`, color: col, spacing: 2 });
    text(c, `${t.code}  ${t.name}`, bx + bw - 20, by + 36, { font: `600 19px ${MONO}`, color: col, align: 'right', spacing: 2 });
  }
  text(ctx, 'ISSUER  ATELIER ORBITA, ALMATY', M + 14, 160, { font: `500 16px ${MONO}`, color: t.ink2, spacing: 1.5 });
  text(ctx, 'STOCK  350GSM PRISMATIC LAMINATE', TEX_W - M - 14, 160, { font: `500 16px ${MONO}`, color: t.ink2, align: 'right', spacing: 1.5 });

  const cx = TEX_W / 2, cy = 470;
  mk.strokeStyle = FOIL;
  guilloche(mk, cx, cy, 214, 2.6);
  mk.fillStyle = FOIL;
  mk.beginPath(); mk.arc(cx, cy, 34, 0, Math.PI * 2); mk.fill();
  ctx.strokeStyle = t.ink;
  ctx.globalAlpha = 0.16;
  guilloche(ctx, cx, cy, 214, 1.3);
  ctx.globalAlpha = 0.55;
  ctx.lineWidth = 1.2;
  for (let i = 0; i < 120; i++) {
    const ang = (i / 120) * Math.PI * 2, r0 = 262, r1 = i % 10 === 0 ? 280 : 270;
    ctx.beginPath(); ctx.moveTo(cx + Math.cos(ang) * r0, cy + Math.sin(ang) * r0); ctx.lineTo(cx + Math.cos(ang) * r1, cy + Math.sin(ang) * r1); ctx.stroke();
  }
  ctx.globalAlpha = 0.7;
  for (const [x, y] of [[112, 238], [TEX_W - 112, 238], [112, 702], [TEX_W - 112, 702]]) crosshair(ctx, x, y, t.ink);
  ctx.globalAlpha = 1;

  text(ctx, 'AUDIOVISUAL MUSIC FESTIVAL, EDITION IV', cx, 808, { font: `500 16px ${MONO}`, color: t.ink2, align: 'center', spacing: 3 });
  fitText(ctx, 'AURORA CIRCUIT', cx, 902, 860, { weight: 800, size: 112, family: SANS, color: t.ink, align: 'center', spacing: -3 });
  text(ctx, 'THREE NIGHTS  /  ORBITA DOME  /  ALMATY KZ', cx, 950, { font: `600 21px ${MONO}`, color: t.ink, align: 'center', spacing: 4 });

  const gx = M + 12, gy = 994, gw = TEX_W - 2 * M - 24, ch = 124;
  ctx.strokeStyle = t.ink;
  ctx.globalAlpha = 0.55;
  ctx.lineWidth = 1.5;
  ctx.strokeRect(gx, gy, gw, ch * 2);
  ctx.beginPath();
  ctx.moveTo(gx + gw / 2, gy); ctx.lineTo(gx + gw / 2, gy + ch * 2);
  ctx.moveTo(gx, gy + ch); ctx.lineTo(gx + gw, gy + ch);
  ctx.stroke();
  ctx.globalAlpha = 1;
  cell(ctx, t, gx, gy, 'VENUE', 'ORBITA DOME 360', 'MEDEU DISTRICT, ALMATY');
  cell(ctx, t, gx + gw / 2, gy, 'DATES', a.date, a.dateSub);
  cell(ctx, t, gx, gy + ch, 'ACCESS', a.label, t.zone);
  cell(ctx, t, gx + gw / 2, gy + ch, 'TARIFF', `${price} INCL.`, `SERIAL ${serial}`);

  const px = gx, py = 1290;
  ctx.fillStyle = t.paper2;
  rrect(ctx, px, py, 150, 96, 12); ctx.fill();
  mk.fillStyle = FOIL;
  rrect(mk, px, py, 150, 96, 12); mk.fill();
  for (const c of [ctx, mk]) {
    text(c, 'AO', px + 75, py + 66, { font: `800 50px ${SANS}`, color: c === mk ? '#600' : t.ink, align: 'center', spacing: -2 });
  }
  text(ctx, 'GENUINE ATELIER STOCK', px + 176, py + 34, { font: `600 16px ${MONO}`, color: t.ink, spacing: 2 });
  text(ctx, 'Diffraction foil shifts with the angle of the paper.', px + 176, py + 62, { font: `400 17px ${SANS}`, color: t.ink2 });
  text(ctx, 'Void if copied or detached before the gate.', px + 176, py + 86, { font: `400 17px ${SANS}`, color: t.ink2 });

  mk.fillStyle = FOIL;
  mk.fillRect(gx, 1414, gw, 26);
  const micro = 'AURORA CIRCUIT  ORBITA DOME  ALMATY  ';
  for (const c of [ctx, mk]) {
    c.save();
    c.beginPath(); c.rect(gx, 1414, gw, 26); c.clip();
    text(c, micro.repeat(6), gx + 6, 1432, { font: `600 11px ${MONO}`, color: c === mk ? '#000' : t.ink2, spacing: 2 });
    c.restore();
  }
  text(ctx, 'TEAR ALONG THE PERFORATION TO CHECK IN', cx, BODY_END - 30, { font: `500 15px ${MONO}`, color: t.ink2, align: 'center', spacing: 2.5 });
  ctx.fillStyle = t.ink2;
  for (const sx of [cx - 370, cx + 370]) {
    ctx.beginPath(); ctx.moveTo(sx - 7, BODY_END - 42); ctx.lineTo(sx + 7, BODY_END - 42); ctx.lineTo(sx, BODY_END - 32); ctx.fill();
  }

  const sy = STUB_TOP + 44;
  qrCode(ctx, M + 34, sy + 14, 246, 97 + ti * 13 + ai * 7, t.ink, t.paper);
  const tx = M + 316;
  text(ctx, 'DETACHABLE STUB  /  ADMIT ONE', tx, sy + 34, { font: `500 15px ${MONO}`, color: t.ink2, spacing: 2 });
  fitText(ctx, a.stub, tx, sy + 92, TEX_W - M - 30 - tx, { weight: 800, size: 50, family: SANS, color: t.ink, spacing: -1.5 });
  text(ctx, `${t.name}  ${price}`, tx, sy + 128, { font: `500 16px ${MONO}`, color: t.ink2, spacing: 1.5 });
  barcode(ctx, tx, sy + 150, TEX_W - M - 30 - tx, 104, 31 + ai * 3 + ti, t.ink);
  text(ctx, `${serial}  ALA  ${a.stamp}`, tx, sy + 282, { font: `500 14px ${MONO}`, color: t.ink2, spacing: 2 });
  mk.fillStyle = FOIL;
  mk.fillRect(M + 20, TEX_H - M - 30, TEX_W - 2 * M - 40, 10);

  dieCut(ctx);
}

function drawBack(t, a, ti) {
  const ctx = canvases.back.getContext('2d');
  const mk = canvases.mBack.getContext('2d');
  paper(ctx, t, 23);
  mk.fillStyle = '#000';
  mk.fillRect(0, 0, TEX_W, TEX_H);
  const FOIL = '#0f0';
  const cx = TEX_W / 2, cy = 520;
  frames(ctx, t);
  text(ctx, 'REVERSE  /  DOME MAP AND SEAL', cx, 108, { font: `600 17px ${MONO}`, color: t.ink2, align: 'center', spacing: 3 });

  ctx.strokeStyle = t.ink;
  ctx.lineWidth = 1.5;
  for (let i = 1; i <= 5; i++) {
    ctx.globalAlpha = i === 5 ? 0.7 : 0.35;
    ctx.beginPath(); ctx.arc(cx, cy, i * 60, 0, Math.PI * 2); ctx.stroke();
  }
  ctx.globalAlpha = 0.25;
  for (let k = 0; k < 12; k++) {
    const ang = (k / 12) * Math.PI * 2;
    ctx.beginPath(); ctx.moveTo(cx + Math.cos(ang) * 30, cy + Math.sin(ang) * 30); ctx.lineTo(cx + Math.cos(ang) * 300, cy + Math.sin(ang) * 300); ctx.stroke();
  }
  ctx.globalAlpha = 0.6;
  for (let i = 0; i < 72; i++) {
    const ang = (i / 72) * Math.PI * 2, r1 = i % 6 === 0 ? 322 : 312;
    ctx.beginPath(); ctx.moveTo(cx + Math.cos(ang) * 304, cy + Math.sin(ang) * 304); ctx.lineTo(cx + Math.cos(ang) * r1, cy + Math.sin(ang) * r1); ctx.stroke();
  }
  ctx.globalAlpha = 1;
  ctx.fillStyle = t.ink;
  ctx.beginPath(); ctx.arc(cx, cy, 34, Math.PI * 1.25, Math.PI * 1.75); ctx.arc(cx, cy, 14, Math.PI * 1.75, Math.PI * 1.25, true); ctx.fill();
  text(ctx, 'STAGE', cx, cy - 342, { font: `600 15px ${MONO}`, color: t.ink2, align: 'center', spacing: 3 });
  for (const c of [ctx, mk]) {
    const foil = c === mk;
    c.strokeStyle = foil ? FOIL : t.ink;
    c.fillStyle = foil ? FOIL : t.ink;
    c.globalAlpha = foil ? 1 : 0.35;
    if (t.arc) {
      c.lineWidth = 30;
      c.lineCap = 'round';
      c.beginPath();
      c.arc(cx, cy, t.ring * 60 - 30, (t.arc[0] * Math.PI) / 180, (t.arc[1] * Math.PI) / 180);
      c.stroke();
      c.lineCap = 'butt';
    } else {
      c.beginPath(); c.arc(cx, cy, 58, 0, Math.PI * 2); c.arc(cx, cy, 36, 0, Math.PI * 2, true); c.fill();
    }
    c.globalAlpha = 1;
  }
  text(ctx, `ACTIVE ZONE: ${t.zone}`, cx, 916, { font: `700 28px ${SANS}`, color: t.ink, align: 'center', spacing: 0.5 });

  const bx = M + 40, by = 962, bw = TEX_W - 2 * M - 80;
  ctx.strokeStyle = t.ink;
  ctx.globalAlpha = 0.5;
  rrect(ctx, bx, by, bw, 300, 12); ctx.stroke();
  ctx.globalAlpha = 1;
  const rows = [
    ['ZONE', t.zone],
    ['ACCESS', a.label],
    ['PASS', `${t.code}  ${t.name}`],
    ['LAMINATE', '350GSM BI-AXIAL FOIL COMPOSITE'],
    ['CHECK-IN', 'TEAR STUB AT GATE 01'],
  ];
  rows.forEach(([k, v], i) => {
    text(ctx, k, bx + 28, by + 60 + i * 52, { font: `500 16px ${MONO}`, color: t.ink2, spacing: 1.5 });
    text(ctx, v, bx + 220, by + 60 + i * 52, { font: `600 16px ${MONO}`, color: t.ink, spacing: 1 });
  });
  text(ctx, 'Valid for the nights shown. Non-transferable after check-in.', cx, 1340, { font: `400 19px ${SANS}`, color: t.ink2, align: 'center' });
  text(ctx, 'Keep the main pass. It shows your zone inside the dome.', cx, 1370, { font: `400 19px ${SANS}`, color: t.ink2, align: 'center' });
  mk.fillStyle = FOIL;
  mk.fillRect(M + 20, 1420, TEX_W - 2 * M - 40, 8);

  const scx = cx, scy = STUB_TOP + 214;
  ctx.fillStyle = t.paper2;
  ctx.beginPath(); ctx.arc(scx, scy, 116, 0, Math.PI * 2); ctx.fill();
  mk.fillStyle = FOIL;
  mk.beginPath(); mk.arc(scx, scy, 116, 0, Math.PI * 2); mk.fill();
  for (const c of [ctx, mk]) {
    text(c, 'AO', scx, scy + 28, { font: `800 84px ${SANS}`, color: c === mk ? '#070' : t.ink, align: 'center', spacing: -3 });
  }
  ctx.save();
  ctx.translate(scx, scy);
  ctx.font = `600 15px ${MONO}`;
  ctx.fillStyle = t.ink2;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const ring = 'ATELIER ORBITA  VERIFIED STOCK  ATELIER ORBITA  VERIFIED STOCK  ';
  for (let i = 0; i < ring.length; i++) {
    ctx.save();
    ctx.rotate((i / ring.length) * Math.PI * 2);
    ctx.fillText(ring[i], 0, -142);
    ctx.restore();
  }
  ctx.restore();

  dieCut(ctx);
}

export function renderTicket(ti, ai) {
  const t = TIERS[ti], a = ACCESS[ai];
  drawFront(t, a, ti, ai);
  drawBack(t, a, ti);
  const m = canvases.mask.getContext('2d');
  m.globalCompositeOperation = 'source-over';
  m.fillStyle = '#000';
  m.fillRect(0, 0, TEX_W, TEX_H);
  m.globalCompositeOperation = 'lighter';
  m.drawImage(canvases.mFront, 0, 0);
  m.drawImage(canvases.mBack, 0, 0);
  m.globalCompositeOperation = 'source-over';
  return canvases;
}
