import * as THREE from 'three';
import { PaperSim, COLS, ROWS, SEAM_ROW, FIBERS, WIDTH, HEIGHT, idx } from './sim.js';
import { renderTicket, canvases, EDITIONS, SEATS, serialFor } from './art.js';
import { TicketAudio } from './audio.js';
import { createTicketMaterials } from './shader.js';

const $ = (s) => document.querySelector(s);
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const SEAM_TOP_V = 1 - SEAM_ROW / (ROWS - 1);
const SEAM_BOT_V = 1 - (SEAM_ROW + 1) / (ROWS - 1);
const ROWV = 1 / (ROWS - 1);
const SUB = 1 / 120;

const stage = $('#stage');
const canvas = $('#gl');
const ui = {
  status: $('#status'), statusText: $('#status-text'), fiberText: $('#fiber-text'), meter: $('#meter'),
  price: $('#price'), serial: $('#serial'), cta: $('#cta'), ctaMain: $('#cta-main'), ctaSub: $('#cta-sub'),
  ctaKbd: $('#cta-kbd'), faceChip: $('#face-chip'), hud: $('#hud'), hint: $('#hint'), loading: $('#loading'),
  stubBox: $('#stub-box'), flip: $('#btn-flip'), xray: $('#btn-xray'), fresh: $('#btn-fresh'),
  sound: $('#btn-sound'), soundLabel: $('#sound-label'), hall: $('#btn-hall'), panel: $('.panel-shell'),
};
for (let i = 0; i < FIBERS; i++) ui.meter.appendChild(document.createElement('i'));

const audio = new TicketAudio();
const state = {
  edition: 0, seat: 0, phase: 'intact', xray: false, front: true,
  yaw: 0, yawVel: 0, yawTarget: 0, pitchSpin: 0,
  tilt: new THREE.Vector2(), tiltTarget: new THREE.Vector2(),
  releaseRamp: 1, entrance: 0, tear: null, fadeStart: -1, stubAlpha: 1,
  dark: 0, darkTarget: 0, interacted: false,
};

// ---- renderer & scene -------------------------------------------------------------
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.VSMShadowMap;
renderer.setClearColor(0x000000, 0);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(26, 1, 0.1, 60);
camera.position.set(0, 0, 6);

const key = new THREE.DirectionalLight(0xffffff, 1);
key.position.set(-1.6, 2.4, 4.2);
key.castShadow = true;
key.shadow.mapSize.set(1024, 1024);
Object.assign(key.shadow.camera, { left: -2.6, right: 2.6, top: 2.6, bottom: -2.6, near: 0.5, far: 14 });
key.shadow.radius = 14;
key.shadow.blurSamples = 18;
key.shadow.bias = -0.0004;
scene.add(key, key.target);

const shadowMat = new THREE.ShadowMaterial({ color: new THREE.Color('#1f3036'), opacity: 0.2 });
const ground = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), shadowMat);
ground.position.z = -0.75;
ground.receiveShadow = true;
scene.add(ground);

// ---- paper geometry (body and stub share one particle buffer) -----------------------
const sim = new PaperSim();
const posAttr = new THREE.BufferAttribute(sim.pos, 3).setUsage(THREE.DynamicDrawUsage);
const normals = new Float32Array(sim.N * 3);
const nrmAttr = new THREE.BufferAttribute(normals, 3).setUsage(THREE.DynamicDrawUsage);
const uvs = new Float32Array(sim.N * 2);
for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
  const i = idx(r, c);
  uvs[i * 2] = c / (COLS - 1);
  uvs[i * 2 + 1] = 1 - r / (ROWS - 1);
}
const uvAttr = new THREE.BufferAttribute(uvs, 2);

function quads(r0, r1, keep) {
  const out = [];
  for (let r = r0; r < r1; r++) for (let c = 0; c < COLS - 1; c++) {
    if (keep && !keep(c)) continue;
    const a = idx(r, c), b = idx(r + 1, c), d = idx(r + 1, c + 1), e = idx(r, c + 1);
    out.push(a, b, d, a, d, e);
  }
  return out;
}
const bodyTris = quads(0, SEAM_ROW);
const makeGeo = () => {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', posAttr);
  g.setAttribute('normal', nrmAttr);
  g.setAttribute('uv', uvAttr);
  return g;
};
const bodyGeo = makeGeo();
const stubGeo = makeGeo();
stubGeo.setIndex(quads(SEAM_ROW + 1, ROWS - 1));
function rebuildBodyIndex() {
  const seam = quads(SEAM_ROW, SEAM_ROW + 1, (c) => !sim.broken[c] && !sim.broken[c + 1]);
  bodyGeo.setIndex(bodyTris.concat(seam));
}
rebuildBodyIndex();

