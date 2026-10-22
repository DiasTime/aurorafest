// Every sound is synthesised in the browser. Paper sounds are grains cut from pre-rendered
// crackle textures (thousands of tiny fibre impulses); motion drives continuous air, crinkle
// and rip beds; a generated impulse response places it all in a small room or, in concert
// hall mode, a large hall. Starts on the first user gesture.

const rand = (a, b) => a + Math.random() * (b - a);
const clamp01 = (x) => Math.min(1, Math.max(0, x));
const STOCK_TONE = [1, 0.82, 1.12]; // pearl card, heavy obsidian board, laminated cobalt

function normalize(d, peak) {
  let m = 0;
  for (let i = 0; i < d.length; i++) m = Math.max(m, Math.abs(d[i]));
  if (m > 0) for (let i = 0; i < d.length; i++) d[i] *= peak / m;
}

function noiseBuffer(ctx, seconds, brown = false) {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  let y = 0;
  for (let i = 0; i < len; i++) {
    const w = Math.random() * 2 - 1;
    if (brown) { y = (y + 0.02 * w) / 1.02; d[i] = y; } else d[i] = w;
  }
  normalize(d, 0.9);
  return buf;
}

// Sparse decaying micro-impulses: the sound of individual fibres letting go.
function crackleBuffer(ctx, seconds, density, maxLen, skew) {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  const events = Math.floor(density * seconds);
  for (let e = 0; e < events; e++) {
    const start = Math.floor(Math.random() * len);
    const amp = Math.pow(Math.random(), skew) * (Math.random() < 0.5 ? -1 : 1);
    const L = 6 + Math.floor(Math.random() * Math.random() * maxLen);
    const k = 5 / L;
    for (let i = 0; i < L && start + i < len; i++) d[start + i] += amp * (Math.random() * 2 - 1) * Math.exp(-i * k);
  }
  let prev = 0;
  for (let i = 0; i < len; i++) { const x = d[i]; d[i] = x - prev * 0.55; prev = x; } // trim rumble
  normalize(d, 0.95);
  return buf;
}

// Stereo noise tail with early reflections; highs die faster than lows, like a real room.
function impulseResponse(ctx, seconds, decay) {
  const rate = ctx.sampleRate, len = Math.floor(rate * seconds);
  const buf = ctx.createBuffer(2, len, rate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    let y = 0;
    for (let i = 0; i < len; i++) {
      const p = i / len;
      y += ((Math.random() * 2 - 1) * Math.pow(1 - p, decay) - y) * (0.9 - 0.78 * p);
      d[i] = y;
    }
    for (let k = 0; k < 8; k++) {
      const at = Math.floor(rate * (0.004 + k * 0.0085 + Math.random() * 0.004));
      if (at < len) d[at] += (Math.random() - 0.5) * (0.9 - k * 0.09);
    }
  }
  return buf;
}

export class TicketAudio {
  constructor() {
    this.ctx = null;
    this.enabled = true;
    this.hall = false;
    this.tone = 1;
    this.crinkleCarry = 0;
  }

  // Pass an OfflineAudioContext to render without a device (used for level checks).
  ensure(ctx) {
    if (!this.ctx) {
      if (!ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return false;
        ctx = new AC({ latencyHint: 'interactive' });
      }
      this._build(ctx);
    }
    if (!this.offline && this.ctx.state === 'suspended') this.ctx.resume();
    return true;
  }

