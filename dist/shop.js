import {mountDeviceViewer} from './device-viewer.js';
import {installSwipeDismiss} from './settings-gestures.js';
import {checkoutDestination} from './billing.js';
import {openDemoCheckout} from './demo-checkout.js';

const productId='pawprint-one';
const canBuy=account=>Boolean(account?.id&&account.demo!==true&&account.isTest!==true);
const accountKey=account=>`${account?.id||'guest'}:${account?.isTest===true?'test':account?.demo===true?'demo':'owner'}`;
const orderStatuses=new Set(['pending','paid','failed','expired','refunded','partially_refunded','disputed']);
const currencies=new Set(['cny','gbp','usd','eur','cad','aud','hkd','sgd']);
const errors=new Set(['authentication_required','test_account','payment_setup_required','product_unavailable','shipping_not_configured','checkout_in_progress','checkout_reconciliation_required','provider_unavailable','invalid_request','rate_limited']);
const empty=()=>({loaded:false,loading:false,busy:false,error:'',ordersError:'',mode:'unconfigured',products:[],shipping:null,orders:[],returnIntent:null,canBuy:false});
const cleanPrice=price=>Number.isSafeInteger(price?.amount)&&price.amount>0&&price.amount<100000000000&&typeof price.currency==='string'&&currencies.has(price.currency.toLowerCase())?{amount:price.amount,currency:price.currency.toLowerCase()}:null;

export function consumeShopReturn(value){
  const url=new URL(value),marker=url.searchParams.get('order');
  const intent=['success','cancelled'].includes(marker)?marker:null;
  if(intent)url.searchParams.delete('order');
  return {intent,cleanURL:url.href};
}

export function formatShopPrice(price,language='en'){
  const checked=cleanPrice(price);if(!checked)return null;
  try{
    const formatter=new Intl.NumberFormat(language==='zh'?'zh-CN':'en-GB',{style:'currency',currency:checked.currency.toUpperCase()});
    return formatter.format(checked.amount/100);
  }catch{return null;}
}

function catalogState(value={}){
  const mode=['live','test'].includes(value.mode)?value.mode:'unconfigured';
  const product=Array.isArray(value.products)?value.products.find(item=>item?.id===productId):null;
  const price=cleanPrice(product?.price);
  const shipping=Number.isSafeInteger(value.shipping?.amount)&&value.shipping.amount>=0&&value.shipping.amount<100000000000&&value.shipping.currency===price?.currency&&Array.isArray(value.shipping.countries)&&value.shipping.countries.length?{amount:value.shipping.amount,currency:value.shipping.currency,countries:value.shipping.countries.filter(item=>typeof item==='string'&&/^[A-Z]{2}$/.test(item))}:null;
  return {mode,shipping,products:[{id:productId,name:'Pawprint One',price,available:mode!=='unconfigured'&&product?.available===true&&!!price&&!!shipping?.countries.length,reason:typeof product?.reason==='string'?product.reason:null}]};
}
function cleanOrders(value){
  return Array.isArray(value)?value.filter(item=>item?.productId===productId&&typeof item.id==='string'&&orderStatuses.has(item.status)&&cleanPrice(item)).slice(0,20).map(item=>({id:item.id.slice(0,120),productId,quantity:1,amount:item.amount,currency:item.currency.toLowerCase(),status:item.status,createdAt:typeof item.createdAt==='string'&&Number.isFinite(Date.parse(item.createdAt))?item.createdAt:null,paidAt:typeof item.paidAt==='string'&&Number.isFinite(Date.parse(item.paidAt))?item.paidAt:null})):[];
}

