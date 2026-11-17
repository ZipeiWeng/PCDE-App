// A self-contained purchase demonstration. No payment or address data leaves
// this dialog, and a demo receipt is never a paid subscription entitlement.
const products={
  'pawprint-one':Object.freeze({id:'pawprint-one',name:'Pawprint One',amount:35000,currency:'cny',kind:'hardware'}),
  'pawprint-plus':Object.freeze({id:'pawprint-plus',name:'Pawprint Plus',amount:14400,currency:'cny',kind:'subscription'}),
};
const methods=new Set(['card','paypal','alipay']);
const countries=new Set(['CN','GB','US','DE','FR','AU','CA','SG','HK']);
const sampleCard='4242424242424242';
const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const icon=name=>`<svg class="icon" aria-hidden="true"><use href="#i-${name}"/></svg>`;
const copy={
 en:{checkout:'Checkout',demo:'Demo checkout · no real charge',sample:'Use demo details',address:'Your address',addressNote:'Use a sample address for this demo.',name:'Full name',street:'Address',city:'City',postcode:'Postcode',country:'Country / region',continue:'Continue to payment',cancel:'Cancel',close:'Close checkout',payment:'Payment method',card:'Card',paypal:'PayPal',alipay:'Alipay',cardName:'Name on card',cardNumber:'Demo card number',expiry:'Expiry',cvc:'CVC',cardHint:'Use 4242 4242 4242 4242 — never a real card.',wallet:'Demo wallet account',walletHint:'Simulated wallet · no sign-in or transfer.',pay:'Pay',back:'Back',edit:'Edit',billing:'Billing address',delivery:'Delivery address',year:'/ year',once:'One-time purchase',included:'Delivery in this demo',zero:'¥0',total:'Total',today:'Total today',placed:'Order Placed',success:'Your demo order is complete.',noCharge:'No money was charged.',noDispatch:'This is a demo. No device will be shipped.',noRenewal:'This is a demo. No paid subscription or renewal was created.',doneShop:'Back to shop',doneSubscription:'Back to subscription',order:'Demo order',addressRequired:'Please complete this field.',countryRequired:'Choose a country or region.',cardRequired:'Please enter the name shown on the demo card.',cardInvalid:'Use the sample card number 4242 4242 4242 4242.',expiryInvalid:'Enter a future expiry date in MM/YY format.',cvcInvalid:'Enter a three-digit demo CVC.',walletInvalid:'Enter a sample wallet account.',methodInvalid:'Choose a payment method.',addressIntro:'Address',paymentIntro:'Payment',step:'Step'},
 zh:{checkout:'结账',demo:'模拟结账 · 不会真实扣款',sample:'填入示例资料',address:'填写地址',addressNote:'请使用示例地址体验购买流程。',name:'姓名',street:'详细地址',city:'城市',postcode:'邮政编码',country:'国家／地区',continue:'继续选择付款方式',cancel:'取消',close:'关闭结账',payment:'付款方式',card:'银行卡',paypal:'PayPal',alipay:'支付宝',cardName:'持卡人姓名',cardNumber:'示例卡号',expiry:'有效期',cvc:'安全码',cardHint:'请使用 4242 4242 4242 4242，不要填写真实卡号。',wallet:'示例钱包账号',walletHint:'模拟钱包，无需登录，不会转账。',pay:'Pay',back:'返回',edit:'编辑',billing:'账单地址',delivery:'收货地址',year:'／年',once:'一次性购买',included:'本次演示配送费',zero:'¥0',total:'合计',today:'本次合计',placed:'Order Placed',success:'模拟订单已完成。',noCharge:'未产生任何扣款。',noDispatch:'此为演示，不会寄送设备。',noRenewal:'此为演示，未创建真实付费订阅或续费。',doneShop:'返回商店',doneSubscription:'返回订阅',order:'模拟订单',addressRequired:'请填写此项。',countryRequired:'请选择国家或地区。',cardRequired:'请填写示例卡片上的姓名。',cardInvalid:'请使用示例卡号 4242 4242 4242 4242。',expiryInvalid:'请以 MM/YY 格式填写未来的有效期。',cvcInvalid:'请填写三位示例安全码。',walletInvalid:'请填写示例钱包账号。',methodInvalid:'请选择付款方式。',addressIntro:'地址',paymentIntro:'付款',step:'步骤'},
};
const countryNames={en:{CN:'China',GB:'United Kingdom',US:'United States',DE:'Germany',FR:'France',AU:'Australia',CA:'Canada',SG:'Singapore',HK:'Hong Kong'},zh:{CN:'中国',GB:'英国',US:'美国',DE:'德国',FR:'法国',AU:'澳大利亚',CA:'加拿大',SG:'新加坡',HK:'中国香港'}};
const textValue=value=>typeof value==='string'?value.trim():'';

