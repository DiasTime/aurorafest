// Chapter scenes: one fixed full-screen WebGL layer behind the page. Each chapter opener is a
// transparent window onto it. A scene is an image (from img/manifest.json) or, until one exists,
// a painting drawn here in Canvas 2D. Scroll drives a dissolve: the picture burns away along a
// noise front, its pixels lift off as glittering particles and a night sky shows through. The
// dissolve is a pure function of progress, so scrolling back reassembles the picture.
import * as THREE from 'three';

const TW = 1600, TH = 1000;
const TAU = Math.PI * 2;

const noiseChunk = /* glsl */ `
float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1.0, 0.0)), u.x), mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), u.x), u.y);
}
float dnoise(vec2 p) { return vnoise(p) * 0.55 + vnoise(p * 2.3 + 7.1) * 0.3 + vnoise(p * 5.1 + 3.3) * 0.15; }
uniform vec2 uRes;
uniform float uTexAspect;
uniform float uFocus;
// xy: texture coordinate, z: how much of the picture is present here (portrait pictures sit on the
// right at full height over the night sky; landscape pictures fill the screen like background-size: cover)
vec3 sceneUV(vec2 uv) {
  float sa = uRes.x / uRes.y;
  float w = uTexAspect / sa;
  if (w < 0.9) {
    vec2 t = vec2((uv.x - (1.0 - w - 0.015)) / w, uv.y);
    float m = smoothstep(0.0, 0.3, t.x) * smoothstep(1.0, 0.95, t.x) * smoothstep(0.0, 0.05, t.y) * smoothstep(1.0, 0.97, t.y);
    return vec3(clamp(t, 0.0, 1.0), m);
  }
  vec2 s = sa > uTexAspect ? vec2(1.0, uTexAspect / sa) : vec2(sa / uTexAspect, 1.0);
  vec2 c = vec2(clamp(uFocus, s.x * 0.5, 1.0 - s.x * 0.5), 0.5);
  return vec3((uv - 0.5) * s + c, 1.0);
}
vec2 dissolveSpace(vec2 uv) { return vec2(uv.x * uRes.x / uRes.y, uv.y) * 2.4; }
`;

const quadVert = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

const quadFrag = /* glsl */ `
${noiseChunk}
uniform sampler2D uTex;
uniform float uDissolve;
uniform float uTime;
uniform vec3 uTint;
varying vec2 vUv;
float starLayer(vec2 uv, float scale, float density) {
  vec2 g = vec2(uv.x * uRes.x / uRes.y, uv.y) * scale;
  vec2 id = floor(g), f = fract(g) - 0.5;
  float h = hash12(id);
  vec2 o = vec2(hash12(id + 1.3), hash12(id + 2.7)) - 0.5;
  float tw = 0.55 + 0.45 * sin(uTime * (0.8 + h * 2.5) + h * 40.0);
  return step(density, h) * tw * smoothstep(0.11, 0.0, length(f - o * 0.6));
}
void main() {
  vec3 su = sceneUV(vUv);
  vec2 cuv = su.xy;
  vec2 warp = vec2(vnoise(cuv * 3.0 + uTime * 0.05) - 0.5, vnoise(cuv * 3.0 - uTime * 0.04 + 7.0) - 0.5) * 0.006;
  vec3 img = texture2D(uTex, cuv + warp).rgb;

  float neb = vnoise(vUv * vec2(uRes.x / uRes.y, 1.0) * 1.6 + uTime * 0.01);
  vec3 sky = mix(vec3(0.012, 0.012, 0.028), uTint * 0.22, smoothstep(0.35, 0.95, neb) * 0.8);
  sky += vec3(starLayer(vUv, 150.0, 0.982) + starLayer(vUv, 70.0, 0.992) * 1.4);

  float n = dnoise(dissolveSpace(vUv));
  float D = uDissolve * 1.3 - 0.15;
  float keep = smoothstep(D, D + 0.035, n) * su.z;
  float live = step(0.0001, uDissolve) * (1.0 - step(0.9999, uDissolve));
  float edge = smoothstep(0.055, 0.0, abs(n - D)) * live * su.z;
  vec3 col = mix(sky, img, keep) + edge * mix(vec3(1.0, 0.88, 0.7), img, 0.3) * 1.5;

  float vig = smoothstep(1.25, 0.35, length((vUv - 0.5) * vec2(1.0, 1.15)));
  col *= 0.72 + 0.28 * vig;
  col += (hash12(gl_FragCoord.xy + floor(uTime * 12.0) * 17.0) - 0.5) * 0.045;
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}`;