const makeTex = (c, srgb) => {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = renderer.capabilities.getMaxAnisotropy();
  t.minFilter = THREE.LinearMipmapLinearFilter;
  return t;
};
const textures = { front: makeTex(canvases.front, true), back: makeTex(canvases.back, true), mask: makeTex(canvases.mask, false) };
const { uniforms, bodyMat, stubMat } = createTicketMaterials(textures, key.position);

const bodyMesh = new THREE.Mesh(bodyGeo, bodyMat);
const stubMesh = new THREE.Mesh(stubGeo, stubMat);
for (const m of [bodyMesh, stubMesh]) { m.castShadow = true; m.frustumCulled = false; scene.add(m); }

function computeNormals() {
  normals.fill(0);
  const p = sim.pos;
  const acc = (ix) => {
    for (let t = 0; t < ix.length; t += 3) {
      const a = ix[t] * 3, b = ix[t + 1] * 3, c = ix[t + 2] * 3;
      const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2];
      const vx = p[c] - p[a], vy = p[c + 1] - p[a + 1], vz = p[c + 2] - p[a + 2];
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      for (const k of [a, b, c]) { normals[k] += nx; normals[k + 1] += ny; normals[k + 2] += nz; }
    }
  };
  acc(bodyGeo.index.array);
  if (stubMesh.visible) acc(stubGeo.index.array);
  for (let i = 0; i < normals.length; i += 3) {
    const l = Math.hypot(normals[i], normals[i + 1], normals[i + 2]);
    if (l > 0) { normals[i] /= l; normals[i + 1] /= l; normals[i + 2] /= l; }
  }
  nrmAttr.needsUpdate = true;
}

// ---- paper dust from torn fibres ---------------------------------------------------
const DUST = 260;
const dustPos = new Float32Array(DUST * 3), dustVel = new Float32Array(DUST * 3);
const dustCol = new Float32Array(DUST * 4), dustLife = new Float32Array(DUST);
const dustGeo = new THREE.BufferGeometry();
const dustPosAttr = new THREE.BufferAttribute(dustPos, 3).setUsage(THREE.DynamicDrawUsage);
const dustColAttr = new THREE.BufferAttribute(dustCol, 4).setUsage(THREE.DynamicDrawUsage);
dustGeo.setAttribute('position', dustPosAttr);
dustGeo.setAttribute('color', dustColAttr);
const dust = new THREE.Points(dustGeo, new THREE.PointsMaterial({ size: 0.012, vertexColors: true, transparent: true, depthWrite: false }));
dust.frustumCulled = false;
scene.add(dust);
let dustHead = 0;
const dustColor = new THREE.Color();
function spawnDust(p, n) {
  const ed = EDITIONS[state.edition];
  dustColor.set(ed.paper).lerp(new THREE.Color(ed.ink2), 0.35);
  for (let k = 0; k < n; k++) {
    const i = dustHead++ % DUST;
    dustPos[i * 3] = p.x + (Math.random() - 0.5) * 0.03;
    dustPos[i * 3 + 1] = p.y + (Math.random() - 0.5) * 0.015;
    dustPos[i * 3 + 2] = p.z + 0.004;
    dustVel[i * 3] = (Math.random() - 0.5) * 0.5;
    dustVel[i * 3 + 1] = (Math.random() - 0.3) * 0.5;
    dustVel[i * 3 + 2] = 0.15 + Math.random() * 0.45;
    dustLife[i] = 0.5 + Math.random() * 0.8;
    dustCol[i * 4] = dustColor.r; dustCol[i * 4 + 1] = dustColor.g; dustCol[i * 4 + 2] = dustColor.b;
  }
}
function updateDust(dt) {
  for (let i = 0; i < DUST; i++) {
    if (dustLife[i] <= 0) { dustCol[i * 4 + 3] = 0; continue; }
    dustLife[i] -= dt;
    dustVel[i * 3 + 1] -= 1.6 * dt;
    for (let a = 0; a < 3; a++) { dustVel[i * 3 + a] *= 0.97; dustPos[i * 3 + a] += dustVel[i * 3 + a] * dt; }
    dustCol[i * 4 + 3] = Math.min(1, dustLife[i] / 0.4) * 0.9;
  }
  dustPosAttr.needsUpdate = true;
  dustColAttr.needsUpdate = true;
}

