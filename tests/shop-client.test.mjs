import test from 'node:test';
import assert from 'node:assert/strict';
import {createShop,consumeShopReturn,shopContent,formatShopPrice} from '../dist/shop.js';
const product={id:'pawprint-one',name:'Pawprint One',price:{amount:29900,currency:'cny'},available:true,reason:null};
const catalog={mode:'live',products:[product],shipping:{amount:1200,currency:'cny',countries:['GB','CN']}};
const response=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}});
const delayed=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
const order={id:'order123',productId:'pawprint-one',amount:31100,currency:'cny',status:'paid',createdAt:'2026-11-15T12:00:00Z',paidAt:'2026-11-15T12:01:00Z'};
function fixture({account={id:'owner-a'},fetchImpl, navigate=()=>{}}={}){
 let owner=account,calls=[];
 const client=createShop({getAccount:()=>owner,fetchImpl:fetchImpl||((url,init)=>{calls.push({url,init});return Promise.resolve(response(url.endsWith('catalog')?catalog:{orders:[order]}));}),navigate});
 return {client,calls,account:value=>{owner=value;}};
}

test('catalog prices and shipping come from server; missing or invalid setup cannot be purchased',async()=>{
 for(const value of [{mode:'unconfigured',products:[]},{...catalog,products:[{...product,price:null}]},{...catalog,shipping:null},{...catalog,shipping:{...catalog.shipping,currency:'gbp'}},{...catalog,products:[{...product,available:false}]}]){
  const f=fixture({fetchImpl:async url=>response(url.endsWith('catalog')?value:{orders:[]})});await f.client.load();
  assert.equal(f.client.getState().products[0].available,false);assert.equal(await f.client.checkout(),false);
 }
 const f=fixture();await f.client.load();assert.deepEqual(f.client.getState().products[0].price,product.price);assert.deepEqual(f.client.getState().shipping,catalog.shipping);assert.equal(f.client.getState().products[0].available,true);
});

test('TEST/demo/guest can browse public catalog but cannot read orders or start checkout',async()=>{
 for(const account of [{id:'test',isTest:true},{id:'guest',demo:true},null]){
  const f=fixture({account,navigate:()=>assert.fail('must not navigate')});await f.client.load();
  assert.deepEqual(f.calls.map(call=>call.url),['/api/shop/catalog']);assert.equal(f.client.getState().canBuy,false);assert.equal(await f.client.checkout(),false);assert.equal(f.calls.length,1);
 }
});

test('checkout uses one server-selected product and authenticated POST; rapid taps are ignored',async()=>{
 const deferred=delayed(),calls=[],redirects=[];
 const f=fixture({fetchImpl:async(url,init)=>{calls.push({url,init});return url.endsWith('checkout')?deferred.promise:response(url.endsWith('catalog')?catalog:{orders:[]});},navigate:url=>redirects.push(url)});
 await f.client.load();const pending=f.client.checkout('zh');assert.equal(await f.client.checkout('en'),false);
 const request=calls.find(call=>call.url.endsWith('checkout'));assert.deepEqual(JSON.parse(request.init.body),{productId:'pawprint-one',quantity:1,locale:'zh'});assert.equal(request.init.method,'POST');assert.equal(request.init.credentials,'same-origin');
 deferred.resolve(response({url:'https://checkout.stripe.com/c/pay/cs_live_example',mode:'live'}));assert.equal(await pending,true);assert.deepEqual(redirects,['https://checkout.stripe.com/c/pay/cs_live_example']);
});

test('unsafe checkout redirects never navigate or hide the error',async()=>{
 for(const url of ['http://checkout.stripe.com/c/pay/example','https://checkout.stripe.com.evil.test/','javascript:alert(1)','https://billing.stripe.com/session/example','https://user:secret@checkout.stripe.com/']){
  const f=fixture({fetchImpl:async path=>response(path.endsWith('checkout')?{url}:path.endsWith('catalog')?catalog:{orders:[]}),navigate:()=>assert.fail('unsafe navigation')});await f.client.load();assert.equal(await f.client.checkout(),false);assert.equal(f.client.getState().error,'provider_unavailable');
 }
});

