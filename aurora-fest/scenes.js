// Chapter scenes: one fixed full-screen WebGL layer behind the page. Each chapter opener is a
// transparent window onto it. A scene is an image (from img/manifest.json) or, until one exists,
// a painting drawn here in Canvas 2D. Scroll drives a dissolve: the picture crumbles away along a
// noise front and a night sky shows through. The picture itself is a pure function of progress,
// so scrolling back reassembles it; the dust is released where the front passes and lives on its
// own clock, drifting off on a breeze (or settling back in when the picture reassembles).
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
uniform vec2 uPointer;
uniform float uPointerOn;
uniform float uDpr;
// noise threshold the front has reached for a dissolve progress (kept in step with front() in JS)
float front(float d) { return d * 1.1 - 0.05; }
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
  // depth parallax: the picture drifts against the pointer more than the sky behind it
  vec2 par = (uPointer - 0.5) * uPointerOn;
  vec3 su = sceneUV(vUv - par * vec2(0.014, 0.01));
  vec2 cuv = su.xy;
  vec2 warp = vec2(vnoise(cuv * 3.0 + uTime * 0.05) - 0.5, vnoise(cuv * 3.0 - uTime * 0.04 + 7.0) - 0.5) * 0.006;
  vec3 img = texture2D(uTex, cuv + warp).rgb;

  vec2 skyUv = vUv - par * 0.004;
  float neb = vnoise(skyUv * vec2(uRes.x / uRes.y, 1.0) * 1.6 + uTime * 0.01);
  vec3 sky = mix(vec3(0.012, 0.012, 0.028), uTint * 0.22, smoothstep(0.35, 0.95, neb) * 0.8);
  sky += vec3(starLayer(skyUv, 150.0, 0.982) + starLayer(skyUv, 70.0, 0.992) * 1.4);

  // the front, as a distance in css pixels: the same width wherever the noise is steep or flat,
  // roughened per pixel so the edge crumbles like torn paper instead of cutting cleanly
  float n = dnoise(dissolveSpace(vUv));
  float fw = max(fwidth(n), 1e-5);
  float dpx = (n - front(uDissolve)) / fw / uDpr + (hash12(floor(gl_FragCoord.xy)) - 0.5) * 4.0;
  float keep = smoothstep(-0.8, 0.8, dpx) * su.z;
  float live = step(0.0001, uDissolve) * (1.0 - step(0.9999, uDissolve)) * su.z;
  float line = exp(-abs(dpx) * 0.55) * live;
  float glow = exp(-abs(dpx) * 0.14) * live;
  float spark = step(0.8, hash12(floor(gl_FragCoord.xy / (2.0 * uDpr)) + floor(uTime * 12.0) * 7.13));
  // the edge shimmers like the foil on the pass: a thin-film rainbow that slides along the front
  vec3 irid = 0.5 + 0.5 * cos(6.2831 * (vec3(0.0, 0.33, 0.67) + n * 5.0 + uTime * 0.08));
  vec3 hot = mix(irid * 1.15, img * 1.5 + 0.05, 0.35);
  vec3 col = mix(sky, img, keep) + hot * (line * (0.5 + 0.8 * spark) + glow * 0.05);

  // a foil sheen follows the pointer across the picture, like light catching the pass
  vec2 pd = (vUv - uPointer) * vec2(uRes.x / uRes.y, 1.0);
  float pr = length(pd);
  float sheen = exp(-pr * pr * 34.0) * uPointerOn;
  vec3 rainbow = 0.5 + 0.5 * cos(6.2831 * (vec3(0.0, 0.33, 0.67) + pr * 3.2 - uTime * 0.15 + dot(pd, vec2(1.3, 0.7))));
  col += sheen * keep * (rainbow * 0.09 + 0.035);

  float vig = smoothstep(1.25, 0.35, length((vUv - 0.5) * vec2(1.0, 1.15)));
  col *= 0.72 + 0.28 * vig;
  // film grain, added in a perceptual space: in linear light the same amount turns a dark sky into snow
  vec3 g = sqrt(max(col, 0.0)) + (hash12(gl_FragCoord.xy + floor(uTime * 12.0) * 17.0) - 0.5) * 0.03;
  col = g * g;
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}`;

const ptsVert = /* glsl */ `
${noiseChunk}
attribute vec2 aHome;
attribute vec4 aRand;
// uClock time the front passed this grain: > 0 blown off the picture, < 0 settling back in, 0 at rest
attribute float aBorn;
uniform sampler2D uTex;
uniform float uClock;
varying vec3 vCol;
varying float vA;
varying float vGlint;
varying float vRot;
varying float vShape;
void main() {
  vec3 su = sceneUV(aHome);
  bool back = aBorn < 0.0;
  float age = uClock - abs(aBorn);
  float life = back ? 0.55 + 0.35 * aRand.w : 0.9 + 1.0 * aRand.z;
  if (aBorn == 0.0 || age < 0.0 || age > life || su.z < 0.2) {
    gl_Position = vec4(2.0, 2.0, 0.0, 1.0); gl_PointSize = 0.0; vA = 0.0; vCol = vec3(0.0); vGlint = 0.0; vRot = 0.0; vShape = 1.0; return;
  }
  float u = age / life;
  // leaving: lifted off and carried up and to the right by a breeze, curling as it goes;
  // settling: a shorter stretch of the same path, run backwards onto the grain's own pixel
  float s = back ? (1.0 - u) * 0.45 : u;
  float aspect = uRes.x / uRes.y;
  vec2 wind = vec2(0.45 / aspect, 1.0) * (0.06 + 0.12 * aRand.y);
  vec2 curl = vec2(sin(s * 4.0 + aRand.w * 6.2831) / aspect, cos(s * 3.3 + aRand.x * 6.2831)) * 0.02 * s;
  vec2 pos = aHome + wind * (s * 0.5 + s * s * 0.9) + curl;
  // loose flakes are pushed aside by the pointer
  vec2 away = (pos - uPointer) * vec2(aspect, 1.0);
  float ar = length(away) + 1e-4;
  pos += (away / ar) * vec2(1.0 / aspect, 1.0) * smoothstep(0.16, 0.0, ar) * 0.045 * uPointerOn;

  // a flake of holographic foil: it tumbles as it flies and flashes whenever it faces the light,
  // taking the colour of its pixel shifted towards a foil hue, so pale pictures shed confetti, not snow
  vGlint = step(0.94, aRand.w);
  vRot = aRand.z * 6.2831 + age * (aRand.x > 0.5 ? 1.0 : -1.0) * (1.5 + 3.0 * aRand.w);
  vShape = 1.3 + aRand.y * 1.2;
  float flash = 0.25 + 0.75 * pow(abs(cos(age * (2.0 + 3.0 * aRand.y) + aRand.z * 6.2831)), 4.0);
  vec3 c = texture2D(uTex, su.xy).rgb;
  c = clamp(mix(vec3(dot(c, vec3(0.299, 0.587, 0.114))), c, 1.8), 0.0, 1.0);
  vec3 foil = 0.55 + 0.45 * cos(6.2831 * (vec3(0.0, 0.33, 0.67) + aRand.x * 0.8 + age * 0.35));
  vCol = mix(mix(c, foil, 0.65) * (0.55 + 0.9 * flash), vec3(1.0, 0.97, 0.92), 0.45 * vGlint);
  float fade = back ? smoothstep(0.0, 0.35, u) * (1.0 - smoothstep(0.8, 1.0, u)) : smoothstep(0.0, 0.05, u) * pow(1.0 - u, 1.5);
  vA = fade * 0.85;
  gl_Position = vec4(pos * 2.0 - 1.0, 0.0, 1.0);
  gl_PointSize = (3.0 + aRand.y * 4.5) * uDpr * (back ? 1.0 : 1.0 + 0.4 * u) * (1.0 + vGlint * 0.6);
}`;

const ptsFrag = /* glsl */ `
varying vec3 vCol;
varying float vA;
varying float vGlint;
varying float vRot;
varying float vShape;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float cs = cos(vRot), sn = sin(vRot);
  vec2 q = vec2(c.x * cs - c.y * sn, c.x * sn + c.y * cs);
  // a small rectangle of foil with softened corners; glints are four-pointed sparkles
  float flake = smoothstep(0.36, 0.26, max(abs(q.x), abs(q.y) * vShape));
  float glint = max(smoothstep(0.07, 0.0, abs(c.x)) * smoothstep(0.5, 0.05, abs(c.y)), smoothstep(0.07, 0.0, abs(c.y)) * smoothstep(0.5, 0.05, abs(c.x)));
  float shape = mix(flake, glint + smoothstep(0.2, 0.0, length(c)), vGlint);
  gl_FragColor = vec4(vCol * shape * vA, 1.0);
  #include <colorspace_fragment>
}`;

// The dissolve field on the CPU, matching dnoise() in the shaders, so each grain knows the
// progress at which the front reaches it.
const fract = (x) => x - Math.floor(x);
function hash12(x, y) {
  let a = fract(x * 0.1031), b = fract(y * 0.1031), c = a;
  const d = a * (b + 33.33) + b * (c + 33.33) + c * (a + 33.33);
  a += d; b += d; c += d;
  return fract((a + b) * c);
}
function vnoise(x, y) {
  const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
  const a = hash12(ix, iy), b = hash12(ix + 1, iy), c = hash12(ix, iy + 1), d = hash12(ix + 1, iy + 1);
  return (a + (b - a) * ux) * (1 - uy) + (c + (d - c) * ux) * uy;
}
const dnoise = (x, y) => vnoise(x, y) * 0.55 + vnoise(x * 2.3 + 7.1, y * 2.3 + 7.1) * 0.3 + vnoise(x * 5.1 + 3.3, y * 5.1 + 3.3) * 0.15;
const front = (d) => d * 1.1 - 0.05;

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
  // the scenes are grainy paintings: a modest pixel ratio keeps them sharp enough and the GPU cool
  const dpr = Math.min(window.devicePixelRatio || 1, 1.25);
  renderer.setPixelRatio(dpr);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  const uniforms = {
    uTex: { value: null }, uDissolve: { value: 0 }, uTime: { value: 0 }, uRes: { value: new THREE.Vector2(1, 1) },
    uTexAspect: { value: TW / TH }, uFocus: { value: 0.6 }, uTint: { value: new THREE.Vector3(1, 0.4, 0.6) }, uDpr: { value: dpr },
    uPointer: { value: new THREE.Vector2(0.5, 0.5) }, uPointerOn: { value: 0 }, uClock: { value: 1 },
  };
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({
    uniforms, vertexShader: quadVert, fragmentShader: quadFrag, depthTest: false, depthWrite: false, extensions: { derivatives: true },
  }));
  quad.frustumCulled = false;
  scene.add(quad);

  // dust grains: a fixed home pixel each, the noise value at which the front reaches it, and the
  // clock time it last crossed the front
  const N = innerWidth < 760 ? 3000 : 5000;
  const home = new Float32Array(N * 2), rand = new Float32Array(N * 4), born = new Float32Array(N);
  const thr = new Float32Array(N), past = new Uint8Array(N);
  const r = rng(77);
  for (let i = 0; i < N; i++) {
    home[i * 2] = r(); home[i * 2 + 1] = r();
    for (let k = 0; k < 4; k++) rand[i * 4 + k] = r();
  }
  const pg = new THREE.BufferGeometry();
  pg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 3), 3));
  pg.setAttribute('aHome', new THREE.BufferAttribute(home, 2));
  pg.setAttribute('aRand', new THREE.BufferAttribute(rand, 4));
  const bornAttr = new THREE.BufferAttribute(born, 1).setUsage(THREE.DynamicDrawUsage);
  pg.setAttribute('aBorn', bornAttr);
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
  const clock0 = performance.now();
  const clockAt = (now) => 1 + (now - clock0) / 1000; // never 0, which marks a grain at rest
  let thrAspect = 0, lastFront = NaN, flightUntil = 0;
  const shownDissolve = () => (reduce ? 0 : dissolve);
  // put every grain on the right side of the front with nothing in flight (new scene, resize)
  function settle() {
    const D = front(shownDissolve());
    for (let i = 0; i < N; i++) { past[i] = D > thr[i] ? 1 : 0; born[i] = 0; }
    bornAttr.needsUpdate = true;
    lastFront = D;
  }
  function thresholds() {
    const aspect = uniforms.uRes.value.x / uniforms.uRes.value.y;
    if (aspect === thrAspect) return;
    thrAspect = aspect;
    for (let i = 0; i < N; i++) thr[i] = dnoise(home[i * 2] * aspect * 2.4, home[i * 2 + 1] * 2.4);
    settle();
  }
  // release dust wherever the front moved since the last frame
  function emit(t) {
    const D = front(shownDissolve());
    if (D === lastFront) return;
    lastFront = D;
    let moved = false;
    for (let i = 0; i < N; i++) {
      const p = D > thr[i] ? 1 : 0;
      if (p === past[i]) continue;
      past[i] = p;
      born[i] = p ? t : -t;
      moved = true;
    }
    if (moved) { bornAttr.needsUpdate = true; flightUntil = t + 2; }
  }
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
    thresholds();
    if (active) draw(performance.now());
  }
  new ResizeObserver(resize).observe(canvas);
  resize();

  // pointer: smoothed position in screen uv (y up) and a presence value that fades when idle
  const pointer = { x: 0.5, y: 0.5, tx: 0.5, ty: 0.5, on: 0, last: -1e9 };
  const finePointer = matchMedia('(hover: hover) and (pointer: fine)').matches;
  if (finePointer && !reduce) {
    window.addEventListener('pointermove', (e) => {
      pointer.tx = e.clientX / innerWidth;
      pointer.ty = 1 - e.clientY / innerHeight;
      pointer.last = performance.now();
    }, { passive: true });
    document.addEventListener('pointerleave', () => { pointer.last = -1e9; });
  }

  let lastDraw = 0, lastDissolve = -1, lastNow = performance.now();
  const draw = (now) => {
    uniforms.uTime.value = reduce ? 4 : now / 1000;
    uniforms.uClock.value = clockAt(now);
    uniforms.uDissolve.value = shownDissolve();
    renderer.render(scene, camera);
  };
  const loop = (now) => {
    raf = 0;
    if (!active) return;
    raf = requestAnimationFrame(loop);
    const dt = Math.min(0.05, (now - lastNow) / 1000);
    lastNow = now;
    const k = 1 - Math.exp(-dt * 7);
    pointer.x += (pointer.tx - pointer.x) * k;
    pointer.y += (pointer.ty - pointer.y) * k;
    const wanted = now - pointer.last < 2200 ? 1 : 0;
    pointer.on += (wanted - pointer.on) * (1 - Math.exp(-dt * 3));
    uniforms.uPointer.value.set(pointer.x, pointer.y);
    uniforms.uPointerOn.value = pointer.on;
    emit(clockAt(now));
    // a settled scene only needs half the frames: stars and warp move slowly
    const busy = dissolve !== lastDissolve || clockAt(now) < flightUntil || Math.abs(pointer.tx - pointer.x) + Math.abs(pointer.ty - pointer.y) > 0.0005 || Math.abs(wanted - pointer.on) > 0.01;
    if (!busy && now - lastDraw < 32) return;
    lastDissolve = dissolve;
    lastDraw = now;
    draw(now);
  };

  // warm the next textures while the browser is idle
  const idle = window.requestIdleCallback || ((fn) => setTimeout(fn, 200));
  ['cover', 'fri', 'sat', 'sun', 'dome', 'route', 'passes'].forEach((k, i) => idle(() => texture(k), { timeout: 400 + i * 300 }));

  return {
    show(key, d = 0) {
      const fresh = key !== current || !active;
      if (key !== current) { current = key; apply(key); }
      dissolve = Math.min(1, Math.max(0, d));
      // arriving on a scene (or back after it was hidden) starts it calm, without a burst of dust
      if (fresh) settle();
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