// ---- physics x-ray overlay ------------------------------------------------------------
const nCon = sim.constraintCount;
const linePos = new Float32Array(nCon * 6), lineCol = new Float32Array(nCon * 6);
const lineGeo = new THREE.BufferGeometry();
const linePosAttr = new THREE.BufferAttribute(linePos, 3).setUsage(THREE.DynamicDrawUsage);
const lineColAttr = new THREE.BufferAttribute(lineCol, 3).setUsage(THREE.DynamicDrawUsage);
lineGeo.setAttribute('position', linePosAttr);
lineGeo.setAttribute('color', lineColAttr);
const lines = new THREE.LineSegments(lineGeo, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.6, depthTest: false }));
const ptsGeo = new THREE.BufferGeometry();
ptsGeo.setAttribute('position', posAttr);
const pts = new THREE.Points(ptsGeo, new THREE.PointsMaterial({ size: 3, sizeAttenuation: false, color: 0x2fd39a, depthTest: false, transparent: true }));
for (const o of [lines, pts]) { o.visible = false; o.frustumCulled = false; o.renderOrder = 3; scene.add(o); }

function updateXray() {
  const p = sim.pos;
  for (let c = 0; c < nCon; c++) {
    const i = sim.cA[c] * 3, j = sim.cB[c] * 3, o = c * 6;
    const fa = sim.cFA[c];
    const dead = (fa >= 0 && (sim.broken[fa] || sim.broken[sim.cFB[c]])) || (sim.stubFrozen && sim.cluster[sim.cA[c]] === 1);
    const jj = dead ? i : j;
    linePos[o] = p[i]; linePos[o + 1] = p[i + 1]; linePos[o + 2] = p[i + 2];
    linePos[o + 3] = p[jj]; linePos[o + 4] = p[jj + 1]; linePos[o + 5] = p[jj + 2];
    const s = Math.hypot(p[j] - p[i], p[j + 1] - p[i + 1], p[j + 2] - p[i + 2]) / sim.cL[c];
    const k = Math.min(1, Math.max(0, (s - 1.02) / 0.45));
    const dim = sim.cK[c] < 0.5 ? 0.45 : 1;
    const r = (0.2 + 0.8 * k) * dim, g = (0.78 - 0.45 * k) * dim, b = (0.95 - 0.75 * k) * dim;
    lineCol[o] = lineCol[o + 3] = r; lineCol[o + 1] = lineCol[o + 4] = g; lineCol[o + 2] = lineCol[o + 5] = b;
  }
  linePosAttr.needsUpdate = true;
  lineColAttr.needsUpdate = true;
}

// ---- layout ------------------------------------------------------------------------------
const desktopMQ = matchMedia('(min-width: 900px)');
let viewShift = 0;
function resize() {
  const w = Math.max(1, stage.clientWidth), h = Math.max(1, stage.clientHeight);
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  const desktop = desktopMQ.matches;
  const left = desktop ? Math.max(0, ui.panel.getBoundingClientRect().right - stage.getBoundingClientRect().left) : 0;
  const regionW = Math.max(200, w - left);
  viewShift = left / 2;
  const tan = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  const dH = (HEIGHT * 1.32) / 2 / tan;
  const dW = (WIDTH * (desktop ? 2.3 : 1.6)) / 2 / (tan * (regionW / h));
  camera.position.set(0, 0, Math.max(dH, dW));
  camera.lookAt(0, 0, 0);
  camera.setViewOffset(w, h, -viewShift, desktop ? -22 : 0, w, h);
  camera.updateProjectionMatrix();
}
new ResizeObserver(resize).observe(stage);
resize();

// ---- art & UI state ----------------------------------------------------------------------
function refreshArt() {
  renderTicket(state.edition, state.seat);
  textures.front.needsUpdate = textures.back.needsUpdate = textures.mask.needsUpdate = true;
  uniforms.uFoilMode.value = EDITIONS[state.edition].foilMode;
  ui.price.textContent = EDITIONS[state.edition].priceUi;
  ui.serial.textContent = serialFor(state.edition, state.seat);
}

