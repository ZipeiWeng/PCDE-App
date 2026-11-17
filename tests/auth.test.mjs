import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFile } from 'node:fs/promises';
import { handleAuth, verifiedAccountId } from '../worker/auth.js';

const schema = (await readFile(new URL('../drizzle/0000_pawprint_auth.sql', import.meta.url), 'utf8')) + '\n' + (await readFile(new URL('../drizzle/0001_pawprint_test_sessions.sql', import.meta.url), 'utf8'));
const origin = 'https://pawprint.example';
const sample = { username:'mochi_parent', email:'owner@example.com', password:'a-long-test-password', petName:'Mochi', petBirthday:'2023-03-17', petSex:'female' };
class D1 {
  constructor() { this.sql = new DatabaseSync(':memory:'); this.sql.exec(schema); }
  prepare(query) {
    const db=this.sql; const statement=db.prepare(query);
    const build=(args=[])=>({
      bind:(...values)=>build(values),
      first:async()=>statement.get(...args) || null,
      all:async()=>({results:statement.all(...args),success:true}),
      run:async()=>{ const info=statement.run(...args);return {success:true,meta:{changes:Number(info.changes)}}; },
      _run:()=>{ const info=statement.run(...args);return {success:true,meta:{changes:Number(info.changes)}}; },
    });
    return build();
  }
  async batch(statements) { this.sql.exec('BEGIN');try { const result=statements.map(s=>s._run());this.sql.exec('COMMIT');return result; } catch(error) { this.sql.exec('ROLLBACK');throw error; } }
}
function fixture() {
  let time = Date.parse('2026-11-11T10:00:00Z');
  const db = new D1(), emails=[];
  const env={AUTH_DB:db,AUTH_SECRET:'test-auth-secret-32-characters-minimum-only',RESEND_API_KEY:'test-resend-not-valid',AUTH_EMAIL_FROM:'Pawprint <verify@example.com>'};
  const options={now:()=>time,fetchImpl:async(url,init)=>{assert.equal(url,'https://api.resend.com/emails');const body=JSON.parse(init.body);emails.push(body);return Response.json({id:'email-'+emails.length});}};
  const req=(route,body,extra={})=>new Request(origin+'/api/auth/'+route,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json','cf-connecting-ip':'192.0.2.1',...extra},body:JSON.stringify(body)});
  const call=(route,body,extra)=>handleAuth(req(route,body,extra),env,options);
  const get=(route,cookie)=>handleAuth(new Request(origin+'/api/auth/'+route,{headers:cookie?{Cookie:cookie}:{}}),env,options);
  const code=()=>emails.at(-1)?.text.match(/\b(\d{6})\b/)[1];
  async function signup(profile=sample) {const start=await call('signup/start',profile);assert.equal(start.status,200);const data=await start.json();const response=await call('signup/verify',{challengeId:data.challengeId,code:code(),remember:true});assert.equal(response.status,200);return {account:(await response.json()).account,cookie:response.headers.get('set-cookie').split(';')[0],cookies:response.headers.getSetCookie().map(value=>value.split(';')[0]).join('; ')};}
  return {db,env,options,emails,req,call,get,code,signup,advance:ms=>time+=ms};
}

test('unconfigured auth is truthful and rejects writes without storing passwords or sending mail',async()=>{
  const response=await handleAuth(new Request(origin+'/api/auth/status'));
  assert.deepEqual(await response.json(),{configured:false,storageReady:false,emailConfigured:false,testSessionAvailable:false,session:null});
  const f=fixture();const denied=await handleAuth(f.req('signup/start',sample),{},f.options);
  assert.equal(denied.status,503);assert.equal((await denied.json()).code,'auth_not_configured');assert.equal(f.emails.length,0);
  assert.equal(await handleAuth(new Request(origin+'/api/elsewhere')),null);
});

test('signup requires exact same origin and validates all registration fields',async()=>{
  const f=fixture();
  assert.equal((await f.call('signup/start',sample,{Origin:'https://evil.example'})).status,403);
  assert.equal((await f.call('signup/start',sample,{Origin:''})).status,403);
  for(const extra of [{username:'x'},{username:'not valid'},{email:'invalid'},{password:'short'},{petName:''},{petBirthday:'2099-01-01'},{petBirthday:'2026-02-30'},{petSex:'invalid'}]) {
    assert.equal((await f.call('signup/start',{...sample,...extra})).status,400);
  }
  assert.equal(f.emails.length,0);
});

test('signup stores only a hashed password and OTP, and does not create an account before verification',async()=>{
  const f=fixture();const response=await f.call('signup/start',sample);assert.equal(response.status,200);
  const text=await response.text(), data=JSON.parse(text);assert.match(data.challengeId,/^[a-f0-9]{48}$/);
  assert.equal(data.expiresIn,600);assert.ok(!text.includes(f.code()));assert.ok(!text.includes(sample.password));
  const rows=f.db.sql.prepare('SELECT * FROM auth_challenges').all();assert.equal(rows.length,1);
  assert.ok(!JSON.stringify(rows).includes(sample.password));assert.ok(!JSON.stringify(rows).includes(f.code()));
  assert.equal(f.db.sql.prepare('SELECT COUNT(*) n FROM auth_accounts').get().n,0);
  const verified=await f.call('signup/verify',{challengeId:data.challengeId,code:f.code(),remember:true});
  assert.equal(verified.status,200);assert.match(verified.headers.get('set-cookie'),/HttpOnly; Secure; SameSite=Lax; Max-Age=2592000/);
  const account=(await verified.json()).account;assert.equal(account.username,sample.username);assert.equal(account.petBirthday,sample.petBirthday);assert.equal(Object.keys(account).length,7);assert.equal(account.onboardingCompleted,false);
  assert.equal(f.db.sql.prepare('SELECT payload_json FROM auth_challenges').get().payload_json,null);
  assert.equal((await f.call('signup/verify',{challengeId:data.challengeId,code:f.code()})).status,400);
});

test('wrong OTP attempts are capped and expiration is enforced',async()=>{
  const f=fixture();const data=await (await f.call('signup/start',sample)).json();
  const wrong=f.code()==='000000'?'111111':'000000';
  for(let i=0;i<5;i++)assert.equal((await f.call('signup/verify',{challengeId:data.challengeId,code:wrong})).status,400);
  assert.equal((await f.call('signup/verify',{challengeId:data.challengeId,code:f.code()})).status,400);
  assert.equal(f.db.sql.prepare('SELECT attempts FROM auth_challenges').get().attempts,5);
  const g=fixture();const exp=await (await g.call('signup/start',sample)).json();g.advance(600001);
  assert.equal((await g.call('signup/verify',{challengeId:exp.challengeId,code:g.code()})).status,400);
});

test('resend requires cooldown and replaces the old code',async()=>{
  const f=fixture();const data=await (await f.call('signup/start',sample)).json(),oldCode=f.code();
  assert.equal((await f.call('resend',{challengeId:data.challengeId})).status,429);
  f.advance(60001);assert.equal((await f.call('resend',{challengeId:data.challengeId})).status,200);
  assert.equal(f.emails.length,2);
  const hash=f.db.sql.prepare('SELECT code_hash FROM auth_challenges').get().code_hash;assert.match(hash,/^[a-f0-9]{64}$/);
  if(oldCode!==f.code())assert.equal((await f.call('signup/verify',{challengeId:data.challengeId,code:oldCode})).status,400);
  assert.equal((await f.call('signup/verify',{challengeId:data.challengeId,code:f.code()})).status,200);
});

test('login accepts email, case-insensitive username and unambiguous pet name only with the password',async()=>{
  const f=fixture();const created=await f.signup();
  assert.equal((await f.call('login',{identifier:sample.email,password:'wrong'})).status,401);
  for(const identifier of [sample.email,'MOCHI_PARENT','mochi']) {
    const response=await f.call('login',{identifier,password:sample.password,remember:true});assert.equal(response.status,200);
    assert.equal((await response.json()).account.id,created.account.id);
  }
  assert.equal((await f.call('login',{identifier:'missing@example.com',password:sample.password})).status,401);
  const {account}=await (await f.get('session',created.cookie)).json();assert.equal(account.id,created.account.id);
  assert.equal((await f.get('session','__Host-pawprint_session='+'0'.repeat(64))).status,200);
  assert.equal((await (await f.get('session','__Host-pawprint_session='+'0'.repeat(64))).json()).account,null);
});

test('duplicate pet names require a unique email or username; guessed account metadata is not a session',async()=>{
  const f=fixture();await f.signup();await f.signup({...sample,username:'another_parent',email:'second@example.com'});
  const response=await f.call('login',{identifier:'Mochi',password:sample.password});assert.equal(response.status,401);
  assert.equal((await f.call('login',{identifier:'another_parent',password:sample.password})).status,200);
  const res=await f.get('session','account='+sample.username);assert.equal((await res.json()).account,null);
});

test('reset start does not disclose unknown email addresses, then a valid reset invalidates every session',async()=>{
  const f=fixture();const created=await f.signup();
  const missing=await f.call('reset/start',{email:'unknown@example.com'}),known=await f.call('reset/start',{email:sample.email});
  assert.equal(missing.status,known.status);const a=await missing.json(),b=await known.json();assert.deepEqual(Object.keys(a),Object.keys(b));assert.equal(f.emails.length,2);
  const newPassword='new-longer-test-password';const result=await f.call('reset/finish',{challengeId:b.challengeId,code:f.code(),password:newPassword});assert.equal(result.status,200);
  assert.equal((await (await f.get('session',created.cookie)).json()).account,null);
  assert.equal((await f.call('login',{identifier:sample.email,password:sample.password})).status,401);
  assert.equal((await f.call('login',{identifier:sample.email,password:newPassword})).status,200);
  assert.equal((await f.call('reset/finish',{challengeId:b.challengeId,code:f.code(),password:'another-test-password'})).status,400);
});

test('logout destroys the server session and expires its cookie',async()=>{
  const f=fixture();const created=await f.signup();const response=await f.call('logout',{}, {Cookie:created.cookie});assert.equal(response.status,200);assert.match(response.headers.get('set-cookie'),/Max-Age=0/);
  assert.equal((await (await f.get('session',created.cookie)).json()).account,null);
});

test('email failures never mark an account verified or disclose provider responses',async()=>{
  const f=fixture();f.options.fetchImpl=async()=>new Response('private provider error test-resend-not-valid',{status:403});
  const response=await f.call('signup/start',sample);assert.equal(response.status,503);const text=await response.text();assert.ok(!text.includes('test-resend'));assert.equal(JSON.parse(text).code,'email_sender_configuration');
  assert.equal(f.db.sql.prepare('SELECT COUNT(*) n FROM auth_challenges').get().n,0);assert.equal(f.db.sql.prepare('SELECT COUNT(*) n FROM auth_accounts').get().n,0);
});

test('mail setup trims runtime values consistently before sending',async()=>{
  const f=fixture();f.env.RESEND_API_KEY='  test-resend-not-valid\n';f.env.AUTH_EMAIL_FROM='  Pawprint <verify@example.com>  ';
  let sent;
  f.options.fetchImpl=async(url,init)=>{sent={url,headers:init.headers,body:JSON.parse(init.body)};return Response.json({id:'accepted'});};
  assert.equal((await f.call('signup/start',sample)).status,200);
  assert.equal(sent.headers.Authorization,'Bearer test-resend-not-valid');
  assert.equal(sent.body.from,'Pawprint <verify@example.com>');
  assert.deepEqual(sent.body.to,[sample.email]);
});

test('each missing sender setting blocks sending without being mistaken for missing storage',async()=>{
  for (const key of ['RESEND_API_KEY','AUTH_EMAIL_FROM']) {
    const f=fixture();f.env[key]=' \n ';
    const status=await (await f.get('status')).json();assert.equal(status.storageReady,true);assert.equal(status.emailConfigured,false);
    const response=await f.call('signup/start',sample);assert.equal(response.status,503);
    const data=await response.json();assert.equal(data.code,'email_not_configured');assert.ok(!data.message.includes('test account'));
    assert.equal(f.emails.length,0);assert.equal(f.db.sql.prepare('SELECT COUNT(*) n FROM auth_challenges').get().n,0);
  }
});

test('provider rejection, throttling, and uncertain delivery have safe distinct errors',async()=>{
  for (const entry of [
    {status:401,expected:503,code:'email_sender_configuration'},
    {status:403,expected:503,code:'email_sender_configuration'},
    {status:429,expected:429,code:'email_rate_limited'},
    {status:500,expected:503,code:'email_unavailable'},
    {status:200,expected:503,code:'email_unavailable',body:JSON.stringify({id:''})},
  ]) {
    const f=fixture();
    f.options.fetchImpl=async()=>new Response(entry.body||'private sender response',{status:entry.status,headers:{'Retry-After':'99999'}});
    const response=await f.call('signup/start',sample);assert.equal(response.status,entry.expected);
    const text=await response.text();assert.ok(!text.includes('private sender'));assert.equal(JSON.parse(text).code,entry.code);
    if(entry.status===429)assert.equal(response.headers.get('retry-after'),'3600');
    assert.equal(f.db.sql.prepare('SELECT COUNT(*) n FROM auth_challenges').get().n,0);
  }
  const f=fixture();f.options.fetchImpl=async()=>{throw new DOMException('private network error','AbortError');};
  const data=await (await f.call('signup/start',sample)).json();assert.equal(data.code,'email_unavailable');assert.match(data.message,/could not confirm/);
  assert.equal(f.db.sql.prepare('SELECT COUNT(*) n FROM auth_challenges').get().n,0);
});

test('failed or uncertain resend invalidates the challenge and cannot verify either code',async()=>{
  for(const status of [403,429,500]) {
    const f=fixture(),started=await (await f.call('signup/start',sample)).json(),oldCode=f.code();
    f.advance(60001);let attemptedCode;
    f.options.fetchImpl=async(url,init)=>{attemptedCode=JSON.parse(init.body).text.match(/\b(\d{6})\b/)[1];return new Response('private sender failure',{status});};
    const response=await f.call('resend',{challengeId:started.challengeId});assert.equal(response.status,status===429?429:503);
    assert.equal(f.db.sql.prepare('SELECT COUNT(*) n FROM auth_challenges').get().n,0);
    for(const code of [oldCode,attemptedCode])assert.equal((await f.call('signup/verify',{challengeId:started.challengeId,code})).status,400);
    assert.equal(f.db.sql.prepare('SELECT COUNT(*) n FROM auth_accounts').get().n,0);
    assert.equal((await f.call('resend',{challengeId:started.challengeId})).status,400);
  }
});

test('durable login rate limits reject repeated attempts',async()=>{
  const f=fixture();for(let i=0;i<10;i++)assert.equal((await f.call('login',{identifier:'not_registered',password:'wrong'})).status,401);
  const limited=await f.call('login',{identifier:'not_registered',password:'wrong'});assert.equal(limited.status,429);assert.ok(Number(limited.headers.get('retry-after'))>0);
});

test('oversized or invalid bodies are rejected without processing credentials',async()=>{
  const f=fixture();assert.equal((await f.call('signup/start',{...sample,extra:'x'.repeat(9000)})).status,413);
  assert.equal((await handleAuth(new Request(origin+'/api/auth/login',{method:'POST',headers:{Origin:origin,'Content-Type':'text/plain'},body:'hi'}),f.env,f.options)).status,415);
  assert.equal(f.emails.length,0);
});

test('a password reset racing a login cannot issue a session for the old password',async()=>{
  const f=fixture();await f.signup();
  const count=f.db.sql.prepare('SELECT COUNT(*) n FROM auth_sessions').get().n;
  const prepare=f.db.prepare.bind(f.db);
  f.db.prepare=query=>{
    const statement=prepare(query);
    if(query.startsWith('SELECT * FROM auth_accounts WHERE email_norm=')) {
      const bind=statement.bind;
      statement.bind=(...args)=>{
        const bound=bind(...args), first=bound.first;
        bound.first=async()=>{const row=await first();f.db.sql.prepare('UPDATE auth_accounts SET password_hash=? WHERE id=?').run('password-was-reset',row.id);return row;};
        return bound;
      };
    }
    return statement;
  };
  const response=await f.call('login',{identifier:sample.email,password:sample.password});
  assert.equal(response.status,401);assert.equal(f.db.sql.prepare('SELECT COUNT(*) n FROM auth_sessions').get().n,count);
});

test('password reset invalidates all outstanding reset codes for that account',async()=>{
  const f=fixture();await f.signup();
  const first=await (await f.call('reset/start',{email:sample.email})).json(),firstCode=f.code();
  const second=await (await f.call('reset/start',{email:sample.email})).json(),secondCode=f.code();
  const done=await f.call('reset/finish',{challengeId:first.challengeId,code:firstCode,password:'new-test-password-123'});assert.equal(done.status,200);
  const replay=await f.call('reset/finish',{challengeId:second.challengeId,code:secondCode,password:'attacker-test-password'});assert.equal(replay.status,400);
  assert.equal(f.db.sql.prepare("SELECT COUNT(*) n FROM auth_challenges WHERE kind='reset' AND consumed_at IS NULL").get().n,0);
});

test('logout still revokes the session when the email provider is not configured',async()=>{
  const f=fixture();const created=await f.signup();delete f.env.RESEND_API_KEY;
  const response=await f.call('logout',{}, {Cookie:created.cookie});assert.equal(response.status,200);assert.match(response.headers.get('set-cookie'),/Max-Age=0/);
  assert.equal((await (await f.get('session',created.cookie)).json()).account,null);
});

test('concurrent verification can create only one account and one session',async()=>{
  const f=fixture();const challenge=await (await f.call('signup/start',sample)).json();
  const responses=await Promise.all([1,2].map(()=>f.call('signup/verify',{challengeId:challenge.challengeId,code:f.code(),remember:true})));
  assert.deepEqual(responses.map(r=>r.status).sort(),[200,400]);
  assert.equal(f.db.sql.prepare('SELECT COUNT(*) n FROM auth_accounts').get().n,1);assert.equal(f.db.sql.prepare("SELECT COUNT(*) n FROM auth_sessions WHERE token_hash NOT LIKE 'quick.%'").get().n,1);
  assert.equal(f.db.sql.prepare("SELECT COUNT(*) n FROM auth_sessions WHERE token_hash LIKE 'quick.%'").get().n,1);
});

test('unremembered logins use a session cookie while server expiration stays bounded',async()=>{
  const f=fixture();await f.signup();
  const response=await f.call('login',{identifier:sample.email,password:sample.password,remember:false});assert.equal(response.status,200);
  assert.ok(!response.headers.get('set-cookie').includes('Max-Age'));
  const row=f.db.sql.prepare('SELECT MIN(expires_at-created_at) duration FROM auth_sessions').get();assert.equal(row.duration,86400000);
});

// The AI layer receives only this narrow identity result, not private account data.
test('verifiedAccountId validates issued sessions independently of the email provider',async()=>{
  const f=fixture(),created=await f.signup();
  const request=new Request(origin+'/api/chat',{headers:{Cookie:created.cookie}});
  delete f.env.RESEND_API_KEY;delete f.env.AUTH_EMAIL_FROM;
  assert.equal(await verifiedAccountId(request,f.env,f.options.now()),created.account.id);
  assert.equal(await verifiedAccountId(new Request(origin+'/api/chat'),f.env,f.options.now()),null);
  assert.equal(await verifiedAccountId(new Request(origin+'/api/chat',{headers:{Cookie:'__Host-pawprint_session='+'0'.repeat(64)}}),f.env,f.options.now()),null);
  f.advance(30*86400000);
  assert.equal(await verifiedAccountId(request,f.env,f.options.now()),null);
});

test('test-session setup is available without mail and creates no real account or verification challenge',async()=>{
  const f=fixture();delete f.env.RESEND_API_KEY;delete f.env.AUTH_EMAIL_FROM;f.env.OPENAI_API_KEY='test-not-valid';
  const status=await (await f.get('status')).json();
  assert.equal(status.configured,false);assert.equal(status.storageReady,true);assert.equal(status.emailConfigured,false);assert.equal(status.testSessionAvailable,true);
  const response=await f.call('test-session',{email:sample.email,verified:true});assert.equal(response.status,200);
  const body=await response.json(),cookie=response.headers.get('set-cookie').split(';')[0];
  assert.equal(body.expiresIn,30*86400);assert.equal(body.account.isTest,true);assert.match(body.account.id,/^test_[a-f0-9]{32}$/);
  assert.equal(body.account.email,'');assert.equal(body.account.petName,'Mochi');
  assert.match(response.headers.getSetCookie()[0],/test\.[a-f0-9]{64}; Path=\/; HttpOnly; Secure; SameSite=Lax$/);
  assert.match(response.headers.getSetCookie()[1],/__Host-pawprint_test_resume=.*; Max-Age=2592000/);
  assert.equal(f.db.sql.prepare('SELECT COUNT(*) n FROM auth_accounts').get().n,0);
  assert.equal(f.db.sql.prepare('SELECT COUNT(*) n FROM auth_challenges').get().n,0);
  const row=f.db.sql.prepare('SELECT * FROM auth_test_sessions').get();assert.ok(!JSON.stringify(row).includes(cookie.slice(cookie.indexOf('=')+1)));assert.ok(!JSON.stringify(row).includes('192.0.2.1'));
  assert.equal(f.emails.length,0);assert.equal((await (await f.get('session',cookie)).json()).account.id,body.account.id);
});

test('test issuance requires same-origin JSON and a connected backend',async()=>{
  const f=fixture();f.env.OPENAI_API_KEY='test-not-valid';
  assert.equal((await f.call('test-session',{}, {Origin:'https://attacker.example'})).status,403);
  assert.equal((await f.call('test-session',{}, {'Content-Type':'text/plain'})).status,415);
  delete f.env.OPENAI_API_KEY;const unavailable=await f.call('test-session',{});
  assert.equal(unavailable.status,503);assert.equal((await unavailable.json()).code,'test_not_configured');
  assert.equal(f.db.sql.prepare('SELECT COUNT(*) n FROM auth_test_sessions').get().n,0);
});

test('test sessions keep their identity beyond an hour, renew on sign-in, and revoke active tokens on logout',async()=>{
  const f=fixture();f.env.OPENAI_API_KEY='test-not-valid';
  const created=await f.call('test-session',{}),cookie=created.headers.get('set-cookie').split(';')[0],first=await created.json();
  f.advance(60000);const reused=await f.call('test-session',{}, {Cookie:cookie}),second=await reused.json();
  assert.equal(second.account.id,first.account.id);assert.equal(second.expiresIn,30*86400);assert.match(reused.headers.getSetCookie()[0],/__Host-pawprint_session=test\./);
  assert.equal((await (await f.get('session',cookie)).json()).account,null);
  assert.equal(f.db.sql.prepare('SELECT COUNT(*) n FROM auth_test_sessions').get().n,1);
  const reusedCookie=reused.headers.getSetCookie()[0].split(';')[0];
  f.advance(3600000);assert.equal((await (await f.get('session',reusedCookie)).json()).account.id,first.account.id);
  f.advance(30*86400000);assert.equal((await (await f.get('session',reusedCookie)).json()).account,null);
  const next=await f.call('test-session',{}, {Cookie:cookie}),nextCookie=next.headers.get('set-cookie').split(';')[0];
  assert.notEqual((await next.json()).account.id,first.account.id);
  assert.equal((await f.call('logout',{}, {Cookie:nextCookie})).status,200);
  assert.equal((await (await f.get('session',nextCookie)).json()).account,null);
  assert.equal(f.db.sql.prepare('SELECT COUNT(*) n FROM auth_test_sessions').get().n,1);
});

test('test session creation has no test-only daily or concurrent allowance',async()=>{
  const f=fixture();f.env.OPENAI_API_KEY='test-not-valid';
  const responses=await Promise.all(Array.from({length:5},()=>f.call('test-session',{})));
  assert.equal(responses.every(response=>response.status===200),true);
  assert.equal(f.db.sql.prepare('SELECT COUNT(*) n FROM auth_test_sessions').get().n,5);
});

test('missing mail setup blocks sending codes while existing real accounts still log in',async()=>{
  const f=fixture(),created=await f.signup();delete f.env.RESEND_API_KEY;delete f.env.AUTH_EMAIL_FROM;f.env.OPENAI_API_KEY='test-not-valid';
  const login=await f.call('login',{identifier:sample.email,password:sample.password});assert.equal(login.status,200);assert.equal((await login.json()).account.id,created.account.id);
  const emailCount=f.emails.length;
  for(const [route,body] of [['signup/start',sample],['reset/start',{email:sample.email}],['resend',{challengeId:'a'.repeat(48)}]]) {
    const response=await f.call(route,body);assert.equal(response.status,503);assert.equal((await response.json()).code,'email_not_configured');
  }
  assert.equal(f.emails.length,emailCount);
  const switched=await f.call('test-session',{}, {Cookie:created.cookie});assert.equal(switched.status,200);assert.equal((await switched.json()).account.isTest,true);
  assert.equal((await (await f.get('session',created.cookie)).json()).account,null);
});

test('an already-delivered verification code remains valid if mail configuration becomes unavailable',async()=>{
  const f=fixture(),started=await (await f.call('signup/start',sample)).json(),code=f.code();
  delete f.env.RESEND_API_KEY;delete f.env.AUTH_EMAIL_FROM;
  const verified=await f.call('signup/verify',{challengeId:started.challengeId,code});assert.equal(verified.status,200);assert.equal((await verified.json()).account.email,sample.email);
});

function cookieJar(initial='') {
  const values=new Map(initial.split(';').map(s=>s.trim().split('=')).filter(([k,v])=>k&&v));
  return {
    header:()=>[...values].map(([k,v])=>`${k}=${v}`).join('; '),
    get:name=>values.get(name),
    apply(response) {
      for(const cookie of response.headers.getSetCookie()) {
        const [pair,...attrs]=cookie.split(';').map(s=>s.trim()), index=pair.indexOf('='), name=pair.slice(0,index),value=pair.slice(index+1);
        if(attrs.includes('Max-Age=0'))values.delete(name);else values.set(name,value);
      }
      return response;
    },
  };
}

test('reopening locks the active session but an HttpOnly saved account resumes by explicit click',async()=>{
  const f=fixture(),created=await f.signup(),jar=cookieJar(created.cookies),active=created.cookie;
  const quickName='__Host-pawprint_quick_'+created.account.id,quick=jar.get(quickName);
  assert.match(quick,/^[a-f0-9]{64}$/);
  const locked=await f.call('lock',{}, {Cookie:jar.header()});jar.apply(locked);
  assert.deepEqual((await locked.json()).accounts.map(a=>a.id),[created.account.id]);
  assert.equal(jar.get('__Host-pawprint_session'),undefined);
  assert.equal((await (await f.get('session',active)).json()).account,null);
  assert.equal(await verifiedAccountId(new Request(origin+'/api/chat',{headers:{Cookie:jar.header()}}),f.env,f.options.now()),null);
  const resumed=await f.call('resume',{accountId:created.account.id},{Cookie:jar.header()});assert.equal(resumed.status,200);jar.apply(resumed);
  assert.equal((await resumed.json()).account.id,created.account.id);
  assert.equal(await verifiedAccountId(new Request(origin+'/api/chat',{headers:{Cookie:jar.header()}}),f.env,f.options.now()),created.account.id);
  const sessionCookie=resumed.headers.getSetCookie()[0];assert.match(sessionCookie,/HttpOnly; Secure; SameSite=Lax$/);assert.ok(!sessionCookie.includes('Max-Age'));
  const logout=await f.call('logout',{}, {Cookie:jar.header()});jar.apply(logout);
  assert.equal((await f.call('resume',{accountId:created.account.id},{Cookie:jar.header()})).status,200);
});

test('multiple remembered accounts and test account switch cleanly without retaining active authorization',async()=>{
  const f=fixture(),a=await f.signup(),b=await f.signup({...sample,username:'second_parent',email:'second@example.com',petName:'Nori'});
  const jar=cookieJar(a.cookies+'; '+b.cookies);f.env.OPENAI_API_KEY='test-not-valid';
  jar.apply(await f.call('lock',{}, {Cookie:jar.header()}));
  const resumeA=await f.call('resume',{accountId:a.account.id},{Cookie:jar.header()});jar.apply(resumeA);const oldA=jar.header();
  const resumeB=await f.call('resume',{accountId:b.account.id},{Cookie:jar.header()});jar.apply(resumeB);const oldB=jar.header();
  assert.equal((await resumeB.json()).account.id,b.account.id);
  assert.equal((await (await f.get('session',oldA)).json()).account,null);
  const testResponse=await f.call('test-session',{}, {Cookie:jar.header()});jar.apply(testResponse);const testAccount=(await testResponse.json()).account,oldTest=jar.header();
  assert.equal((await (await f.get('session',oldB)).json()).account,null);
  const original=await f.call('resume',{accountId:a.account.id},{Cookie:jar.header()});jar.apply(original);
  assert.equal((await original.json()).account.id,a.account.id);
  assert.equal((await (await f.get('session',oldTest)).json()).account,null);
  jar.apply(await f.call('lock',{}, {Cookie:jar.header()}));
  const reopenedTest=await f.call('test-session',{}, {Cookie:jar.header()});jar.apply(reopenedTest);
  assert.equal((await reopenedTest.json()).account.id,testAccount.id);
  assert.equal(f.db.sql.prepare('SELECT COUNT(*) n FROM auth_test_sessions').get().n,1);
});

test('quick login needs this account’s unexpired grant and password reset revokes it',async()=>{
  const f=fixture(),created=await f.signup(),jar=cookieJar(created.cookies);
  jar.apply(await f.call('lock',{}, {Cookie:jar.header()}));
  for(const cookies of ['', '__Host-pawprint_quick_'+created.account.id+'='+'0'.repeat(64)]) {
    const denied=await f.call('resume',{accountId:created.account.id},{Cookie:cookies});assert.equal(denied.status,401);assert.equal((await denied.json()).code,'quick_login_expired');
  }
  const started=await (await f.call('reset/start',{email:sample.email})).json();
  assert.equal((await f.call('reset/finish',{challengeId:started.challengeId,code:f.code(),password:'new-strong-password'})).status,200);
  assert.equal((await f.call('resume',{accountId:created.account.id},{Cookie:jar.header()})).status,401);
  const login=await f.call('login',{identifier:sample.email,password:'new-strong-password',remember:true});jar.apply(login);
  jar.apply(await f.call('lock',{}, {Cookie:jar.header()}));
  f.advance(30*86400000+1);
  assert.equal((await f.call('resume',{accountId:created.account.id},{Cookie:jar.header()})).status,401);
});

test('forget revokes only the selected remembered account and a forged account ID cannot select another grant',async()=>{
  const f=fixture(),a=await f.signup(),b=await f.signup({...sample,username:'second_parent',email:'second@example.com'}),jar=cookieJar(a.cookies+'; '+b.cookies);
  const onlyA='__Host-pawprint_quick_'+a.account.id+'='+jar.get('__Host-pawprint_quick_'+a.account.id);
  assert.equal((await f.call('resume',{accountId:b.account.id},{Cookie:onlyA})).status,401);
  const stolen=jar.header(),forgot=await f.call('forget',{accountId:a.account.id},{Cookie:jar.header()});jar.apply(forgot);
  assert.equal((await f.call('resume',{accountId:a.account.id},{Cookie:stolen})).status,401);
  assert.equal((await f.call('resume',{accountId:b.account.id},{Cookie:jar.header()})).status,200);
});

test('unremembered sessions do not become quick-login grants when reopened',async()=>{
  const f=fixture(),created=await f.signup();
  const login=await f.call('login',{identifier:sample.email,password:sample.password,remember:false}),jar=cookieJar();jar.apply(login);
  const locked=await f.call('lock',{}, {Cookie:jar.header()});jar.apply(locked);
  assert.deepEqual((await locked.json()).accounts,[]);
  assert.equal((await f.call('resume',{accountId:created.account.id},{Cookie:jar.header()})).status,401);
});

test('legacy remembered sessions migrate safely while old one-day sessions only sign out',async()=>{
  for(const days of [1,30]) {
    const f=fixture(),created=await f.signup(),token='a'.repeat(64),key=await crypto.subtle.importKey('raw',new TextEncoder().encode(f.env.AUTH_SECRET),{name:'HMAC',hash:'SHA-256'},false,['sign']);
    const hash=Buffer.from(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode('session:'+token))).toString('hex');
    f.db.sql.prepare('INSERT INTO auth_sessions (token_hash,account_id,expires_at,created_at) VALUES (?,?,?,?)').run(hash,created.account.id,f.options.now()+days*86400000,f.options.now());
    const jar=cookieJar('__Host-pawprint_session='+token),locked=await f.call('lock',{}, {Cookie:jar.header()});jar.apply(locked);
    assert.equal((await locked.json()).accounts.length,days===30?1:0);
    assert.equal((await f.call('resume',{accountId:created.account.id},{Cookie:jar.header()})).status,days===30?200:401);
    assert.equal((await (await f.get('session','__Host-pawprint_session='+token)).json()).account,null);
  }
});

