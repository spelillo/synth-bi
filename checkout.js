// checkout.js — no paid tier in synth-bi (initial-build.md §7: two free
// tiers, no paywall — same shape as synth-sql today). This file keeps the
// synth-sql *pattern* — a single source of truth for "can this account do X"
// — without any Stripe/checkout code, since there's nothing to purchase.
//
// requireSignIn(reason) (called via bridge.js) is the only gate synth-bi
// actually needs: Lite Mode (no account) vs Normal Mode (free sign-in),
// nothing above that. Export specifically requires sign-in even though it
// costs nothing server-side — an explicit product decision, not a technical
// one (initial-build.md §7).

const FEATURE_MIN_TIER = {
  ai: 'normal',      // Ask Mode + Agent Mode
  export: 'normal',  // Excel/CSV + Tableau .tds — sign-in required regardless of AI usage
};

// STUB
function canUseFeature(_featureKey) {}
function requireFeature(_featureKey) {}
