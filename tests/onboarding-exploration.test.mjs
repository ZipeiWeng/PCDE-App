import test from 'node:test';
import assert from 'node:assert/strict';
import {advanceExploration,canExplorePage,explorationComplete,activityScrollComplete} from '../dist/onboarding-exploration.js';

test('completion requires Activity, its bottom, then Companion',()=>{
  let progress=0;
  assert.equal(explorationComplete(progress,1),false);
  assert.equal(advanceExploration(progress,2,{activityReviewed:true}),0,'jumping to Companion cannot complete the tour');
  progress=advanceExploration(progress,0);
  assert.equal(progress,1);
  assert.equal(explorationComplete(progress,0),false);
  assert.equal(advanceExploration(progress,2),1,'visiting Activity alone does not unlock Companion');
  assert.equal(advanceExploration(progress,2,{activityReviewed:false}),1);
  progress=advanceExploration(progress,2,{activityReviewed:true});
  assert.equal(explorationComplete(progress,2),true);
  assert.equal(explorationComplete(progress,0),false,'completion is offered on Companion only');
});

test('navigation stays on Activity until its contents have been reviewed',()=>{
  assert.equal(canExplorePage(0,0),true);
  assert.equal(canExplorePage(0,2,{activityReviewed:true}),false);
  for(const page of [0,1,2])assert.equal(canExplorePage(1,page),false);
  assert.equal(canExplorePage(1,2,{activityReviewed:true}),true);
  assert.equal(canExplorePage(1,1,{activityReviewed:true}),false);
  assert.equal(canExplorePage(1,0,{activityReviewed:true}),false);
  for(const page of [0,1,2])assert.equal(canExplorePage(2,page),true);
});

test('a long Activity page unlocks only when the viewport reaches its bottom',()=>{
  const page={scrollHeight:2600,clientHeight:700};
  assert.equal(activityScrollComplete({...page,scrollTop:0}),false);
  assert.equal(activityScrollComplete({...page,scrollTop:700}),false);
  assert.equal(activityScrollComplete({...page,scrollTop:1887}),false);
  assert.equal(activityScrollComplete({...page,scrollTop:1888}),true);
  assert.equal(activityScrollComplete({...page,scrollTop:1900}),true);
  assert.equal(activityScrollComplete({...page,scrollTop:1902}),true,'touch overscroll still counts');
});

test('scroll completion accommodates fractional metrics and an explicit tolerance',()=>{
  const page={scrollHeight:1600.5,clientHeight:700.25,scrollTop:899.8};
  assert.equal(activityScrollComplete(page),true);
  assert.equal(activityScrollComplete(page,0),false);
  assert.equal(activityScrollComplete({...page,scrollTop:900.25},0),true);
  assert.equal(activityScrollComplete({...page,scrollTop:-20}),false);
});

test('fully visible content counts without asking for an impossible scroll',()=>{
  assert.equal(activityScrollComplete({scrollTop:0,scrollHeight:600,clientHeight:700}),true);
  assert.equal(activityScrollComplete({scrollTop:0,scrollHeight:700,clientHeight:700}),true);
});

test('hidden, missing and invalid measurements do not unlock navigation',()=>{
  for(const page of [undefined,{},
    {scrollTop:0,scrollHeight:0,clientHeight:0},
    {scrollTop:0,scrollHeight:700,clientHeight:0},
    {scrollTop:0,scrollHeight:0,clientHeight:700},
    {scrollTop:Infinity,scrollHeight:2600,clientHeight:700},
    {scrollTop:NaN,scrollHeight:2600,clientHeight:700},
    {scrollTop:1900,scrollHeight:Infinity,clientHeight:700},
    {scrollTop:1900,scrollHeight:2600,clientHeight:NaN}])assert.equal(activityScrollComplete(page),false);
});