test('remembered device grants are bounded to five accounts without storing reusable tokens in database',async()=>{
  const f=fixture(),jar=cookieJar();
  for(let index=0;index<6;index++) {
    const created=await f.signup({...sample,username:'parent_'+index,email:`owner${index}@example.com`});
    const login=await f.call('login',{identifier:created.account.email,password:sample.password,remember:true},{Cookie:jar.header()});assert.equal(login.status,200);jar.apply(login);
  }
  const cookies=jar.header().split('; ').filter(item=>item.startsWith('__Host-pawprint_quick_'));assert.equal(cookies.length,5);
  const locked=await f.call('lock',{}, {Cookie:jar.header()});assert.equal((await locked.json()).accounts.length,5);
  const rows=JSON.stringify(f.db.sql.prepare("SELECT * FROM auth_sessions WHERE token_hash LIKE 'quick.%'").all());
  for(const cookie of cookies)assert.ok(!rows.includes(cookie.split('=')[1]));
});


test('onboarding is account-scoped and durable across login, session and remembered login', async () => {
  const f=fixture();
  const first=await f.signup();
  const second=await f.signup({...sample,username:'other_parent',email:'other@example.com'});
  assert.equal(first.account.onboardingCompleted,false);
  assert.equal((await (await f.get('session',first.cookie)).json()).account.onboardingCompleted,false);
  const complete=await f.call('onboarding-complete',{accountId:first.account.id}, {Cookie:first.cookie});
  assert.equal(complete.status,200);
  assert.deepEqual(await complete.json(),{ok:true,onboardingCompleted:true});
  const stored=f.db.sql.prepare('SELECT * FROM auth_onboarding').get();
  assert.equal(stored.account_id,first.account.id);
  f.advance(2000);
  assert.equal((await f.call('onboarding-complete',{accountId:first.account.id}, {Cookie:first.cookie})).status,200);
  assert.equal(f.db.sql.prepare('SELECT completed_at FROM auth_onboarding').get().completed_at,stored.completed_at);
  assert.equal((await (await f.get('session',first.cookie)).json()).account.onboardingCompleted,true);
  assert.equal((await (await f.get('status',first.cookie)).json()).session.onboardingCompleted,true);
  assert.equal((await (await f.get('session',second.cookie)).json()).account.onboardingCompleted,false);
  const loggedIn=await f.call('login',{identifier:sample.email,password:sample.password});
  assert.equal((await loggedIn.json()).account.onboardingCompleted,true);
  const locked=await f.call('lock',{}, {Cookie:first.cookies});
  assert.equal((await locked.json()).accounts.find(account=>account.id===first.account.id).onboardingCompleted,true);
  const resumed=await f.call('resume',{accountId:first.account.id},{Cookie:first.cookies});
  assert.equal((await resumed.json()).account.onboardingCompleted,true);
});

