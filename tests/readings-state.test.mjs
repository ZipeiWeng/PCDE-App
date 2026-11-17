import test from 'node:test';
import assert from 'node:assert/strict';
import { isDemoAccount,hasCurrentReadings,hasHealthScore,emptyReadingLabel } from '../dist/readings-state.js';
import {createSnapshot,createEmptySnapshot} from '../dist/model.js';
test('real account stays outside simulation even when it has an identity',()=>{
  assert.equal(isDemoAccount({id:'new-owner'}),false);
  assert.equal(isDemoAccount({id:'mochi',isTest:true}),true);
  assert.equal(isDemoAccount({demo:true}),true);
});
test('missing metrics and score never become zero or normal',()=>{
  const empty=createEmptySnapshot();
  assert.equal(hasCurrentReadings(empty),false);assert.equal(hasHealthScore(empty),false);
  assert.equal(hasCurrentReadings({...empty,heart:0,temp:0,steps:0,sleep:0}),true);
  assert.equal(hasHealthScore({...empty,score:0,status:'watch'}),true);
  assert.equal(hasCurrentReadings(createSnapshot()),true);assert.equal(hasHealthScore(createSnapshot()),true);
});
test('connected transport without sensor data still waits for readings',()=>{
  const connected=createEmptySnapshot({connected:true});
  assert.equal(hasCurrentReadings(connected),false);assert.equal(hasHealthScore(connected),false);
  assert.equal(emptyReadingLabel({connected:true}),'Waiting for first readings');
  assert.equal(emptyReadingLabel(),'Connect a collar to begin');
});
