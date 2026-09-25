// auth.js — ported from synth-sql with minimal changes: Supabase auth +
// the account modal. Client-side Supabase URL/publishable key hardcoded
// here (same reasoning as synth-sql — no bundler, this key is meant to be
// public) — points at synth-bi's own Supabase project, not synth-sql's.
//
// Account-pitch copy changes for synth-bi's actual perks: save dashboards
// across devices, AI assistant (Ask + Agent mode), and — the one perk that's
// stricter than synth-sql's — export to Power BI/Tableau requires an account
// even though it isn't an AI feature (initial-build.md §7).
//
// Dropped from synth-sql's version: premium status, Enterprise join links,
// and the save-session nudge banner (no paid tier, no orgs — §7).

// Project ref fvjlqcrjfbxgqjbbqdaa — see BUILD-INSTRUCTIONS.md §7 for the
// full Supabase setup (CLI link command, what's still needed).
const SUPABASE_URL = 'https://fvjlqcrjfbxgqjbbqdaa.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_KSbBry-RR0L4QnSUT5k8Kg_kLF3PkjX';

let sb = null;
if (window.supabase) {
  sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
}

async function initAuth() {
  if (!sb) return;
  const { data: { session } } = await sb.auth.getSession();
  handleAuthChange(session);
  sb.auth.onAuthStateChange((event, newSession) => {
    // Token refreshes fire this too; only a real user change needs the
    // full re-render below.
    if ((newSession?.user?.id || null) !== (currentUser?.id || null)) handleAuthChange(newSession);
    // Fires when someone clicks the link in the reset-password email
    // instead of pasting the code — send them to "set new password".
    if (event === 'PASSWORD_RECOVERY') openPasswordRecoveryReset();
  });
}

function handleAuthChange(session) {
  currentUser = session?.user || null;
  const signInBtn = document.getElementById('sign-in-btn');

  if (currentUser) {
    signInBtn.textContent = currentUser.email;
    signInBtn.title = 'Account settings';
  } else {
    signInBtn.textContent = 'Sign in';
    signInBtn.title = '';
  }
  aiEnabled = !!currentUser;
  updateCloudButtons();
  updateHomeSaveCard();
  if (typeof refreshHomeDashboards === 'function') refreshHomeDashboards();
  notifyAuthChange();
}

function updateHomeSaveCard() {
  const signedIn = !!currentUser;
  document.getElementById('home-save-title').textContent = signedIn
    ? 'Your account is all set'
    : 'A free account adds more';
  document.getElementById('home-save-body').textContent = signedIn
    ? 'Use Save to cloud inside any dashboard to keep it here. The AI assistant and Power BI / Tableau export are unlocked.'
    : 'Save dashboards across devices, build tiles with the AI assistant, and export to Power BI or Tableau.';
  document.getElementById('home-save-btn').hidden = signedIn;
}

// Signed in: the header button is the user's email and opens Settings.
// Signed out: it opens the account modal.
window.toggleAuthPanel = function() {
  if (currentUser) {
    openSettingsPanel();
    return;
  }
  openAccountModal('signin');
};

window.togglePasswordField = function(inputId, btnEl) {
  const input = document.getElementById(inputId);
  const showing = input.type === 'text';
  input.type = showing ? 'password' : 'text';
  btnEl.classList.toggle('is-showing', !showing);
  btnEl.setAttribute('aria-label', showing ? 'Show password' : 'Hide password');
};

// ---- Account modal: sign in / sign up / confirm email / reset password ----
// Supabase's signUp/signInWithPassword handle password hashing, and every
// query goes through the client library's parameterized calls. Nothing in
// this file builds SQL strings.

const ACCOUNT_VIEWS = {
  fields: 'auth-fields-step',
  confirm: 'auth-confirm-step',
  forgot: 'forgot-step-request',
  reset: 'forgot-step-reset',
};

let authPanelMode = 'signin';
// Set while waiting on the signup confirmation code (between signUp()
// returning no session and verifyOtp() succeeding). Survives closing the
// modal, so reopening it lands back on the code step.
let pendingConfirmEmail = null;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function setAccountMessage(el, text, kind) {
  el.textContent = text;
  el.classList.toggle('error', kind === 'error');
  el.classList.toggle('success', kind === 'success');
}

window.authPanelModeOpposite = function() {
  return authPanelMode === 'signin' ? 'signup' : 'signin';
};

window.openAccountModal = function(mode, view) {
  if (!sb) {
    alert("Accounts aren't available right now — the sign-in service didn't load. Check your connection and reload.");
    return;
  }
  document.getElementById('account-modal').hidden = false;
  if (view) {
    showAccountView(view);
  } else if (pendingConfirmEmail) {
    showAccountView('confirm');
  } else {
    showAccountView('fields');
    setAuthPanelMode(mode || 'signin');
  }
};

