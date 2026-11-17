import test from 'node:test';
import assert from 'node:assert/strict';
import { installSettingsGestures, installSwipeDismiss, installCoachSwipeDismiss } from '../dist/settings-gestures.js';

class Surface {
  handlers = new Map();
  addEventListener(type, fn) {
    if (!this.handlers.has(type)) this.handlers.set(type, new Set());
    this.handlers.get(type).add(fn);
  }
  removeEventListener(type, fn) { this.handlers.get(type)?.delete(fn); }
  emit(type, event) { for (const fn of this.handlers.get(type) || []) fn(event); }
}
function harness(mode = 'settings', options = {}) {
  const win = new Surface(), root = new Surface();
  let clock = 100, selected = false, enabled = true, open = true;
  win.performance = {now:()=>clock};
  root.ownerDocument = {defaultView:win,getSelection:()=>({isCollapsed:!selected,toString:()=>selected?'selected text':''})};
  const actions=[];
  const teardown=mode === 'dismiss' || mode === 'coach' ? (mode === 'coach' ? installCoachSwipeDismiss : installSwipeDismiss)(root,{
    isEnabled:()=>enabled,onDismiss:()=>{actions.push('dismiss');enabled=false;},
    ...options,
  }) : installSettingsGestures(root,{
    isSidebarOpen:()=>open,isEnabled:()=>enabled,
    onCollapse:()=>{actions.push('collapse');open=false;},
    onExpand:()=>{actions.push('expand');open=true;},
    onExit:()=>{actions.push('exit');enabled=false;},
  });
  function event(x,y=0,extra={}) {
    return {pointerId:1,pointerType:'touch',isPrimary:true,button:0,clientX:x,clientY:y,
      target:{closest:()=>false},cancelable:true,detail:1,prevented:false,stopped:false,
      preventDefault(){this.prevented=true;},stopPropagation(){this.propagationStopped=true;},stopImmediatePropagation(){this.stopped=true;},...extra};
  }
  function down(x=100,y=100,extra={}) {const e=event(x,y,extra);win.emit('pointerdown',e);root.emit('pointerdown',e);return e;}
  function move(x,y=100,extra={}) {const e=event(x,y,extra);win.emit('pointermove',e);return e;}
  function up(x,y=100,extra={}) {const e=event(x,y,extra);win.emit('pointerup',e);return e;}
  function swipe(dx) {down();move(100+dx);up(100+dx);}
  return {win,root,actions,teardown,event,down,move,up,swipe,
    selection:value=>{selected=value;},enable:value=>{enabled=value;},clock:value=>{clock=value;}};
}

function liquidTarget(axis, button = false) {
  const group={getAttribute:name=>name==='data-liquid-drag-axis'?axis:null};
  return {closest:selector=>selector==='[data-liquid-ready]'?group:button&&selector.split(',').includes('button')?{}:null};
}

test('one swipe changes one state: collapse, expand, collapse, then exit',()=>{
  const h=harness();
  h.swipe(-100);assert.deepEqual(h.actions,['collapse']);
  h.swipe(100);assert.deepEqual(h.actions,['collapse','expand']);
  h.swipe(-100);h.swipe(-100);
  assert.deepEqual(h.actions,['collapse','expand','collapse','exit']);
  h.swipe(100);assert.equal(h.actions.length,4);
});

test('right swipe from expanded sidebar exits directly',()=>{
  const h=harness();h.swipe(100);assert.deepEqual(h.actions,['exit']);
});

test('tap, vertical scroll, cancellation and multi-touch do not navigate',()=>{
  const h=harness();
  h.down();h.up(110,105);
  h.down();const vertical=h.move(103,145);h.move(190,150);h.up(190,150);
  assert.equal(vertical.prevented,false);
  h.down();h.move(20);h.win.emit('pointercancel',h.event(20));h.up(20);
  h.down();h.down(110,100,{pointerId:2,isPrimary:false});h.up(0);h.up(0,100,{pointerId:2});
  assert.deepEqual(h.actions,[]);
});

