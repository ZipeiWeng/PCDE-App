import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createVetFeedbackHandler,summarizeVetFeedback} from '../worker/vet-feedback.js';

const origin='https://pawprint.example';
const base={clinicId:'node/123',rating:4,visitDate:'2026-11-01',condition:'ear',outcome:'recovered',comment:'The team explained the follow-up clearly.',displayName:'Mochi owner',consent:true};
function fixture(t){
  const sqlite=new DatabaseSync(':memory:');sqlite.exec('CREATE TABLE auth_accounts(id TEXT PRIMARY KEY)');
  for(const id of ['owner-a','owner-b','test_demo'])sqlite.prepare('INSERT INTO auth_accounts(id) VALUES(?)').run(id);
  const db={prepare(sql){return{bind(...values){return{async first(){return sqlite.prepare(sql).get(...values)||null;},async all(){return{results:sqlite.prepare(sql).all(...values)};},async run(){return sqlite.prepare(sql).run(...values);}};},async run(){return sqlite.prepare(sql).run();}};}};
  let time=Date.parse('2026-11-13T10:00:00Z');
  const handler=createVetFeedbackHandler({getAccountId:async r=>r.headers.get('test-account'),now:()=>time});
  const env={AUTH_DB:db};
  const request=(method='GET',query='clinic=node/123',body=base,account='owner-a',headers={})=>new Request(`${origin}/api/vets/feedback?${query}`,{method,headers:{Origin:origin,...(account?{'test-account':account}:{}),...(method==='POST'?{'Content-Type':'application/json'}:{}),...headers},...(method==='POST'?{body:JSON.stringify(body)}:{})});
  t.after(()=>sqlite.close());
  return {sqlite,db,handler,env,request,advance:()=>{time+=10000;}};
}

test('public empty summaries are honest and bounded; storage failures return no fabricated feedback',async t=>{
  const f=fixture(t);
  const result=await (await f.handler(f.request('GET','ids=node/123,way/456',undefined,null),f.env)).json();
  assert.equal(result.available,true);assert.equal(result.canReview,false);
  assert.deepEqual(result.summaries['node/123'],{rating:null,reviewCount:0,reportedRecovery:{percent:null,recoveredCount:0,completedCount:0,minimumSample:5},conditionRecovery:{condition:'all',percent:null,recoveredCount:0,completedCount:0,minimumSample:5},conditionRating:{condition:'all',rating:null,reviewCount:0,positiveCount:0,positivePercent:null,minimumSample:5}});
  for(const query of ['ids=','ids=node/0','ids=node/1%27%3BDROP%20TABLE%20auth_accounts','clinic=https://evil.example','ids='+Array.from({length:41},(_,i)=>`node/${i+1}`).join(','),'ids=node/1&condition=cancer'])assert.equal((await f.handler(f.request('GET',query),f.env)).status,400);
  const unavailable=await f.handler(f.request('GET'),{});assert.equal(unavailable.status,503);assert.equal((await unavailable.json()).reviews,undefined);
});

test('only a registered non-test account may publish; same-origin JSON and explicit publication consent are required',async t=>{
  const f=fixture(t);
  for(const id of [null,'test_demo','forged-account'])assert.equal((await f.handler(f.request('POST','',base,id),f.env)).status,401);
  assert.equal((await f.handler(f.request('POST','',base,'owner-a',{Origin:'https://attacker.example'}),f.env)).status,403);
  assert.equal((await f.handler(f.request('POST','',base,'owner-a',{'Content-Type':'text/plain'}),f.env)).status,415);
  assert.equal((await f.handler(f.request('POST','',{...base,consent:false}),f.env)).status,400);
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM vet_feedback').get().n,0);
});

