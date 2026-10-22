// Ticket material: printed albedo, embossed holographic foil, laminate sheen, torn fibre edges.
import * as THREE from 'three';
import { ROWS, SEAM_ROW, FIBERS } from './sim.js';

const SEAM_TOP = 1 - SEAM_ROW / (ROWS - 1);
const SEAM_BOT = 1 - (SEAM_ROW + 1) / (ROWS - 1);
const ROWV = 1 / (ROWS - 1);

const vertexShader = /* glsl */ `
varying vec2 vUv;
varying vec3 vWorld;
varying vec3 vNormalW;
void main() {
  vUv = uv;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  vNormalW = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

const fragmentShader = /* glsl */ `
#define SEAM_TOP ${SEAM_TOP.toFixed(6)}
#define SEAM_BOT ${SEAM_BOT.toFixed(6)}
#define ROWV ${ROWV.toFixed(6)}
#define FIBERS ${FIBERS}
uniform sampler2D tFront;
uniform sampler2D tBack;
uniform sampler2D tMask;
uniform float uTime;
uniform float uFoilMode;
uniform float uStubAlpha;
uniform float uPart;
uniform float uXray;
uniform float uDark;
uniform float uBroken[FIBERS];
uniform vec3 uKeyDir;
varying vec2 vUv;
varying vec3 vWorld;
varying vec3 vNormalW;

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float vnoise(float x) {
  float i = floor(x), f = fract(x);
  return mix(hash12(vec2(i, 7.1)), hash12(vec2(i + 1.0, 7.1)), f * f * (3.0 - 2.0 * f));
}
vec3 rainbow(float t) { return 0.5 + 0.5 * cos(6.28318 * (t + vec3(0.0, 0.33, 0.67))); }
vec3 foilPalette(float t) {
  vec3 rb = rainbow(t);
  if (uFoilMode < 0.5) return rb;
  float w = 0.5 + 0.5 * cos(6.28318 * t);
  if (uFoilMode < 1.5) {
    vec3 gold = mix(vec3(0.34, 0.2, 0.05), vec3(1.0, 0.82, 0.45), w);
    return mix(gold, gold * (0.55 + 0.9 * rb), 0.2);
  }
  vec3 di = mix(vec3(0.95, 0.14, 0.7), vec3(0.08, 0.82, 1.0), w);
  return mix(di, rb, 0.14);
}