test('onboarding completion requires a live same-origin session and never accepts an account ID as authentication', async () => {
  const f=fixture(), created=await f.signup();
  assert.equal((await f.call('onboarding-complete',{accountId:created.account.id})).status,401);
  assert.equal((await f.call('onboarding-complete',{accountId:created.account.id}, {Cookie:created.cookie,Origin:'https://evil.example'})).status,403);
  assert.equal((await f.call('onboarding-complete',{accountId:'wrong-account'}, {Cookie:created.cookie})).status,409);
  assert.equal((await f.call('onboarding-complete',{}, {Cookie:created.cookie})).status,409);
  const invalidType=new Request(origin+'/api/auth/onboarding-complete',{method:'POST',headers:{Origin:origin,Cookie:created.cookie,'Content-Type':'text/plain'},body:'{}'});
  assert.equal((await handleAuth(invalidType,f.env,f.options)).status,415);
  await f.call('logout',{}, {Cookie:created.cookie});
  assert.equal((await f.call('onboarding-complete',{accountId:created.account.id}, {Cookie:created.cookie})).status,401);
  const login=await f.call('login',{identifier:sample.email,password:sample.password});
  assert.equal((await login.json()).account.onboardingCompleted,false);
});

test('test accounts remain eligible after completing or skipping onboarding and reopening', async () => {
  const f=fixture();f.env.OPENAI_API_KEY='test-not-a-real-key';
  const opened=await f.call('test-session',{});
  const cookies=opened.headers.getSetCookie().map(value=>value.split(';')[0]).join('; ');
  const account=(await opened.json()).account;assert.equal(account.onboardingCompleted,false);
  assert.deepEqual(await (await f.call('onboarding-complete',{accountId:account.id}, {Cookie:cookies})).json(),{ok:true,onboardingCompleted:false});
  assert.equal((await (await f.get('session',cookies)).json()).account.onboardingCompleted,false);
  const reopened=await f.call('test-session',{}, {Cookie:cookies});
  assert.equal((await reopened.json()).account.onboardingCompleted,false);
  assert.equal(f.db.sql.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE type='table' AND name='auth_onboarding'").get().n,0);
});