function updateFiberUI() {
  const intact = FIBERS - sim.brokenCount;
  ui.meter.querySelectorAll('i').forEach((el, i) => el.classList.toggle('torn', !!sim.broken[i]));
  ui.fiberText.textContent = state.phase === 'verified' ? 'Stub detached' : `${intact} of ${FIBERS} fibers intact`;
}

function setPhase(p) {
  state.phase = p;
  const verified = p === 'verified';
  ui.status.dataset.state = verified ? 'verified' : 'awaiting';
  ui.statusText.textContent = { intact: 'Awaiting tear', tearing: 'Tearing', detached: 'Validating', verified: 'Admitted' }[p];
  ui.stubBox.dataset.state = verified ? 'verified' : 'awaiting';
  ui.cta.dataset.state = verified ? 'verified' : 'awaiting';
  ui.ctaMain.textContent = verified ? 'Fresh pass' : 'Tear stub';
  ui.ctaSub.textContent = verified ? 'admitted at gate 01' : 'or slice the seam';
  ui.ctaKbd.textContent = verified ? 'R' : 'T';
  updateFiberUI();
}

function setFace(front) {
  if (state.front === front) return;
  state.front = front;
  ui.faceChip.textContent = front ? 'Front face, holographic foil' : 'Reverse, dome topology and seal';
}

// ---- tearing events ------------------------------------------------------------------------
let breakDelay = 0;
const breakTimes = [];
let lastBreakPan = 0;
sim.onBreak = (c, mid, strain) => {
  const pan = ((c / (FIBERS - 1)) * 2 - 1) * 0.8;
  audio.fiber(Math.min(1.5, Math.max(0.3, strain - 1)), pan, breakDelay);
  breakDelay += 0.011;
  breakTimes.push(performance.now());
  lastBreakPan = pan;
  uniforms.uBroken.value[c] = 1;
  rebuildBodyIndex();
  spawnDust(mid, 5);
  if (state.phase === 'intact') setPhase('tearing');
  else updateFiberUI();
};
sim.onDetach = () => {
  setPhase('detached');
  state.fadeStart = -1;
  motion[1].ok = false;
  audio.flap(0.7);
};

function nudgeStub(amount) {
  for (let r = SEAM_ROW + 1; r < SEAM_ROW + 4; r++) for (let c = 0; c < COLS; c++) {
    const i = idx(r, c) * 3;
    sim.pos[i + 1] -= amount;
    sim.pos[i + 2] += amount * 0.6;
  }
}

// ---- input ------------------------------------------------------------------------------------
const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();
const tmpV = new THREE.Vector3();
const tmpN = new THREE.Vector3();
let drag = null;

function setNdc(e) {
  const r = canvas.getBoundingClientRect();
  ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
}
function pick(e) {
  setNdc(e);
  raycaster.setFromCamera(ndc, camera);
  bodyGeo.computeBoundingSphere();
  stubGeo.computeBoundingSphere();
  const hits = raycaster.intersectObjects(stubMesh.visible ? [bodyMesh, stubMesh] : [bodyMesh], false);
  return hits[0] || null;
}
const colOf = (u) => Math.min(FIBERS - 1, Math.max(0, Math.round(u * (FIBERS - 1))));
const inSeam = (v, pad) => v < SEAM_TOP_V + ROWV * pad && v > SEAM_BOT_V - ROWV * pad;

function sliceAt(hit) {
  if (!hit || !inSeam(hit.uv.y, 1.3)) { drag.lastCol = null; return; }
  const c = colOf(hit.uv.x);
  const from = drag.lastCol ?? c;
  const step = c >= from ? 1 : -1;
  let n = 0;
  for (let k = from; ; k += step) { if (sim.breakFiber(k, 2)) n++; if (k === c) break; }
  drag.lastCol = c;
  if (n) nudgeStub(0.002 * n);
}

function markInteracted() {
  if (state.interacted) return;
  state.interacted = true;
  ui.hint.classList.add('is-faded');
}

