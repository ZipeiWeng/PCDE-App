import test from 'node:test';
import assert from 'node:assert/strict';
import {createHealthData, cloudCare, mergeCloudCare, hasAnyReadings, recordedReadingLabel} from '../dist/health-data.js';
import {renderTrends} from '../dist/charts.js';

const account={id:'owner-a'};
const local={profile:{name:'Mochi',breed:'Golden retriever',weight:28.5,photo:'private-photo'},goals:{steps:8000,sleep:8},allergies:'None recorded',conditions:'None recorded',records:[],preferences:{pawPattern:true},healthCardModules:{vaccination:false}};
const pet=(revision=1,extra={})=>({id:'pet-a',revision,initialized:true,...cloudCare(local),...extra});
const snapshot=(heart=null)=>({source:'device',simulated:false,availability:heart===null?'unavailable':'partial',heart,temp:null,steps:null,sleep:null,score:null,status:'unknown',baseline:{},history:heart===null?[]:[{date:'2026-11-14',heart}],segments:[],updatedAt:heart===null?null:'2026-11-14T12:00:00Z'});
const bootstrap=(revision=1,heart=null,extra={})=>({pet:pet(revision),devices:[],snapshot:snapshot(heart),...extra});
const response=(data,status=200)=>({ok:status>=200&&status<300,status,json:async()=>data});
const deferred=()=>{let resolve;const promise=new Promise(done=>resolve=done);return {promise,resolve};};
const memory=()=>{const data=new Map();return {getItem:key=>data.get(key)||null,setItem:(key,value)=>data.set(key,value),removeItem:key=>data.delete(key),data};};
function harness(handler, options={}) {
  const calls=[],errors=[],pets=[],snapshots=[];let tick;
  const client=createHealthData({fetcher:async(url,init)=>{calls.push({url,...init,body:init.body?JSON.parse(init.body):undefined});return handler(url,init,calls);},storage:memory(),setTimer:callback=>{tick=callback;return 1;},clearTimer:()=>{tick=null;},onError:message=>errors.push(message),onPet:value=>pets.push(value),onSnapshot:value=>snapshots.push(value),...options});
  return {client,calls,errors,pets,snapshots,tick:()=>tick?.()};
}

test('metric timestamps distinguish previous-day readings from newly uploaded metrics',()=>{
  const now=new Date(2026,10,14,15,0);
  assert.equal(recordedReadingLabel(new Date(2026,10,14,14,30).toISOString(),{now}),'Recorded 14:30');
  assert.equal(recordedReadingLabel(new Date(2026,10,13,14,30).toISOString(),{now}),'Recorded 13 Nov 14:30');
  assert.match(recordedReadingLabel(new Date(2025,10,13,14,30).toISOString(),{now}),/2025/);
  assert.equal(recordedReadingLabel(null,{now}),'');assert.equal(recordedReadingLabel('invalid',{now}),'');
});

test('cloud profile mapping preserves local images, appearance and independent folded modules',()=>{
  assert.equal('photo' in cloudCare(local).profile,false);
  assert.equal('preferences' in cloudCare(local),false);
  const merged=mergeCloudCare(local,pet(2,{profile:{name:'New name',weight:29},records:[{id:'care-a'}]}));
  assert.equal(merged.profile.name,'New name');assert.equal(merged.profile.photo,'private-photo');
  assert.deepEqual(merged.preferences,local.preferences);assert.deepEqual(merged.healthCardModules,local.healthCardModules);
  assert.deepEqual(merged.records,[{id:'care-a'}]);
});

test('anonymous preview never requests or seeds cloud data',async()=>{
  const h=harness(()=>{throw Error('unexpected');});
  await h.client.start({demo:true},local);await h.client.refresh();h.client.queueSave(local);
  assert.equal(h.calls.length,0);assert.equal(h.client.getState().authenticated,false);
});

