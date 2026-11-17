// Prototype receipts are memory-only and never establish a paid entitlement.
const identity=account=>`${account?.id||'guest'}:${account?.isTest?'test':account?.demo?'demo':'owner'}`;
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const icon=name=>`<svg class="icon" aria-hidden="true"><use href="#i-${name}"/></svg>`;
const validReceipt=value=>Boolean(value?.mode==='demo'&&value.product==='pawprint-plus'&&value.amount===14400&&value.currency==='cny'&&typeof value.id==='string'&&value.id.trim()&&typeof value.createdAt==='string'&&Number.isFinite(Date.parse(value.createdAt)));

export function createSubscriptionDemo({getAccount=()=>null,getLanguage=()=> 'en',openCheckout,onChange=()=>{}}={}){
 let owner=identity(getAccount()),epoch=0,handle=null,receipt=null;
 function close(){epoch++;handle?.close();handle=null;}
 function sync(){const next=identity(getAccount());if(next!==owner){close();owner=next;receipt=null;}}
 function getState(){sync();return {receipt:receipt?{...receipt}:null};}
 function checkout(){
  sync();if(handle||validReceipt(receipt))return false;
  const run=++epoch,key=owner;
  handle=openCheckout({product:'pawprint-plus',language:getLanguage(),
   onComplete(value){
    sync();if(run!==epoch||key!==owner||!validReceipt(value))return;
    // Deliberately copy only receipt metadata, never payment or address fields.
    receipt={id:value.id.slice(0,80),product:'pawprint-plus',amount:14400,currency:'cny',createdAt:value.createdAt,mode:'demo'};
   },
   onClose(){sync();if(run!==epoch||key!==owner)return;epoch++;handle=null;onChange(getState());}
  });
  return true;
 }
 function reset(){close();owner=identity(getAccount());receipt=null;}
 return {getState,checkout,close,reset};
}

export function subscriptionDemoContent({plan='free',receipt=null}={}, {language='en'}={}){
 const zh=language==='zh',complete=validReceipt(receipt),paid=plan==='plus'||complete;
 const t=zh?{free:'免费',current:'当前方案',freeNote:'日常宠物健康陪伴。',year:'／年',plusNote:'Pawprint 年度订阅。',subscribe:'订阅 Plus',demo:'模拟购买 · 不会扣款',activeDemo:'模拟订阅 · 不会扣款',caption:'选择付款方式和账单地址，体验完整购买流程。',placed:'Order Placed',placedNote:'Plus 已成为本次体验的当前套餐。'}:{free:'Free',current:'Current plan',freeNote:'Your everyday health companion.',year:'/ year',plusNote:'An annual Pawprint subscription.',subscribe:'Subscribe to Plus',demo:'Demo purchase · no charge',activeDemo:'Demo subscription · no charge',caption:'Choose a payment method and billing address to try the full checkout.',placed:'Order Placed',placedNote:'Plus is your current plan for this demo session.'};
 const amount=new Intl.NumberFormat(zh?'zh-CN':'en-GB',{style:'currency',currency:'CNY',maximumFractionDigits:0}).format(144);
 return `<div class="settings-billing" data-billing-view>
 <article class="settings-plan glass settings-plan--free"><div><h2>${t.free}</h2>${!paid?`<span class="settings-plan-badge">${icon('check')}${t.current}</span>`:''}</div><p>${t.freeNote}</p></article>
 <article class="settings-plan glass settings-plan--plus"><div><h2>Pawprint <span>Plus</span></h2>${paid?`<span class="settings-plan-badge">${icon('check')}${t.current}</span>`:''}</div><p class="settings-plan-price"><strong>${amount}</strong><small>${t.year}</small></p><p>${t.plusNote}</p>
 ${!paid?`<button type="button" class="button primary settings-billing-primary" data-demo-subscribe>${t.subscribe}${icon('arrow-right')}</button><p class="settings-billing-caption settings-demo-purchase">${t.demo}</p><p class="settings-billing-terms">${t.caption}</p>`:complete?`<p class="settings-billing-caption settings-demo-purchase">${t.activeDemo}</p>`:''}</article>
 ${complete?`<section class="settings-demo-receipt glass" role="status" tabindex="-1"><span>${icon('check')}</span><div><h3>${t.placed}</h3><p>${t.placedNote}</p><small>#${esc(receipt.id)}</small></div></section>`:''}
 </div>`;
}
