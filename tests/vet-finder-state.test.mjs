import test from 'node:test';
import assert from 'node:assert/strict';
class Node {
 handlers=new Map(); value=''; disabled=false; dataset={}; innerHTML='';
 classList={add(){},remove(){},contains(){return false;},toggle(){}};
 addEventListener(type,fn){if(!this.handlers.has(type))this.handlers.set(type,new Set());this.handlers.get(type).add(fn);}
 removeEventListener(type,fn){this.handlers.get(type)?.delete(fn);}
 emit(type,event={}){for(const fn of this.handlers.get(type)||[])fn(event);}
 setAttribute(){} focus(){} querySelector(){return null;} querySelectorAll(){return [];}
}
const win=new Node(),dialog=new Node(),body=new Node(),input=new Node(),form=new Node(),location=new Node(),radius=new Node(),status=new Node(),host=new Node(),retry=new Node();
const close=new Node();dialog.open=false;
dialog.querySelector=selector=>({'.sheet-body':body,'#vet-town':input,'.vet-search-form':form,'[data-use-location]':location,'[data-vet-radius]':radius,'[data-vet-status]':status,'[data-vet-results]':host,'#sheet-close':close}[selector]||null);
dialog.querySelectorAll=()=>[input,location,radius];
host.querySelector=selector=>selector==='[data-vet-retry]'?retry:null;
dialog.showModal=()=>{dialog.open=true;};dialog.close=()=>{dialog.open=false;dialog.emit('close');};
const document={defaultView:win,getElementById:id=>({'app-sheet':dialog,'sheet-close':close,'sheet-title':new Node(),'sheet-eyebrow':new Node()}[id]),getSelection:()=>({isCollapsed:true})};
dialog.ownerDocument=document;globalThis.window=win;globalThis.document=document;
const {initVetFinder}=await import('../dist/vet-finder.js');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
test('failed clinic searches replace loading content with an actionable retry and restore controls',async()=>{
 const originalFetch=globalThis.fetch;const requested=[];
 globalThis.fetch=async url=>{requested.push(String(url));return{ok:false,json:async()=>({message:'Location provider unavailable.'})};};
 try{
  const finder=initVetFinder();finder.open();input.value='London';form.emit('submit',{preventDefault(){}});
  assert.match(host.innerHTML,/Finding clinics/);assert.equal(input.disabled,true);
  await tick();
  assert.equal(input.disabled,false);assert.match(status.textContent,/Location provider unavailable/);
  assert.doesNotMatch(host.innerHTML,/Finding clinics/);assert.match(host.innerHTML,/Search unavailable/);assert.match(host.innerHTML,/Try again/);
  retry.emit('click');await tick();assert.equal(requested.length,2);assert.ok(requested.every(url=>url.includes('q=London')&&url.includes('radiusKm=10')));
  assert.equal(input.disabled,false);assert.doesNotMatch(host.innerHTML,/Finding clinics/);
 }finally{globalThis.fetch=originalFetch;dialog.close();}
});
