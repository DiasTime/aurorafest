// GSAP choreography. Every effect is gated on prefers-reduced-motion: no-preference, so a viewer who
// asks for less motion gets a still, fully visible page. Without GSAP the page also stays static.
const gsap = window.gsap;
const ScrollTrigger = window.ScrollTrigger;

const qs = (s, r = document) => r.querySelector(s);
const qsa = (s, r = document) => [...r.querySelectorAll(s)];

// Wrap every character of an element in span.ch, keeping nested spans (like outlined letters).
function splitChars(root) {
  if (root.dataset.split === 'chars') return qsa('.ch', root);
  const out = [];
  const walk = (node) => {
    [...node.childNodes].forEach((n) => {
      if (n.nodeType === 3) {
        const frag = document.createDocumentFragment();
        for (const c of n.textContent) {
          if (c === ' ') { frag.append(' '); continue; }
          const s = document.createElement('span');
          s.className = 'ch';
          s.textContent = c;
          frag.append(s);
          out.push(s);
        }
        n.replaceWith(frag);
      } else if (n.nodeType === 1) walk(n);
    });
  };
  walk(root);
  root.dataset.split = 'chars';
  return out;
}

function splitWords(el) {
  const words = el.textContent.trim().split(/\s+/);
  el.textContent = '';
  return words.map((w, i) => {
    const s = document.createElement('span');
    s.className = 'w';
    s.textContent = w;
    el.append(s);
    if (i < words.length - 1) el.append(' ');
    return s;
  });
}

