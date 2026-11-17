import test from 'node:test';
import assert from 'node:assert/strict';
import { createLiquidSelection, liquidSelectionFrames } from '../dist/liquid-selection.js';

function fixture({reduce=false,vertical=false}={}) {
  const callbacks=[],listeners=new Map(),rootListeners=new Map(),observers=[],activated=[];
  const classes=()=>{const set=new Set();return {add:(...names)=>names.forEach(n=>set.add(n)),remove:(...names)=>names.forEach(n=>set.delete(n)),toggle:(name,value)=>value?set.add(name):set.delete(name),contains:name=>set.has(name)};};
  const win={performance:{now:()=>100},emit:(key,event)=>listeners.get(key)?.(event),getComputedStyle:()=>({borderRadius:'18px'}),matchMedia:()=>({matches:reduce}),requestAnimationFrame:fn=>{callbacks.push(fn);return callbacks.length;},cancelAnimationFrame(){},addEventListener:(key,fn)=>listeners.set(key,fn),removeEventListener:key=>listeners.delete(key),ResizeObserver:class{constructor(fn){this.fn=fn;this.observed=new Set();observers.push(this);}observe(x){this.observed.add(x);}unobserve(x){this.observed.delete(x);}disconnect(){this.observed.clear();}}};
  let group;
  const root={width:300,addEventListener:(key,fn)=>rootListeners.set(key,fn),removeEventListener:key=>rootListeners.delete(key),emit:(key,event)=>rootListeners.get(key)?.(event),setPointerCapture(id){this.capture=id;},hasPointerCapture(id){return this.capture===id;},releasePointerCapture(){this.capture=null;},ownerDocument:{defaultView:win,createElement:()=>surface()},querySelector:()=>group,getBoundingClientRect(){return {width:this.width};}};
  const surface=()=>({style:{},attributes:{},classList:classes(),setAttribute(k,v){this.attributes[k]=v;},remove(){this.parent.children=this.parent.children.filter(x=>x!==this);},getBoundingClientRect(){if(this.visual)return this.visual;return {left:this.parent.left+this.parent.clientLeft+parseFloat(this.style.left)-this.parent.scrollLeft,top:this.parent.top+this.parent.clientTop+parseFloat(this.style.top)-this.parent.scrollTop,width:parseFloat(this.style.width),height:parseFloat(this.style.height)};},animate(frames,options){this.lastAnimation={frames,options,playState:'running',cancel(){this.playState='idle';}};return this.lastAnimation;}});
  function makeGroup(selected=0) {
    const result={isConnected:true,left:10,top:20,width:300,clientLeft:1,clientTop:1,scrollLeft:0,scrollTop:0,children:[],attributes:{},setAttribute(k,v){this.attributes[k]=v;},removeAttribute(k){delete this.attributes[k];},getBoundingClientRect(){return {left:this.left,top:this.top,width:this.width,height:60};},append(node){node.parent=this;this.children.push(node);},querySelector(){return this.choices[this.selected]||null;},querySelectorAll(selector){return selector==='.liquid-choice'?this.choices.filter(x=>x.classList.contains('liquid-choice')):this.choices;},selected};
    result.choices=[0,1,2].map((id)=>({id:'choice-'+id,classList:classes(),getAttribute(){return null;},contains(target){return target===this;},click(){activated.push(id);controller.capture();result.selected=id;controller.sync();},getBoundingClientRect(){return {left:result.left+1+(vertical?0:id*100)-result.scrollLeft,top:result.top+1+(vertical?id*100:0)-result.scrollTop,width:100,height:40};}}));
    return result;
  }
  group=makeGroup();
  const controller=createLiquidSelection(root,[{id:'choice',group:'.group',selected:'.selected'}]);
  return {controller,root,win,observers,listeners,rootListeners,activated,flush:()=>{while(callbacks.length)callbacks.shift()();},get group(){return group;},replace(selected=0){group.isConnected=false;group=makeGroup(selected);return group;},surface:()=>group.children[0]};
}

