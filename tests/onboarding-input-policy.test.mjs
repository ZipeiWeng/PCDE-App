import test from 'node:test';
import assert from 'node:assert/strict';
import {isOnboardingTextEntry,onboardingInputPolicy} from '../dist/onboarding-input-policy.js';

test('address, message and composition controls protect the tour before keyboard resize',()=>{
  for(const input of [{tagName:'INPUT',type:'search'},{tagName:'input',type:'text'},{tagName:'TEXTAREA'},{tagName:'SELECT'},{tagName:'DIV',isContentEditable:true}]) {
    const editableFocused=isOnboardingTextEntry(input);
    assert.equal(editableFocused,true);
    const policy=onboardingInputPolicy({editableFocused,layoutHeight:844,viewportHeight:844,dismissible:true});
    assert.equal(policy.showEndTour,false);
    assert.equal(policy.escapeAction,'blur');
    assert.equal(policy.preventDialogCancel,true);
  }
  const composing=onboardingInputPolicy({editableFocused:true,composing:true});
  assert.equal(composing.escapeAction,'ignore');
  assert.equal(composing.showEndTour,false);
});

test('ordinary controls and disabled fields do not count as text entry',()=>{
  for(const input of [{tagName:'BUTTON'},{tagName:'INPUT',type:'checkbox'},{tagName:'INPUT',type:'range'},{tagName:'INPUT',type:'file'},{tagName:'INPUT',disabled:true},{tagName:'TEXTAREA',readOnly:true}]) {
    assert.equal(isOnboardingTextEntry(input),false);
  }
});

test('soft keyboard resize cannot move End tour into an active typing session',()=>{
  const base={layoutHeight:844,dismissible:true};
  // Focus, opening animation, typing, blur, closing animation, settled viewport.
  const frames=[
    {editableFocused:true,viewportHeight:844},
    {editableFocused:true,viewportHeight:710},
    {editableFocused:true,viewportHeight:430},
    {editableFocused:false,viewportHeight:430},
    {editableFocused:false,viewportHeight:600},
    {editableFocused:false,viewportHeight:844},
  ].map(frame=>onboardingInputPolicy({...base,...frame}));
  assert.deepEqual(frames.map(frame=>frame.showEndTour),[false,false,false,false,false,true]);
  assert.equal(frames[3].preventDialogCancel,true);
  assert.equal(frames[5].preventDialogCancel,false);
});

test('browser chrome and invalid viewport values are not mistaken for a keyboard',()=>{
  for(const viewportHeight of [844,780,740,undefined,NaN,0,-10]) {
    const policy=onboardingInputPolicy({layoutHeight:844,viewportHeight,dismissible:true});
    assert.equal(policy.keyboardOpen,false,String(viewportHeight));
    assert.equal(policy.showEndTour,true);
    assert.equal(policy.escapeAction,'ignore');
  }
  assert.equal(onboardingInputPolicy({layoutHeight:390,viewportHeight:190}).keyboardOpen,true);
});

test('native cancel is blocked on a required scene but allowed on an explicit return scene',()=>{
  assert.equal(onboardingInputPolicy().preventDialogCancel,true);
  assert.equal(onboardingInputPolicy({dismissible:true}).preventDialogCancel,false);
  assert.equal(onboardingInputPolicy({dismissible:true,editableFocused:true}).preventDialogCancel,true);
});