export function demoProduct(id){return products[id]?{...products[id]}:null;}
export function demoDetails(now=new Date()){
 return {name:'Alex Demo',street:'12 Example Lane',city:'London',postalCode:'SW1A 1AA',country:'GB',method:'card',cardName:'Alex Demo',cardNumber:'4242 4242 4242 4242',expiry:`12/${String(now.getFullYear()+3).slice(-2)}`,cvc:'123',wallet:'demo@example.test'};
}
export function validateDemoCheckout(values={}, {step='payment',now=new Date()}={}){
 const errors={};
 for(const field of ['name','street','city','postalCode'])if(!textValue(values[field])||textValue(values[field]).length>160)errors[field]='addressRequired';
 if(!countries.has(values.country))errors.country='countryRequired';
 if(step==='address')return errors;
 if(!methods.has(values.method)){errors.method='methodInvalid';return errors;}
 if(values.method==='card'){
  if(!textValue(values.cardName)||textValue(values.cardName).length>80)errors.cardName='cardRequired';
  if(textValue(values.cardNumber).replace(/[ -]/g,'')!==sampleCard)errors.cardNumber='cardInvalid';
  const expiry=/^(\d{2})\s*\/\s*(\d{2})$/.exec(textValue(values.expiry));
  const month=Number(expiry?.[1]),year=2000+Number(expiry?.[2]);
  if(!expiry||month<1||month>12||year<now.getFullYear()||year===now.getFullYear()&&month<now.getMonth()+1)errors.expiry='expiryInvalid';
  if(!/^\d{3}$/.test(textValue(values.cvc)))errors.cvc='cvcInvalid';
 }else if(!textValue(values.wallet)||textValue(values.wallet).length>100)errors.wallet='walletInvalid';
 return errors;
}
export function createDemoReceipt(product,{now=new Date(),id}={}){
 const selected=demoProduct(product);if(!selected)throw new Error('Unknown demo product');
 const stamp=now instanceof Date?now:new Date(now);if(!Number.isFinite(stamp.getTime()))throw new Error('Invalid demo date');
 const random=id||globalThis.crypto?.randomUUID?.()||`${stamp.getTime().toString(36)}-${Math.random().toString(36).slice(2,10)}`;
 return {id:`DEMO-${String(random).replace(/[^a-zA-Z0-9-]/g,'').slice(0,50)}`,product:selected.id,amount:selected.amount,currency:selected.currency,createdAt:stamp.toISOString(),mode:'demo'};
}
function money(amount){return `¥${(amount/100).toLocaleString('en-GB',{maximumFractionDigits:2})}`;}
function addressLine(values,language){return [values.street,values.city,values.postalCode,countryNames[language]?.[values.country]].filter(Boolean).join(', ');}
function input(name,label,values,errors,t,extra=''){
 const error=errors[name];return `<label class="demo-checkout-field"><span>${label}</span><input name="${name}" value="${esc(values[name])}" ${extra} autocomplete="off" data-lpignore="true" aria-invalid="${Boolean(error)}"${error?` aria-describedby="demo-checkout-${name}-error"`:''}>${error?`<small class="demo-checkout-field-error" id="demo-checkout-${name}-error">${t[error]}</small>`:''}</label>`;
}
export function demoCheckoutContent({product='pawprint-one',language='en',step='address',values={},errors={},receipt=null}={}){
 const selected=demoProduct(product);if(!selected)throw new Error('Unknown demo product');
 language=language==='zh'?'zh':'en';const t=copy[language],hardware=selected.kind==='hardware';
 if(step==='complete'&&receipt)return `<div class="demo-checkout-success"><div class="demo-checkout-check" aria-hidden="true"><svg viewBox="0 0 48 48"><path d="m13 24 8 8 15-17"/></svg></div><p class="demo-checkout-eyebrow">${t.demo}</p><h2 id="demo-checkout-title" tabindex="-1">${t.placed}</h2><p class="demo-checkout-success-copy">${t.success}<br>${t.noCharge}</p><div class="demo-checkout-receipt"><span>${selected.name}</span><strong>${money(selected.amount)}${hardware?'':` <small>${t.year}</small>`}</strong><small>${t.order} · ${esc(receipt.id.slice(-12).toUpperCase())}</small></div><p class="demo-checkout-footnote">${hardware?t.noDispatch:t.noRenewal}</p><button type="button" class="button primary demo-checkout-primary" data-demo-done>${hardware?t.doneShop:t.doneSubscription}${icon('arrow-right')}</button></div>`;
 const addressError=errors.country;
 const heading=step==='address'?t.address:t.payment;
 const address=`<p class="demo-checkout-field-hint">${t.addressNote}</p><div class="demo-checkout-fields">${input('name',t.name,values,errors,t,'maxlength="160" required')}${input('street',t.street,values,errors,t,'maxlength="160" required')}<div class="demo-checkout-field-row">${input('city',t.city,values,errors,t,'maxlength="160" required')}${input('postalCode',t.postcode,values,errors,t,'maxlength="160" required')}</div><label class="demo-checkout-field"><span>${t.country}</span><select name="country" aria-invalid="${Boolean(addressError)}"${addressError?' aria-describedby="demo-checkout-country-error"':''}>${Object.entries(countryNames[language]).map(([key,value])=>`<option value="${key}"${values.country===key?' selected':''}>${value}</option>`).join('')}</select>${addressError?`<small class="demo-checkout-field-error" id="demo-checkout-country-error">${t[addressError]}</small>`:''}</label></div>`;
 const method=methods.has(values.method)?values.method:'card';
 const payment=`<fieldset class="demo-checkout-methods"><legend class="sr-only">${t.payment}</legend>${['card','paypal','alipay'].map(key=>`<label class="demo-checkout-method${method===key?' is-selected':''}"><input type="radio" name="method" value="${key}"${method===key?' checked':''}><span aria-hidden="true">${key==='card'?'<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="3"/><path d="M3 10h18M7 15h3"/></svg>':key==='paypal'?'<b>P</b>':'<b>支</b>'}</span><span>${t[key]}</span></label>`).join('')}</fieldset>${method==='card'?`<div class="demo-checkout-fields">${input('cardName',t.cardName,values,errors,t,'maxlength="80" required')}${input('cardNumber',t.cardNumber,values,errors,t,'inputmode="numeric" maxlength="23" placeholder="4242 4242 4242 4242" required')}<div class="demo-checkout-field-row">${input('expiry',t.expiry,values,errors,t,'inputmode="numeric" maxlength="7" placeholder="MM/YY" required')}${input('cvc',t.cvc,values,errors,t,'inputmode="numeric" maxlength="3" placeholder="123" required')}</div></div><p class="demo-checkout-field-hint">${t.cardHint}</p>`:`<div class="demo-checkout-wallet">${input('wallet',t.wallet,values,errors,t,'maxlength="100" placeholder="demo@example.test" required')}<p class="demo-checkout-field-hint">${t.walletHint}</p></div>`}<div class="demo-checkout-address-summary"><div><span>${hardware?t.delivery:t.billing}</span><button type="button" class="text-button" data-demo-edit>${t.edit}</button></div><strong>${esc(values.name)}</strong><p>${esc(addressLine(values,language))}</p></div>`;
 return `<header class="demo-checkout-header"><div><p class="demo-checkout-eyebrow">${t.demo}</p><h2 id="demo-checkout-title" tabindex="-1">${t.checkout}</h2></div><button class="round-button glass" type="button" data-demo-close aria-label="${t.close}">${icon('close')}</button></header><div class="demo-checkout-scroll"><div class="demo-checkout-summary"><div><strong>${selected.name}</strong><small>${hardware?t.once:t.year}</small></div><strong>${money(selected.amount)}</strong></div><nav class="demo-checkout-progress" aria-label="${t.step}"><span${step==='address'?' aria-current="step"':''}>1 <b>${t.addressIntro}</b></span><i aria-hidden="true"></i><span${step==='payment'?' aria-current="step"':''}>2 <b>${t.paymentIntro}</b></span></nav><form novalidate autocomplete="off" data-demo-form><div class="demo-checkout-section-heading"><h3>${heading}</h3><button type="button" class="text-button" data-demo-sample>${t.sample}</button></div>${step==='address'?address:payment}<p class="demo-checkout-error" role="alert">${errors.method?t[errors.method]:''}</p>${step==='payment'?`<div class="demo-checkout-total"><span>${hardware?t.total:t.today}</span><strong>${money(selected.amount)}</strong></div>`:''}<button type="submit" class="button primary demo-checkout-primary">${step==='address'?t.continue:`${t.pay} ${money(selected.amount)}`}${icon('arrow-right')}</button><button type="button" class="demo-checkout-back" data-demo-back>${step==='address'?t.cancel:t.back}</button></form></div>`;
}