test('the first selection is stationary and rerendering moves a single glass surface to the new option',()=>{
  const f=fixture();f.controller.sync();
  assert.equal(f.group.children.length,1);assert.equal(f.surface().lastAnimation,undefined);
  assert.equal(f.surface().attributes['aria-hidden'],'true');
  f.controller.capture();f.replace(1);f.controller.sync();
  assert.equal(f.group.children.length,1);assert.equal(f.surface().style.left,'100px');
  assert.equal(f.surface().lastAnimation.frames[0].transform,'translate(-100px, 0px) scale(1, 1)');
  assert.equal(f.surface().lastAnimation.options.duration,720);
  assert.equal(f.group.choices[1].classList.contains('liquid-selected'),true);
});

test('rapid reselection continues from the visible animated position, not the previous target',()=>{
  const f=fixture();f.controller.sync();f.controller.capture();f.replace(1);f.controller.sync();
  const previous=f.surface().lastAnimation;
  f.surface().visual={left:61,top:21,width:104,height:39};
  f.controller.capture();assert.equal(previous.playState,'idle');f.replace(2);f.controller.sync();
  assert.equal(f.surface().lastAnimation.frames[0].transform,'translate(-150px, 0px) scale(1.04, 0.975)');
  assert.equal(f.group.children.length,1);
});

test('native same-DOM radio changes reuse the surface, and reduced motion settles immediately',()=>{
  const f=fixture({reduce:true});f.controller.sync();const surface=f.surface();
  f.group.selected=1;f.controller.capture();f.controller.sync();
  assert.equal(f.surface(),surface);assert.equal(surface.style.left,'100px');assert.equal(surface.lastAnimation,undefined);
  assert.equal(f.group.choices[0].classList.contains('liquid-selected'),false);
  assert.equal(f.group.choices[1].classList.contains('liquid-selected'),true);
});

test('scroll offsets survive a group replacement so the droplet remains aligned in scrollable choices',()=>{
  const f=fixture();f.controller.sync();f.group.scrollLeft=80;f.group.scrollTop=12;
  f.controller.capture();f.replace(2);f.controller.sync();
  assert.equal(f.group.scrollLeft,80);assert.equal(f.group.scrollTop,12);
  assert.equal(f.surface().style.left,'200px');assert.equal(f.surface().style.top,'0px');
});

test('initial and height-only resize callbacks do not cancel motion; real group-width changes remeasure it',()=>{
  const f=fixture();f.controller.sync();f.controller.capture();f.replace(1);f.controller.sync();
  const animation=f.surface().lastAnimation;
  f.observers[0].fn();f.flush();assert.equal(animation.playState,'running');
  f.group.width=250;f.observers[0].fn();f.flush();assert.equal(animation.playState,'idle');
  assert.equal(f.observers[0].observed.has(f.group),true);
});

test('removing a selection or destroying the controller cleans up the surface and native style overrides',()=>{
  const f=fixture();f.controller.sync();f.group.selected=-1;f.controller.sync();
  assert.equal(f.group.children.length,0);assert.equal('data-liquid-ready' in f.group.attributes,false);
  assert.equal(f.group.choices.some(x=>x.classList.contains('liquid-choice')),false);
  f.group.selected=0;f.controller.sync();f.controller.destroy();
  assert.equal(f.group.children.length,0);assert.equal(f.observers[0].observed.size,0);assert.equal(f.listeners.size,0);
});

test('vertical moves stretch along the travel direction and finish exactly at the selected bounds',()=>{
  const frames=liquidSelectionFrames({x:0,y:0,width:80,height:100},{x:0,y:220,width:80,height:58});
  assert.equal(frames[0].transform,'translate(0px, -220px) scale(1, 1.7241379310344827)');
  assert.equal(frames.at(-1).transform,'translate(0px, 0px) scale(1, 1)');
  assert.equal(frames.at(-1).offset,1);
});


