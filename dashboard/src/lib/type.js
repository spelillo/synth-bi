// dashboard/src/lib/type.js — size-specific tracking for the type sizes
// set at runtime (tile titles, text boxes). Inter's dynamic-metrics curve:
// small sizes open up a touch, large sizes tighten. The fixed sizes in CSS
// use the matching --track-* tokens from tokens.css.
export function trackingEm(px) {
  return -0.0223 + 0.185 * Math.exp(-0.1745 * px);
}

export function tracking(px) {
  return `${trackingEm(px).toFixed(4)}em`;
}

// Leading tightens as type grows: roomy for body copy, close for display.
export function leading(px) {
  if (px >= 40) return 1.05;
  if (px >= 28) return 1.12;
  if (px >= 20) return 1.2;
  return 1.35;
}
