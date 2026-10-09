// dashboard/src/lib/useScrollEdges.js
import { useLayoutEffect, useState } from 'react';

// Adds data-scrolled-top / -bottom while content sits under an edge, so
// floating chrome shows a soft scroll-edge shadow only when something is
// actually beneath it (instead of a permanent divider line).
export default function useScrollEdges() {
  const [el, setEl] = useState(null);
  useLayoutEffect(() => {
    if (!el) return undefined;
    const update = () => {
      el.toggleAttribute('data-scrolled-top', el.scrollTop > 1);
      el.toggleAttribute('data-scrolled-bottom', el.scrollTop + el.clientHeight < el.scrollHeight - 1);
    };
    update();
    el.addEventListener('scroll', update, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => { el.removeEventListener('scroll', update); ro.disconnect(); };
  }, [el]);
  return setEl;
}