function pointer(x,y=25,extra={}) {
  return {pointerId:1,pointerType:'touch',button:0,isPrimary:true,clientX:x,clientY:y,cancelable:true,detail:1,
    prevented:false,stopped:false,preventDefault(){this.prevented=true;},stopImmediatePropagation(){this.stopped=true;},...extra};
}
function press(f,x=61,y=41,index=0) {
  const event=pointer(x,y,{target:f.group.choices[index]});f.win.emit('pointerdown',event);f.root.emit('pointerdown',event);return event;
}

test('held glass follows the finger continuously and commits the nearest option only on release',()=>{
  const f=fixture();f.controller.sync();press(f);
  f.win.emit('pointermove',pointer(106,41));
  assert.equal(f.surface().style.left,'45px');assert.deepEqual(f.activated,[]);
  f.win.emit('pointermove',pointer(146,41));
  assert.equal(f.surface().style.left,'85px');assert.deepEqual(f.activated,[]);
  f.win.emit('pointerup',pointer(146,41));
  assert.deepEqual(f.activated,[1]);assert.equal(f.surface().style.left,'100px');
  assert.equal(f.surface().lastAnimation.frames[0].transform,'translate(-15px, 0px) scale(1, 1)');
  assert.equal(f.surface().lastAnimation.options.duration,720);
  const trailing=pointer(146);f.root.emit('click',trailing);assert.equal(trailing.prevented,true);
  const keyboard=pointer(146,25,{detail:0});f.root.emit('click',keyboard);assert.equal(keyboard.prevented,false);
});

test('ordinary taps and cross-axis scrolling do not commit a drag or suppress clicks',()=>{
  const f=fixture();f.controller.sync();press(f);f.win.emit('pointerup',pointer(64,43));
  const tap=pointer(64);f.root.emit('click',tap);assert.equal(tap.prevented,false);assert.deepEqual(f.activated,[]);
  press(f);const verticalMove=pointer(64,100);f.win.emit('pointermove',verticalMove);f.win.emit('pointermove',pointer(160,100));f.win.emit('pointerup',pointer(160,100));
  assert.equal(verticalMove.prevented,false);assert.deepEqual(f.activated,[]);assert.equal(f.surface().style.left,'0px');
});

test('vertical sidebar drags start only from selected choice and settle to a new row',()=>{
  const f=fixture({vertical:true});f.controller.sync();
  assert.equal(f.group.attributes['data-liquid-drag-axis'],'y');
  press(f,61,141,1);const scrolling=pointer(61,220);f.win.emit('pointermove',scrolling);f.win.emit('pointerup',pointer(61,220));
  assert.equal(scrolling.prevented,false);assert.deepEqual(f.activated,[]);
  press(f);f.win.emit('pointermove',pointer(61,125));assert.equal(f.surface().style.top,'84px');
  f.win.emit('pointerup',pointer(61,125));assert.deepEqual(f.activated,[1]);assert.equal(f.surface().style.top,'100px');
});

test('cancel, multitouch, blur and lost capture restore the selected option without committing',()=>{
  for(const reason of ['pointercancel','blur','lostpointercapture','second-pointer']) {
    const f=fixture();f.controller.sync();press(f);f.win.emit('pointermove',pointer(145,41));
    if(reason==='lostpointercapture')f.root.emit(reason,pointer(145,41,{target:f.root}));
    else if(reason==='second-pointer')f.win.emit('pointerdown',pointer(145,41,{pointerId:2,isPrimary:false}));
    else f.win.emit(reason,reason==='blur'?{}:pointer(145,41));
    f.win.emit('pointerup',pointer(145,41));
    assert.deepEqual(f.activated,[],reason);assert.equal(f.surface().style.left,'0px',reason);
    assert.equal('data-liquid-dragging' in f.group.attributes,false,reason);
  }
});

