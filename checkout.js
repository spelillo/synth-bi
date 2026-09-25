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
  cloudSave: 'normal',
};

const TIER_RANK = { lite: 0, normal: 1 };

function getUserTier() {
  return currentUser ? 'normal' : 'lite';
}

function canUseFeature(featureKey) {
  const required = FEATURE_MIN_TIER[featureKey] || 'normal';
  return TIER_RANK[getUserTier()] >= TIER_RANK[required];
}

// Guards a feature: returns true and does nothing if the account already
// clears it, otherwise opens the sign-in prompt (the only boundary there
// is) and returns false so the caller can bail out.
function requireFeature(featureKey) {
  if (canUseFeature(featureKey)) return true;
  openSigninRequiredModal(featureKey);
  return false;
}

const SIGNIN_REQUIRED_COPY = {
  ai: {
    title: 'Sign in to use the AI assistant',
    body: 'The assistant is free with an account. Everything you have loaded stays right where it is.',
  },
  export: {
    title: 'Sign in to export',
    body: 'Exporting to Power BI or Tableau is free with an account. Your dashboard stays right where it is.',
  },
  cloudSave: {
    title: 'Sign in to save',
    body: 'Save your dashboards to a free account and open them on any device.',
  },
};

window.openSigninRequiredModal = function(featureKey) {
  const copy = SIGNIN_REQUIRED_COPY[featureKey] || { title: 'Sign in to continue', body: 'This is a free account feature. Sign in or create an account.' };
  document.getElementById('signin-required-title').textContent = copy.title;
  document.getElementById('signin-required-body').textContent = copy.body;
  document.getElementById('signin-required-modal').hidden = false;
};

window.closeSigninRequiredModal = function() {
  document.getElementById('signin-required-modal').hidden = true;
};

window.signInFromRequiredModal = function(mode) {
  document.getElementById('signin-required-modal').hidden = true;
  openAccountModal(mode || 'signin');
};