test('form controls, editable text, device rotation and existing text selection retain their gestures',()=>{
  const h=harness();
  for(const selector of ['input','select','textarea','contenteditable','.settings-device-model']) {
    const target={closest:query=>query.includes(selector)};
    h.down(100,100,{target});assert.equal(h.move(0).prevented,false);h.up(0);
  }
  h.selection(true);h.swipe(-100);h.selection(false);
  h.down();h.selection(true);h.move(0);h.up(0);h.selection(false);
  assert.deepEqual(h.actions,[]);
});

test('short horizontal swipes on vertical sidebar choices collapse and reopen exactly once',()=>{
  const h=harness(), target=liquidTarget('y',true);
  h.down(100,100,{target});
  assert.equal(h.move(72,100,{target}).prevented,true);
  const collapse=h.up(72,100,{target});
  assert.deepEqual(h.actions,['collapse']);
  h.win.emit('pointerup',collapse);
  assert.deepEqual(h.actions,['collapse'],'one release cannot also exit settings');
  h.down(100,100);
  assert.equal(h.move(128,100).prevented,true);
  h.up(128,100);
  assert.deepEqual(h.actions,['collapse','expand']);
  h.teardown();
});

test('tutorial Next drags never arm settings or sheet swipes during ancestor capture',()=>{
  for(const mode of ['settings','dismiss']){
    const h=harness(mode);
    for(const dx of [-60,60]){
      // Include non-button coach content too: excluding buttons alone does not
      // protect the illustration/text area mounted above a native sheet.
      for(const ancestors of [['.coach-layer','button'],['.coach-layer']]){
        const target={closest:query=>query.split(',').some(selector=>ancestors.includes(selector))?{}:null};
        const press=h.down(100,100,{target});
        press.stopPropagation(); // overlay bubble runs after ancestor capture
        const movement=h.move(100+dx,100,{target}), release=h.up(100+dx,100,{target});
        const click=h.event(100+dx,100,{target});h.win.emit('click',click);
        assert.deepEqual(h.actions,[]);
        assert.equal(movement.prevented,false);assert.equal(release.prevented,false);
        assert.equal(click.prevented,false,'the Next click must remain available to the tutorial');
      }
    }
    h.swipe(-60);
    assert.deepEqual(h.actions,[mode==='settings'?'collapse':'dismiss'],'blank-area navigation remains active');
    h.win.emit('blur',{});h.teardown();
  }
});

test('ordinary button, link and disclosure drags or taps cannot dismiss or collapse their page',()=>{
  for(const mode of ['settings','dismiss']){
    const h=harness(mode);
    for(const tag of ['button','a','summary']){
      const target={closest:query=>query.split(',').includes(tag)?{}:null};
      for(const dx of [3,-60,60]){
        h.down(100,100,{target});
        assert.equal(h.move(100+dx,100,{target}).prevented,false);
        assert.equal(h.up(100+dx,100,{target}).prevented,false);
        const click=h.event(100+dx,100,{target});h.win.emit('click',click);
        assert.equal(click.prevented,false);assert.deepEqual(h.actions,[]);
      }
    }
    h.teardown();
  }
});

test('vertical sidebar dragging and scrolling are not consumed by horizontal navigation',()=>{
  const h=harness(), target=liquidTarget('y');
  h.down(100,100,{target});
  assert.equal(h.move(105,145,{target}).prevented,false);
  h.move(140,165,{target});h.up(140,165,{target});
  assert.deepEqual(h.actions,[]);
  h.teardown();
});

test('settings accept a modest diagonal swipe but reject travel below the shorter threshold',()=>{
  const h=harness();
  h.down();h.move(74,100);h.up(74,100);
  assert.deepEqual(h.actions,[],'26 pixels remain a tap or unfinished swipe');
  h.down();
  assert.equal(h.move(68,120).prevented,true);
  h.up(68,120);
  assert.deepEqual(h.actions,['collapse']);
  h.teardown();
});

