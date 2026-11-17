// Stripe-hosted checkout. The browser never handles payment credentials or
// decides entitlements. Runtime secrets stay outside this repository.
// API contract verified against Stripe documentation on 2026-11-15.
const BILLING_VERSION = '2026-10-28.endive';
const BILLING_LEASE_MS = 120000;
const billingEncoder = new TextEncoder();
const billingId = (value, prefix) => typeof value === 'string' && new RegExp(`^${prefix}_[A-Za-z0-9_]{1,190}$`).test(value);
const billingObjectId = value => typeof value === 'string' ? value : value?.id;
class BillingError extends Error {
  constructor(status,code,message) { super(message);this.status=status;this.code=code; }
}
const billingJSON = (value,status=200,headers={}) => new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...headers}});
const billingFailure = () => new BillingError(502,'provider_unavailable','Payments are temporarily unavailable. Please try again.');
const billingSetup = () => new BillingError(503,'payment_setup_required','Purchases are not available yet.');
function billingConfig(env) {
  const secret=typeof env.STRIPE_SECRET_KEY==='string'?env.STRIPE_SECRET_KEY.trim():'';
  const mode=/^(?:sk|rk)_live_/.test(secret)?'live':/^(?:sk|rk)_test_/.test(secret)?'test':'unconfigured';
  const webhook=typeof env.STRIPE_WEBHOOK_SECRET==='string'?env.STRIPE_WEBHOOK_SECRET.trim():'';
  const price=typeof env.STRIPE_PRICE_PLUS_ANNUAL==='string'?env.STRIPE_PRICE_PLUS_ANNUAL.trim():'';
  const providerReady=mode!=='unconfigured'&&webhook.startsWith('whsec_');
  return {secret,webhook,price,mode,providerReady,configured:providerReady&&billingId(price,'price')};
}
async function billingRaw(request,limit) {
  const length=request.headers.get('content-length');
  if(length!==null&&(!/^\d+$/.test(length)||Number(length)>limit))throw new BillingError(413,'payload_too_large','This request is too large.');
  const reader=request.body?.getReader(),chunks=[];let size=0;
  if(reader)try {while(true){const item=await reader.read();if(item.done)break;size+=item.value.byteLength;if(size>limit){await reader.cancel();throw new BillingError(413,'payload_too_large','This request is too large.');}chunks.push(item.value);}} finally {reader.releaseLock();}
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
  return bytes;
}
function billingParse(bytes) {
  try {const value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));if(!value||typeof value!=='object'||Array.isArray(value))throw new Error();return value;}
  catch {throw new BillingError(400,'invalid_request','Send a valid JSON object.');}
}
async function billingBody(request,keys) {
  if(request.headers.get('origin')!==new URL(request.url).origin||['cross-site','none'].includes(request.headers.get('sec-fetch-site')))throw new BillingError(403,'origin_not_allowed','Open payments from the Pawprint app.');
  if(!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type')||''))throw new BillingError(415,'json_required','Send this request as JSON.');
  const body=billingParse(await billingRaw(request,1024));
  if(Object.keys(body).some(key=>!keys.includes(key))||(body.locale!==undefined&&!['en','zh'].includes(body.locale)))throw new BillingError(400,'invalid_request','The payment request contains unsupported fields.');
  return body;
}
function billingPrice(value,config) {
  if(!value||value.id!==config.price||value.active!==true||value.livemode!==(config.mode==='live')||value.type!=='recurring'||value.currency!=='cny'||value.unit_amount!==14400||value.recurring?.interval!=='year'||value.recurring?.interval_count!==1||value.recurring?.usage_type!=='licensed')throw billingSetup();
  return {amount:value.unit_amount,currency:value.currency,interval:'year',intervalCount:1};
}
async function billingStripe(config,fetchImpl,path,{method='GET',data,idempotency}={}) {
  const headers={Authorization:`Bearer ${config.secret}`,'Stripe-Version':BILLING_VERSION};
  if(data)headers['Content-Type']='application/x-www-form-urlencoded';
  if(idempotency)headers['Idempotency-Key']=idempotency;
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),12000);
  try {
    const response=await fetchImpl('https://api.stripe.com/v1'+path,{method,headers,body:data?new URLSearchParams(data).toString():undefined,signal:controller.signal,redirect:'error'});
    if(!response.ok)throw billingFailure();
    const value=billingParse(await billingRaw(response,1024*1024));
    return value;
  }catch(error){if(error instanceof BillingError&&error.code==='provider_unavailable')throw error;throw billingFailure();}
  finally {clearTimeout(timer);}
}
function billingRedirect(value,host) {
  try {const url=new URL(value);if(url.protocol==='https:'&&url.hostname===host&&!url.username&&!url.password&&!url.port)return url.href;}catch{}
  throw billingFailure();
}
async function billingPrincipal(request,env,getAccountId,now) {
  if(!env.AUTH_DB?.prepare||!env.AUTH_DB?.batch)throw new BillingError(503,'storage_unavailable','Payments are temporarily unavailable.');
  const id=await getAccountId(request,env,now);
  if(!id||typeof id!=='string'||id.length>200)throw new BillingError(401,'authentication_required','Log in to manage your subscription.');
  const real=await env.AUTH_DB.prepare('SELECT id,email FROM auth_accounts WHERE id=?').bind(id).first();
  if(real)return {...real,isTest:false};
  const test=await env.AUTH_DB.prepare('SELECT id FROM auth_test_sessions WHERE id=? AND expires_at>?').bind(id,now).first();
  if(test)return {...test,isTest:true};
  throw new BillingError(401,'authentication_required','Log in to manage your subscription.');
}
async function billingLimit(db,id,action,now) {
  const key=`billing:${action}:${id}:${Math.floor(now/60000)}`;
  const row=await db.prepare('INSERT INTO auth_limits(bucket_key,count,expires_at) VALUES(?,1,?) ON CONFLICT(bucket_key) DO UPDATE SET count=count+1 RETURNING count').bind(key,now+120000).first();
  if(row.count>(action==='status'?30:10))throw new BillingError(429,'too_many_requests','Please wait a minute before trying again.');
}
const billingRow = (db,id,mode) => db.prepare('SELECT * FROM billing_accounts WHERE account_id=? AND mode=?').bind(id,mode).first();
async function billingLock(db,id,mode,now) {
  const token=crypto.randomUUID();
  await db.prepare('INSERT INTO billing_accounts(account_id,mode) VALUES(?,?) ON CONFLICT(account_id,mode) DO NOTHING').bind(id,mode).run();
  const result=await db.prepare('UPDATE billing_accounts SET lock_token=?,lock_until=? WHERE account_id=? AND mode=? AND lock_until<=?').bind(token,now+BILLING_LEASE_MS,id,mode,now).run();
  return Number(result.meta?.changes)?token:null;
}
async function billingUnlock(db,id,mode,token) {
  await db.prepare('UPDATE billing_accounts SET lock_token=NULL,lock_until=0 WHERE account_id=? AND mode=? AND lock_token=?').bind(id,mode,token).run();
}
function billingView(row,config,price,now,reason=null) {
  const paid=row?.status==='active'&&row.paid_until>now&&!(row.risk_status&&row.risk_invoice_id===row.latest_invoice_id);
  const status=row?.status||'none',existing=!['none','canceled','incomplete_expired'].includes(status);
  return {plan:paid?'plus':'free',status,canPurchase:config.configured&&!reason&&!existing,canManage:config.configured&&!reason&&Boolean(row?.customer_id&&row?.subscription_id),mode:config.configured?config.mode:'unconfigured',reason,price,cancelAtPeriodEnd:Boolean(row?.cancel_at_period_end),currentPeriodEnd:row?.current_period_end?new Date(row.current_period_end).toISOString():null};
}
async function billingRefresh(db,row,config,fetchImpl,now,token) {
  if(!row.customer_id)return row;
  const list=await billingStripe(config,fetchImpl,`/subscriptions?customer=${encodeURIComponent(row.customer_id)}&status=all&limit=100&expand[]=data.latest_invoice`);
  if(!Array.isArray(list.data)||list.has_more)throw billingFailure();
  const subscriptions=list.data.filter(sub=>sub.metadata?.pawprint_account_id===row.account_id&&sub.metadata?.pawprint_plan==='plus');
  for(const sub of subscriptions)if(!billingId(sub.id,'sub')||billingObjectId(sub.customer)!==row.customer_id||sub.livemode!==(config.mode==='live'))throw billingFailure();
  const live=subscriptions.filter(sub=>!['canceled','incomplete_expired'].includes(sub.status));
  if(live.length>1)throw new BillingError(409,'billing_review_required','Please manage your existing subscriptions before purchasing another.');
  const sub=live[0]||subscriptions.sort((a,b)=>(b.created||0)-(a.created||0))[0];
  let status='none',end=null,paid=null,invoiceId=null;
  if(sub){
    status=sub.status;
    const items=sub.items?.data;
    if(!Array.isArray(items)||items.length!==1||billingObjectId(items[0].price)!==config.price||items[0].quantity!==1)throw new BillingError(409,'billing_review_required','Your subscription needs a billing review.');
    const seconds=items[0].current_period_end??sub.current_period_end;
    end=Number.isFinite(seconds)?seconds*1000:null;
    let invoice=sub.latest_invoice;
    if(typeof invoice==='string')invoice=await billingStripe(config,fetchImpl,`/invoices/${encodeURIComponent(invoice)}`);
    invoiceId=billingObjectId(invoice)||null;
    if(invoice&&billingObjectId(invoice.customer)!==row.customer_id)throw billingFailure();
    if(status==='active'&&invoice?.status==='paid'&&invoice.livemode===(config.mode==='live')&&end>now)paid=end;
  }
  await db.prepare('UPDATE billing_accounts SET subscription_id=?,status=?,paid_until=?,current_period_end=?,cancel_at_period_end=?,latest_invoice_id=?,verified_at=? WHERE account_id=? AND mode=? AND lock_token=?').bind(sub?.id||null,status,paid,end,sub?.cancel_at_period_end?1:0,invoiceId,now,row.account_id,config.mode,token).run();
  return billingRow(db,row.account_id,config.mode);
}
async function billingCustomer(db,row,principal,config,fetchImpl,token) {
  if(row.customer_id)return row;
  const customer=await billingStripe(config,fetchImpl,'/customers',{method:'POST',data:{email:principal.email,'metadata[pawprint_account_id]':principal.id},idempotency:`pawprint-customer-${config.mode}-${principal.id}`});
  if(!billingId(customer.id,'cus')||customer.livemode!==(config.mode==='live')||customer.metadata?.pawprint_account_id!==principal.id)throw billingFailure();
  await db.prepare('UPDATE billing_accounts SET customer_id=? WHERE account_id=? AND mode=? AND lock_token=?').bind(customer.id,principal.id,config.mode,token).run();
  return billingRow(db,principal.id,config.mode);
}
async function billingCheckout(request,db,principal,config,fetchImpl,now,body) {
  if(body.plan!=='plus')throw new BillingError(400,'invalid_request','Choose the Plus plan.');
  const token=await billingLock(db,principal.id,config.mode,now);
  if(!token)throw new BillingError(409,'checkout_in_progress','Your checkout is being prepared. Please try again shortly.');
  try {
    let row=await billingCustomer(db,await billingRow(db,principal.id,config.mode),principal,config,fetchImpl,token);
    row=await billingRefresh(db,row,config,fetchImpl,now,token);
    if(!['none','canceled','incomplete_expired'].includes(row.status))throw new BillingError(409,'subscription_exists','You already have a subscription. Choose Manage subscription.');
    if(row.checkout_session_id){
      const session=await billingStripe(config,fetchImpl,`/checkout/sessions/${encodeURIComponent(row.checkout_session_id)}`);
      if(billingObjectId(session.customer)!==row.customer_id||session.client_reference_id!==principal.id||session.livemode!==(config.mode==='live'))throw billingFailure();
      if(session.status==='open'&&session.expires_at*1000>now)return {url:billingRedirect(session.url,'checkout.stripe.com'),mode:config.mode};
      if(session.status==='complete'&&!(row.subscription_id&&billingObjectId(session.subscription)===row.subscription_id&&['canceled','incomplete_expired'].includes(row.status)))throw new BillingError(409,'checkout_in_progress','Your completed payment is being confirmed. Refresh your subscription in a moment.');
    }
    // Keep an unknown outcome's idempotency key until Stripe returns a session.
    // Default Checkout expiry is 24 h, matching Stripe's minimum key retention.
    // A timeout must not create a second, overlapping checkout on a later click.
    if(!row.checkout_attempt||row.checkout_session_id){
      await db.prepare('UPDATE billing_accounts SET checkout_attempt=?,checkout_started_at=?,checkout_session_id=NULL,checkout_expires_at=NULL WHERE account_id=? AND mode=? AND lock_token=?').bind(crypto.randomUUID(),now,principal.id,config.mode,token).run();
      row=await billingRow(db,principal.id,config.mode);
    }
    const origin=new URL(request.url).origin;
    // Keys + exact request remain stable across lost responses. All price,
    // customer, return URLs and access metadata are server-owned.
    const session=await billingStripe(config,fetchImpl,'/checkout/sessions',{method:'POST',idempotency:`pawprint-checkout-${row.checkout_attempt}`,data:{
      mode:'subscription',customer:row.customer_id,client_reference_id:principal.id,
      'line_items[0][price]':config.price,'line_items[0][quantity]':'1',
      'metadata[pawprint_account_id]':principal.id,'metadata[pawprint_plan]':'plus',
      'subscription_data[metadata][pawprint_account_id]':principal.id,'subscription_data[metadata][pawprint_plan]':'plus',
      success_url:origin+'/?checkout=success',cancel_url:origin+'/?checkout=cancelled',
      locale:'auto',
    }});
    if(!billingId(session.id,'cs')||billingObjectId(session.customer)!==row.customer_id||session.client_reference_id!==principal.id||session.livemode!==(config.mode==='live')||!['open','expired','complete'].includes(session.status)||!Number.isFinite(session.expires_at))throw billingFailure();
    await db.prepare('UPDATE billing_accounts SET checkout_session_id=?,checkout_expires_at=? WHERE account_id=? AND mode=? AND lock_token=?').bind(session.id,session.expires_at*1000,principal.id,config.mode,token).run();
    if(session.status==='expired')throw new BillingError(409,'checkout_expired','The previous checkout expired. Please try again to open a new checkout.');
    if(session.status==='complete')throw new BillingError(409,'checkout_in_progress','Your completed payment is being confirmed. Refresh your subscription in a moment.');
    return {url:billingRedirect(session.url,'checkout.stripe.com'),mode:config.mode};
  }finally{await billingUnlock(db,principal.id,config.mode,token);}
}
async function billingSignature(request,secret,now) {
  const signature=request.headers.get('stripe-signature')||'';
  if(signature.length>2048)throw new BillingError(400,'invalid_signature','Invalid webhook signature.');
  const pairs=signature.split(',').map(item=>item.trim().split('='));
  const timestamps=pairs.filter(([key])=>key==='t'),signatures=pairs.filter(([key,value])=>key==='v1'&&/^[a-f0-9]{64}$/i.test(value||'')).map(([,value])=>value);
  if(timestamps.length!==1||!/^\d{1,12}$/.test(timestamps[0][1]||'')||Math.abs(now/1000-Number(timestamps[0][1]))>300||!signatures.length)throw new BillingError(400,'invalid_signature','Invalid webhook signature.');
  const raw=await billingRaw(request,512*1024),prefix=billingEncoder.encode(timestamps[0][1]+'.'),signed=new Uint8Array(prefix.length+raw.length);signed.set(prefix);signed.set(raw,prefix.length);
  const key=await crypto.subtle.importKey('raw',billingEncoder.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['verify']);
  let valid=false;
  for(const value of signatures){const bytes=Uint8Array.from(value.match(/../g),x=>parseInt(x,16));valid=(await crypto.subtle.verify('HMAC',key,bytes,signed))||valid;}
  if(!valid)throw new BillingError(400,'invalid_signature','Invalid webhook signature.');
  return billingParse(raw);
}
async function billingRisk(event,config,fetchImpl) {
  let object=event.data?.object,customer=billingObjectId(object?.customer),risk=null;
  if(event.type.startsWith('charge.dispute.')){
    const disputeId=billingObjectId(object);if(!billingId(disputeId,'dp')&&!billingId(disputeId,'du'))throw new BillingError(400,'invalid_event','Invalid payment event.');
    const dispute=await billingStripe(config,fetchImpl,`/disputes/${encodeURIComponent(disputeId)}`);
    const chargeId=billingObjectId(dispute.charge);if(!billingId(chargeId,'ch'))throw new BillingError(400,'invalid_event','Invalid payment event.');
    object=await billingStripe(config,fetchImpl,`/charges/${encodeURIComponent(chargeId)}`);customer=billingObjectId(object.customer);
    if(dispute.livemode!==(config.mode==='live')||object.livemode!==(config.mode==='live'))throw billingFailure();
    risk={invoice:billingObjectId(object.invoice),status:object.refunded===true?'refunded':['won','warning_closed','prevented'].includes(dispute.status)?null:'disputed'};
  }else if(event.type==='charge.refunded'){
    const chargeId=billingObjectId(object);if(!billingId(chargeId,'ch'))throw new BillingError(400,'invalid_event','Invalid payment event.');
    object=await billingStripe(config,fetchImpl,`/charges/${encodeURIComponent(chargeId)}`);customer=billingObjectId(object.customer);
    if(object.livemode!==(config.mode==='live'))throw billingFailure();
    if(object.refunded===true)risk={invoice:billingObjectId(object.invoice),status:'refunded'};
  }
  return {customer,risk};
}
async function billingWebhook(request,env,config,fetchImpl,now,onVerifiedEvent) {
  if(!config.providerReady)throw billingSetup();
  const event=await billingSignature(request,config.webhook,now),db=env.AUTH_DB;
  if(!billingId(event.id,'evt')||event.livemode!==(config.mode==='live')||typeof event.type!=='string')throw new BillingError(400,'invalid_event','Invalid payment event.');
  if(onVerifiedEvent){const result=await onVerifiedEvent(event,env,{now,fetchImpl});if(result?.handled===true)return {received:true};}
  if(!config.configured)return {received:true,ignored:true};
  if(!db?.prepare)throw new BillingError(503,'storage_unavailable','Payments are temporarily unavailable.');
  if(await db.prepare('SELECT event_id FROM billing_events WHERE event_id=? AND mode=?').bind(event.id,config.mode).first())return {received:true,duplicate:true};
  const handled=/^(customer\.subscription\.(created|updated|deleted|paused|resumed)|invoice\.(paid|payment_failed|payment_action_required|voided|marked_uncollectible)|checkout\.session\.(completed|async_payment_succeeded|async_payment_failed)|charge\.(refunded|dispute\.(created|closed)))$/;
  if(!handled.test(event.type))return {received:true,ignored:true};
  let {customer,risk}=await billingRisk(event,config,fetchImpl);
  if(!billingId(customer,'cus'))return {received:true,ignored:true};
  let row=await db.prepare('SELECT * FROM billing_accounts WHERE customer_id=? AND mode=?').bind(customer,config.mode).first();
  // Never establish account ownership from untrusted client metadata/events.
  if(!row)return {received:true,ignored:true};
  const token=await billingLock(db,row.account_id,config.mode,now);
  if(!token)throw new BillingError(503,'billing_busy','Retry this payment event shortly.');
  try {
    if(await db.prepare('SELECT event_id FROM billing_events WHERE event_id=? AND mode=?').bind(event.id,config.mode).first())return {received:true,duplicate:true};
    row=await billingRefresh(db,row,config,fetchImpl,now,token);
    if(event.type.startsWith('charge.')) {
      // Resolve risk again under the account lease: an older in-flight event
      // cannot overwrite a later dispute resolution using an earlier API read.
      const latest=await billingRisk(event,config,fetchImpl);
      if(latest.customer!==row.customer_id)throw billingFailure();
      risk=latest.risk;
    }
    const statements=[];
    if(risk&&billingId(risk.invoice,'in'))statements.push(db.prepare('UPDATE billing_accounts SET risk_invoice_id=?,risk_status=? WHERE account_id=? AND mode=? AND lock_token=? AND latest_invoice_id=?').bind(risk.invoice,risk.status,row.account_id,config.mode,token,risk.invoice));
    statements.push(db.prepare('INSERT INTO billing_events(event_id,mode,processed_at) VALUES(?,?,?) ON CONFLICT(event_id,mode) DO NOTHING').bind(event.id,config.mode,now));
    await db.batch(statements);
    return {received:true};
  }finally{await billingUnlock(db,row.account_id,config.mode,token);}
}
// This accessor is suitable for future premium API gates: it never consults a
// client preference and expires locally even when a webhook delivery is delayed.
export async function loadBillingEntitlement(env,accountId,now=Date.now()) {
  const config=billingConfig(env);if(!config.configured||config.mode!=='live'||!env.AUTH_DB?.prepare)return {plan:'free'};
  const row=await billingRow(env.AUTH_DB,accountId,config.mode);
  return {plan:billingView(row,config,null,now).plan};
}
export function createBillingHandler({getAccountId,fetchImpl=(...args)=>fetch(...args),now=Date.now,onVerifiedEvent}={}) {
  return async(request,env={})=>{
    try {
      const path=new URL(request.url).pathname,clock=now(),config=billingConfig(env);
      if(path==='/api/billing/webhook'){
        if(request.method!=='POST')return billingJSON({error:{code:'method_not_allowed',message:'Use POST.'}},405,{Allow:'POST'});
        return billingJSON(await billingWebhook(request,env,config,fetchImpl,clock,onVerifiedEvent));
      }
      const method=path==='/api/billing/status'?'GET':['/api/billing/checkout','/api/billing/portal'].includes(path)?'POST':null;
      if(!method)throw new BillingError(404,'not_found','This payment endpoint does not exist.');
      if(request.method!==method)return billingJSON({error:{code:'method_not_allowed',message:`Use ${method}.`}},405,{Allow:method});
      const principal=await billingPrincipal(request,env,getAccountId,clock),db=env.AUTH_DB;
      const body=method==='POST'?await billingBody(request,path.endsWith('/checkout')?['plan','locale']:['locale']):null;
      await billingLimit(db,principal.id,path.split('/').at(-1),clock);
      if(principal.isTest){if(method==='POST')throw new BillingError(403,'test_account','Use your own account to purchase a subscription. Test accounts are never charged.');return billingJSON(billingView(null,config,null,clock,'test_account'));}
      if(!config.configured){if(method==='POST')throw billingSetup();return billingJSON(billingView(null,config,null,clock,'payment_setup_required'));}
      const price=billingPrice(await billingStripe(config,fetchImpl,`/prices/${encodeURIComponent(config.price)}`),config);
      if(path.endsWith('/checkout'))return billingJSON(await billingCheckout(request,db,principal,config,fetchImpl,clock,body));
      if(path.endsWith('/portal')){
        const row=await billingRow(db,principal.id,config.mode);if(!row?.customer_id)throw new BillingError(409,'no_subscription','There is no subscription to manage yet.');
        const portal=await billingStripe(config,fetchImpl,'/billing_portal/sessions',{method:'POST',data:{customer:row.customer_id,return_url:new URL(request.url).origin+'/?billing=return',locale:body.locale==='zh'?'zh':'en'}});
        return billingJSON({url:billingRedirect(portal.url,'billing.stripe.com'),mode:config.mode});
      }
      let row=await billingRow(db,principal.id,config.mode);
      if(row?.customer_id){const token=await billingLock(db,principal.id,config.mode,clock);if(token)try {row=await billingRefresh(db,row,config,fetchImpl,clock,token);}finally{await billingUnlock(db,principal.id,config.mode,token);}}
      return billingJSON(billingView(row,config,price,clock));
    }catch(error){if(error instanceof BillingError)return billingJSON({error:{code:error.code,message:error.message}},error.status);return billingJSON({error:{code:'billing_unavailable',message:'Payments are temporarily unavailable. Please try again.'}},503);}
  };
}
