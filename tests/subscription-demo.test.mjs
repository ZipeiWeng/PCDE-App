import test from 'node:test';
import assert from 'node:assert/strict';
import {createSubscriptionDemo,subscriptionDemoContent} from '../dist/subscription-demo.js';

const receipt={id:'demo_order_123',product:'pawprint-plus',amount:14400,currency:'cny',createdAt:'2026-11-15T18:00:00.000Z',mode:'demo'};
function fixture(initial={id:'test-a',isTest:true}){
 let account=initial,request,closed=0,changes=0;
 const controller=createSubscriptionDemo({getAccount:()=>account,getLanguage:()=> 'en',openCheckout:value=>{request=value;return{close(){closed++;}};},onChange(){changes++;}});
 return{controller,get request(){return request;},get closed(){return closed;},get changes(){return changes;},setAccount(value){account=value;}};
}

test('TEST, guest demo and ordinary accounts all launch the same simulated subscription',()=>{
 for(const account of [{id:'test-a',isTest:true},{id:'guest',demo:true},{id:'owner-a'},null]){
  const f=fixture(account);
  assert.equal(f.controller.checkout(),true);
  assert.equal(f.request.product,'pawprint-plus');
  assert.equal(f.request.language,'en');
  assert.equal(f.controller.checkout(),false,'double tap must not open two dialogs');
  const html=subscriptionDemoContent();
  assert.match(html,/data-demo-subscribe>/);
  assert.doesNotMatch(html,/disabled|cannot be charged|Sign in/);
 }
});

test('completed demo purchase shows Plus as current and blocks another checkout',()=>{
 const f=fixture();f.controller.checkout();
 f.request.onComplete({...receipt,cardNumber:'4242424242424242',cvc:'123',address:'Fictional street'});
 assert.deepEqual(f.controller.getState(),{receipt});
 assert.equal(f.changes,0,'keep the success modal until the user closes it');
 f.request.onClose();assert.equal(f.changes,1);
 const html=subscriptionDemoContent(f.controller.getState());
 assert.match(html,/Order Placed/);assert.match(html,/Plus is your current plan/);
 assert.match(html,/Plus<\/span><\/h2><span class="settings-plan-badge"/);
 assert.doesNotMatch(html,/Free<\/h2><span class="settings-plan-badge"/);
 assert.doesNotMatch(html,/data-demo-subscribe|Try checkout again|Subscribe to Plus/);
 assert.equal(f.controller.checkout(),false,'a completed purchase cannot be placed again');
 f.controller.close();
 assert.deepEqual(f.controller.getState(),{receipt},'reopening settings in the same session retains Plus');
 assert.equal(f.controller.checkout(),false);
 assert.doesNotMatch(html,/424242|Fictional street/);
});

test('unverified, wrong-product or malformed receipts never show a completed order',()=>{
 for(const value of [{...receipt,mode:'live'},{...receipt,product:'pawprint-one'},{...receipt,amount:35000},{...receipt,currency:'gbp'},{...receipt,createdAt:'invalid'},{...receipt,createdAt:0},{...receipt,id:''},{...receipt,id:'  '},{...receipt,id:null},null]){
  const f=fixture();f.controller.checkout();f.request.onComplete(value);
  assert.equal(f.controller.getState().receipt,null);
  assert.doesNotMatch(subscriptionDemoContent(f.controller.getState()),/Order Placed/);
  assert.doesNotMatch(subscriptionDemoContent({receipt:value}),/Order Placed/,'direct rendering also validates the complete receipt');
 }
});

test('cancelling checkout allows retry but invalidates late completion callbacks',()=>{
 const f=fixture();f.controller.checkout();const cancelled=f.request;
 cancelled.onClose();cancelled.onComplete(receipt);
 assert.equal(f.controller.getState().receipt,null);
 assert.equal(f.controller.checkout(),true);
 f.request.onComplete(receipt);f.request.onClose();
 assert.deepEqual(f.controller.getState().receipt,receipt);
});

test('a new TEST session and an app reload restart the full Free purchase journey',()=>{
 const f=fixture();
 for(let session=0;session<2;session++){
  assert.equal(f.controller.getState().receipt,null);
  assert.match(subscriptionDemoContent(f.controller.getState()),/Free<\/h2><span class="settings-plan-badge"/);
  assert.equal(f.controller.checkout(),true);
  f.request.onComplete(receipt);f.request.onClose();
  assert.equal(f.controller.checkout(),false);
  f.controller.reset();
 }
 const reloaded=fixture();
 assert.equal(reloaded.controller.getState().receipt,null);
 assert.match(subscriptionDemoContent(reloaded.controller.getState()),/data-demo-subscribe/);
 assert.equal(reloaded.controller.checkout(),true);
});

test('close/reset and account switch invalidate late completions and isolate receipts',()=>{
 const f=fixture();f.controller.checkout();const first=f.request;
 f.controller.close();first.onComplete(receipt);first.onClose();
 assert.equal(f.closed,1);assert.equal(f.changes,0);assert.equal(f.controller.getState().receipt,null);
 f.controller.checkout();f.request.onComplete(receipt);f.request.onClose();
 assert.deepEqual(f.controller.getState().receipt,receipt);
 f.setAccount({id:'owner-b'});assert.equal(f.controller.getState().receipt,null);
 f.controller.checkout();const old=f.request;f.setAccount({id:'owner-c'});old.onComplete(receipt);
 assert.equal(f.controller.getState().receipt,null);
 f.controller.checkout();f.request.onComplete(receipt);f.controller.reset();assert.equal(f.controller.getState().receipt,null);
});

test('verified existing Plus is retained while demo receipt is separate and escaped',()=>{
 const html=subscriptionDemoContent({plan:'plus',receipt:{...receipt,id:'<script>alert(1)</script>'}});
 assert.match(html,/Plus<\/span><\/h2><span class="settings-plan-badge"/);
 assert.match(html,/&lt;script&gt;/);assert.doesNotMatch(html,/<script>/);
 assert.doesNotMatch(html,/data-demo-subscribe/);
 assert.doesNotMatch(subscriptionDemoContent({plan:'plus'}),/data-demo-subscribe|Demo purchase/);
 const zh=subscriptionDemoContent({receipt},{language:'zh'});
 assert.match(zh,/¥144/);assert.match(zh,/不会扣款/);assert.match(zh,/Plus 已成为本次体验的当前套餐/);
});