test('disabled choices are skipped, motion preferences settle immediately, and teardown removes all listeners',()=>{
  const f=fixture({reduce:true});f.controller.sync();f.group.choices[1].disabled=true;
  press(f);f.win.emit('pointermove',pointer(231,41));f.win.emit('pointerup',pointer(231,41));
  assert.deepEqual(f.activated,[2]);assert.equal(f.surface().lastAnimation,undefined);
  f.controller.destroy();assert.equal(f.listeners.size,0);assert.equal(f.rootListeners.size,0);
  assert.equal('data-liquid-drag-axis' in f.group.attributes,false);
});


test('implicit child capture transfer does not cancel a held glass drag',()=>{
  const f=fixture();f.controller.sync();press(f);f.win.emit('pointermove',pointer(105,41));
  f.root.emit('lostpointercapture',pointer(105,41,{target:f.group.choices[0]}));
  f.win.emit('pointermove',pointer(145,41));assert.equal(f.surface().style.left,'84px');
  f.win.emit('pointerup',pointer(145,41));assert.deepEqual(f.activated,[1]);
});


test('a new deliberate tap after dragging is not swallowed by the previous release shield',()=>{
  const f=fixture({vertical:true});f.controller.sync();press(f);f.win.emit('pointermove',pointer(61,125));f.win.emit('pointerup',pointer(61,125));
  press(f,61,241,2);f.win.emit('pointerup',pointer(61,241));
  const tap=pointer(61,241,{target:f.group.choices[2]});f.root.emit('click',tap);
  assert.equal(tap.prevented,false);
});


test('focus moving between buttons does not cancel an active pointer gesture',()=>{
  const f=fixture();f.controller.sync();press(f);
  f.win.emit('blur',{target:f.group.choices[2]});
  f.win.emit('pointermove',pointer(146,41));assert.equal(f.surface().style.left,'85px');
  f.win.emit('pointerup',pointer(146,41));assert.deepEqual(f.activated,[1]);
});


test('dragging after a rapid click anchors to the pressed option rather than the in-flight old glass position',()=>{
  const f=fixture();f.controller.sync();f.controller.capture();f.group.selected=1;f.controller.sync();
  f.surface().visual={left:51,top:21,width:100,height:40};
  press(f,161,41,1);f.win.emit('pointermove',pointer(261,41));
  assert.equal(f.surface().style.left,'200px');
  delete f.surface().visual;
  f.win.emit('pointerup',pointer(261,41));assert.deepEqual(f.activated,[2]);
});

test('native image or text dragging inside a choice cannot steal the liquid pointer gesture',()=>{
  const f=fixture();f.controller.sync();
  const image={};f.group.choices[0].contains=target=>target===image;
  const imageDrag=pointer(61,41,{target:image});f.root.emit('dragstart',imageDrag);
  assert.equal(imageDrag.prevented,true);
  const elsewhere=pointer(61,41,{target:{}});f.root.emit('dragstart',elsewhere);
  assert.equal(elsewhere.prevented,false);
});


test('overflowing horizontal filters preserve native panning from unselected chips',()=>{
  const f=fixture();f.group.scrollWidth=500;f.group.clientWidth=300;f.controller.sync();
  assert.equal('data-liquid-scrollable' in f.group.attributes,true);
  press(f,161,41,1);const nativePan=pointer(61,41);f.win.emit('pointermove',nativePan);f.win.emit('pointerup',pointer(61,41));
  assert.equal(nativePan.prevented,false);assert.deepEqual(f.activated,[]);
  press(f);const held=pointer(146,41);f.win.emit('pointermove',held);assert.equal(held.prevented,true);
  f.win.emit('pointerup',pointer(146,41));assert.deepEqual(f.activated,[1]);
  f.group.scrollWidth=300;f.controller.sync();assert.equal('data-liquid-scrollable' in f.group.attributes,false);
});
