import test from 'node:test';
import assert from 'node:assert/strict';
import { recordDeviceAlert, updateDeviceAlertTrend, normalizeDeviceAlerts, alertCountSeries } from '../dist/device-alerts.js';

const at='2026-11-13T10:00:00.000Z';
const baseline={heart:80,temp:34.5,steps:6500,sleep:8};
const watch={status:'watch',score:70,heart:90,temp:35,steps:5000,sleep:7,baseline,observedSigns:[],observationSource:'demo',updatedAt:'2026-11-13T16:42:00Z'};
const meta={title:'Possible discomfort',risk:'A change may accompany pain.',reason:'Activity and rest differ from usual.',source:'demo',now:at};
const later='2026-11-13T11:00:00.000Z';

test('warning records use the event time, preserve evidence, and never seed green or duplicate refreshes',()=>{
  const empty=[];
  assert.equal(recordDeviceAlert(empty,{...watch,status:'good'},meta),empty);
  const history=recordDeviceAlert(empty,watch,meta);
  assert.equal(history.length,1);
  assert.equal(history[0].at,at);
  assert.notEqual(history[0].at,watch.updatedAt);
  assert.deepEqual(history[0].metrics,{heart:90,temp:35,steps:5000,sleep:7});
  assert.deepEqual(history[0].baseline,baseline);
  assert.equal(history[0].trend.state,'insufficient');
  assert.equal(recordDeviceAlert(history,{...watch,updatedAt:later},{...meta,now:later}),history);
  assert.equal(recordDeviceAlert(history,watch,{...meta,source:'owner'}),history);
  assert.equal(recordDeviceAlert(history,watch,{...meta,now:'invalid'}),history);
  assert.equal(recordDeviceAlert(history,watch,{...meta,now:'2026-02-31T12:00:00Z'}),history);
});

test('metric trends compare original flagged readings, not a changed wellness score or unrelated metrics',()=>{
  const history=recordDeviceAlert([],watch,meta);
  const improved=updateDeviceAlertTrend(history,{...watch,heart:85,temp:34.8,steps:5800,sleep:7.5,score:10},{source:'demo',now:later});
  assert.equal(improved[0].trend.state,'improving');
  assert.match(improved[0].trend.summary,/does not confirm recovery/);
  const worsened=updateDeviceAlertTrend(history,{...watch,heart:104,temp:35.5,steps:3500,sleep:6,score:95},{source:'demo',now:later});
  assert.equal(worsened[0].trend.state,'worsening');
  const unchanged=updateDeviceAlertTrend(history,{...watch,score:99},{source:'demo',now:later});
  assert.equal(unchanged[0].trend.state,'unchanged');
  assert.equal(updateDeviceAlertTrend(unchanged,{...watch,score:99},{source:'demo',now:'2026-11-13T12:00:00Z'}),unchanged);
  assert.equal(history[0].trend.state,'insufficient','updates never mutate the old entry');
});

test('a good later assessment completes a warning and a recurring warning becomes a new event',()=>{
  const history=recordDeviceAlert([],watch,meta);
  const good={...watch,status:'good',heart:82,temp:34.6,steps:6248,sleep:7.7};
  const result=updateDeviceAlertTrend(history,good,{source:'demo',now:later});
  assert.equal(result[0].trend.state,'improving');
  assert.equal(result[0].active,false);
  assert.equal(updateDeviceAlertTrend(result,good,{source:'demo',now:'2026-11-13T12:00:00Z'}),result);
  const recurrence=recordDeviceAlert(result,watch,{...meta,now:'2026-11-13T12:00:00Z'});
  assert.equal(recurrence.length,2);
  assert.equal(recurrence[0].active,true);
  assert.equal(recurrence[1].at,at);
});

