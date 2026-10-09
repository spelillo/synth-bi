// dashboard/src/lib/motion.js — the physics behind every gesture-driven
// motion on the canvas (tile drag, text-box drag, assistant panel resize),
// plus usePresence() for surfaces that enter and leave.
//
// Springs are parameterized the way Apple's design talks describe them:
//   - dampingRatio: 1.0 = critically damped (no overshoot), < 1 bounces
//   - response: roughly how quickly the value gets there, in seconds
// They always start from the value currently on screen and carry the
// current velocity, so a moving thing can be grabbed or re-targeted at any
// instant without a jump or a velocity "brick wall".

import { useLayoutEffect, useState } from 'react';

export const SPRING_MOVE = { dampingRatio: 1, response: 0.4 };      // reposition (Apple: PiP move)
export const SPRING_FLICK = { dampingRatio: 0.8, response: 0.4 };   // only after a release that carried momentum
export const SPRING_SNAPPY = { dampingRatio: 1, response: 0.3 };    // lift, small UI

export function prefersReducedMotion() {
  return typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

// Progressive resistance past a boundary: the further past it, the less the
// element follows. `dimension` is the size of the thing being dragged within.
export function rubberband(overshoot, dimension, constant = 0.55) {
  if (!overshoot || !dimension) return 0;
  return (overshoot * dimension * constant) / (dimension + constant * Math.abs(overshoot));
}

// Where a release at `velocity` (px/s) would coast to, scroll-deceleration
// style (Apple's projection from "Designing Fluid Interfaces").
export function project(velocity, decelerationRate = 0.998) {
  return ((velocity / 1000) * decelerationRate) / (1 - decelerationRate);
}

// One step of a damped spring toward 0 (the caller keeps value as an
// offset from the target). Semi-implicit Euler in small fixed substeps
// stays stable for any frame time.
function stepSpring(state, dt, { dampingRatio, response }) {
  const stiffness = (2 * Math.PI / response) ** 2;
  const damping = (4 * Math.PI * dampingRatio) / response;
  let remaining = Math.min(dt, 0.064);
  while (remaining > 0) {
    const h = Math.min(remaining, 1 / 240);
    state.velocity += (-stiffness * state.value - damping * state.velocity) * h;
    state.value += state.velocity * h;
    remaining -= h;
  }
}

export function springAtRest(state, epsilon = 0.25) {
  return Math.abs(state.value) < epsilon && Math.abs(state.velocity) < epsilon * 4;
}

// Advance a spring { value, velocity } (value = offset from the target).
export function advanceSpring(state, dt, params = SPRING_MOVE, epsilon = 0.25) {
  stepSpring(state, dt, params);
  if (springAtRest(state, epsilon)) {
    state.value = 0;
    state.velocity = 0;
    return false;
  }
  return true;
}

// Animate a scalar from `from` to `to`, handing off `velocity` (units/s)
// from the gesture that released it. Returns { stop, value } — stop() hands
// back the live value so a new gesture can pick it up mid-flight.
export function animateSpring({ from, to, velocity = 0, params = SPRING_MOVE, onUpdate, onDone, epsilon = 0.25 }) {
  const state = { value: from - to, velocity };
  if (prefersReducedMotion()) {
    onUpdate(to);
    if (onDone) onDone();
    return { stop: () => to };
  }
  let raf = 0;
  let last = performance.now();
  const tick = now => {
    const dt = (now - last) / 1000;
    last = now;
    const moving = advanceSpring(state, dt, params, epsilon);
    onUpdate(to + state.value);
    if (moving) raf = requestAnimationFrame(tick);
    else if (onDone) onDone();
  };
  raf = requestAnimationFrame(tick);
  return {
    stop() {
      cancelAnimationFrame(raf);
      return to + state.value;
    },
  };
}

// Pointer velocity from a short history of samples, not just the last two
// points (which are noisy). A pause before release means no momentum.
export class VelocityTracker {
  constructor(windowMs = 100) {
    this.windowMs = windowMs;
    this.samples = [];
  }

  reset() { this.samples = []; }

  add(x, y, t = performance.now()) {
    this.samples.push({ x, y, t });
    while (this.samples.length > 2 && t - this.samples[0].t > this.windowMs) this.samples.shift();
  }

  velocity(now = performance.now()) {
    const s = this.samples;
    if (s.length < 2) return { x: 0, y: 0 };
    const lastSample = s[s.length - 1];
    if (now - lastSample.t > 60) return { x: 0, y: 0 };
    const first = s[0];
    const dt = (lastSample.t - first.t) / 1000;
    if (dt <= 0) return { x: 0, y: 0 };
    return { x: (lastSample.x - first.x) / dt, y: (lastSample.y - first.y) / dt };
  }
}

export function pointFromEvent(e) {
  if (!e) return null;
  const t = e.touches && e.touches[0] ? e.touches[0] : e.changedTouches && e.changedTouches[0] ? e.changedTouches[0] : e;
  return typeof t.clientX === 'number' ? { x: t.clientX, y: t.clientY } : null;
}

// Keeps a surface mounted through its exit so it can leave along the path
// it came in on. `state` drives a data-state attribute:
//   'closed' (first frame, and while leaving) -> 'open' (once shown).
// CSS transitions between the two, so reopening mid-exit simply reverses
// from wherever the surface is.
export function usePresence(open, exitMs = 240) {
  const [phase, setPhase] = useState(open ? 'open' : 'unmounted');
  useLayoutEffect(() => {
    if (open) {
      if (phase === 'open') return undefined;
      setPhase('entering');
      // Two frames: the closed state has to be painted once before the
      // switch to open, or there's nothing to transition from.
      let raf2 = 0;
      const raf1 = requestAnimationFrame(() => { raf2 = requestAnimationFrame(() => setPhase('open')); });
      return () => { cancelAnimationFrame(raf1); cancelAnimationFrame(raf2); };
    }
    if (phase === 'unmounted') return undefined;
    setPhase('exiting');
    const t = setTimeout(() => setPhase('unmounted'), prefersReducedMotion() ? Math.min(exitMs, 170) : exitMs);
    return () => clearTimeout(t);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  return {
    mounted: phase !== 'unmounted',
    state: phase === 'open' ? 'open' : 'closed',
    exiting: phase === 'exiting',
  };
}
