// GSAP choreography with Lenis smooth scrolling. Every effect is gated on
// prefers-reduced-motion: no-preference, so a viewer who asks for less motion gets a still,
// fully visible page with native scrolling. Without GSAP the page also stays static.
const gsap = window.gsap;
const ScrollTrigger = window.ScrollTrigger;
const Lenis = window.Lenis;

const qs = (s, r = document) => r.querySelector(s);
const qsa = (s, r = document) => [...r.querySelectorAll(s)];
const clamp01 = (x) => Math.min(1, Math.max(0, x));

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

export function initMotion({ scenes } = {}) {
  const noop = { onLang() {}, tab() {}, refresh() {}, counter(el, from, to, fmt) { el.textContent = fmt(to); } };
  const MOTION = '(prefers-reduced-motion: no-preference)';
  let motionOK = matchMedia(MOTION).matches;
  if (!gsap || !ScrollTrigger) {
    initStaticScenes(scenes);
    return noop;
  }
  gsap.registerPlugin(ScrollTrigger);
  const mm = gsap.matchMedia();

  // ---- smooth scrolling ------------------------------------------------------------------------
  let lenis = null;
  if (motionOK && Lenis) {
    lenis = new Lenis({ lerp: 0.1, smoothWheel: true, wheelMultiplier: 1 });
    lenis.on('scroll', ScrollTrigger.update);
    gsap.ticker.add((t) => lenis.raf(t * 1000));
    gsap.ticker.lagSmoothing(0);
  }
  document.addEventListener('click', (e) => {
    const a = e.target.closest('a[href^="#"]');
    if (!a) return;
    const id = a.getAttribute('href');
    const el = id.length > 1 && document.querySelector(id);
    if (!el) return;
    e.preventDefault();
    a.closest('details')?.removeAttribute('open');
    if (lenis) lenis.scrollTo(el, { offset: -8, duration: 1.6 });
    else el.scrollIntoView({ behavior: motionOK ? 'smooth' : 'auto' });
  });

  // ---- chapter scenes: which picture is on, and how much of it has burned away --------------------
  const sceneSections = qsa('[data-scene]');
  const visible = new Set();
  const state = new Map(); // section -> dissolve
  const pushScene = () => {
    if (!scenes) return;
    const sec = [...visible].pop();
    if (!sec) { scenes.hide(); return; }
    scenes.show(sec.dataset.scene, state.get(sec) ?? 0);
  };
  sceneSections.forEach((sec) => {
    state.set(sec, 0);
    ScrollTrigger.create({
      trigger: sec, start: 'top bottom', end: 'bottom top',
      onToggle: (self) => { if (self.isActive) visible.add(sec); else visible.delete(sec); pushScene(); },
    });
    if (!motionOK) return;
    if (sec.classList.contains('cover')) {
      // the cover burns away while its sticky frame holds
      ScrollTrigger.create({
        trigger: sec, start: 'top top', end: 'bottom bottom', scrub: true,
        onUpdate: (self) => { state.set(sec, clamp01((self.progress - 0.12) / 0.72)); pushScene(); },
      });
    } else {
      // an opener assembles from glitter while it rises into view
      ScrollTrigger.create({
        trigger: sec, start: 'top bottom', end: 'top top', scrub: true,
        onUpdate: (self) => { state.set(sec, clamp01(1 - self.progress * 1.15)); pushScene(); },
      });
    }
  });

  // ---- chapter rail: current chapter and a tone that reads on scenes and on paper ------------------
  const rail = qs('#rail');
  const railLinks = qsa('.rail a, .toc-menu a');
  qsa('.chapter').forEach((ch) => {
    const mark = qs(`.rail a[href="#${ch.id}"]`);
    ScrollTrigger.create({
      trigger: ch, start: 'top 55%', end: 'bottom 55%',
      onToggle: (self) => {
        if (!self.isActive) return;
        railLinks.forEach((a) => a.classList.toggle('is-active', a.getAttribute('href') === `#${ch.id}`));
      },
      // reading progress: finished chapters stay underlined, the current one grows
      onUpdate: (self) => mark?.style.setProperty('--p', self.progress.toFixed(3)),
      onRefresh: (self) => mark?.style.setProperty('--p', self.progress.toFixed(3)),
    });
  });
  ScrollTrigger.create({ trigger: '.about', start: 'top 55%', onLeaveBack: () => railLinks.forEach((a) => a.classList.remove('is-active')) });
  const toneCheck = () => {
    if (!rail) return;
    const hit = document.elementsFromPoint(60, innerHeight - 80).find((e) => !e.closest('.rail, .nav') && e !== document.body && e !== document.documentElement);
    // light over the chapter pictures, and over the cover once it has mostly burned into night sky
    const art = hit && hit.closest('.opener, .cover');
    rail.dataset.tone = art && (art.classList.contains('opener') || (state.get(art) ?? 0) > 0.5) ? 'light' : 'ink';
  };
  ScrollTrigger.create({ start: 0, end: 'max', onUpdate: toneCheck });
  ScrollTrigger.addEventListener('refresh', toneCheck);
  toneCheck();

  // ---- cover: load sequence, ambient orbits, burn-away on scroll ---------------------------------------
  mm.add(MOTION, () => {
    const chars = qsa('.wm-line').flatMap((l) => splitChars(l));
    // hold the entrance until the display face has arrived, so the wordmark never swaps fonts mid-flight
    const tl = gsap.timeline({ defaults: { ease: 'expo.out' }, paused: true });
    Promise.race([document.fonts?.ready ?? Promise.resolve(), new Promise((r) => setTimeout(r, 1200))]).then(() => tl.play());
    tl.from('.hero-eyebrow', { y: 24, opacity: 0, duration: 1 }, 0.15)
      .from(chars, { yPercent: 118, rotate: 7, duration: 1.35, stagger: 0.035 }, 0.2)
      .from('.headliners', { y: 28, opacity: 0, duration: 1 }, 0.75)
      .from('.hero-ctas > *', { y: 28, opacity: 0, duration: 1, stagger: 0.08 }, 0.85)
      .from('.hero-visual .orbits i', { scale: 0.55, opacity: 0, duration: 1.8, stagger: 0.12 }, 0.4)
      .from('.sticker', { scale: 0, rotation: -50, duration: 1.2, stagger: 0.12, ease: 'back.out(1.9)' }, 0.95)
      .from('.badge', { scale: 0.3, opacity: 0, duration: 1.3, ease: 'back.out(1.6)' }, 1.15)
      .from('#hero-hint', { opacity: 0, duration: 1 }, 1.5);

    gsap.to('.badge svg', { rotation: 360, duration: 26, repeat: -1, ease: 'none', transformOrigin: '50% 50%' });
    qsa('.orbits i').forEach((el, i) => gsap.to(el, { rotation: i % 2 ? -360 : 360, duration: 80 + i * 26, repeat: -1, ease: 'none' }));

    const burn = { trigger: '.cover', start: 'top top', end: 'bottom bottom', scrub: true };
    gsap.to('.wordmark', { yPercent: -18, opacity: 0, ease: 'power1.in', scrollTrigger: burn });
    gsap.to(['.headliners', '.hero-ctas', '.hero-eyebrow', '#hero-hint'], { y: -50, opacity: 0, ease: 'power1.in', scrollTrigger: burn });
    gsap.to('.hero-visual', { y: -120, ease: 'none', scrollTrigger: burn });
    gsap.to('.fig-a', { xPercent: -30, yPercent: -12, rotation: -8, opacity: 0, ease: 'power1.in', scrollTrigger: burn });
    qsa('.sticker').forEach((s) => gsap.to(s, { y: (+s.dataset.speed || -80) * 2.2, rotation: '+=40', opacity: 0, ease: 'power1.in', scrollTrigger: burn }));
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
        gsap.to(loop, { timeScale: Math.min(5, 1 + Math.abs(self.getVelocity()) / 300), duration: 0.2, overwrite: true });
        settle?.kill();
        settle = gsap.to(loop, { timeScale: 1, duration: 1.4, delay: 0.25 });
      },
    });
  });

  // ---- chapter openers: numeral, title and serif line rise with the picture --------------------------
  mm.add(MOTION, () => {
    qsa('.opener').forEach((op) => {
      const st = { trigger: op, start: 'top 80%', end: 'top 5%', scrub: true };
      // the title rises out of a slot: clipped from below while it slides up
      gsap.fromTo(qs('.op-title', op),
        { yPercent: 38, clipPath: 'inset(0% 0% 100% 0%)' },
        { yPercent: 0, clipPath: 'inset(0% 0% -10% 0%)', ease: 'none', scrollTrigger: st });
      gsap.fromTo([qs('.op-num', op), qs('.op-kicker', op)], { y: 40, opacity: 0 }, { y: 0, opacity: 1, ease: 'none', scrollTrigger: st });
      gsap.fromTo(qs('.op-sub', op), { y: 60, opacity: 0 }, { y: 0, opacity: 1, ease: 'none', scrollTrigger: { trigger: op, start: 'top 55%', end: 'top -10%', scrub: true } });
    });
  });

  // ---- titles on paper ------------------------------------------------------------------------------
  mm.add(MOTION, () => {
    qsa('.about-title, .desk-head .h2, .faq-side .h2, .feat-name').forEach((el) => {
      gsap.from(el, { y: 60, opacity: 0, duration: 1.2, ease: 'expo.out', scrollTrigger: { trigger: el, start: 'top 88%', once: true } });
    });
  });

  // ---- prologue: shimmering pills, word scrub, counters -----------------------------------------------
  let scrubTween = null;
  const buildScrub = () => {
    scrubTween?.scrollTrigger?.kill();
    scrubTween?.kill();
    scrubTween = null;
    if (!motionOK) return;
    const el = qs('.scrub-text');
    scrubTween = gsap.fromTo(splitWords(el), { opacity: 0.14 }, {
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

  // ---- night chapters: the headliner card grows in, the lineup rows follow -------------------------------
  mm.add(MOTION, () => {
    qsa('.feat-media').forEach((m) => {
      gsap.fromTo(m, { scale: 0.86, opacity: 0.4 }, { scale: 1, opacity: 1, ease: 'none', scrollTrigger: { trigger: m, start: 'top 98%', end: 'top 45%', scrub: true } });
      gsap.fromTo(qs('.feat-art', m), { yPercent: -4 }, { yPercent: 4, ease: 'none', scrollTrigger: { trigger: m, start: 'top bottom', end: 'bottom top', scrub: true } });
    });
    gsap.set('.acts-grid li', { y: 40, opacity: 0 });
    ScrollTrigger.batch('.acts-grid li', {
      start: 'top 92%', once: true,
      onEnter: (batch) => gsap.to(batch, { y: 0, opacity: 1, duration: 1, stagger: 0.07, ease: 'expo.out' }),
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
    // the last traveller leaps in towards the dates as the page ends
    gsap.fromTo('.fig-finale', { xPercent: 34, yPercent: 14, rotation: 9, opacity: 0 }, {
      xPercent: 0, yPercent: 0, rotation: 0, opacity: 1, ease: 'none',
      scrollTrigger: { trigger: '.finale', start: 'top 92%', end: 'top 18%', scrub: true },
    });
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
    onLang() {
      buildScrub();
      ScrollTrigger.refresh();
    },
    refresh() { ScrollTrigger.refresh(); },
    tab() {},
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

// Without GSAP: show whichever scene section is on screen, fully assembled.
function initStaticScenes(scenes) {
  if (!scenes) return;
  const on = new Set();
  const io = new IntersectionObserver((entries) => {
    entries.forEach((e) => { if (e.isIntersecting) on.add(e.target); else on.delete(e.target); });
    const sec = [...on].pop();
    if (sec) scenes.show(sec.dataset.scene, 0); else scenes.hide();
  });
  qsa('[data-scene]').forEach((s) => io.observe(s));
}