test('missing and stale data never imply recovery, and sources never cross',()=>{
  const history=recordDeviceAlert([],watch,meta);
  const missing=updateDeviceAlertTrend(history,{...watch,heart:undefined},{source:'demo',now:later});
  assert.equal(missing[0].trend.state,'insufficient');
  const stale=updateDeviceAlertTrend(history,{...watch,status:'good',...baseline},{source:'demo',now:'2026-11-15T10:00:00Z'});
  assert.equal(stale[0].trend.state,'insufficient');
  assert.equal(stale[0].active,true);
  assert.equal(updateDeviceAlertTrend(history,{...watch,observationSource:'owner'},{source:'demo',now:later}),history);
  assert.equal(updateDeviceAlertTrend(history,watch,{source:'owner',now:later}),history);
  assert.equal(updateDeviceAlertTrend(history,watch,{source:'demo',now:'2026-11-12T10:00:00Z'}),history);
});

test('owner warning trends depend on explicit observations, never improving simulated sensor readings',()=>{
  const owner={...watch,status:'alert',observedSigns:['collapse'],observationSource:'owner'};
  const history=recordDeviceAlert([],owner,{...meta,source:'owner'});
  assert.equal(recordDeviceAlert(history,{...owner,...baseline,score:100},{...meta,source:'owner',now:later}),history,'changing demo measurements is not a new owner symptom report');
  const unchanged=updateDeviceAlertTrend(history,{...owner,...baseline,score:100},{source:'owner',now:later});
  assert.equal(unchanged[0].trend.state,'unchanged');
  const missing=updateDeviceAlertTrend(history,{...owner,observedSigns:undefined},{source:'owner',now:later});
  assert.equal(missing[0].trend.state,'insufficient');
  const worse=updateDeviceAlertTrend(history,{...owner,observedSigns:['collapse','breathing_difficulty']},{source:'owner',now:later});
  assert.equal(worse[0].trend.state,'worsening');
  const cleared=updateDeviceAlertTrend(history,{...owner,status:'good',observedSigns:[]},{source:'owner',now:later});
  assert.equal(cleared[0].trend.state,'improving');
  assert.equal(cleared[0].active,false);
  assert.match(cleared[0].trend.summary,/does not confirm recovery/);
});

test('newer warnings supersede older active warnings so later refreshes do not revive old episodes',()=>{
  const first=recordDeviceAlert([],watch,meta);
  const next=recordDeviceAlert(first,{...watch,heart:105},{...meta,now:later});
  assert.equal(next.length,2);
  assert.equal(next[0].active,true);
  assert.equal(next[1].active,false);
  const done=updateDeviceAlertTrend(next,{...watch,status:'good',...baseline},{source:'demo',now:'2026-11-13T12:00:00Z'});
  assert.equal(done[0].active,false);
  assert.equal(updateDeviceAlertTrend(done,{...watch,status:'good',...baseline},{source:'demo',now:'2026-11-13T13:00:00Z'}),done);
});

test('normalized history is bounded, time ordered, deduplicated, and strips advice or malformed fields',()=>{
  const base=recordDeviceAlert([],watch,meta)[0];
  const entries=Array.from({length:220},(_,i)=>({...base,id:`event-${i}`,at:new Date(Date.parse(at)+i*1000).toISOString(),advice:'Do not persist this'}));
  entries.push({...base,source:'unverified'},{...base,at:'invalid'},entries[0]);
  const result=normalizeDeviceAlerts(entries);
  assert.equal(result.length,200);
  assert.equal(result[0].id,'event-219');
  assert.equal('advice' in result[0],false);
  assert.equal(result.at(-1).id,'event-20');
});

test('daily count chart counts genuine event timestamps once and filters source without inventing data',()=>{
  const base=recordDeviceAlert([],watch,meta)[0];
  const history=[base,{...base,id:'earlier',at:'2026-11-12T10:00:00Z'},{...base,id:'owner',source:'owner'},{...base,id:'future',at:'2026-11-14T10:00:00Z'},{...base,id:'old',at:'2026-11-01T10:00:00Z'},base];
  const series=alertCountSeries(history,{now:later,days:7});
  assert.equal(series.length,7);
  assert.equal(series.at(-1).date,'2026-11-13');
  assert.equal(series.at(-1).count,2);
  assert.equal(series.at(-2).count,1);
  assert.equal(series.reduce((sum,item)=>sum+item.count,0),3);
  assert.equal(alertCountSeries(history,{now:later,source:'demo'}).at(-1).count,1);
  assert.ok(alertCountSeries([],{now:later}).every(item=>item.count===0));
});