test('feedback validation rejects impossible dates, uncontrolled categories, identities and oversized bodies',async t=>{
  const f=fixture(t);
  for(const patch of [{rating:0},{rating:6},{rating:4.5},{rating:'5'},{condition:'invented disease'},{outcome:'cured'},{visitDate:'2026-02-31'},{visitDate:'2026-11-14'},{visitDate:'1899-01-01'},{clinicId:'node/123?query=1'},{comment:'x'.repeat(801)},{displayName:'x'.repeat(41)},{accountId:'owner-b'}]){
    assert.equal((await f.handler(f.request('POST','',{...base,...patch}),f.env)).status,400,JSON.stringify(patch).slice(0,90));
  }
  assert.equal((await f.handler(f.request('POST','',base,'owner-a',{'Content-Length':'9000'}),f.env)).status,413);
  const streamed=new Request(`${origin}/api/vets/feedback`,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json','test-account':'owner-a'},body:new ReadableStream({start(c){c.enqueue(new TextEncoder().encode(' '.repeat(8193)));c.close();}}),duplex:'half'});
  assert.equal((await f.handler(streamed,f.env)).status,413);
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM vet_feedback').get().n,0);
});

test('a review persists, updates instead of duplicating and never exposes account IDs or account metadata',async t=>{
  const f=fixture(t);
  const first=await f.handler(f.request('POST'),f.env);assert.equal(first.status,200);
  const initial=await first.json();assert.equal(initial.canReview,true);assert.equal(initial.summary.reviewCount,1);assert.equal(initial.summary.rating,4);assert.equal(initial.summary.reportedRecovery.percent,null);
  assert.equal(initial.ownReview.comment,base.comment);assert.equal(initial.ownReview.displayName,'Mochi owner');
  f.advance();
  const updated=await (await f.handler(f.request('POST','',{...base,rating:5,outcome:'improved'}),f.env)).json();
  assert.equal(updated.summary.reviewCount,1);assert.equal(updated.summary.rating,5);assert.equal(updated.summary.reportedRecovery.recoveredCount,0);
  assert.equal(updated.ownReview.createdAt,initial.ownReview.createdAt);assert.notEqual(updated.ownReview.updatedAt,initial.ownReview.updatedAt);
  const publicBody=await (await f.handler(f.request('GET','clinic=node/123',undefined,null),f.env)).json();
  assert.equal(publicBody.ownReview,null);assert.equal(publicBody.canReview,false);assert.equal(publicBody.reviews.length,1);
  assert.ok(!JSON.stringify(publicBody).includes('owner-a'));assert.ok(!JSON.stringify(publicBody).includes('account_id'));assert.ok(!JSON.stringify(publicBody).includes('email'));
  const other=await (await f.handler(f.request('GET','clinic=node/123',undefined,'owner-b'),f.env)).json();assert.equal(other.ownReview,null);
});

test('percentages use completed owner follow-ups, exclude ongoing cases and need five matched outcomes',async t=>{
  const f=fixture(t);await f.handler(f.request(),f.env);
  const rows=[['recovered','ear',5],['recovered','ear',4],['recovered','ear',5],['improved','mobility',4],['worse','mobility',2],['ongoing','ear',3]];
  const insert=f.sqlite.prepare('INSERT INTO vet_feedback VALUES(?,?,?,?,?,?,?,?,?,?)');
  rows.forEach(([outcome,condition,rating],i)=>insert.run('node/123',`real-${i}`,rating,condition,outcome,'2026-11-01','Pet owner','',i,i));
  const value=await (await f.handler(f.request('GET','clinic=node/123&condition=ear',undefined,null),f.env)).json();
  assert.equal(value.summary.reviewCount,6);assert.equal(value.summary.rating,3.8);
  assert.deepEqual(value.summary.reportedRecovery,{percent:60,recoveredCount:3,completedCount:5,minimumSample:5});
  assert.deepEqual(value.summary.conditionRecovery,{condition:'ear',percent:null,recoveredCount:3,completedCount:3,minimumSample:5});
  const all=await (await f.handler(f.request('GET','clinic=node/123',undefined,null),f.env)).json();assert.equal(all.summary.conditionRecovery.percent,60);
  assert.equal(summarizeVetFeedback([],['way/22'])['way/22'].reportedRecovery.percent,null);
});

test('deleting a review affects only its signed-in owner and immediately removes it from aggregate counts',async t=>{
  const f=fixture(t);
  await f.handler(f.request('POST'),f.env);await f.handler(f.request('POST','',{...base,rating:2,displayName:'Second owner'},'owner-b'),f.env);
  assert.equal((await f.handler(f.request('DELETE','clinic=node/123',undefined,null),f.env)).status,401);
  const deleted=await (await f.handler(f.request('DELETE','clinic=node/123'),f.env)).json();
  assert.equal(deleted.ownReview,null);assert.equal(deleted.summary.reviewCount,1);assert.equal(deleted.summary.rating,2);assert.equal(deleted.reviews[0].displayName,'Second owner');
  const other=await (await f.handler(f.request('GET','clinic=node/123',undefined,'owner-b'),f.env)).json();assert.ok(other.ownReview);
});

test('details return only the most recent 20 public entries while summary includes all owner follow-ups',async t=>{
  const f=fixture(t);await f.handler(f.request(),f.env);
  const insert=f.sqlite.prepare('INSERT INTO vet_feedback VALUES(?,?,?,?,?,?,?,?,?,?)');
  for(let i=0;i<25;i++)insert.run('node/123',`real-${i}`,5,'general','recovered','2026-11-01',`Owner ${i}`,'',i,i);
  const value=await (await f.handler(f.request('GET','clinic=node/123',undefined,null),f.env)).json();
  assert.equal(value.summary.reviewCount,25);assert.equal(value.summary.reportedRecovery.percent,100);assert.equal(value.reviews.length,20);assert.equal(value.reviews[0].displayName,'Owner 24');assert.equal(value.reviews.at(-1).displayName,'Owner 5');
});


test('service-specific feedback uses matched 4/5-star reviews and never substitutes unrelated ratings',async t=>{
  const f=fixture(t);await f.handler(f.request(),f.env);
  const insert=f.sqlite.prepare('INSERT INTO vet_feedback VALUES(?,?,?,?,?,?,?,?,?,?)');
  [5,4,5,3,4].forEach((rating,i)=>insert.run('node/123',`vaccine-${i}`,rating,'vaccination','ongoing','2026-11-01',`Owner ${i}`,'',i,i));
  insert.run('node/123','skin-1',1,'skin','worse','2026-11-01','Another owner','',20,20);
  const data=await (await f.handler(f.request('GET','clinic=node/123&condition=vaccination',undefined,null),f.env)).json();
  assert.deepEqual(data.summary.conditionRating,{condition:'vaccination',rating:4.2,reviewCount:5,positiveCount:4,positivePercent:80,minimumSample:5});
  assert.equal(data.summary.reviewCount,6);assert.equal(data.summary.conditionRecovery.percent,null);
  assert.equal(data.reviews.length,5);assert.ok(data.reviews.every(review=>review.condition==='vaccination'));
  const skin=await (await f.handler(f.request('GET','clinic=node/123&condition=skin',undefined,null),f.env)).json();
  assert.deepEqual(skin.summary.conditionRating,{condition:'skin',rating:1,reviewCount:1,positiveCount:0,positivePercent:null,minimumSample:5});
  const missing=await (await f.handler(f.request('GET','clinic=node/123&condition=dental',undefined,null),f.env)).json();
  assert.equal(missing.summary.conditionRating.rating,null);assert.equal(missing.summary.conditionRating.positivePercent,null);assert.equal(missing.reviews.length,0);
});

test('candidate feedback accepts forty IDs and vaccination reviews persist through the normal consent flow',async t=>{
  const f=fixture(t);
  const response=await f.handler(f.request('POST','condition=vaccination',{...base,condition:'vaccination',rating:5,outcome:'ongoing'}),f.env);
  assert.equal(response.status,200);assert.equal((await response.json()).summary.conditionRating.rating,5);
  const ids=Array.from({length:40},(_,i)=>`node/${i+1}`).join(',');
  const all=await f.handler(f.request('GET',`ids=${ids}&condition=vaccination`,undefined,null),f.env);
  assert.equal(all.status,200);assert.equal(Object.keys((await all.json()).summaries).length,40);
});
