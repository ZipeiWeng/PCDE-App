import test from 'node:test';
import assert from 'node:assert/strict';
import { onboardingSteps, nextTourStep, isTourEntry } from '../dist/onboarding-flow.js';
import { coachVisual } from '../dist/onboarding-motion.js';
import { coachCopy } from '../dist/onboarding-copy.js';
import { placeCoachNote } from '../dist/onboarding-position.js';

const steps=onboardingSteps();
const byId=Object.fromEntries(steps.map(item=>[item.id,item]));
const outcome=item=>Object.fromEntries([['type',item.event],...['index','section','view','module','open'].filter(key=>item[key]!==undefined).map(key=>[key,item[key]])]);
const opened={opened:true,coloursComplete:true};

test('there are seven core scenes without mandatory clinic, setup, close or input exercises',()=>{
  assert.equal(steps.length,7);
  assert.deepEqual(steps.map(item=>item.id),['welcome','device','score','red-alert','card','profile','explore']);
  assert.ok(!steps.some(item=>['health','device-setup','card-summary','settings','input-cancel'].includes(item.id)));
  assert.ok(!steps.some(item=>['compose','input-cancel','module-toggle'].includes(item.event)));
  assert.equal(byId.score.visual,'colours');
  assert.equal(byId.explore.done,false);
  assert.equal(byId.explore.event,'page');
});

test('opening a destination stays in its current scene until an intentional exit',()=>{
  for(const id of ['device','card','profile']){
    const item=byId[id];
    assert.equal(isTourEntry(id,item.entry),true);
    assert.equal(nextTourStep(id,item.entry),id);
    assert.equal(nextTourStep(id,item.entry,opened),id);
    assert.equal(nextTourStep(id,{type:'continue'}),id);
    assert.equal(nextTourStep(id,{type:'continue'},{opened:false}),id);
    assert.equal(nextTourStep(id,{type:'continue'},opened),item.next);
  }
  assert.equal(isTourEntry('device',{type:'settings',section:'profile'}),false);
  assert.equal(isTourEntry('profile',{type:'settings',section:'device'}),false);
  assert.equal(isTourEntry('card',{type:'sheet-close'}),false);
});

test('the seven-scene route completes without searching or opening a clinic',()=>{
  let id='welcome';
  for(let index=0;index<steps.length-1;index++){
    assert.equal(id,steps[index].id);
    id=nextTourStep(id,outcome(steps[index]),opened);
    assert.equal(id,steps[index+1].id);
  }
  assert.equal(id,'explore');
  assert.equal(nextTourStep(id,{type:'continue'},opened),'explore');
});

test('clinic search and results are optional exploration within the alert scene',()=>{
  for(const scene of [{},opened]) {
    for(const event of [{type:'input'},{type:'focus'},{type:'blur'},{type:'skip'},
      ...['search','results','detail'].map(view=>({type:'vet',view}))]) {
      assert.equal(nextTourStep('red-alert',event,scene),'red-alert');
    }
  }
  assert.equal(nextTourStep('red-alert',{type:'continue'},opened),'card');
  assert.equal(byId['vet-results'],undefined,'no mandatory clinic chapter remains');
});

test('exploring clinics, nested settings and records does not silently advance the tour',()=>{
  for(const view of ['search','results','detail'])assert.equal(nextTourStep('red-alert',{type:'vet',view},opened),'red-alert');
  for(const section of ['device','connect','sampling'])assert.equal(nextTourStep('device',{type:'settings',section},opened),'device');
  for(const section of ['profile','preferences','language','subscription'])assert.equal(nextTourStep('profile',{type:'settings',section},opened),'profile');
  for(const event of [{type:'module-toggle',module:'vaccination',open:false},{type:'module-toggle',module:'parasite',open:true},{type:'sheet-close'}])assert.equal(nextTourStep('card',event,opened),'card');
});