const ptsVert = /* glsl */ `
${noiseChunk}
attribute vec2 aHome;
attribute vec4 aRand;
uniform sampler2D uTex;
uniform float uDissolve;
uniform float uTime;
uniform float uDpr;
varying vec3 vCol;
varying float vA;
void main() {
  float n = dnoise(dissolveSpace(aHome));
  float D = uDissolve * 1.3 - 0.15;
  float age = D - n;
  vec3 su = sceneUV(aHome);
  if (age <= 0.0 || uDissolve <= 0.0 || su.z < 0.15) { gl_Position = vec4(2.0, 2.0, 0.0, 1.0); gl_PointSize = 0.0; vA = 0.0; return; }
  float a = age * 2.2;
  vec2 dir = normalize(aRand.xy - 0.5 + vec2(0.0, 0.3));
  vec2 pos = aHome + dir * a * (0.06 + aRand.z * 0.16)
    + vec2(sin(a * 6.0 + aRand.w * 6.2831) * 0.012, a * a * 0.07);
  vec3 c = texture2D(uTex, su.xy).rgb;
  vCol = mix(c, vec3(1.0, 0.93, 0.8), 0.3 + 0.45 * aRand.w);
  float tw = 0.5 + 0.5 * sin(uTime * (3.0 + aRand.z * 6.0) + aRand.x * 30.0);
  vA = exp(-a * 1.5) * (0.45 + 0.55 * tw);
  gl_Position = vec4(pos * 2.0 - 1.0, 0.0, 1.0);
  gl_PointSize = (1.2 + aRand.y * 2.8) * uDpr * (0.8 + 0.6 * tw);
}`;

const ptsFrag = /* glsl */ `
varying vec3 vCol;
varying float vA;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float core = smoothstep(0.5, 0.0, length(c));
  float glint = max(smoothstep(0.07, 0.0, abs(c.x)) * smoothstep(0.5, 0.1, abs(c.y)), smoothstep(0.07, 0.0, abs(c.y)) * smoothstep(0.5, 0.1, abs(c.x)));
  gl_FragColor = vec4(vCol * (core + glint * 0.6) * vA, 1.0);
  #include <colorspace_fragment>
}`;

// ---- fallback paintings (original artwork, drawn once per scene) -------------------------------------
function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function stars(ctx, r, n, maxY, alpha = 0.8) {
  for (let i = 0; i < n; i++) {
    ctx.globalAlpha = alpha * (0.3 + r() * 0.7);
    ctx.fillStyle = '#fff';
    const s = r() < 0.06 ? 2.2 : 1.1;
    ctx.fillRect(r() * TW, r() * maxY, s, s);
  }
  ctx.globalAlpha = 1;
}
function ridge(ctx, base, amp, k, fill, stroke) {
  ctx.beginPath();
  ctx.moveTo(0, TH);
  for (let x = 0; x <= TW; x += 6) {
    const s = x / TW;
    const y = base - amp * (Math.abs(Math.sin(s * 7 + k * 1.3)) * 0.6 + Math.abs(Math.sin(s * 19 + k * 2.1)) * 0.25 + Math.sin(s * 3 + k) * 0.15);
    ctx.lineTo(x, y);
  }
  ctx.lineTo(TW, TH);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 1.5; ctx.stroke(); }
}
function grain(ctx, seed, amount = 0.05) {
  const r = rng(seed);
  for (let i = 0; i < 26000; i++) {
    ctx.globalAlpha = amount * r();
    ctx.fillStyle = r() < 0.5 ? '#000' : '#fff';
    ctx.fillRect(r() * TW, r() * TH, 1.5, 1.5);
  }
  ctx.globalAlpha = 1;
}

