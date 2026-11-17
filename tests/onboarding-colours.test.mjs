import test from 'node:test';
import assert from 'node:assert/strict';
import { colourLesson, advanceColourLesson, colourTapAction } from '../dist/onboarding-colours.js';
import { nextTourStep, onboardingSteps } from '../dist/onboarding-flow.js';

test('each real orb colour is acknowledged in green, yellow, red order before opening details',()=>{
  let progress=0;
  for(const tone of ['good','watch','alert']){
    const lesson=colourLesson(progress);
    assert.equal(lesson.tone,tone);
    assert.equal(lesson.complete,false);
    assert.equal(nextTourStep('score',{type:'sheet-close'},{opened:true,coloursComplete:lesson.complete}),'score');
    progress=advanceColourLesson(progress,tone);
  }
  assert.equal(colourLesson(progress).complete,true);
  assert.equal(colourLesson(progress).tone,'watch');
  assert.equal(nextTourStep('score',{type:'continue'},{opened:true,coloursComplete:true}),'red-alert');
});

test('completed colours and an opened health page are required before explicitly viewing the alert',()=>{
  for(const scene of [{},{opened:false,coloursComplete:true},{opened:true},{opened:true,coloursComplete:false}]){
    assert.equal(nextTourStep('score',{type:'continue'},scene),'score');
  }
  const scene={opened:true,coloursComplete:true};
  assert.equal(nextTourStep('score',{type:'continue'},scene),'red-alert');
  assert.equal(nextTourStep('score',{type:'health-open'},scene),'score');
  assert.equal(nextTourStep('score',{type:'sheet-close'},scene),'score','a close/swipe must not unexpectedly reveal an alert');
});

test('stale colour acknowledgements, unrelated events and missing state cannot skip a colour',()=>{
  assert.equal(advanceColourLesson(0,'alert'),0);
  assert.equal(advanceColourLesson(0,undefined),0);
  const yellow=advanceColourLesson(0,'good');
  assert.equal(advanceColourLesson(yellow,'good'),yellow);
  const red=advanceColourLesson(yellow,'watch');
  assert.equal(advanceColourLesson(red,'watch'),red);
  for(const event of [{type:'health-open'},{type:'sheet-close'},{type:'continue'},{type:'page',index:0}]){
    assert.equal(nextTourStep('score',event,{opened:true}),'score');
    assert.equal(nextTourStep('score',event,{opened:true,coloursComplete:false}),'score');
  }
});

test('replay starts at green, completion is stable and the walkthrough stays at six scenes',()=>{
  assert.equal(colourLesson(0).tone,'good');
  assert.equal(colourLesson(0).complete,false);
  assert.equal(advanceColourLesson(3,'alert'),3);
  assert.equal(advanceColourLesson(3,'good'),3);
  assert.equal(colourLesson(NaN).tone,'good');
  assert.equal(onboardingSteps().length,6);
  assert.equal(nextTourStep('score',{type:'sheet-close'},{opened:false,coloursComplete:true}),'score');
});

test('both languages identify the actual orb, give one meaning and name the next action',()=>{
  for(const language of ['en','zh']){
    for(let index=0;index<4;index++){
      const lesson=colourLesson(index,language);
      assert.ok(language==='zh'?lesson.label.includes('水球'):/water orb/i.test(lesson.label));
      assert.ok(lesson.description.length<80);
      assert.equal(lesson.continueLabel,undefined);
      if(index<3)assert.equal(lesson.hint,language==='zh'?'点击继续':'Tap to continue');
      else assert.equal(lesson.hint,undefined);
    }
  }
});

test('orb taps advance one lesson; repeats, drags and rapid follow-ups cannot skip into details',()=>{
  for(let progress=0;progress<=3;progress++){
    assert.equal(colourTapAction(progress,{detail:2}),'ignore');
    assert.equal(colourTapAction(progress,{repeat:true}),'ignore');
    assert.equal(colourTapAction(progress,{detail:1,moved:true}),'ignore');
    assert.equal(colourTapAction(progress,{detail:1},200),'ignore');
    assert.equal(colourTapAction(progress,{detail:1},500),progress===3?'open':'advance');
    assert.equal(colourTapAction(progress,{detail:0},500),progress===3?'open':'advance');
  }
  assert.equal(colourLesson(3).tone,'watch','details open from the richer yellow example');
});
