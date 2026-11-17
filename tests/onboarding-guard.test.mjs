import test from 'node:test';
import assert from 'node:assert/strict';
import {createOnboardingGuard,onboardingTargetAccess} from '../dist/onboarding-guard.js';

class Surface {
  handlers=new Map();
  addEventListener(type,fn){if(!this.handlers.has(type))this.handlers.set(type,new Set());this.handlers.get(type).add(fn);}
  removeEventListener(type,fn){this.handlers.get(type)?.delete(fn);}
  emit(type,event){event.type=type;for(const fn of this.handlers.get(type)||[]){fn(event);if(event.immediateStopped)break;}return event;}
}
function fixture(){
  const doc=new Surface(),layer=new Surface();
  layer.contains=node=>Boolean(node?.overlay);
  const nodes=[];
  const node=(name,{tag='div',matches=[],overlay=false,hidden=false}={})=>{
    const item={name,tag,overlay,disabled:false,tabIndex:tag==='button'||tag==='input'?0:-1,
      closest(selector){return selector.split(',').some(part=>{
        part=part.trim();
        if(matches.includes(part))return true;
        if(part==='button'&&tag==='button')return true;
        if(part==='input'&&tag==='input')return true;
        if(part.startsWith('input:not(')&&tag==='input')return true;
        if(part==='[hidden]'&&hidden)return true;
        return false;
      })?this:null;},
      getClientRects:()=>hidden?[]:[{}],
      focus(){doc.activeElement=this;},blur(){doc.activeElement=null;},
    };nodes.push(item);return item;
  };
  const next=node('next',{tag:'button',matches:['[data-coach-continue]'],overlay:true});
  const close=node('close',{tag:'button',matches:['#close']});
  const unrelated=node('unrelated',{tag:'button',matches:['.sheet']});
  const sheet=node('sheet',{matches:['.sheet']});
  const form=node('form',{matches:['.search']});
  const input=node('input',{tag:'input',matches:['.search']});
  doc.querySelectorAll=()=>nodes;doc.activeElement=next;
  let current={allowedSelectors:'#close,.search',gestureSelectors:'.sheet',scrollSelectors:'.sheet'};
  const guard=createOnboardingGuard({doc,layer,getPolicy:()=>current});guard.mount();
  const event=(target,extra={})=>({target,cancelable:true,detail:1,pointerId:1,
    preventDefault(){this.prevented=true;},stopImmediatePropagation(){this.immediateStopped=true;},stopPropagation(){this.stopped=true;},...extra});
  return{doc,layer,node,next,close,unrelated,sheet,form,input,guard,event,setPolicy:value=>{current=value;}};
}

test('swipe and scrolling permission do not enable unrelated controls inside the surface',()=>{
  const f=fixture();
  assert.equal(onboardingTargetAccess(f.sheet,{gestureSelectors:'.sheet'},f.layer).gesture,true);
  assert.equal(onboardingTargetAccess(f.unrelated,{gestureSelectors:'.sheet'},f.layer).gesture,false);
  for(const type of ['click','pointerdown','mousedown','touchstart','keydown','change','submit']){
    const event=f.doc.emit(type,f.event(f.unrelated,{key:'Enter'}));
    assert.equal(event.prevented,true,type);assert.equal(event.immediateStopped,true,type);
  }
  f.guard.destroy();
});

test('current controls and text entry keep native activation and focus without preventing touch',()=>{
  const f=fixture();
  for(const target of [f.next,f.close,f.input]){
    for(const type of ['pointerdown','pointerup','touchstart','touchend','click']){
      assert.equal(f.doc.emit(type,f.event(target)).prevented,undefined,`${target.name}:${type}`);
    }
  }
  assert.equal(f.doc.emit('submit',f.event(f.form)).prevented,undefined);
  assert.equal(f.doc.emit('keydown',f.event(f.input,{key:'ArrowLeft'})).prevented,undefined);
  assert.equal(f.doc.emit('input',f.event(f.input)).prevented,undefined);
  f.guard.destroy();
});

test('a contact starting outside permitted controls stays blocked through release and click',()=>{
  const f=fixture();
  f.doc.emit('pointerdown',f.event(f.unrelated));
  assert.equal(f.doc.emit('pointermove',f.event(f.close)).prevented,true);
  assert.equal(f.doc.emit('pointerup',f.event(f.close)).prevented,true);
  assert.equal(f.doc.emit('click',f.event(f.close)).prevented,true);
  f.doc.emit('pointerdown',f.event(f.close));
  assert.equal(f.doc.emit('pointerup',f.event(f.close)).prevented,undefined);
  assert.equal(f.doc.emit('click',f.event(f.close)).prevented,undefined);
  f.guard.destroy();
});

test('scene permission changes take effect during a contact and on keyboard activation',()=>{
  const f=fixture();
  f.doc.emit('pointerdown',f.event(f.close));
  f.setPolicy({allowedSelectors:'.search'});
  assert.equal(f.doc.emit('pointerup',f.event(f.close)).prevented,true);
  assert.equal(f.doc.emit('keydown',f.event(f.close,{key:'Enter'})).prevented,true);
  assert.equal(f.doc.emit('click',f.event(f.close,{detail:0})).prevented,true);
  f.guard.destroy();
});

