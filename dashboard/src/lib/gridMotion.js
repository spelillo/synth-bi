// dashboard/src/lib/gridMotion.js — spring motion layered over
// react-grid-layout, so tiles and text boxes move like physical objects:
//
//   - Drag tracks the pointer 1:1 from wherever the tile was grabbed
//     (react-grid-layout's own drag), with a small lift on pickup.
//   - Dragging past the canvas's left, right, or top edge rubber-bands
//     instead of running off the canvas.
//   - On release the tile springs into its grid slot carrying the
//     pointer's velocity, so there's no seam between dragging and settling.
//   - Every other tile that reflows (Snap up layout, add/remove, resize)
//     springs from where it is on screen to where it now belongs. A tile
//     still moving can be grabbed mid-flight; it doesn't jump.
//
// How: each grid item's content sits in a .grid-motion wrapper. The grid
// item itself always sits at its real (logical) position, written by
// react-grid-layout; the wrapper carries a transient offset from it that
// springs to zero (FLIP, with physics instead of a fixed-duration curve).
// A MutationObserver on the items' style attribute notices position
// changes right after React commits them and before the browser paints,
// so the old position is never shown jumping.

import {
  SPRING_FLICK,
  SPRING_MOVE,
  SPRING_SNAPPY,
  VelocityTracker,
  advanceSpring,
  pointFromEvent,
  prefersReducedMotion,
  rubberband,
} from './motion.js';

const LIFT_SCALE = 0.015;
const FLICK_SPEED = 450; // px/s — releases faster than this earn a little bounce

const spring = () => ({ value: 0, velocity: 0 });

export class GridMotion {
  constructor() {
    this.items = new Map();
    this.wrap = null;
    this.observer = null;
    this.raf = 0;
    this.last = 0;
    this.drag = null;
    this.gridWidth = 0;
    this.tracker = new VelocityTracker();
    this.tick = this.tick.bind(this);
    this.onDragStart = this.onDragStart.bind(this);
    this.onDrag = this.onDrag.bind(this);
    this.onDragStop = this.onDragStop.bind(this);
    this.onResizeStart = this.onResizeStart.bind(this);
    this.onResizeStop = this.onResizeStop.bind(this);
  }

  attach(wrap) {
    if (wrap === this.wrap) return;
    this.detach();
    this.wrap = wrap;
    if (!wrap) return;
    this.observer = new MutationObserver(records => {
      if (records.some(r => r.target.classList && r.target.classList.contains('react-grid-item'))) this.sync();
    });
    this.observer.observe(wrap, { subtree: true, attributes: true, attributeFilter: ['style'] });
    this.sync();
  }

  detach() {
    if (this.observer) this.observer.disconnect();
    this.observer = null;
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.items.clear();
    this.wrap = null;
  }

  grid() {
    return this.wrap ? this.wrap.querySelector('.react-grid-layout') : null;
  }

  static position(el) {
    const m = /translate\((-?[\d.]+)px,\s*(-?[\d.]+)px\)/.exec(el.style.transform || '');
    return m ? { x: Number(m[1]), y: Number(m[2]) } : { x: el.offsetLeft, y: el.offsetTop };
  }

  // Compare every item's logical position with the last one seen; whatever
  // moved gets the difference added to its spring, so it starts from where
  // it is on screen right now.
  sync() {
    const grid = this.grid();
    if (!grid) return;
    const width = grid.clientWidth;
    // The canvas itself changed width (window or assistant panel resize):
    // everything shifts together, which shouldn't animate.
    const relayout = width !== this.gridWidth;
    this.gridWidth = width;
    const reduce = prefersReducedMotion();
    const seen = new Set();
    let started = false;
    grid.querySelectorAll(':scope > .react-grid-item[data-motion-id]').forEach(el => {
      const id = el.dataset.motionId;
      seen.add(id);
      const pos = GridMotion.position(el);
      let it = this.items.get(id);
      if (!it || it.el !== el) {
        it = { id, el, inner: null, pos, x: spring(), y: spring(), s: spring(), lift: 0, params: SPRING_MOVE };
        this.items.set(id, it);
      }
      if (!it.inner || !it.inner.isConnected) it.inner = el.querySelector(':scope > .grid-motion');
      const dx = it.pos.x - pos.x;
      const dy = it.pos.y - pos.y;
      it.pos = pos;
      if (!dx && !dy) return;
      if (this.drag && this.drag.id === id) return; // follows the pointer 1:1
      if (relayout || reduce) return;
      it.x.value += dx;
      it.y.value += dy;
      this.apply(it);
      started = true;
    });
    for (const id of [...this.items.keys()]) if (!seen.has(id)) this.items.delete(id);
    if (started) this.start();
  }

