import test from 'node:test';
import assert from 'node:assert/strict';
import { initSessionLoader } from '../dist/startup.js';

function harness(){
  let clock=0,id=0;
  const frames=new Map(),timers=new Map(),attributes=new Map();
  const progress={attributes:new Map(),setAttribute(name,value){this.attributes.set(name,value);}};
  const fill={style:{}};
  const screen={hidden:true,querySelector:selector=>selector==='[data-startup-progress]'?progress:fill};
  const login={inert:false},workspace={inert:false},card={inert:true};
  const win={performance:{now:()=>clock},requestAnimationFrame(fn){frames.set(++id,fn);return id;},cancelAnimationFrame:frame=>frames.delete(frame),setTimeout(fn,ms){timers.set(++id,{fn,ms});return id;},clearTimeout:timer=>timers.delete(timer)};
  const shell={ownerDocument:{defaultView:win,activeElement:{blur(){}}},children:[screen,login,workspace,card],querySelector:()=>screen,setAttribute:(name,value)=>attributes.set(name,value),removeAttribute:name=>attributes.delete(name)};
  const loader=initSessionLoader(shell);
  return {loader,screen,login,workspace,card,progress,fill,frames,timers,attributes,tick(time){clock=time;const pending=[...frames.values()];frames.clear();for(const fn of pending)fn();}};
}
const settle=async()=>{await Promise.resolve();await Promise.resolve();};

test('the login page is not gated by a startup cover',()=>{
  const ui=harness();
  assert.equal(ui.screen.hidden,true);
  assert.equal(ui.loader.active,false);
  assert.equal(ui.login.inert,false);
  assert.equal(ui.timers.size,0);
  assert.equal(ui.frames.size,0);
});

test('successful entry shows a one-second determinate transition then releases the app',async()=>{
  const ui=harness();let prepared=false;
  const done=ui.loader.run(()=>{prepared=true;});
  assert.equal(ui.screen.hidden,false);
  assert.equal(ui.login.inert,true);
  assert.equal(ui.workspace.inert,true);
  assert.equal(ui.attributes.get('aria-busy'),'true');
  assert.equal(ui.progress.attributes.get('aria-valuenow'),'0');
  await settle();assert.equal(prepared,true);
  ui.tick(500);
  assert.equal(ui.progress.attributes.get('aria-valuenow'),'50');
  assert.equal(ui.screen.hidden,false);
  ui.tick(999);assert.equal(ui.screen.hidden,false);
  ui.tick(1000);assert.equal(await done,true);
  assert.equal(ui.progress.attributes.get('aria-valuenow'),'100');
  assert.equal(ui.screen.hidden,true);
  assert.equal(ui.login.inert,false);
  assert.equal(ui.workspace.inert,false);
  assert.equal(ui.card.inert,true);
  assert.equal(ui.frames.size,0);
  assert.equal(ui.timers.size,0);
});

test('a slower setup does not reach completion before the actual app is ready',async()=>{
  const ui=harness();let ready;
  const done=ui.loader.run(()=>new Promise(resolve=>{ready=resolve;}));
  await settle();ui.tick(1200);
  assert.equal(ui.progress.attributes.get('aria-valuenow'),'90');
  assert.equal(ui.screen.hidden,false);
  ready();await settle();await settle();ui.tick(1300);
  assert.equal(await done,true);
  assert.equal(ui.screen.hidden,true);
});

test('cancelled entry cannot finish a later login or leave an overlay behind',async()=>{
  const ui=harness();let release,signal;
  const cancelled=ui.loader.run(value=>{signal=value;return new Promise(resolve=>{release=resolve;});});
  await settle();ui.tick(250);ui.loader.cancel();
  assert.equal(await cancelled,false);assert.equal(signal.aborted,true);
  assert.equal(ui.screen.hidden,true);assert.equal(ui.workspace.inert,false);
  const next=ui.loader.run();await settle();
  release();await settle();await settle();
  ui.tick(500);assert.equal(ui.screen.hidden,false);
  ui.tick(1250);assert.equal(await next,true);
});

test('setup failure releases the UI and propagates the error to the login controller',async()=>{
  const ui=harness(),error=new Error('Setup failed');
  await assert.rejects(ui.loader.run(()=>{throw error;}),error);
  assert.equal(ui.screen.hidden,true);
  assert.equal(ui.login.inert,false);
  assert.equal(ui.loader.active,false);
  assert.equal(ui.timers.size,0);
});

test('stalled setup rejects after the timeout instead of retaining an infinite cover',async()=>{
  const ui=harness();const done=ui.loader.run(()=>new Promise(()=>{}));
  await settle();const timeout=[...ui.timers.values()][0];assert.equal(timeout.ms,15000);
  const rejection=assert.rejects(done,/Pawprint could not open/);timeout.fn();await rejection;
  assert.equal(ui.screen.hidden,true);assert.equal(ui.frames.size,0);assert.equal(ui.workspace.inert,false);
});
