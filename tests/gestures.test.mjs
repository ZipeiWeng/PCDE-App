import test from 'node:test';
import assert from 'node:assert/strict';
import { installPageGestures } from '../dist/gestures.js';

class Surface {
  handlers = new Map();
  addEventListener(type, callback) {
    if (!this.handlers.has(type)) this.handlers.set(type, new Set());
    this.handlers.get(type).add(callback);
  }
  emit(type, event) { for (const callback of this.handlers.get(type) || []) callback(event); }
}

function harness(t) {
  const root=new Surface(), win=new Surface(), doc=new Surface(), steps=[];
  let enabled=true;
  const originalWindow=globalThis.window, originalDocument=globalThis.document;
  globalThis.window=win;globalThis.document=doc;
  t.after(()=>{
    if(originalWindow===undefined)delete globalThis.window;else globalThis.window=originalWindow;
    if(originalDocument===undefined)delete globalThis.document;else globalThis.document=originalDocument;
  });
  installPageGestures(root,{enabled:()=>enabled,onSwipe:step=>steps.push(step)});
  const target=(...ancestors)=>({closest:query=>query.split(',').some(selector=>ancestors.includes(selector))?{}:null});
  function event(x,y,origin){
    return {pointerId:1,pointerType:'touch',button:0,clientX:x,clientY:y,target:origin,cancelable:true,
      prevented:false,stopped:false,preventDefault(){this.prevented=true;},stopPropagation(){this.stopped=true;},stopImmediatePropagation(){this.stopped=true;}};
  }
  function drag(origin,dx,dy=0){
    const down=event(100,100,origin);root.emit('pointerdown',down);
    down.stopPropagation(); // Target bubble cannot undo the root's capture listener.
    const move=event(100+dx,100+dy,origin);root.emit('pointermove',move);
    const up=event(100+dx,100+dy,origin);win.emit('pointerup',up);
    const click=event(100+dx,100+dy,origin);root.emit('click',click);
    return {move,up,click};
  }
  return {steps,target,drag,enable:value=>{enabled=value;}};
}

test('touch drags across tutorial Next and coach illustrations do not navigate or consume the tutorial click',t=>{
  const h=harness(t);
  for(const origin of [h.target('.coach-layer','button'),h.target('.coach-layer')]){
    for(const dx of [-60,60]){
      const result=h.drag(origin,dx);
      assert.deepEqual(h.steps,[]);
      assert.equal(result.move.prevented,false);
      assert.equal(result.click.prevented,false);
      assert.equal(result.click.stopped,false);
    }
  }
});

test('native controls retain taps and horizontal drags without switching the home page',t=>{
  const h=harness(t);
  for(const tag of ['button','a','summary','input','select','textarea']){
    for(const dx of [3,-60,60]){
      const result=h.drag(h.target(tag),dx);
      assert.deepEqual(h.steps,[]);
      assert.equal(result.move.prevented,false);
      assert.equal(result.click.prevented,false);
    }
  }
});

test('blank areas still swipe in both directions and shield only the trailing swipe click',t=>{
  const h=harness(t);
  for(const dx of [-60,60]){
    const result=h.drag(h.target(),dx);
    assert.equal(result.move.prevented,true);
    assert.equal(result.click.prevented,true);
  }
  assert.deepEqual(h.steps,[1,-1]);
});

test('the central orb keeps its tap and horizontal page swipe, gated by tutorial navigation',t=>{
  const h=harness(t), orb={id:'wellness-orb'};
  // Current markup is a div[role=button]; a native-button implementation must
  // preserve the same behavior, including gestures on its score/visual children.
  const origins=[h.target('#wellness-orb'),{closest:query=>query.split(',').includes('button')?orb:null}];
  for(const origin of origins){
    h.enable(false);
    const blocked=h.drag(origin,60);
    assert.equal(blocked.move.prevented,false);
  }
  assert.deepEqual(h.steps,[],'earlier guide steps cannot navigate through the orb');
  h.enable(true);
  assert.equal(h.drag(origins[1],3).click.prevented,false,'a tap can still open orb details');
  for(const origin of origins){
    for(const dx of [-60,60]){
      const result=h.drag(origin,dx);
      assert.equal(result.move.prevented,true);
      assert.equal(result.click.prevented,true,'the completed swipe cannot also open details');
    }
  }
  assert.deepEqual(h.steps,[1,-1,1,-1]);
});

test('an orb button exception never bypasses coach-layer gesture ownership',t=>{
  const h=harness(t), orb={id:'wellness-orb'};
  const origin={closest:query=>query.split(',').includes('.coach-layer')?{}:query.split(',').includes('button')?orb:null};
  const result=h.drag(origin,60);
  assert.deepEqual(h.steps,[]);
  assert.equal(result.move.prevented,false);assert.equal(result.click.prevented,false);
});
