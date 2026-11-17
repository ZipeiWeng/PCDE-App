import test from 'node:test';
import assert from 'node:assert/strict';
import {createTestScenarios} from '../dist/test-scenarios.js';
import {createHealthData} from '../dist/health-data.js';

const account={id:'test-mochi',isTest:true};
const saved=heart=>({heart,temp:34.6,steps:6248,sleep:7.7,source:'test',simulated:true,scenario:null,score:null,status:'unknown',history:[{date:'2026-11-15',heart}]});

test('TEST picker produces distinct green, yellow and red examples with explicit emergency signs',()=>{
  const previews=createTestScenarios();
  for(const [scenario,score] of [['good',93],['watch',65],['alert',33]]){
    const value=previews.select(account,scenario);
    assert.equal(value.status,scenario);assert.equal(value.score,score);
    assert.equal(value.simulated,true);assert.equal(value.observationSource,'demo');
    assert.equal(value.preview,'test-scenario');
    assert.equal(value.observedSigns.length>0,scenario==='alert');
  }
});

test('TEST preview leaves authenticated cloud refresh active and returns to the latest saved data',async()=>{
  const previews=createTestScenarios();let incoming=saved(82),latest,displayed,polls=0;
  const client=createHealthData({
    storage:null,
    fetcher:async()=>({ok:true,json:async()=>({pet:{id:'pet-test',revision:1,initialized:true},devices:[],snapshot:incoming})}),
    setTimer:()=>{polls++;return 1;},clearTimer:()=>{},
    onSnapshot:value=>{latest=value;displayed=previews.resolve(account,value);},
  });
  await client.start(account,{});
  assert.equal(client.getState().authenticated,true);assert.equal(polls,1);
  displayed=previews.select(account,'alert');const red=displayed;
  incoming=saved(91);await client.refresh();
  assert.equal(client.getState().authenticated,true);assert.equal(client.getState().snapshot.heart,91);
  assert.equal(displayed,red,'Incoming DB data must not cancel the selected alert preview.');
  assert.equal(latest.heart,91);assert.equal(latest.scenario,null);assert.equal(latest.score,null);
  assert.equal(previews.resolve(account,latest),red,'Leaving the guide also restores the chosen preview.');
  previews.clear();displayed=previews.resolve(account,latest);
  assert.equal(displayed.heart,91);assert.equal(displayed.scenario,null);
  client.stop();
});

test('preview never leaks into another TEST identity, a real account, or an anonymous session',()=>{
  const previews=createTestScenarios(),value=saved(82);
  previews.select(account,'watch');
  for(const other of [{id:'test-other',isTest:true},{id:account.id,isTest:false},{id:'owner'},{demo:true},null]){
    assert.equal(previews.active(other),false);
    assert.equal(previews.resolve(other,value),value);
  }
  for(const ineligible of [{id:'owner'}, {isTest:true}, {demo:true}])assert.equal(previews.select(ineligible,'alert'),null);
  assert.equal(previews.resolve(account,value).status,'watch');
});

test('clearing on sign out or account change cannot restore a previous scenario on re-entry',()=>{
  const previews=createTestScenarios(),value=saved(82);
  previews.select(account,'alert');previews.clear();
  assert.equal(previews.active(account),false);assert.equal(previews.resolve(account,value),value);
  assert.equal(createTestScenarios().resolve(account,value),value,'A reload starts with saved readings, not a persisted preview.');
});

test('invalid scenarios cannot silently turn an existing red test into healthy green',()=>{
  const previews=createTestScenarios(),value=saved(82),red=previews.select(account,'alert');
  for(const invalid of ['unknown','__proto__',undefined,null,''])assert.equal(previews.select(account,invalid),null);
  assert.equal(previews.resolve(account,value),red);
  assert.equal(value.status,'unknown');assert.equal(value.heart,82);
});