test('horizontal glass controls retain their own dragging and dismiss gestures keep all liquid groups excluded',()=>{
  for(const mode of ['settings','dismiss']) {
    const h=harness(mode);
    for(const axis of mode==='dismiss'?['x','y']:['x']) {
      const target=liquidTarget(axis);
      h.down(100,100,{target});
      assert.equal(h.move(0,100,{target}).prevented,false);
      h.up(0,100,{target});
    }
    assert.deepEqual(h.actions,[]);
    h.teardown();
  }
});

test('shorter settings threshold does not change health-card dismissal distance',()=>{
  const h=harness('dismiss');
  h.down();h.move(132,100);h.up(132,100);
  assert.deepEqual(h.actions,[]);
  h.down();h.move(144,100);h.up(144,100);
  assert.deepEqual(h.actions,['dismiss']);
  h.teardown();
});

test('suppresses the swipe click even when exit exposes the app, without blocking keyboard or deliberate taps',()=>{
  const h=harness();h.swipe(100);
  const keyboard=h.event(200,100,{detail:0});h.win.emit('click',keyboard);
  assert.equal(keyboard.prevented,false);
  const click=h.event(200,100);h.win.emit('click',click);
  assert.equal(click.prevented,true);assert.equal(click.stopped,true);
  const next=h.event(200,100);h.win.emit('click',next);assert.equal(next.prevented,false);
  h.enable(true);h.swipe(-100);h.down();h.up(100);
  const deliberate=h.event(100,100);h.win.emit('click',deliberate);assert.equal(deliberate.prevented,false);
});

test('teardown removes listeners and a new gesture cannot survive disabled state or window blur',()=>{
  const h=harness();h.down();h.enable(false);h.up(0);h.enable(true);
  h.down();h.win.emit('blur',{});h.up(0);assert.deepEqual(h.actions,[]);
  h.teardown();h.swipe(-100);assert.deepEqual(h.actions,[]);
  for(const surface of [h.win,h.root]) for(const callbacks of surface.handlers.values()) assert.equal(callbacks.size,0);
});


test('dismiss closes in either physical direction exactly once and stops release propagation',()=>{
  for (const dx of [-100,100]) {
    const h=harness('dismiss');h.down();h.move(100+dx);const release=h.up(100+dx);
    assert.deepEqual(h.actions,['dismiss']);assert.equal(release.propagationStopped,true);
    h.win.emit('pointerup',release);assert.deepEqual(h.actions,['dismiss']);
    h.win.emit('blur',{});h.teardown();
  }
});

test('dismiss respects modal gating, native form gestures and selected text',()=>{
  const h=harness('dismiss');h.enable(false);h.swipe(100);h.enable(true);
  for(const selector of ['input','select','textarea','contenteditable']) {
    h.down(100,100,{target:{closest:query=>query.includes(selector)}});h.move(0);h.up(0);
  }
  h.selection(true);h.swipe(-100);h.selection(false);
  h.down();h.enable(false);h.move(0);h.up(0);
  assert.deepEqual(h.actions,[]);h.teardown();
});

test('right-only dismiss leaves left movement, release and its click unconsumed',()=>{
  const h=harness('dismiss',{directions:['right']});
  h.down();const movement=h.move(0);const release=h.up(0);
  const click=h.event(0,100);h.win.emit('click',click);
  assert.deepEqual(h.actions,[]);
  assert.equal(movement.prevented,false);
  assert.equal(release.prevented,false);
  assert.equal(release.propagationStopped,undefined);
  assert.equal(click.prevented,false);
  h.down();const rightMovement=h.move(200);const rightRelease=h.up(200);
  assert.deepEqual(h.actions,['dismiss']);
  assert.equal(rightMovement.prevented,true);
  assert.equal(rightRelease.prevented,true);
  assert.equal(rightRelease.propagationStopped,true);
  const rightClick=h.event(200,100);h.win.emit('click',rightClick);
  assert.equal(rightClick.prevented,true);
  h.teardown();
});