  _build(ctx) {
    this.ctx = ctx;
    this.offline = typeof OfflineAudioContext !== 'undefined' && ctx instanceof OfflineAudioContext;

    this.master = ctx.createGain();
    this.master.gain.value = this.enabled ? 1 : 0;
    const glue = ctx.createDynamicsCompressor();
    glue.threshold.value = -20; glue.knee.value = 12; glue.ratio.value = 3; glue.attack.value = 0.004; glue.release.value = 0.18;
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -2; limiter.knee.value = 0; limiter.ratio.value = 20; limiter.attack.value = 0.001; limiter.release.value = 0.08;
    this.master.connect(glue).connect(limiter).connect(ctx.destination);

    this.bus = ctx.createGain();
    this.bus.connect(this.master);
    this.sendRoom = ctx.createGain();
    this.sendHall = ctx.createGain();
    this.bus.connect(this.sendRoom);
    this.bus.connect(this.sendHall);
    const room = ctx.createConvolver();
    room.buffer = impulseResponse(ctx, 0.5, 3.2);
    const hall = ctx.createConvolver();
    hall.buffer = impulseResponse(ctx, 2.8, 2.1);
    this.sendRoom.connect(room).connect(this.master);
    this.sendHall.connect(hall).connect(this.master);
    this._applyHall(0.01);

    this.noise = noiseBuffer(ctx, 2);
    this.brown = noiseBuffer(ctx, 3, true);
    this.crackle = crackleBuffer(ctx, 2, 1100, 160, 1.5);
    this.rip = crackleBuffer(ctx, 2, 5200, 60, 2);

    this.beds = {
      air: this._bed(this.brown, 'bandpass', 400, 0.7),
      swish: this._bed(this.noise, 'bandpass', 2200, 0.5),
      tear: this._bed(this.rip, 'bandpass', 2600, 0.6, true),
    };
  }