test('only the active scroll region scrolls and navigation keys stay locked outside exploration',()=>{
  const f=fixture();
  assert.equal(f.doc.emit('wheel',f.event(f.sheet)).prevented,undefined);
  assert.equal(f.doc.emit('wheel',f.event(f.next)).prevented,true);
  assert.equal(f.doc.emit('keydown',f.event(f.sheet,{key:'ArrowLeft'})).prevented,true);
  f.setPolicy({allowNavigationKeys:true});
  assert.equal(f.doc.emit('keydown',f.event(f.sheet,{key:'ArrowLeft'})).prevented,undefined);
  assert.equal(f.doc.emit('keydown',f.event(f.next,{key:'ArrowLeft'})).prevented,true);
  f.guard.destroy();
});

test('Tab cycles only through allowed visible controls and focus cannot escape',()=>{
  const f=fixture();
  f.node('hidden',{tag:'button',matches:['#close'],hidden:true});
  f.doc.emit('keydown',f.event(f.next,{key:'Tab'}));assert.equal(f.doc.activeElement,f.close);
  f.doc.emit('keydown',f.event(f.close,{key:'Tab'}));assert.equal(f.doc.activeElement,f.input);
  f.doc.emit('keydown',f.event(f.input,{key:'Tab'}));assert.equal(f.doc.activeElement,f.next);
  f.doc.emit('keydown',f.event(f.next,{key:'Tab',shiftKey:true}));assert.equal(f.doc.activeElement,f.input);
  f.doc.activeElement=f.unrelated;f.doc.emit('focusin',f.event(f.unrelated));assert.equal(f.doc.activeElement,f.next);
  f.guard.destroy();
});

test('coach pointer bubbling is shielded while click handlers remain active; teardown restores app',()=>{
  const f=fixture();
  assert.equal(f.layer.emit('pointerdown',f.event(f.next)).stopped,true);
  assert.equal(f.layer.emit('click',f.event(f.next)).stopped,undefined);
  f.guard.destroy();
  assert.equal(f.doc.emit('click',f.event(f.unrelated)).prevented,undefined);
  assert.equal(f.doc.emit('keydown',f.event(f.unrelated,{key:'Tab'})).prevented,undefined);
  f.guard.mount();
  assert.equal(f.doc.emit('click',f.event(f.unrelated)).prevented,true);
  f.guard.destroy();
});

test('explicit denied links stay locked inside an otherwise interactive map',()=>{
  const f=fixture();
  const map=f.node('map',{matches:['.map']});
  const attribution=f.node('attribution',{matches:['.map','a[href]']});
  f.setPolicy({allowedSelectors:'.map',scrollSelectors:'.map',gestureSelectors:'.map',deniedSelectors:'a[href]'});
  assert.equal(f.doc.emit('click',f.event(map)).prevented,undefined);
  for(const type of ['pointerdown','click','keydown'])assert.equal(f.doc.emit(type,f.event(attribution,{key:'Enter',detail:0})).prevented,true,type);
  assert.deepEqual(onboardingTargetAccess(attribution,{allowedSelectors:'.map',scrollSelectors:'.map',gestureSelectors:'.map',deniedSelectors:'a[href]'},f.layer),{control:false,gesture:false,scroll:false,overlay:false});
  f.setPolicy({allowedSelectors:'.map',deniedSelectors:'a[href]',allowNavigationKeys:true});
  assert.equal(f.doc.emit('keydown',f.event(attribution,{key:'ArrowRight'})).prevented,true);
  f.guard.destroy();
});

test('allowed tab and map widgets retain their own arrow keys without enabling unrelated controls',()=>{
  const f=fixture();
  const tab=f.node('tab',{tag:'button',matches:['[data-card-tab]']});
  const map=f.node('map',{matches:['.map','.map[tabindex]']});
  f.setPolicy({allowedSelectors:'[data-card-tab],.map,#close',keyboardSelectors:'[data-card-tab],.map[tabindex]'});
  for(const key of ['ArrowLeft','ArrowRight','Home','End']){
    assert.equal(f.doc.emit('keydown',f.event(tab,{key})).prevented,undefined,key);
    assert.equal(f.doc.emit('keydown',f.event(map,{key})).prevented,undefined,key);
    assert.equal(f.doc.emit('keydown',f.event(f.unrelated,{key})).prevented,true,key);
    assert.equal(f.doc.emit('keydown',f.event(f.close,{key})).prevented,true,key);
  }
  f.guard.destroy();
});

