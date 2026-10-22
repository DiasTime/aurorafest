// Grainy holographic field behind the hero: the pass foil's own spectrum, domain-warped and
// rendered at half resolution so the grain reads like print. Paused when off screen.
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
  for (int i = 0; i < 5; i++) { v += a * noise(p); p = p * 2.02 + 7.3; a *= 0.5; }
  return v;
}
void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  vec2 p = vec2(uv.x * uRes.x / uRes.y, uv.y) * 1.15;
  float t = uTime * 0.045;
  vec2 q = vec2(fbm(p + vec2(0.0, t)), fbm(p + vec2(5.2, -t)));
  vec2 r = vec2(fbm(p * 1.3 + q * 2.0 + vec2(1.7, 9.2) + t * 0.6), fbm(p * 1.3 + q * 2.0 + vec2(8.3, 2.8) - t * 0.5));
  float f = fbm(p * 0.9 + r * 1.7);

  vec3 pink = vec3(1.0, 0.36, 0.63);
  vec3 orange = vec3(1.0, 0.61, 0.3);
  vec3 cyan = vec3(0.3, 0.84, 0.93);
  vec3 lilac = vec3(0.66, 0.58, 1.0);
  vec3 lemon = vec3(1.0, 0.89, 0.52);
  vec3 col = mix(pink, cyan, smoothstep(0.32, 0.72, f));
  col = mix(col, orange, smoothstep(0.5, 0.9, r.x) * 0.85);
  col = mix(col, lilac, smoothstep(0.58, 0.95, q.y) * 0.4);
  col = mix(col, lemon, smoothstep(0.7, 1.0, r.y) * 0.3);

  float vig = smoothstep(1.3, 0.15, length((uv - vec2(0.55, 0.55)) * vec2(1.1, 1.0)));
  vec3 night = mix(vec3(0.035, 0.035, 0.05), col * (0.16 + 0.36 * vig), 0.92);
  vec3 day = mix(col, vec3(0.98, 0.97, 0.99), 0.16);
  vec3 c = mix(night, day, uDay);
  float g = hash(gl_FragCoord.xy + floor(uTime * 12.0) * vec2(91.7, 37.3)) - 0.5;
  c += g * mix(0.085, 0.075, uDay);
  gl_FragColor = vec4(c, 1.0);
}`;
const vert = `attribute vec2 p; void main() { gl_Position = vec4(p, 0.0, 1.0); }`;

export function startHolo(canvas) {
  const gl = canvas.getContext('webgl', { antialias: false, alpha: false });
  if (!gl) return { setDay() {} };
  const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); return s; };
  const prog = gl.createProgram();
  gl.attachShader(prog, sh(gl.VERTEX_SHADER, vert));
  gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, frag));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return { setDay() {} };
  gl.useProgram(prog);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, 'p');
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  const uRes = gl.getUniformLocation(prog, 'uRes');
  const uTime = gl.getUniformLocation(prog, 'uTime');
  const uDay = gl.getUniformLocation(prog, 'uDay');

  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let day = 0, dayTarget = 0, visible = true, raf = 0, first = true;
  const start = performance.now();
  function draw(now) {
    day += (dayTarget - day) * (first ? 1 : 0.08);
    first = false;
    gl.uniform2f(uRes, canvas.width, canvas.height);
    gl.uniform1f(uTime, reduce ? 30 : (now - start) / 1000 + 30);
    gl.uniform1f(uDay, day);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
  function resize() {
    const s = 0.5 * Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.max(1, Math.round(canvas.clientWidth * s));
    canvas.height = Math.max(1, Math.round(canvas.clientHeight * s));
    gl.viewport(0, 0, canvas.width, canvas.height);
    draw(performance.now());
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
  return { setDay(on) { dayTarget = on ? 1 : 0; kick(); } };
}