test('real close events require an opened matching surface, preventing stale close transitions',()=>{
  const exits=[['device','settings-close','score'],['red-alert','sheet-close','card'],['card','card-close','profile'],['profile','settings-close','explore']];
  for(const [id,type,next] of exits){
    assert.equal(nextTourStep(id,{type}),id);
    assert.equal(nextTourStep(id,{type},{opened:false}),id);
    assert.equal(nextTourStep(id,{type},opened),next);
    assert.equal(nextTourStep(id,{type:'continue'},opened),next);
    assert.equal(byId[id].continueAction,'home-good');
    assert.equal(byId[id].continueLabel,id==='device'?'Try the health demo':id==='red-alert'?'Got it':'Back to home');
    for(const other of ['sheet-close','settings-close','card-close'].filter(event=>event!==type))assert.equal(nextTourStep(id,{type:other},opened),id);
  }
  assert.equal(nextTourStep('score',{type:'sheet-close'}),'score');
  assert.equal(nextTourStep('score',{type:'sheet-close'},opened),'score');
  assert.equal(nextTourStep('score',{type:'continue'},opened),'red-alert');
});

test('home entry targets remain explicit, natural and unambiguous',()=>{
  const entries=[['score','#wellness-orb'],['device','#device-button'],['card','#health-card-button'],['profile','#account-button']];
  for(const [id,target] of entries){assert.equal(byId[id].target,target);assert.equal(byId[id].home,true);assert.ok(byId[id].entry);}
  assert.match(byId.profile.label,/Tap your pet photo/);
  assert.ok(!steps.some(item=>/Tap ×|Your avatar opens settings/.test(item.label+' '+item.description)));
});

test('final exploration permits the actual looping pages without extra mandatory steps',()=>{
  assert.equal(byId.explore.navigation,true);
  assert.equal(byId.explore.target,'[data-page-step="-1"]');
  assert.equal(byId.explore.visual,'swipe');
  assert.equal(byId.explore.action,'activity-home');
  assert.match(byId.explore.description,/Activity/);
  assert.match(byId.explore.description,/AI companion/);
  for(const index of [0,1,2])assert.equal(nextTourStep('explore',{type:'page',index}),'explore');
});

test('both languages preserve outcomes and concise purposeful labels',()=>{
  const zh=onboardingSteps('zh');
  assert.deepEqual(steps.map(item=>item.target),zh.map(item=>item.target));
  assert.deepEqual(steps.map(outcome),zh.map(outcome));
  for(const item of steps){
    assert.ok(item.label.split(/\s+/).length<=7,item.id);
    assert.ok(item.description.length<100,item.id);
    assert.equal(item.showDescription,item.id!=='red-alert','the alert uses its own page copy rather than another explanation');
    assert.equal(coachCopy(item.id),item.label);
  }
  for(const item of zh){
    assert.ok(/[\u3400-\u9fff]/u.test(item.label),item.id);
    assert.equal(coachCopy(item.id,'zh'),item.label);
    for(const key of ['continueLabel','skipLabel','doneLabel'])if(item[key])assert.ok(/[\u3400-\u9fff]/u.test(item[key]),item.id+key);
  }
  assert.equal(coachCopy('missing'),'');
  assert.equal(nextTourStep('missing',{type:'continue'},opened),'missing');
  assert.equal(isTourEntry('missing',{type:'continue'}),false);
});

test('welcome preserves the current home before any tutorial readings are created',()=>{
  assert.equal(byId.welcome.action,'home-current');
  assert.equal(byId.welcome.label,'Welcome!');
  assert.equal(byId.welcome.visual,'welcome');
  assert.equal(nextTourStep('welcome',{type:'continue'}),'device');
  assert.equal(nextTourStep('welcome',{type:'continue'},{needsConnection:true}),'device');
});

test('all accounts connect first, can choose an example, and never repeat Device',()=>{
  const route=onboardingSteps('en',{needsConnection:true});
  assert.equal(route.length,7);
  assert.deepEqual(route.map(item=>item.id),['welcome','device','score','red-alert','card','profile','explore']);
  const device=route.find(item=>item.id==='device');
  assert.equal(device.action,'home-current');
  assert.equal(device.skipEvent,'example');
  assert.equal(nextTourStep('device',{type:'example'},{needsConnection:true}),'score');
  assert.equal(nextTourStep('device',{type:'example'}),'score');
  assert.equal(nextTourStep('device',{type:'continue'},{needsConnection:true,opened:false}),'device');
  assert.equal(nextTourStep('device',{type:'continue'},{needsConnection:true,opened:true}),'score');
  assert.equal(nextTourStep('red-alert',{type:'sheet-close'},{needsConnection:true,opened:true}),'card');
  assert.equal(nextTourStep('score',{type:'continue'},{needsConnection:true,opened:true,coloursComplete:true}),'red-alert');
  assert.equal(onboardingSteps('zh',{needsConnection:true}).find(item=>item.id==='device').skipLabel,'没有项圈？先体验示例');
});

