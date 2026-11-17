import test from 'node:test';
import assert from 'node:assert/strict';
import {createDemoShopState,demoShopContent,demoShopProducts} from '../dist/shop.js';

const receipt={id:'demo_order_example',product:'pawprint-one',amount:35000,currency:'cny',createdAt:'2026-11-15T18:40:00Z',mode:'demo'};

test('shop opens as a compact product list and opens details separately',()=>{
 const state=createDemoShopState({getAccount:()=>({id:'test-session',isTest:true})});
 assert.equal(state.getState().view,'catalog');
 assert.deepEqual(demoShopProducts,[{id:'pawprint-one',name:'Pawprint One',amount:35000,currency:'cny'}]);
 const list=demoShopContent(state.getState());
 assert.match(list,/shop-product-grid/);assert.match(list,/data-shop-product="pawprint-one"/);assert.match(list,/CN¥350/);
 assert.doesNotMatch(list,/data-shop-buy|data-shop-model|Price coming soon|disabled/);
 state.selectProduct('pawprint-one');
 const details=demoShopContent(state.getState());
 assert.match(details,/data-shop-model/);assert.match(details,/data-shop-buy>/);assert.match(details,/Demo checkout · no real charge/);
 state.selectProduct('unknown');assert.equal(state.getState().view,'catalog');
});

test('every app account can reach simulated hardware checkout and sees the approved price',()=>{
 for(const account of [{id:'regular'},{id:'test',isTest:true},{demo:true},null]){
  const state=createDemoShopState({getAccount:()=>account});state.selectProduct('pawprint-one');
  const html=demoShopContent(state.getState());assert.match(html,/data-shop-buy>/);assert.match(html,/CN¥350/);assert.doesNotMatch(html,/cannot be charged|Sign in|disabled/);
 }
});

test('demo order receipts retain no address or payment details and cannot become real paid records',()=>{
 const state=createDemoShopState({getAccount:()=>({id:'a'})});
 assert.equal(state.complete({...receipt,card:'4242424242424242',address:'Sample address'}),true);
 assert.deepEqual(state.getState().orders,[receipt]);
 assert.equal(state.complete(receipt),false);
 for(const item of [{...receipt,id:'live',mode:'live'},{...receipt,id:'bad-price',amount:14400},{...receipt,id:'other',product:'pawprint-plus'}])assert.equal(state.complete(item),false);
 const html=demoShopContent(state.getState());assert.match(html,/Order Placed/);assert.match(html,/Demo order · no charge or delivery/);assert.doesNotMatch(html,/4242424242424242|Sample address|Payment confirmed/);
});

test('changing accounts clears demo orders and rejects callbacks belonging to the old account',()=>{
 let account={id:'test-a',isTest:true};const state=createDemoShopState({getAccount:()=>account});
 const original=state.getState().identity;state.selectProduct('pawprint-one');state.complete(receipt,original);
 account={id:'test-b',isTest:true};assert.deepEqual(state.getState().orders,[]);assert.equal(state.getState().view,'catalog');
 assert.equal(state.complete({...receipt,id:'late'},original),false);assert.deepEqual(state.getState().orders,[]);
});

test('legacy return flags alone never display a placed or paid order',()=>{
 const html=demoShopContent({}, {legacyState:{returnIntent:'success',loading:false,orders:[]}});
 assert.match(html,/No payment has been confirmed/);assert.doesNotMatch(html,/Order Placed|Payment confirmed/);
 const zh=demoShopContent({view:'detail'},{language:'zh'});assert.match(zh,/¥350/);assert.match(zh,/模拟结账 · 不会真实扣款/);
});
