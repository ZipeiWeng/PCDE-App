import test from 'node:test';
import assert from 'node:assert/strict';
import {demoProduct,demoDetails,validateDemoCheckout,createDemoReceipt,demoCheckoutContent} from '../dist/demo-checkout.js';

const now=new Date('2026-11-15T12:00:00Z');

test('demo checkout keeps the agreed hardware and annual subscription prices independent',()=>{
 assert.equal(demoProduct('pawprint-one').amount,35000);
 assert.equal(demoProduct('pawprint-plus').amount,14400);
 const first=demoProduct('pawprint-one');first.amount=1;
 assert.equal(demoProduct('pawprint-one').amount,35000);
 assert.equal(demoProduct('unrecognised'),null);
});

test('address must be completed before entering the payment step',()=>{
 assert.deepEqual(Object.keys(validateDemoCheckout({},{step:'address',now})),['name','street','city','postalCode','country']);
 const values=demoDetails(now);delete values.cardNumber;
 assert.deepEqual(validateDemoCheckout(values,{step:'address',now}),{});
 assert.deepEqual(validateDemoCheckout({...values,street:'   '},{step:'address',now}),{street:'addressRequired'});
});

test('card demo accepts only its sample PAN and rejects actual-card-like alternatives',()=>{
 const values=demoDetails(now);
 assert.deepEqual(validateDemoCheckout(values,{now}),{});
 for(const cardNumber of ['5555 5555 5555 4444','4000 0000 0000 0002','4242','<script>'])assert.equal(validateDemoCheckout({...values,cardNumber},{now}).cardNumber,'cardInvalid');
 for(const expiry of ['10/26','12/25','13/30','03/xx',''])assert.equal(validateDemoCheckout({...values,expiry},{now}).expiry,'expiryInvalid');
 assert.equal(validateDemoCheckout({...values,cvc:'12'},{now}).cvc,'cvcInvalid');
 assert.equal(validateDemoCheckout({...values,cardName:''},{now}).cardName,'cardRequired');
});

test('wallet demonstrations use their own fields and never require card data',()=>{
 for(const method of ['paypal','alipay']){
  const values={...demoDetails(now),method,cardNumber:'',expiry:'',cvc:''};
  assert.deepEqual(validateDemoCheckout(values,{now}),{});
  assert.equal(validateDemoCheckout({...values,wallet:''},{now}).wallet,'walletInvalid');
 }
 assert.equal(validateDemoCheckout({...demoDetails(now),method:'unknown'},{now}).method,'methodInvalid');
});

test('receipts contain no card, wallet, identity or delivery data and cannot carry a supplied total',()=>{
 const receipt=createDemoReceipt('pawprint-one',{now,id:'example',...demoDetails(now),amount:1});
 assert.deepEqual(receipt,{id:'DEMO-example',product:'pawprint-one',amount:35000,currency:'cny',createdAt:'2026-11-15T12:00:00.000Z',mode:'demo'});
 assert.throws(()=>createDemoReceipt('unknown',{now}));
 const plus=createDemoReceipt('pawprint-plus',{now,id:'plus'});assert.equal(plus.amount,14400);assert.equal(plus.mode,'demo');
});

test('payment and success screens remain explicit demonstrations and escape entered address text',()=>{
 const values={...demoDetails(now),name:'<img onerror="alert(1)">',street:'<script>malicious</script>'};
 const payment=demoCheckoutContent({product:'pawprint-one',step:'payment',values});
 assert.match(payment,/Pay ¥350/);assert.match(payment,/Demo checkout · no real charge/);assert.match(payment,/never a real card/);
 assert.match(payment,/&lt;img/);assert.doesNotMatch(payment,/<script>|<img/);
 const receipt=createDemoReceipt('pawprint-plus',{now,id:'sample'});
 const success=demoCheckoutContent({product:'pawprint-plus',step:'complete',values,receipt});
 assert.match(success,/Order Placed/);assert.match(success,/No money was charged/);assert.match(success,/No paid subscription or renewal was created/);assert.doesNotMatch(success,/cardNumber|SW1A|4242/);
});
