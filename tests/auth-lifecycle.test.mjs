import test from 'node:test';
import assert from 'node:assert/strict';
import { initAuth } from '../dist/auth.js';

// A minimal DOM surface keeps these auth lifecycle tests dependency-free. It
// parses the actual rendered controls; all handlers and requests are real.
class Element {
  constructor(tag = 'div', attributes = {}) {
    this.tag = tag; this.attributes = attributes; this.children = []; this.listeners = new Map();
    this.dataset = Object.fromEntries(Object.entries(attributes).filter(([key]) => key.startsWith('data-')).map(([key, value]) => [key.slice(5).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase()), value]));
    this.value = attributes.value || ''; this.disabled = 'disabled' in attributes; this.checked = 'checked' in attributes;
    this.name = attributes.name; this.type = attributes.type; this.focused = false;
    this.classList = { add() {}, toggle() {} };
  }
  setAttribute(name, value) { this.attributes[name] = value; }
  getAttribute(name) { return this.attributes[name] ?? null; }
  addEventListener(type, callback) { this.listeners.set(type, [...(this.listeners.get(type) || []), callback]); }
  async emit(type) {
    const event = { currentTarget:this, target:this, preventDefault() {} };
    await Promise.all((this.listeners.get(type) || []).map(callback => callback(event)));
  }
  focus() { this.focused = true; }
  replaceChildren() { this.children = []; }
  get textContent() { return this.children.map(child => typeof child === 'string' ? child : child.textContent).join(''); }
  set textContent(value) { this.children = [String(value)]; }
  set innerHTML(html) {
    this.children = []; this.html = html;
    const stack = [this];
    for (const token of html.match(/<[^>]+>|[^<]+/g) || []) {
      if (token.startsWith('</')) { stack.pop(); continue; }
      if (!token.startsWith('<')) { stack.at(-1).children.push(token); continue; }
      const tag = token.match(/^<([\w-]+)/)?.[1];
      if (!tag) continue;
      const attributes = {};
      for (const match of token.slice(tag.length + 1).matchAll(/([\w-]+)(?:="([^"]*)"|='([^']*)')?/g)) attributes[match[1]] = match[2] ?? match[3] ?? '';
      const element = new Element(tag, attributes);
      element.parentElement = stack.at(-1); stack.at(-1).children.push(element);
      if (!['input','br','img','hr','meta','link'].includes(tag) && !token.endsWith('/>')) stack.push(element);
    }
  }
  matches(selector) {
    const tag = selector.match(/^[\w-]+/)?.[0];
    if (tag && tag !== this.tag) return false;
    const className = selector.match(/\.([\w-]+)/)?.[1];
    if (className && !(this.attributes.class || '').split(' ').includes(className)) return false;
    for (const [, name, value] of selector.matchAll(/\[([\w-]+)(?:="([^"]*)")?\]/g)) {
      if (!(name in this.attributes) || (value !== undefined && this.attributes[name] !== value)) return false;
    }
    return true;
  }
  querySelectorAll(selector) {
    const selectors = selector.split(',');
    const descendants = this.children.filter(child => child instanceof Element).flatMap(child => [child, ...child.querySelectorAll('*')]);
    return descendants.filter(element => selectors.some(part => element.matches(part.trim())));
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  get elements() {
    return Object.fromEntries(this.querySelectorAll('input').filter(input => input.type !== 'radio' || input.checked).map(input => [input.name,input]));
  }
}

const account = {id:'owner-one',username:'MochiOwner',email:'mochi@example.com'};
const recentKey = 'pawprint.verified-accounts.v1';
function deferred() { let resolve, reject; const promise = new Promise((done, fail) => { resolve = done; reject = fail; }); return {promise,resolve,reject}; }
function fixture(t, respond, saved = [], onLogin = () => {}) {
  const storage = new Map([[recentKey,JSON.stringify(saved)]]);
  const previous = globalThis.localStorage;
  globalThis.localStorage = {getItem:key => storage.get(key) ?? null,setItem:(key,value) => storage.set(key,value)};
  t.after(() => { if (previous === undefined) delete globalThis.localStorage; else globalThis.localStorage = previous; });
  const requests = [], logins = [], root = new Element();
  t.mock.method(globalThis,'fetch',async (url, options) => {
    const request = {path:url.replace('/api/auth',''),method:options.method,body:options.body ? JSON.parse(options.body) : undefined};
    requests.push(request); return respond(request);
  });
  const previousFormData = globalThis.FormData;
  globalThis.FormData = class {
    constructor(form) {
      this.values = new Map(form.querySelectorAll('input').filter(input => !input.disabled && (!['checkbox','radio'].includes(input.type) || input.checked)).map(input => [input.name,input.value || (input.type === 'checkbox' ? 'on' : '')]));
    }
    get(name) { return this.values.get(name) ?? null; }
  };
  t.after(() => { globalThis.FormData = previousFormData; });
  const auth = initAuth(root,{onLogin:entry => { logins.push(entry); return onLogin(entry); }});
  return {root,auth,requests,logins,storage};
}

test('reopening stays logged out and blocks all auth actions until the previous session is locked',async t => {
  const lock = deferred();
  const h = fixture(t,() => lock.promise);
  assert.deepEqual(h.requests,[{path:'/lock',method:'POST',body:{}}]);
  assert.equal(h.auth.currentAccount,null);
  assert.ok(h.root.querySelectorAll('button,input').every(control => control.disabled));
  await h.root.querySelector('[data-test-account]').emit('click');
  await h.root.querySelector('[data-explore-demo]').emit('click');
  await h.root.querySelector('form').emit('submit');
  assert.equal(h.requests.length,1); assert.equal(h.logins.length,0);
  lock.resolve(Response.json({accounts:[account]}));
  assert.equal(await h.auth.ready,true);
  assert.equal(h.auth.currentAccount,null); assert.equal(h.logins.length,0);
  assert.equal(h.root.querySelector('[data-test-account]').disabled,false);
  assert.match(h.root.textContent,/Remember this account/);
  assert.doesNotMatch(h.root.textContent,/Keep me signed in/);
  assert.equal(h.root.querySelector('[data-auth-account]').getAttribute('aria-label'),'Continue as MochiOwner');
  assert.deepEqual(Object.keys(JSON.parse(h.storage.get(recentKey))[0]).sort(),['email','id','lastUsed','username']);
});

test('failed initial lock keeps account actions gated and offers a working retry',async t => {
  let attempts = 0;
  const h = fixture(t,() => ++attempts === 1 ? Response.json({message:'Unavailable'},{status:503}) : Response.json({accounts:[]}));
  assert.equal(await h.auth.ready,false);
  assert.match(h.root.textContent,/could not confirm.*previous session is signed out/);
  assert.equal(h.root.querySelector('[data-test-account]').disabled,true);
  const retry = h.root.querySelector('[data-retry-lock]');
  assert.equal(retry.disabled,false);
  await retry.emit('click'); await h.auth.ready;
  assert.equal(attempts,2); assert.equal(h.root.querySelector('[data-retry-lock]'),null);
  assert.equal(h.root.querySelector('[data-test-account]').disabled,false);
});

test('a Recent account resumes only its explicit server grant without requesting a password or session lookup',async t => {
  const h = fixture(t,request => Response.json(request.path === '/lock' ? {accounts:[account]} : {account}));
  await h.auth.ready;
  await h.root.querySelector('[data-auth-account]').emit('click');
  assert.deepEqual(h.requests.map(request => request.path),['/lock','/resume']);
  assert.deepEqual(h.requests[1],{path:'/resume',method:'POST',body:{accountId:account.id}});
  assert.equal(h.logins.length,1); assert.equal(h.auth.currentAccount.id,account.id);
});

test('an expired saved grant falls back to a focused password form and stops advertising one-click entry',async t => {
  const h = fixture(t,request => request.path === '/lock'
    ? Response.json({accounts:[account]})
    : Response.json({code:'quick_login_expired',message:'Saved sign-in expired'},{status:401}));
  await h.auth.ready;
  await h.root.querySelector('[data-auth-account]').emit('click');
  assert.equal(h.logins.length,0); assert.equal(h.auth.currentAccount,null);
  assert.equal(h.root.querySelector('[name="identifier"]').value,account.email);
  assert.equal(h.root.querySelector('[name="password"]').focused,true);
  assert.match(h.root.querySelector('.auth-notice').textContent,/Saved sign-in expired/);
  assert.match(h.root.querySelector('[data-auth-account]').getAttribute('aria-label'),/^Enter password/);
  await h.root.querySelector('[data-auth-account]').emit('click');
  assert.equal(h.requests.length,2);
});

test('legacy local account metadata asks for a password and is not treated as a grant',async t => {
  const h = fixture(t,() => Response.json({accounts:[]}),[account]);
  await h.auth.ready;
  assert.match(h.root.textContent,/Password required/);
  await h.root.querySelector('[data-auth-account]').emit('click');
  assert.equal(h.requests.length,1); assert.equal(h.logins.length,0);
  assert.equal(h.root.querySelector('[name="identifier"]').value,account.email);
});

test('forget is a separate accessible control and revokes the grant before clearing its row',async t => {
  const h = fixture(t,request => Response.json(request.path === '/lock' ? {accounts:[account]} : {ok:true}));
  await h.auth.ready;
  const recent = h.root.querySelector('[data-auth-account]'), forget = h.root.querySelector('[data-forget-account]');
  assert.equal(forget.parentElement,recent.parentElement);
  assert.notEqual(forget.parentElement.tag,'button');
  assert.equal(forget.getAttribute('aria-label'),'Forget saved account MochiOwner');
  await forget.emit('click');
  assert.deepEqual(h.requests[1],{path:'/forget',method:'POST',body:{accountId:account.id}});
  assert.equal(h.root.querySelector('[data-auth-account]'),null);
  assert.deepEqual(JSON.parse(h.storage.get(recentKey)),[]);
});

test('sign-out cannot race a new login and retains the saved grant for deliberate entry afterward',async t => {
  const logout = deferred();
  const h = fixture(t,request => request.path === '/logout' ? logout.promise : Response.json(request.path === '/lock' ? {accounts:[account]} : {account}));
  await h.auth.ready; await h.root.querySelector('[data-auth-account]').emit('click');
  const signingOut = h.auth.signOut();
  assert.equal(h.auth.currentAccount,null);
  assert.equal(h.root.querySelector('[data-auth-account]').disabled,true);
  await h.root.querySelector('[data-auth-account]').emit('click');
  await h.root.querySelector('[data-test-account]').emit('click');
  assert.deepEqual(h.requests.map(request => request.path),['/lock','/resume','/logout']);
  logout.resolve(Response.json({ok:true})); await signingOut;
  assert.equal(h.root.querySelector('[data-auth-account]').disabled,false);
  await h.root.querySelector('[data-auth-account]').emit('click');
  assert.equal(h.requests.at(-1).path,'/resume'); assert.equal(h.logins.length,2);
});

test('an unconfirmed server sign-out leaves entry disabled until a successful lock retry',async t => {
  const h = fixture(t,request => request.path === '/logout'
    ? Response.json({message:'Server unavailable'},{status:503})
    : Response.json(request.path === '/lock' ? {accounts:[account]} : {account}));
  await h.auth.ready; await h.root.querySelector('[data-auth-account]').emit('click');
  await assert.rejects(h.auth.signOut());
  assert.equal(h.auth.currentAccount,null);
  assert.equal(h.root.querySelector('[data-auth-account]').disabled,true);
  assert.match(h.root.textContent,/previous session may still be active/);
  await h.root.querySelector('[data-auth-account]').emit('click');
  assert.equal(h.requests.length,3);
  await h.root.querySelector('[data-retry-lock]').emit('click');
  assert.equal(await h.auth.ready,true);
  assert.equal(h.root.querySelector('[data-auth-account]').disabled,false);
  assert.equal(h.requests.at(-1).path,'/lock');
});

test('sign-out waits for the initial lock response before dispatching and keeps entry disabled',async t => {
  const lock = deferred(), logout = deferred();
  const h = fixture(t,request => request.path === '/lock' ? lock.promise : logout.promise);
  const initialLock = h.auth.ready;
  const signingOut = h.auth.signOut();
  assert.deepEqual(h.requests.map(request => request.path),['/lock']);
  lock.resolve(Response.json({accounts:[account]}));
  assert.equal(await initialLock,false);
  assert.deepEqual(h.requests.map(request => request.path),['/lock','/logout']);
  assert.equal(h.auth.currentAccount,null);
  assert.equal(h.root.getAttribute('aria-busy'),'true');
  assert.ok(h.root.querySelectorAll('button,input').every(control => control.disabled));
  await h.root.querySelector('[data-test-account]').emit('click');
  assert.equal(h.requests.length,2);
  logout.resolve(Response.json({ok:true})); await signingOut;
  assert.equal(h.root.getAttribute('aria-busy'),'false');
  assert.equal(h.root.querySelector('[data-test-account]').disabled,false);
});

test('an aborted resume response cannot restore an account or unlock a later pending resume',async t => {
  const obsolete = deferred(), current = deferred();
  let resumes = 0;
  // Deliberately ignore AbortSignal, as a completed network response can still
  // reach application code after sign-out has invalidated the original action.
  const h = fixture(t,request => request.path === '/lock' ? Response.json({accounts:[account]})
    : request.path === '/logout' ? Response.json({ok:true})
    : ++resumes === 1 ? obsolete.promise : current.promise);
  await h.auth.ready;
  const oldClick = h.root.querySelector('[data-auth-account]').emit('click');
  await h.auth.signOut();
  const newClick = h.root.querySelector('[data-auth-account]').emit('click');
  assert.equal(resumes,2);
  obsolete.resolve(Response.json({account})); await oldClick;
  assert.equal(h.auth.currentAccount,null); assert.equal(h.logins.length,0);
  assert.equal(h.root.getAttribute('aria-busy'),'true');
  assert.equal(h.root.querySelector('[data-auth-account]').disabled,true);
  await h.root.querySelector('[data-auth-account]').emit('click');
  assert.equal(resumes,2);
  current.resolve(Response.json({account})); await newClick;
  assert.equal(h.auth.currentAccount.id,account.id); assert.equal(h.logins.length,1);
  assert.equal(h.root.getAttribute('aria-busy'),'false');
});

test('repeated sign-outs serialize cookie-clearing responses before allowing a saved-account resume',async t => {
  const first = deferred(), second = deferred();
  let closes = 0;
  const h = fixture(t,request => request.path === '/lock' ? Response.json({accounts:[account]})
    : request.path === '/logout' ? (++closes === 1 ? first.promise : second.promise)
    : Response.json({account}));
  await h.auth.ready;
  const older = h.auth.signOut(), newer = h.auth.signOut();
  assert.equal(closes,1);
  first.resolve(Response.json({ok:true})); await older;
  assert.equal(closes,2);
  assert.equal(h.root.querySelector('[data-auth-account]').disabled,true);
  await h.root.querySelector('[data-auth-account]').emit('click');
  assert.equal(h.requests.filter(request => request.path === '/resume').length,0);
  second.resolve(Response.json({ok:true})); await newer;
  await h.root.querySelector('[data-auth-account]').emit('click');
  assert.deepEqual(h.requests.map(request => request.path),['/lock','/logout','/logout','/resume']);
  assert.equal(h.auth.currentAccount.id,account.id);
});

function sessionResponse(request) {
  if (request.path === '/lock') return Response.json({accounts:[account]});
  if (request.path === '/status') return Response.json({emailConfigured:true,storageReady:true});
  if (request.path === '/signup/start') return Response.json({challengeId:'challenge-one',expiresAt:Date.now()+60000});
  if (request.path === '/logout') return Response.json({ok:true});
  return Response.json({account:request.path === '/test-session' ? {...account,isTest:true} : account});
}

async function prepareSessionEntry(t, h, entry) {
  if (entry === 'signup') {
    await h.root.querySelector('[data-auth-mode="signup"]').emit('click');
    // Allow the independently requested email-service status to reach the UI.
    await new Promise(resolve => setImmediate(resolve));
    let form = h.root.querySelector('form');
    form.elements.username.value = account.username;
    form.elements.email.value = account.email;
    form.elements.password.value = 'a-secure-passphrase';
    await form.emit('submit');
    form = h.root.querySelector('form');
    form.elements.petName.value = 'Mochi';
    form.elements.petBirthday.value = '2023-03-17';
    await form.emit('submit');
    h.root.querySelector('[name="code"]').value = '123456';
    t.after(() => h.auth.signOut()); // Also stops the verification resend timer.
  } else if (entry === 'login') {
    h.root.querySelector('[name="identifier"]').value = account.email;
    h.root.querySelector('[name="password"]').value = 'a-secure-passphrase';
  }
  const selector = {recent:'[data-auth-account]',test:'[data-test-account]',demo:'[data-explore-demo]'}[entry];
  return () => h.root.querySelector(selector || 'form').emit(selector ? 'click' : 'submit');
}

for (const entry of ['login','recent','test','signup','demo']) {
  test(`${entry} entry remains busy until app setup completes and rejects duplicate entry`,async t => {
    const started = deferred(), setup = deferred();
    const h = fixture(t,sessionResponse,[],() => { started.resolve();return setup.promise; });
    await h.auth.ready;
    const enter = await prepareSessionEntry(t,h,entry);
    const entering = enter();
    await Promise.race([started.promise,entering.then(() => { throw new Error(`Entry ended before setup: ${h.root.querySelector('.auth-error').textContent}`); })]);
    assert.equal(h.root.getAttribute('aria-busy'),'true');
    assert.ok(h.root.querySelectorAll('button,input').every(control => control.disabled));
    const requests = h.requests.length;
    await enter();
    await h.root.querySelector('[data-test-account]').emit('click');
    await h.root.querySelector('[data-explore-demo]').emit('click');
    assert.equal(h.requests.length,requests);
    assert.equal(h.logins.length,1);
    if (entry === 'demo') assert.deepEqual(h.requests.map(request => request.path),['/lock']);
    if (entry === 'signup') assert.ok(h.requests.some(request => request.path === '/signup/verify'));
    setup.resolve();await entering;
    assert.equal(h.root.getAttribute('aria-busy'),'false');
    assert.equal(h.root.querySelector('[data-test-account]').disabled,false);
  });
}

for (const entry of ['test','demo']) {
  test(`${entry} entry shows asynchronous setup errors and releases the busy state`,async t => {
    const started = deferred(), setup = deferred();
    const h = fixture(t,sessionResponse,[],() => { started.resolve();return setup.promise; });
    await h.auth.ready;
    const enter = await prepareSessionEntry(t,h,entry);
    const entering = enter();
    await Promise.race([started.promise,entering.then(() => { throw new Error(`Entry ended before setup: ${h.root.querySelector('.auth-error').textContent}`); })]);
    setup.reject(new Error('Could not prepare the app. Please try again.'));
    await entering;
    assert.match(h.root.querySelector('.auth-error').textContent,/Could not prepare the app/);
    assert.equal(h.root.getAttribute('aria-busy'),'false');
    assert.equal(h.root.querySelector('[data-explore-demo]').disabled,false);
  });
}

test('failed authentication never starts app setup',async t => {
  const h = fixture(t,request => request.path === '/lock' ? sessionResponse(request)
    : Response.json({message:'Check your account and password.'},{status:401}));
  await h.auth.ready;
  const enter = await prepareSessionEntry(t,h,'login');
  await enter();
  assert.equal(h.logins.length,0);
  assert.equal(h.auth.currentAccount,null);
  assert.match(h.root.querySelector('.auth-error').textContent,/Check your account and password/);
  assert.equal(h.root.getAttribute('aria-busy'),'false');
});
