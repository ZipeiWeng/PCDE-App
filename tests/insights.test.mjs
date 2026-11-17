import test from 'node:test';
import assert from 'node:assert/strict';

// UI imports attach two close listeners; the decision helper itself is DOM-free.
globalThis.document = { getElementById: () => ({ addEventListener() {} }) };
const { describeCurrentPattern, currentUrgentSigns } = await import('../dist/insights.js');
const usual = { heart:80, temp:34.5, steps:6500, sleep:8 };
const snapshot = values => ({ ...usual, baseline:{...usual}, status:'watch', ...values });

test('normal scores never override a reported emergency sign', () => {
  const result = describeCurrentPattern(snapshot({status:'good', score:99, observedSigns:['breathing_difficulty']}));
  assert.equal(result.status, 'alert');
  assert.deepEqual(result.emergencySigns, ['breathing_difficulty']);
  assert.ok(result.possibilities.some(item => /airway/.test(item)));
});

test('emergency advice is available without sensor data', () => {
  const result = describeCurrentPattern({observedSigns:['collapse']});
  assert.equal(result.status, 'alert');
  assert.equal(result.readings.length, 0);
  assert.ok(result.possibilities.some(item => /circulation/.test(item)));
});

test('a legacy score-only alert is not described as a proven acute emergency', () => {
  const result = describeCurrentPattern(snapshot({status:'alert', heart:150, sleep:1, steps:1000}));
  assert.equal(result.status, 'watch');
  assert.deepEqual(result.emergencySigns, []);
  assert.deepEqual(result.possibilities, []);
  assert.match(result.risk, /possibilities if you also notice/);
});

test('unknown signs cannot create an emergency and duplicate observations collapse', () => {
  assert.deepEqual(currentUrgentSigns({observedSigns:['sleeps_less','collapse','collapse'],triage:{emergencySigns:['collapse','blue_gums']}}), ['collapse']);
  assert.equal(describeCurrentPattern(snapshot({status:'good',observedSigns:['sleeps_less']})).status, 'good');
});

test('amber joint concern names a conditional condition and the actual changed metrics', () => {
  const result=describeCurrentPattern(snapshot({steps:5000,sleep:7}));
  assert.equal(result.status,'watch');
  assert.match(result.title,/joint or muscle pain/);
  assert.match(result.risk,/Osteoarthritis/);
  assert.match(result.risk,/stiffness, limping/);
  assert.deepEqual(result.relevant.map(row=>row.key),['steps','sleep']);
  assert.equal(result.relevant[0].difference,-1500);
  assert.match(result.source.url,/pdsa.org.uk.*arthritis/);
  assert.ok(result.actions.length<=3);
});

test('heat warning stays conditional on environment rather than diagnosing skin readings', () => {
  const result=describeCurrentPattern(snapshot({steps:10000,temp:35.4}));
  assert.equal(result.title,'Heat illness risk');
  assert.match(result.risk,/If it is warm or humid/);
  assert.match(result.outlook,/do not show that it is happening/);
  assert.match(result.source.summary,/not core body temperature/);
});

test('sleep change does not invent a future disease prediction', () => {
  const result=describeCurrentPattern(snapshot({sleep:3}));
  assert.equal(result.status,'watch');
  assert.match(result.title,/disrupting rest/);
  assert.match(result.outlook,/does not show that poor sleep will cause a disease/);
});

test('missing readings remain unknown rather than falsely reassuring', () => {
  assert.equal(describeCurrentPattern({status:'good'}).status,'unknown');
  assert.equal(describeCurrentPattern({status:'alert'}).status,'unknown');
  const empty=describeCurrentPattern({status:'unknown',heart:null,temp:null,steps:null,sleep:null,baseline:{}});
  assert.equal(empty.title,'No readings yet');
  assert.equal(empty.risk,'');
  assert.equal(empty.outlook,'');
  assert.deepEqual(empty.relevant,[]);
  assert.deepEqual(empty.actions,[]);
  assert.equal(describeCurrentPattern({connected:true}).title,'Waiting for first reading');
});

test('explicit current observations replace stale triage signs', () => {
  const result=describeCurrentPattern(snapshot({status:'good',observedSigns:[],triage:{level:'good',emergencySigns:['collapse']}}));
  assert.deepEqual(result.emergencySigns,[]);
  assert.equal(result.status,'good');
});

test('uploaded partial readings remain visible without inventing a baseline or health assessment', () => {
  const result=describeCurrentPattern({source:'device',status:'unknown',heart:88,temp:null,steps:1200,sleep:null,baseline:{}});
  assert.equal(result.title,'Latest readings');
  assert.equal(result.status,'unknown');
  assert.deepEqual(result.currentReadings.map(item=>[item.key,item.value,item.usual]),[['heart',88,null],['steps',1200,null]]);
  assert.deepEqual(result.actions,[]);
  assert.equal(result.risk,'');
});

test('urgent check does not convert simulated symptoms into owner observations', async () => {
  const { initInsights } = await import('../dist/insights.js');
  const body={innerHTML:''};
  const element={textContent:'',setAttribute(){},addEventListener(){}};
  const form={addEventListener(){}};
  const dialog={open:true,dataset:{},classList:{add(){},remove(){}},querySelector(selector){
    if(selector==='.sheet-body') return body;
    if(selector==='[data-urgent-sign-form]') return form;
    return element;
  }};
  globalThis.document={getElementById(id){return id==='app-sheet'?dialog:element;}};
  let observed={scenario:'alert',observedSigns:['collapse'],observationSource:'simulated'};
  const controller=initInsights({getSnapshot:()=>observed,getStore:()=>({profile:{name:'Mochi'}})});
  controller.openSignCheck();
  assert.match(body.innerHTML,/Report what you see in your pet, not the demo scenario/);
  assert.doesNotMatch(body.innerHTML,/value="collapse" checked/);
  observed={...observed,observationSource:'owner'};
  controller.openSignCheck();
  assert.match(body.innerHTML,/value="collapse" checked/);
  assert.doesNotMatch(body.innerHTML,/not the demo scenario/);
});