const PAINT = {
  cover(ctx, day) {
    ctx.fillStyle = day ? '#efe9f2' : '#0b0a12';
    ctx.fillRect(0, 0, TW, TH);
    const blobs = [[0.18, 0.3, 0.55, '255,92,161'], [0.55, 0.15, 0.5, '79,214,236'], [0.82, 0.55, 0.55, '255,158,77'], [0.4, 0.85, 0.5, '169,147,255'], [0.92, 0.1, 0.35, '255,226,122']];
    ctx.globalCompositeOperation = day ? 'source-over' : 'lighter';
    for (const [x, y, r, c] of blobs) {
      const g = ctx.createRadialGradient(x * TW, y * TH, 0, x * TW, y * TH, r * TW);
      g.addColorStop(0, `rgba(${c}, ${day ? 0.7 : 0.42})`);
      g.addColorStop(1, `rgba(${c}, 0)`);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, TW, TH);
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.strokeStyle = day ? 'rgba(20,16,24,.08)' : 'rgba(255,255,255,.07)';
    ctx.lineWidth = 1.2;
    for (let k = 0; k < 5; k++) { ctx.beginPath(); ctx.ellipse(TW * 0.62, TH * 0.55, 300 + k * 120, 90 + k * 40, -0.2, 0, TAU); ctx.stroke(); }
    grain(ctx, 3, day ? 0.06 : 0.08);
  },
  fri(ctx) {
    const sky = ctx.createLinearGradient(0, 0, 0, TH);
    sky.addColorStop(0, '#120822'); sky.addColorStop(0.45, '#4d1446'); sky.addColorStop(0.68, '#ff6a5c'); sky.addColorStop(1, '#2a0b24');
    ctx.fillStyle = sky; ctx.fillRect(0, 0, TW, TH);
    stars(ctx, rng(11), 220, TH * 0.4);
    const cx = TW * 0.68, cy = TH * 0.52, r = 250;
    const glow = ctx.createRadialGradient(cx, cy, r * 0.6, cx, cy, r * 2.4);
    glow.addColorStop(0, 'rgba(255,140,90,.45)'); glow.addColorStop(1, 'rgba(255,140,90,0)');
    ctx.fillStyle = glow; ctx.fillRect(0, 0, TW, TH);
    const sg = ctx.createLinearGradient(0, cy - r, 0, cy + r);
    sg.addColorStop(0, '#ffe680'); sg.addColorStop(0.6, '#ff7a6b'); sg.addColorStop(1, '#ff3f8e');
    ctx.save(); ctx.beginPath(); ctx.arc(cx, cy, r, 0, TAU); ctx.clip();
    ctx.fillStyle = sg; ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
    ctx.fillStyle = sky;
    for (let i = 0; i < 9; i++) { const k = i / 9; ctx.fillRect(cx - r, cy + k * r, r * 2, 2 + k * 14); }
    ctx.restore();
    ridge(ctx, TH * 0.72, 150, 1, '#2b0c2c', 'rgba(255,150,170,.25)');
    ridge(ctx, TH * 0.8, 90, 3, '#1a0719', 'rgba(255,120,150,.2)');
    const hz = TH * 0.8;
    ctx.strokeStyle = 'rgba(255,90,160,.45)'; ctx.lineWidth = 1.4;
    for (let i = 0; i < 14; i++) { const y = hz + Math.pow(i / 14, 2) * (TH - hz); ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(TW, y); ctx.stroke(); }
    for (let i = -20; i <= 20; i++) { ctx.beginPath(); ctx.moveTo(cx + i * 10, hz); ctx.lineTo(cx + i * 120, TH); ctx.stroke(); }
    grain(ctx, 5);
  },
  sat(ctx) {
    const sky = ctx.createLinearGradient(0, 0, 0, TH);
    sky.addColorStop(0, '#02080d'); sky.addColorStop(0.5, '#05262e'); sky.addColorStop(0.75, '#0b4a52'); sky.addColorStop(1, '#03161a');
    ctx.fillStyle = sky; ctx.fillRect(0, 0, TW, TH);
    stars(ctx, rng(21), 320, TH * 0.6);
    ctx.globalCompositeOperation = 'lighter';
    for (let k = 0; k < 5; k++) {
      const g = ctx.createLinearGradient(0, TH * 0.1, 0, TH * 0.55);
      g.addColorStop(0, 'rgba(70,240,170,0)'); g.addColorStop(0.5, `rgba(70,240,170,${0.18 - k * 0.02})`); g.addColorStop(1, 'rgba(60,200,255,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      const y0 = TH * (0.12 + k * 0.05);
      ctx.moveTo(0, y0 + 120);
      ctx.bezierCurveTo(TW * 0.3, y0 - 80 + k * 30, TW * 0.6, y0 + 160, TW, y0 - 40);
      ctx.lineTo(TW, y0 + 260); ctx.bezierCurveTo(TW * 0.6, y0 + 360, TW * 0.3, y0 + 120, 0, y0 + 320);
      ctx.closePath(); ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';
    const mx = TW * 0.8, my = TH * 0.2;
    const mg = ctx.createRadialGradient(mx, my, 20, mx, my, 160);
    mg.addColorStop(0, 'rgba(230,252,255,.5)'); mg.addColorStop(1, 'rgba(230,252,255,0)');
    ctx.fillStyle = mg; ctx.fillRect(0, 0, TW, TH);
    ctx.fillStyle = '#eafcff'; ctx.beginPath(); ctx.arc(mx, my, 42, 0, TAU); ctx.fill();
    for (let k = 0; k < 5; k++) ridge(ctx, TH * (0.66 + k * 0.07), 60 - k * 8, k + 4, `rgb(${4 + k * 2}, ${30 - k * 4}, ${36 - k * 5})`, `rgba(110,230,240,${0.35 - k * 0.06})`);
    const yx = TW * 0.83, yy = TH * 0.8;
    ctx.fillStyle = '#e9e2d4'; ctx.beginPath(); ctx.arc(yx, yy, 34, Math.PI, 0); ctx.lineTo(yx + 34, yy + 18); ctx.lineTo(yx - 34, yy + 18); ctx.fill();
    ctx.fillStyle = 'rgba(255,190,110,.9)'; ctx.fillRect(yx - 7, yy - 2, 14, 20);
    grain(ctx, 7);
  },
  sun(ctx) {
    const cx = TW * 0.66, cy = TH * 0.46;
    const bg = ctx.createRadialGradient(cx, cy, 0, cx, cy, TW * 0.7);
    bg.addColorStop(0, '#ff6aa8'); bg.addColorStop(0.18, '#5a1748'); bg.addColorStop(0.55, '#150a24'); bg.addColorStop(1, '#05050b');
    ctx.fillStyle = bg; ctx.fillRect(0, 0, TW, TH);
    stars(ctx, rng(31), 420, TH);
    for (let k = 0; k < 9; k++) {
      ctx.strokeStyle = `rgba(255,255,255,${0.32 - k * 0.03})`; ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.ellipse(cx, cy, 160 + k * 90, 46 + k * 28, -0.32, 0, TAU); ctx.stroke();
    }
    const pg = ctx.createRadialGradient(cx - 30, cy - 30, 10, cx, cy, 90);
    pg.addColorStop(0, '#fff4fa'); pg.addColorStop(0.5, '#ff8cc0'); pg.addColorStop(1, '#5a1748');
    ctx.fillStyle = pg; ctx.beginPath(); ctx.arc(cx, cy, 90, 0, TAU); ctx.fill();
    ctx.strokeStyle = 'rgba(255,226,140,.8)'; ctx.lineWidth = 6;
    ctx.beginPath(); ctx.ellipse(cx, cy, 160, 40, -0.32, 0.15 * Math.PI, 0.85 * Math.PI); ctx.stroke();
    for (const [a, rr, s] of [[0.6, 430, 14], [2.4, 610, 9], [4.1, 340, 7]]) {
      ctx.fillStyle = '#ffe98c';
      ctx.beginPath(); ctx.arc(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr * 0.3, s, 0, TAU); ctx.fill();
    }
    grain(ctx, 9);
  },
  dome(ctx) {
    const bg = ctx.createLinearGradient(0, 0, 0, TH);
    bg.addColorStop(0, '#07070f'); bg.addColorStop(1, '#141a2e');
    ctx.fillStyle = bg; ctx.fillRect(0, 0, TW, TH);
    const cx = TW * 0.62, cy = TH * 0.95, R = TH * 0.86;
    ctx.globalCompositeOperation = 'lighter';
    for (const [a, c] of [[-0.6, '255,92,161'], [0.5, '79,214,236'], [0.05, '255,158,77']]) {
      const g = ctx.createRadialGradient(cx + Math.sin(a) * R * 0.6, cy - R * 0.7, 0, cx + Math.sin(a) * R * 0.6, cy - R * 0.7, R * 0.7);
      g.addColorStop(0, `rgba(${c},.38)`); g.addColorStop(1, `rgba(${c},0)`);
      ctx.fillStyle = g; ctx.fillRect(0, 0, TW, TH);
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.strokeStyle = 'rgba(255,255,255,.16)'; ctx.lineWidth = 1.2;
    for (let k = 1; k < 9; k++) { const th = (k / 9) * Math.PI / 2; ctx.beginPath(); ctx.ellipse(cx, cy - Math.sin(th) * R, Math.cos(th) * R, Math.cos(th) * R * 0.16, 0, Math.PI, TAU); ctx.stroke(); }
    for (let j = 0; j < 18; j++) {
      const ph = (j / 18) * Math.PI;
      ctx.beginPath();
      for (let s = 0; s <= 20; s++) { const th = (s / 20) * Math.PI / 2; const x = cx - Math.cos(ph) * Math.cos(th) * R, y = cy - Math.sin(th) * R + Math.sin(ph) * Math.cos(th) * R * 0.16 * 0; s ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
      ctx.stroke();
    }
    const r = rng(41);
    for (let i = 0; i < 900; i++) {
      const th = r() * Math.PI / 2, ph = r() * Math.PI;
      const x = cx - Math.cos(ph) * Math.cos(th) * R, y = cy - Math.sin(th) * R;
      ctx.fillStyle = ['#ff5ca1', '#4fd6ec', '#ffe27a'][(r() * 3) | 0];
      ctx.globalAlpha = 0.3 + r() * 0.6;
      ctx.fillRect(x, y, 2.4, 2.4);
    }
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#05050a';
    ctx.beginPath(); ctx.moveTo(0, TH);
    for (let x = 0; x <= TW; x += 14) ctx.lineTo(x, TH * 0.9 - Math.abs(Math.sin(x * 0.09)) * 22 - r() * 10);
    ctx.lineTo(TW, TH); ctx.fill();
    for (let i = 0; i < 70; i++) { ctx.fillStyle = 'rgba(255,240,220,.85)'; ctx.fillRect(r() * TW, TH * 0.86 + r() * 40, 2, 3); }
    grain(ctx, 13);
  },
  route(ctx) {
    const sky = ctx.createLinearGradient(0, 0, 0, TH);
    sky.addColorStop(0, '#0a0f2e'); sky.addColorStop(0.42, '#3b2352'); sky.addColorStop(0.6, '#c4627a'); sky.addColorStop(1, '#120b1c');
    ctx.fillStyle = sky; ctx.fillRect(0, 0, TW, TH);
    stars(ctx, rng(51), 160, TH * 0.35, 0.6);
    const tones = ['#4a3068', '#3a2556', '#2a1b42', '#1c1230', '#120b20'];
    tones.forEach((c, k) => ridge(ctx, TH * (0.52 + k * 0.06), 220 - k * 30, k * 2 + 1, c, k < 2 ? 'rgba(255,235,245,.55)' : 'rgba(255,180,200,.15)'));
    const r = rng(53);
    for (let i = 0; i < 1400; i++) {
      const y = TH * (0.8 + Math.pow(r(), 1.6) * 0.2);
      ctx.fillStyle = r() < 0.8 ? 'rgba(255,214,150,.9)' : 'rgba(150,220,255,.9)';
      ctx.globalAlpha = 0.3 + r() * 0.7;
      ctx.fillRect(r() * TW, y, 1.8, 1.8);
    }
    ctx.globalAlpha = 1;
    const g = ctx.createLinearGradient(TW * 0.1, TH * 0.95, TW * 0.7, TH * 0.68);
    g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(1, 'rgba(255,120,180,.95)');
    ctx.strokeStyle = g; ctx.lineWidth = 3.5; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(TW * 0.1, TH * 0.97); ctx.bezierCurveTo(TW * 0.35, TH * 0.82, TW * 0.5, TH * 0.86, TW * 0.7, TH * 0.68); ctx.stroke();
    const dg = ctx.createRadialGradient(TW * 0.7, TH * 0.67, 2, TW * 0.7, TH * 0.67, 60);
    dg.addColorStop(0, 'rgba(255,255,255,.95)'); dg.addColorStop(1, 'rgba(255,92,161,0)');
    ctx.fillStyle = dg; ctx.fillRect(0, 0, TW, TH);
    grain(ctx, 17);
  },
  passes(ctx) {
    ctx.fillStyle = '#0a0910'; ctx.fillRect(0, 0, TW, TH);
    const cx = TW * 0.64, cy = TH * 0.5, R = TH * 0.36;
    const cols = ['#ff5ca1', '#ff9e4d', '#ffe27a', '#4fd6ec', '#a993ff'];
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineWidth = 1.4;
    for (let k = 0; k < 60; k++) {
      const rot = (k * Math.PI) / 60;
      ctx.strokeStyle = cols[k % cols.length]; ctx.globalAlpha = 0.5;
      ctx.beginPath(); ctx.ellipse(cx, cy, R, R * 0.3, rot, 0, TAU); ctx.stroke();
    }
    for (let k = 0; k < 40; k++) {
      const a = (k / 40) * TAU, rr = R * 0.38;
      ctx.strokeStyle = cols[(k + 2) % cols.length]; ctx.globalAlpha = 0.35;
      ctx.beginPath(); ctx.arc(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr, rr, 0, TAU); ctx.stroke();
    }
    ctx.globalAlpha = 1;
    const band = ctx.createLinearGradient(0, 0, TW, TH);
    band.addColorStop(0.35, 'rgba(255,255,255,0)'); band.addColorStop(0.5, 'rgba(255,240,250,.16)'); band.addColorStop(0.65, 'rgba(255,255,255,0)');
    ctx.fillStyle = band; ctx.fillRect(0, 0, TW, TH);
    ctx.globalCompositeOperation = 'source-over';
    stars(ctx, rng(61), 200, TH, 0.7);
    grain(ctx, 19);
  },
};

export const SCENE_TINTS = {
  cover: [1, 0.36, 0.63], fri: [1, 0.45, 0.4], sat: [0.25, 0.9, 0.75], sun: [1, 0.4, 0.7], dome: [0.3, 0.8, 0.95], route: [0.9, 0.45, 0.6], passes: [0.7, 0.6, 1],
};
// horizontal crop focus per scene (keeps subjects on the right third in view on narrow screens)
const FOCUS = { cover: 0.55, fri: 0.66, sat: 0.7, sun: 0.66, dome: 0.62, route: 0.6, passes: 0.64 };

export function createScenes(canvas) {
  let manifest = {};
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, powerPreference: 'high-performance' });
  const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
  renderer.setPixelRatio(dpr);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  const uniforms = {
    uTex: { value: null }, uDissolve: { value: 0 }, uTime: { value: 0 }, uRes: { value: new THREE.Vector2(1, 1) },
    uTexAspect: { value: TW / TH }, uFocus: { value: 0.6 }, uTint: { value: new THREE.Vector3(1, 0.4, 0.6) }, uDpr: { value: dpr },
  };
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({ uniforms, vertexShader: quadVert, fragmentShader: quadFrag, depthTest: false, depthWrite: false }));
  quad.frustumCulled = false;
  scene.add(quad);

  const N = innerWidth < 760 ? 11000 : 26000;
  const home = new Float32Array(N * 2), rand = new Float32Array(N * 4);
  const r = rng(77);
  for (let i = 0; i < N; i++) {
    home[i * 2] = r(); home[i * 2 + 1] = r();
    for (let k = 0; k < 4; k++) rand[i * 4 + k] = r();
  }
  const pg = new THREE.BufferGeometry();
  pg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 3), 3));
  pg.setAttribute('aHome', new THREE.BufferAttribute(home, 2));
  pg.setAttribute('aRand', new THREE.BufferAttribute(rand, 4));
  const points = new THREE.Points(pg, new THREE.ShaderMaterial({
    uniforms, vertexShader: ptsVert, fragmentShader: ptsFrag,
    transparent: true, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending,
  }));
  points.frustumCulled = false;
  scene.add(points);

  // textures: an image from the manifest if one is listed, otherwise the painting above
  const textures = {};
  let day = false;
  const makeTex = (src) => {
    const t = new THREE.Texture(src);
    t.colorSpace = THREE.SRGBColorSpace;
    t.minFilter = THREE.LinearFilter;
    t.generateMipmaps = false;
    t.needsUpdate = true;
    return t;
  };
  const paint = (key) => {
    const c = document.createElement('canvas');
    c.width = TW; c.height = TH;
    PAINT[key](c.getContext('2d'), day);
    return c;
  };
  function loadImage(key) {
    const file = manifest[key];
    if (!file || textures[key]?.image || textures[key]?.loading) return;
    if (textures[key]) textures[key].loading = true;
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => {
      textures[key]?.tex.dispose();
      textures[key] = { tex: makeTex(img), aspect: img.naturalWidth / img.naturalHeight, image: true };
      if (current === key) apply(key);
    };
    img.src = `img/${file}`;
  }
  function texture(key) {
    if (textures[key]) return textures[key];
    textures[key] = { tex: makeTex(paint(key)), aspect: TW / TH };
    loadImage(key);
    return textures[key];
  }

  let current = null, active = false, raf = 0, dissolve = 0;
  function apply(key) {
    const t = texture(key);
    uniforms.uTex.value = t.tex;
    uniforms.uTexAspect.value = t.aspect;
    uniforms.uFocus.value = FOCUS[key] ?? 0.6;
    uniforms.uTint.value.set(...(SCENE_TINTS[key] || [1, 0.5, 0.6]));
  }
  function resize() {
    const w = canvas.clientWidth || innerWidth, h = canvas.clientHeight || innerHeight;
    renderer.setSize(w, h, false);
    uniforms.uRes.value.set(w, h);
    if (active) draw(performance.now());
  }
  new ResizeObserver(resize).observe(canvas);
  resize();

  const draw = (now) => {
    uniforms.uTime.value = reduce ? 4 : now / 1000;
    uniforms.uDissolve.value = reduce ? 0 : dissolve;
    renderer.render(scene, camera);
  };
  const loop = (now) => { raf = 0; if (!active) return; draw(now); raf = requestAnimationFrame(loop); };

  // warm the next textures while the browser is idle
  const idle = window.requestIdleCallback || ((fn) => setTimeout(fn, 200));
  ['cover', 'fri', 'sat', 'sun', 'dome', 'route', 'passes'].forEach((k, i) => idle(() => texture(k), { timeout: 400 + i * 300 }));

  return {
    show(key, d = 0) {
      if (key !== current) { current = key; apply(key); }
      dissolve = Math.min(1, Math.max(0, d));
      if (!active) { active = true; canvas.classList.add('is-on'); }
      if (!raf) raf = requestAnimationFrame(loop);
    },
    hide() {
      active = false;
      canvas.classList.remove('is-on');
    },
    setManifest(m) {
      manifest = m || {};
      Object.keys(textures).forEach(loadImage);
    },
    setDay(on) {
      if (on === day) return;
      day = on;
      if (textures.cover && !textures.cover.image) {
        textures.cover.tex.dispose();
        textures.cover = { tex: makeTex(paint('cover')), aspect: TW / TH };
        if (current === 'cover') apply('cover');
      }
    },
  };
}
