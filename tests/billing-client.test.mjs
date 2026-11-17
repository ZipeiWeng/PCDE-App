import test from 'node:test';
import assert from 'node:assert/strict';
import {createBilling,checkoutDestination,consumeBillingReturn,subscriptionContent} from '../dist/billing.js';
const free={plan:'free',status:'none',canPurchase:true,canManage:false,mode:'live',reason:null,price:{amount:14400,currency:'cny',interval:'year',intervalCount:1},cancelAtPeriodEnd:false,currentPeriodEnd:null};
const response=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}});
const delayed=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};

test('checkout uses server-selected plan and an authenticated POST; rapid taps cannot create duplicate requests',async()=>{
 let account={id:'owner-1'},pending=delayed(),calls=[],redirects=[];
 const client=createBilling({getAccount:()=>account,fetchImpl:async(url,init)=>{calls.push({url,init});return url.endsWith('/status')?response(free):pending.promise;},navigate:url=>redirects.push(url)});
 await client.load();const first=client.checkout('zh');assert.equal(await client.checkout('en'),false);
 assert.equal(calls.length,2);assert.equal(calls[1].url,'/api/billing/checkout');assert.deepEqual(JSON.parse(calls[1].init.body),{locale:'zh',plan:'plus'});assert.equal(calls[1].init.credentials,'same-origin');
 pending.resolve(response({url:'https://checkout.stripe.com/c/pay/cs_live_example',mode:'live'}));assert.equal(await first,true);assert.deepEqual(redirects,['https://checkout.stripe.com/c/pay/cs_live_example']);
});

test('stale status or checkout responses cannot update or navigate a different account',async()=>{
 let account={id:'a'},pending=delayed(),redirects=[];
 const client=createBilling({getAccount:()=>account,fetchImpl:()=>pending.promise,navigate:url=>redirects.push(url)});
 const oldLoad=client.load();account={id:'b'};assert.equal(client.getState().loaded,false);
 pending.resolve(response({...free,plan:'plus',status:'active',canManage:true}));assert.equal(await oldLoad,null);assert.equal(client.getState().plan,'free');
 pending=delayed();const load=client.load();pending.resolve(response(free));await load;
 pending=delayed();const checkout=client.checkout();account={id:'c'};pending.resolve(response({url:'https://checkout.stripe.com/c/pay/cs_live_example'}));assert.equal(await checkout,false);assert.deepEqual(redirects,[]);assert.equal(client.getState().loaded,false);
});

test('TEST and guest accounts cannot pay even if a server response wrongly offers purchase',async()=>{
 for(const account of [{id:'test',isTest:true},{id:'guest',demo:true},null]){
  let posts=0;const client=createBilling({getAccount:()=>account,fetchImpl:async(url,init)=>{if(init.method==='POST')posts++;return response(free);},navigate:()=>assert.fail('must not navigate')});
  await client.load();assert.equal(await client.checkout(),false);assert.equal(await client.portal(),false);assert.equal(client.getState().canPurchase,false);assert.equal(posts,0);
 }
});

test('Stripe redirect destination validation rejects off-domain, insecure and credential-bearing URLs',async()=>{
 for(const url of ['javascript:alert(1)','http://checkout.stripe.com/pay','https://checkout.stripe.com.evil.test/pay','https://user:password@checkout.stripe.com/pay','https://evil.test/?url=https://checkout.stripe.com','https://billing.stripe.com/p/session'])assert.equal(checkoutDestination(url),null);
 assert.equal(checkoutDestination('https://billing.stripe.com/p/session','portal'),'https://billing.stripe.com/p/session');
 const client=createBilling({getAccount:()=>({id:'a'}),fetchImpl:async(url)=>response(url.endsWith('/status')?free:{url:'https://evil.test/pay'}),navigate:()=>assert.fail('unsafe redirect')});
 await client.load();assert.equal(await client.checkout(),false);assert.equal(client.getState().busy,'');assert.equal(client.getState().error,'provider_unavailable');
});

test('return query is only a refresh intent and cannot grant entitlement, including while initial status is pending',async()=>{
 const marker=consumeBillingReturn('https://pawprint.test/?checkout=success&keep=1');assert.deepEqual(marker,{intent:'success',cleanURL:'https://pawprint.test/?keep=1'});
 assert.equal(consumeBillingReturn('https://pawprint.test/?checkout=plus').intent,null);
 assert.equal(consumeBillingReturn('https://pawprint.test/?billing=return').intent,'portal');
 const pending=delayed();const client=createBilling({getAccount:()=>({id:'a',preferences:{subscription:'plus'}}),fetchImpl:()=>pending.promise});
 const first=client.load();const returning=client.load({returnIntent:marker.intent});pending.resolve(response(free));await Promise.all([first,returning]);
 assert.equal(client.getState().plan,'free');assert.equal(client.getState().returnIntent,'success');
 const html=subscriptionContent(client.getState());assert.match(html,/No active subscription confirmed yet/);assert.doesNotMatch(html,/Your Plus subscription is active/);assert.doesNotMatch(html,/data-plan=/);
});

test('unconfigured and failed status show no working purchase CTA; cancellation never claims success',async()=>{
 const client=createBilling({getAccount:()=>({id:'a'}),fetchImpl:async()=>response({...free,mode:'unconfigured',price:null,canPurchase:false,reason:'payment_setup_required'})});
 await client.load({returnIntent:'cancelled'});let html=subscriptionContent(client.getState());assert.match(html,/Purchases aren’t available yet/);assert.match(html,/data-billing-action="checkout" disabled/);assert.match(html,/Your plan has not changed/);assert.equal(await client.checkout(),false);
 const err=createBilling({getAccount:()=>({id:'a'}),fetchImpl:async()=>response({error:{code:'provider_unavailable',message:'secret provider details'}},502)});await err.load();html=subscriptionContent(err.getState());assert.match(html,/Payment service unavailable/);assert.doesNotMatch(html,/secret provider details/);assert.match(html,/data-billing-refresh/);
});

test('verified active subscription shows management and cancellation date in both languages',()=>{
 const state={...free,loaded:true,plan:'plus',status:'active',canManage:true,canPurchase:false,cancelAtPeriodEnd:true,currentPeriodEnd:'2027-11-15T00:00:00Z'};
 const en=subscriptionContent(state),zh=subscriptionContent(state,{language:'zh'});
 assert.match(en,/Manage subscription/);assert.match(en,/Access until/);assert.match(en,/15 Nov 2027/);assert.match(zh,/管理订阅/);assert.match(zh,/使用期限至/);assert.doesNotMatch(en,/data-plan=/);
});


test('an eligible returning buyer sees Subscribe even with a historical billing account',()=>{
 const html=subscriptionContent({...free,loaded:true,status:'canceled',canManage:true});
 assert.match(html,/data-billing-action="checkout"/);assert.match(html,/Subscribe to Plus/);assert.doesNotMatch(html,/data-billing-action="portal"/);
});