test('an explicit gesture-only control accepts a swipe origin without enabling its click',()=>{
  const f=fixture();
  const orb=f.node('orb',{tag:'button',matches:['#wellness-orb','#page-track']});
  const another=f.node('another',{tag:'button',matches:['#page-track']});
  f.setPolicy({gestureSelectors:'#page-track',gestureControlSelectors:'#wellness-orb'});
  assert.equal(onboardingTargetAccess(orb,{gestureSelectors:'#page-track',gestureControlSelectors:'#wellness-orb'},f.layer).gesture,true);
  for(const type of ['pointerdown','pointermove','pointerup'])assert.equal(f.doc.emit(type,f.event(orb)).prevented,undefined,type);
  assert.equal(f.doc.emit('click',f.event(orb)).prevented,true);
  assert.equal(f.doc.emit('pointerdown',f.event(another)).prevented,true);
  f.guard.destroy();
});

test('Activity remains keyboard-scrollable while focus is on the End tour overlay',()=>{
  const f=fixture();
  const endTour=f.node('end tour',{tag:'button',matches:['[data-coach-skip]'],overlay:true});
  const scroll={scrollTop:40,scrollHeight:1700,clientHeight:500};
  f.setPolicy({scrollElement:scroll,scrollSelectors:'.sheet'});
  endTour.focus();
  for(const [key,expected] of [['ArrowDown',96],['PageDown',496],['PageUp',96],['ArrowUp',40],['End',1700],['Home',0]]){
    const event=f.doc.emit('keydown',f.event(endTour,{key}));
    assert.equal(event.prevented,true,key);
    assert.equal(scroll.scrollTop,expected,key);
    assert.equal(f.doc.activeElement,endTour,'scrolling must preserve control focus');
  }
  assert.equal(f.doc.emit('keydown',f.event(endTour,{key:'ArrowRight'})).prevented,true);
  assert.equal(f.doc.emit('click',f.event(endTour)).prevented,undefined,'End tour still works');
  f.guard.destroy();
});

test('Activity scroll shortcuts do not consume editing keys in an allowed input',()=>{
  const f=fixture(),scroll={scrollTop:100,scrollHeight:1700,clientHeight:500};
  f.setPolicy({scrollElement:scroll,allowedSelectors:'.search'});
  for(const key of ['ArrowDown','ArrowUp','Home','End']){
    assert.equal(f.doc.emit('keydown',f.event(f.input,{key})).prevented,undefined,key);
    assert.equal(scroll.scrollTop,100,key);
  }
  f.guard.destroy();
});

test('Activity summaries allow a scroll to start without enabling collapse or unrelated controls',()=>{
  const f=fixture();
  const summary=f.node('summary',{tag:'summary',matches:['summary','.sheet','#data-screen summary']});
  f.setPolicy({scrollSelectors:'.sheet',scrollControlSelectors:'#data-screen summary'});
  for(const type of ['pointerdown','pointermove','pointerup','touchstart','touchmove','touchend']){
    assert.equal(f.doc.emit(type,f.event(summary)).prevented,undefined,type);
  }
  assert.equal(f.doc.emit('click',f.event(summary)).prevented,true);
  assert.equal(f.doc.emit('keydown',f.event(summary,{key:'Enter'})).prevented,true);
  assert.equal(f.doc.emit('pointerdown',f.event(f.unrelated)).prevented,true);
  f.guard.destroy();
});

test('dedicated return lesson grants artwork swipe access without unlocking its click or underlying controls',()=>{
  const f=fixture(),artwork=f.node('swipe animation',{overlay:true});
  f.setPolicy({overlaySwipe:true});
  assert.deepEqual(onboardingTargetAccess(artwork,{overlaySwipe:true},f.layer),{control:false,gesture:true,scroll:false,overlay:true});
  for(const type of ['pointerdown','pointermove','pointerup','touchstart','touchmove','touchend']){
    assert.equal(f.doc.emit(type,f.event(artwork)).prevented,undefined,type);
  }
  assert.equal(f.layer.emit('pointerdown',f.event(artwork)).stopped,true,'the owned contact does not bubble to the app');
  assert.equal(f.doc.emit('click',f.event(artwork)).prevented,true);
  assert.equal(f.doc.emit('pointerdown',f.event(f.unrelated)).prevented,true);
  f.doc.emit('pointerdown',f.event(f.next));f.doc.emit('pointerup',f.event(f.next));
  assert.equal(f.doc.emit('click',f.event(f.next)).prevented,undefined,'guide controls remain available');
  assert.equal(onboardingTargetAccess(f.next,{overlaySwipe:true},f.layer).gesture,false,'buttons never become swipe surfaces');
  f.guard.destroy();
});

test('changing away from the return lesson immediately locks artwork gestures again',()=>{
  const f=fixture(),artwork=f.node('swipe animation',{overlay:true});
  f.setPolicy({overlaySwipe:true});
  assert.equal(f.doc.emit('pointerdown',f.event(artwork)).prevented,undefined);
  f.setPolicy({});
  assert.equal(f.doc.emit('pointerup',f.event(artwork)).prevented,true);
  assert.equal(f.doc.emit('pointerdown',f.event(artwork)).prevented,true);
  f.guard.destroy();
});
