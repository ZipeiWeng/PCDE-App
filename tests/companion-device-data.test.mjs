import test from 'node:test';
import assert from 'node:assert/strict';
import {createEmptySnapshot,createSnapshot} from '../dist/model.js';
// The module also imports the shared dialog binding; these pure data tests do
// not mount UI, but its two event bindings need a minimal document at import.
const previousDocument=Object.getOwnPropertyDescriptor(globalThis,'document');
Object.defineProperty(globalThis,'document',{configurable:true,value:{getElementById:()=>({addEventListener(){}})}});
const {companionDeviceReply,companionHealthContext}=await import('../dist/companion.js');
if(previousDocument)Object.defineProperty(globalThis,'document',previousDocument);else delete globalThis.document;

const unavailable='No device readings yet. Connect a collar to begin.';

test('an account without readings never turns null values into zeros or a wellness score',()=>{
  const snapshot=createEmptySnapshot();
  for(const question of ['Summary','What is the score?','Show my baseline','How many steps today?','What is the heart rate?','Show skin temperature','How long did Mochi sleep?']){
    assert.equal(companionDeviceReply(question,snapshot,'Mochi'),unavailable,question);
  }
  assert.equal(companionDeviceReply('Tell me about brushing teeth',snapshot),null);
});

test('missing and invalid measurements stay absent while genuine zero steps are preserved',()=>{
  assert.equal(companionDeviceReply('Show heart rate',{heart:null,temp:undefined,steps:NaN,sleep:'8'}),unavailable);
  const snapshot={source:'device',simulated:false,steps:0,baseline:{}};
  assert.equal(companionDeviceReply('How many steps today?',snapshot),'Steps: 0 steps');
  assert.equal(companionDeviceReply('Show heart rate',snapshot),'Heart rate: no reading yet.');
  assert.match(companionDeviceReply('Summary',snapshot),/Heart rate: no reading yet/);
  assert.doesNotMatch(companionDeviceReply('Summary',snapshot),/Usual:|0 bpm|simulated/i);
  assert.match(companionDeviceReply('Score',snapshot),/not available yet/);
});

test('known readings do not create a personal baseline or allow an unsupported score',()=>{
  const snapshot={source:'device',heart:82,temp:34.6,steps:6248,sleep:7.7,score:93,baseline:{}};
  assert.equal(companionDeviceReply('Show heart rate',snapshot),'Heart rate: 82 bpm');
  assert.match(companionDeviceReply('Score',snapshot),/personal baseline/);
  const context=companionHealthContext({},snapshot).snapshot;
  assert.equal(context.score,null);assert.equal(context.status,'unknown');assert.deepEqual(context.baseline,{});
});

test('demo readings retain their score and an explicit simulation label',()=>{
  const snapshot=createSnapshot('good');
  assert.match(companionDeviceReply('Summary',snapshot,'Mochi'),/Heart rate: 82 bpm/);
  assert.match(companionDeviceReply('Summary',snapshot,'Mochi'),/Simulated device readings/);
  assert.match(companionDeviceReply('Score',snapshot),/Score: 93\/100/);
  assert.equal(companionHealthContext({},snapshot).snapshot.simulated,true);
});

test('AI context explicitly says data is unavailable and preserves real health records independently',()=>{
  const store={profile:{name:'Nia',breed:'Poodle'},allergies:'Pollen',conditions:'Dermatitis',records:[{type:'visit',title:'Ear check',date:'2026-11-01',details:'Veterinarian examined both ears.',author:'Vet',sample:false}]};
  const context=companionHealthContext(store,createEmptySnapshot());
  assert.equal(context.snapshot.availability,'unavailable');assert.equal(context.snapshot.source,'unavailable');
  assert.equal(context.snapshot.simulated,false);assert.equal(context.snapshot.score,null);assert.equal(context.snapshot.updatedAt,null);
  assert.equal(context.snapshot.status,'unknown');assert.equal(context.snapshot.triage,undefined);
  for(const key of ['heart','temp','steps','sleep'])assert.equal(context.snapshot[key],null);
  assert.deepEqual(context.snapshot.baseline,{});
  assert.equal(context.records[0].title,'Ear check');assert.equal(context.records[0].sample,false);
  assert.equal(context.allergies,'Pollen');assert.equal(context.conditions,'Dermatitis');
});

test('explicit unavailable source takes precedence over stale readings and demo metadata',()=>{
  const snapshot={...createSnapshot('good'),source:'unavailable',simulated:false};
  assert.equal(companionDeviceReply('Summary',snapshot),unavailable);
  const payload=companionHealthContext({},snapshot).snapshot;
  assert.equal(payload.simulated,false);assert.equal(payload.score,null);assert.equal(payload.scenario,null);assert.equal(payload.status,'unknown');
});

test('owner-reported emergency signs survive even when no collar measurements exist',()=>{
  const snapshot=createEmptySnapshot({observedSigns:['breathing_difficulty']});
  const payload=companionHealthContext({},snapshot).snapshot;
  assert.equal(payload.availability,'unavailable');assert.equal(payload.heart,null);assert.equal(payload.score,null);
  assert.equal(payload.status,'alert');assert.equal(payload.observationSource,'owner');
  assert.deepEqual(payload.observedSigns,['breathing_difficulty']);
  assert.deepEqual(payload.triage.emergencySigns,['breathing_difficulty']);
});
