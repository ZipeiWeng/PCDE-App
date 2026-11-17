import test, {beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import {createMochiHistory, MOCHI_HISTORY_VERSION, MOCHI_DEMO_ESSENTIALS} from '../dist/mochi-history.js';
import {selectAccount,readStore,saveStore} from '../dist/model.js';
import {groupVisitSummaryRecords,isDewormingRecord} from '../dist/visit-summary.js';

const testAccount={id:'test-mochi',isTest:true,username:'mochi_test',petName:'Mochi',petBirthday:'2023-03-17',petSex:'female'};
const testKey='pawprint-health.store.v3:test-mochi';
const demoKey='pawprint-health.store.v2';
let saved;
beforeEach(()=>{
  saved=new Map();
  globalThis.localStorage={getItem:key=>saved.get(key)??null,setItem:(key,value)=>saved.set(key,value)};
  selectAccount(null);
});

test('Mochi catalog supplies 35 dated sample records with complete clinical history fields',()=>{
  const records=createMochiHistory(),groups=groupVisitSummaryRecords(records);
  assert.equal(records.length,35);
  assert.equal(new Set(records.map(record=>record.id)).size,35);
  assert.deepEqual(Object.fromEntries(Object.entries(groups).map(([type,items])=>[type,items.length])),{visit:10,vaccine:8,parasite:9,medication:8,observation:0});
  assert.equal(groups.parasite.filter(isDewormingRecord).length,6);
  for(const record of records){
    assert.equal(record.sample,true);
    assert.match(record.clinic,/fictional/);
    assert.ok(record.city);
    assert.ok(record.details.length>20);
    assert.ok(record.date>='2023-03-17'&&record.date<='2026-11-13');
  }
  for(const record of groups.visit){
    for(const field of ['symptoms','diagnosis','medications','plan','doctor'])assert.ok(record[field]?.length>12,`${record.id} has ${field}`);
  }
  assert.deepEqual(records.map(record=>record.date),records.map(record=>record.date).sort().reverse());
  assert.ok(groups.vaccine[0].date.startsWith('2026-11-12'));
  assert.ok(groups.parasite[0].date.startsWith('2026-11-11'));
  assert.ok(groups.medication[0].date.startsWith('2026-11-10'));
  records[0].title='Changed fixture';
  assert.notEqual(createMochiHistory()[0].title,'Changed fixture','each caller gets independent records');
});

test('new preview and explicitly marked test accounts get rich history but ordinary Mochi accounts do not',()=>{
  assert.equal(readStore().records.length,35);
  assert.equal(readStore().allergies,MOCHI_DEMO_ESSENTIALS.allergies);
  assert.equal(readStore().conditions,MOCHI_DEMO_ESSENTIALS.conditions);
  selectAccount(testAccount);
  const testStore=readStore();
  assert.equal(testStore.records.length,35);
  assert.equal(testStore.demoHistoryVersion,MOCHI_HISTORY_VERSION);
  assert.equal(testStore.profile.breed,'Golden retriever');
  assert.equal(testStore.profile.sex,'Female');
  assert.equal(testStore.profile.weight,28.5);
  assert.equal(testStore.allergies,MOCHI_DEMO_ESSENTIALS.allergies);
  assert.equal(testStore.conditions,MOCHI_DEMO_ESSENTIALS.conditions);
  assert.equal(saved.size,0,'reading does not persist or cross account boundaries');
  selectAccount({...testAccount,id:'regular-mochi',isTest:false});
  assert.deepEqual(readStore().records,[]);
  assert.equal(readStore().profile.weight,0);
  assert.equal(readStore().allergies,'None recorded');
  assert.equal(readStore().conditions,'None recorded');
  assert.equal('demoHistoryVersion' in readStore(),false);
});

test('existing demo and test stores receive one enrichment without overwriting any owner or edited example data',()=>{
  for(const [account,key] of [[null,demoKey],[testAccount,testKey]]){
    selectAccount(account);
    const edited=createMochiHistory()[0];edited.details='Owner corrected this example';
    const oldRecord={id:'test-sample-0',type:'visit',title:'Edited legacy visit',date:'2026-11-01T09:00:00Z',details:'Keep this edit',author:'Owner',sample:true};
    const ownRecord={id:'owner-scan',type:'visit',title:'Uploaded clinic record',date:'2026-11-02T09:00:00Z',details:'Owner-supplied notes',source:'scan',sourceFilename:'record.pdf',author:'Owner'};
    const old={profile:{name:'Custom Mochi',breed:'Custom breed',weight:27,sex:'Female',photo:'saved-photo'},preferences:{backgroundFrost:42},allergies:'Owner-entered allergy',conditions:'Owner-entered condition',records:[oldRecord,ownRecord,edited]};
    saved.set(key,JSON.stringify(old));
    const before=saved.get(key),enriched=readStore();
    assert.equal(enriched.records.length,37);
    assert.deepEqual(enriched.records.find(record=>record.id===oldRecord.id),oldRecord);
    assert.deepEqual(enriched.records.find(record=>record.id===ownRecord.id),ownRecord);
    assert.equal(enriched.records.find(record=>record.id===edited.id).details,edited.details);
    assert.equal(enriched.profile.photo,'saved-photo');
    assert.equal(enriched.profile.name,'Custom Mochi');
    assert.equal(enriched.preferences.backgroundFrost,42);
    assert.equal(enriched.allergies,'Owner-entered allergy');
    assert.equal(enriched.conditions,'Owner-entered condition');
    assert.equal(saved.get(key),before,'read-time migration is side-effect free');
    assert.deepEqual(readStore(),enriched,'repeated reads are stable');
    assert.equal(saveStore(enriched),true);
    assert.equal(readStore().records.length,37);
    const removedId=edited.id;
    assert.equal(saveStore({...readStore(),records:readStore().records.filter(record=>record.id!==removedId)}),true);
    assert.equal(readStore().records.length,36);
    assert.equal(readStore().records.some(record=>record.id===removedId),false,'normal saves retain the marker and respect later deletion');
  }
});

test('an existing real account never receives synthetic history or a demo migration marker',()=>{
  selectAccount({...testAccount,id:'real-owner',isTest:false});
  const key='pawprint-health.store.v3:real-owner';
  saved.set(key,JSON.stringify({profile:{name:'Mochi'},records:[],demoHistoryVersion:0}));
  assert.deepEqual(readStore().records,[]);
  assert.equal('demoHistoryVersion' in readStore(),false);
  assert.equal(saveStore(readStore()),true);
  assert.deepEqual(JSON.parse(saved.get(key)).records,[]);
  assert.equal('demoHistoryVersion' in JSON.parse(saved.get(key)),false);
});

test('version-one demo profiles gain fictional essentials once without restoring deleted history or losing corrections',()=>{
  for(const [account,key] of [[null,demoKey],[testAccount,testKey]]){
    selectAccount(account);
    const records=createMochiHistory().filter(record=>record.id!=='mochi-history-v1-vac-01');
    const skin=records.find(record=>record.id==='mochi-history-v1-visit-06');
    skin.diagnosis='The example clinician assessment records an inflammatory skin flare; a definitive allergy was not established.';
    skin.plan='Owner corrected follow-up: keep this text.';
    const annual=records.find(record=>record.id==='mochi-history-v1-visit-10');
    annual.diagnosis='No active concern was identified in this fictional visit. Previous episodes were reviewed as resolved.';
    saved.set(key,JSON.stringify({profile:{name:'Mochi'},records,demoHistoryVersion:1,allergies:'None recorded',conditions:'  '}));
    const original=saved.get(key),upgraded=readStore();
    assert.equal(upgraded.allergies,MOCHI_DEMO_ESSENTIALS.allergies);
    assert.equal(upgraded.conditions,MOCHI_DEMO_ESSENTIALS.conditions);
    assert.equal(upgraded.records.length,34);
    assert.equal(upgraded.records.some(record=>record.id==='mochi-history-v1-vac-01'),false);
    assert.match(upgraded.records.find(record=>record.id===skin.id).diagnosis,/pollen sensitivity/);
    assert.equal(upgraded.records.find(record=>record.id===skin.id).plan,skin.plan);
    assert.match(upgraded.records.find(record=>record.id===annual.id).diagnosis,/dermatitis remained controlled/);
    assert.equal(saved.get(key),original,'read migration does not write storage');
    assert.deepEqual(readStore(),upgraded);
    assert.equal(saveStore(upgraded),true);assert.deepEqual(readStore(),upgraded);
    // Clearing a seeded field after this version is an intentional owner edit.
    assert.equal(saveStore({...upgraded,allergies:'',conditions:'None recorded'}),true);
    assert.equal(readStore().allergies,'');assert.equal(readStore().conditions,'None recorded');
  }
});

test('care-summary migration preserves explicit owner essentials and never updates real-account records',()=>{
  selectAccount(testAccount);
  const custom={profile:{name:'Mochi'},records:createMochiHistory(),demoHistoryVersion:1,allergies:'Owner: no known allergies',conditions:'Owner-entered condition'};
  saved.set(testKey,JSON.stringify(custom));
  assert.equal(readStore().allergies,custom.allergies);assert.equal(readStore().conditions,custom.conditions);
  const real={...testAccount,id:'real-mochi-same-name',isTest:false};selectAccount(real);
  const key='pawprint-health.store.v3:'+real.id;
  saved.set(key,JSON.stringify({...custom,records:[],allergies:'None recorded',conditions:'None recorded'}));
  assert.equal(readStore().allergies,'None recorded');assert.equal(readStore().conditions,'None recorded');assert.deepEqual(readStore().records,[]);
});

test('Rabies sample wording migration fixes only the old narrative and preserves cleared version-two essentials',()=>{
  selectAccount(testAccount);
  const records=createMochiHistory(),rabies=records.find(record=>record.id==='mochi-history-v1-vac-06');
  rabies.details='Rabies vaccination recorded for a planned trip. A fictional travel document entry was completed by the clinic.';
  saved.set(testKey,JSON.stringify({profile:{name:'Mochi'},records,demoHistoryVersion:2,allergies:'',conditions:'None recorded'}));
  const upgraded=readStore();
  assert.match(upgraded.records.find(record=>record.id===rabies.id).details,/recorded before a trip/);
  assert.equal(upgraded.allergies,'');assert.equal(upgraded.conditions,'None recorded');
  rabies.details='Owner-corrected vaccination note';
  saved.set(testKey,JSON.stringify({profile:{name:'Mochi'},records,demoHistoryVersion:2,allergies:'Owner allergy',conditions:'Owner condition'}));
  assert.equal(readStore().records.find(record=>record.id===rabies.id).details,rabies.details);
});
