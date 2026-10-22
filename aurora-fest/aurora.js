// Aurora curtains behind the hero: raw WebGL, half resolution, paused when off screen.
const frag = `
precision highp float;
uniform vec2 uRes;
uniform float uTime;
uniform float uDay;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++) { v += a * noise(p); p = p * 2.03 + 11.7; a *= 0.5; }
  return v;
}
void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  float aspect = uRes.x / uRes.y;
  float x = uv.x * aspect;
  float t = uTime * 0.045;
  float glow = 0.0;
  float hueMix = 0.0;
  for (int i = 0; i < 3; i++) {
    float fi = float(i);
    float wave = fbm(vec2(x * 0.9 + fi * 3.1, t * 1.6 + fi * 2.0));
    float center = 0.6 + 0.1 * sin(x * 1.7 + t * 2.4 + fi * 1.9) + (wave - 0.5) * 0.32 + fi * 0.06;
    float d = uv.y - center;
    float curtain = exp(-max(d, 0.0) * (3.2 + fi)) * smoothstep(-0.07, 0.015, d);
    float rays = 0.45 + 0.55 * fbm(vec2(x * 16.0 + wave * 5.0, uv.y * 1.2 - t * 5.0 + fi));
    float c = curtain * rays * (0.75 - fi * 0.18);
    glow += c;
    hueMix += c * fi;
  }
  hueMix /= max(glow, 0.001);
  vec3 green = vec3(0.24, 0.86, 0.6);
  vec3 teal = vec3(0.14, 0.62, 0.86);
  vec3 rose = vec3(0.86, 0.32, 0.56);
  vec3 col = mix(green, teal, clamp(hueMix * 0.6 + 0.25 * sin(x * 0.8 + t * 3.0), 0.0, 1.0));
  col = mix(col, rose, smoothstep(0.72, 1.0, uv.y) * 0.45);
  float stars = step(0.9965, hash(floor(gl_FragCoord.xy * 0.5))) * smoothstep(0.35, 0.95, uv.y) * (1.0 - uDay);
  vec3 night = vec3(0.027, 0.031, 0.043) + col * glow * 0.62 + stars * 0.5;
  vec3 dayBg = vec3(0.91, 0.918, 0.914);
  vec3 day = mix(dayBg, mix(dayBg, col, 0.55), clamp(glow * 0.5, 0.0, 1.0));
  gl_FragColor = vec4(mix(night, day, uDay), 1.0);
}`;
const vert = `attribute vec2 p; void main() { gl_Position = vec4(p, 0.0, 1.0); }`;

export function startAurora(canvas) {
  const gl = canvas.getContext('webgl', { antialias: false, alpha: false, premultipliedAlpha: false });
  if (!gl) return { setDay() {} };
  const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); return s; };
  const prog = gl.createProgram();
  gl.attachShader(prog, sh(gl.VERTEX_SHADER, vert));
  gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, frag));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return { setDay() {} };
  gl.useProgram(prog);
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, 'p');
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  const uRes = gl.getUniformLocation(prog, 'uRes');
  const uTime = gl.getUniformLocation(prog, 'uTime');
  const uDay = gl.getUniformLocation(prog, 'uDay');

  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let day = 0, dayTarget = 0, visible = true, raf = 0;
  const start = performance.now();
  function resize() {
    const s = 0.5 * Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.max(1, Math.round(canvas.clientWidth * s));
    canvas.height = Math.max(1, Math.round(canvas.clientHeight * s));
    gl.viewport(0, 0, canvas.width, canvas.height);
    draw(performance.now());
  }
  function draw(now) {
    day += (dayTarget - day) * 0.08;
    gl.uniform2f(uRes, canvas.width, canvas.height);
    gl.uniform1f(uTime, reduce ? 40 : (now - start) / 1000 + 40);
    gl.uniform1f(uDay, day);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
  function loop(now) {
    raf = 0;
    if (!visible) return;
    draw(now);
    if (!reduce || Math.abs(dayTarget - day) > 0.002) raf = requestAnimationFrame(loop);
  }
  const kick = () => { if (!raf && visible) raf = requestAnimationFrame(loop); };
  new ResizeObserver(resize).observe(canvas);
  new IntersectionObserver(([e]) => { visible = e.isIntersecting; kick(); }).observe(canvas);
  resize();
  kick();
  return { setDay(on) { dayTarget = on ? 1 : 0; kick(); } };
}
