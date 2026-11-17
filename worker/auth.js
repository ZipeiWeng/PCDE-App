// Email/password accounts and isolated, expiring test sessions. Mail-dependent
// actions stay disabled without a sender. Never return, log, or persist a plaintext password/OTP.
// D1 batch is transactional: https://developers.cloudflare.com/d1/worker-api/d1-database/
// Sender contract: https://resend.com/docs/api-reference/emails/send-email
const AUTH_COOKIE = '__Host-pawprint_session';
const AUTH_QUICK_PREFIX = '__Host-pawprint_quick_';
const AUTH_TEST_RESUME_COOKIE = '__Host-pawprint_test_resume';
const AUTH_QUICK_TTL = 30 * 86400;
const AUTH_CODE_TTL = 10 * 60 * 1000;
const AUTH_RESEND_WAIT = 60 * 1000;
const AUTH_TEST_TTL = 30 * 86400 * 1000; // Device credential lifetime, renewed on explicit sign-in.
const AUTH_PASSWORD_ITERATIONS = 100000; // Web Crypto's Workers-supported ceiling.
const authEncoder = new TextEncoder();
const authOnboardingSchemas = new WeakMap();

class AuthFailure extends Error {
  constructor(status, code, message, headers = {}) { super(message); this.status = status; this.code = code; this.headers = headers; }
}
function authJSON(data, status = 200, headers = {}) {
  const responseHeaders = new Headers({ 'Content-Type':'application/json; charset=utf-8', 'Cache-Control':'no-store', 'X-Content-Type-Options':'nosniff' });
  for (const [name,value] of Object.entries(headers)) for (const item of Array.isArray(value) ? value : [value]) responseHeaders.append(name,item);
  return new Response(JSON.stringify(data), { status, headers:responseHeaders });
}
function authEmailReady(env) { return Boolean(env.RESEND_API_KEY?.trim() && env.AUTH_EMAIL_FROM?.trim()); }
function authConfigured(env) { return authStorageReady(env) && authEmailReady(env); }
function authTestReady(env) { return authStorageReady(env) && Boolean(env.OPENAI_API_KEY?.trim()); }
function authStorageReady(env) { return Boolean(env.AUTH_DB?.prepare && typeof env.AUTH_SECRET === 'string' && env.AUTH_SECRET.length >= 32); }
function authHex(bytes) { return Array.from(new Uint8Array(bytes), value => value.toString(16).padStart(2, '0')).join(''); }
function authRandom(bytes = 32) { return authHex(crypto.getRandomValues(new Uint8Array(bytes))); }
function authCode() {
  const bytes = new Uint32Array(1); let value;
  // Rejection sampling avoids modulo bias.
  do { crypto.getRandomValues(bytes); value = bytes[0]; } while (value >= 4294000000);
  return String(value % 1000000).padStart(6, '0');
}
function authEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  let diff = a.length ^ b.length;
  for (let index = 0; index < Math.max(a.length, b.length); index++) diff |= (a.charCodeAt(index) || 0) ^ (b.charCodeAt(index) || 0);
  return diff === 0;
}
async function authHmac(secret, value) {
  const key = await crypto.subtle.importKey('raw', authEncoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return authHex(await crypto.subtle.sign('HMAC', key, authEncoder.encode(value)));
}
async function authPassword(password, salt, secret) {
  const base = await crypto.subtle.importKey('raw', authEncoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', iterations: AUTH_PASSWORD_ITERATIONS, salt: authEncoder.encode(salt) }, base, 256);
  return authHmac(secret, `password:v1:${authHex(bits)}`);
}
const authNorm = value => String(value).normalize('NFKC').trim().toLowerCase();
function authText(value, name, min, max) {
  if (typeof value !== 'string' || value.trim().length < min || value.trim().length > max || /[\u0000-\u001f\u007f]/.test(value)) throw new AuthFailure(400, 'invalid_input', `Enter a valid ${name}.`);
  return value.trim();
}
function authEmail(value) {
  const email = authText(value, 'email address', 3, 254);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new AuthFailure(400, 'invalid_email', 'Enter a valid email address.');
  return authNorm(email);
}
function authValidatePassword(value) {
  if (typeof value !== 'string' || value.length < 10 || value.length > 128 || value.trim().length < 10) throw new AuthFailure(400, 'invalid_password', 'Use a password between 10 and 128 characters.');
  return value;
}
function authProfile(input, now) {
  const username = authText(input.username, 'username', 3, 30);
  if (!/^[A-Za-z0-9._-]{3,30}$/.test(username)) throw new AuthFailure(400, 'invalid_username', 'Use 3–30 letters, numbers, periods, underscores or hyphens.');
  const email = authEmail(input.email);
  const petName = authText(input.petName, 'pet name', 1, 60);
  const birthday = input.petBirthday;
  if (typeof birthday !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(birthday)) throw new AuthFailure(400, 'invalid_birthday', 'Enter your pet’s birthday.');
  const parsed = new Date(`${birthday}T00:00:00Z`);
  if (!Number.isFinite(parsed.valueOf()) || parsed.toISOString().slice(0,10) !== birthday || birthday > new Date(now).toISOString().slice(0,10) || birthday < '1900-01-01') throw new AuthFailure(400, 'invalid_birthday', 'Enter a birthday that is not in the future.');
  if (!['female', 'male', 'unknown'].includes(input.petSex)) throw new AuthFailure(400, 'invalid_sex', 'Choose your pet’s sex.');
  return { username, usernameNorm: authNorm(username), email, emailNorm: email, petName, petNameNorm: authNorm(petName), petBirthday: birthday, petSex: input.petSex };
}
async function authOnboardingSchema(db) {
  let ready = authOnboardingSchemas.get(db);
  if (!ready) {
    ready = db.prepare(`CREATE TABLE IF NOT EXISTS auth_onboarding (
      account_id TEXT PRIMARY KEY REFERENCES auth_accounts(id) ON DELETE CASCADE,
      completed_at INTEGER NOT NULL
    )`).run();
    authOnboardingSchemas.set(db, ready);
    ready.catch(() => authOnboardingSchemas.delete(db));
  }
  await ready;
}
async function authPublicAccount(row, env) {
  let onboardingCompleted = false;
  if (!row.is_test) {
    await authOnboardingSchema(env.AUTH_DB);
    onboardingCompleted = Boolean(await env.AUTH_DB.prepare('SELECT completed_at FROM auth_onboarding WHERE account_id=?').bind(row.id).first());
  }
  return { id: row.id, username: row.username, email: row.email, petName: row.pet_name, petBirthday: row.pet_birthday, petSex: row.pet_sex, onboardingCompleted, ...(row.is_test ? {isTest:true} : {}) };
}
function authCookie(request) {
  const found = request.headers.get('cookie')?.split(';').map(part => part.trim()).find(part => part.startsWith(`${AUTH_COOKIE}=`));
  const value = found?.slice(AUTH_COOKIE.length + 1);
  return /^(?:(?:test|active)\.)?[a-f0-9]{64}$/.test(value || '') ? value : null;
}
function authNamedCookie(name, token, seconds) {
  return `${name}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax${seconds === undefined ? '' : `; Max-Age=${seconds}`}`;
}
function authSetCookie(token, seconds) { return authNamedCookie(AUTH_COOKIE,token,seconds === 0 ? 0 : undefined); }
function authCookieValue(request, name) {
  return request.headers.get('cookie')?.split(';').map(part => part.trim()).find(part => part.startsWith(`${name}=`))?.slice(name.length+1) || '';
}
function authQuickTokens(request) {
  return (request.headers.get('cookie') || '').split(';').map(part => part.trim().split('=')).filter(([name,token]) => new RegExp(`^${AUTH_QUICK_PREFIX}[a-f0-9]{32}$`).test(name) && /^[a-f0-9]{64}$/.test(token || '')).slice(0,20).map(([name,token]) => ({id:name.slice(AUTH_QUICK_PREFIX.length),token}));
}
async function authRevokeActive(request, env) {
  const token = authCookie(request);
  if (!token) return;
  const hash = await authHmac(env.AUTH_SECRET,`session:${token}`);
  // The remembered test identity survives a lock; the old active token must not.
  await env.AUTH_DB.batch([
    env.AUTH_DB.prepare('DELETE FROM auth_sessions WHERE token_hash=?').bind(hash),
    env.AUTH_DB.prepare('UPDATE auth_test_sessions SET token_hash=? WHERE token_hash=?').bind(await authHmac(env.AUTH_SECRET,`locked:${authRandom()}`),hash),
  ]);
}
async function authRemember(request, env, account, now) {
  const token=authRandom(), hash='quick.'+await authHmac(env.AUTH_SECRET,`quick:${token}`);
  const existing=authQuickTokens(request), old=existing.find(item=>item.id===account.id);
  const others=[];
  for(const item of existing.filter(item=>item.id!==account.id)) {
    const saved=await env.AUTH_DB.prepare('SELECT created_at FROM auth_sessions WHERE token_hash=? AND account_id=? AND expires_at>?').bind('quick.'+await authHmac(env.AUTH_SECRET,`quick:${item.token}`),item.id,now).first();
    others.push({...item,createdAt:saved?.created_at || 0});
  }
  const remove=others.sort((a,b)=>a.createdAt-b.createdAt).slice(0,Math.max(0,others.length-4));
  const cookies=[authNamedCookie(AUTH_QUICK_PREFIX+account.id,token,AUTH_QUICK_TTL)];
  const statements=[env.AUTH_DB.prepare('INSERT INTO auth_sessions (token_hash,account_id,expires_at,created_at) SELECT ?,?,?,? WHERE EXISTS(SELECT 1 FROM auth_accounts WHERE id=? AND password_hash=?)').bind(hash,account.id,now+AUTH_QUICK_TTL*1000,now,account.id,account.password_hash)];
  if(old)statements.push(env.AUTH_DB.prepare('DELETE FROM auth_sessions WHERE token_hash=? AND account_id=?').bind('quick.'+await authHmac(env.AUTH_SECRET,`quick:${old.token}`),account.id));
  for(const item of remove) {
    statements.push(env.AUTH_DB.prepare('DELETE FROM auth_sessions WHERE token_hash=? AND account_id=?').bind('quick.'+await authHmac(env.AUTH_SECRET,`quick:${item.token}`),item.id));
    cookies.push(authNamedCookie(AUTH_QUICK_PREFIX+item.id,'',0));
  }
  statements.push(env.AUTH_DB.prepare('DELETE FROM auth_sessions WHERE expires_at<=?').bind(now));
  const results=await env.AUTH_DB.batch(statements);
  if(results[0].meta?.changes!==1)throw new AuthFailure(401,'invalid_credentials','Your password changed. Please log in again.');
  return cookies;
}
async function authSavedAccounts(request,env,now) {
  const accounts=[];
  for(const item of authQuickTokens(request)) {
    const hash='quick.'+await authHmac(env.AUTH_SECRET,`quick:${item.token}`);
    const row=await env.AUTH_DB.prepare('SELECT a.*,s.created_at AS remembered_at FROM auth_sessions s JOIN auth_accounts a ON a.id=s.account_id WHERE s.token_hash=? AND s.account_id=? AND s.expires_at>?').bind(hash,item.id,now).first();
    if(row)accounts.push({account:await authPublicAccount(row,env),rememberedAt:row.remembered_at});
  }
  return accounts.sort((a,b)=>b.rememberedAt-a.rememberedAt).slice(0,5).map(item=>item.account);
}
async function authTestResumeCookie(env,row,now) {
  const signature=await authHmac(env.AUTH_SECRET,`test-resume:${row.id}:${row.expires_at}`);
  return authNamedCookie(AUTH_TEST_RESUME_COOKIE,`${row.id}.${signature}`,Math.max(1,Math.ceil((row.expires_at-now)/1000)));
}
async function authSavedTest(request,env,now) {
  const value=authCookieValue(request,AUTH_TEST_RESUME_COOKIE);
  if(!/^test_[a-f0-9]{32}\.[a-f0-9]{64}$/.test(value))return null;
  const [id,signature]=value.split('.');
  const row=await env.AUTH_DB.prepare('SELECT id,expires_at FROM auth_test_sessions WHERE id=? AND expires_at>?').bind(id,now).first();
  return row && authEqual(signature,await authHmac(env.AUTH_SECRET,`test-resume:${row.id}:${row.expires_at}`)) ? row : null;
}
async function authLock(request,env,now) {
  const current=await authCurrent(request,env,now), cookies=[];
  const accounts=await authSavedAccounts(request,env,now);
  // Migrate the pre-quick-login persistent session, but never remember a new
  // login that explicitly opted out (new active tokens are namespaced).
  if(current && !current.is_test && !authCookie(request).startsWith('active.') && !accounts.some(item=>item.id===current.id)) {
    const legacyHash=await authHmac(env.AUTH_SECRET,`session:${authCookie(request)}`);
    const legacy=await env.AUTH_DB.prepare('SELECT expires_at,created_at FROM auth_sessions WHERE token_hash=?').bind(legacyHash).first();
    if(legacy && legacy.expires_at-legacy.created_at>86400000) {
      cookies.push(...await authRemember(request,env,current,now));accounts.unshift(await authPublicAccount(current,env));accounts.splice(5);
    }
  }
  if(current?.is_test)cookies.push(await authTestResumeCookie(env,current,now));
  await authRevokeActive(request,env);
  cookies.push(authSetCookie('',0));
  return authJSON({accounts},200,{'Set-Cookie':cookies});
}
function authOrigin(request) {
  const origin = request.headers.get('origin');
  if (origin !== new URL(request.url).origin || ['cross-site', 'none'].includes(request.headers.get('sec-fetch-site'))) throw new AuthFailure(403, 'origin_rejected', 'This request must come from Pawprint.');
}
async function authBody(request) {
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) throw new AuthFailure(415, 'invalid_content_type', 'Send a JSON request.');
  const length = request.headers.get('content-length');
  if (length && (!/^\d+$/.test(length) || Number(length) > 8192)) throw new AuthFailure(413, 'request_too_large', 'This request is too large.');
  let size = 0; const chunks = []; const reader = request.body?.getReader();
  if (!reader) throw new AuthFailure(400, 'invalid_json', 'The request is empty.');
  while (true) {
    const part = await reader.read(); if (part.done) break;
    size += part.value.byteLength;
    if (size > 8192) { await reader.cancel(); throw new AuthFailure(413, 'request_too_large', 'This request is too large.'); }
    chunks.push(part.value);
  }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try { const parsed = JSON.parse(new TextDecoder().decode(bytes)); if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw Error(); return parsed; }
  catch { throw new AuthFailure(400, 'invalid_json', 'Send a valid JSON request.'); }
}
async function authLimit(env, label, key, max, window, now, amount = 1) {
  const bucket = await authHmac(env.AUTH_SECRET, `limit:${label}:${key}`);
  const row = await env.AUTH_DB.prepare(`INSERT INTO auth_limits (bucket_key, count, expires_at) VALUES (?, ?, ?)
    ON CONFLICT(bucket_key) DO UPDATE SET count = CASE WHEN auth_limits.expires_at <= ? THEN excluded.count ELSE auth_limits.count + excluded.count END,
    expires_at = CASE WHEN auth_limits.expires_at <= ? THEN excluded.expires_at ELSE auth_limits.expires_at END RETURNING count, expires_at`).bind(bucket, amount, now + window, now, now).first();
  if (row.count > max) throw new AuthFailure(429, 'too_many_attempts', 'Too many attempts. Please wait and try again.', { 'Retry-After': String(Math.max(1, Math.ceil((row.expires_at - now) / 1000))) });
}
async function authCurrent(request, env, now) {
  const token = authCookie(request);
  if (!token || !authStorageReady(env)) return null;
  const hash = await authHmac(env.AUTH_SECRET, `session:${token}`);
  const account = await env.AUTH_DB.prepare(`SELECT a.* FROM auth_sessions s JOIN auth_accounts a ON a.id=s.account_id WHERE s.token_hash=? AND s.expires_at>?`).bind(hash, now).first();
  if (account) return account;
  const test = await env.AUTH_DB.prepare('SELECT id, expires_at FROM auth_test_sessions WHERE token_hash=? AND expires_at>?').bind(hash,now).first();
  return test ? authTestAccount(test) : null;
}
// Export only the verified principal, never password hashes or account details.
// Mail configuration is unrelated to whether an existing session is valid.
export async function verifiedAccountId(request, env = {}, now = Date.now()) {
  const account = await authCurrent(request, env, now);
  return account?.id || null;
}
function authTestAccount(row) {
  return {id:row.id,username:'mochi_test',email:'',pet_name:'Mochi',pet_birthday:'2023-03-17',pet_sex:'female',is_test:true,expires_at:row.expires_at};
}
async function authCreateTest(request, env, now) {
  if (!authTestReady(env)) throw new AuthFailure(503,'test_not_configured','The AI test account is not connected yet. Please try again after setup is complete.');
  const current = await authCurrent(request,env,now);
  const saved = current?.is_test ? current : await authSavedTest(request,env,now);
  if (saved) {
    const token='test.'+authRandom(),hash=await authHmac(env.AUTH_SECRET,`session:${token}`);
    await authRevokeActive(request,env);
    const renewed={...saved,expires_at:now+AUTH_TEST_TTL};
    await env.AUTH_DB.prepare('UPDATE auth_test_sessions SET token_hash=?,expires_at=? WHERE id=? AND expires_at>?').bind(hash,renewed.expires_at,saved.id,now).run();
    return authJSON({account:await authPublicAccount(authTestAccount(renewed),env),expiresIn:AUTH_TEST_TTL/1000},200,{'Set-Cookie':[authSetCookie(token,AUTH_TEST_TTL/1000),await authTestResumeCookie(env,renewed,now)]});
  }
  const id='test_'+authRandom(16),token='test.'+authRandom(),hash=await authHmac(env.AUTH_SECRET,`session:${token}`),expires=now+AUTH_TEST_TTL;
  await authRevokeActive(request,env);
  await env.AUTH_DB.batch([
    env.AUTH_DB.prepare('DELETE FROM auth_test_sessions WHERE expires_at<=?').bind(now),
    env.AUTH_DB.prepare('INSERT INTO auth_test_sessions (id,token_hash,ip_hash,expires_at,created_at) VALUES (?,?,?,?,?)').bind(id,hash,'',expires,now),
  ]);
  return authJSON({account:await authPublicAccount(authTestAccount({id,expires_at:expires}),env),expiresIn:AUTH_TEST_TTL/1000},200,{'Set-Cookie':[authSetCookie(token,AUTH_TEST_TTL/1000),await authTestResumeCookie(env,{id,expires_at:expires},now)]});
}
async function authMail(env, email, code, kind, challengeId, now, fetchImpl) {
  const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetchImpl('https://api.resend.com/emails', { method: 'POST', signal: controller.signal, headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY.trim()}`, 'Content-Type': 'application/json', 'Idempotency-Key': `pawprint-${challengeId}-${now}`,
    }, body: JSON.stringify({ from: env.AUTH_EMAIL_FROM.trim(), to: [email], subject: kind === 'signup' ? 'Verify your Pawprint email' : 'Reset your Pawprint password', text: `${kind === 'signup' ? 'Your Pawprint email verification code' : 'Your Pawprint password reset code'} is ${code}.\n\nThis code expires in 10 minutes. Do not share it. If you did not request it, you can ignore this message.` }) });
    // Classify by status only: provider bodies can contain private account data.
    if (response.status === 401 || response.status === 403) throw new AuthFailure(503, 'email_sender_configuration', 'Verification email is unavailable. The sender needs attention.');
    if (response.status === 429) {
      const raw = response.headers.get('retry-after') || '';
      const retryAfter = /^\d+$/.test(raw) ? Math.max(1, Math.min(3600, Number(raw))) : 60;
      throw new AuthFailure(429, 'email_rate_limited', 'Email sending is busy. Please wait before trying again.', { 'Retry-After': String(retryAfter) });
    }
    if (!response.ok) throw new Error('sender unavailable');
    const result = await response.json().catch(() => null);
    if (!result || typeof result.id !== 'string' || !result.id.trim()) throw new Error('sender rejected');
  } catch (error) {
    if (error instanceof AuthFailure) throw error;
    throw new AuthFailure(503, 'email_unavailable', 'We could not confirm email delivery. Please try again later.');
  }
  finally { clearTimeout(timeout); }
}
async function authStart(env, profile, account, kind, now, fetchImpl) {
  const id = authRandom(24), code = authCode(), email = kind === 'signup' ? profile.emailNorm : profile.email;
  const hash = await authHmac(env.AUTH_SECRET, `code:${id}:${code}`);
  await env.AUTH_DB.prepare(`INSERT INTO auth_challenges (id,kind,email_norm,account_id,payload_json,code_hash,expires_at,attempts,created_at,resend_at,consumed_at) VALUES (?,?,?,?,?,?,?,0,?,?,NULL)`).bind(id, kind, email, account?.id || null, kind === 'signup' ? JSON.stringify(profile) : null, hash, now + AUTH_CODE_TTL, now, now).run();
  try { if (kind === 'signup' || account) await authMail(env, email, code, kind, id, now, fetchImpl); }
  catch (error) { await env.AUTH_DB.prepare('DELETE FROM auth_challenges WHERE id=?').bind(id).run(); throw error; }
  return { challengeId: id, expiresIn: AUTH_CODE_TTL / 1000, resendAfter: AUTH_RESEND_WAIT / 1000 };
}
async function authAttempt(env, body, kind, now) {
  const id = authText(body.challengeId, 'verification request', 48, 48);
  if (!/^[a-f0-9]{48}$/.test(id) || typeof body.code !== 'string' || !/^\d{6}$/.test(body.code)) throw new AuthFailure(400, 'invalid_code', 'Enter the six-digit code from your email.');
  const row = await env.AUTH_DB.prepare(`UPDATE auth_challenges SET attempts=attempts+1 WHERE id=? AND kind=? AND consumed_at IS NULL AND expires_at>? AND attempts<5 RETURNING *`).bind(id, kind, now).first();
  const hash = await authHmac(env.AUTH_SECRET, `code:${id}:${body.code}`);
  if (!row || !authEqual(hash, row.code_hash)) throw new AuthFailure(400, 'invalid_code', 'The code is incorrect or expired. Request a new code if needed.');
  return row;
}
async function authIssueSession(env, accountId, expectedPasswordHash, remember, now) {
  const token = 'active.'+authRandom(), hash = await authHmac(env.AUTH_SECRET, `session:${token}`), seconds = 86400;
  const result = await env.AUTH_DB.prepare('INSERT INTO auth_sessions (token_hash,account_id,expires_at,created_at) SELECT ?,?,?,? WHERE EXISTS(SELECT 1 FROM auth_accounts WHERE id=? AND password_hash=?)').bind(hash, accountId, now + seconds * 1000, now, accountId, expectedPasswordHash).run();
  if (result.meta?.changes !== 1) throw new AuthFailure(401, 'invalid_credentials', 'Your password changed. Please log in again.');
  return authSetCookie(token, seconds, remember === true);
}

export async function handleAuth(request, env = {}, options = {}) {
  const path = new URL(request.url).pathname;
  if (!path.startsWith('/api/auth/')) return null;
  const now = options.now ? options.now() : Date.now();
  const fetchImpl = options.fetchImpl || fetch;
  const ip = request.headers.get('cf-connecting-ip') || 'unknown';
  try {
    if (request.method === 'GET' && ['/api/auth/status', '/api/auth/session'].includes(path)) {
      const row = await authCurrent(request, env, now);
      return authJSON(path.endsWith('/status') ? { configured: authConfigured(env), storageReady:authStorageReady(env), emailConfigured:authEmailReady(env), testSessionAvailable:authTestReady(env), session: row ? await authPublicAccount(row,env) : null } : { account: row ? await authPublicAccount(row,env) : null });
    }
    if (request.method !== 'POST') throw new AuthFailure(405, 'method_not_allowed', 'This action requires a POST request.', { Allow: 'POST' });
    authOrigin(request);
    if (['/api/auth/logout','/api/auth/lock'].includes(path)) {
      await authBody(request);
      if(!authStorageReady(env))return authJSON({accounts:[]},200,{'Set-Cookie':authSetCookie('',0)});
      return await authLock(request,env,now);
    }
    if (!authStorageReady(env)) throw new AuthFailure(503, 'auth_not_configured', 'Account storage is not connected yet. Please try again after setup is complete.');
    const body = await authBody(request);
    await authLimit(env, 'ip', ip, 60, 15 * 60 * 1000, now);
    if (path === '/api/auth/onboarding-complete') {
      const account = await authCurrent(request, env, now);
      if (!account) throw new AuthFailure(401, 'login_required', 'Log in to save your introduction preference.');
      if (body.accountId !== account.id) throw new AuthFailure(409, 'account_changed', 'Your active account changed. Open the introduction again.');
      // Test sessions always show the introduction again at the next entry.
      if (account.is_test) return authJSON({ok:true, onboardingCompleted:false});
      await authOnboardingSchema(env.AUTH_DB);
      await env.AUTH_DB.prepare('INSERT INTO auth_onboarding (account_id,completed_at) VALUES (?,?) ON CONFLICT(account_id) DO NOTHING').bind(account.id, now).run();
      return authJSON({ok:true, onboardingCompleted:true});
    }
    if (['/api/auth/resume','/api/auth/forget'].includes(path)) {
      const id=authText(body.accountId,'saved account',32,32);
      if(!/^[a-f0-9]{32}$/.test(id))throw new AuthFailure(400,'invalid_input','Choose a saved account.');
      const saved=authQuickTokens(request).find(item=>item.id===id);
      const hash=saved?'quick.'+await authHmac(env.AUTH_SECRET,`quick:${saved.token}`):'';
      if(path.endsWith('/forget')) {
        if(hash)await env.AUTH_DB.prepare('DELETE FROM auth_sessions WHERE token_hash=? AND account_id=?').bind(hash,id).run();
        return authJSON({ok:true},200,{'Set-Cookie':authNamedCookie(AUTH_QUICK_PREFIX+id,'',0)});
      }
      await authLimit(env,'quick-login-ip',ip,30,15*60*1000,now);
      const account=hash?await env.AUTH_DB.prepare('SELECT a.* FROM auth_sessions s JOIN auth_accounts a ON a.id=s.account_id WHERE s.token_hash=? AND s.account_id=? AND s.expires_at>?').bind(hash,id,now).first():null;
      if(!account)throw new AuthFailure(401,'quick_login_expired','This saved sign-in has expired. Enter your password once to remember this account again.',{'Set-Cookie':authNamedCookie(AUTH_QUICK_PREFIX+id,'',0)});
      const cookie=await authIssueSession(env,account.id,account.password_hash,false,now);
      await authRevokeActive(request,env);
      return authJSON({account:await authPublicAccount(account,env)},200,{'Set-Cookie':cookie});
    }
    if (path === '/api/auth/test-session') return await authCreateTest(request,env,now);
    if (['/api/auth/signup/start','/api/auth/reset/start','/api/auth/resend'].includes(path) && !authEmailReady(env)) throw new AuthFailure(503,'email_not_configured','Verification email is not set up yet. No code was sent.');
    if (path === '/api/auth/signup/start') {
      const profile = authProfile(body, now), password = authValidatePassword(body.password);
      await authLimit(env, 'mail-global', 'all', 100, 60 * 60 * 1000, now);
      await authLimit(env, 'mail-ip', ip, 6, 60 * 60 * 1000, now);
      await authLimit(env, 'mail-email', profile.emailNorm, 5, 60 * 60 * 1000, now);
      const existing = await env.AUTH_DB.prepare('SELECT id FROM auth_accounts WHERE email_norm=? OR username_norm=? LIMIT 1').bind(profile.emailNorm, profile.usernameNorm).first();
      if (existing) throw new AuthFailure(409, 'account_exists', 'This email or username is already in use. Log in or choose another username.');
      profile.passwordSalt = authRandom(16); profile.passwordHash = await authPassword(password, profile.passwordSalt, env.AUTH_SECRET);
      return authJSON(await authStart(env, profile, null, 'signup', now, fetchImpl));
    }
    if (path === '/api/auth/signup/verify') {
      const row = await authAttempt(env, body, 'signup', now), profile = JSON.parse(row.payload_json), id = authRandom(16);
      const token = 'active.'+authRandom(), hash = await authHmac(env.AUTH_SECRET, `session:${token}`), seconds = 86400;
      let batch;
      try {
        batch = await env.AUTH_DB.batch([
          env.AUTH_DB.prepare(`INSERT INTO auth_accounts (id,username,username_norm,email,email_norm,pet_name,pet_name_norm,pet_birthday,pet_sex,password_hash,password_salt,created_at)
            SELECT ?,?,?,?,?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM auth_challenges WHERE id=? AND code_hash=? AND consumed_at IS NULL AND expires_at>? AND attempts<=5)`).bind(id,profile.username,profile.usernameNorm,profile.email,profile.emailNorm,profile.petName,profile.petNameNorm,profile.petBirthday,profile.petSex,profile.passwordHash,profile.passwordSalt,now,row.id,row.code_hash,now),
          env.AUTH_DB.prepare(`UPDATE auth_challenges SET consumed_at=?,payload_json=NULL WHERE id=? AND consumed_at IS NULL AND EXISTS(SELECT 1 FROM auth_accounts WHERE id=?)`).bind(now,row.id,id),
          env.AUTH_DB.prepare(`INSERT INTO auth_sessions (token_hash,account_id,expires_at,created_at) SELECT ?,?,?,? WHERE EXISTS(SELECT 1 FROM auth_accounts WHERE id=?)`).bind(hash,id,now+seconds*1000,now,id),
        ]);
      } catch (error) { if (/unique constraint/i.test(String(error?.message))) throw new AuthFailure(409, 'account_exists', 'This email or username is already in use. Try logging in.'); throw error; }
      if (batch[0].meta?.changes !== 1) throw new AuthFailure(400, 'invalid_code', 'This verification code has already been used.');
      const account = { id, username:profile.username, email:profile.email, petName:profile.petName, petBirthday:profile.petBirthday, petSex:profile.petSex, onboardingCompleted:false };
      const cookies=[authSetCookie(token,seconds)];
      if(body.remember===true)cookies.push(...await authRemember(request,env,{id,password_hash:profile.passwordHash},now));
      await authRevokeActive(request,env);
      return authJSON({ account }, 200, { 'Set-Cookie':cookies });
    }
    if (path === '/api/auth/login') {
      const identifier = authNorm(authText(body.identifier, 'email, username or pet name', 1, 254));
      const password = typeof body.password === 'string' && body.password.length <= 128 ? body.password : '';
      await authLimit(env, 'login-identifier', identifier, 10, 15 * 60 * 1000, now);
      await authLimit(env, 'login-ip', ip, 30, 15 * 60 * 1000, now);
      let row = await env.AUTH_DB.prepare('SELECT * FROM auth_accounts WHERE email_norm=? OR username_norm=? LIMIT 1').bind(identifier,identifier).first();
      if (!row) {
        const pets = await env.AUTH_DB.prepare('SELECT * FROM auth_accounts WHERE pet_name_norm=? LIMIT 2').bind(identifier).all();
        if (pets.results.length === 1) row = pets.results[0];
      }
      // Do the same password work for unknown or ambiguous identifiers.
      const hash = await authPassword(password, row?.password_salt || 'unknown-account-salt-000000000000', env.AUTH_SECRET);
      if (!row || !authEqual(hash,row.password_hash)) throw new AuthFailure(401,'invalid_credentials','The details do not match. Try your email or username and password.');
      const cookie = await authIssueSession(env,row.id,row.password_hash,body.remember,now);
      const cookies=[cookie];
      if(body.remember===true)cookies.push(...await authRemember(request,env,row,now));
      await authRevokeActive(request,env);
      return authJSON({ account:await authPublicAccount(row,env) },200,{'Set-Cookie':cookies});
    }
    if (path === '/api/auth/reset/start') {
      const email = authEmail(body.email);
      await authLimit(env,'mail-global','all',100,60*60*1000,now);
      await authLimit(env,'mail-ip',ip,6,60*60*1000,now); await authLimit(env,'mail-email',email,5,60*60*1000,now);
      const account = await env.AUTH_DB.prepare('SELECT id FROM auth_accounts WHERE email_norm=?').bind(email).first();
      return authJSON(await authStart(env,{email},account,'reset',now,fetchImpl));
    }
    if (path === '/api/auth/reset/finish') {
      const password = authValidatePassword(body.password), row = await authAttempt(env,body,'reset',now);
      if (!row.account_id) throw new AuthFailure(400,'invalid_code','The code is incorrect or expired.');
      const salt = authRandom(16), hash = await authPassword(password,salt,env.AUTH_SECRET);
      const result = await env.AUTH_DB.batch([
        env.AUTH_DB.prepare(`UPDATE auth_accounts SET password_hash=?,password_salt=? WHERE id=? AND EXISTS(SELECT 1 FROM auth_challenges WHERE id=? AND code_hash=? AND consumed_at IS NULL AND expires_at>? AND attempts<=5)`).bind(hash,salt,row.account_id,row.id,row.code_hash,now),
        env.AUTH_DB.prepare(`DELETE FROM auth_sessions WHERE account_id=? AND EXISTS(SELECT 1 FROM auth_accounts WHERE id=? AND password_hash=? AND password_salt=?)`).bind(row.account_id,row.account_id,hash,salt),
        env.AUTH_DB.prepare(`UPDATE auth_challenges SET consumed_at=? WHERE kind='reset' AND account_id=? AND consumed_at IS NULL AND EXISTS(SELECT 1 FROM auth_accounts WHERE id=? AND password_hash=? AND password_salt=?)`).bind(now,row.account_id,row.account_id,hash,salt),
      ]);
      if (result[0].meta?.changes !== 1) throw new AuthFailure(400,'invalid_code','This verification code has already been used.');
      return authJSON({ok:true},200,{'Set-Cookie':authSetCookie('',0)});
    }
    if (path === '/api/auth/resend') {
      const id = authText(body.challengeId,'verification request',48,48);
      const existing = await env.AUTH_DB.prepare('SELECT * FROM auth_challenges WHERE id=? AND consumed_at IS NULL AND expires_at>?').bind(id,now).first();
      if (!existing) throw new AuthFailure(400,'invalid_challenge','Start a new verification request.');
      if (existing.resend_at > now - AUTH_RESEND_WAIT) throw new AuthFailure(429,'resend_wait','Wait a minute before requesting another code.',{'Retry-After':String(Math.ceil((existing.resend_at+AUTH_RESEND_WAIT-now)/1000))});
      await authLimit(env,'mail-global','all',100,60*60*1000,now);
      await authLimit(env,'mail-ip',ip,6,60*60*1000,now); await authLimit(env,'mail-email',existing.email_norm,5,60*60*1000,now);
      const code = authCode(), hash = await authHmac(env.AUTH_SECRET,`code:${id}:${code}`);
      const row = await env.AUTH_DB.prepare(`UPDATE auth_challenges SET code_hash=?,expires_at=?,attempts=0,resend_at=? WHERE id=? AND consumed_at IS NULL AND expires_at>? AND resend_at<=? RETURNING *`).bind(hash,now+AUTH_CODE_TTL,now,id,now,now-AUTH_RESEND_WAIT).first();
      if (!row) throw new AuthFailure(429,'resend_wait','Wait a minute before requesting another code.');
      try { if (row.kind === 'signup' || row.account_id) await authMail(env,row.email_norm,code,row.kind,id,now,fetchImpl); }
      catch(error) { await env.AUTH_DB.prepare('DELETE FROM auth_challenges WHERE id=?').bind(id).run(); throw error; }
      return authJSON({challengeId:id,expiresIn:AUTH_CODE_TTL/1000,resendAfter:AUTH_RESEND_WAIT/1000});
    }
    throw new AuthFailure(404,'not_found','This account action is not available.');
  } catch (error) {
    if (error instanceof AuthFailure) return authJSON({code:error.code,message:error.message},error.status,error.headers);
    return authJSON({code:'auth_unavailable',message:'Account services are temporarily unavailable. Please try again later.'},503);
  }
}