let activeCheckout=null;
export function openDemoCheckout({product='pawprint-one',language='en',onComplete=()=>{},onClose=()=>{},document:doc=globalThis.document}={}){
 if(!demoProduct(product))throw new Error('Unknown demo product');
 activeCheckout?.close();
 const dialog=doc.createElement('dialog'),previousFocus=doc.activeElement;
 let step='address',values={country:'CN',method:'card'},errors={},receipt=null,closed=false,completed=false;
 dialog.className='demo-checkout-dialog';dialog.setAttribute('aria-labelledby','demo-checkout-title');dialog.setAttribute('data-no-settings-swipe','');
 function collect(){const form=dialog.querySelector('[data-demo-form]');if(!form)return;for(const field of form.querySelectorAll('input,select'))if(field.type!=='radio'||field.checked)values[field.name]=field.value;}
 function close(notify=false){
  if(closed)return;closed=true;
  for(const field of dialog.querySelectorAll('input'))field.value='';values={};errors={};
  if(dialog.open)dialog.close();dialog.remove();if(activeCheckout===controller)activeCheckout=null;
  if(previousFocus?.isConnected)previousFocus.focus?.({preventScroll:true});
  if(notify)onClose();
 }
 function render(){
  dialog.innerHTML=demoCheckoutContent({product,language,step,values,errors,receipt});
  dialog.querySelector('[data-demo-close]')?.addEventListener('click',()=>close(true));
  dialog.querySelector('[data-demo-done]')?.addEventListener('click',()=>close(true));
  dialog.querySelector('[data-demo-back]')?.addEventListener('click',()=>{if(step==='address'){close(true);return;}collect();step='address';errors={};render();});
  dialog.querySelector('[data-demo-edit]')?.addEventListener('click',()=>{collect();step='address';errors={};render();});
  dialog.querySelector('[data-demo-sample]')?.addEventListener('click',()=>{collect();values={...demoDetails(),method:values.method};errors={};render();});
  dialog.querySelectorAll('[name="method"]').forEach(field=>field.addEventListener('change',()=>{collect();errors={};render();dialog.querySelector('[name="method"]:checked')?.focus({preventScroll:true});}));
  dialog.querySelector('[data-demo-form]')?.addEventListener('submit',event=>{
   event.preventDefault();if(completed||closed)return;collect();errors=validateDemoCheckout(values,{step});
   if(Object.keys(errors).length){render();dialog.querySelector('[aria-invalid="true"]')?.focus({preventScroll:false});return;}
   if(step==='address'){step='payment';render();return;}
   completed=true;receipt=createDemoReceipt(product);values={};errors={};step='complete';render();onComplete({...receipt});
  });
  dialog.querySelector('#demo-checkout-title')?.focus({preventScroll:true});
 }
 const controller={close:()=>close(false)};
 dialog.addEventListener('cancel',event=>{event.preventDefault();event.stopPropagation();close(true);});
 dialog.addEventListener('close',()=>{if(!closed)close(true);});
 // Native modal focus trapping also makes every underlying app control inert.
 dialog.addEventListener('keydown',event=>{if(event.key==='Escape')event.stopPropagation();});
 doc.body.appendChild(dialog);render();dialog.showModal();dialog.querySelector('#demo-checkout-title')?.focus({preventScroll:true});activeCheckout=controller;
 return controller;
}
