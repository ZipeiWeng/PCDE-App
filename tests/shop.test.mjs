import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createHmac,randomBytes} from 'node:crypto';
import {readdir,readFile} from 'node:fs/promises';
import {createShopHandler} from '../worker/shop.js';
import {createBillingHandler} from '../worker/billing.js';
import {verifiedAccountId} from '../worker/auth.js';

const origin='https://pawprint.example',secret='shop-test-auth-secret-at-least-32-characters';
const migrations=new URL('../drizzle/',import.meta.url);
const schema=(await Promise.all((await readdir(migrations)).filter(name=>name.endsWith('.sql')).sort().map(name=>readFile(new URL(name,migrations),'utf8')))).join('\n');
const response=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json'}});
function fixture(t){
 const sql=new DatabaseSync(':memory:');sql.exec('PRAGMA foreign_keys=ON');sql.exec(schema);t.after(()=>sql.close());
 let time=Date.parse('2026-11-15T12:00:00Z');
 const db={prepare(query){const build=(args=[])=>({bind:(...values)=>build(values),first:async()=>sql.prepare(query).get(...args)||null,all:async()=>({results:sql.prepare(query).all(...args)}),run:async()=>({meta:{changes:Number(sql.prepare(query).run(...args).changes)}}),_run:()=>({meta:{changes:Number(sql.prepare(query).run(...args).changes)}})});return build();},async batch(statements){sql.exec('BEGIN');try{const rows=statements.map(statement=>statement._run());sql.exec('COMMIT');return rows;}catch(error){sql.exec('ROLLBACK');throw error;}}};
 const cookies={};
 for(const [id,name] of [['owner-a','Luna'],['owner-b','Max']]){
  const token=randomBytes(32).toString('hex');cookies[id]=`__Host-pawprint_session=${token}`;
  sql.prepare('INSERT INTO auth_accounts VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run(id,id,id,`${id}@example.invalid`,`${id}@example.invalid`,name,name.toLowerCase(),'2023-03-17','female','unused','unused',time);
  sql.prepare('INSERT INTO auth_sessions VALUES(?,?,?,?)').run(createHmac('sha256',secret).update(`session:${token}`).digest('hex'),id,time+365*86400000,time);
 }
 const testId='test_'+randomBytes(16).toString('hex'),testToken='test.'+randomBytes(32).toString('hex');
 sql.prepare('INSERT INTO auth_test_sessions VALUES(?,?,?,?,?)').run(testId,createHmac('sha256',secret).update(`session:${testToken}`).digest('hex'),'',time+30*86400000,time);cookies.test=`__Host-pawprint_session=${testToken}`;
 const env={AUTH_DB:db,AUTH_SECRET:secret,STRIPE_SECRET_KEY:'sk_test_fixture_secret',STRIPE_WEBHOOK_SECRET:'whsec_fixture',STRIPE_PRICE_PAWPRINT_ONE:'price_hardware',STRIPE_SHIPPING_RATE:'shr_hardware',STRIPE_SHIPPING_COUNTRIES:'GB,IE'};
 const state={price:{id:'price_hardware',active:true,livemode:false,type:'one_time',billing_scheme:'per_unit',unit_amount:10000,currency:'gbp',recurring:null},shipping:{id:'shr_hardware',active:true,livemode:false,type:'fixed_amount',fixed_amount:{amount:500,currency:'gbp'}},sessions:new Map(),disputes:[],calls:[],override:null,loseCreateResponse:false};
 const fetchImpl=async(url,options={})=>{
  const parsed=new URL(url),method=options.method||'GET',data=new URLSearchParams(options.body),call={url:parsed,method,data,headers:options.headers};state.calls.push(call);
  assert.equal(parsed.origin,'https://api.stripe.com');assert.equal(options.redirect,'error');
  if(state.override){const value=await state.override(call);if(value)return value;}
  if(parsed.pathname==='/v1/prices/price_hardware')return response(state.price);
  if(parsed.pathname==='/v1/shipping_rates/shr_hardware')return response(state.shipping);
  if(parsed.pathname==='/v1/disputes')return response({data:state.disputes,has_more:false});
  if(parsed.pathname==='/v1/checkout/sessions'&&method==='POST'){
   const key=options.headers['Idempotency-Key'];let session=[...state.sessions.values()].find(value=>value.key===key);
   if(!session){
    const id='cs_test_'+(state.sessions.size+1),metadata=Object.fromEntries(['pawprint_order_id','pawprint_account_id','pawprint_product'].map(name=>[name,data.get(`metadata[${name}]`)]));
    session={id,key,mode:'payment',livemode:false,metadata,client_reference_id:data.get('client_reference_id'),status:'open',payment_status:'unpaid',payment_intent:null,expires_at:Math.floor(time/1000)+24*3600,url:'https://checkout.stripe.com/c/pay/'+id,currency:'gbp',amount_subtotal:10000,amount_total:10000,shipping_cost:null,line_items:{has_more:false,data:[{price:{id:data.get('line_items[0][price]')},quantity:1,currency:'gbp',amount_subtotal:10000}]}};
    state.sessions.set(id,session);
   }
   if(state.loseCreateResponse){state.loseCreateResponse=false;throw new Error('Lost response after provider accepted order');}
   return response(session);
  }
  if(parsed.pathname.startsWith('/v1/checkout/sessions/'))return response(state.sessions.get(parsed.pathname.split('/').at(-1))||{});
  if(parsed.pathname.startsWith('/v1/charges/'))return response([...state.sessions.values()].map(value=>value.payment_intent?.latest_charge).find(value=>value?.id===parsed.pathname.split('/').at(-1))||{});
  throw new Error('Unexpected provider request '+parsed.pathname);
 };
 const handler=createShopHandler({getAccountId:verifiedAccountId,fetchImpl,now:()=>time});
 const billing=createBillingHandler({getAccountId:verifiedAccountId,fetchImpl,now:()=>time,onVerifiedEvent:(event,context)=>handler.handleVerifiedEvent(event,context)});
 const request=(path,method='GET',body,account='owner-a',headers={})=>new Request(origin+path,{method,headers:{...(cookies[account]?{Cookie:cookies[account]}:{}),...(method!=='GET'?{Origin:origin,'Content-Type':'application/json'}:{}),...headers},...(body===undefined?{}:{body:JSON.stringify(body)})});
 const call=(path,method,body,account,headers)=>handler(request(path,method,body,account,headers),env);
 const checkout=(account='owner-a',patch={},headers={})=>call('/api/shop/checkout','POST',{productId:'pawprint-one',quantity:1,locale:'en',...patch},account,headers);
 const orders=async(account='owner-a')=>{const result=await call('/api/shop/orders','GET',undefined,account);assert.equal(result.status,200,await result.clone().text());return (await result.json()).orders;};
 const row=()=>sql.prepare('SELECT * FROM shop_orders ORDER BY created_at DESC LIMIT 1').get();
 function pay(session=[...state.sessions.values()][0]){
  const id='pi_'+session.id,charge={id:'ch_'+session.id,payment_intent:id,livemode:false,amount:10500,currency:'gbp',paid:true,amount_refunded:0,disputed:false};
  session.payment_intent={id,metadata:session.metadata,livemode:false,amount:10500,amount_received:10500,currency:'gbp',status:'succeeded',latest_charge:charge};session.payment_status='paid';session.status='complete';session.amount_total=10500;session.shipping_cost={shipping_rate:'shr_hardware',amount_total:500};session.collected_information={shipping_details:{address:{country:'GB'}}};return session;
 }
 const event=(type,object)=>({id:'evt_'+randomBytes(8).toString('hex'),type,livemode:false,data:{object}});
 const webhook=(value,{signatureSecret=env.STRIPE_WEBHOOK_SECRET,timestamp=Math.floor(time/1000)}={})=>{
  const body=JSON.stringify(value),digest=createHmac('sha256',signatureSecret).update(`${timestamp}.${body}`).digest('hex');
  return billing(new Request(origin+'/api/billing/webhook',{method:'POST',headers:{'Content-Type':'application/json','Stripe-Signature':`t=${timestamp},v1=${digest}`},body}),env);
 };
 return {sql,env,state,handler,call,checkout,orders,row,pay,event,webhook,advance:ms=>{time+=ms;}};
}

test('catalog requires merchant price, delivery countries and rate; exposes no credentials',async t=>{
 const f=fixture(t);delete f.env.STRIPE_SECRET_KEY;
 let catalog=await (await f.call('/api/shop/catalog')).json();assert.equal(catalog.products[0].available,false);assert.equal(catalog.products[0].price,null);assert.equal(f.state.calls.length,0);
 f.env.STRIPE_SECRET_KEY='sk_test_fixture_secret';delete f.env.STRIPE_SHIPPING_RATE;
 catalog=await (await f.call('/api/shop/catalog')).json();assert.deepEqual(catalog.products[0].price,{amount:10000,currency:'gbp'});assert.equal(catalog.products[0].reason,'shipping_not_configured');
 f.env.STRIPE_SHIPPING_RATE='shr_hardware';catalog=await (await f.call('/api/shop/catalog')).json();assert.equal(catalog.products[0].available,true);assert.deepEqual(catalog.shipping,{amount:500,currency:'gbp',countries:['GB','IE']});assert.doesNotMatch(JSON.stringify(catalog),/sk_test|whsec|price_hardware|shr_hardware/);
 f.state.price.currency='isk';f.advance(61000);catalog=await (await f.call('/api/shop/catalog')).json();assert.equal(catalog.products[0].reason,'price_not_configured');
 f.state.price.currency='gbp';f.state.price.type='recurring';f.advance(61000);catalog=await (await f.call('/api/shop/catalog')).json();assert.equal(catalog.products[0].available,false);
});

test('checkout binds real login identity and rejects test account, forged identity and client price changes',async t=>{
 const f=fixture(t);
 assert.equal((await f.checkout(null)).status,401);assert.equal((await f.checkout('test')).status,403);
 assert.equal((await f.checkout(null,{}, {'x-account-id':'owner-a','oai-authenticated-user-id':'owner-a'})).status,401);
 assert.equal((await f.checkout('owner-a',{amount:1})).status,400);
 assert.equal((await f.checkout('owner-a',{quantity:2})).status,400);
 assert.equal((await f.checkout('owner-a',{productId:'another-device'})).status,400);
 assert.equal((await f.checkout('owner-a',{}, {Origin:'https://attacker.invalid'})).status,403);
 assert.equal((await f.checkout('owner-a',{}, {'Sec-Fetch-Site':'cross-site'})).status,403);
 assert.equal((await f.checkout('owner-a',{}, {'Content-Type':'text/plain'})).status,415);
 assert.equal(f.state.sessions.size,0);
});

test('repeated clicks reuse one open checkout, server prices and delivery restrictions',async t=>{
 const f=fixture(t);const first=await f.checkout();assert.equal(first.status,200,await first.clone().text());const a=await first.json();
 const second=await f.checkout();assert.equal(second.status,200,await second.clone().text());assert.deepEqual(await second.json(),a);assert.equal(f.state.sessions.size,1);assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM shop_orders').get().n,1);
 const create=f.state.calls.find(call=>call.method==='POST');assert.equal(create.data.get('mode'),'payment');assert.equal(create.data.get('line_items[0][price]'),'price_hardware');assert.equal(create.data.get('shipping_options[0][shipping_rate]'),'shr_hardware');assert.equal(create.data.get('shipping_address_collection[allowed_countries][0]'),'GB');assert.equal(create.data.get('metadata[pawprint_account_id]'),'owner-a');assert.equal(create.data.get('payment_intent_data[metadata][pawprint_order_id]'),f.row().id);assert.equal(create.data.get('success_url'),origin+'/?order=success');assert.equal(create.data.has('customer_email'),false);
 assert.equal((await f.orders())[0].status,'pending');assert.equal((await f.orders('owner-b')).length,0);
});

test('lost provider create response retries the same durable idempotency key and checkout',async t=>{
 const f=fixture(t);f.state.loseCreateResponse=true;assert.equal((await f.checkout()).status,502);assert.equal(f.row().checkout_session_id,null);assert.equal(f.state.sessions.size,1);
 assert.equal((await f.checkout()).status,200);assert.equal(f.state.sessions.size,1);assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM shop_orders').get().n,1);
 const calls=f.state.calls.filter(call=>call.method==='POST');assert.equal(calls[0].headers['Idempotency-Key'],calls[1].headers['Idempotency-Key']);assert.equal(calls[0].data.toString(),calls[1].data.toString());
});

test('returns do not confirm purchase; only current verified paid session and amount do',async t=>{
 const f=fixture(t);await f.checkout();assert.equal((await f.call('/api/shop/orders?order=success')).status,200);assert.equal(f.row().status,'pending');
 const session=f.pay();session.payment_status='unpaid';session.payment_intent.status='processing';session.payment_intent.amount_received=0;
 f.advance(11000);assert.equal((await f.orders())[0].status,'pending');
 f.pay(session);f.advance(11000);let order=(await f.orders())[0];assert.equal(order.status,'paid');assert.equal(order.amount,10500);assert.ok(order.paidAt);assert.doesNotMatch(JSON.stringify(order),/address|line1|payment_intent|client_reference/);
 assert.equal((await f.orders('owner-b')).length,0);
});

test('metadata, currency, line-item, total and shipping-country mismatches fail closed',async t=>{
 for(const mutate of [s=>{s.metadata={...s.metadata,pawprint_account_id:'owner-b'};},s=>{s.amount_total=1;},s=>{s.currency='usd';},s=>{s.line_items.data[0].price.id='price_other';},s=>{s.collected_information.shipping_details.address.country='US';},s=>{s.payment_intent.amount_received=1;}]){
  const f=fixture(t);await f.checkout();const session=f.pay();mutate(session);f.advance(11000);const result=await f.call('/api/shop/orders');assert.ok([200,502].includes(result.status));assert.equal(f.row().status,'pending');assert.equal(f.row().paid_at,null);
 }
});

test('canonical webhook verifies signature, timestamp and mode before shop order updates',async t=>{
 const f=fixture(t);await f.checkout();const session=f.pay(),value=f.event('checkout.session.completed',session);
 assert.equal((await f.webhook(value,{signatureSecret:'wrong'})).status,400);assert.equal(f.row().status,'pending');
 assert.equal((await f.webhook(value,{timestamp:0})).status,400);assert.equal(f.row().status,'pending');
 assert.equal((await f.webhook({...value,livemode:true})).status,400);assert.equal(f.row().status,'pending');
 let result=await f.webhook(value);assert.equal(result.status,200,await result.clone().text());assert.equal(f.row().status,'paid');
 result=await f.webhook(value);assert.equal(result.status,200);assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM shop_events').get().n,1);
 assert.deepEqual(await f.handler.handleVerifiedEvent(f.event('checkout.session.completed',{mode:'subscription'}),f.env),{handled:false});
});

test('refund and dispute events read latest provider state; stale event cannot undo resolution',async t=>{
 const f=fixture(t);await f.checkout();const session=f.pay();await f.webhook(f.event('checkout.session.completed',session));const charge=session.payment_intent.latest_charge;
 charge.disputed=true;f.state.disputes=[{id:'dp_hardware',charge:charge.id,livemode:false,status:'needs_response'}];
 assert.equal((await f.webhook(f.event('charge.dispute.created',{id:'dp_hardware',charge:charge.id}))).status,200);assert.equal(f.row().status,'disputed');
 f.state.disputes[0].status='won';assert.equal((await f.webhook(f.event('charge.dispute.closed',{id:'dp_hardware',charge:charge.id}))).status,200);assert.equal(f.row().status,'paid');
 await f.webhook(f.event('charge.dispute.created',{id:'dp_hardware',charge:charge.id}));assert.equal(f.row().status,'paid');
 charge.amount_refunded=500;await f.webhook(f.event('charge.refunded',charge));assert.equal(f.row().status,'partially_refunded');assert.equal(f.row().refunded_amount,500);
 charge.amount_refunded=10500;await f.webhook(f.event('refund.updated',{id:'re_hardware',charge:charge.id}));assert.equal(f.row().status,'refunded');
 await f.webhook(f.event('checkout.session.async_payment_failed',session));assert.equal(f.row().status,'refunded');
});

test('lease contention blocks another checkout and provider failure never consumes a webhook event',async t=>{
 const f=fixture(t);await f.checkout();const session=f.pay();
 f.sql.prepare('UPDATE shop_accounts SET lock_token=?,lock_until=?').run('another-request',Date.parse('2026-11-15T13:00:00Z'));
 assert.equal((await f.checkout()).status,409);const value=f.event('checkout.session.completed',session);assert.equal((await f.webhook(value)).status,503);assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM shop_events').get().n,0);
 f.sql.exec('UPDATE shop_accounts SET lock_until=0');assert.equal((await f.webhook(value)).status,200);assert.equal(f.row().status,'paid');
});

test('an early paid webhook recovers the session ID after the create response was lost',async t=>{
 const f=fixture(t);f.state.loseCreateResponse=true;await f.checkout();const session=f.pay();assert.equal(f.row().checkout_session_id,null);
 assert.equal((await f.webhook(f.event('checkout.session.completed',session))).status,200);assert.equal(f.row().checkout_session_id,session.id);assert.equal(f.row().status,'paid');
});

test('unresolved lost create response is never replayed beyond the safe idempotency window',async t=>{
 const f=fixture(t);f.state.loseCreateResponse=true;await f.checkout();f.advance(25*3600000);
 const result=await f.checkout();assert.equal(result.status,409);assert.equal((await result.json()).error.code,'checkout_reconciliation_required');assert.equal(f.state.sessions.size,1);assert.equal(f.state.calls.filter(call=>call.method==='POST').length,1);assert.equal(f.row().status,'pending');
});