test('regular and test accounts use exactly the same seven-scene route',()=>{
  for(const language of ['en','zh'])assert.deepEqual(onboardingSteps(language,{needsConnection:true}),onboardingSteps(language,{needsConnection:false}));
});

test('Current health opens the alert only through an explicit example action',()=>{
  assert.equal(byId.score.event,'continue');
  assert.equal(byId.score.entry.type,'health-open');
  assert.equal(nextTourStep('score',{type:'health-open'}),'score');
  assert.equal(nextTourStep('score',{type:'continue'},opened),'red-alert');
  assert.equal(nextTourStep('score',{type:'sheet-close'},opened),'score');
  assert.equal(byId['red-alert'].action,'red-alert');
  assert.equal(byId['red-alert'].home,false);
  assert.equal(byId['red-alert'].startsOpen,true);
  assert.equal(byId['red-alert'].target,'[data-find-vet]');
  assert.equal(byId['red-alert'].entry.type,'health-alert');
  assert.equal(byId['red-alert'].continueLabel,'Got it');
  assert.equal(byId['red-alert'].event,'continue');
  assert.equal(byId['red-alert'].continueAction,'home-good');
  assert.match(byId['red-alert'].label,/Yellow or red/);
  assert.equal(nextTourStep('red-alert',{type:'continue'}),'red-alert');
  assert.equal(nextTourStep('red-alert',{type:'health-alert'}),'red-alert');
  assert.equal(nextTourStep('red-alert',{type:'vet',view:'results'}),'red-alert');
});

test('acknowledging the alert returns home without requiring clinic interaction',()=>{
  const alert=byId['red-alert'];
  assert.equal(alert.event,'continue');
  assert.equal(alert.continueAction,'home-good');
  assert.equal(alert.startsOpen,true);
  assert.equal(alert.requiresOpen,true);
  assert.deepEqual(alert.acceptEvents,[{type:'sheet-close'}]);
  for(const type of ['continue','sheet-close']){
    for(const scene of [{},{opened:false}])assert.equal(nextTourStep('red-alert',{type},scene),'red-alert');
    assert.equal(nextTourStep('red-alert',{type},opened),'card');
    for(const view of ['search','results','detail']){
      assert.equal(nextTourStep('red-alert',{type},{...opened,view}),'card','optional exploration never adds an exit prerequisite');
    }
  }
  assert.equal(byId.card.home,true);
  assert.equal(byId.card.target,'#health-card-button');
  assert.equal(byId.card.action,undefined,'returning home does not open the next destination');
});

test('colour instruction names the actual orb without a second set of decorative circles',()=>{
  assert.match(byId.score.label,/water orb/);
  assert.match(byId.score.description,/green, yellow and red in order/);
  assert.equal(coachVisual('colours'),'');
  assert.equal(coachVisual('colours','zh'),'');
});

test('caption geometry fits narrow screens above or below controls',()=>{
  for(const width of [280,320,390,430]){
    const target={left:width-70,right:width-25,top:25,bottom:70};
    const position=placeCoachNote({width,height:600,target});
    assert.ok(position.left>=18);assert.ok(position.left+position.width<=width-18);
    assert.ok(position.top>=target.bottom+24);assert.ok(position.top+position.height<=546);
  }
  for(const height of [360,550,880]){
    const target={left:50,right:90,top:height-90,bottom:height-45};
    const position=placeCoachNote({width:320,height,target});
    assert.equal(position.side,'above');assert.ok(position.top+position.height<target.top);assert.ok(position.top>=18);
  }
});
