import test from 'node:test';
import assert from 'node:assert/strict';
import { authRequest } from '../dist/auth-client.js';

test('auth client distinguishes missing account storage from a missing email sender',async t=>{
  let code='auth_not_configured';
  t.mock.method(globalThis,'fetch',async()=>Response.json({code,message:'server fallback'},{status:503}));
  await assert.rejects(authRequest('/signup/start',{}),error=>{
    assert.equal(error.code,'auth_not_configured');assert.match(error.message,/Account services/);assert.ok(!error.message.includes('Verification email'));return true;
  });
  code='email_not_configured';
  await assert.rejects(authRequest('/signup/start',{}),error=>{
    assert.equal(error.message,'Verification email is not set up yet. No code was sent.');assert.equal(error.status,503);return true;
  });
});

test('auth client preserves email retry metadata and makes no test-account availability promise',async t=>{
  t.mock.method(globalThis,'fetch',async()=>Response.json({code:'email_rate_limited'},{status:429,headers:{'Retry-After':'120'}}));
  await assert.rejects(authRequest('/resend',{challengeId:'example'}),error=>{
    assert.equal(error.code,'email_rate_limited');assert.equal(error.retryAfter,120);assert.ok(!error.message.includes('test account'));return true;
  });
});

test('uncertain delivery and generic outages never claim a code was not sent',async t=>{
  let body={code:'email_unavailable'};
  t.mock.method(globalThis,'fetch',async()=>Response.json(body,{status:503}));
  await assert.rejects(authRequest('/resend',{}),error=>{
    assert.match(error.message,/could not confirm email delivery/);assert.ok(!error.message.includes('No code was sent'));return true;
  });
  body={};
  await assert.rejects(authRequest('/signup/start',{}),error=>{
    assert.ok(!error.message.includes('No code was sent'));assert.ok(!error.message.includes('test account'));return true;
  });
});