export function initMotion() {
  const noop = { onLang() {}, tab() {}, counter(el, from, to, fmt) { el.textContent = fmt(to); } };
  if (!gsap || !ScrollTrigger) return noop;
  gsap.registerPlugin(ScrollTrigger);
  const mm = gsap.matchMedia();
  const MOTION = '(prefers-reduced-motion: no-preference)';
  let motionOK = matchMedia(MOTION).matches;

  // ---- hero: load sequence, ambient orbits, scroll parallax ------------------------------------
  mm.add(MOTION, () => {
    const chars = qsa('.wm-line').flatMap((l) => splitChars(l));
    const tl = gsap.timeline({ defaults: { ease: 'expo.out' } });
    tl.from('#holo', { opacity: 0, duration: 1.8, ease: 'power2.out' }, 0)
      .from('.hero-eyebrow', { y: 24, opacity: 0, duration: 1 }, 0.15)
      .from(chars, { yPercent: 118, rotate: 7, duration: 1.35, stagger: 0.035 }, 0.2)
      .from('.headliners', { y: 28, opacity: 0, duration: 1 }, 0.75)
      .from('.hero-ctas > *', { y: 28, opacity: 0, duration: 1, stagger: 0.08 }, 0.85)
      .from('.hero-visual .orbits i', { scale: 0.55, opacity: 0, duration: 1.8, stagger: 0.12 }, 0.4)
      .from('.sticker', { scale: 0, rotation: -50, duration: 1.2, stagger: 0.12, ease: 'back.out(1.9)' }, 0.95)
      .from('.badge', { scale: 0.3, opacity: 0, duration: 1.3, ease: 'back.out(1.6)' }, 1.15)
      .from('#hero-hint', { opacity: 0, duration: 1 }, 1.5);

    gsap.to('.badge svg', { rotation: 360, duration: 26, repeat: -1, ease: 'none', transformOrigin: '50% 50%' });
    qsa('.orbits i').forEach((el, i) => gsap.to(el, { rotation: i % 2 ? -360 : 360, duration: 80 + i * 26, repeat: -1, ease: 'none' }));

    const scrub = { trigger: '.hero', start: 'top top', end: 'bottom top', scrub: true };
    gsap.to('.wordmark', { yPercent: 22, ease: 'none', scrollTrigger: scrub });
    gsap.to(['.headliners', '.hero-ctas', '.hero-eyebrow'], { y: -40, opacity: 0.15, ease: 'none', scrollTrigger: scrub });
    gsap.to('#holo', { scale: 1.12, ease: 'none', scrollTrigger: scrub });
    gsap.to('.hero-visual', { y: -90, ease: 'none', scrollTrigger: scrub });
    qsa('.sticker').forEach((s) => gsap.to(s, { y: +s.dataset.speed || -80, rotation: '+=18', ease: 'none', scrollTrigger: scrub }));
  });

  // ---- nav hides on the way down, returns on the way up -----------------------------------------
  mm.add(MOTION, () => {
    const nav = qs('#nav');
    let shown = true;
    const show = (on) => {
      if (on === shown) return;
      shown = on;
      gsap.to(nav, { yPercent: on ? 0 : -170, duration: 0.6, ease: 'power3.out' });
    };
    ScrollTrigger.create({ start: 0, end: 'max', onUpdate: (self) => show(self.scroll() < 160 || self.direction < 0) });
  });

  // ---- marquee tape, sped up by scroll velocity -----------------------------------------------------
  mm.add(MOTION, () => {
    const loop = gsap.to('.tape-track', { xPercent: -50, duration: 36, ease: 'none', repeat: -1 });
    let settle;
    ScrollTrigger.create({
      trigger: '.tape', start: 'top bottom', end: 'bottom top',
      onUpdate: (self) => {
        const boost = Math.min(5, 1 + Math.abs(self.getVelocity()) / 300);
        gsap.to(loop, { timeScale: boost, duration: 0.2, overwrite: true });
        settle?.kill();
        settle = gsap.to(loop, { timeScale: 1, duration: 1.4, delay: 0.25 });
      },
    });
  });

  // ---- section titles ----------------------------------------------------------------------------------
  mm.add(MOTION, () => {
    qsa('.sec-title, .about-title, .desk-head .h2, .faq-side .h2').forEach((el) => {
      gsap.from(el, { y: 60, opacity: 0, duration: 1.2, ease: 'expo.out', scrollTrigger: { trigger: el, start: 'top 88%', once: true } });
    });
  });

  // ---- about: shimmering pills, word scrub, counters ------------------------------------------------
  let scrubTween = null;
  const buildScrub = () => {
    scrubTween?.scrollTrigger?.kill();
    scrubTween?.kill();
    scrubTween = null;
    if (!motionOK) return;
    const el = qs('.scrub-text');
    const words = splitWords(el);
    scrubTween = gsap.fromTo(words, { opacity: 0.14 }, {
      opacity: 1, stagger: 0.08, ease: 'none',
      scrollTrigger: { trigger: el, start: 'top 82%', end: 'bottom 48%', scrub: true },
    });
  };
  mm.add(MOTION, () => {
    gsap.to('.pill', { backgroundPosition: '100% 50%', duration: 5, repeat: -1, yoyo: true, ease: 'sine.inOut', stagger: 1.2 });
    buildScrub();
    qsa('.stat').forEach((li) => {
      const num = qs('.stat-num', li);
      const target = +num.dataset.count;
      const suffix = num.dataset.suffix || '';
      const o = { v: 0 };
      const st = { trigger: li, start: 'top 88%', once: true };
      gsap.from(li, { x: 60, opacity: 0, duration: 1.1, ease: 'expo.out', scrollTrigger: st });
      gsap.to(o, { v: target, duration: 1.8, ease: 'power3.out', scrollTrigger: st, onUpdate: () => { num.textContent = `${Math.round(o.v)}${suffix}`; } });
    });
    return () => { scrubTween?.scrollTrigger?.kill(); scrubTween?.kill(); scrubTween = null; };
  });

  // ---- headliners: staged entry, art parallax, and the accordion -------------------------------------------
  mm.add(MOTION, () => {
    gsap.from('.head', { y: 90, opacity: 0, duration: 1.3, stagger: 0.12, ease: 'expo.out', scrollTrigger: { trigger: '.heads', start: 'top 85%', once: true } });
    qsa('.head-art').forEach((c) => gsap.fromTo(c, { yPercent: -4 }, { yPercent: 4, ease: 'none', scrollTrigger: { trigger: c.parentElement, start: 'top bottom', end: 'bottom top', scrub: true } }));
    gsap.from('.poster:not([hidden]) .act', { y: 40, opacity: 0, duration: 1, stagger: 0.06, ease: 'expo.out', scrollTrigger: { trigger: '.full-lineup', start: 'top 85%', once: true } });
  });
  mm.add({ desk: '(min-width: 900px)', calm: '(prefers-reduced-motion: reduce)' }, (ctx) => {
    const { desk, calm } = ctx.conditions;
    const heads = qsa('.head');
    const infos = heads.map((h) => qs('.head-info', h));
    if (!desk) {
      gsap.set([...heads, ...infos], { clearProps: 'flexGrow,opacity,y' });
      return undefined;
    }
    const open = (i) => {
      heads.forEach((h, k) => h.classList.toggle('is-open', k === i));
      gsap.to(heads, { flexGrow: (k) => (k === i ? 2.6 : 1), duration: calm ? 0 : 0.95, ease: 'expo.out', overwrite: true });
      gsap.to(infos, { opacity: (k) => (k === i ? 1 : 0), y: (k) => (k === i ? 0 : 18), duration: calm ? 0 : 0.6, ease: 'power3.out', overwrite: true });
    };
    const fns = heads.map((h, i) => {
      const fn = () => open(i);
      h.addEventListener('mouseenter', fn);
      h.addEventListener('focus', fn);
      h.addEventListener('click', fn);
      return fn;
    });
    open(Math.max(0, heads.findIndex((h) => h.classList.contains('is-open'))));
    return () => heads.forEach((h, i) => {
      h.removeEventListener('mouseenter', fns[i]);
      h.removeEventListener('focus', fns[i]);
      h.removeEventListener('click', fns[i]);
    });
  });

  // ---- festival bento ----------------------------------------------------------------------------------
  mm.add(MOTION, () => {
    gsap.set('.cell', { y: 80, scale: 0.96, opacity: 0 });
    ScrollTrigger.batch('.cell', {
      start: 'top 90%', once: true,
      onEnter: (batch) => gsap.to(batch, { y: 0, scale: 1, opacity: 1, duration: 1.2, stagger: 0.12, ease: 'expo.out' }),
    });
    qsa('.mini-stats b').forEach((b) => {
      const target = +b.textContent;
      const o = { v: 0 };
      gsap.to(o, { v: target, duration: 1.6, ease: 'power3.out', scrollTrigger: { trigger: b, start: 'top 92%', once: true }, onUpdate: () => { b.textContent = Math.round(o.v); } });
    });
  });

  // ---- venue: the outlined word fills letter by letter, the map grows in ------------------------------------
  mm.add(MOTION, () => {
    const word = qs('.venue-word > span');
    const chars = splitChars(word);
    gsap.fromTo(chars, { '--fill': 0 }, { '--fill': 1, stagger: 0.08, ease: 'none', scrollTrigger: { trigger: '.venue-word', start: 'top 85%', end: 'top 30%', scrub: true } });
    gsap.fromTo(word, { xPercent: -5 }, { xPercent: 3, ease: 'none', scrollTrigger: { trigger: '.venue', start: 'top bottom', end: 'bottom top', scrub: true } });
    gsap.fromTo('.map-wrap', { scale: 0.86, opacity: 0.35 }, { scale: 1, opacity: 1, ease: 'none', scrollTrigger: { trigger: '.map-wrap', start: 'top 98%', end: 'top 45%', scrub: true } });
    gsap.from('.facts > div', { y: 40, opacity: 0, duration: 1, stagger: 0.08, ease: 'expo.out', scrollTrigger: { trigger: '.facts', start: 'top 92%', once: true } });
  });

  // ---- pass desk ----------------------------------------------------------------------------------------
  mm.add(MOTION, () => {
    gsap.from('.desk-shell', { x: -60, opacity: 0, duration: 1.3, ease: 'expo.out', scrollTrigger: { trigger: '.passes', start: 'top 75%', once: true } });
    gsap.from('.tier', { y: 30, opacity: 0, duration: 0.9, stagger: 0.08, ease: 'expo.out', scrollTrigger: { trigger: '.tiers', start: 'top 88%', once: true } });
  });

  // ---- FAQ: the title stays pinned while the answers scroll past ----------------------------------------------
  mm.add('(min-width: 900px)', () => {
    const side = qs('.faq-side');
    ScrollTrigger.create({
      trigger: '.faq-grid', pin: side, pinSpacing: false,
      start: 'top 110px',
      end: () => `bottom ${110 + side.offsetHeight}px`,
    });
  });
  mm.add(MOTION, () => {
    ScrollTrigger.batch('.qa', {
      start: 'top 92%', once: true,
      onEnter: (batch) => gsap.fromTo(batch, { y: 50, opacity: 0 }, { y: 0, opacity: 1, duration: 1, stagger: 0.08, ease: 'expo.out' }),
    });
  });

  // ---- finale --------------------------------------------------------------------------------------------
  mm.add(MOTION, () => {
    gsap.from('.fl', { yPercent: 60, opacity: 0, duration: 1.3, stagger: 0.12, ease: 'expo.out', scrollTrigger: { trigger: '.finale', start: 'top 78%', once: true } });
    gsap.fromTo('.finale', { '--shift': 0 }, { '--shift': 1, ease: 'none', scrollTrigger: { trigger: '.finale', start: 'top bottom', end: 'bottom top', scrub: true } });
  });

  // ---- magnetic buttons on fine pointers --------------------------------------------------------------------
  mm.add(`(hover: hover) and (pointer: fine) and ${MOTION}`, () => {
    const cleanups = qsa('.magnetic').map((btn) => {
      const xTo = gsap.quickTo(btn, 'x', { duration: 0.5, ease: 'power3.out' });
      const yTo = gsap.quickTo(btn, 'y', { duration: 0.5, ease: 'power3.out' });
      const move = (e) => {
        const r = btn.getBoundingClientRect();
        xTo((e.clientX - (r.left + r.width / 2)) * 0.22);
        yTo((e.clientY - (r.top + r.height / 2)) * 0.32);
      };
      const leave = () => gsap.to(btn, { x: 0, y: 0, duration: 1, ease: 'elastic.out(1, 0.4)' });
      btn.addEventListener('pointermove', move);
      btn.addEventListener('pointerleave', leave);
      return () => { btn.removeEventListener('pointermove', move); btn.removeEventListener('pointerleave', leave); };
    });
    return () => cleanups.forEach((f) => f());
  });

  matchMedia(MOTION).addEventListener('change', (e) => { motionOK = e.matches; });
  document.fonts?.ready?.then(() => ScrollTrigger.refresh());

  return {
    // re-split the scrubbed paragraph after the language changes its text
    onLang() {
      buildScrub();
      ScrollTrigger.refresh();
    },
    tab(panel) {
      if (!motionOK) return;
      gsap.fromTo(qsa('.act', panel), { y: 36, opacity: 0 }, { y: 0, opacity: 1, duration: 0.8, stagger: 0.05, ease: 'expo.out' });
    },
    // count from whatever the viewer currently sees, so quick clicks never jump
    counter(el, from, to, fmt) {
      el.acTween?.kill();
      const start = el.acVal ?? from;
      if (!motionOK || start === to) { el.acVal = to; el.textContent = fmt(to); return; }
      const o = { v: start };
      el.acTween = gsap.to(o, {
        v: to, duration: 0.7, ease: 'power3.out',
        onUpdate: () => { el.acVal = o.v; el.textContent = fmt(Math.round(o.v)); },
      });
    },
  };
}
