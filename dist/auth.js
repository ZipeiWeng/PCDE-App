import { authRequest } from './auth-client.js';
import { createLiquidSelection } from './liquid-selection.js';

const RECENT_KEY = 'pawprint.verified-accounts.v1';
const escape = value => String(value ?? '').replace(/[&<>"']/g, character => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));
const clean = (value, maximum = 60) => String(value || '').trim().replace(/\s+/g, ' ').slice(0, maximum);
const arrow = '<svg class="icon" aria-hidden="true"><use href="#i-arrow-right"/></svg>';
const back = '<svg class="icon" aria-hidden="true"><use href="#i-back"/></svg>';
const eye = '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></svg>';
const today = () => { const date = new Date(); return new Date(date.valueOf() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };
const freshDraft = () => ({ username:'',email:'',password:'',petName:'',petBirthday:'',petSex:'unknown' });

export function emailAvailabilityStatus(result = {}) {
  if (result.storageReady === false) return 'storage';
  if (result.emailConfigured === false) return 'unavailable';
  if (result.emailConfigured === true || result.configured === true) return 'ready';
  return result.configured === false ? 'unavailable' : 'unknown';
}

export function validateAccountDraft(draft) {
  if (!/^[A-Za-z0-9_.-]{3,30}$/.test(draft.username)) return 'Use 3–30 letters, numbers, dots, underscores or hyphens for your username.';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(draft.email) || draft.email.length > 254) return 'Enter a valid email address.';
  if (draft.password.length < 10 || draft.password.length > 128) return 'Use a password with 10–128 characters.';
  return '';
}
export function validatePetDraft(draft) {
  if (!clean(draft.petName)) return 'Enter your pet’s name.';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.petBirthday)) return 'Choose your pet’s birthday.';
  const date = new Date(`${draft.petBirthday}T12:00:00Z`);
  if (!Number.isFinite(date.valueOf()) || date.toISOString().slice(0,10) !== draft.petBirthday || draft.petBirthday > today()) return 'Choose a valid birthday that is not in the future.';
  if (!['female','male','unknown'].includes(draft.petSex)) return 'Choose your pet’s sex.';
  return '';
}
function readRecent() {
  try {
    const parsed = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]');
    return Array.isArray(parsed) ? parsed.filter(item => item && typeof item.id === 'string' && item.id && typeof item.username === 'string' && typeof item.email === 'string').slice(0,5).map(item => ({id:item.id.slice(0,160),username:clean(item.username,30),email:clean(item.email,254),lastUsed:Number(item.lastUsed)||0})) : [];
  } catch { return []; }
}