test('first server profile imports scoped local care exactly once and uses cookie authentication',async()=>{
  const h=harness((url,init)=>response(url.endsWith('/pet')?bootstrap(1):bootstrap(0,null,{pet:pet(0,{initialized:false})})));
  await h.client.start(account,local);
  assert.deepEqual(h.calls.map(call=>call.url),['/api/health/bootstrap','/api/health/pet']);
  assert.equal(h.calls[1].method,'PUT');assert.equal(h.calls[1].body.revision,0);assert.equal(h.calls[1].credentials,'same-origin');
  assert.equal('photo' in h.calls[1].body.profile,false);assert.equal(h.client.getState().pet.revision,1);
});

test('only authenticated test accounts with no records request database seed',async()=>{
  const h=harness(url=>response(url.endsWith('/seed')?bootstrap(1,82,{snapshot:{...snapshot(82),source:'test',simulated:true}}):bootstrap()));
  await h.client.start({...account,isTest:true},local);
  assert.equal(h.calls.filter(call=>call.url.endsWith('/demo/seed')).length,1);assert.equal(h.client.getState().snapshot.source,'test');
  h.client.stop();
  const real=harness(()=>response(bootstrap()));await real.client.start(account,local);
  assert.equal(real.calls.length,1);assert.equal(real.client.getState().snapshot.score,null);
});

test('refresh renders changed database history and retains missing readings as absent',async()=>{
  let value=82;
  const root={innerHTML:'',querySelectorAll:()=>[]};
  const h=harness(()=>response(bootstrap(1,value)),{onSnapshot:sample=>renderTrends(root,sample.history)});
  await h.client.start(account,local);
  assert.match(root.innerHTML,/<strong>82<\/strong>/);assert.equal(hasAnyReadings(h.client.getState().snapshot),true);
  value=91;await h.client.refresh();
  assert.match(root.innerHTML,/<strong>91<\/strong>/);assert.doesNotMatch(root.innerHTML,/<strong>82<\/strong>/);
  assert.equal(h.client.getState().snapshot.temp,null);assert.equal(h.client.getState().snapshot.score,null);
  assert.match(root.innerHTML,/No trend data yet/);
});

test('late bootstrap from the previous account cannot mutate the next account',async()=>{
  const late=deferred();let count=0;
  const h=harness(()=>++count===1?late.promise:response(bootstrap(1,70,{pet:pet(1,{id:'pet-b'})})));
  const old=h.client.start(account,local);
  await h.client.start({id:'owner-b'},local);
  late.resolve(response(bootstrap(9,99)));await old;
  assert.equal(h.client.getState().pet.id,'pet-b');assert.equal(h.client.getState().snapshot.heart,70);
  assert.equal(h.errors.length,0);
});

test('writes serialize newer local edits without applying the earlier response to the form',async()=>{
  const first=deferred();let writes=0;
  const h=harness((url)=>url.endsWith('/pet')?(++writes===1?first.promise:response(bootstrap(3))):response(bootstrap()));
  await h.client.start(account,local);const initialPets=h.pets.length;
  h.client.queueSave({...local,profile:{...local.profile,name:'First'}});
  h.client.queueSave({...local,profile:{...local.profile,name:'Second'}});
  first.resolve(response(bootstrap(2)));await h.client.flush();
  const puts=h.calls.filter(call=>call.method==='PUT');
  assert.deepEqual(puts.map(call=>call.body.profile.name),['First','Second']);assert.deepEqual(puts.map(call=>call.body.revision),[1,2]);
  assert.equal(h.pets.length,initialPets);assert.equal(h.client.getState().saving,false);
});

