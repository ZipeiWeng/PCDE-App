// One-time hardware purchases. Prices, delivery and paid state are server owned.
// Stripe hosts all payment and shipping fields; no card/address data is retained.
const SHOP_VERSION='2026-10-28.endive';
const SHOP_PRODUCT='pawprint-one',SHOP_LOCK_MS=120000;
const shopCurrencies=new Set(['cny','gbp','usd','eur','cad','aud','hkd','sgd']);
const shopId=(value,prefix)=>typeof value==='string'&&new RegExp(`^${prefix}_[A-Za-z0-9_-]{1,190}$`).test(value);
const shopObjectId=value=>typeof value==='string'?value:value?.id;
class ShopError extends Error {constructor(status,code,message){super(message);this.status=status;this.code=code;}}
const shopSetup=code=>new ShopError(503,code||'payment_setup_required','This product is not available to purchase yet.');
const shopProvider=()=>new ShopError(502,'provider_unavailable','Checkout is temporarily unavailable. Please try again.');
const shopJSON=(value,status=200,headers={})=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...headers}});
function shopConfig(env){
 const secret=typeof env.STRIPE_SECRET_KEY==='string'?env.STRIPE_SECRET_KEY.trim():'';
 const mode=/^(?:sk|rk)_live_/.test(secret)?'live':/^(?:sk|rk)_test_/.test(secret)?'test':'unconfigured';
 const price=String(env.STRIPE_PRICE_PAWPRINT_ONE||'').trim(),shippingRate=String(env.STRIPE_SHIPPING_RATE||'').trim();
 const countries=String(env.STRIPE_SHIPPING_COUNTRIES||'').split(',').map(value=>value.trim().toUpperCase()).filter(Boolean);
 const unsupported=new Set(['AS','CX','CC','CU','HM','IR','KP','MH','FM','NF','MP','PW','SD','SY','UM','VI']);
 const validCountries=countries.length>0&&countries.length<=30&&new Set(countries).size===countries.length&&countries.every(value=>/^[A-Z]{2}$/.test(value)&&!unsupported.has(value));
 return {secret,mode,price,shippingRate,countries:validCountries?countries:[],ready:mode!=='unconfigured'&&String(env.STRIPE_WEBHOOK_SECRET||'').startsWith('whsec_')};
}
async function shopRaw(request,max=1048576){
 const length=request.headers.get('content-length');if(length!==null&&(!/^\d+$/.test(length)||Number(length)>max))throw new ShopError(413,'payload_too_large','This request is too large.');
 const reader=request.body?.getReader(),chunks=[];let size=0;
 if(reader)try{while(true){const value=await reader.read();if(value.done)break;size+=value.value.length;if(size>max){await reader.cancel();throw new ShopError(413,'payload_too_large','This request is too large.');}chunks.push(value.value);}}finally{reader.releaseLock();}
 const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}return bytes;
}
function shopParse(bytes){try{const value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));if(!value||typeof value!=='object'||Array.isArray(value))throw Error();return value;}catch{throw new ShopError(400,'invalid_request','Send a valid JSON object.');}}
async function shopStripe(config,fetchImpl,path,{method='GET',data,idempotency}={}){
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),12000);
 const headers={Authorization:`Bearer ${config.secret}`,'Stripe-Version':SHOP_VERSION,...(data?{'Content-Type':'application/x-www-form-urlencoded'}:{}),...(idempotency?{'Idempotency-Key':idempotency}:{})};
 try{const response=await fetchImpl('https://api.stripe.com/v1'+path,{method,headers,body:data?new URLSearchParams(data).toString():undefined,signal:controller.signal,redirect:'error'});if(!response.ok)throw shopProvider();return shopParse(await shopRaw(response));}catch{throw shopProvider();}finally{clearTimeout(timer);}
}
function shopRedirect(value){try{const url=new URL(value);if(url.protocol==='https:'&&url.hostname==='checkout.stripe.com'&&!url.port&&!url.username&&!url.password)return url.href;}catch{}throw shopProvider();}
async function shopCatalog(config,fetchImpl){
 let reason=null,price=null,shipping=null;
 if(!config.ready)reason='payment_setup_required';
 else if(!shopId(config.price,'price'))reason='price_not_configured';
 else{
  const value=await shopStripe(config,fetchImpl,`/prices/${encodeURIComponent(config.price)}`);
  if(value.id!==config.price||!value.active||value.livemode!==(config.mode==='live')||value.type!=='one_time'||value.recurring||value.billing_scheme!=='per_unit'||!Number.isSafeInteger(value.unit_amount)||value.unit_amount<=0||value.unit_amount>100000000||!shopCurrencies.has(value.currency)||value.custom_unit_amount||value.transform_quantity)reason='price_not_configured';
  else price={amount:value.unit_amount,currency:value.currency};
  if(price){
   if(!config.countries.length||!shopId(config.shippingRate,'shr'))reason='shipping_not_configured';
   else{const rate=await shopStripe(config,fetchImpl,`/shipping_rates/${encodeURIComponent(config.shippingRate)}`);
    if(rate.id!==config.shippingRate||!rate.active||rate.livemode!==(config.mode==='live')||rate.type!=='fixed_amount'||rate.fixed_amount?.currency!==price.currency||!Number.isSafeInteger(rate.fixed_amount?.amount)||rate.fixed_amount.amount<0||rate.fixed_amount.amount>100000000)reason='shipping_not_configured';
    else shipping={amount:rate.fixed_amount.amount,currency:price.currency,countries:config.countries};
   }
  }
 }
 return {mode:config.ready?config.mode:'unconfigured',products:[{id:SHOP_PRODUCT,name:'Pawprint One',price,available:!reason,reason}],shipping};
}
async function shopPrincipal(request,env,getAccountId,now){
 if(!env.AUTH_DB?.prepare||!env.AUTH_DB?.batch)throw new ShopError(503,'storage_unavailable','Orders are temporarily unavailable.');
 const id=await getAccountId(request,env,now);if(!id||typeof id!=='string'||id.length>200)throw new ShopError(401,'authentication_required','Log in to buy a Pawprint device.');
 const account=await env.AUTH_DB.prepare('SELECT id FROM auth_accounts WHERE id=?').bind(id).first();if(account)return account;
 if(await env.AUTH_DB.prepare('SELECT id FROM auth_test_sessions WHERE id=? AND expires_at>?').bind(id,now).first())throw new ShopError(403,'test_account','Use your personal account to make a purchase.');
 throw new ShopError(401,'authentication_required','Log in to buy a Pawprint device.');
}
async function shopLimit(db,id,now){const row=await db.prepare('INSERT INTO auth_limits(bucket_key,count,expires_at) VALUES(?,1,?) ON CONFLICT(bucket_key) DO UPDATE SET count=count+1 RETURNING count').bind(`shop:${id}:${Math.floor(now/60000)}`,now+120000).first();if(row.count>20)throw new ShopError(429,'rate_limited','Please wait a moment before trying again.');}
async function shopLock(db,id,mode,now){
 const token=crypto.randomUUID();await db.prepare('INSERT INTO shop_accounts(account_id,mode) VALUES(?,?) ON CONFLICT(account_id,mode) DO NOTHING').bind(id,mode).run();
 const result=await db.prepare('UPDATE shop_accounts SET lock_token=?,lock_until=? WHERE account_id=? AND mode=? AND lock_until<=?').bind(token,now+SHOP_LOCK_MS,id,mode,now).run();return Number(result.meta?.changes)?token:null;
}
const shopUnlock=(db,id,mode,token)=>db.prepare('UPDATE shop_accounts SET lock_token=NULL,lock_until=0 WHERE account_id=? AND mode=? AND lock_token=?').bind(id,mode,token).run();
const shopOrder=(db,id)=>db.prepare('SELECT * FROM shop_orders WHERE id=?').bind(id).first();
function shopBound(session,row){return session&&session.mode==='payment'&&session.livemode===(row.mode==='live')&&session.client_reference_id===row.account_id&&session.metadata?.pawprint_order_id===row.id&&session.metadata?.pawprint_account_id===row.account_id&&session.metadata?.pawprint_product===row.product_id&&(!row.checkout_session_id||session.id===row.checkout_session_id);}
async function shopRefresh(db,row,config,fetchImpl,now,token){
 if(!row.checkout_session_id)return row;
 const session=await shopStripe(config,fetchImpl,`/checkout/sessions/${encodeURIComponent(row.checkout_session_id)}?expand[]=line_items&expand[]=payment_intent.latest_charge`);
 if(!shopBound(session,row))throw shopProvider();
 const items=session.line_items;
 if(!items||items.has_more||!Array.isArray(items.data)||items.data.length!==1||shopObjectId(items.data[0].price)!==row.price_id||items.data[0].quantity!==1||items.data[0].currency!==row.currency||items.data[0].amount_subtotal!==row.unit_amount)throw shopProvider();
 const expected=row.unit_amount+row.shipping_amount;
 if(session.currency!==row.currency||session.amount_subtotal!==row.unit_amount)throw shopProvider();
 // Checkout can be open before a shipping address/rate has been selected.
 if(session.status==='complete'&&(session.amount_total!==expected||shopObjectId(session.shipping_cost?.shipping_rate)!==row.shipping_rate_id||session.shipping_cost?.amount_total!==row.shipping_amount))throw shopProvider();
 let payment=session.payment_intent;if(typeof payment==='string')payment=await shopStripe(config,fetchImpl,`/payment_intents/${encodeURIComponent(payment)}?expand[]=latest_charge`);
 let status=session.status==='expired'?'expired':'pending',paidAt=row.paid_at,refunded=0,paymentId=shopObjectId(payment)||null;
 if(payment){
  if(!shopId(payment.id,'pi')||payment.livemode!==(row.mode==='live')||payment.metadata?.pawprint_order_id!==row.id||payment.metadata?.pawprint_account_id!==row.account_id||payment.amount!==expected||payment.currency!==row.currency)throw shopProvider();
  if(payment.status==='canceled'||session.status==='complete'&&payment.status==='requires_payment_method')status='failed';
  let charge=payment.latest_charge;if(typeof charge==='string')charge=await shopStripe(config,fetchImpl,`/charges/${encodeURIComponent(charge)}`);
  if(session.status==='complete'&&session.payment_status==='paid'&&payment.status==='succeeded'&&payment.amount_received===expected){
   if(!JSON.parse(row.shipping_countries).includes(session.collected_information?.shipping_details?.address?.country))throw shopProvider();
   if(!charge||shopObjectId(charge.payment_intent)!==payment.id||charge.livemode!==(row.mode==='live')||charge.amount!==expected||charge.currency!==row.currency||!charge.paid)throw shopProvider();
   if(!Number.isSafeInteger(charge.amount_refunded)||charge.amount_refunded<0||charge.amount_refunded>expected)throw shopProvider();
   let disputed=charge.disputed===true;
   if(disputed){
    const disputes=await shopStripe(config,fetchImpl,`/disputes?charge=${encodeURIComponent(charge.id)}&limit=100`);
    if(disputes.has_more||!Array.isArray(disputes.data)||!disputes.data.length||disputes.data.some(value=>shopObjectId(value.charge)!==charge.id||value.livemode!==(row.mode==='live')))throw shopProvider();
    disputed=disputes.data.some(value=>!['won','warning_closed','prevented'].includes(value.status));
   }
   refunded=charge.amount_refunded;status=refunded===expected?'refunded':refunded?'partially_refunded':disputed?'disputed':'paid';paidAt=paidAt||now;
  }
 }
 const updated=await db.prepare('UPDATE shop_orders SET status=?,payment_intent_id=?,verified_at=?,paid_at=?,refunded_amount=? WHERE id=? AND EXISTS(SELECT 1 FROM shop_accounts WHERE account_id=? AND mode=? AND lock_token=?)').bind(status,paymentId,now,paidAt,refunded,row.id,row.account_id,row.mode,token).run();
 if(!Number(updated.meta?.changes))throw new ShopError(409,'checkout_in_progress','Order confirmation is busy.');
 return shopOrder(db,row.id);
}
async function shopCheckout(request,env,principal,config,fetchImpl,now,body,catalog){
 if(body.productId!==SHOP_PRODUCT||body.quantity!==1||(body.locale!==undefined&&!['en','zh'].includes(body.locale)))throw new ShopError(400,'invalid_request','Choose one Pawprint One device.');
 const db=env.AUTH_DB,token=await shopLock(db,principal.id,config.mode,now);if(!token)throw new ShopError(409,'checkout_in_progress','Your checkout is being prepared. Please try again shortly.');
 try{
  let row=await db.prepare("SELECT * FROM shop_orders WHERE account_id=? AND mode=? AND status='pending' ORDER BY created_at DESC LIMIT 1").bind(principal.id,config.mode).first();
  if(row?.checkout_session_id){
   row=await shopRefresh(db,row,config,fetchImpl,now,token);
   if(row.status==='pending'){
    const session=await shopStripe(config,fetchImpl,`/checkout/sessions/${encodeURIComponent(row.checkout_session_id)}`);
    if(!shopBound(session,row))throw shopProvider();
    if(session.status==='open'&&session.expires_at*1000>now)return {url:shopRedirect(session.url),mode:config.mode};
    throw new ShopError(409,'checkout_in_progress','Your payment is still being confirmed. Check your orders shortly.');
   }
   row=null;
  }
  // Never replay a create request outside Stripe's 24-hour idempotency window.
  // A missing response can hide a paid session; its webhook must reconcile it.
  if(row&&!row.checkout_session_id&&now-row.created_at>=23*3600000)throw new ShopError(409,'checkout_reconciliation_required','Your earlier checkout needs confirmation. Please contact support before trying again.');
  if(!row){
   const id='order_'+crypto.randomUUID().replaceAll('-',''),product=catalog.products[0],shipping=catalog.shipping;
   await db.prepare('INSERT INTO shop_orders(id,account_id,mode,product_id,price_id,shipping_rate_id,shipping_countries,quantity,unit_amount,shipping_amount,currency,checkout_origin,checkout_expires_at,created_at) VALUES(?,?,?,?,?,?,?,1,?,?,?,?,?,?)').bind(id,principal.id,config.mode,SHOP_PRODUCT,config.price,config.shippingRate,JSON.stringify(config.countries),product.price.amount,shipping.amount,product.price.currency,new URL(request.url).origin,now+25*3600000,now).run();
   row=await shopOrder(db,id);
  }
  // The durable order is the idempotency key, including after a lost response.
  // Omitting expires_at uses Stripe's fixed 24-hour default without retry drift.
  const data={mode:'payment',client_reference_id:row.account_id,'line_items[0][price]':row.price_id,'line_items[0][quantity]':'1','shipping_options[0][shipping_rate]':row.shipping_rate_id,
   'metadata[pawprint_order_id]':row.id,'metadata[pawprint_account_id]':row.account_id,'metadata[pawprint_product]':SHOP_PRODUCT,
   'payment_intent_data[metadata][pawprint_order_id]':row.id,'payment_intent_data[metadata][pawprint_account_id]':row.account_id,'payment_intent_data[metadata][pawprint_product]':SHOP_PRODUCT,
   success_url:row.checkout_origin+'/?order=success',cancel_url:row.checkout_origin+'/?order=cancelled',locale:'auto'};
  JSON.parse(row.shipping_countries).forEach((country,index)=>{data[`shipping_address_collection[allowed_countries][${index}]`]=country;});
  const session=await shopStripe(config,fetchImpl,'/checkout/sessions',{method:'POST',data,idempotency:`pawprint-shop-${row.id}`});
  if(!shopId(session.id,'cs')||!shopBound(session,row)||!Number.isFinite(session.expires_at)||session.status!=='open')throw shopProvider();
  const url=shopRedirect(session.url);
  const updated=await db.prepare('UPDATE shop_orders SET checkout_session_id=?,checkout_expires_at=? WHERE id=? AND EXISTS(SELECT 1 FROM shop_accounts WHERE account_id=? AND mode=? AND lock_token=?)').bind(session.id,session.expires_at*1000,row.id,principal.id,config.mode,token).run();
  if(!Number(updated.meta?.changes))throw new ShopError(409,'checkout_in_progress','Your checkout is being prepared. Please try again shortly.');
  if(session.expires_at*1000<=now)throw new ShopError(409,'checkout_in_progress','Your earlier checkout has expired. Please try again.');
  return {url,mode:config.mode};
 }finally{await shopUnlock(db,principal.id,config.mode,token);}
}
const shopOrderView=row=>({id:row.id,productId:row.product_id,quantity:row.quantity,amount:row.unit_amount+row.shipping_amount,currency:row.currency,status:row.status,createdAt:new Date(row.created_at).toISOString(),paidAt:row.paid_at?new Date(row.paid_at).toISOString():null,refundedAmount:row.refunded_amount,mode:row.mode});
export function createShopHandler({getAccountId=async()=>null,fetchImpl=(...args)=>fetch(...args),now=Date.now}={}){
 let cache=null;
 async function catalog(config){const key=JSON.stringify([config.secret,config.price,config.shippingRate,config.countries,config.ready]);const time=now();if(cache?.key===key&&cache.until>time)return cache.value;const value=await shopCatalog(config,fetchImpl);cache={key,value,until:time+60000};return value;}
 async function handle(request,env={}){
  try{
   const path=new URL(request.url).pathname,config=shopConfig(env),time=now();
   if(path==='/api/shop/catalog'&&request.method==='GET')return shopJSON(await catalog(config));
   if(!['/api/shop/catalog','/api/shop/checkout','/api/shop/orders'].includes(path))return shopJSON({error:{code:'not_found',message:'This endpoint does not exist.'}},404);
   if(path==='/api/shop/catalog'||path==='/api/shop/orders'&&request.method!=='GET'||path==='/api/shop/checkout'&&request.method!=='POST')return shopJSON({error:{code:'method_not_allowed',message:'This method is not supported.'}},405,{Allow:path==='/api/shop/checkout'?'POST':'GET'});
   const principal=await shopPrincipal(request,env,getAccountId,time),db=env.AUTH_DB;await shopLimit(db,principal.id,time);
   if(path==='/api/shop/orders'){
    if(config.ready){const token=await shopLock(db,principal.id,config.mode,time);if(!token)throw new ShopError(409,'checkout_in_progress','Orders are being updated. Try again shortly.');
     try{const rows=await db.prepare("SELECT * FROM shop_orders WHERE account_id=? AND mode=? AND checkout_session_id IS NOT NULL AND status IN ('pending','paid','partially_refunded','disputed') ORDER BY CASE WHEN status='pending' THEN 0 ELSE 1 END,created_at DESC LIMIT 2").bind(principal.id,config.mode).all();for(const row of rows.results)if(!row.verified_at||time-row.verified_at>10000)await shopRefresh(db,row,config,fetchImpl,time,token);}finally{await shopUnlock(db,principal.id,config.mode,token);}
    }
    const rows=await db.prepare('SELECT * FROM shop_orders WHERE account_id=? AND mode=? ORDER BY created_at DESC LIMIT 20').bind(principal.id,config.mode).all();return shopJSON({orders:rows.results.map(shopOrderView),mode:config.mode});
   }
   if(request.headers.get('origin')!==new URL(request.url).origin||['cross-site','none'].includes(request.headers.get('sec-fetch-site')))throw new ShopError(403,'origin_not_allowed','Open checkout from the Pawprint app.');
   if(!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type')||''))throw new ShopError(415,'json_required','Send this request as JSON.');
   const body=shopParse(await shopRaw(request,1024));if(Object.keys(body).some(key=>!['productId','quantity','locale'].includes(key)))throw new ShopError(400,'invalid_request','The checkout request contains unsupported fields.');
   const data=await catalog(config);if(!data.products[0].available)throw shopSetup(data.products[0].reason);
   return shopJSON(await shopCheckout(request,env,principal,config,fetchImpl,time,body,data));
  }catch(error){return shopJSON({error:{code:error instanceof ShopError?error.code:'request_failed',message:error instanceof ShopError?error.message:'Orders could not be updated. Please try again.'}},error instanceof ShopError?error.status:500);}
 }
 handle.handleVerifiedEvent=async(event,env)=>{
  // Called only AFTER the canonical billing endpoint verified the raw signature,
  // timestamp and mode. Event fields locate an order; provider reads decide state.
  const config=shopConfig(env),db=env.AUTH_DB,time=now();
  if(!config.ready||event.livemode!==(config.mode==='live'))return {handled:false};
  const object=event.data?.object;if(!object)return {handled:false};
  let row=null;
  if(event.type.startsWith('checkout.session.')&&object.mode==='payment'){
   if(object.metadata?.pawprint_product!==SHOP_PRODUCT)return {handled:false};
   row=await shopOrder(db,object.metadata?.pawprint_order_id||'');
   if(row&&!shopBound(object,row))throw shopProvider();
   if(row&&!row.checkout_session_id){
    // A webhook can arrive before the original create-session HTTP response.
    if(!shopId(object.id,'cs'))throw shopProvider();
    await db.prepare('UPDATE shop_orders SET checkout_session_id=? WHERE id=? AND checkout_session_id IS NULL').bind(object.id,row.id).run();row=await shopOrder(db,row.id);
   }
  }else if(event.type.startsWith('payment_intent.')){
   row=await db.prepare('SELECT * FROM shop_orders WHERE payment_intent_id=? AND mode=?').bind(object.id||'',config.mode).first();
  }else if(event.type.startsWith('charge.')||event.type.startsWith('refund.')){
   let paymentId=shopObjectId(object.payment_intent);
   if(!paymentId&&shopObjectId(object.charge)){const charge=await shopStripe(config,fetchImpl,`/charges/${encodeURIComponent(shopObjectId(object.charge))}`);paymentId=shopObjectId(charge.payment_intent);}
   if(paymentId)row=await db.prepare('SELECT * FROM shop_orders WHERE payment_intent_id=? AND mode=?').bind(paymentId,config.mode).first();
  }
  if(!row||row.mode!==config.mode)return {handled:false};
  if(await db.prepare('SELECT event_id FROM shop_events WHERE event_id=? AND mode=?').bind(event.id,config.mode).first())return {handled:true};
  const token=await shopLock(db,row.account_id,config.mode,time);if(!token)throw new ShopError(409,'checkout_in_progress','Order confirmation is busy.');
  try{await shopRefresh(db,row,config,fetchImpl,time,token);await db.prepare('INSERT INTO shop_events(event_id,mode,order_id,received_at) VALUES(?,?,?,?) ON CONFLICT(event_id,mode) DO NOTHING').bind(event.id,config.mode,row.id,time).run();}finally{await shopUnlock(db,row.account_id,config.mode,token);}
  return {handled:true};
 };
 return handle;
}