canvas.addEventListener('pointerdown', (e) => {
  if (e.pointerType === 'mouse' && e.button !== 0) return;
  audio.ensure();
  markInteracted();
  if (state.tear) return;
  canvas.setPointerCapture(e.pointerId);
  const hit = pick(e);
  if (!hit) { drag = { mode: 'spin', id: e.pointerId, x: e.clientX, y: e.clientY }; return; }
  if (!sim.stubDetached && inSeam(hit.uv.y, 0.65)) {
    drag = { mode: 'slice', id: e.pointerId, lastCol: null };
    sliceAt(hit);
    canvas.classList.add('is-seam');
    return;
  }
  const f = hit.face;
  let best = f.a, bd = Infinity;
  for (const v of [f.a, f.b, f.c]) {
    const d = tmpV.fromArray(sim.pos, v * 3).distanceToSquared(hit.point);
    if (d < bd) { bd = d; best = v; }
  }
  const cluster = sim.grab(best, hit.point, 0.1);
  const tear = cluster === 1 && !sim.stubDetached;
  if (tear) sim.hold = { quat: sim.clusters[0].rot.clone(), c: sim.clusters[0].c.clone() };
  camera.getWorldDirection(tmpN).negate();
  drag = { mode: tear ? 'tear' : 'grab', id: e.pointerId, cluster, plane: new THREE.Plane().setFromNormalAndCoplanarPoint(tmpN, hit.point) };
  canvas.classList.add('is-grabbing');
});

window.addEventListener('pointermove', (e) => {
  const r = stage.getBoundingClientRect();
  if (!drag) {
    const cx = r.left + r.width / 2 + viewShift;
    state.tiltTarget.set(
      Math.max(-1, Math.min(1, (e.clientX - cx) / (r.width * 0.5))),
      Math.max(-1, Math.min(1, (e.clientY - (r.top + r.height / 2)) / (r.height * 0.5))),
    );
  }
  if (!drag || e.pointerId !== drag.id) return;
  if (drag.mode === 'grab' || drag.mode === 'tear') {
    setNdc(e);
    raycaster.setFromCamera(ndc, camera);
    if (raycaster.ray.intersectPlane(drag.plane, tmpV)) sim.moveGrab(tmpV);
  } else if (drag.mode === 'slice') {
    sliceAt(pick(e));
  } else if (drag.mode === 'spin') {
    state.yaw += (e.clientX - drag.x) * 0.011;
    state.pitchSpin = Math.max(-0.6, Math.min(0.6, state.pitchSpin + (e.clientY - drag.y) * 0.005));
    drag.x = e.clientX; drag.y = e.clientY;
  }
});

// Motion sounds (crinkle, air, fibre stress) only play while the pass is being handled and shortly
// after; the idle sway never makes noise.
let engagedUntil = 0;
const engage = (ms) => { engagedUntil = Math.max(engagedUntil, performance.now() + ms); };

function endDrag() {
  if (!drag) return;
  engage(1200);
  if (drag.mode === 'grab' || drag.mode === 'tear') {
    sim.release();
    sim.hold = null;
    state.releaseRamp = 0;
  } else if (drag.mode === 'spin') {
    const turns = Math.round(state.yaw / Math.PI);
    state.yawTarget = turns * Math.PI;
    state.yawVel = 0;
    ui.flip.setAttribute('aria-pressed', String(Math.abs(turns) % 2 === 1));
  }
  canvas.classList.remove('is-grabbing', 'is-seam');
  drag = null;
}
window.addEventListener('pointerup', (e) => { if (drag && e.pointerId === drag.id) endDrag(); });
window.addEventListener('pointercancel', (e) => { if (drag && e.pointerId === drag.id) endDrag(); });
document.addEventListener('pointerleave', () => state.tiltTarget.set(0, 0));

// ---- actions --------------------------------------------------------------------------------
function flip() {
  state.yawTarget += Math.PI;
  engage(1600);
  state.releaseRamp = 1;
  ui.flip.setAttribute('aria-pressed', String(Math.abs(Math.round(state.yawTarget / Math.PI)) % 2 === 1));
  audio.flap(0.9);
}

function autoTear() {
  if (sim.stubDetached || state.tear) return;
  endDrag();
  const left = !(sim.broken[FIBERS - 1] && !sim.broken[0]);
  const center = idx(SEAM_ROW + 3, left ? 1 : COLS - 2);
  const p0 = new THREE.Vector3().fromArray(sim.pos, center * 3);
  sim.grab(center, p0, 0.12);
  sim.hold = { quat: sim.clusters[0].rot.clone(), c: sim.clusters[0].c.clone() };
  const dir = new THREE.Vector3(left ? -0.1 : 0.1, -0.52, 0.42).applyQuaternion(sim.clusters[0].rot);
  state.tear = { t: 0, p0, dir, left, forced: 0, after: 0 };
  engage(2600);
  markInteracted();
}

