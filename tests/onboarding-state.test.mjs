import test from 'node:test';
import assert from 'node:assert/strict';
import { createOnboardingState } from '../dist/onboarding-state.js';

const makeStorage = () => { const data=new Map(); return { getItem:key=>data.get(key), setItem:(key,value)=>data.set(key,value) }; };
test('normal accounts see the guide once, independently, and server completion works on another browser',async()=>{
  const storage=makeStorage(), calls=[];
  const state=createOnboardingState({storage,completeRemote:async id=>calls.push(id)});
  const first={id:'first'}, second={id:'second'};
  assert.equal(state.shouldShow(first),true);
  await state.finish(first);
  assert.equal(state.shouldShow(first),false);
  assert.equal(state.shouldShow(second),true);
  assert.equal(createOnboardingState({storage}).shouldShow(first),false);
  assert.equal(createOnboardingState({storage:makeStorage()}).shouldShow({...first,onboardingCompleted:true}),false);
  assert.ok(calls.every(id=>id==='first'));
});
test('test accounts show the guide on every entry even with a completion flag',async()=>{
  let requests=0;
  const state=createOnboardingState({storage:makeStorage(),completeRemote:async()=>requests++});
  const account={id:'mochi',isTest:true,onboardingCompleted:true};
  for(let i=0;i<3;i++){assert.equal(state.shouldShow(account),true);await state.finish(account);}
  assert.equal(requests,0);
});
test('failed completion retries after re-entry and is still isolated to the captured account',async()=>{
  const storage=makeStorage(),calls=[];
  let fail=true;
  const state=createOnboardingState({storage,completeRemote:async id=>{calls.push(id);if(fail)throw Error('offline');}});
  const account={id:'one'};
  await state.finish(account);
  fail=false;
  assert.equal(state.shouldShow(account),false);
  account.id='two';
  await new Promise(resolve=>setTimeout(resolve,0));
  assert.deepEqual(calls,['one','one']);
  assert.equal(state.shouldShow(account),true);
});
test('unavailable storage never blocks entry or completion; demo does not call authentication APIs',async()=>{
  const storage={getItem(){throw Error('blocked');},setItem(){throw Error('blocked');}};
  let requests=0;
  const state=createOnboardingState({storage,completeRemote:async()=>requests++});
  assert.equal(state.shouldShow({demo:true}),true);
  await state.finish({demo:true});
  assert.equal(state.shouldShow({demo:true}),false);
  assert.equal(requests,0);
});
