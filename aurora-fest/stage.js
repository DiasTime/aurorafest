// The festival pass as one physical object for the whole page. A fixed, click-through WebGL layer
// renders it; it springs to whichever slot element is nearest the middle of the viewport, and can
// be grabbed, bent, flipped and torn right on the page.
import * as THREE from 'three';
import { PaperSim, COLS, ROWS, SEAM_ROW, FIBERS, WIDTH, HEIGHT, idx } from './sim.js';
import { renderTicket, canvases, TIERS } from './art.js';
import { TicketAudio } from './audio.js';
import { createTicketMaterials } from './shader.js';

const SEAM_TOP_V = 1 - SEAM_ROW / (ROWS - 1);
const SEAM_BOT_V = 1 - (SEAM_ROW + 1) / (ROWS - 1);
const ROWV = 1 / (ROWS - 1);
const SUB = 1 / 120;
const KEY_OFFSET = new THREE.Vector3(-1.6, 2.4, 4.2);

export function createTicketStage({ canvas, slots, onPhase = () => {}, onFibers = () => {} }) {
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const audio = new TicketAudio();
  const state = {
    tier: 0, access: 0, phase: 'intact',
    yaw: 0, yawVel: 0, yawTarget: 0, scrollTilt: 0,
    tilt: new THREE.Vector2(), tiltTarget: new THREE.Vector2(),
    releaseRamp: 1, entrance: 0, tear: null, fadeStart: -1, stubAlpha: 1,
    dark: 1, darkTarget: 1, ready: false,
  };

  // ---- renderer & scene ----------------------------------------------------------
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.VSMShadowMap;
  renderer.setClearColor(0x000000, 0);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(24, 1, 0.1, 80);
  const key = new THREE.DirectionalLight(0xffffff, 1);
  key.position.copy(KEY_OFFSET);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  Object.assign(key.shadow.camera, { left: -1.9, right: 1.9, top: 1.9, bottom: -1.9, near: 0.5, far: 14 });
  key.shadow.radius = 14;
  key.shadow.blurSamples = 18;
  key.shadow.bias = -0.0004;
  scene.add(key, key.target);
  const shadowMat = new THREE.ShadowMaterial({ color: new THREE.Color('#000000'), opacity: 0.45 });
  let shadowBase = 0.45;
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(80, 80), shadowMat);
  ground.position.z = -0.75;
  ground.receiveShadow = true;
  scene.add(ground);

  // ---- paper geometry ------------------------------------------------------------------
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
  const quads = (r0, r1, keep) => {
    const out = [];
    for (let r = r0; r < r1; r++) for (let c = 0; c < COLS - 1; c++) {
      if (keep && !keep(c)) continue;
      const a = idx(r, c), b = idx(r + 1, c), d = idx(r + 1, c + 1), e = idx(r, c + 1);
      out.push(a, b, d, a, d, e);
    }
    return out;
  };
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
  const rebuildBodyIndex = () => bodyGeo.setIndex(bodyTris.concat(quads(SEAM_ROW, SEAM_ROW + 1, (c) => !sim.broken[c] && !sim.broken[c + 1])));
  rebuildBodyIndex();

  const makeTex = (c, srgb) => {
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.anisotropy = renderer.capabilities.getMaxAnisotropy();
    t.minFilter = THREE.LinearMipmapLinearFilter;
    return t;
  };
  const textures = { front: makeTex(canvases.front, true), back: makeTex(canvases.back, true), mask: makeTex(canvases.mask, false) };
  const { uniforms, bodyMat, stubMat } = createTicketMaterials(textures, KEY_OFFSET);
  const bodyMesh = new THREE.Mesh(bodyGeo, bodyMat);
  const stubMesh = new THREE.Mesh(stubGeo, stubMat);
  for (const m of [bodyMesh, stubMesh]) { m.castShadow = true; m.frustumCulled = false; m.visible = false; scene.add(m); }

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

  // ---- paper dust ------------------------------------------------------------------------
  const DUST = 220;
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
    const t = TIERS[state.tier];
    dustColor.set(t.paper).lerp(new THREE.Color(t.ink2), 0.35);
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

  // ---- layout: slots in the page map to world positions on the z = 0 plane ---------------
  let W = 1, H = 1, ppu = 300, activeEl = null;
  const tanHalf = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  function resize() {
    W = Math.max(1, canvas.clientWidth);
    H = Math.max(1, canvas.clientHeight);
    renderer.setSize(W, H, false);
    camera.aspect = W / H;
    const ref = activeEl || slots[0];
    const sh = ref ? ref.getBoundingClientRect().height : H * 0.7;
    ppu = Math.max(60, sh / (HEIGHT * 1.06));
    camera.position.set(0, 0, H / (2 * tanHalf * ppu));
    camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix();
  }
  const ro = new ResizeObserver(resize);
  ro.observe(canvas);
  slots.forEach((s) => ro.observe(s));

  const anchor = new THREE.Vector3();
  const prevAnchor = new THREE.Vector3();
  const anchorVel = new THREE.Vector3();
  const screenY = (y) => H / 2 - y * ppu;
  // the shadow falls below and right of the pass, so keep drawing a little longer above the fold
  const ticketOnScreen = () => {
    const half = HEIGHT * ppu * 0.62;
    const sy = screenY(sim.clusters[0].c.y);
    return sy > -half - ppu * 0.6 && sy < H + half;
  };
  function shiftTicket(dx, dy) {
    for (let i = 0; i < sim.N; i++) {
      sim.pos[i * 3] += dx; sim.prev[i * 3] += dx;
      sim.pos[i * 3 + 1] += dy; sim.prev[i * 3 + 1] += dy;
    }
    for (const cl of sim.clusters) { cl.c.x += dx; cl.c.y += dy; }
    if (sim.hold) { sim.hold.c.x += dx; sim.hold.c.y += dy; }
    for (const m of motion) m.ok = false;
  }
  function updateAnchor(dt) {
    let best = null, bestScore = Infinity, bestRect = null;
    for (const el of slots) {
      const r = el.getBoundingClientRect();
      if (r.height === 0) continue;
      const score = Math.abs(r.top + r.height / 2 - H / 2);
      if (score < bestScore) { bestScore = score; best = el; bestRect = r; }
    }
    if (!best) return;
    anchor.set((bestRect.left + bestRect.width / 2 - W / 2) / ppu, -(bestRect.top + bestRect.height / 2 - H / 2) / ppu, 0);
    if (best !== activeEl) {
      const jump = !activeEl || !ticketOnScreen();
      if (activeEl && jump && !sim.grabbing) shiftTicket(anchor.x - prevAnchor.x, anchor.y - prevAnchor.y);
      activeEl = best;
      resize();
      prevAnchor.copy(anchor);
    }
    if (dt > 0) anchorVel.subVectors(anchor, prevAnchor).divideScalar(dt);
    prevAnchor.copy(anchor);
  }

  // ---- phases and tearing -----------------------------------------------------------------
  function setPhase(p) { state.phase = p; onPhase(p); }
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
    if (state.phase === 'intact' || state.phase === 'printed') setPhase('tearing');
    onFibers(FIBERS - sim.brokenCount);
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

  // ---- input on the page ------------------------------------------------------------------
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const tmpV = new THREE.Vector3();
  const tmpN = new THREE.Vector3();
  let drag = null, hoverTick = 0;
  const root = document.documentElement;
  const isUI = (el) => el instanceof Element && !!el.closest('a, button, input, select, textarea, label, summary, [role="tab"], [data-no-ticket]');
  const setNdc = (e) => ndc.set((e.clientX / W) * 2 - 1, -(e.clientY / H) * 2 + 1);
  function pick(e) {
    if (!bodyMesh.visible) return null;
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

  window.addEventListener('pointerdown', (e) => {
    audio.ensure();
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (state.tear || isUI(e.target)) return;
    const hit = pick(e);
    if (!hit) return;
    e.preventDefault();
    if (!sim.stubDetached && inSeam(hit.uv.y, 0.65)) {
      drag = { mode: 'slice', id: e.pointerId, lastCol: null };
      sliceAt(hit);
    } else {
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
    }
    root.classList.add('ticket-drag');
  }, { capture: true });

  window.addEventListener('pointermove', (e) => {
    const c = sim.clusters[0].c;
    const sx = W / 2 + c.x * ppu, sy = screenY(c.y);
    if (!drag) {
      state.tiltTarget.set(
        Math.max(-1, Math.min(1, (e.clientX - sx) / (W * 0.45))),
        Math.max(-1, Math.min(1, (e.clientY - sy) / (H * 0.6))),
      );
      if (e.pointerType === 'mouse' && ++hoverTick % 3 === 0) root.classList.toggle('ticket-hover', !isUI(e.target) && !!pick(e));
      return;
    }
    if (e.pointerId !== drag.id) return;
    if (drag.mode === 'slice') sliceAt(pick(e));
    else {
      setNdc(e);
      raycaster.setFromCamera(ndc, camera);
      if (raycaster.ray.intersectPlane(drag.plane, tmpV)) sim.moveGrab(tmpV);
    }
  });

  function endDrag() {
    if (!drag) return;
    if (drag.mode !== 'slice') { sim.release(); sim.hold = null; state.releaseRamp = 0; }
    root.classList.remove('ticket-drag');
    drag = null;
  }
  window.addEventListener('pointerup', (e) => { if (drag && e.pointerId === drag.id) endDrag(); });
  window.addEventListener('pointercancel', (e) => { if (drag && e.pointerId === drag.id) endDrag(); });
  document.addEventListener('pointerleave', () => state.tiltTarget.set(0, 0));
  document.addEventListener('visibilitychange', () => { if (document.hidden) audio.silence(); });

  // ---- per-frame control --------------------------------------------------------------------
  const euler = new THREE.Euler();
  const flipWeights = [1, -1].map((s) => {
    const w = new Float32Array(sim.N);
    for (let i = 0; i < sim.N; i++) {
      const t = Math.min(1, Math.max(0, (sim.rest[i * 3] / WIDTH) * s + 0.5));
      w[i] = 0.3 + 0.7 * t * t * (3 - 2 * t);
    }
    return w;
  });

  function updateHome(dt, t) {
    const k = 64, c = 2 * Math.sqrt(k) * 0.6;
    state.yawVel += ((state.yawTarget - state.yaw) * k - state.yawVel * c) * dt;
    state.yaw += state.yawVel * dt;
    state.tilt.lerp(state.tiltTarget, 1 - Math.exp(-dt * 4));
    const lean = reduceMotion ? 0 : Math.max(-0.35, Math.min(0.35, anchorVel.y * 0.05));
    state.scrollTilt += (lean - state.scrollTilt) * (1 - Math.exp(-dt * 6));
    const sway = reduceMotion ? 0 : 1;
    euler.set(
      state.tilt.y * 0.2 + Math.sin(t * 0.8 + 1) * 0.035 * sway + state.scrollTilt,
      state.yaw + state.tilt.x * 0.3 + Math.sin(t * 0.6) * 0.05 * sway,
      Math.sin(t * 0.45) * 0.022 * sway,
      'XYZ',
    );
    sim.home.quat.setFromEuler(euler);
    sim.home.pos.set(anchor.x, anchor.y + Math.sin(t * 0.9) * 0.022 * sway, 0);
  }

  function updateParams(dt) {
    const P = sim.params;
    state.releaseRamp = Math.min(1, state.releaseRamp + dt * 1.6);
    const ramp = state.releaseRamp * state.releaseRamp;
    const flipping = Math.abs(state.yaw - state.yawTarget) > 0.08 || Math.abs(state.yawVel) > 0.5;
    P.steerPrev = 0.9 + 0.09 * Math.min(1, state.entrance * 1.5);
    P.shape[0] = 0.08;
    P.shape[1] = sim.stubDetached ? 0.04 : 0.08;
    P.steerRot[0] = P.steerRot[1] = (flipping ? 0.1 : 0.032) * ramp + state.entrance * 0.03;
    P.steerPos[0] = P.steerPos[1] = (0.05 + state.entrance * 0.035) * ramp;
    sim.steerWeight = flipping && !sim.grabbing ? flipWeights[state.yawVel >= 0 ? 0 : 1] : null;
    if (sim.hold) {
      P.steerRot[0] = 0.35; P.steerPos[0] = 0.35;
      P.steerRot[1] = 0; P.steerPos[1] = 0;
      P.shape[1] = 0.05;
    } else if (sim.grabbing && !(sim.grabbing.cluster === 1 && sim.stubDetached)) {
      P.shape[0] = 0.035; P.shape[1] = 0.05;
      P.steerRot[0] = P.steerRot[1] = 0;
      P.steerPos[0] = P.steerPos[1] = 0;
    }
    if (sim.stubDetached) { P.steerRot[1] = 0; P.steerPos[1] = 0; }
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

  function updateStubFade(t) {
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

  const motion = [0, 1].map(() => ({ c: new THREE.Vector3(), q: new THREE.Quaternion(), ok: false }));
  function motionSpeed(dt) {
    let s = 0;
    for (let k = 0; k < 2; k++) {
      const cl = sim.clusters[k], m = motion[k];
      const live = k === 0 || (sim.stubDetached && !sim.stubFrozen);
      if (live && m.ok && dt > 0) {
        // ignore the part of the motion that only follows the page scroll
        const v = tmpV.subVectors(cl.c, m.c).divideScalar(dt).sub(k === 0 ? anchorVel : tmpN.set(0, 0, 0)).length();
        const w = (2 * Math.acos(Math.min(1, Math.abs(m.q.dot(cl.rot))))) / dt;
        s = Math.max(s, v + 0.35 * w);
      }
      m.c.copy(cl.c);
      m.q.copy(cl.rot);
      m.ok = live;
    }
    return Math.min(s, 10);
  }

  let acc = 0, last = performance.now(), stressAt = 0, wasVisible = true;
  function frame(now) {
    requestAnimationFrame(frame);
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    const t = now / 1000;
    updateAnchor(dt);
    updateHome(dt, t);
    updateParams(dt);
    runTear(dt);
    acc += dt;
    breakDelay = 0;
    let steps = 0;
    while (acc >= SUB && steps < 5) { sim.step(SUB); acc -= SUB; steps++; }
    if (steps === 5) acc = 0;
    state.entrance = Math.max(0, state.entrance - dt * 0.9);

    updateStubFade(t);
    audio.crinkle(Math.max(0, sim.deformationSpeed(SUB) - 0.04) * 0.9, dt);
    while (breakTimes.length && now - breakTimes[0] > 150) breakTimes.shift();
    audio.tearRate(breakTimes.length / 0.15, lastBreakPan);
    audio.air(motionSpeed(dt));
    if (!sim.stubDetached && sim.maxStrain > 1.2 && t > stressAt && Math.random() < (sim.maxStrain - 1.2) * 1.5) {
      audio.stress(sim.maxStrain - 1.2, (Math.random() - 0.5) * 0.6);
      stressAt = t + 0.03;
    }

    const visible = ticketOnScreen() || (sim.stubDetached && !sim.stubFrozen);
    if (!visible) {
      if (wasVisible) { renderer.clear(); wasVisible = false; }
      return;
    }
    wasVisible = true;
    posAttr.needsUpdate = true;
    computeNormals();
    updateDust(dt);
    const c = sim.clusters[0].c;
    key.target.position.copy(c);
    key.position.copy(c).add(KEY_OFFSET);
    // fade the cast shadow with the share of the pass that is actually on screen
    const halfPx = (HEIGHT / 2) * ppu, sy = screenY(c.y);
    const shown = Math.max(0, Math.min(1, (Math.min(sy + halfPx, H) - Math.max(sy - halfPx, 0)) / (2 * halfPx)));
    shadowMat.opacity = shadowBase * Math.min(1, shown / 0.35);
    state.dark += (state.darkTarget - state.dark) * (1 - Math.exp(-dt * 5));
    uniforms.uDark.value = state.dark;
    uniforms.uTime.value = t;
    renderer.render(scene, camera);
  }

  // ---- public api ------------------------------------------------------------------------------
  const kick = (v) => { if (!reduceMotion) state.yawVel += v * (Math.random() < 0.5 ? -1 : 1); };
  function setTicket(tier, access) {
    const changed = tier !== state.tier || access !== state.access;
    state.tier = tier;
    state.access = access;
    renderTicket(tier, access);
    textures.front.needsUpdate = textures.back.needsUpdate = textures.mask.needsUpdate = true;
    uniforms.uFoilMode.value = TIERS[tier].foilMode;
    audio.setStock(TIERS[tier].stock);
    if (changed && state.ready) { audio.click(); kick(2.6); }
  }

  function print() {
    endDrag();
    state.tear = null;
    sim.reset(reduceMotion ? 0 : -3.4);
    uniforms.uBroken.value.fill(0);
    rebuildBodyIndex();
    stubMesh.visible = true;
    stubMesh.castShadow = true;
    stubMat.uniforms.uStubAlpha.value = state.stubAlpha = 1;
    state.fadeStart = -1;
    state.entrance = reduceMotion ? 0 : 1;
    state.releaseRamp = 1;
    for (const m of motion) m.ok = false;
    breakTimes.length = 0;
    onFibers(FIBERS);
    setPhase('printed');
    audio.issue();
  }

  function tear() {
    if (sim.stubDetached || state.tear) return;
    endDrag();
    const left = !(sim.broken[FIBERS - 1] && !sim.broken[0]);
    const center = idx(SEAM_ROW + 3, left ? 1 : COLS - 2);
    const p0 = new THREE.Vector3().fromArray(sim.pos, center * 3);
    sim.grab(center, p0, 0.12);
    sim.hold = { quat: sim.clusters[0].rot.clone(), c: sim.clusters[0].c.clone() };
    const dir = new THREE.Vector3(left ? -0.1 : 0.1, -0.52, 0.42).applyQuaternion(sim.clusters[0].rot);
    state.tear = { t: 0, p0, dir, left, forced: 0, after: 0 };
  }

  function flip() {
    state.yawTarget += Math.PI;
    state.releaseRamp = 1;
    audio.flap(0.9);
    return Math.abs(Math.round(state.yawTarget / Math.PI)) % 2 === 1;
  }

  function setDark(on) {
    state.darkTarget = on ? 1 : 0;
    shadowBase = on ? 0.5 : 0.2;
    shadowMat.color.set(on ? '#000000' : '#1f3036');
    audio.setHall(on);
  }

  async function boot() {
    const fonts = ['800 100px "Geist"', '700 30px "Geist"', '400 18px "Geist"', '600 20px "Geist Mono"', '500 16px "Geist Mono"'];
    try {
      await Promise.race([Promise.all(fonts.map((f) => document.fonts.load(f))), new Promise((r) => setTimeout(r, 2500))]);
    } catch (err) { /* fall back to system faces */ }
    setTicket(state.tier, state.access);
    document.fonts?.ready?.then(() => setTicket(state.tier, state.access));
    resize();
    updateAnchor(0);
    sim.home.pos.copy(anchor);
    sim.reset(reduceMotion ? 0 : -3.4);
    state.entrance = reduceMotion ? 0 : 1;
    bodyMesh.visible = stubMesh.visible = true;
    state.ready = true;
    setPhase('intact');
    requestAnimationFrame(frame);
  }
  boot();

  return {
    setTicket, print, tear, flip, setDark,
    ensureAudio: () => audio.ensure(),
    setSound(on) { audio.setEnabled(on); },
    get sound() { return audio.enabled; },
    get phase() { return state.phase; },
  };
}