function runTear(dt) {
  const T = state.tear;
  if (!T) return;
  T.t += dt;
  const k = Math.min(1, T.t / 1.0);
  const e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
  sim.moveGrab(tmpV.copy(T.p0).addScaledVector(T.dir, e + Math.max(0, T.t - 1) * 0.6));
  if (T.t > 1.05 && !sim.stubDetached) {
    T.forced += dt;
    while (T.forced > 0.022 && !sim.stubDetached) {
      T.forced -= 0.022;
      let c = -1;
      for (let i = 0; i < FIBERS; i++) { const j = T.left ? i : FIBERS - 1 - i; if (!sim.broken[j]) { c = j; break; } }
      sim.breakFiber(c, 1.7);
    }
  }
  if (sim.stubDetached) {
    T.after += dt;
    if (T.after > 0.16) { sim.release(); sim.hold = null; state.tear = null; state.releaseRamp = 0; }
  }
}

function freshPass() {
  endDrag();
  state.tear = null;
  sim.reset(-3.4);
  uniforms.uBroken.value.fill(0);
  rebuildBodyIndex();
  stubMesh.visible = true;
  stubMesh.castShadow = true;
  stubMat.uniforms.uStubAlpha.value = state.stubAlpha = 1;
  state.fadeStart = -1;
  state.entrance = 1;
  state.releaseRamp = 1;
  motion[0].ok = motion[1].ok = false;
  breakTimes.length = 0;
  setPhase('intact');
  engage(2000);
  audio.issue();
}

function toggleXray() {
  state.xray = !state.xray;
  for (const m of [bodyMat, stubMat]) { m.transparent = state.xray; m.depthWrite = !state.xray; m.needsUpdate = true; }
  uniforms.uXray.value = state.xray ? 1 : 0;
  lines.visible = pts.visible = state.xray;
  ui.hud.hidden = !state.xray;
  ui.xray.setAttribute('aria-pressed', String(state.xray));
  audio.click();
}

function toggleSound() {
  audio.setEnabled(!audio.enabled);
  ui.soundLabel.textContent = audio.enabled ? 'Sound on' : 'Sound off';
  ui.sound.setAttribute('aria-pressed', String(audio.enabled));
  audio.click();
}

const root = document.documentElement;
const darkMQ = matchMedia('(prefers-color-scheme: dark)');
const isDark = () => root.dataset.theme ? root.dataset.theme === 'dark' : darkMQ.matches;
function syncTheme() {
  const d = isDark();
  state.darkTarget = d ? 1 : 0;
  ui.hall.setAttribute('aria-pressed', String(d));
  shadowMat.color.set(d ? '#000000' : '#1f3036');
  shadowMat.opacity = d ? 0.5 : 0.2;
  audio.setHall(d);
}
function toggleHall() {
  root.dataset.theme = isDark() ? 'light' : 'dark';
  syncTheme();
  audio.click();
}
darkMQ.addEventListener('change', syncTheme);
new MutationObserver(syncTheme).observe(root, { attributes: true, attributeFilter: ['data-theme'] });
syncTheme();
state.dark = state.darkTarget;

const kick = (v) => { engage(900); if (!reduceMotion) state.yawVel += v * (Math.random() < 0.5 ? -1 : 1); };
document.querySelectorAll('input[name="edition"]').forEach((inp) => inp.addEventListener('change', () => {
  state.edition = +inp.value;
  refreshArt();
  audio.setStock(state.edition);
  audio.ensure();
  audio.click();
  kick(3.4);
}));
document.querySelectorAll('input[name="seat"]').forEach((inp) => inp.addEventListener('change', () => {
  state.seat = +inp.value;
  refreshArt();
  audio.ensure();
  audio.click();
  kick(1.6);
}));