  _bed(buf, type, freq, q, withPan = false) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.value = 0;
    let node = src.connect(f).connect(g);
    let p = null;
    if (withPan && ctx.createStereoPanner) { p = ctx.createStereoPanner(); node = node.connect(p); }
    node.connect(this.bus);
    src.start(0, Math.random() * buf.duration);
    return { f, g, p };
  }

  get ready() { return !!this.ctx && this.enabled && (this.offline || this.ctx.state === 'running'); }

  _applyHall(tc) {
    const t = this.ctx.currentTime;
    this.sendRoom.gain.setTargetAtTime(this.hall ? 0.05 : 0.16, t, tc);
    this.sendHall.gain.setTargetAtTime(this.hall ? 0.34 : 0, t, tc);
  }

  setHall(on) { this.hall = on; if (this.ctx) this._applyHall(0.4); }
  setStock(i) { this.tone = STOCK_TONE[i] ?? 1; }

  setEnabled(on) {
    this.enabled = on;
    if (!this.ctx) return;
    this.master.gain.setTargetAtTime(on ? 1 : 0, this.ctx.currentTime, 0.04);
    if (!on) this.silence();
  }

  silence() {
    if (!this.ctx) return;
    for (const b of Object.values(this.beds)) b.g.gain.setTargetAtTime(0, this.ctx.currentTime, 0.02);
  }

  // ---- building blocks -----------------------------------------------------------
  _grain(buf, o) {
    const ctx = this.ctx, t = o.t ?? ctx.currentTime, rate = o.rate ?? 1;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = rate;
    const f = ctx.createBiquadFilter();
    f.type = o.type || 'bandpass';
    f.frequency.value = Math.min(18000, o.freq * this.tone);
    f.Q.value = o.q ?? 0.8;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(o.gain, t + (o.attack ?? 0.0012));
    g.gain.exponentialRampToValueAtTime(0.0001, t + o.dur);
    let node = src.connect(f).connect(g);
    if (o.pan && ctx.createStereoPanner) {
      const p = ctx.createStereoPanner();
      p.pan.value = Math.max(-1, Math.min(1, o.pan));
      node = node.connect(p);
    }
    node.connect(this.bus);
    const offset = Math.random() * Math.max(0, buf.duration - o.dur * rate - 0.05);
    src.start(t, offset, o.dur * rate + 0.02);
  }

  _tone(o) {
    const ctx = this.ctx, t = o.t;
    const osc = ctx.createOscillator();
    osc.type = o.type || 'sine';
    osc.frequency.setValueAtTime(o.freq, t);
    if (o.glide) osc.frequency.exponentialRampToValueAtTime(o.freq * o.glide, t + o.dur);
    if (o.mod) {
      const fm = ctx.createOscillator();
      fm.frequency.value = o.freq * o.mod.ratio;
      const depth = ctx.createGain();
      depth.gain.setValueAtTime(o.freq * o.mod.index, t);
      depth.gain.exponentialRampToValueAtTime(o.freq * 0.01, t + o.mod.decay);
      fm.connect(depth).connect(osc.frequency);
      fm.start(t);
      fm.stop(t + o.dur + 0.05);
    }
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(o.gain, t + (o.attack ?? 0.003));
    g.gain.exponentialRampToValueAtTime(0.0001, t + o.dur);
    let node = osc.connect(g);
    if (o.pan && ctx.createStereoPanner) {
      const p = ctx.createStereoPanner();
      p.pan.value = o.pan;
      node = node.connect(p);
    }
    node.connect(this.bus);
    osc.start(t);
    osc.stop(t + o.dur + 0.05);
  }

  // ---- paper events ----------------------------------------------------------------
  // One perforation fibre letting go: a crisp snap, a cluster of fibres pulling out,
  // a short fibrous tail and the dull knock of the card itself.
  fiber(intensity = 1, pan = 0, delay = 0) {
    if (!this.ready) return;
    const t = this.ctx.currentTime + delay + 0.005;
    const k = Math.min(1.4, 0.5 + intensity * 0.55);
    const bright = 0.85 + intensity * 0.25;
    this._grain(this.noise, { t, dur: rand(0.004, 0.007), freq: 4200 * bright, type: 'highpass', q: 0.5, gain: 0.55 * k, pan });
    const n = 3 + Math.floor(Math.random() * 3 + k * 2);
    for (let i = 0; i < n; i++) {
      this._grain(this.crackle, {
        t: t + Math.pow(Math.random(), 1.6) * 0.035, dur: rand(0.006, 0.02), freq: rand(1600, 6200) * bright,
        q: rand(0.7, 1.6), gain: rand(0.3, 0.7) * k, pan: pan + rand(-0.12, 0.12), rate: rand(0.8, 1.25),
      });
    }
    this._grain(this.rip, { t: t + 0.003, dur: rand(0.03, 0.06), freq: 3200 * bright, q: 0.7, gain: 0.2 * k, pan });
    this._grain(this.noise, { t, dur: rand(0.025, 0.04), freq: rand(420, 700), type: 'lowpass', q: 1.2, gain: 0.24 * k, pan: pan * 0.5 });
  }

  // Fibres under tension before they break: sparse, quiet creaks.
  stress(level, pan = 0) {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    const n = level > 0.3 ? 2 : 1;
    for (let i = 0; i < n; i++) {
      this._grain(this.rip, { t: t + i * rand(0.004, 0.012), dur: rand(0.006, 0.014), freq: rand(2200, 4800), q: rand(1, 2.4), gain: 0.3 + level * 0.6, pan });
    }
  }

  // Continuous rip texture that takes over when fibres go faster than the ear can separate.
  tearRate(rate, pan = 0) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime, b = this.beds.tear;
    const a = clamp01((rate - 8) / 70);
    b.g.gain.setTargetAtTime(this.enabled ? a * 0.42 : 0, t, a > 0 ? 0.015 : 0.05);
    b.f.frequency.setTargetAtTime((1900 + a * 2600) * this.tone, t, 0.03);
    if (b.p) b.p.pan.setTargetAtTime(pan, t, 0.03);
  }

  // Bending the card: crinkle grains whose density follows the deformation speed.
  crinkle(amount, dt) {
    if (!this.ctx) return;
    const a = clamp01(amount);
    const t = this.ctx.currentTime;
    this.beds.swish.g.gain.setTargetAtTime(this.enabled ? a * a * 0.1 : 0, t, 0.06);
    this.beds.swish.f.frequency.setTargetAtTime((1500 + a * 2500) * this.tone, t, 0.08);
    if (!this.ready || a < 0.03) { this.crinkleCarry = 0; return; }
    this.crinkleCarry += Math.min(90, a * 110) * dt;
    while (this.crinkleCarry >= 1) {
      this.crinkleCarry -= 1;
      if (Math.random() < 0.3) continue;
      this._grain(this.crackle, {
        t: t + Math.random() * dt, dur: rand(0.004, 0.018), freq: rand(2000, 6500), q: rand(0.8, 2),
        gain: rand(0.04, 0.14) * (0.4 + a), pan: rand(-0.5, 0.5), rate: rand(0.85, 1.2),
      });
    }
  }

  // Air moved by the ticket: driven by its real linear and angular speed.
  air(speed) {
    if (!this.ctx) return;
    const a = clamp01((speed - 0.5) / 6);
    const t = this.ctx.currentTime, b = this.beds.air;
    b.g.gain.setTargetAtTime(this.enabled ? a * a * 0.42 : 0, t, 0.05);
    b.f.frequency.setTargetAtTime(280 + a * 1500, t, 0.06);
  }

  // The soft thwap of a card being flicked over.
  flap(intensity = 1) {
    if (!this.ready) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.brown;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.Q.value = 0.9;
    f.frequency.setValueAtTime(1800 * this.tone, t);
    f.frequency.exponentialRampToValueAtTime(320, t + 0.16);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.8 * intensity, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
    src.connect(f).connect(g).connect(this.bus);
    src.start(t, Math.random(), 0.25);
    for (let i = 0; i < 3; i++) {
      this._grain(this.crackle, { t: t + i * 0.012 + Math.random() * 0.01, dur: rand(0.008, 0.02), freq: rand(2500, 5000), gain: 0.08 * intensity, pan: rand(-0.4, 0.4) });
    }
  }

  // ---- interface and gate ---------------------------------------------------------------
  click() {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    this._grain(this.noise, { t, dur: 0.006, freq: 3200, type: 'highpass', gain: 0.16 });
    this._tone({ t, freq: 2100, dur: 0.025, gain: 0.025 });
  }

  // Thermal printer: stepper motor, paper sliding out of the feeder, then the cutter.
  issue() {
    if (!this.ready) return;
    const ctx = this.ctx, t = ctx.currentTime, run = 0.62;
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(96, t);
    osc.frequency.linearRampToValueAtTime(118, t + run);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 520;
    lp.Q.value = 4;
    const chop = ctx.createGain();
    chop.gain.value = 0.6;
    const lfo = ctx.createOscillator();
    lfo.type = 'square';
    lfo.frequency.value = 31;
    const depth = ctx.createGain();
    depth.gain.value = 0.4;
    lfo.connect(depth).connect(chop.gain);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.05, t + 0.03);
    g.gain.setValueAtTime(0.05, t + run - 0.05);
    g.gain.linearRampToValueAtTime(0, t + run);
    osc.connect(lp).connect(chop).connect(g).connect(this.bus);
    osc.start(t); lfo.start(t);
    osc.stop(t + run + 0.05); lfo.stop(t + run + 0.05);

    const slide = ctx.createBufferSource();
    slide.buffer = this.noise;
    const sf = ctx.createBiquadFilter();
    sf.type = 'bandpass';
    sf.Q.value = 0.8;
    sf.frequency.setValueAtTime(900, t);
    sf.frequency.exponentialRampToValueAtTime(2200, t + run);
    const sg = ctx.createGain();
    sg.gain.setValueAtTime(0, t);
    sg.gain.linearRampToValueAtTime(0.05, t + 0.1);
    sg.gain.linearRampToValueAtTime(0, t + run);
    slide.connect(sf).connect(sg).connect(this.bus);
    slide.start(t, Math.random(), run + 0.05);

    for (let i = 0; i < 16; i++) this._grain(this.crackle, { t: t + i * 0.036, dur: 0.008, freq: 1800 + (i % 2) * 500, q: 3, gain: 0.06 });
    this._grain(this.noise, { t: t + run, dur: 0.005, freq: 3500, type: 'highpass', gain: 0.2 });
    this._grain(this.noise, { t: t + run, dur: 0.03, freq: 650, type: 'lowpass', gain: 0.14 });
  }

  // Gate validation: a glassy two-note FM bell with a scanner tick.
  verify() {
    if (!this.ready) return;
    const t = this.ctx.currentTime + 0.04;
    this._grain(this.noise, { t, dur: 0.01, freq: 6000, type: 'highpass', gain: 0.05 });
    this._tone({ t, freq: 1046.5, dur: 1.8, gain: 0.085, pan: -0.25, mod: { ratio: 3.01, index: 1.4, decay: 0.5 } });
    this._tone({ t: t + 0.12, freq: 1567.98, dur: 2.0, gain: 0.07, pan: 0.25, mod: { ratio: 3.01, index: 1.1, decay: 0.6 } });
    this._tone({ t, freq: 523.25, dur: 0.9, gain: 0.05, attack: 0.008 });
  }
}
