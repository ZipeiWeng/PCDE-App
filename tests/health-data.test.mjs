import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createHmac,randomBytes} from 'node:crypto';
import {readdir,readFile} from 'node:fs/promises';
import {createHealthDataHandler,loadHealthContext} from '../worker/health-data.js';
import {verifiedAccountId} from '../worker/auth.js';

const origin='https://pawprint.example';
const migrations=new URL('../drizzle/',import.meta.url);
const schema=(await Promise.all((await readdir(migrations)).filter(name=>name.endsWith('.sql')).sort().map(name=>readFile(new URL(name,migrations),'utf8')))).join('\n');
const secret='health-test-auth-secret-at-least-32-characters';
function fixture(t){
  const sql=new DatabaseSync(':memory:');sql.exec('PRAGMA foreign_keys=ON');sql.exec(schema);t.after(()=>sql.close());
  let time=Date.parse('2026-11-14T12:00:00Z');
  const db={prepare(query){const build=(args=[])=>({bind:(...values)=>build(values),first:async()=>sql.prepare(query).get(...args)||null,all:async()=>({success:true,results:sql.prepare(query).all(...args)}),run:async()=>({success:true,meta:{changes:Number(sql.prepare(query).run(...args).changes)}}),_run:()=>({success:true,meta:{changes:Number(sql.prepare(query).run(...args).changes)}})});return build();},async batch(statements){sql.exec('BEGIN');try{const result=statements.map(statement=>statement._run());sql.exec('COMMIT');return result;}catch(error){sql.exec('ROLLBACK');throw error;}}};
  const env={AUTH_DB:db,AUTH_SECRET:secret},cookies={};
  for(const [id,name] of [['owner-a','Luna'],['owner-b','Max']]){
    const token=randomBytes(32).toString('hex');cookies[id]=`__Host-pawprint_session=${token}`;
    sql.prepare('INSERT INTO auth_accounts VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run(id,id,id,`${id}@example.invalid`,`${id}@example.invalid`,name,name.toLowerCase(),'2023-03-17','female','unused','unused',time);
    sql.prepare('INSERT INTO auth_sessions VALUES(?,?,?,?)').run(createHmac('sha256',secret).update(`session:${token}`).digest('hex'),id,time+365*86400000,time);
  }
  const testId='test_'+randomBytes(16).toString('hex'),testToken='test.'+randomBytes(32).toString('hex');
  sql.prepare('INSERT INTO auth_test_sessions VALUES(?,?,?,?,?)').run(testId,createHmac('sha256',secret).update(`session:${testToken}`).digest('hex'),'',time+30*86400000,time);
  cookies.test=`__Host-pawprint_session=${testToken}`;
  const handler=createHealthDataHandler({getAccountId:verifiedAccountId,now:()=>time});
  function request(path,method='GET',body,account='owner-a',headers={}){
    return new Request(origin+path,{method,headers:{...(cookies[account]?{Cookie:cookies[account]}:{}),...(method!=='GET'?{Origin:origin,'Content-Type':'application/json'}:{}),...headers},...(body===undefined?{}:{body:JSON.stringify(body)})});
  }
  const call=(path,method,body,account,headers)=>handler(request(path,method,body,account,headers),env);
  const bootstrap=async(account='owner-a')=>{const response=await call('/api/health/bootstrap','GET',undefined,account);assert.equal(response.status,200);return response.json();};
  const provision=async(account='owner-a',label='Pawprint One')=>{const response=await call('/api/health/devices','POST',{label},account);assert.equal(response.status,201);return response.json();};
  const sample=(patch={})=>({sampleId:randomBytes(8).toString('hex'),recordedAt:new Date(time).toISOString(),heartBpm:82,skinTemperatureC:34.6,stepsToday:6248,estimatedSleepHoursToday:7.7,...patch});
  const ingest=(token,body=sample(),headers={})=>call('/api/v1/telemetry','POST',body,null,{Authorization:`Bearer ${token}`,Origin:'',...headers});
  return {sql,db,env,handler,request,call,bootstrap,provision,sample,ingest,cookies,testId,now:()=>time,advance:ms=>{time+=ms;}};
}
const petInput=pet=>({revision:pet.revision,profile:pet.profile,goals:pet.goals,allergies:pet.allergies,conditions:pet.conditions,ownerName:pet.ownerName,doctorName:pet.doctorName,clinicName:pet.clinicName,records:pet.records});
const record=(id='record-1')=>({id,type:'observation',title:'Owner note',date:'2026-11-14T09:00:00.000Z',details:'A normal morning walk.',author:'Owner'});

test('bootstrap uses actual session identity, initializes only an empty owner pet and never exposes secrets',async t=>{
  const f=fixture(t);
  assert.equal((await f.call('/api/health/bootstrap','GET',undefined,null)).status,401);
  assert.equal((await f.call('/api/health/bootstrap','GET',undefined,null,{'oai-authenticated-user-id':'owner-a','oai-authenticated-user-email':'a@example.invalid','x-owner-id':'owner-a'})).status,401);
  const first=await f.bootstrap(),again=await f.bootstrap(),other=await f.bootstrap('owner-b');
  assert.equal(first.pet.id,again.pet.id);assert.notEqual(first.pet.id,other.pet.id);
  assert.equal(first.pet.profile.name,'Luna');assert.equal(other.pet.profile.name,'Max');
  assert.equal(first.pet.initialized,false);assert.equal(first.pet.revision,0);assert.deepEqual(first.pet.records,[]);
  assert.equal(first.snapshot.source,'unavailable');assert.equal(first.snapshot.simulated,false);assert.equal(first.snapshot.score,null);
  for(const key of ['heart','temp','steps','sleep'])assert.equal(first.snapshot[key],null);
  assert.equal(first.snapshot.status,'unknown');assert.deepEqual(first.snapshot.history,[]);
  assert.ok(!JSON.stringify(first).includes('owner_id'));assert.ok(!JSON.stringify(first).includes('password'));assert.ok(!JSON.stringify(first).includes('token_hash'));
  const testPet=await f.bootstrap('test');assert.equal(testPet.pet.profile.name,'Mochi');assert.equal(testPet.pet.initialized,false);assert.equal(testPet.snapshot.score,null);
  assert.equal(f.sql.prepare('SELECT COUNT(*) AS n FROM health_pets').get().n,3);
});

test('profile and care records persist atomically with revision checks and independent owner scope',async t=>{
  const f=fixture(t),a=await f.bootstrap(),b=await f.bootstrap('owner-b');
  const input={...petInput(a.pet),profile:{...a.pet.profile,name:'Luna updated'},records:[record(),record('record-2')],allergies:'Pollen'};
  let response=await f.call('/api/health/pet','PUT',input);assert.equal(response.status,200);
  const saved=await response.json();assert.equal(saved.pet.revision,1);assert.equal(saved.pet.initialized,true);assert.equal(saved.pet.records.length,2);assert.equal(saved.pet.allergies,'Pollen');
  response=await f.call('/api/health/pet','PUT',{...input,records:[{...record(),details:'Stale client overwrites'}]});assert.equal(response.status,409);assert.equal((await response.json()).revision,1);
  const after=await f.bootstrap();assert.equal(after.pet.records.length,2);assert.equal(after.pet.records[0].details,record().details);
  assert.deepEqual((await f.bootstrap('owner-b')).pet,b.pet);
  const revisionBefore=after.pet.revision;
  response=await f.call('/api/health/pet','PUT',{...petInput(after.pet),records:[record(),record()]});assert.equal(response.status,400);
  assert.equal((await f.bootstrap()).pet.revision,revisionBefore);
  response=await f.call('/api/health/pet','PUT',{...petInput(after.pet),records:[{...record('record-3'),author:'Verified veterinarian'}]});assert.equal(response.status,200);
  const changed=await response.json();assert.equal(changed.pet.records.length,1);assert.equal(changed.pet.records[0].author,'Owner');
});

test('profile writes reject cross-site, oversized and unsupported fields without changing stored content',async t=>{
  const f=fixture(t),base=petInput((await f.bootstrap()).pet);
  assert.equal((await f.call('/api/health/pet','PUT',base,'owner-a',{Origin:'https://attacker.example'})).status,403);
  assert.equal((await f.call('/api/health/pet','PUT',base,'owner-a',{'Sec-Fetch-Site':'cross-site'})).status,403);
  assert.equal((await f.call('/api/health/pet','PUT',base,'owner-a',{'Content-Type':'text/plain'})).status,415);
  assert.equal((await f.call('/api/health/pet','PUT',base,'owner-a',{'Content-Length':String(256*1024+1)})).status,413);
  for(const patch of [{owner_id:'owner-b'},{revision:-1},{revision:'0'},{profile:{...base.profile,photo:'data:fake'}},{profile:{...base.profile,birthday:'2026-02-31'}},{profile:{...base.profile,weight:301}},{records:Array.from({length:201},(_,i)=>record(String(i)))},{records:[{...record(),accountId:'owner-b'}]},{goals:{steps:8000,sleep:25}}])assert.equal((await f.call('/api/health/pet','PUT',{...base,...patch})).status,400,JSON.stringify(patch).slice(0,100));
  assert.equal((await f.bootstrap()).pet.revision,0);
});

test('profile CAS response retains its committed revision if another writer commits before response assembly',async t=>{
  const f=fixture(t),initial=await f.bootstrap(),input={...petInput(initial.pet),profile:{...initial.pet.profile,name:'First writer'},records:[record()]};
  const batch=f.db.batch;
  f.db.batch=async statements=>{
    const result=await batch(statements);
    f.sql.prepare('UPDATE health_pets SET revision=revision+1,profile_json=? WHERE id=?').run(JSON.stringify({...initial.pet.profile,name:'Second writer'}),initial.pet.id);
    return result;
  };
  const response=await f.call('/api/health/pet','PUT',input);assert.equal(response.status,200);
  const returned=await response.json();assert.equal(returned.pet.revision,1);assert.equal(returned.pet.profile.name,'First writer');assert.equal(returned.pet.records.length,1);
  const actual=await f.bootstrap();assert.equal(actual.pet.revision,2);assert.equal(actual.pet.profile.name,'Second writer');
  f.db.batch=batch;
  assert.equal((await f.call('/api/health/pet','PUT',{...input,revision:returned.pet.revision})).status,409);
});

test('care-record constraint failure rolls back the profile revision and existing records in one transaction',async t=>{
  const f=fixture(t),initial=await f.bootstrap();
  const first=await f.call('/api/health/pet','PUT',{...petInput(initial.pet),records:[record()]});assert.equal(first.status,200);const saved=await first.json();
  f.sql.exec("CREATE TRIGGER reject_test_record BEFORE INSERT ON health_care_records WHEN NEW.id='reject' BEGIN SELECT RAISE(ABORT,'test write failure'); END");
  const failed=await f.call('/api/health/pet','PUT',{...petInput(saved.pet),profile:{...saved.pet.profile,name:'Must roll back'},records:[record('reject')]});assert.equal(failed.status,503);
  const after=await f.bootstrap();assert.deepEqual(after.pet,saved.pet);
  const other=await f.bootstrap('owner-b');assert.throws(()=>f.sql.prepare('INSERT INTO health_care_records VALUES(?,?,?,?,?)').run(other.pet.id,'owner-a','foreign',0,'{}'),/FOREIGN KEY/);
});

test('device token is once-only, hashed, scoped and independently revocable',async t=>{
  const f=fixture(t),created=await f.provision();
  assert.match(created.uploadToken,/^pp_dev_[a-f0-9]{64}$/);assert.equal(created.uploadUrl,origin+'/api/v1/telemetry');
  assert.equal(created.device.status,'waiting');assert.equal(created.device.source,'device');assert.equal(created.device.provisioned,true);
  assert.equal(Date.parse(created.device.expiresAt)-f.now(),180*86400000);
  const stored=f.sql.prepare('SELECT * FROM health_devices WHERE id=?').get(created.device.id);
  assert.notEqual(stored.token_hash,created.uploadToken);assert.equal(stored.token_hash.length,64);
  const bootstrap=await f.bootstrap();assert.ok(!JSON.stringify(bootstrap).includes(created.uploadToken));assert.ok(!JSON.stringify(bootstrap).includes(stored.token_hash));
  assert.equal((await f.bootstrap('owner-b')).devices.length,0);
  assert.equal((await f.call(`/api/health/devices/${created.device.id}/revoke`,'POST',{},'owner-b')).status,404);
  assert.equal((await f.ingest(created.uploadToken)).status,201);
  const revoked=await f.call(`/api/health/devices/${created.device.id}/revoke`,'POST',{});assert.equal(revoked.status,200);assert.equal((await revoked.json()).device.status,'revoked');
  assert.equal((await f.ingest(created.uploadToken)).status,401);
  assert.equal((await f.bootstrap()).snapshot.heart,82,'Revocation preserves historical readings.');
  const testDevice=await f.provision('test');assert.equal(testDevice.device.source,'test');assert.equal(Date.parse(testDevice.device.expiresAt),f.now()+30*86400000);
});

test('native bearer ingest has no session or Origin requirement; strict idempotency and conflict preserve one row',async t=>{
  const f=fixture(t),device=await f.provision(),sample=f.sample({sampleId:'boot-01:42'});
  const first=await f.ingest(device.uploadToken,sample);assert.equal(first.status,201);const initial=await first.json();assert.equal(initial.accepted,1);assert.equal(initial.duplicate,false);
  const duplicate=await f.ingest(device.uploadToken,{estimatedSleepHoursToday:sample.estimatedSleepHoursToday,stepsToday:sample.stepsToday,skinTemperatureC:sample.skinTemperatureC,heartBpm:sample.heartBpm,recordedAt:sample.recordedAt,sampleId:sample.sampleId});assert.equal(duplicate.status,200);
  const repeated=await duplicate.json();assert.equal(repeated.accepted,0);assert.equal(repeated.duplicate,true);assert.equal(repeated.receivedAt,initial.receivedAt);
  const conflict=await f.ingest(device.uploadToken,{...sample,heartBpm:99});assert.equal(conflict.status,409);assert.equal((await conflict.json()).code,'sample_conflict');
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM health_readings').get().n,1);
  const a=await f.bootstrap(),b=await f.bootstrap('owner-b');assert.equal(a.snapshot.heart,82);assert.equal(a.snapshot.source,'device');assert.equal(a.snapshot.simulated,false);assert.equal(a.snapshot.connected,true);assert.equal(a.snapshot.score,null);assert.equal(a.snapshot.status,'unknown');assert.deepEqual(a.snapshot.baseline,{});assert.equal(a.devices[0].status,'connected');assert.equal(b.snapshot.heart,null);
  assert.equal((await f.call('/api/v1/telemetry','POST',sample)).status,401,'An owner cookie does not authorize hardware uploads.');
  assert.equal((await f.ingest('pp_dev_'+'a'.repeat(64),sample)).status,401);
});

test('telemetry validation rejects injection, invalid timestamps, all-null data, coercion and oversized streams',async t=>{
  const f=fixture(t),{uploadToken}=await f.provision();
  for(const patch of [{sampleId:"sample'); DROP TABLE health_pets;--"},{recordedAt:'2026-02-31T12:00:00Z'},{recordedAt:'2026-10-01T12:00:00Z'},{recordedAt:'2026-11-14T12:06:00Z'},{recordedAt:'2026-11-14T12:00:00+00:00'},{heartBpm:'82'},{heartBpm:401},{skinTemperatureC:61},{stepsToday:1.1},{stepsToday:-1},{estimatedSleepHoursToday:25},{petId:'owner-b'},{source:'test'},{heartBpm:null,skinTemperatureC:null,stepsToday:null,estimatedSleepHoursToday:null}]){
    const response=await f.ingest(uploadToken,f.sample(patch));assert.equal(response.status,400,JSON.stringify(patch));
  }
  assert.equal((await f.ingest(uploadToken,f.sample(),{'Content-Length':'4097'})).status,413);
  assert.equal((await f.ingest(uploadToken,f.sample(),{'Content-Type':'text/plain'})).status,415);
  const request=new Request(origin+'/api/v1/telemetry',{method:'POST',headers:{Authorization:`Bearer ${uploadToken}`,'Content-Type':'application/json'},body:new ReadableStream({start(controller){controller.enqueue(new TextEncoder().encode(' '.repeat(4097)));controller.close();}}),duplex:'half'});
  assert.equal((await f.handler(request,f.env)).status,413);
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM health_readings').get().n,0);
  const partial=await f.ingest(uploadToken,{sampleId:'only-heart',recordedAt:new Date(f.now()).toISOString(),heartBpm:0});assert.equal(partial.status,201);
  const state=await f.bootstrap();assert.equal(state.snapshot.heart,0);assert.equal(state.snapshot.steps,null);assert.equal(state.snapshot.availability,'partial');assert.equal(state.snapshot.score,null);
});

test('seven-day history averages spot readings and uses latest daily counters including corrected lower values',async t=>{
  const f=fixture(t),{uploadToken}=await f.provision();
  const samples=[
    {sampleId:'old',recordedAt:'2026-11-06T12:00:00Z',heartBpm:60,stepsToday:7000},
    {sampleId:'yesterday',recordedAt:'2026-11-13T12:00:00Z',heartBpm:70,stepsToday:5000,estimatedSleepHoursToday:8},
    {sampleId:'am',recordedAt:'2026-11-14T08:00:00Z',heartBpm:80,skinTemperatureC:34,stepsToday:100,estimatedSleepHoursToday:4},
    {sampleId:'late',recordedAt:'2026-11-14T10:00:00Z',heartBpm:100,skinTemperatureC:36,stepsToday:200,estimatedSleepHoursToday:5},
    {sampleId:'correction',recordedAt:'2026-11-14T11:00:00Z',stepsToday:180,estimatedSleepHoursToday:4.8},
  ];
  for(const sample of samples)assert.equal((await f.ingest(uploadToken,sample)).status,201);
  const {snapshot}=await f.bootstrap();assert.equal(snapshot.heart,100);assert.equal(snapshot.temp,36);assert.equal(snapshot.steps,180);assert.equal(snapshot.sleep,4.8);
  assert.equal(snapshot.history.length,2);assert.deepEqual(snapshot.history.at(-1),{date:'2026-11-14',heart:90,temp:35,steps:180,sleep:4.8});assert.equal(snapshot.score,null);assert.equal(snapshot.stale,true);
  f.advance(13*3600000);const next=await f.bootstrap();assert.equal(next.snapshot.steps,null,'Yesterday\'s cumulative counter is never today\'s steps.');assert.equal(next.snapshot.sleep,null);assert.equal(next.snapshot.heart,100);
  f.advance(24*3600000);const stale=await f.bootstrap();assert.equal(stale.snapshot.heart,null);assert.equal(stale.snapshot.availability,'unavailable');assert.equal(stale.snapshot.stale,true);assert.ok(stale.snapshot.history.length>0);assert.equal(stale.devices[0].status,'stale');
});

test('device credentials expire and owner deletion invalidates them without granting a cookie fallback',async t=>{
  const f=fixture(t),first=await f.provision();
  f.sql.prepare('UPDATE health_devices SET token_expires_at=? WHERE id=?').run(f.now()-1,first.device.id);
  assert.equal((await f.ingest(first.uploadToken)).status,401);assert.equal((await f.bootstrap()).devices[0].status,'stale');
  const next=await f.provision('owner-b');f.sql.prepare('DELETE FROM auth_accounts WHERE id=?').run('owner-b');assert.equal((await f.ingest(next.uploadToken)).status,401);
  const testDevice=await f.provision('test');f.sql.prepare('UPDATE auth_test_sessions SET expires_at=? WHERE id=?').run(f.now()-1,f.testId);assert.equal((await f.ingest(testDevice.uploadToken)).status,401);assert.equal((await f.call('/api/health/bootstrap','GET',undefined,'test')).status,401);
});

test('revocation between token lookup and insert rejects the upload including an exact replay',async t=>{
  const f=fixture(t),device=await f.provision(),sample=f.sample();
  assert.equal((await f.ingest(device.uploadToken,sample)).status,201);
  const batch=f.db.batch;
  f.db.batch=async statements=>{f.sql.prepare('UPDATE health_devices SET revoked_at=? WHERE id=?').run(f.now(),device.device.id);return batch(statements);};
  assert.equal((await f.ingest(device.uploadToken,sample)).status,401);
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM health_readings').get().n,1);
});

test('same-timestamp samples use arrival order for latest counters and optional nulls remain missing',async t=>{
  const f=fixture(t),device=await f.provision(),recordedAt=new Date(f.now()).toISOString();
  for(const [sampleId,stepsToday] of [['first',100],['second',80]])assert.equal((await f.ingest(device.uploadToken,{sampleId,recordedAt,stepsToday,heartBpm:null})).status,201);
  const {snapshot}=await f.bootstrap();assert.equal(snapshot.steps,80);assert.equal(snapshot.history[0].steps,80);assert.equal(snapshot.heart,null);assert.equal(snapshot.history[0].heart,null);
});

test('test seed is isolated, idempotent and labelled simulation; real accounts cannot request it',async t=>{
  const f=fixture(t);
  assert.equal((await f.call('/api/health/demo/seed','POST',{})).status,403);
  let response=await f.call('/api/health/demo/seed','POST',{},'test');assert.equal(response.status,200);const first=await response.json();
  assert.equal(first.snapshot.source,'test');assert.equal(first.snapshot.simulated,true);assert.equal(first.snapshot.history.length,7);assert.equal(first.snapshot.heart,82);assert.equal(first.snapshot.score,null);assert.equal(first.pet.initialized,false);assert.equal(first.devices[0].provisioned,false);
  f.advance(1000);response=await f.call('/api/health/demo/seed','POST',{},'test');assert.equal(response.status,200);assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM health_readings').get().n,7);assert.equal((await f.bootstrap()).snapshot.history.length,0);
  const testDevice=await f.provision('test');assert.equal((await f.ingest(testDevice.uploadToken,f.sample({heartBpm:91}))).status,201);const updated=await f.bootstrap('test');assert.equal(updated.snapshot.heart,91);assert.equal(updated.snapshot.source,'test');assert.equal(updated.snapshot.simulated,true);
});

test('TEST example dates roll forward after midnight and missed days without duplicating legacy seeds',async t=>{
  const f=fixture(t);
  const empty=await f.bootstrap('test');assert.equal(empty.snapshot.source,'unavailable');assert.equal(empty.devices.length,0);
  f.advance(13*3600000);
  const stillEmpty=await f.bootstrap('test');assert.equal(stillEmpty.snapshot.steps,null);assert.equal(stillEmpty.devices.length,0);
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM health_readings').get().n,0,'Reading an unseeded TEST account must not opt into examples.');
  const response=await f.call('/api/health/demo/seed','POST',{},'test');assert.equal(response.status,200);
  const first=await response.json();
  // Existing deployed seeds used example-0..6 rather than calendar-date IDs.
  const originalRows=f.sql.prepare('SELECT * FROM health_readings ORDER BY recorded_at').all();
  for(const [index,row] of originalRows.entries())f.sql.prepare('UPDATE health_readings SET sample_id=? WHERE id=?').run(`example-${index}`,row.id);
  const preservedRows=f.sql.prepare('SELECT * FROM health_readings ORDER BY recorded_at').all();
  f.advance(60000);const sameDay=await f.bootstrap('test');
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM health_readings').get().n,7);
  assert.equal(sameDay.snapshot.updatedAt,first.snapshot.updatedAt,'Polling must not make an unchanged sample look fresh.');
  f.advance(24*3600000);const tomorrow=await f.bootstrap('test');
  assert.equal(tomorrow.snapshot.availability,'available');assert.equal(tomorrow.snapshot.steps,6248);assert.equal(tomorrow.snapshot.sleep,7.7);assert.equal(tomorrow.snapshot.heart,82);
  assert.equal(tomorrow.snapshot.updatedAt,new Date(f.now()).toISOString());assert.equal(tomorrow.snapshot.history.length,7);assert.equal(tomorrow.snapshot.history.at(-1).date,'2026-11-16');
  assert.equal(tomorrow.snapshot.source,'test');assert.equal(tomorrow.snapshot.simulated,true);assert.equal(tomorrow.snapshot.score,null,'The API still does not claim a validated health assessment.');
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM health_readings').get().n,8);
  assert.equal(f.sql.prepare('SELECT sample_id FROM health_readings ORDER BY recorded_at DESC LIMIT 1').get().sample_id,'example-2026-11-16');
  await f.bootstrap('test');assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM health_readings').get().n,8);
  assert.deepEqual(f.sql.prepare('SELECT * FROM health_readings WHERE recorded_at<? ORDER BY recorded_at').all(Date.parse(tomorrow.snapshot.updatedAt)),preservedRows,'Past examples must never be rewritten.');
  f.advance(8*86400000);const resumed=await f.bootstrap('test');
  assert.equal(resumed.snapshot.history.length,7);assert.equal(resumed.snapshot.history[0].date,'2026-11-18');assert.equal(resumed.snapshot.history.at(-1).date,'2026-11-24');
  assert.equal(resumed.snapshot.steps,6248);assert.equal(resumed.snapshot.sleep,7.7);
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM health_readings').get().n,15);
  await f.bootstrap('test');assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM health_readings').get().n,15);
  const owner=await f.bootstrap();assert.equal(owner.snapshot.source,'unavailable');assert.equal(owner.snapshot.steps,null);assert.equal(owner.devices.length,0);
});

test('any uploaded TEST measurements stop example rollover, including a custom device called Example sensor',async t=>{
  const f=fixture(t);
  assert.equal((await f.call('/api/health/demo/seed','POST',{},'test')).status,200);
  const custom=await f.provision('test','Example sensor');
  assert.equal((await f.ingest(custom.uploadToken,{sampleId:'uploaded-heart',recordedAt:new Date(f.now()).toISOString(),heartBpm:91})).status,201);
  const count=f.sql.prepare('SELECT COUNT(*) n FROM health_readings').get().n;
  f.advance(13*3600000);const nextDay=await f.bootstrap('test');
  assert.equal(nextDay.snapshot.heart,91);assert.equal(nextDay.snapshot.steps,null);assert.equal(nextDay.snapshot.sleep,null);assert.equal(nextDay.snapshot.availability,'partial');
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM health_readings').get().n,count);
  assert.equal((await f.call('/api/health/demo/seed','POST',{},'test')).status,200);
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM health_readings').get().n,count,'Even explicit reseeding must not supersede uploaded measurements.');
  assert.equal((await f.call(`/api/health/devices/${custom.device.id}/revoke`,'POST',{},'test')).status,200);
  f.advance(24*3600000);const later=await f.bootstrap('test');
  assert.equal(later.snapshot.heart,null);assert.equal(later.snapshot.availability,'unavailable');
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM health_readings').get().n,count,'Revoking a custom device must preserve its readings, not reactivate examples.');
});

test('an upload between example rollover lookup and transaction suppresses every example insert',async t=>{
  const f=fixture(t);
  assert.equal((await f.call('/api/health/demo/seed','POST',{},'test')).status,200);
  const custom=await f.provision('test'),batch=f.db.batch;
  f.advance(13*3600000);
  f.db.batch=async statements=>{
    f.db.batch=batch;
    assert.equal((await f.ingest(custom.uploadToken,{sampleId:'concurrent-upload',recordedAt:new Date(f.now()).toISOString(),heartBpm:91})).status,201);
    return batch(statements);
  };
  const state=await f.bootstrap('test');
  assert.equal(state.snapshot.heart,91);assert.equal(state.snapshot.steps,null);assert.equal(state.snapshot.sleep,null);
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM health_readings').get().n,8);
  assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM health_readings WHERE sample_id='example-2026-11-15'").get().n,0);
});

test('durable rate limits, device cap, methods and unknown routes have bounded explicit errors',async t=>{
  const f=fixture(t),device=await f.provision();
  for(let i=0;i<120;i++)assert.equal((await f.ingest(device.uploadToken,f.sample({sampleId:`rate-${i}`}))).status,201);
  const limited=await f.ingest(device.uploadToken);assert.equal(limited.status,429);assert.equal(limited.headers.get('retry-after'),'60');f.advance(60000);assert.equal((await f.ingest(device.uploadToken)).status,201);
  for(let i=1;i<10;i++)await f.provision();assert.equal((await f.call('/api/health/devices','POST',{label:'Too many'})).status,409);
  assert.equal((await f.call('/api/v1/telemetry')).status,405);assert.equal((await f.call('/api/health/devices','GET')).status,405);assert.equal((await f.call('/api/health/nothing')).status,404);
  assert.equal(await f.handler(new Request(origin+'/unrelated'),f.env),null);
});

test('loadHealthContext uses server readings, returns null for missing auth and surfaces real storage faults',async t=>{
  const f=fixture(t),device=await f.provision();await f.ingest(device.uploadToken,f.sample({heartBpm:88}));
  const options={getAccountId:verifiedAccountId,now:f.now};
  const context=await loadHealthContext(f.request('/api/chat','GET',undefined,'owner-a'),f.env,options);assert.equal(context.snapshot.heart,88);assert.equal(context.pet.profile.name,'Luna');
  assert.equal(await loadHealthContext(f.request('/api/chat','GET',undefined,null),f.env,options),null);
  assert.equal(await loadHealthContext(f.request('/api/chat'),{},options),null);
  const broken={...f.env,AUTH_DB:{prepare(){throw Error('db private fault');},batch(){}}};
  await assert.rejects(loadHealthContext(f.request('/api/chat'),broken,options),/db private fault/);
  const response=await f.handler(f.request('/api/health/bootstrap'),broken);assert.equal(response.status,503);assert.ok(!(await response.text()).includes('private fault'));
});