export function initAuth(root, { onLogin, getDefaultNames = () => ({}) } = {}) {
  const liquid=createLiquidSelection(root,[
    {id:'auth-tabs',group:'.auth-tabs',selected:'[aria-selected="true"]'},
    {id:'auth-sex',group:'.auth-sex-picker',selected:'input:checked + span',choices:'label > span'},
  ]);
  let mode = 'login';
  let signupStep = 0;
  let draft = freshDraft();
  let current = null;
  let recent = readRecent();
  let rememberedIds = new Set();
  let sessionReady = false;
  let locking = true;
  let lockError = '';
  let ready;
  let sessionAttempt = 0;
  let sessionCloseQueue = null;
  let busy = false;
  let error = '';
  let notice = '';
  let loginIdentifier = '';
  let resetEmail = '';
  let challenge = null;
  let resendAt = 0;
  let activeRequest = null;
  let renderNumber = 0;
  let timer = null;
  let emailStatus = 'checking';
  let statusRequest = 0;
  const blocked = () => busy || !sessionReady;
  function queueSessionClose(path) {
    // Closing responses clear the session cookie. Let every older response
    // settle before dispatching the next close or enabling a fresh sign-in.
    const request = () => authRequest(path, {});
    const closing = sessionCloseQueue ? sessionCloseQueue.then(request, request) : request();
    sessionCloseQueue = closing;
    const release = () => { if (sessionCloseQueue === closing) sessionCloseQueue = null; };
    closing.then(release, release);
    return closing;
  }

  function emailStatusCopy() {
    return emailStatus === 'checking' ? 'Checking email service…'
      : emailStatus === 'storage' ? 'Account registration is unavailable. Please try again later.'
      : emailStatus === 'unavailable' ? 'Email verification is unavailable. The email service has not been connected yet.'
      : emailStatus === 'unknown' ? 'Could not check the email service. You can retry or continue.' : '';
  }
  function updateEmailStatus() {
    const panel = root.querySelector('[data-email-status]');
    if (!panel) return;
    panel.hidden = emailStatus === 'ready';
    panel.querySelector('p').textContent = emailStatusCopy();
    const retry = panel.querySelector('button');
    retry.hidden = emailStatus === 'checking';
    retry.disabled = blocked();
    const submit = root.querySelector('[data-primary-submit]');
    if (submit && (mode === 'reset' || (mode === 'signup' && signupStep === 1))) {
      submit.disabled = blocked() || ['checking','storage','unavailable'].includes(emailStatus);
    }
  }
  async function checkEmailStatus() {
    const request = ++statusRequest;
    emailStatus = 'checking'; updateEmailStatus();
    try {
      const result = await authRequest('/status');
      if (request !== statusRequest) return;
      emailStatus = emailAvailabilityStatus(result);
    } catch { if (request !== statusRequest) return; emailStatus = 'unknown'; }
    updateEmailStatus();
  }
  function emailServiceNotice() {
    return '<div class="auth-service-notice" data-email-status><p role="status"></p><button type="button" class="auth-text-button" data-check-email>Check again</button></div>';
  }

  function saveRecent() {
    try { localStorage.setItem(RECENT_KEY, JSON.stringify(recent)); } catch { /* Server grants work without local preferences. */ }
  }
  function rememberAccount(account) {
    rememberedIds.add(account.id);
    recent = [{ id:account.id,username:account.username,email:account.email,lastUsed:Date.now() }, ...recent.filter(item => item.id !== account.id)].slice(0,5);
    saveRecent();
  }
  function syncRemembered(accounts) {
    if (!Array.isArray(accounts)) throw new Error('The sign-in service returned an incomplete response.');
    const verified = accounts.filter(account => account && typeof account.id === 'string' && account.id && typeof account.username === 'string' && typeof account.email === 'string' && !account.isTest);
    rememberedIds = new Set(verified.map(account => account.id));
    const metadata = verified.map(account => ({id:account.id,username:account.username,email:account.email,lastUsed:recent.find(item => item.id === account.id)?.lastUsed || 0}));
    recent = [...metadata, ...recent.filter(account => !rememberedIds.has(account.id))].slice(0,5);
    saveRecent();
  }
  async function lockSession() {
    const attempt = ++sessionAttempt;
    if (!locking) { locking = true; lockError = ''; render(); }
    sessionReady = false;
    setBusy(false);
    try {
      const result = await queueSessionClose('/lock');
      if (attempt !== sessionAttempt) return false;
      syncRemembered(result.accounts);
      sessionReady = true;
    } catch {
      if (attempt === sessionAttempt) lockError = 'We could not confirm that your previous session is signed out. Retry before signing in.';
    } finally {
      if (attempt === sessionAttempt) { locking = false;render(); }
    }
    return sessionReady;
  }
  async function finishLogin(account, remember = true) {
    if (!account || typeof account.id !== 'string' || !account.id || typeof account.username !== 'string') throw new Error('The sign-in response was incomplete. Please try again.');
    current = { ...account, name:account.username, role:'owner', demo:false };
    if (remember && !account.isTest) rememberAccount(account);
    draft = freshDraft();
    challenge = null;
    root.querySelectorAll('input[autocomplete="current-password"],input[autocomplete="new-password"]').forEach(input => { input.value = ''; });
    await onLogin?.({ ...current });
  }
  function showError(message) {
    error = String(message || 'Please try again.');
    const target = root.querySelector('.auth-error');
    if (target) target.textContent = error;
  }
  function setBusy(value) {
    busy = value;
    root.setAttribute('aria-busy', String(value || locking));
    root.querySelectorAll('button,input,select').forEach(control => { control.disabled = blocked(); });
    const retry = root.querySelector('[data-retry-lock]');
    if (retry) retry.disabled = locking;
    const submit = root.querySelector('[data-primary-submit]');
    if (submit) {
      submit.querySelector('span').textContent = value ? 'Please wait…' : submit.dataset.label;
      submit.classList.toggle('is-loading', value);
    }
    if (!value) { updateResend(); updateEmailStatus(); }
  }
  async function run(task) {
    if (blocked()) return;
    error = ''; notice = '';
    root.querySelector('.auth-error')?.replaceChildren();
    const token = renderNumber;
    const request = new AbortController();
    activeRequest = request;
    setBusy(true);
    try { await task(request.signal); }
    catch (failure) {
      if (token === renderNumber && activeRequest === request) {
        if (['invalid_challenge','email_sender_configuration','email_rate_limited','email_unavailable'].includes(failure.code) && ['verify-signup','verify-reset'].includes(mode)) {
          if (challenge) challenge.expiresAt = 0;
          showError(failure.code === 'invalid_challenge'
            ? 'This verification request is no longer valid. Restart verification to request a new code.'
            : `${failure.message} Restart verification to request a new code.`);
        } else showError(failure.message);
        if (failure.code === 'email_not_configured') emailStatus = 'unavailable';
        if (failure.code === 'auth_not_configured') emailStatus = 'storage';
      }
    }
    finally { if (activeRequest === request) { activeRequest = null;setBusy(false); } }
  }
  function switchMode(next) {
    if (blocked()) return;
    mode = next; signupStep = 0; error = ''; notice = ''; challenge = null; draft = freshDraft();
    render();
    if (next === 'signup' || next === 'reset') checkEmailStatus();
  }
  function passwordField(name = 'password', label = 'Password', autocomplete = 'current-password') {
    return `<label class="auth-field"><span>${label}</span><span class="auth-password"><input name="${name}" type="password" placeholder="${label}" autocomplete="${autocomplete}" minlength="${autocomplete === 'new-password' ? 10 : 1}" maxlength="128" required><button type="button" data-show-password="${name}" aria-label="Show ${label.toLowerCase()}" aria-pressed="false">${eye}</button></span></label>`;
  }
  function primary(label) { return `<button type="submit" class="auth-submit glass" data-primary-submit data-label="${escape(label)}"><span>${label}</span>${arrow}</button>`; }
  function feedback() { return `<p class="auth-error" role="alert">${escape(error)}</p><p class="auth-notice" role="status">${escape(notice)}</p>`; }
  function tabs() {
    return `<div class="auth-tabs glass" role="tablist" aria-label="Account access"><button type="button" id="auth-login-tab" role="tab" aria-selected="${mode === 'login'}" aria-controls="auth-login-panel" data-auth-mode="login">Log in</button><button type="button" id="auth-signup-tab" role="tab" aria-selected="${mode === 'signup' || mode === 'verify-signup'}" aria-controls="auth-signup-panel" data-auth-mode="signup">Sign up</button></div>`;
  }
  function recentRows() {
    if (!recent.length) return '';
    return `<div class="auth-recent"><p class="auth-group-label">Recent</p><div class="auth-recent-list">${recent.map(account => `<div class="auth-recent-row"><button type="button" class="auth-account glass" data-auth-account="${escape(account.id)}" aria-label="${rememberedIds.has(account.id) ? 'Continue as' : 'Enter password for'} ${escape(account.username)}"><span class="auth-avatar" aria-hidden="true">${escape(account.username.slice(0,1).toUpperCase())}</span><span class="auth-account-copy"><strong>${escape(account.username)}</strong><small>${escape(account.email)}</small>${rememberedIds.has(account.id) ? '' : '<small class="auth-recent-hint">Password required</small>'}</span>${arrow}</button><button type="button" class="auth-forget" data-forget-account="${escape(account.id)}" aria-label="Forget saved account ${escape(account.username)}" title="Forget saved account"><span aria-hidden="true">×</span></button></div>`).join('')}</div></div>`;
  }
  function testAccountEntry() {
    return `<button type="button" class="auth-account glass" data-test-account aria-label="Open Mochi test account"><span class="auth-avatar" aria-hidden="true">M</span><span class="auth-account-copy"><strong>Mochi · Test account</strong><small>Synthetic pet · AI assistant enabled</small></span>${arrow}</button>`;
  }
  function loginContent() {
    return `<form id="auth-login-panel" class="auth-panel" role="tabpanel" aria-labelledby="auth-login-tab" data-form="login"><label class="auth-field"><span>Account</span><input name="identifier" placeholder="Pet name, email or username" autocomplete="username" maxlength="254" value="${escape(loginIdentifier)}" required></label>${passwordField()}<div class="auth-login-options"><label class="auth-remember"><input type="checkbox" name="remember" checked><span>Remember this account</span></label><button type="button" class="auth-text-button" data-forgot>Forgot password?</button></div>${feedback()}${primary('Log in')}</form>${recentRows()}`;
  }
  function signupContent() {
    return `<form id="auth-signup-panel" class="auth-panel" role="tabpanel" aria-labelledby="auth-signup-tab" data-form="signup">${emailServiceNotice()}<div class="auth-step"><span>${signupStep === 0 ? 'Your account' : 'Your pet'}</span><span>${signupStep+1} / 2</span></div>${signupStep === 0 ? `<label class="auth-field"><span>Username</span><input name="username" placeholder="Choose a username" autocomplete="username" minlength="3" maxlength="30" pattern="[A-Za-z0-9_.\\-]{3,30}" value="${escape(draft.username)}" required></label><label class="auth-field"><span>Email</span><input name="email" type="email" placeholder="you@example.com" autocomplete="email" maxlength="254" value="${escape(draft.email)}" required></label>${passwordField('password','Password','new-password')}<p class="auth-hint">At least 10 characters.</p>` : `<label class="auth-field"><span>Pet name</span><input name="petName" placeholder="Your pet’s name" maxlength="60" value="${escape(draft.petName)}" required></label><label class="auth-field"><span>Birthday</span><input name="petBirthday" type="date" max="${today()}" value="${escape(draft.petBirthday)}" required></label><fieldset class="auth-sex-field"><legend>Sex</legend><div class="auth-sex-picker glass">${[['female','Female'],['male','Male'],['unknown','Unknown']].map(([value,label]) => `<label><input type="radio" name="petSex" value="${value}" ${draft.petSex === value ? 'checked' : ''}><span>${label}</span></label>`).join('')}</div></fieldset>`}${feedback()}${primary(signupStep === 0 ? 'Continue' : 'Send verification code')}${signupStep === 1 ? '<button type="button" class="auth-back" data-signup-back>Back</button>' : ''}</form>`;
  }
  function resetContent() {
    return `<form class="auth-panel" data-form="reset">${emailServiceNotice()}<div class="auth-section-title"><button type="button" class="auth-back-icon" data-auth-mode="login" aria-label="Back to login">${back}</button><h1>Reset password</h1></div><label class="auth-field"><span>Email</span><input name="email" type="email" placeholder="you@example.com" autocomplete="email" maxlength="254" value="${escape(resetEmail)}" required></label><p class="auth-hint">We’ll send a code to verify it’s you.</p>${feedback()}${primary('Send reset code')}</form>`;
  }
  function verificationContent() {
    const isReset = mode === 'verify-reset';
    const email = isReset ? resetEmail : draft.email;
    return `<form class="auth-panel auth-verification" data-form="${isReset ? 'verify-reset' : 'verify-signup'}"><div class="auth-section-title"><button type="button" class="auth-back-icon" data-verify-back aria-label="Back">${back}</button><h1>Check your email</h1></div><p class="auth-verification-copy">Enter the 6-digit code sent to<br><strong>${escape(email)}</strong></p><label class="auth-field"><span class="sr-only">Verification code</span><input name="code" class="auth-code" placeholder="000000" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" minlength="6" required aria-label="Verification code"></label>${isReset ? `${passwordField('password','New password','new-password')}<p class="auth-hint">At least 10 characters.</p>` : ''}${feedback()}${primary(isReset ? 'Reset password' : 'Verify & create account')}<button type="button" class="auth-text-button auth-resend" data-resend>Resend code</button></form>`;
  }
  function updateResend() {
    const button = root.querySelector('[data-resend]');
    if (!button) return;
    if (!challenge || challenge.expiresAt <= Date.now()) {
      button.disabled = blocked();
      button.textContent = 'Restart verification';
      return;
    }
    const seconds = Math.max(0, Math.ceil((resendAt - Date.now()) / 1000));
    button.disabled = blocked() || seconds > 0;
    button.textContent = seconds > 0 ? `Resend in ${seconds}s` : 'Resend code';
  }
  function restartVerification() {
    if (blocked()) return;
    const wasReset = mode === 'verify-reset';
    root.querySelectorAll('input[name="code"],input[autocomplete="new-password"]').forEach(input => { input.value = ''; });
    draft.password = '';challenge = null;resendAt = 0;signupStep = 0;
    mode = wasReset ? 'reset' : 'signup';
    error = '';notice = 'Request a new verification code to continue.';
    render();
  }
  function receiveChallenge(result, next) {
    if (!result || typeof result.challengeId !== 'string' || !result.challengeId) throw new Error('A verification code could not be sent. Please try again.');
    challenge = { id:result.challengeId, expiresAt:Date.now() + (Number(result.expiresIn) || 600) * 1000 };
    resendAt = Date.now() + 60000;
    mode = next; error = ''; notice = '';render();
    root.querySelector('[name="code"]')?.focus({ preventScroll:true });
  }
  async function continueRecent(id) {
    if (blocked()) return;
    const item = recent.find(account => account.id === id);
    if (!item) return;
    function requestPassword(message) {
      rememberedIds.delete(id);
      loginIdentifier = item.email || item.username;notice = message;error = '';render();
    }
    if (!rememberedIds.has(id)) {
      requestPassword('Enter your password to remember this account for one-click sign-in.');
      root.querySelector('[name="password"]')?.focus({preventScroll:true});return;
    }
    await run(async signal => {
      try {
        const result = await authRequest('/resume', { accountId:id }, { signal });
        if (result.account?.id !== id) throw new Error('The saved account could not be confirmed. Please log in with your password.');
        if (!signal.aborted) await finishLogin(result.account);
      } catch (failure) {
        if (signal.aborted) return;
        if (failure.code !== 'quick_login_expired') throw failure;
        requestPassword('Saved sign-in expired. Enter your password to remember this account again.');
      }
    });
    if (!rememberedIds.has(id)) root.querySelector('[name="password"]')?.focus({preventScroll:true});
  }
  async function forgetAccount(id) {
    await run(async signal => {
      await authRequest('/forget', { accountId:id }, { signal });
      if (signal.aborted) return;
      rememberedIds.delete(id);
      recent = recent.filter(account => account.id !== id);
      saveRecent();
      notice = 'Saved account forgotten on this device.';render();
    });
  }
  function render() {
    liquid.capture();
    renderNumber++;
    if (timer) clearInterval(timer);
    root.classList.add('auth-screen');
    root.setAttribute('aria-label','Account access');
    const sessionNotice = locking ? '<p class="auth-session-notice" role="status">Preparing sign-in…</p>' : lockError ? `<div class="auth-session-notice"><p class="auth-error" role="alert">${escape(lockError)}</p><button type="button" class="auth-text-button" data-retry-lock>Retry sign-out</button></div>` : '';
    root.innerHTML = `<div class="auth-center">${sessionNotice}${['login','signup'].includes(mode) ? tabs() : ''}${mode === 'login' ? loginContent() : mode === 'signup' ? signupContent() : mode === 'reset' ? resetContent() : verificationContent()}<div class="auth-footer">${testAccountEntry()}<button type="button" class="auth-demo" data-explore-demo>Explore demo</button></div></div>`;
    root.querySelector('[data-retry-lock]')?.addEventListener('click', () => { if (!locking) ready = lockSession(); });
    root.querySelectorAll('[data-auth-mode]').forEach(button => {
      button.addEventListener('click', () => switchMode(button.dataset.authMode));
      if (button.getAttribute('role') === 'tab') button.addEventListener('keydown', event => {
        if (!['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) return;
        event.preventDefault();switchMode(['ArrowLeft','Home'].includes(event.key) ? 'login' : 'signup');
        root.querySelector(`[data-auth-mode="${mode}"]`)?.focus({preventScroll:true});
      });
    });
    root.querySelector('[data-forgot]')?.addEventListener('click', () => switchMode('reset'));
    root.querySelector('[data-check-email]')?.addEventListener('click', checkEmailStatus);
    root.querySelector('[data-signup-back]')?.addEventListener('click', () => { if (blocked()) return; readPetFields();signupStep = 0;error = '';render(); });
    root.querySelector('[data-verify-back]')?.addEventListener('click', () => { if (blocked()) return; challenge = null;draft.password = '';mode = mode === 'verify-reset' ? 'reset' : 'signup';signupStep = 0;error = '';render(); });
    root.querySelectorAll('[data-show-password]').forEach(button => button.addEventListener('click', () => {
      const input = root.querySelector(`input[name="${button.dataset.showPassword}"]`);
      const show = input.type === 'password';input.type = show ? 'text' : 'password';button.setAttribute('aria-pressed', String(show));button.setAttribute('aria-label', `${show ? 'Hide' : 'Show'} ${input.name === 'password' && mode === 'verify-reset' ? 'new password' : 'password'}`);
    }));
    if (mode === 'signup' && signupStep === 0) root.querySelector('[name="password"]').value = draft.password;
    root.querySelectorAll('[data-auth-account]').forEach(button => button.addEventListener('click', () => continueRecent(button.dataset.authAccount)));
    root.querySelectorAll('[data-forget-account]').forEach(button => button.addEventListener('click', () => forgetAccount(button.dataset.forgetAccount)));
    root.querySelector('[data-test-account]').addEventListener('click', () => run(async signal => {
      const result = await authRequest('/test-session', {}, { signal });
      if (signal.aborted) return;
      if (result.account?.isTest !== true) throw new Error('A test session could not be started. Please try again.');
      await finishLogin(result.account, false);
    }));
    root.querySelector('[data-explore-demo]').addEventListener('click', () => run(async () => {
      draft = freshDraft();challenge = null;
      root.querySelectorAll('input[autocomplete="current-password"],input[autocomplete="new-password"]').forEach(input => { input.value = ''; });
      const defaults = getDefaultNames() || {};
      current = { id:'demo-owner',name:clean(defaults.ownerName) || 'Alex',role:'owner',demo:true };
      await onLogin?.({ ...current });
    }));
    root.querySelector('[name="code"]')?.addEventListener('input', event => { event.target.value = event.target.value.replace(/\D/g,'').slice(0,6); });
    root.querySelector('form')?.addEventListener('submit', submitForm);
    root.querySelector('[data-resend]')?.addEventListener('click', () => {
      if (!challenge || challenge.expiresAt <= Date.now()) { restartVerification();return; }
      return run(async signal => {
        const result = await authRequest('/resend',{challengeId:challenge.id},{signal});
        if (signal.aborted) return;
        receiveChallenge(result,mode);notice = 'A new code has been sent.';root.querySelector('.auth-notice').textContent = notice;
      });
    });
    updateResend();
    updateEmailStatus();
    setBusy(busy);
    root.querySelector('.auth-sex-picker')?.addEventListener('change',()=>{liquid.capture();liquid.sync();});
    liquid.sync();
    if (root.querySelector('[data-resend]')) timer = setInterval(updateResend,1000);
  }
  function readPetFields() {
    const form = root.querySelector('form');
    draft.petName = clean(form?.elements.petName?.value);
    draft.petBirthday = form?.elements.petBirthday?.value || '';
    draft.petSex = form?.elements.petSex?.value || 'unknown';
  }
  async function submitForm(event) {
    event.preventDefault();
    if (blocked()) return;
    const form = event.currentTarget;
    const type = form.dataset.form;
    if ((type === 'reset' || (type === 'signup' && signupStep === 1)) && ['checking','storage','unavailable'].includes(emailStatus)) {
      updateEmailStatus(); return;
    }
    if (type === 'signup' && signupStep === 0) {
      draft.username = clean(form.elements.username.value,30);draft.email = form.elements.email.value.trim().toLowerCase();draft.password = form.elements.password.value;
      const invalid = validateAccountDraft(draft);
      if (invalid) { showError(invalid);return; }
      signupStep = 1;error = '';render();return;
    }
    if (type === 'signup') {
      readPetFields();
      const invalid = validateAccountDraft(draft) || validatePetDraft(draft);
      if (invalid) { showError(invalid);return; }
    }
    const values = new FormData(form);
    await run(async signal => {
      if (type === 'login') {
        loginIdentifier = String(values.get('identifier') || '').trim();
        const result = await authRequest('/login',{identifier:loginIdentifier,password:String(values.get('password') || ''),remember:values.get('remember') === 'on'},{signal});
        if (signal.aborted) return;
        await finishLogin(result.account,values.get('remember') === 'on');
      } else if (type === 'signup') {
        const result = await authRequest('/signup/start',{...draft},{signal});
        if (signal.aborted) return;
        draft.password = '';receiveChallenge(result,'verify-signup');
      } else if (type === 'reset') {
        resetEmail = String(values.get('email') || '').trim().toLowerCase();
        const result = await authRequest('/reset/start',{email:resetEmail},{signal});
        if (signal.aborted) return;
        receiveChallenge(result,'verify-reset');
      } else if (type === 'verify-signup' || type === 'verify-reset') {
        if (!challenge || challenge.expiresAt <= Date.now()) throw new Error('This code has expired. Choose Restart verification to request a new code.');
        const code = String(values.get('code') || '').trim();
        if (!/^\d{6}$/.test(code)) throw new Error('Enter the 6-digit verification code.');
        if (type === 'verify-signup') {
          const result = await authRequest('/signup/verify',{challengeId:challenge.id,code,remember:true},{signal});
          if (signal.aborted) return;
          await finishLogin(result.account);
        } else {
          const password = String(values.get('password') || '');
          if (password.length < 10 || password.length > 128) throw new Error('Use a password with 10–128 characters.');
          await authRequest('/reset/finish',{challengeId:challenge.id,code,password},{signal});
          if (signal.aborted) return;
          loginIdentifier = resetEmail;challenge = null;mode = 'login';error = '';notice = 'Password updated. Log in with your new password.';render();
        }
      }
    });
  }
  async function signOut() {
    const attempt = ++sessionAttempt;
    activeRequest?.abort();
    activeRequest = null;
    current = null;mode = 'login';draft = freshDraft();challenge = null;busy = false;error = '';notice = '';loginIdentifier = '';resetEmail = '';sessionReady = false;locking = true;lockError = '';render();
    try {
      await queueSessionClose('/logout');
      if (attempt === sessionAttempt) sessionReady = true;
    } catch (failure) {
      if (attempt === sessionAttempt) lockError = 'We could not confirm sign-out. Your previous session may still be active. Retry before signing in.';
      throw failure;
    } finally {
      if (attempt === sessionAttempt) { locking = false;render(); }
    }
  }
  render();
  ready = lockSession();
  return { render, signOut, get ready() { return ready; }, get currentAccount() { return current ? {...current} : null; } };
}