  apply(it) {
    if (!it.inner) return;
    const scale = 1 + it.lift + it.s.value;
    const x = it.x.value;
    const y = it.y.value;
    const atRest = Math.abs(x) < 0.01 && Math.abs(y) < 0.01 && Math.abs(scale - 1) < 0.0001;
    it.inner.style.transform = atRest ? '' : `translate3d(${x.toFixed(2)}px, ${y.toFixed(2)}px, 0) scale(${scale.toFixed(4)})`;
    it.inner.style.willChange = atRest ? '' : 'transform';
    it.displaced = !atRest;
  }

  start() {
    if (this.raf) return;
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.tick);
  }

  tick(now) {
    const dt = Math.max(0, (now - this.last) / 1000);
    this.last = now;
    let moving = false;
    this.items.forEach(it => {
      const dragging = this.drag && this.drag.id === it.id;
      let m = false;
      if (!dragging) {
        const mx = advanceSpring(it.x, dt, it.params);
        const my = advanceSpring(it.y, dt, it.params);
        m = mx || my;
      }
      const ms = advanceSpring(it.s, dt, SPRING_SNAPPY, 0.0005);
      // A spring that just came to rest still needs its final (identity) frame.
      if (m || ms || dragging || it.displaced) this.apply(it);
      if (!m && !dragging && it.params !== SPRING_MOVE) it.params = SPRING_MOVE;
      moving = moving || m || ms;
    });
    this.raf = moving ? requestAnimationFrame(this.tick) : 0;
  }

  // Re-target the lift (scale) spring from wherever it is now.
  setLift(it, lift) {
    if (prefersReducedMotion()) lift = 0;
    it.s.value += it.lift - lift;
    it.lift = lift;
    if (it.inner) it.inner.classList.toggle('is-lifted', lift > 0);
    this.start();
  }

  itemFor(element, layoutItem) {
    const id = layoutItem && layoutItem.i;
    if (!this.items.has(id)) this.sync();
    return this.items.get(id) || null;
  }

  // react-grid-layout callbacks: (layout, oldItem, newItem, placeholder, e, element)
  onDragStart(layout, oldItem, newItem, placeholder, e, element) {
    const it = this.itemFor(element, newItem);
    if (!it) return;
    // Grabbed mid-flight: keep the on-screen offset as part of the grab, so
    // the tile stays exactly under the pointer rather than snapping.
    this.drag = { id: it.id, held: { x: it.x.value, y: it.y.value } };
    it.x.velocity = 0;
    it.y.velocity = 0;
    this.tracker.reset();
    const p = pointFromEvent(e);
    if (p) this.tracker.add(p.x, p.y);
    this.setLift(it, LIFT_SCALE);
  }

  onDrag(layout, oldItem, newItem, placeholder, e, element) {
    const it = this.drag && this.items.get(this.drag.id);
    if (!it) return;
    const p = pointFromEvent(e);
    if (p) this.tracker.add(p.x, p.y);
    const pos = GridMotion.position(element);
    it.pos = pos;
    const left = pos.x + this.drag.held.x;
    const top = pos.y + this.drag.held.y;
    const w = element.offsetWidth;
    const width = this.gridWidth || (this.grid() && this.grid().clientWidth) || 0;
    const height = this.wrap ? this.wrap.clientHeight : 0;
    let overX = 0;
    if (left < 0) overX = left;
    else if (width && left + w > width) overX = left + w - width;
    const overY = top < 0 ? top : 0;
    it.x.value = this.drag.held.x + (rubberband(overX, width) - overX);
    it.y.value = this.drag.held.y + (rubberband(overY, height) - overY);
    this.apply(it);
  }

  onDragStop(layout, oldItem, newItem, placeholder, e, element) {
    const it = this.drag && this.items.get(this.drag.id);
    this.drag = null;
    if (!it) return;
    // Velocity handoff: the settle starts at the pointer's own speed.
    const v = prefersReducedMotion() ? { x: 0, y: 0 } : this.tracker.velocity();
    it.x.velocity = v.x;
    it.y.velocity = v.y;
    it.params = Math.hypot(v.x, v.y) > FLICK_SPEED ? SPRING_FLICK : SPRING_MOVE;
    if (prefersReducedMotion()) { it.x.value = 0; it.y.value = 0; }
    this.setLift(it, 0);
    this.start();
  }

  onResizeStart(layout, oldItem, newItem, placeholder, e, element) {
    const it = this.itemFor(element, newItem);
    if (it && it.inner) it.inner.classList.add('is-resizing');
  }

  onResizeStop(layout, oldItem, newItem, placeholder, e, element) {
    const it = this.itemFor(element, newItem);
    if (it && it.inner) it.inner.classList.remove('is-resizing');
  }
}