test('failed cloud save survives reload through the account-scoped retry marker',async()=>{
  const storage=memory(),edited={...local,profile:{...local.profile,name:'Unsynced pet'}};
  const first=harness(url=>url.endsWith('/pet')?response({message:'Offline'},503):response(bootstrap()),{storage});
  await first.client.start(account,local);first.client.queueSave(edited);await first.client.flush();first.client.stop();
  assert.equal(storage.data.size,1);
  const marker=JSON.parse([...storage.data.values()][0]);assert.deepEqual(marker,{revision:1,dirty:true});
  const second=harness(url=>response(url.endsWith('/pet')?bootstrap(2):bootstrap()),{storage});
  await second.client.start(account,edited);
  assert.equal(second.calls.find(call=>call.method==='PUT').body.profile.name,'Unsynced pet');
  assert.equal(second.pets.length,0,'bootstrap must not replace pending local edits');
  assert.equal(storage.data.size,0);
});

test('conflict preserves pending local changes across polling and reload until explicit cloud choice',async()=>{
  const storage=memory(),edited={...local,profile:{...local.profile,name:'Local edit'}};
  const handler=url=>url.endsWith('/pet')?response({message:'Revision conflict'},409):response(bootstrap(5));
  const h=harness(handler,{storage});await h.client.start(account,local);
  h.client.queueSave(edited);await h.client.flush();const before=h.pets.length;
  await h.client.refresh();assert.equal(h.client.getState().conflict,true);assert.equal(h.pets.length,before);assert.equal(storage.data.size,1);
  h.client.stop();const resumed=harness(handler,{storage});await resumed.client.start(account,edited);
  assert.equal(resumed.client.getState().conflict,true);assert.equal(resumed.pets.length,0);
  await resumed.client.useCloudProfile();assert.equal(resumed.client.getState().conflict,false);assert.equal(resumed.pets.at(-1).profile.name,'Mochi');assert.equal(storage.data.size,0);
});

test('pending edits keep their original revision when polling sees a newer remote edit',async()=>{
  let revision=1,fail=true;
  const h=harness((url,init)=>url.endsWith('/pet')?response({message:fail?'Offline':'Conflict'},fail?503:409):response(bootstrap(revision)));
  await h.client.start(account,local);h.client.queueSave({...local,allergies:'New allergy'});await h.client.flush();
  revision=2;fail=false;await h.client.refresh();await h.client.flush();
  const puts=h.calls.filter(call=>call.method==='PUT');assert.equal(puts.at(-1).body.revision,1);assert.equal(h.client.getState().conflict,true);
});

test('a delayed earlier refresh cannot roll back a successful save or newer telemetry',async()=>{
  const delayed=deferred();let gets=0;
  const saved=bootstrap(2,95,{pet:pet(2,{profile:{...local.profile,name:'Saved name'}})});
  const h=harness(url=>url.endsWith('/pet')?response(saved):++gets===1?response(bootstrap(1,80)):delayed.promise);
  await h.client.start(account,local);
  const refresh=h.client.refresh();
  h.client.queueSave({...local,profile:{...local.profile,name:'Saved name'}});await h.client.flush();
  const applications=h.pets.length;
  delayed.resolve(response(bootstrap(1,80)));await refresh;
  assert.equal(h.client.getState().pet.revision,2);assert.equal(h.client.getState().pet.profile.name,'Saved name');
  assert.equal(h.client.getState().snapshot.heart,95);assert.equal(h.pets.length,applications);
});

test('hardware credentials are returned once to the caller and never retained in client state',async()=>{
  const h=harness(url=>response(url.endsWith('/devices')?{device:{id:'dev-a'},uploadToken:'secret-once',uploadUrl:'https://example.test/api/v1/readings'}:url.endsWith('/revoke')?{device:{id:'dev-a',status:'revoked'}}:bootstrap()));
  await h.client.start(account,local);const created=await h.client.createDevice('Collar');
  assert.equal(created.uploadToken,'secret-once');assert.doesNotMatch(JSON.stringify(h.client.getState()),/secret-once/);
  await h.client.revokeDevice('dev-a');assert.equal(h.calls.find(call=>call.url.endsWith('/revoke')).method,'POST');
});