const withAudio = (fn) => () => { audio.ensure(); fn(); };
ui.flip.addEventListener('click', withAudio(flip));
ui.xray.addEventListener('click', withAudio(toggleXray));
ui.fresh.addEventListener('click', withAudio(freshPass));
ui.sound.addEventListener('click', withAudio(toggleSound));
ui.hall.addEventListener('click', withAudio(toggleHall));
ui.cta.addEventListener('click', withAudio(() => (state.phase === 'verified' ? freshPass() : autoTear())));
window.addEventListener('keydown', (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey || e.repeat) return;
  const fn = { f: flip, x: toggleXray, r: freshPass, m: toggleSound, d: toggleHall, t: autoTear }[e.key.toLowerCase()];
  if (!fn) return;
  e.preventDefault();
  audio.ensure();
  fn();
});

// ---- per-frame control ----------------------------------------------------------------------
const euler = new THREE.Euler();
const flipWeights = [1, -1].map((s) => {
  const w = new Float32Array(sim.N);
  for (let i = 0; i < sim.N; i++) {
    const x = (sim.rest[i * 3] / WIDTH) * s;
    const t = Math.min(1, Math.max(0, x + 0.5));
    w[i] = 0.3 + 0.7 * t * t * (3 - 2 * t);
  }
  return w;
});

function updateHome(dt, t) {
  if (!(drag && drag.mode === 'spin')) {
    const k = 64, c = 2 * Math.sqrt(k) * 0.6;
    state.yawVel += ((state.yawTarget - state.yaw) * k - state.yawVel * c) * dt;
    state.yaw += state.yawVel * dt;
    state.pitchSpin *= Math.exp(-dt * 5);
  }
  state.tilt.lerp(state.tiltTarget, 1 - Math.exp(-dt * 4));
  const sway = reduceMotion ? 0 : 1;
  euler.set(
    state.tilt.y * 0.2 + Math.sin(t * 0.8 + 1) * 0.035 * sway + state.pitchSpin,
    state.yaw + state.tilt.x * 0.3 + Math.sin(t * 0.6) * 0.05 * sway,
    Math.sin(t * 0.45) * 0.022 * sway,
    'XYZ',
  );
  sim.home.quat.setFromEuler(euler);
  sim.home.pos.set(0, Math.sin(t * 0.9) * 0.022 * sway, 0);
}

function updateParams(dt) {
  const P = sim.params;
  state.releaseRamp = Math.min(1, state.releaseRamp + dt * 1.6);
  const ramp = state.releaseRamp * state.releaseRamp;
  const flipping = Math.abs(state.yaw - state.yawTarget) > 0.08 || Math.abs(state.yawVel) > 0.5;
  const rot = (flipping ? 0.1 : 0.032) * ramp + state.entrance * 0.03;
  const pos = (0.03 + state.entrance * 0.035) * ramp;
  P.steerPrev = 0.9 + 0.09 * Math.min(1, state.entrance * 1.5);
  P.shape[0] = 0.08;
  P.shape[1] = sim.stubDetached ? 0.04 : 0.08;
  P.steerRot[0] = P.steerRot[1] = rot;
  P.steerPos[0] = P.steerPos[1] = pos;
  sim.steerWeight = flipping && !sim.grabbing ? flipWeights[state.yawVel >= 0 ? 0 : 1] : null;
  if (sim.hold) {
    P.steerRot[0] = 0.35; P.steerPos[0] = 0.35;
    P.steerRot[1] = 0; P.steerPos[1] = 0;
    P.shape[1] = 0.05;
  } else if (sim.grabbing && !(sim.grabbing.cluster === 1 && sim.stubDetached)) {
    P.shape[0] = 0.035;
    P.shape[1] = 0.05;
    P.steerRot[0] = P.steerRot[1] = 0;
    P.steerPos[0] = P.steerPos[1] = 0;
  }
  if (sim.stubDetached) { P.steerRot[1] = 0; P.steerPos[1] = 0; }
}

function updateStubFade(dt, t) {
  if (state.phase !== 'detached') return;
  const holding = sim.grabbing && sim.grabbing.cluster === 1;
  if (state.fadeStart < 0) { if (!holding) state.fadeStart = t + 0.45; return; }
  if (t < state.fadeStart) return;
  state.stubAlpha = Math.max(0, 1 - (t - state.fadeStart) / 0.9);
  stubMat.uniforms.uStubAlpha.value = state.stubAlpha;
  stubMesh.castShadow = state.stubAlpha > 0.45;
  if (state.stubAlpha <= 0) {
    if (holding) endDrag();
    sim.stubFrozen = true;
    stubMesh.visible = false;
    setPhase('verified');
    audio.verify();
  }
}