window.closeAccountModal = function() {
  document.getElementById('account-modal').hidden = true;
  document.getElementById('auth-password').value = '';
};

window.showAccountView = function(view) {
  Object.entries(ACCOUNT_VIEWS).forEach(([key, id]) => {
    document.getElementById(id).hidden = key !== view;
  });
  let focusId = { fields: 'auth-email', confirm: 'auth-confirm-code', forgot: 'forgot-email', reset: 'forgot-new-password' }[view];
  if (view === 'fields' && document.getElementById('auth-email').value.trim()) focusId = 'auth-password';
  // The shared modal focus trap (app.js) focuses [autofocus] when the
  // overlay opens, so mark the target as well as focusing it directly
  // for view switches while the modal is already open.
  document.querySelectorAll('#account-modal [autofocus]').forEach(el => el.removeAttribute('autofocus'));
  const focusEl = document.getElementById(focusId);
  focusEl.setAttribute('autofocus', '');
  focusEl.focus();
};

window.setAuthPanelMode = function(mode) {
  authPanelMode = mode;
  const isSignin = mode === 'signin';
  const signinTab = document.getElementById('auth-tab-signin');
  const signupTab = document.getElementById('auth-tab-signup');
  signinTab.classList.toggle('is-active', isSignin);
  signupTab.classList.toggle('is-active', !isSignin);
  signinTab.setAttribute('aria-selected', isSignin);
  signupTab.setAttribute('aria-selected', !isSignin);

  document.getElementById('account-title').textContent = isSignin ? 'Welcome back' : 'Create your free account';
  document.getElementById('account-sub').textContent = isSignin
    ? 'Sign in to save dashboards, use the AI assistant, and export to Power BI or Tableau.'
    : "Sign up with your email and a password. We'll email you a code to confirm the address.";
  document.getElementById('auth-panel-submit-btn').textContent = isSignin ? 'Sign in' : 'Create account';
  document.getElementById('auth-forgot-link').hidden = !isSignin;
  document.getElementById('auth-password-help').hidden = isSignin;
  document.getElementById('auth-password').setAttribute('autocomplete', isSignin ? 'current-password' : 'new-password');
  document.getElementById('auth-switch-text').textContent = isSignin ? 'New to Synth-BI?' : 'Already have an account?';
  document.getElementById('auth-switch-link').textContent = isSignin ? 'Create an account' : 'Sign in';
  setAccountMessage(document.getElementById('auth-message'), '');
};

window.authPanelSubmit = async function() {
  const email = document.getElementById('auth-email').value.trim();
  const password = document.getElementById('auth-password').value;
  const msgEl = document.getElementById('auth-message');
  const submitBtn = document.getElementById('auth-panel-submit-btn');
  if (submitBtn.disabled) return;

  if (!EMAIL_RE.test(email)) {
    setAccountMessage(msgEl, 'Enter a valid email.', 'error');
    document.getElementById('auth-email').focus();
    return;
  }
  if (password.length < 8) {
    setAccountMessage(msgEl, 'Password must be at least 8 characters.', 'error');
    document.getElementById('auth-password').focus();
    return;
  }

  const mode = authPanelMode;
  setAccountMessage(msgEl, mode === 'signin' ? 'Signing in…' : 'Creating account…');
  submitBtn.disabled = true;

  let data, error;
  try {
    ({ data, error } = mode === 'signin'
      ? await sb.auth.signInWithPassword({ email, password })
      : await sb.auth.signUp({ email, password }));
  } catch (err) {
    error = err;
  }
  submitBtn.disabled = false;

  if (error) {
    setAccountMessage(msgEl, error.message, 'error');
    return;
  }

  document.getElementById('auth-password').value = '';
  setAccountMessage(msgEl, '');

  if (data.session) {
    closeAccountModal();
    return; // onAuthStateChange -> handleAuthChange takes it from here
  }

  // Supabase's "confirm email" project setting is on, so there's no
  // session yet. Ask for the emailed code right here instead of making
  // people round-trip through their inbox and sign in again.
  startAuthConfirmStep(email);
};

function startAuthConfirmStep(email) {
  pendingConfirmEmail = email;
  document.getElementById('auth-confirm-copy').textContent =
    `We sent a confirmation code to ${email}. Enter it below to finish creating your account.`;
  document.getElementById('auth-confirm-code').value = '';
  document.getElementById('auth-confirm-submit-btn').disabled = false;
  setAccountMessage(document.getElementById('auth-confirm-message'), '');
  showAccountView('confirm');
}

window.cancelAuthConfirmStep = function() {
  pendingConfirmEmail = null;
  showAccountView('fields');
  setAuthPanelMode('signup');
};

