import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createHmac,randomBytes} from 'node:crypto';
import {readdir,readFile} from 'node:fs/promises';
import {createBillingHandler,loadBillingEntitlement} from '../worker/billing.js';
import {verifiedAccountId} from '../worker/auth.js';

const origin='https://pawprint.example';
const migrations=new URL('../drizzle/',import.meta.url);
const schema=(await Promise.all((await readdir(migrations)).filter(name=>name.endsWith('.sql')).sort().map(name=>readFile(new URL(name,migrations),'utf8')))).join('\n');
const authSecret='billing-tests-auth-secret-at-least-32-characters';
const response=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json'}});

function fixture(t,{live=false,onVerifiedEvent}={}){
  const sql=new DatabaseSync(':memory:');sql.exec('PRAGMA foreign_keys=ON');sql.exec(schema);t.after(()=>sql.close());
  let time=Date.parse('2026-11-15T12:00:00Z');
  const db={prepare(query){const build=(args=[])=>({bind:(...values)=>build(values),first:async()=>sql.prepare(query).get(...args)||null,all:async()=>({success:true,results:sql.prepare(query).all(...args)}),run:async()=>({success:true,meta:{changes:Number(sql.prepare(query).run(...args).changes)}}),_run:()=>({success:true,meta:{changes:Number(sql.prepare(query).run(...args).changes)}})});return build();},async batch(statements){sql.exec('BEGIN');try{const result=statements.map(statement=>statement._run());sql.exec('COMMIT');return result;}catch(error){sql.exec('ROLLBACK');throw error;}}};
  const cookies={};
  for(const [id,name] of [['owner-a','Luna'],['owner-b','Max']]){
    const token=randomBytes(32).toString('hex');cookies[id]=`__Host-pawprint_session=${token}`;
    sql.prepare('INSERT INTO auth_accounts VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run(id,id,id,`${id}@example.invalid`,`${id}@example.invalid`,name,name.toLowerCase(),'2023-03-17','female','unused','unused',time);
    sql.prepare('INSERT INTO auth_sessions VALUES(?,?,?,?)').run(createHmac('sha256',authSecret).update(`session:${token}`).digest('hex'),id,time+365*86400000,time);
  }
  const testId='test_'+randomBytes(16).toString('hex'),testToken='test.'+randomBytes(32).toString('hex');
  sql.prepare('INSERT INTO auth_test_sessions VALUES(?,?,?,?,?)').run(testId,createHmac('sha256',authSecret).update(`session:${testToken}`).digest('hex'),'',time+30*86400000,time);
  cookies.test=`__Host-pawprint_session=${testToken}`;
  const env={AUTH_DB:db,AUTH_SECRET:authSecret,STRIPE_SECRET_KEY:live?'sk_live_fixture_secret':'sk_test_fixture_secret',STRIPE_WEBHOOK_SECRET:'whsec_fixture_signing_secret',STRIPE_PRICE_PLUS_ANNUAL:'price_pawprint_annual'};
  const state={price:{id:env.STRIPE_PRICE_PLUS_ANNUAL,active:true,livemode:live,type:'recurring',currency:'cny',unit_amount:14400,recurring:{interval:'year',interval_count:1,usage_type:'licensed'}},subscriptions:[],sessions:new Map(),customers:new Map(),invoices:new Map(),charges:new Map(),disputes:new Map(),calls:[],override:null};
  const fetchImpl=async(url,options={})=>{
    const parsed=new URL(url),method=options.method||'GET',data=new URLSearchParams(options.body),call={url:parsed,method,data,headers:options.headers,redirect:options.redirect};state.calls.push(call);
    assert.equal(parsed.origin,'https://api.stripe.com');assert.equal(options.redirect,'error');
    if(state.override){const overridden=await state.override(call);if(overridden)return overridden;}
    if(parsed.pathname===`/v1/prices/${env.STRIPE_PRICE_PLUS_ANNUAL}`)return response(state.price);
    if(parsed.pathname==='/v1/customers'&&method==='POST'){
      const account=data.get('metadata[pawprint_account_id]'),id='cus_'+account.replaceAll('-','_');
      const customer={id,livemode:live,metadata:{pawprint_account_id:account}};state.customers.set(id,customer);return response(customer);
    }
    if(parsed.pathname==='/v1/subscriptions')return response({data:state.subscriptions.filter(s=>s.customer===parsed.searchParams.get('customer')),has_more:false});
    if(parsed.pathname==='/v1/checkout/sessions'&&method==='POST'){
      const key=options.headers['Idempotency-Key'];
      let session=[...state.sessions.values()].find(s=>s.key===key);
      if(!session){session={id:`cs_test_${state.sessions.size+1}`,key,customer:data.get('customer'),client_reference_id:data.get('client_reference_id'),livemode:live,status:'open',expires_at:data.has('expires_at')?Number(data.get('expires_at')):Math.floor(time/1000)+24*3600,url:`https://checkout.stripe.com/c/pay/cs_test_${state.sessions.size+1}`};state.sessions.set(session.id,session);}
      return response(session);
    }
    if(parsed.pathname.startsWith('/v1/checkout/sessions/'))return response(state.sessions.get(parsed.pathname.split('/').at(-1))||{});
    if(parsed.pathname==='/v1/billing_portal/sessions')return response({url:'https://billing.stripe.com/p/session/test_fixture'});
    if(parsed.pathname.startsWith('/v1/invoices/'))return response(state.invoices.get(parsed.pathname.split('/').at(-1))||{});
    if(parsed.pathname.startsWith('/v1/charges/'))return response(state.charges.get(parsed.pathname.split('/').at(-1))||{});
    if(parsed.pathname.startsWith('/v1/disputes/'))return response(state.disputes.get(parsed.pathname.split('/').at(-1))||{});
    throw new Error(`Unexpected mock request ${method} ${parsed.pathname}`);
  };
  const handler=createBillingHandler({getAccountId:verifiedAccountId,fetchImpl,now:()=>time,onVerifiedEvent});
  const request=(path,method='GET',body,account='owner-a',headers={})=>new Request(origin+path,{method,headers:{...(cookies[account]?{Cookie:cookies[account]}:{}),...(method!=='GET'?{Origin:origin,'Content-Type':'application/json'}:{}),...headers},...(body===undefined?{}:{body:JSON.stringify(body)})});
  const call=(path,method,body,account,headers)=>handler(request(path,method,body,account,headers),env);
  const status=async(account='owner-a')=>{const result=await call('/api/billing/status','GET',undefined,account);assert.equal(result.status,200,await result.clone().text());return result.json();};
  const checkout=()=>call('/api/billing/checkout','POST',{plan:'plus',locale:'en'});
  const row=(id='owner-a')=>sql.prepare('SELECT * FROM billing_accounts WHERE account_id=? AND mode=?').get(id,live?'live':'test');
  function subscription(patch={}){
    const value={id:'sub_owned',customer:'cus_owner_a',livemode:live,created:Math.floor(time/1000),metadata:{pawprint_account_id:'owner-a',pawprint_plan:'plus'},status:'active',cancel_at_period_end:false,items:{data:[{price:{id:env.STRIPE_PRICE_PLUS_ANNUAL},quantity:1,current_period_end:Math.floor(time/1000)+365*86400}]},latest_invoice:{id:'in_owned',customer:'cus_owner_a',livemode:live,status:'paid'},...patch};
    state.subscriptions=[value];return value;
  }
  function signed(event,{timestamp=Math.floor(time/1000),secret=env.STRIPE_WEBHOOK_SECRET,raw=JSON.stringify(event),signature}={}){
    const digest=createHmac('sha256',secret).update(`${timestamp}.${raw}`).digest('hex');
    return new Request(origin+'/api/billing/webhook',{method:'POST',headers:{'Content-Type':'application/json','Stripe-Signature':signature||`t=${timestamp},v1=${digest}`},body:raw});
  }
  const event=(type='invoice.paid',object={customer:'cus_owner_a'},patch={})=>({id:'evt_'+randomBytes(5).toString('hex'),type,livemode:live,data:{object},...patch});
  const webhook=(value,options)=>handler(signed(value,options),env);
  return {sql,db,env,state,handler,request,call,status,checkout,row,subscription,signed,event,webhook,cookies,testId,now:()=>time,advance:ms=>{time+=ms;}};
}

test('billing is server-authenticated and unconfigured purchases stay disabled',async t=>{
  const f=fixture(t);delete f.env.STRIPE_SECRET_KEY;
  assert.equal((await f.call('/api/billing/status','GET',undefined,null)).status,401);
  assert.equal((await f.call('/api/billing/status','GET',undefined,null,{'x-account-id':'owner-a','oai-authenticated-user-id':'owner-a'})).status,401);
  const status=await f.status();assert.equal(status.plan,'free');assert.equal(status.mode,'unconfigured');assert.equal(status.canPurchase,false);assert.equal(status.reason,'payment_setup_required');assert.equal(status.price,null);
  const denied=await f.checkout();assert.equal(denied.status,503);assert.equal((await denied.json()).error.code,'payment_setup_required');assert.equal(f.state.calls.length,0);
  const testStatus=await f.status('test');assert.equal(testStatus.plan,'free');assert.equal(testStatus.reason,'test_account');assert.equal(testStatus.canPurchase,false);assert.equal(testStatus.canManage,false);
  assert.equal((await f.call('/api/billing/checkout','POST',{plan:'plus'},'test')).status,403);
  assert.equal((await f.call('/api/billing/portal','POST',{},'test')).status,403);
});

test('configured status exposes only the approved price and no provider or account secrets',async t=>{
  const f=fixture(t),status=await f.status();
  assert.deepEqual(status.price,{amount:14400,currency:'cny',interval:'year',intervalCount:1});assert.equal(status.canPurchase,true);assert.equal(status.mode,'test');
  assert.ok(!JSON.stringify(status).includes(f.env.STRIPE_SECRET_KEY));assert.ok(!JSON.stringify(status).includes('owner-a'));assert.equal(f.row(),undefined);
  for(const patch of [{livemode:true},{unit_amount:14401},{currency:'gbp'},{active:false},{type:'one_time'},{recurring:{interval:'month',interval_count:1,usage_type:'licensed'}},{recurring:{interval:'year',interval_count:2,usage_type:'licensed'}},{recurring:{interval:'year',interval_count:1,usage_type:'metered'}}]){
    const original=f.state.price;f.state.price={...original,...patch};const result=await f.checkout();assert.equal(result.status,503);assert.equal((await result.json()).error.code,'payment_setup_required');f.state.price=original;
  }
  assert.equal(f.state.customers.size,0);
});

test('checkout rejects cross-site, client-owned price/customer, unsupported plan and oversized inputs',async t=>{
  const f=fixture(t);
  assert.equal((await f.call('/api/billing/checkout','POST',{plan:'plus'},'owner-a',{Origin:'https://attacker.example'})).status,403);
  assert.equal((await f.call('/api/billing/checkout','POST',{plan:'plus'},'owner-a',{'Sec-Fetch-Site':'cross-site'})).status,403);
  assert.equal((await f.call('/api/billing/checkout','POST',{plan:'plus'},'owner-a',{'Content-Type':'text/plain'})).status,415);
  assert.equal((await f.call('/api/billing/checkout','POST',{plan:'plus'},'owner-a',{'Content-Length':'1025'})).status,413);
  for(const body of [{plan:'free'},{plan:'plus',price:'price_attacker'},{plan:'plus',customer:'cus_owner_b'},{plan:'plus',accountId:'owner-b'},{plan:'plus',return_url:'https://attacker.example'},{plan:'plus',locale:'invalid'}])assert.equal((await f.call('/api/billing/checkout','POST',body)).status,400);
  assert.equal(f.state.customers.size,0);assert.equal(f.state.sessions.size,0);
});

test('checkout binds customer, price, URLs and subscription metadata on server; repeats reuse one session',async t=>{
  const f=fixture(t),first=await f.checkout();assert.equal(first.status,200,await first.clone().text());const result=await first.json();assert.match(result.url,/^https:\/\/checkout.stripe.com\//);assert.equal(result.mode,'test');
  const creation=f.state.calls.find(c=>c.url.pathname==='/v1/checkout/sessions'&&c.method==='POST');
  assert.equal(creation.data.get('customer'),'cus_owner_a');assert.equal(creation.data.get('mode'),'subscription');assert.equal(creation.data.get('client_reference_id'),'owner-a');
  assert.equal(creation.data.get('line_items[0][price]'),f.env.STRIPE_PRICE_PLUS_ANNUAL);assert.equal(creation.data.get('line_items[0][quantity]'),'1');assert.equal(creation.data.get('subscription_data[metadata][pawprint_account_id]'),'owner-a');
  assert.equal(creation.data.get('success_url'),origin+'/?checkout=success');assert.equal(creation.data.get('cancel_url'),origin+'/?checkout=cancelled');
  assert.equal(creation.data.has('expires_at'),false,'Use Stripe’s default expiry so retries have the same request body.');
  assert.ok(creation.headers['Idempotency-Key'].startsWith('pawprint-checkout-'));
  f.advance(5000);assert.deepEqual(await (await f.checkout()).json(),result);assert.equal(f.state.sessions.size,1);assert.equal(f.state.calls.filter(c=>c.url.pathname==='/v1/checkout/sessions'&&c.method==='POST').length,1);
  assert.equal((await f.status()).plan,'free','Opening hosted checkout must never grant access.');assert.equal((await loadBillingEntitlement(f.env,'owner-b',f.now())).plan,'free');
});

test('lost checkout response retries stable idempotency key and payload without duplicating a session',async t=>{
  const f=fixture(t);let originalPayload;
  f.state.override=call=>{
    if(call.url.pathname==='/v1/checkout/sessions'&&call.method==='POST'){
      originalPayload={key:call.headers['Idempotency-Key'],body:call.data.toString()};f.state.override=null;
      return response({error:{message:'Transient provider failure'}},500);
    }
  };
  assert.equal((await f.checkout()).status,502);assert.equal(f.row().lock_token,null);
  f.advance(2000);assert.equal((await f.checkout()).status,200);
  const last=f.state.calls.filter(c=>c.url.pathname==='/v1/checkout/sessions'&&c.method==='POST').at(-1);
  assert.equal(last.headers['Idempotency-Key'],originalPayload.key);assert.equal(last.data.toString(),originalPayload.body);assert.equal(f.state.sessions.size,1);
});

test('paid access requires active subscription, paid latest invoice and an unexpired paid period',async t=>{
  const f=fixture(t,{live:true});assert.equal((await f.checkout()).status,200);
  const sub=f.subscription();let status=await f.status();assert.equal(status.plan,'plus');assert.equal(status.canPurchase,false);assert.equal(status.canManage,true);
  assert.equal((await loadBillingEntitlement(f.env,'owner-a',f.now())).plan,'plus');assert.equal((await f.checkout()).status,409);
  for(const state of ['incomplete','past_due','unpaid','paused','canceled','trialing']){sub.status=state;assert.equal((await f.status()).plan,'free',state);assert.equal((await loadBillingEntitlement(f.env,'owner-a',f.now())).plan,'free');}
  sub.status='active';sub.latest_invoice.status='open';assert.equal((await f.status()).plan,'free');sub.latest_invoice.status='uncollectible';assert.equal((await f.status()).plan,'free');
  sub.latest_invoice.status='paid';sub.items.data[0].current_period_end=Math.floor(f.now()/1000)-1;assert.equal((await f.status()).plan,'free');
});

test('cancellation at period end preserves the paid period and expires without relying on webhook delivery',async t=>{
  const f=fixture(t,{live:true});await f.checkout();const sub=f.subscription({cancel_at_period_end:true});sub.items.data[0].current_period_end=Math.floor(f.now()/1000)+60;
  const status=await f.status();assert.equal(status.plan,'plus');assert.equal(status.cancelAtPeriodEnd,true);assert.equal(status.currentPeriodEnd,new Date(f.now()+60000).toISOString());
  f.advance(60001);assert.equal((await loadBillingEntitlement(f.env,'owner-a',f.now())).plan,'free');assert.equal((await f.status()).plan,'free');
});

test('signed webhook completion with unpaid subscription cannot grant access; later paid event can',async t=>{
  const f=fixture(t,{live:true});await f.checkout();const sub=f.subscription({status:'incomplete'});sub.latest_invoice.status='open';
  const completed=f.event('checkout.session.completed',{customer:'cus_owner_a',payment_status:'unpaid'});
  const unpaid=await f.webhook(completed);assert.equal(unpaid.status,200,await unpaid.clone().text());assert.equal((await loadBillingEntitlement(f.env,'owner-a',f.now())).plan,'free');
  sub.status='active';sub.latest_invoice.status='paid';const paid=await f.webhook(f.event());assert.equal(paid.status,200);assert.equal((await loadBillingEntitlement(f.env,'owner-a',f.now())).plan,'plus');
  const calls=f.state.calls.length,replay=await f.webhook(completed);assert.equal(replay.status,200);assert.equal((await replay.json()).duplicate,true);assert.equal(f.state.calls.length,calls);
});

test('webhooks reject forged, modified, expired and wrong-mode payloads; all are non-mutating',async t=>{
  const f=fixture(t);await f.checkout();f.subscription();const event=f.event();
  assert.equal((await f.webhook(event,{secret:'wrong-secret'})).status,400);
  assert.equal((await f.webhook(event,{timestamp:Math.floor(f.now()/1000)-301})).status,400);
  assert.equal((await f.webhook(event,{timestamp:Math.floor(f.now()/1000)+301})).status,400);
  assert.equal((await f.webhook({...event,livemode:true})).status,400);
  const request=f.signed(event);const tampered=new Request(request.url,{method:'POST',headers:request.headers,body:JSON.stringify({...event,type:'invoice.payment_failed'})});assert.equal((await f.handler(tampered,f.env)).status,400);
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM billing_events').get().n,0);assert.equal(f.row().status,'none');assert.equal(f.row().paid_until,null);
});

test('out-of-order events reconcile current Stripe state, and unknown customer metadata never claims an account',async t=>{
  const f=fixture(t,{live:true});await f.checkout();f.subscription();assert.equal((await f.webhook(f.event('invoice.paid'))).status,200);
  f.state.subscriptions[0].status='canceled';assert.equal((await f.webhook(f.event('invoice.paid',{customer:'cus_owner_a',status:'paid',metadata:{pawprint_account_id:'owner-a'}}))).status,200);
  assert.equal((await loadBillingEntitlement(f.env,'owner-a',f.now())).plan,'free');assert.equal(f.row().status,'canceled');
  const unknown=await f.webhook(f.event('checkout.session.completed',{customer:'cus_unknown',client_reference_id:'owner-b',metadata:{pawprint_account_id:'owner-b'}}));assert.equal(unknown.status,200);assert.equal((await unknown.json()).ignored,true);assert.equal(f.row('owner-b'),undefined);
});

test('portal is scoped to authenticated customer and rejects unsafe provider redirect URLs',async t=>{
  const f=fixture(t);assert.equal((await f.call('/api/billing/portal','POST',{})).status,409);await f.checkout();
  assert.equal((await f.call('/api/billing/portal','POST',{},'owner-b')).status,409);
  const portal=await f.call('/api/billing/portal','POST',{locale:'zh'});assert.equal(portal.status,200);assert.match((await portal.json()).url,/^https:\/\/billing.stripe.com\//);
  const creation=f.state.calls.filter(c=>c.url.pathname==='/v1/billing_portal/sessions').at(-1);assert.equal(creation.data.get('customer'),'cus_owner_a');assert.equal(creation.data.get('return_url'),origin+'/?billing=return');
  for(const url of ['https://attacker.example/pay','javascript:alert(1)','https://billing.stripe.com.attacker.example/','https://user:secret@billing.stripe.com/','http://billing.stripe.com/']){f.state.override=call=>call.url.pathname==='/v1/billing_portal/sessions'?response({url}):null;assert.equal((await f.call('/api/billing/portal','POST',{})).status,502);}
});

test('checkout leases prevent concurrent purchases and provider errors do not expose secrets',async t=>{
  const f=fixture(t);f.sql.prepare('INSERT INTO billing_accounts(account_id,mode,lock_token,lock_until) VALUES(?,?,?,?)').run('owner-a','test','another-request',f.now()+60000);
  const held=await f.checkout();assert.equal(held.status,409);assert.equal((await held.json()).error.code,'checkout_in_progress');assert.equal(f.state.customers.size,0);
  f.advance(60001);f.state.override=()=>response({error:{message:`Failed with ${f.env.STRIPE_SECRET_KEY} and ${f.env.STRIPE_WEBHOOK_SECRET}`}},500);
  const failed=await f.checkout();assert.equal(failed.status,502);const text=await failed.text();assert.ok(!text.includes(f.env.STRIPE_SECRET_KEY));assert.ok(!text.includes(f.env.STRIPE_WEBHOOK_SECRET));assert.match(text,/provider_unavailable/);
});

test('duplicate subscriptions or cross-customer provider data never produce an entitlement',async t=>{
  const f=fixture(t);await f.checkout();const sub=f.subscription();f.state.subscriptions.push({...sub,id:'sub_duplicate'});
  assert.equal((await f.call('/api/billing/status')).status,409);assert.equal(f.row().paid_until,null);
  f.state.subscriptions=[sub];sub.latest_invoice.customer='cus_owner_b';assert.equal((await f.call('/api/billing/status')).status,502);assert.equal(f.row().paid_until,null);
});

test('billing route methods are explicit and rate limits bound repeated checkout calls',async t=>{
  const f=fixture(t);
  assert.equal((await f.call('/api/billing/status','POST',{})).status,405);
  assert.equal((await f.call('/api/billing/checkout','GET')).status,405);
  assert.equal((await f.call('/api/billing/missing')).status,404);
  for(let i=0;i<10;i++)assert.equal((await f.checkout()).status,200);
  assert.equal((await f.checkout()).status,429);
});

test('Stripe test payments remain separate from real premium access',async t=>{
  const f=fixture(t);await f.checkout();f.subscription();
  assert.equal((await f.status()).plan,'plus','The sandbox may preview its subscription state.');
  assert.equal((await loadBillingEntitlement(f.env,'owner-a',f.now())).plan,'free','Sandbox payments must never authorize real paid access.');
  f.env.STRIPE_SECRET_KEY='sk_live_fixture_secret';
  assert.equal((await loadBillingEntitlement(f.env,'owner-a',f.now())).plan,'free','Switching to live mode must not reuse sandbox entitlements.');
});

test('a canceled subscription can start a new checkout after an earlier completed checkout',async t=>{
  const f=fixture(t);await f.checkout();const sub=f.subscription({status:'canceled'});
  const old=[...f.state.sessions.values()][0];old.status='complete';old.subscription=sub.id;
  const result=await f.checkout();assert.equal(result.status,200,await result.clone().text());
  assert.equal(f.state.sessions.size,2);assert.notEqual((await result.json()).url,old.url);
});

test('refund and dispute holds apply to the current paid invoice, and a new paid renewal restores access',async t=>{
  const f=fixture(t,{live:true});await f.checkout();const sub=f.subscription();await f.status();
  f.state.charges.set('ch_owned',{id:'ch_owned',customer:'cus_owner_a',invoice:'in_owned',refunded:true,livemode:true});
  assert.equal((await f.webhook(f.event('charge.refunded',{id:'ch_owned',customer:'cus_owner_a'}))).status,200);
  assert.equal((await loadBillingEntitlement(f.env,'owner-a',f.now())).plan,'free');
  sub.latest_invoice={...sub.latest_invoice,id:'in_renewal'};await f.status();
  assert.equal((await loadBillingEntitlement(f.env,'owner-a',f.now())).plan,'plus');
  f.state.charges.set('ch_renewal',{id:'ch_renewal',customer:'cus_owner_a',invoice:'in_renewal',refunded:false,livemode:true});
  f.state.disputes.set('dp_owned',{id:'dp_owned',charge:'ch_renewal',status:'needs_response',livemode:true});
  assert.equal((await f.webhook(f.event('charge.dispute.created',{id:'dp_owned',charge:'ch_renewal',status:'needs_response'}))).status,200);
  assert.equal((await loadBillingEntitlement(f.env,'owner-a',f.now())).plan,'free');
  f.state.disputes.get('dp_owned').status='won';
  assert.equal((await f.webhook(f.event('charge.dispute.closed',{id:'dp_owned',charge:'ch_renewal',status:'won'}))).status,200);
  assert.equal((await loadBillingEntitlement(f.env,'owner-a',f.now())).plan,'plus');
  for(const status of ['warning_closed','prevented']){
    f.state.disputes.set('du_current',{id:'du_current',charge:'ch_renewal',status,livemode:true});
    // The event may contain a stale failure. Current Stripe state wins.
    assert.equal((await f.webhook(f.event('charge.dispute.closed',{id:'du_current',charge:'ch_renewal',status:'lost'}))).status,200);
    assert.equal((await loadBillingEntitlement(f.env,'owner-a',f.now())).plan,'plus');
  }
  f.state.charges.get('ch_renewal').refunded=true;
  assert.equal((await f.webhook(f.event('charge.dispute.closed',{id:'du_current',charge:'ch_renewal',status:'prevented'}))).status,200);
  assert.equal((await loadBillingEntitlement(f.env,'owner-a',f.now())).plan,'free','A resolved dispute must not clear a full-refund hold.');
});

test('verified-event callback works without subscription pricing, only after signature and mode checks',async t=>{
  const seen=[];let fail=false;
  const f=fixture(t,{onVerifiedEvent:async(event,env,context)=>{
    seen.push({event,env,context});
    if(fail)throw new Error('temporary order-storage failure');
    return {handled:true};
  }});
  delete f.env.STRIPE_PRICE_PLUS_ANNUAL;
  const event=f.event('checkout.session.completed',{id:'cs_test_shop',customer:'cus_shop',mode:'payment',payment_status:'paid'});
  assert.equal((await f.webhook(event,{secret:'wrong-secret'})).status,400);
  assert.equal((await f.webhook({...event,livemode:true})).status,400);
  assert.equal(seen.length,0,'Unverified events must never reach order fulfillment.');
  const valid=await f.webhook(event);assert.equal(valid.status,200);assert.deepEqual(await valid.json(),{received:true});
  assert.equal(seen.length,1);assert.deepEqual(seen[0].event,event);assert.equal(seen[0].env,f.env);assert.equal(seen[0].context.now,f.now());assert.equal(typeof seen[0].context.fetchImpl,'function');
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM billing_events').get().n,0,'An independently handled event belongs to the callback’s idempotency store.');
  fail=true;const retry=f.event('checkout.session.completed',{id:'cs_test_retry',customer:'cus_shop',mode:'payment',payment_status:'paid'});
  const failed=await f.webhook(retry);assert.equal(failed.status,503);assert.equal((await failed.json()).error.code,'billing_unavailable');
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM billing_events').get().n,0,'Callback errors must leave the event eligible for retry.');
  fail=false;assert.equal((await f.webhook(retry)).status,200);assert.equal(seen.length,3);
});