// Linear plus angular speed of the body (and of the stub while it flies), for the air bed.
const motion = [0, 1].map(() => ({ c: new THREE.Vector3(), q: new THREE.Quaternion(), ok: false }));
function motionSpeed(dt) {
  let s = 0;
  for (let k = 0; k < 2; k++) {
    const cl = sim.clusters[k], m = motion[k];
    const live = k === 0 || (sim.stubDetached && !sim.stubFrozen);
    if (live && m.ok && dt > 0) {
      const v = m.c.distanceTo(cl.c) / dt;
      const w = (2 * Math.acos(Math.min(1, Math.abs(m.q.dot(cl.rot))))) / dt;
      s = Math.max(s, v + 0.35 * w);
    }
    m.c.copy(cl.c);
    m.q.copy(cl.rot);
    m.ok = live;
  }
  return Math.min(s, 10);
}
document.addEventListener('visibilitychange', () => { if (document.hidden) audio.silence(); });

let acc = 0, last = performance.now(), hudAt = 0, frameMs = 16.7, stressAt = 0;
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  const t = now / 1000;
  frameMs += (dt * 1000 - frameMs) * 0.05;

  updateHome(dt, t);
  updateParams(dt);
  runTear(dt);
  acc += dt;
  breakDelay = 0;
  let steps = 0;
  while (acc >= SUB && steps < 5) { sim.step(SUB); acc -= SUB; steps++; }
  if (steps === 5) acc = 0;
  state.entrance = Math.max(0, state.entrance - dt * 0.9);

  posAttr.needsUpdate = true;
  computeNormals();
  updateStubFade(dt, t);
  updateDust(dt);
  if (state.xray) updateXray();

  state.dark += (state.darkTarget - state.dark) * (1 - Math.exp(-dt * 5));
  uniforms.uDark.value = state.dark;
  uniforms.uTime.value = t;

  const engaged = !!drag || !!state.tear || (sim.stubDetached && !sim.stubFrozen) || now < engagedUntil;
  const speed = motionSpeed(dt);
  audio.crinkle(engaged ? Math.max(0, sim.deformationSpeed(SUB) - 0.04) * 0.9 : 0, dt);
  while (breakTimes.length && now - breakTimes[0] > 150) breakTimes.shift();
  audio.tearRate(breakTimes.length / 0.15, lastBreakPan);
  audio.air(engaged ? speed : 0);
  if (engaged && !sim.stubDetached && sim.maxStrain > 1.2 && t > stressAt && Math.random() < (sim.maxStrain - 1.2) * 1.5) {
    audio.stress(sim.maxStrain - 1.2, (Math.random() - 0.5) * 0.6);
    stressAt = t + 0.03;
  }

  tmpN.set(0, 0, 1).applyQuaternion(sim.clusters[0].rot);
  setFace(tmpN.dot(tmpV.copy(camera.position).sub(sim.clusters[0].c)) > 0);

  if (state.xray && t > hudAt) {
    hudAt = t + 0.25;
    const rows = [
      ['Solver', '120 Hz, 10 iterations'],
      ['Particles', sim.N.toLocaleString('en-US')],
      ['Constraints', nCon.toLocaleString('en-US')],
      ['Shape clusters', sim.stubFrozen ? '1' : '2'],
      ['Fibers intact', `${FIBERS - sim.brokenCount} / ${FIBERS}`],
      ['Peak seam strain', sim.maxStrain.toFixed(2)],
      ['Frame', `${frameMs.toFixed(1)} ms`],
    ];
    ui.hud.innerHTML = rows.map(([k, v]) => `<div><span>${k}</span><b>${v}</b></div>`).join('');
  }

  renderer.render(scene, camera);
}

async function boot() {
  const fonts = ['800 100px "Geist"', '700 30px "Geist"', '400 18px "Geist"', '600 20px "Geist Mono"', '500 16px "Geist Mono"'];
  try {
    await Promise.race([Promise.all(fonts.map((f) => document.fonts.load(f))), new Promise((r) => setTimeout(r, 2500))]);
  } catch (err) { /* draw with fallback faces */ }
  refreshArt();
  document.fonts?.ready?.then(() => refreshArt());
  ui.loading.hidden = true;
  sim.reset(reduceMotion ? 0 : -3.4);
  state.entrance = reduceMotion ? 0 : 1;
  setPhase('intact');
  requestAnimationFrame(frame);
}
boot();