export function createShop({getAccount=()=>null,fetchImpl=(...args)=>fetch(...args),navigate=url=>window.location.assign(url),onChange=()=>{}}={}){
  let identity=accountKey(getAccount()),epoch=0,state=empty(),loadingPromise=null;
  function sync(){const next=accountKey(getAccount());if(next!==identity){identity=next;epoch++;state=empty();loadingPromise=null;}state.canBuy=canBuy(getAccount());return identity;}
  function getState(){sync();return {...state,shipping:state.shipping?{...state.shipping,countries:[...state.shipping.countries]}:null,products:state.products.map(item=>({...item,price:item.price?{...item.price}:null})),orders:state.orders.map(item=>({...item}))};}
  function emit(){onChange(getState());}
  async function request(path,body){
    const response=await fetchImpl(`/api/shop/${path}`,{method:body?'POST':'GET',credentials:'same-origin',cache:'no-store',...(body?{headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{})});
    const value=await response.json().catch(()=>({}));
    if(!response.ok){const code=value.error?.code||value.code;throw Object.assign(new Error('Shop request failed'),{code:errors.has(code)?code:response.status===401?'authentication_required':'provider_unavailable'});}
    return value;
  }
  async function load({returnIntent}={}){
    sync();if(['success','cancelled'].includes(returnIntent))state.returnIntent=returnIntent;
    if(loadingPromise)return loadingPromise;
    const id=identity,run=epoch,account=getAccount();
    state={...state,loading:true,error:'',ordersError:''};
    loadingPromise=(async()=>{
      const [catalog,orders]=await Promise.allSettled([request('catalog'),canBuy(account)?request('orders'):Promise.resolve({orders:[]})]);
      sync();if(id!==identity||run!==epoch)return null;
      if(catalog.status==='fulfilled')state={...state,...catalogState(catalog.value)};
      else state={...state,error:catalog.reason.code||'provider_unavailable',products:state.products.map(item=>({...item,available:false}))};
      if(orders.status==='fulfilled')state.orders=cleanOrders(orders.value.orders);
      else state.ordersError=orders.reason.code||'provider_unavailable';
      state={...state,loading:false,loaded:true};loadingPromise=null;emit();return getState();
    })();
    emit();return loadingPromise;
  }
  async function checkout(locale='en'){
    sync();if(state.busy)return false;
    const account=getAccount(),id=identity,run=epoch;
    if(!canBuy(account)){state.error=account?.isTest?'test_account':'authentication_required';emit();return false;}
    if(!state.products.find(item=>item.id===productId)?.available){state.error='product_unavailable';emit();return false;}
    state={...state,busy:true,error:''};emit();
    try{
      const result=await request('checkout',{productId,quantity:1,locale:locale==='zh'?'zh':'en'});
      sync();if(id!==identity||run!==epoch)return false;
      const url=checkoutDestination(result.url);
      if(!url)throw Object.assign(new Error('Unsafe checkout URL'),{code:'provider_unavailable'});
      navigate(url);return true;
    }catch(error){sync();if(id!==identity||run!==epoch)return false;state={...state,busy:false,error:error.code||'provider_unavailable'};emit();return false;}
  }
  function reset(){epoch++;identity=accountKey(getAccount());state=empty();loadingPromise=null;}
  return {getState,load,checkout,reset};
}

const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const icon=name=>`<svg class="icon" aria-hidden="true"><use href="#i-${name}"/></svg>`;
const copy={
 en:{shop:'Shop',close:'Back to app',eyebrow:'PAWPRINT HARDWARE',tagline:'A closer look at their everyday.',description:'The device that connects to your Pawprint app.',model:'Product concept · drag to rotate',heart:'Heart rate',temp:'Skin temperature',activity:'Activity',sleep:'Estimated sleep',priceSoon:'Price coming soon',once:'One-time purchase',buy:'Buy Pawprint One',opening:'Opening checkout…',loading:'Loading shop…',unavailable:'This product is not available to order yet.',test:'Browse here, then use your own account to purchase. Test accounts cannot be charged.',signin:'Sign in to your own account to purchase.',secure:'Choose your payment method and delivery address at secure Stripe checkout.',separate:'Hardware purchase · separate from your subscription',shipping:'Delivery',freeShipping:'Included',shippingNote:'Choose an available delivery destination at checkout.',testMode:'Test checkout · no real charge',orders:'Your orders',paid:'Payment confirmed',pending:'Awaiting payment',failed:'Payment unsuccessful',expired:'Checkout expired',refunded:'Refunded',partially_refunded:'Partially refunded',disputed:'Payment under review',check:'Check again',checking:'Checking your order…',returnPending:'No payment confirmed yet. Check again in a moment.',returnOrders:'Check your order status below.',cancelled:'Checkout closed. You can buy whenever you’re ready.',orderError:'Couldn’t check your orders. Please try again.',error:'Couldn’t load the shop. Please try again.',authentication_required:'Please sign in to your own account to purchase.',test_account:'Test accounts cannot be charged. Please use your own account.',payment_setup_required:'Purchases aren’t available yet.',product_unavailable:'This product is not available to order yet.',shipping_not_configured:'Delivery options aren’t ready yet.',checkout_in_progress:'Checkout is already opening. Please try again in a moment.',checkout_reconciliation_required:'Your earlier checkout needs confirmation. Please contact support before trying again.',provider_unavailable:'The payment service is unavailable. Please try again.',invalid_request:'Couldn’t start checkout. Please try again.',rate_limited:'Please wait a moment and try again.'},
 zh:{shop:'商店',close:'返回首页',eyebrow:'PAWPRINT 硬件',tagline:'更了解它的每一天。',description:'与 Pawprint App 连接的宠物监测设备。',model:'产品概念模型 · 拖动旋转',heart:'心率',temp:'皮肤温度',activity:'活动量',sleep:'估计睡眠',priceSoon:'售价即将公布',once:'一次性购买',buy:'购买 Pawprint One',opening:'正在打开结账页…',loading:'正在加载商店…',unavailable:'此产品暂未开放下单。',test:'可以先浏览商品，购买时请使用自己的账号。测试账号不会产生费用。',signin:'登录自己的账号后可购买。',secure:'在 Stripe 安全结账页选择付款方式并填写收货地址。',separate:'硬件购买 · 与订阅分开',shipping:'配送费',freeShipping:'已包含',shippingNote:'在结账页选择可配送的目的地。',testMode:'测试结账 · 不会真实扣款',orders:'我的订单',paid:'付款已确认',pending:'等待付款',failed:'付款未成功',expired:'结账已过期',refunded:'已退款',partially_refunded:'部分退款',disputed:'付款审核中',check:'重新查询',checking:'正在查询订单…',returnPending:'暂未确认付款，请稍后重新查询。',returnOrders:'请查看下方订单状态。',cancelled:'已关闭结账页，可稍后再购买。',orderError:'无法查询订单，请重试。',error:'无法加载商店，请重试。',authentication_required:'请登录自己的账号后购买。',test_account:'测试账号不会产生费用，请使用自己的账号购买。',payment_setup_required:'购买功能暂未开放。',product_unavailable:'此产品暂未开放下单。',shipping_not_configured:'配送选项尚未准备好。',checkout_in_progress:'正在打开结账页，请稍后再试。',checkout_reconciliation_required:'此前的结账需要核实，请联系支持后再尝试购买。',provider_unavailable:'付款服务暂不可用，请重试。',invalid_request:'无法打开结账页，请重试。',rate_limited:'请稍后重试。'}
};

export function shopContent(state={}, {language='en',account=null}={}){
  const zh=language==='zh',t=copy[zh?'zh':'en'],product=state.products?.find(item=>item.id===productId),price=formatShopPrice(product?.price,language);
  const enabled=Boolean(state.loaded&&!state.error&&!state.loading&&!state.busy&&state.canBuy&&product?.available&&price);
  const note=state.error?t[state.error]||t.error:state.loading?t.loading:!product?.available?t.unavailable:account?.isTest?t.test:!canBuy(account)?t.signin:t.secure;
  const orders=state.orders||[];
  const shipping=state.shipping&&Number.isSafeInteger(state.shipping.amount)&&state.shipping.amount>=0?(state.shipping.amount===0?t.freeShipping:formatShopPrice(state.shipping,language)):null;
  const date=value=>value?new Intl.DateTimeFormat(zh?'zh-CN':'en-GB',{dateStyle:'medium'}).format(new Date(value)):'';
  const returnNote=state.returnIntent==='cancelled'?t.cancelled:state.returnIntent==='success'?(state.loading?t.checking:orders.length?t.returnOrders:t.returnPending):'';
  return `<header class="shop-topbar"><span aria-hidden="true"></span><h1>${t.shop}</h1><button type="button" class="round-button glass" data-shop-close aria-label="${t.close}">${icon('close')}</button></header>
  <div class="shop-scroll"><section class="shop-product" aria-labelledby="shop-product-title"><div class="shop-brand">${t.eyebrow}</div><h2 id="shop-product-title">Pawprint One</h2><p class="shop-tagline">${t.tagline}</p><div class="shop-model-stage"><div class="shop-model" data-shop-model data-no-settings-swipe></div><p class="shop-model-caption">${icon('refresh')}${t.model}</p></div><p class="shop-description">${t.description}</p><div class="shop-features" aria-label="${zh?'监测项目':'Monitoring'}">${[['heart','heart'],['temp','temp'],['steps','activity'],['moon','sleep']].map(([symbol,label])=>`<span>${icon(symbol)}<small>${t[label]}</small></span>`).join('')}</div>
  <section class="shop-purchase glass" aria-label="${zh?'购买设备':'Buy device'}"><div class="shop-price-row"><strong class="shop-price${price?'':' is-pending'}">${esc(price||t.priceSoon)}</strong>${price?`<span>${t.once}</span>`:''}</div>${shipping?`<div class="shop-delivery-row"><span>${t.shipping}</span><strong>${esc(shipping)}</strong></div>`:''}<button class="button glass shop-buy" type="button" data-shop-buy ${enabled?'':'disabled'}>${state.busy?t.opening:t.buy}${icon('arrow-right')}</button><p class="shop-feedback${state.error?' is-error':''}" role="status">${esc(note)}</p>${state.mode==='test'?`<p class="shop-test-mode">${t.testMode}</p>`:''}<div class="shop-purchase-caption">${t.separate}</div>${product?.available?`<p class="shop-shipping">${t.shippingNote}</p>`:''}</section></section>
  ${returnNote?`<section class="shop-return-note" role="status"><p>${esc(returnNote)}</p><button class="text-button" type="button" data-shop-refresh ${state.loading?'disabled':''}>${t.check}${icon('refresh')}</button></section>`:''}
  ${orders.length?`<section class="shop-orders"><h2>${t.orders}</h2>${orders.map(order=>`<article class="shop-order glass"><div><h3>Pawprint One</h3><span class="shop-order-state is-${esc(order.status)}">${t[order.status]||t.pending}</span></div><p><span>${esc(date(order.createdAt))}</span><strong>${esc(formatShopPrice(order,language)||'')}</strong></p><small>#${esc(order.id.slice(-10))}</small></article>`).join('')}</section>`:''}
  ${state.error||state.ordersError?`<p class="shop-orders-error" role="status">${state.ordersError?t.orderError:''}<button class="text-button" type="button" data-shop-refresh ${state.loading?'disabled':''}>${t.check}${icon('refresh')}</button></p>`:''}</div>`;
}

// The public shopping experience is deliberately simulated. The legacy server
// client above is retained for reading old payment returns, never for these CTAs.
export const demoShopProducts=Object.freeze([{id:productId,name:'Pawprint One',amount:35000,currency:'cny'}]);
const catalogCopy={
 en:{products:'Our products',count:'1 product',intro:'Thoughtful hardware for their everyday.',category:'Pet health monitor',view:'View Pawprint One',details:'Product details',back:'Back to products',demo:'Demo checkout · no real charge',checkout:'Choose a payment method and address at checkout.',orders:'Demo orders',placed:'Order Placed',demoOrder:'Demo order · no charge or delivery',legacy:'Previous payment status',none:'No payment has been confirmed.',cancelled:'Checkout was closed. No new payment is confirmed.',once:'One-time purchase'},
 zh:{products:'我们的产品',count:'1 件商品',intro:'为它的日常而设计的硬件。',category:'宠物健康监测设备',view:'查看 Pawprint One',details:'商品详情',back:'返回商品列表',demo:'模拟结账 · 不会真实扣款',checkout:'在结账页选择付款方式并填写地址。',orders:'模拟订单',placed:'Order Placed · 已下单',demoOrder:'模拟订单 · 不会扣款或发货',legacy:'此前的付款状态',none:'暂未确认付款。',cancelled:'已关闭结账页，未确认新的付款。',once:'一次性购买'}
};
const productThumbnail=()=>`<svg class="shop-product-thumbnail" viewBox="0 0 240 150" aria-hidden="true"><ellipse cx="121" cy="125" rx="79" ry="8" fill="#647380" opacity=".13"/><g transform="translate(3 -1) rotate(-7 120 75)"><rect x="21" y="47" width="43" height="63" rx="14" fill="#303b42"/><rect x="32" y="58" width="19" height="41" rx="5" fill="#b8c0c6"/><rect x="177" y="47" width="43" height="63" rx="14" fill="#303b42"/><rect x="190" y="58" width="19" height="41" rx="5" fill="#b8c0c6"/><rect x="54" y="33" width="133" height="91" rx="29" fill="#89959e"/><rect x="54" y="28" width="133" height="91" rx="29" fill="#d0d6da" stroke="#a1acb5" stroke-width="2"/><path d="M79 34h83" fill="none" stroke="#eff3f5" stroke-width="3" stroke-linecap="round"/><rect x="73" y="52" width="96" height="45" rx="16" fill="#62717b"/><rect x="76" y="55" width="90" height="39" rx="13" fill="#1c2a32"/><path d="M88 59h58" fill="none" stroke="#83949e" stroke-width="1.5" stroke-linecap="round"/><path d="M111 70v10m11-10v10m11-10v10" stroke="#b4c6cd" stroke-width="3" stroke-linecap="round"/><circle cx="169" cy="45" r="3.6" fill="#a6b3ba" stroke="#7f8d96" stroke-width="1"/></g></svg>`;

export function createDemoShopState({getAccount=()=>null}={}){
 let identity=accountKey(getAccount()),view='catalog',orders=[];
 function sync(){const next=accountKey(getAccount());if(next!==identity){identity=next;view='catalog';orders=[];}return identity;}
 function getState(){sync();return {identity,view,orders:orders.map(order=>({...order}))};}
 function selectProduct(id){sync();view=id===productId?'detail':'catalog';return getState();}
 function complete(receipt,expectedIdentity=identity){sync();if(identity!==expectedIdentity||receipt?.mode!=='demo'||receipt.product!==productId||receipt.amount!==35000||receipt.currency?.toLowerCase()!=='cny'||typeof receipt.id!=='string'||!Number.isFinite(Date.parse(receipt.createdAt)))return false;
  if(orders.some(order=>order.id===receipt.id))return false;
  orders=[{id:receipt.id.slice(0,100),product:productId,amount:35000,currency:'cny',createdAt:receipt.createdAt,mode:'demo'},...orders].slice(0,10);return true;
 }
 function reset(){identity=accountKey(getAccount());view='catalog';orders=[];}
 return {getState,selectProduct,complete,reset};
}

export function demoShopContent(state={}, {language='en',legacyState=null}={}){
 const zh=language==='zh',t=copy[zh?'zh':'en'],c=catalogCopy[zh?'zh':'en'],detail=state.view==='detail';
 const price=zh?'¥350':'CN¥350';
 const orderHTML=state.orders?.length?`<section class="shop-orders shop-demo-orders" aria-labelledby="shop-demo-orders-title"><h2 id="shop-demo-orders-title">${c.orders}</h2>${state.orders.map(order=>`<article class="shop-order glass"><div><h3>Pawprint One</h3><span class="shop-order-state is-paid">${c.placed}</span></div><p><span>${c.demoOrder}</span><strong>${price}</strong></p><small>#${esc(order.id.slice(-10))}</small></article>`).join('')}</section>`:'';
 const legacyHTML=legacyState?.returnIntent?`<section class="shop-return-note" role="status"><p>${c.legacy}</p>${legacyState.loading?`<p>${t.checking}</p>`:legacyState.orders?.length?legacyState.orders.map(order=>`<p>${t[order.status]||t.pending} · ${esc(formatShopPrice(order,language)||'')}</p>`).join(''):`<p>${legacyState.returnIntent==='cancelled'?c.cancelled:c.none}</p>`}</section>`:'';
 const header=`<header class="shop-topbar">${detail?`<button type="button" class="round-button glass shop-detail-back" data-shop-products aria-label="${c.back}">${icon('arrow-right')}</button>`:'<span aria-hidden="true"></span>'}<h1>${detail?c.details:t.shop}</h1><button type="button" class="round-button glass" data-shop-close aria-label="${t.close}">${icon('close')}</button></header>`;
 if(!detail)return `${header}<div class="shop-scroll shop-catalog-scroll"><section class="shop-catalog" aria-labelledby="shop-catalog-title"><div class="shop-catalog-heading"><h2 id="shop-catalog-title">${c.products}</h2><span>${c.count}</span></div><p class="shop-catalog-intro">${c.intro}</p><div class="shop-product-grid">${demoShopProducts.map(product=>`<button type="button" class="shop-product-card glass" data-shop-product="${product.id}" aria-label="${c.view} · ${price}"><span class="shop-card-visual">${productThumbnail()}</span><span class="shop-card-name">${product.name}</span><span class="shop-card-category">${c.category}</span><span class="shop-card-bottom"><strong>${price}</strong><span class="shop-card-arrow">${icon('arrow-right')}</span></span></button>`).join('')}</div></section>${orderHTML}${legacyHTML}</div>`;
 return `${header}<div class="shop-scroll shop-detail-scroll"><section class="shop-product" aria-labelledby="shop-product-title"><div class="shop-brand">${t.eyebrow}</div><h2 id="shop-product-title">Pawprint One</h2><p class="shop-tagline">${t.tagline}</p><div class="shop-model-stage"><div class="shop-model" data-shop-model data-no-settings-swipe></div><p class="shop-model-caption">${icon('refresh')}${t.model}</p></div><p class="shop-description">${t.description}</p><div class="shop-features" aria-label="${zh?'监测项目':'Monitoring'}">${[['heart','heart'],['temp','temp'],['steps','activity'],['moon','sleep']].map(([symbol,label])=>`<span>${icon(symbol)}<small>${t[label]}</small></span>`).join('')}</div><section class="shop-purchase glass" aria-label="${zh?'购买设备':'Buy device'}"><div class="shop-price-row"><strong class="shop-price">${price}</strong><span>${c.once}</span></div><p class="shop-demo-caption">${c.demo}</p><button class="button glass shop-buy" type="button" data-shop-buy>${t.buy}${icon('arrow-right')}</button><p class="shop-feedback">${c.checkout}</p><div class="shop-purchase-caption">${t.separate}</div></section></section></div>`;
}

export function initShop(root,{getAccount=()=>null,getLanguage=()=> 'en',onClose=()=>{}}={}){
 let viewer=null,checkout=null,epoch=0,legacyVisible=false;
 const demo=createDemoShopState({getAccount});
 const legacy=createShop({getAccount,onChange:()=>{if(!root.hidden&&legacyVisible)render();}});
 function clearCheckout(){const current=checkout;checkout=null;current?.close();}
 function render({keepScroll=true}={}){
  const scroll=keepScroll?(root.querySelector('.shop-scroll')?.scrollTop||0):0;
  viewer?.destroy();viewer=null;
  root.classList.add('shop-screen');root.dataset.view=demo.getState().view;
  root.innerHTML=demoShopContent(demo.getState(),{language:getLanguage(),legacyState:legacyVisible?legacy.getState():null});
  root.querySelector('[data-shop-close]').addEventListener('click',()=>close());
  root.querySelector('[data-shop-products]')?.addEventListener('click',backToProducts);
  root.querySelectorAll('[data-shop-product]').forEach(button=>button.addEventListener('click',()=>{
   demo.selectProduct(button.dataset.shopProduct);render({keepScroll:false});root.querySelector('[data-shop-products]')?.focus({preventScroll:true});
  }));
  root.querySelector('[data-shop-buy]')?.addEventListener('click',buy);
  root.querySelector('.shop-scroll').scrollTop=scroll;
  if(!root.hidden&&root.querySelector('[data-shop-model]'))viewer=mountDeviceViewer(root.querySelector('[data-shop-model]'),{language:getLanguage()});
 }
 function backToProducts(){clearCheckout();demo.selectProduct(null);render({keepScroll:false});root.querySelector('[data-shop-product]')?.focus({preventScroll:true});}
 function buy(){
  if(checkout||root.hidden)return;
  const identity=demo.getState().identity,run=epoch;
  checkout=openDemoCheckout({product:productId,language:getLanguage(),onComplete(receipt){
   if(run!==epoch||root.hidden)return;
   if(demo.complete(receipt,identity))render();
  },onClose(){checkout=null;if(!root.hidden&&run===epoch){render();root.querySelector('[data-shop-buy]')?.focus({preventScroll:true});}}});
 }
 function open(){epoch++;clearCheckout();demo.selectProduct(null);legacyVisible=false;root.hidden=false;render({keepScroll:false});root.querySelector('[data-shop-close]').focus({preventScroll:true});}
 function close(callOnClose=true){epoch++;clearCheckout();root.hidden=true;viewer?.destroy();viewer=null;legacy.reset();legacyVisible=false;if(callOnClose)onClose();}
 function acceptReturn(intent){if(['success','cancelled'].includes(intent)){legacyVisible=true;legacy.load({returnIntent:intent});}}
 function onKey(event){if(root.hidden||checkout||event.key!=='Escape')return;event.preventDefault();event.stopPropagation();demo.getState().view==='detail'?backToProducts():close();}
 const removeGesture=installSwipeDismiss(root,{isEnabled:()=>!root.hidden&&!checkout,onDismiss:()=>demo.getState().view==='detail'?backToProducts():close(),directions:['right']});
 const win=root.ownerDocument?.defaultView||window;
 function onPageShow(event){if(event.persisted&&!root.hidden){reset();render({keepScroll:false});}}
 win.addEventListener('pageshow',onPageShow);root.addEventListener('keydown',onKey);root.hidden=true;
 function reset(){epoch++;clearCheckout();demo.reset();legacy.reset();legacyVisible=false;}
 function destroy(){close(false);reset();removeGesture();root.removeEventListener('keydown',onKey);win.removeEventListener('pageshow',onPageShow);}
 return {open,close,render,acceptReturn,destroy,reset};
}
