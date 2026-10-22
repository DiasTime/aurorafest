// Paper simulation: Verlet particles, distance constraints, per-cluster shape matching
// (body and stub keep their flat memory) and a row of perforation fibers that tear.
import * as THREE from 'three';

export const COLS = 25;
export const ROWS_BODY = 37;
export const ROWS_STUB = 11;
export const ROWS = ROWS_BODY + ROWS_STUB;
export const WIDTH = 1;
export const DX = WIDTH / (COLS - 1);
export const HEIGHT = DX * (ROWS - 1);
export const SEAM_ROW = ROWS_BODY - 1; // last body row; fibers join it to the first stub row
export const FIBERS = COLS;

export const idx = (r, c) => r * COLS + c;

const _q = new THREE.Quaternion();
const _qd = new THREE.Quaternion();
const _qi = new THREE.Quaternion();
const _ax = new THREE.Vector3();
const _v = new THREE.Vector3();
const _m = new THREE.Matrix4();
const IDENTITY = new THREE.Quaternion();

export class PaperSim {
  constructor() {
    const N = COLS * ROWS;
    this.N = N;
    this.pos = new Float32Array(N * 3);
    this.prev = new Float32Array(N * 3);
    this.rest = new Float32Array(N * 3);
    this.cluster = new Uint8Array(N);
    this.grabW = new Float32Array(N);
    this.grabOff = new Float32Array(N * 3);
    this.steerWeight = null;

    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const i = idx(r, c);
        this.rest[i * 3] = c * DX - WIDTH / 2;
        this.rest[i * 3 + 1] = HEIGHT / 2 - r * DX;
        this.rest[i * 3 + 2] = 0;
        this.cluster[i] = r >= ROWS_BODY ? 1 : 0;
      }
    }

    this.broken = new Uint8Array(FIBERS);
    this.brokenCount = 0;
    this._buildConstraints();
    this.clusters = [0, 1].map((k) => this._buildCluster(k));

    this.home = { pos: new THREE.Vector3(), quat: new THREE.Quaternion() };
    this.hold = null;
    this.params = {
      iterations: 10,
      damping: 0.991,
      shape: [0.08, 0.08],
      steerRot: [0.03, 0.03],
      steerPos: [0.03, 0.03],
      steerPrev: 0.9,
    };
    this.grabbing = null;
    this.stubDetached = false;
    this.stubFrozen = false;
    this.time = 0;
    this.lastBreak = -1;
    this.maxStrain = 1;
    this.onBreak = null;
    this.onDetach = null;
    this.reset(0);
  }

  _buildConstraints() {
    const A = [], B = [], L = [], K = [], FA = [], FB = [];
    this.fiberCon = new Int32Array(FIBERS);
    const add = (i, j, k, fa = -1, fb = -1) => {
      const dx = this.rest[j * 3] - this.rest[i * 3];
      const dy = this.rest[j * 3 + 1] - this.rest[i * 3 + 1];
      A.push(i); B.push(j); L.push(Math.hypot(dx, dy)); K.push(k); FA.push(fa); FB.push(fb);
      return A.length - 1;
    };
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const seam = r === SEAM_ROW;
        if (c + 1 < COLS) add(idx(r, c), idx(r, c + 1), 1);
        if (r + 1 < ROWS) {
          const id = add(idx(r, c), idx(r + 1, c), seam ? 0.5 : 1, seam ? c : -1, seam ? c : -1);
          if (seam) this.fiberCon[c] = id;
        }
        if (r + 1 < ROWS && c + 1 < COLS) {
          add(idx(r, c), idx(r + 1, c + 1), seam ? 0.3 : 0.9, seam ? c : -1, seam ? c + 1 : -1);
          add(idx(r, c + 1), idx(r + 1, c), seam ? 0.3 : 0.9, seam ? c + 1 : -1, seam ? c : -1);
        }
        if (c + 2 < COLS) add(idx(r, c), idx(r, c + 2), 0.28);
        if (r + 2 < ROWS) {
          const cross = r === SEAM_ROW - 1 || r === SEAM_ROW;
          add(idx(r, c), idx(r + 2, c), cross ? 0.1 : 0.28, cross ? c : -1, cross ? c : -1);
        }
      }
    }
    this.cA = Int32Array.from(A);
    this.cB = Int32Array.from(B);
    this.cL = Float32Array.from(L);
    this.cK = Float32Array.from(K);
    this.cFA = Int32Array.from(FA);
    this.cFB = Int32Array.from(FB);
    this.constraintCount = A.length;
  }

  _buildCluster(k) {
    const list = [];
    for (let i = 0; i < this.N; i++) if (this.cluster[i] === k) list.push(i);
    const n = list.length;
    let cx = 0, cy = 0;
    for (const i of list) { cx += this.rest[i * 3]; cy += this.rest[i * 3 + 1]; }
    cx /= n; cy /= n;
    const q = new Float32Array(n * 2);
    list.forEach((i, m) => { q[m * 2] = this.rest[i * 3] - cx; q[m * 2 + 1] = this.rest[i * 3 + 1] - cy; });
    return {
      idx: Int32Array.from(list), q, restC: new THREE.Vector3(cx, cy, 0),
      rot: new THREE.Quaternion(), c: new THREE.Vector3(),
    };
  }

  homeCentroid(k, out) {
    return out.copy(this.clusters[k].restC).applyQuaternion(this.home.quat).add(this.home.pos);
  }

  reset(offsetY = 0) {
    const { pos, prev, rest } = this;
    const hq = this.home.quat;
    for (let i = 0; i < this.N; i++) {
      _v.set(rest[i * 3], rest[i * 3 + 1], rest[i * 3 + 2]).applyQuaternion(hq).add(this.home.pos);
      pos[i * 3] = prev[i * 3] = _v.x;
      pos[i * 3 + 1] = prev[i * 3 + 1] = _v.y + offsetY;
      pos[i * 3 + 2] = prev[i * 3 + 2] = _v.z;
    }
    for (const cl of this.clusters) cl.rot.copy(hq);
    this.broken.fill(0);
    this.brokenCount = 0;
    this.stubDetached = false;
    this.stubFrozen = false;
    this.hold = null;
    this.release();
  }

  // ---- grabbing ---------------------------------------------------------
  grab(center, point, radius = 0.1) {
    this.release();
    const k = this.cluster[center];
    const rx = this.rest[center * 3], ry = this.rest[center * 3 + 1];
    const list = [];
    for (let i = 0; i < this.N; i++) {
      if (this.cluster[i] !== k) continue;
      const d = Math.hypot(this.rest[i * 3] - rx, this.rest[i * 3 + 1] - ry);
      if (d > radius) continue;
      let w = 1 - d / radius;
      w = w * w * (3 - 2 * w);
      if (i === center) w = 1;
      this.grabW[i] = w;
      this.grabOff[i * 3] = this.pos[i * 3] - point.x;
      this.grabOff[i * 3 + 1] = this.pos[i * 3 + 1] - point.y;
      this.grabOff[i * 3 + 2] = this.pos[i * 3 + 2] - point.z;
      list.push(i);
    }
    this.grabbing = { cluster: k, center, target: point.clone(), list };
    return k;
  }

  moveGrab(target) { if (this.grabbing) this.grabbing.target.copy(target); }

  release() {
    if (this.grabbing) for (const i of this.grabbing.list) this.grabW[i] = 0;
    this.grabbing = null;
  }

  _applyGrab() {
    const g = this.grabbing;
    if (!g) return;
    const { pos, grabW, grabOff } = this;
    for (const i of g.list) {
      const w = grabW[i], k = i * 3;
      pos[k] += (g.target.x + grabOff[k] - pos[k]) * w;
      pos[k + 1] += (g.target.y + grabOff[k + 1] - pos[k + 1]) * w;
      pos[k + 2] += (g.target.z + grabOff[k + 2] - pos[k + 2]) * w;
    }
  }

  // ---- stepping ---------------------------------------------------------
  step(dt) {
    this.time += dt;
    const { pos, prev, N, params } = this;
    const damp = params.damping;
    const grav = 4.2 * dt * dt;
    for (let i = 0; i < N; i++) {
      const stub = this.cluster[i] === 1;
      if (stub && this.stubFrozen) continue;
      const k = i * 3;
      const d = stub && this.stubDetached ? 0.996 : damp;
      for (let a = 0; a < 3; a++) {
        const v = (pos[k + a] - prev[k + a]) * d;
        prev[k + a] = pos[k + a];
        pos[k + a] += v;
      }
      if (stub && this.stubDetached) pos[k + 1] -= grav;
    }
    this._applyGrab();
    for (let it = 0; it < params.iterations; it++) this._solve();
    this._shapeMatch(0);
    if (!this.stubFrozen) this._shapeMatch(1);
    this._applyGrab();
    this._checkFibers();
  }

  _solve() {
    const { pos, grabW, cA, cB, cL, cK, cFA, cFB, broken, cluster } = this;
    const frozen = this.stubFrozen;
    const n = this.constraintCount;
    for (let c = 0; c < n; c++) {
      const fa = cFA[c];
      if (fa >= 0 && (broken[fa] || broken[cFB[c]])) continue;
      const i = cA[c], j = cB[c];
      if (frozen && cluster[i] === 1) continue;
      const wi = 1 - grabW[i], wj = 1 - grabW[j];
      const ws = wi + wj;
      if (ws < 1e-5) continue;
      const ia = i * 3, ja = j * 3;
      const dx = pos[ja] - pos[ia], dy = pos[ja + 1] - pos[ia + 1], dz = pos[ja + 2] - pos[ia + 2];
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (d < 1e-9) continue;
      const s = ((d - cL[c]) / d) * cK[c] / ws;
      pos[ia] += dx * s * wi; pos[ia + 1] += dy * s * wi; pos[ia + 2] += dz * s * wi;
      pos[ja] -= dx * s * wj; pos[ja + 1] -= dy * s * wj; pos[ja + 2] -= dz * s * wj;
    }
  }

  _shapeMatch(k) {
    const cl = this.clusters[k];
    const { idx: list, q } = cl;
    const { pos, prev, grabW } = this;
    const n = list.length;
    let cx = 0, cy = 0, cz = 0;
    for (let m = 0; m < n; m++) { const p = list[m] * 3; cx += pos[p]; cy += pos[p + 1]; cz += pos[p + 2]; }
    cx /= n; cy /= n; cz /= n;
    let a00 = 0, a01 = 0, a10 = 0, a11 = 0, a20 = 0, a21 = 0;
    for (let m = 0; m < n; m++) {
      const p = list[m] * 3, qx = q[m * 2], qy = q[m * 2 + 1];
      const px = pos[p] - cx, py = pos[p + 1] - cy, pz = pos[p + 2] - cz;
      a00 += px * qx; a01 += px * qy; a10 += py * qx; a11 += py * qy; a20 += pz * qx; a21 += pz * qy;
    }
    // Rotation extraction (Mueller et al. 2016), warm-started from last step
    const rq = cl.rot;
    for (let it = 0; it < 6; it++) {
      const x = rq.x, y = rq.y, z = rq.z, w = rq.w;
      const r00 = 1 - 2 * (y * y + z * z), r10 = 2 * (x * y + z * w), r20 = 2 * (x * z - y * w);
      const r01 = 2 * (x * y - z * w), r11 = 1 - 2 * (x * x + z * z), r21 = 2 * (y * z + x * w);
      let ox = (r10 * a20 - r20 * a10) + (r11 * a21 - r21 * a11);
      let oy = (r20 * a00 - r00 * a20) + (r21 * a01 - r01 * a21);
      let oz = (r00 * a10 - r10 * a00) + (r01 * a11 - r11 * a01);
      const den = Math.abs(r00 * a00 + r10 * a10 + r20 * a20 + r01 * a01 + r11 * a11 + r21 * a21) + 1e-9;
      ox /= den; oy /= den; oz /= den;
      const ang = Math.hypot(ox, oy, oz);
      if (ang < 1e-9) break;
      _ax.set(ox / ang, oy / ang, oz / ang);
      _q.setFromAxisAngle(_ax, ang);
      rq.premultiply(_q).normalize();
    }
    cl.c.set(cx, cy, cz);

    // Shape matching: pull every particle toward the rigidly transformed rest shape
    const alpha = this.params.shape[k];
    const x = rq.x, y = rq.y, z = rq.z, w = rq.w;
    const r00 = 1 - 2 * (y * y + z * z), r10 = 2 * (x * y + z * w), r20 = 2 * (x * z - y * w);
    const r01 = 2 * (x * y - z * w), r11 = 1 - 2 * (x * x + z * z), r21 = 2 * (y * z + x * w);
    for (let m = 0; m < n; m++) {
      const i = list[m], p = i * 3, qx = q[m * 2], qy = q[m * 2 + 1];
      const a = alpha * (1 - grabW[i]);
      pos[p] += (r00 * qx + r01 * qy + cx - pos[p]) * a;
      pos[p + 1] += (r10 * qx + r11 * qy + cy - pos[p + 1]) * a;
      pos[p + 2] += (r20 * qx + r21 * qy + cz - pos[p + 2]) * a;
    }

    // Rigid steering toward home (or the hold pose while the stub is being torn)
    const sr = this.params.steerRot[k], sp = this.params.steerPos[k];
    if (k === 1 && this.stubDetached) return;
    if (sr <= 0 && sp <= 0) return;
    let tq, tcx, tcy, tcz;
    if (k === 0 && this.hold) {
      tq = this.hold.quat; tcx = this.hold.c.x; tcy = this.hold.c.y; tcz = this.hold.c.z;
    } else {
      tq = this.home.quat;
      this.homeCentroid(k, _v); tcx = _v.x; tcy = _v.y; tcz = _v.z;
    }
    _qi.copy(rq).invert();
    _qd.copy(tq).multiply(_qi);
    _q.copy(IDENTITY).slerp(_qd, sr);
    _m.makeRotationFromQuaternion(_q);
    const e = _m.elements;
    const tx = (tcx - cx) * sp, ty = (tcy - cy) * sp, tz = (tcz - cz) * sp;
    const pf = this.params.steerPrev;
    const sw = this.steerWeight;
    for (let m = 0; m < n; m++) {
      const i = list[m], p = i * 3;
      const wgt = (1 - grabW[i]) * (sw ? sw[i] : 1);
      if (wgt <= 0) continue;
      const lx = pos[p] - cx, ly = pos[p + 1] - cy, lz = pos[p + 2] - cz;
      const dx = e[0] * lx + e[4] * ly + e[8] * lz - lx + tx;
      const dy = e[1] * lx + e[5] * ly + e[9] * lz - ly + ty;
      const dz = e[2] * lx + e[6] * ly + e[10] * lz - lz + tz;
      pos[p] += dx * wgt; pos[p + 1] += dy * wgt; pos[p + 2] += dz * wgt;
      prev[p] += dx * wgt * pf; prev[p + 1] += dy * wgt * pf; prev[p + 2] += dz * wgt * pf;
    }
  }

  // ---- tearing ----------------------------------------------------------
  fiberStrain(c) {
    const con = this.fiberCon[c];
    const i = this.cA[con] * 3, j = this.cB[con] * 3, p = this.pos;
    return Math.hypot(p[j] - p[i], p[j + 1] - p[i + 1], p[j + 2] - p[i + 2]) / this.cL[con];
  }

  _checkFibers() {
    if (this.stubDetached) { this.maxStrain = 1; return; }
    let maxS = 1, best = -1, bestOver = 0, bestS = 1;
    for (let c = 0; c < FIBERS; c++) {
      if (this.broken[c]) continue;
      const s = this.fiberStrain(c);
      if (s > maxS) maxS = s;
      const edge = c === 0 || c === FIBERS - 1 || this.broken[c - 1] || this.broken[c + 1];
      const over = s - (edge ? 1.55 : 2.7);
      if (over > bestOver) { bestOver = over; best = c; bestS = s; }
    }
    this.maxStrain = maxS;
    if (best < 0) return;
    const interval = Math.min(0.045, Math.max(0.006, 0.05 / (1 + bestOver * 5)));
    if (this.time - this.lastBreak > interval) this.breakFiber(best, bestS);
  }

  breakFiber(c, strain = 1.8) {
    if (c < 0 || c >= FIBERS || this.broken[c] || this.stubDetached) return false;
    this.broken[c] = 1;
    this.brokenCount++;
    this.lastBreak = this.time;
    const i = idx(SEAM_ROW, c) * 3, j = idx(SEAM_ROW + 1, c) * 3, p = this.pos;
    const mid = new THREE.Vector3((p[i] + p[j]) / 2, (p[i + 1] + p[j + 1]) / 2, (p[i + 2] + p[j + 2]) / 2);
    this.onBreak?.(c, mid, strain);
    if (this.brokenCount === FIBERS) {
      this.stubDetached = true;
      this.onDetach?.();
    }
    return true;
  }

  // Mean particle speed relative to the cluster's average motion, used for the paper rustle.
  deformationSpeed(dt) {
    const { pos, prev } = this;
    const list = this.clusters[0].idx;
    let mx = 0, my = 0, mz = 0;
    for (let m = 0; m < list.length; m += 3) {
      const p = list[m] * 3; mx += pos[p] - prev[p]; my += pos[p + 1] - prev[p + 1]; mz += pos[p + 2] - prev[p + 2];
    }
    const n = Math.ceil(list.length / 3);
    mx /= n; my /= n; mz /= n;
    let s = 0;
    for (let m = 0; m < list.length; m += 3) {
      const p = list[m] * 3;
      s += Math.hypot(pos[p] - prev[p] - mx, pos[p + 1] - prev[p + 1] - my, pos[p + 2] - prev[p + 2] - mz);
    }
    return s / n / dt;
  }
}
