// Billing state is always fetched from the authenticated server. Local plan
// preferences and checkout return parameters never establish paid access.
const emptyState = () => ({loaded:false,loading:false,busy:'',error:'',plan:'free',status:'none',canPurchase:false,canManage:false,mode:'unconfigured',reason:null,price:null,cancelAtPeriodEnd:false,currentPeriodEnd:null,returnIntent:null});
const accountKey = account => account?.id ? `${account.id}:${account.isTest===true?'test':account.demo===true?'demo':'account'}` : 'guest';
const supportedStatuses = new Set(['none','active','trialing','past_due','unpaid','canceled','incomplete','incomplete_expired','paused']);
const safeErrors = new Set(['payment_setup_required','test_account','authentication_required','checkout_in_progress','subscription_exists','provider_unavailable','invalid_request','rate_limited']);

export function checkoutDestination(value, kind='checkout') {
  try {
    const url=new URL(value);
    const host=kind==='portal'?'billing.stripe.com':'checkout.stripe.com';
    return url.protocol==='https:' && url.hostname===host && !url.port && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}

export function consumeBillingReturn(value) {
  const url=new URL(value),checkout=url.searchParams.get('checkout'),billing=url.searchParams.get('billing');
  const intent=['success','cancelled'].includes(checkout)?checkout:billing==='return'?'portal':null;
  if (intent) { url.searchParams.delete('checkout');url.searchParams.delete('billing'); }
  return {intent,cleanURL:url.href};
}

function serverState(value={}) {
  const status=supportedStatuses.has(value.status)?value.status:'none';
  const plan=value.plan==='plus'&&['active','trialing'].includes(status)?'plus':'free';
  const mode=['live','test'].includes(value.mode)?value.mode:'unconfigured';
  const price=value.price?.currency==='cny' && value.price?.amount===14400 && value.price?.interval==='year' && value.price?.intervalCount===1 ? {...value.price} : null;
  return {plan,status,mode,price,canPurchase:value.canPurchase===true&&mode!=='unconfigured'&&!!price,canManage:value.canManage===true&&mode!=='unconfigured',reason:['payment_setup_required','test_account'].includes(value.reason)?value.reason:null,cancelAtPeriodEnd:value.cancelAtPeriodEnd===true,currentPeriodEnd:typeof value.currentPeriodEnd==='string'&&Number.isFinite(Date.parse(value.currentPeriodEnd))?value.currentPeriodEnd:null};
}

export function createBilling({getAccount=()=>null,fetchImpl=(...args)=>fetch(...args),navigate=url=>window.location.assign(url),onChange=()=>{}}={}) {
  let identity=accountKey(getAccount()),epoch=0,state=emptyState(),loadingPromise=null;
  function syncIdentity(){const next=accountKey(getAccount());if(next!==identity){identity=next;epoch++;state=emptyState();loadingPromise=null;}return identity;}
  function emit(){onChange({...state});}
  function getState(){syncIdentity();return {...state,price:state.price?{...state.price}:null};}
  async function request(path,body){
    const response=await fetchImpl(`/api/billing/${path}`,{method:body?'POST':'GET',credentials:'same-origin',cache:'no-store',headers:body?{'Content-Type':'application/json'}:undefined,...(body?{body:JSON.stringify(body)}:{})});
    const data=await response.json().catch(()=>({}));
    if(!response.ok)throw Object.assign(new Error('Billing request failed'),{code:safeErrors.has(data.error?.code)?data.error.code:response.status===401?'authentication_required':'provider_unavailable'});
    return data;
  }
  async function load({returnIntent}={}) {
    syncIdentity();if(['success','cancelled','portal'].includes(returnIntent))state.returnIntent=returnIntent;
    if(loadingPromise)return loadingPromise;
    const account=getAccount(),id=identity,run=epoch;
    if(!account?.id||account.demo===true){state={...emptyState(),loaded:true,reason:'authentication_required',returnIntent:state.returnIntent};emit();return getState();}
    state={...state,loading:true,error:''};
    loadingPromise=(async()=>{
      try {
        const data=await request('status');syncIdentity();if(id!==identity||run!==epoch)return null;
        state={...state,...serverState(data),loaded:true,loading:false};
        // A TEST session can inspect prices, but it can never initiate billing.
        if(account.isTest===true)state={...state,plan:'free',canPurchase:false,canManage:false,reason:'test_account'};
      } catch(error){syncIdentity();if(id!==identity||run!==epoch)return null;state={...state,loaded:true,loading:false,error:error.code||'provider_unavailable',canPurchase:false,canManage:false};}
      finally {if(id===identity&&run===epoch){loadingPromise=null;emit();}}
      return getState();
    })();
    emit();return loadingPromise;
  }
  async function launch(kind,locale='en') {
    syncIdentity();if(state.busy)return false;
    const account=getAccount(),id=identity,run=epoch;
    if(!account?.id||account.demo===true||account.isTest===true){state.error=account?.isTest?'test_account':'authentication_required';emit();return false;}
    if(!(kind==='portal'?state.canManage:state.canPurchase)){state.error='payment_setup_required';emit();return false;}
    state={...state,busy:kind,error:''};emit();
    try {
      const data=await request(kind,{locale:locale==='zh'?'zh':'en',...(kind==='checkout'?{plan:'plus'}:{})});
      syncIdentity();if(id!==identity||run!==epoch)return false;
      const url=checkoutDestination(data.url,kind);
      if(!url)throw Object.assign(new Error('Invalid payment destination'),{code:'provider_unavailable'});
      navigate(url);return true;
    } catch(error){syncIdentity();if(id!==identity||run!==epoch)return false;state={...state,busy:'',error:error.code||'provider_unavailable'};emit();return false;}
  }
  function reset(){epoch++;identity=accountKey(getAccount());state=emptyState();loadingPromise=null;}
  return {getState,load,checkout:locale=>launch('checkout',locale),portal:locale=>launch('portal',locale),reset};
}

const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const icon=name=>`<svg class="icon" aria-hidden="true"><use href="#i-${name}"/></svg>`;
const words={
 en:{free:'Free',current:'Current plan',freeNote:'Your everyday health companion.',plusNote:'An annual Pawprint subscription.',year:'/ year',subscribe:'Subscribe to Plus',manage:'Manage subscription',opening:'Opening secure checkout…',portalOpening:'Opening billing…',checking:'Checking your subscription…',secure:'Choose your payment method at secure Stripe checkout.',renewal:'Renews yearly. Cancel anytime in Manage subscription.',unavailable:'Purchases aren’t available yet.',test:'Use your own account to subscribe. Test accounts cannot be charged.',signin:'Sign in to your own account to subscribe.',testMode:'Test checkout · no real charge',retry:'Check again',active:'Your Plus subscription is active.',pending:'No active subscription confirmed yet. Check again in a moment.',cancelled:'Checkout closed. Your plan has not changed.',return:'Your subscription details are up to date.',until:'Access until',renews:'Next renewal',attention:'Your payment needs attention.',failed:'We couldn’t check your subscription. Please try again.',checkout_in_progress:'A checkout is already opening. Please try again in a moment.',subscription_exists:'You already have a subscription. Refresh to manage it.',payment_setup_required:'Purchases aren’t available yet.',test_account:'Use your own account to subscribe.',authentication_required:'Please sign in again to manage your subscription.',provider_unavailable:'Payment service unavailable. Please try again.',invalid_request:'Couldn’t start checkout. Please try again.',rate_limited:'Please wait a moment and try again.'},
 zh:{free:'免费',current:'当前方案',freeNote:'日常宠物健康陪伴。',plusNote:'Pawprint 年度订阅。',year:'／年',subscribe:'订阅 Plus',manage:'管理订阅',opening:'正在打开安全结账页…',portalOpening:'正在打开账单…',checking:'正在查询订阅状态…',secure:'在 Stripe 安全结账页选择付款方式。',renewal:'每年续订，可随时在“管理订阅”中取消。',unavailable:'购买功能暂未开放。',test:'请使用自己的账号订阅，测试账号不会产生费用。',signin:'登录自己的账号后即可订阅。',testMode:'测试结账 · 不会真实扣款',retry:'重新查询',active:'你的 Plus 订阅已生效。',pending:'暂未确认有效订阅，请稍后重新查询。',cancelled:'已关闭结账页，你的方案未改变。',return:'订阅信息已更新。',until:'使用期限至',renews:'下次续费',attention:'付款需要处理。',failed:'无法查询订阅，请重试。',checkout_in_progress:'正在打开结账页，请稍后再试。',subscription_exists:'你已有订阅，请刷新后管理。',payment_setup_required:'购买功能暂未开放。',test_account:'请使用自己的账号订阅。',authentication_required:'请重新登录后管理订阅。',provider_unavailable:'付款服务暂不可用，请重试。',invalid_request:'无法打开结账页，请重试。',rate_limited:'请稍后重试。'}
};

export function subscriptionContent(state={}, {language='en'}={}) {
 const zh=language==='zh',t=words[zh?'zh':'en'],paid=state.plan==='plus',verified=state.loaded&&!state.error;
 const restricted=state.reason==='test_account'?'test':state.reason==='authentication_required'?'signin':null;
 const price=state.price?.amount===14400?state.price.amount/100:144;
 const amount=new Intl.NumberFormat(zh?'zh-CN':'en-GB',{style:'currency',currency:'CNY',maximumFractionDigits:0}).format(price);
 const date=state.currentPeriodEnd?new Intl.DateTimeFormat(zh?'zh-CN':'en-GB',{dateStyle:'medium'}).format(new Date(state.currentPeriodEnd)):'';
 const attention=['past_due','unpaid','incomplete','paused'].includes(state.status);
 let message=state.loading?t.checking:state.error?(t[state.error]||t.failed):state.returnIntent==='cancelled'?t.cancelled:state.returnIntent==='success'?(paid?t.active:t.pending):state.returnIntent==='portal'?t.return:'';
 const action=state.canPurchase?'checkout':state.canManage?'portal':'checkout',busy=!!state.busy;
 const enabled=!busy&&!state.loading&&(action==='portal'?state.canManage:state.canPurchase);
 return `<div class="settings-billing" data-billing-view aria-busy="${state.loading||busy?'true':'false'}">
 <article class="settings-plan glass settings-plan--free"><div><h2>${t.free}</h2>${verified&&!paid?`<span class="settings-plan-badge">${icon('check')}${t.current}</span>`:''}</div><p>${t.freeNote}</p></article>
 <article class="settings-plan glass settings-plan--plus"><div><h2>Pawprint <span>Plus</span></h2>${verified&&paid?`<span class="settings-plan-badge">${icon('check')}${t.current}</span>`:''}</div><p class="settings-plan-price"><strong>${amount}</strong><small>${t.year}</small></p><p>${t.plusNote}</p>
 ${paid&&date?`<p class="settings-billing-renewal">${state.cancelAtPeriodEnd?t.until:t.renews} <strong>${esc(date)}</strong></p>`:''}
 ${attention?`<p class="settings-billing-attention">${t.attention}</p>`:''}
 <button type="button" class="button primary settings-billing-primary" data-billing-action="${action}" ${enabled?'':'disabled'}>${busy?(state.busy==='portal'?t.portalOpening:t.opening):action==='portal'?t.manage:t.subscribe}${icon('arrow-right')}</button>
 <p class="settings-billing-caption">${restricted?t[restricted]:state.mode==='unconfigured'?t.unavailable:state.mode==='test'?t.testMode:action==='portal'?t.renewal:t.secure}</p>
 ${enabled&&action==='checkout'?`<p class="settings-billing-terms">${t.renewal}</p>`:''}</article>
 <div class="settings-billing-feedback" role="status" aria-live="polite">${message?`<p${state.error?' class="is-error"':''}>${esc(message)}</p>`:''}${state.error||state.returnIntent==='success'&&!paid?`<button type="button" class="settings-text-button" data-billing-refresh ${state.loading||busy?'disabled':''}>${t.retry}${icon('refresh')}</button>`:''}</div>
 </div>`;
}