test('account switches and close/reset invalidate late order and checkout responses',async()=>{
 let pending=delayed(),redirects=[];
 const f=fixture({fetchImpl:()=>pending.promise,navigate:url=>redirects.push(url)});
 const load=f.client.load();f.account({id:'owner-b'});assert.equal(f.client.getState().loaded,false);pending.resolve(response(catalog));assert.equal(await load,null);assert.deepEqual(f.client.getState().orders,[]);
 const orders=delayed();const x=fixture({fetchImpl:async url=>url.endsWith('checkout')?orders.promise:response(url.endsWith('catalog')?catalog:{orders:[order]}),navigate:url=>redirects.push(url)});
 await x.client.load();const launch=x.client.checkout();x.client.reset();orders.resolve(response({url:'https://checkout.stripe.com/c/pay/cs_live_example'}));assert.equal(await launch,false);assert.deepEqual(redirects,[]);
});

test('checkout return markers never create paid orders and survive an in-flight catalog load',async()=>{
 const parsed=consumeShopReturn('https://pawprint.example/?order=success&keep=1#shop');assert.deepEqual(parsed,{intent:'success',cleanURL:'https://pawprint.example/?keep=1#shop'});
 assert.equal(consumeShopReturn('https://pawprint.example/?order=paid').intent,null);
 const pending=delayed(),f=fixture({fetchImpl:async url=>url.endsWith('catalog')?pending.promise:response({orders:[]})});
 const load=f.client.load();f.client.load({returnIntent:'success'});assert.equal(f.client.getState().returnIntent,'success');pending.resolve(response(catalog));await load;
 assert.deepEqual(f.client.getState().orders,[]);assert.equal(f.client.getState().returnIntent,'success');const html=shopContent(f.client.getState(),{account:{id:'owner-a'}});assert.match(html,/No payment confirmed yet/);assert.doesNotMatch(html,/Payment confirmed/);
});

test('only owner server orders are displayed and malformed orders never become paid receipts',async()=>{
 const values=[order,{...order,id:'foreign-product',productId:'unknown'},{...order,id:'bad-amount',amount:'31100'},{...order,id:'unknown-status',status:'delivered'}, {...order,id:'dispute',status:'disputed'}];
 const f=fixture({fetchImpl:async url=>response(url.endsWith('catalog')?catalog:{orders:values})});await f.client.load();assert.deepEqual(f.client.getState().orders.map(item=>item.id),['order123','dispute']);
 const html=shopContent(f.client.getState(),{account:{id:'owner-a'}});assert.match(html,/Payment confirmed/);assert.match(html,/Payment under review/);assert.doesNotMatch(html,/delivered/);
});

test('price formatting, no invented unavailable price, and explicit shipping total are clear',()=>{
 assert.equal(formatShopPrice({amount:29900,currency:'cny'}),'CN¥299.00');assert.equal(formatShopPrice(null),null);
 const empty=shopContent({loaded:true,products:[]},{account:{id:'owner-a'}});assert.match(empty,/Price coming soon/);assert.doesNotMatch(empty,/CN¥|£|\$|RMB/);assert.match(empty,/data-shop-buy disabled/);
 const html=shopContent({loaded:true,canBuy:true,products:[product],shipping:catalog.shipping,orders:[]},{account:{id:'owner-a'}});assert.match(html,/CN¥299.00/);assert.match(html,/CN¥12.00/);assert.match(html,/data-shop-buy >/);
 const zero=shopContent({loaded:true,canBuy:true,products:[product],shipping:{...catalog.shipping,amount:0},orders:[]},{account:{id:'owner-a'}});assert.match(zero,/Included/);
});


test('unresolved older checkout asks for support instead of encouraging another payment',async()=>{
 const f=fixture({fetchImpl:async url=>url.endsWith('checkout')?response({error:{code:'checkout_reconciliation_required'}},409):response(url.endsWith('catalog')?catalog:{orders:[]})});
 await f.client.load();assert.equal(await f.client.checkout(),false);assert.equal(f.client.getState().error,'checkout_reconciliation_required');
 assert.match(shopContent(f.client.getState(),{account:{id:'owner-a'}}),/contact support before trying again/);
 assert.match(shopContent(f.client.getState(),{account:{id:'owner-a'},language:'zh'}),/此前的结账需要核实，请联系支持后再尝试购买/);
});