test('right-only dismiss preserves vertical scrolling and native control gestures',()=>{
  const h=harness('dismiss',{directions:['right']});
  h.down();const movement=h.move(105,150);h.move(200,155);const release=h.up(200,155);
  assert.equal(movement.prevented,false);assert.equal(release.prevented,false);
  for(const selector of ['input','select','textarea','contenteditable']) {
    h.down(100,100,{target:{closest:query=>query.includes(selector)}});
    assert.equal(h.move(200).prevented,false);assert.equal(h.up(200).prevented,false);
  }
  h.down();h.up(105,102);
  const click=h.event(105,102);h.win.emit('click',click);
  assert.equal(click.prevented,false);assert.deepEqual(h.actions,[]);
  h.teardown();
});

test('dismiss release click remains shielded if closing the modal immediately tears down its listener',()=>{
  const h=harness('dismiss');h.swipe(-100);h.teardown();
  const click=h.event(0,100);h.win.emit('click',click);
  assert.equal(click.prevented,true);assert.equal(click.stopped,true);
  for(const surface of [h.win,h.root]) for(const callbacks of surface.handlers.values()) assert.equal(callbacks.size,0);
});

test('return lesson accepts a short right swipe on its text or illustration, with natural diagonal drift',()=>{
  for(const path of [
    [[132,100]],
    [[108,113],[148,128]],
    [[110,106],[142,130]],
  ]) {
    const h=harness('coach');
    const target={closest:selector=>selector.split(',').includes('.coach-layer')?{}:null};
    h.down(100,100,{target});
    for(const [x,y] of path)h.move(x,y,{target});
    const [x,y]=path.at(-1),release=h.up(x,y,{target});
    assert.deepEqual(h.actions,['dismiss']);
    assert.equal(release.prevented,true);
    h.win.emit('pointerup',release);
    assert.deepEqual(h.actions,['dismiss'],'the same release cannot advance a second lesson');
    const click=h.event(x,y,{target});h.win.emit('click',click);
    assert.equal(click.prevented,true,'release cannot activate a newly exposed button');
    h.teardown();
  }
});

test('return lesson rejects taps, short motion, left swipes, vertical gestures and cancelled contacts',()=>{
  const h=harness('coach');
  for(const [dx,dy] of [[3,2],[31,0],[-90,0],[25,70],[45,42]]) {
    h.down();h.move(100+dx,100+dy);h.up(100+dx,100+dy);
  }
  h.down();h.move(105,145);h.move(180,150);h.up(180,150);
  h.down();h.move(140,110);h.win.emit('pointercancel',h.event(140,110));h.up(140,110);
  h.down();h.down(110,100,{pointerId:2,isPrimary:false});h.up(180);h.up(190,100,{pointerId:2});
  assert.deepEqual(h.actions,[]);
  h.teardown();
});

test('return lesson never turns End tour/button drags into dismissal, or runs outside its active scene',()=>{
  const h=harness('coach');
  for(const control of ['button','a','input','select','textarea']) {
    const target={closest:selector=>selector.split(',').includes(control)||selector.split(',').includes('.coach-layer')?{}:null};
    h.down(100,100,{target});h.move(180,110,{target});h.up(180,110,{target});
  }
  h.enable(false);h.swipe(80);h.enable(true);
  h.down();h.enable(false);h.up(180);
  assert.deepEqual(h.actions,[]);
  h.enable(true);h.teardown();h.swipe(80);
  assert.deepEqual(h.actions,[]);
});

test('a selection left behind the nonselectable return overlay does not disable its swipe',()=>{
  const h=harness('coach');h.selection(true);
  h.down();h.move(140,110);h.up(140,110);
  assert.deepEqual(h.actions,['dismiss']);
  h.win.emit('blur',{});h.teardown();
});