void main() {
  bool front = gl_FrontFacing;
  vec2 uv = front ? vUv : vec2(1.0 - vUv.x, vUv.y);

  // ragged torn edge where a fibre has let go
  int col = int(clamp(floor(vUv.x * float(FIBERS - 1) + 0.5), 0.0, float(FIBERS - 1)));
  if (uBroken[col] > 0.5) {
    float n = 0.55 * vnoise(vUv.x * 190.0) + 0.45 * vnoise(vUv.x * 47.0 + 3.0);
    if (uPart < 0.5) { if (vUv.y < SEAM_TOP + n * ROWV * 0.7) discard; }
    else { if (vUv.y > SEAM_BOT - n * ROWV * 0.7) discard; }
  }

  vec4 albedo = front ? texture2D(tFront, uv) : texture2D(tBack, uv);
  if (albedo.a < 0.5) discard;
  if (uStubAlpha < 0.999 && hash12(gl_FragCoord.xy) > uStubAlpha) discard;

  vec4 mk = texture2D(tMask, uv);
  float foil = front ? mk.r : mk.g;

  vec3 N = normalize(vNormalW) * (front ? 1.0 : -1.0);
  // embossed foil edges: bump from the mask (same construction as three's bumpmap)
  vec3 dpdx = dFdx(vWorld), dpdy = dFdy(vWorld);
  vec2 dh = vec2(dFdx(foil), dFdy(foil)) * 0.0016;
  vec3 r1 = cross(dpdy, N), r2 = cross(N, dpdx);
  float det = dot(dpdx, r1);
  if (abs(det) > 1e-14) N = normalize(abs(det) * N - sign(det) * (dh.x * r1 + dh.y * r2));

  vec3 V = normalize(cameraPosition - vWorld);
  vec3 L = normalize(uKeyDir);
  vec3 H = normalize(L + V);
  float ndl = max(dot(N, L), 0.0);
  float ndv = clamp(dot(N, V), 0.0, 1.0);
  float ndh = max(dot(N, H), 0.0);

  vec3 keyCol = mix(vec3(1.0, 0.985, 0.96), vec3(0.8, 0.82, 0.98), uDark);
  float amb = mix(0.6, 0.36, uDark);
  float kd = mix(0.42, 0.55, uDark);
  vec3 paper = albedo.rgb;
  vec3 lit = paper * (amb + kd * ndl * keyCol);
  float fres = pow(1.0 - ndv, 5.0);
  float spec = pow(ndh, 90.0);
  lit += keyCol * spec * 0.14 + fres * 0.05;

  float phase = ndv * 2.3 + dot(N, vec3(1.1, 0.7, 0.0)) + uv.y * 1.6 + uv.x * 0.7 + uTime * 0.015;
  phase += 0.035 * sin(uv.x * 900.0 + uv.y * 380.0);
  vec3 pal = foilPalette(phase);

  // pearlescent laminate over the printed sheet
  lit += rainbow(phase * 0.8 + 0.2) * 0.035 * (0.4 + fres * 3.0) * (1.0 - foil);

  vec3 R = reflect(-V, N);
  float env = 0.18 + 0.75 * smoothstep(-0.5, 0.9, R.y);
  float box = pow(max(dot(R, normalize(vec3(-0.35, 0.5, 0.8))), 0.0), 18.0);
  vec3 foilCol = pal * (0.3 + 0.85 * env) + mix(vec3(1.0), pal, 0.4) * box * 1.3 + keyCol * spec * 0.9;

  vec2 cellId = floor(uv * vec2(320.0, 627.0));
  vec3 jitter = vec3(hash12(cellId + 3.1), hash12(cellId + 7.7), hash12(cellId + 1.3)) - 0.5;
  float glint = pow(max(dot(normalize(N + jitter * 0.8), H), 0.0), 260.0) * step(0.84, hash12(cellId));
  foilCol += glint * 2.2 * mix(vec3(1.0), pal, 0.3);

  if (uDark > 0.001) {
    float rm = pow(max(dot(R, normalize(vec3(-1.0, 0.25, 0.35))), 0.0), 5.0);
    float rc = pow(max(dot(R, normalize(vec3(1.0, 0.35, 0.35))), 0.0), 5.0);
    vec3 rim = rm * vec3(0.95, 0.2, 0.62) + rc * vec3(0.18, 0.7, 1.0);
    foilCol += uDark * rim * 0.9;
    lit += uDark * rim * paper * 0.35;
  }

  vec3 color = mix(lit, foilCol, foil);
  float alpha = 1.0;
  if (uXray > 0.5) {
    vec2 g = vUv * vec2(float(FIBERS - 1), float(${ROWS - 1}));
    vec2 gw = abs(fract(g - 0.5) - 0.5) / fwidth(g);
    float line = 1.0 - min(min(gw.x, gw.y), 1.0);
    color = mix((N * 0.5 + 0.5) * 0.5 + foil * pal * 0.35, vec3(0.92, 0.98, 1.0), line * 0.7);
    alpha = 0.62;
  }
  gl_FragColor = vec4(color, alpha);
  #include <colorspace_fragment>
}`;

export function createTicketMaterials(textures, keyDir) {
  const shared = {
    tFront: { value: textures.front },
    tBack: { value: textures.back },
    tMask: { value: textures.mask },
    uTime: { value: 0 },
    uFoilMode: { value: 0 },
    uXray: { value: 0 },
    uDark: { value: 0 },
    uBroken: { value: new Float32Array(FIBERS) },
    uKeyDir: { value: keyDir.clone().normalize() },
  };
  const make = (part) => new THREE.ShaderMaterial({
    uniforms: { ...shared, uPart: { value: part }, uStubAlpha: { value: 1 } },
    vertexShader,
    fragmentShader,
    side: THREE.DoubleSide,
  });
  return { uniforms: shared, bodyMat: make(0), stubMat: make(1) };
}