window.submitAuthConfirmCode = async function() {
  const token = document.getElementById('auth-confirm-code').value.trim();
  const msgEl = document.getElementById('auth-confirm-message');
  const submitBtn = document.getElementById('auth-confirm-submit-btn');
  if (!token) { setAccountMessage(msgEl, 'Enter the code from your email.', 'error'); return; }
  if (submitBtn.disabled) return;

  submitBtn.disabled = true;
  setAccountMessage(msgEl, 'Confirming…');
  const { error } = await sb.auth.verifyOtp({ email: pendingConfirmEmail, token, type: 'signup' });
  submitBtn.disabled = false;

  if (error) {
    setAccountMessage(msgEl, error.message, 'error');
    return;
  }

  pendingConfirmEmail = null;
  closeAccountModal();
  showAccountView('fields');
};

window.resendAuthConfirmCode = async function() {
  const msgEl = document.getElementById('auth-confirm-message');
  const resendLink = document.getElementById('auth-confirm-resend-link');
  if (resendLink.classList.contains('is-disabled')) return;
  setAccountMessage(msgEl, 'Sending a new code…');
  resendLink.classList.add('is-disabled');
  const { error } = await sb.auth.resend({ type: 'signup', email: pendingConfirmEmail });
  if (error) {
    setAccountMessage(msgEl, error.message, 'error');
  } else {
    setAccountMessage(msgEl, 'New code sent.', 'success');
  }
  resendLink.classList.remove('is-disabled');
};

// ---- Forgot password ----
// Supabase's own recovery flow (sb.auth.resetPasswordForEmail). Clicking the
// emailed link fires the PASSWORD_RECOVERY auth event (see initAuth), which
// opens openPasswordRecoveryReset() straight to "set new password".

window.showForgotPassword = function() {
  const emailField = document.getElementById('forgot-email');
  emailField.value = document.getElementById('auth-email').value.trim();
  emailField.disabled = false;
  document.getElementById('forgot-request-submit-btn').disabled = false;
  setAccountMessage(document.getElementById('forgot-request-message'), '');
  showAccountView('forgot');
};

function openPasswordRecoveryReset() {
  document.getElementById('forgot-new-password').value = '';
  setAccountMessage(document.getElementById('forgot-reset-message'), '');
  openAccountModal(null, 'reset');
  const clean = window.location.pathname + window.location.search;
  window.history.replaceState({}, '', clean);
}

window.submitForgotPasswordRequest = async function() {
  const emailField = document.getElementById('forgot-email');
  const email = emailField.value.trim();
  const msgEl = document.getElementById('forgot-request-message');
  const submitBtn = document.getElementById('forgot-request-submit-btn');
  if (submitBtn.disabled) return;

  if (!EMAIL_RE.test(email)) {
    setAccountMessage(msgEl, 'Enter a valid email first.', 'error');
    return;
  }

  submitBtn.disabled = true;
  setAccountMessage(msgEl, 'Sending link…');
  const { error } = await sb.auth.resetPasswordForEmail(email);
  if (error) {
    submitBtn.disabled = false;
    setAccountMessage(msgEl, error.message, 'error');
    return;
  }

  emailField.disabled = true;
  setAccountMessage(msgEl, 'Check your email for a password reset link.', 'success');
};

window.submitForgotPasswordReset = async function() {
  const newPassword = document.getElementById('forgot-new-password').value;
  const msgEl = document.getElementById('forgot-reset-message');

  if (newPassword.length < 8) {
    setAccountMessage(msgEl, 'Password must be at least 8 characters.', 'error');
    return;
  }

  const { error: updateError } = await sb.auth.updateUser({ password: newPassword });
  if (updateError) {
    setAccountMessage(msgEl, updateError.message, 'error');
    return;
  }

  setAccountMessage(msgEl, 'Password updated. You are signed in.', 'success');
  setTimeout(() => {
    closeAccountModal();
    showAccountView('fields');
  }, 1500);
};

// ---- Settings (opened via the email button) ----

window.openSettingsPanel = function() {
  if (!currentUser) return;
  document.getElementById('settings-email').textContent = currentUser.email;
  const since = currentUser.created_at ? new Date(currentUser.created_at).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' }) : '';
  document.getElementById('settings-member-since').textContent = since ? `Member since ${since}` : '';
  document.getElementById('settings-modal').hidden = false;
};

window.closeSettingsPanel = function() {
  document.getElementById('settings-modal').hidden = true;
};

window.signOutUser = async function() {
  if (!sb) return;
  await sb.auth.signOut();
  closeSettingsPanel();

  // The view swap alone only hides stale data. On a shared device the
  // previous account's tables, tiles, and chat history would still be in
  // memory, so reset the same way loading a fresh workspace does.
  if (SQL) db = new SQL.Database();
  tables = [];
  activeTableName = null;
  dashboardTiles = [];
  chatHistory = [];
  relationships = [];
  rejectedRelationshipKeys = new Set();
  currentWorkspaceId = null;
  currentWorkspaceName = null;
  dataLoaded = false;
  aiEnabled = false;

  notifySchemaChange();
  notifyTilesChange();
  openHome();
};
