import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareProfilePhoto, createProfilePhotoEditor, loadProfilePhoto, photoEditAborted } from '../dist/profile-photo.js';
import { selectAccount, readStore, saveStore } from '../dist/model.js';

const PHOTO = 'data:image/jpeg;base64,YWJj';
const deferred = () => { let resolve,reject; const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject}; };

function decoder({fail=false}={}) {
  const revoked=[],drawn=[];
  const canvas={width:0,height:0,getContext:()=>({fillRect(){},drawImage(...args){drawn.push(args);}}),toDataURL:()=>PHOTO};
  return {
    revoked,drawn,canvas,
    dependencies:{
      createImage:()=>({naturalWidth:2400,naturalHeight:1200,set src(_value){queueMicrotask(()=>fail?this.onerror():this.onload());}}),
      createCanvas:()=>canvas,
      objectURLs:{createObjectURL:()=> 'blob:photo',revokeObjectURL:value=>revoked.push(value)},
    },
  };
}

test('phone and MIME-less photos are decoded, re-encoded to a bounded JPEG, and temporary URLs are released',async()=>{
  for(const file of [{type:'',name:'photo.JPG',size:5000},{type:'image/jpg',name:'photo.jpg',size:5000},{type:'image/heic',name:'photo.HEIC',size:5000}]){
    const fixture=decoder();
    assert.equal(await prepareProfilePhoto(file,fixture.dependencies),PHOTO);
    assert.equal(fixture.canvas.width,512);
    assert.equal(fixture.canvas.height,256);
    assert.equal(fixture.drawn.length,1);
    assert.deepEqual(fixture.revoked,['blob:photo']);
  }
});

test('unreadable, oversized and non-photo files fail without persisting a placeholder',async()=>{
  const fixture=decoder({fail:true});
  await assert.rejects(prepareProfilePhoto({type:'image/heic',name:'photo.heic',size:5000},fixture.dependencies),/profilePhotoDecode/);
  assert.deepEqual(fixture.revoked,['blob:photo']);
  await assert.rejects(prepareProfilePhoto({type:'image/png',size:9*1024*1024},decoder().dependencies),/profilePhotoSize/);
  await assert.rejects(prepareProfilePhoto({type:'image/svg\+xml',name:'image.svg',size:5000},decoder().dependencies),/profilePhotoFormat/);
  await assert.rejects(prepareProfilePhoto({type:'',name:'document.pdf',size:5000},decoder().dependencies),/profilePhotoFormat/);
});

test('newest photo selection wins even when an older image decodes last',async()=>{
  const first=deferred(),second=deferred(),saves=[],visible=[];
  const editor=createProfilePhotoEditor({prepare:file=>file==='first'?first.promise:second.promise,save:photo=>saves.push(photo),onSaved:photo=>visible.push(photo)});
  const old=editor.select('first'),latest=editor.select('second');
  second.resolve('new-photo');
  assert.equal(await latest,true);
  first.resolve('old-photo');
  assert.equal(await old,false);
  assert.deepEqual(saves,['new-photo']);
  assert.deepEqual(visible,['new-photo']);
  assert.equal(editor.busy,false);
});

test('removing an avatar cancels an in-flight replacement and does not restore it later',async()=>{
  const photo=deferred(),saves=[];
  const editor=createProfilePhotoEditor({prepare:()=>photo.promise,save:value=>saves.push(value)});
  const pending=editor.select('photo');
  assert.equal(await editor.remove(),true);
  photo.resolve('late-photo');
  assert.equal(await pending,false);
  assert.deepEqual(saves,['']);
});

test('decode/save errors preserve the old avatar, and account changes prevent late writes',async()=>{
  const errors=[],visible=[];
  let stored='old-photo';
  const decodeFailure=createProfilePhotoEditor({prepare:async()=>{throw new Error('profilePhotoDecode');},save:value=>{stored=value;},onError:error=>errors.push(error.message),onSaved:value=>visible.push(value)});
  assert.equal(await decodeFailure.select('bad'),false);
  assert.equal(stored,'old-photo');
  const saveFailure=createProfilePhotoEditor({prepare:async()=>PHOTO,save:()=>false,onError:error=>errors.push(error.message),onSaved:value=>visible.push(value)});
  assert.equal(await saveFailure.select('good'),false);
  assert.deepEqual(errors,['profilePhotoDecode','saveFailed']);
  assert.deepEqual(visible,[]);
  let identity='owner-a';const photo=deferred(),saves=[];
  const editor=createProfilePhotoEditor({getIdentity:()=>identity,prepare:()=>photo.promise,save:value=>saves.push(value)});
  const pending=editor.select('photo');identity='owner-b';photo.resolve(PHOTO);
  assert.equal(await pending,false);
  assert.deepEqual(saves,[]);
  assert.equal(editor.busy,false);
});

test('avatar autosave persists separately from unfinished form values and survives an account reload',async()=>{
  const data=new Map();
  globalThis.localStorage={getItem:key=>data.get(key)??null,setItem:(key,value)=>data.set(key,value)};
  const account={id:'photo-owner-a',petName:'Pip',username:'Jamie'};
  selectAccount(account);
  let store=readStore();
  const unsavedForm={name:'Unfinished edit',weight:'not a number'};
  const editor=createProfilePhotoEditor({getIdentity:()=>account.id,prepare:async()=>PHOTO,save:photo=>{
    const success=saveStore({...store,profile:{...store.profile,photo}});store=readStore();return success;
  }});
  assert.equal(await editor.select('photo'),true);
  assert.equal(store.profile.name,'Pip');
  assert.equal(store.profile.photo,PHOTO);
  assert.equal(unsavedForm.name,'Unfinished edit');
  selectAccount({...account,id:'photo-owner-b'});
  assert.equal(readStore().profile.photo,'');
  selectAccount(account);
  assert.equal(readStore().profile.photo,PHOTO);
});

test('cancelled crop preserves the prior avatar, clears busy feedback, and is not an error',async()=>{
  const saves=[],errors=[],busy=[],cancelled=[];
  const editor=createProfilePhotoEditor({prepare:async()=>{throw photoEditAborted();},save:value=>saves.push(value),onBusy:value=>busy.push(value),onCancel:()=>cancelled.push(true),onError:error=>errors.push(error)});
  assert.equal(await editor.select('photo'),false);
  assert.deepEqual(saves,[]);assert.deepEqual(errors,[]);assert.deepEqual(busy,[true,false]);assert.equal(cancelled.length,1);
  assert.equal(editor.busy,false);
});

test('closing the editor and selecting a newer photo abort pending decoding or framing work',async()=>{
  const signals=[],saves=[],errors=[];
  const editor=createProfilePhotoEditor({prepare:(_file,{signal})=>new Promise((_resolve,reject)=>{
    signals.push(signal);signal.addEventListener('abort',()=>reject(photoEditAborted()),{once:true});
  }),save:value=>saves.push(value),onError:error=>errors.push(error)});
  const first=editor.select('first'),second=editor.select('second');
  assert.equal(signals[0].aborted,true);assert.equal(signals[1].aborted,false);
  editor.cancel();assert.equal(signals[1].aborted,true);
  assert.deepEqual(await Promise.all([first,second]),[false,false]);
  assert.deepEqual(saves,[]);assert.deepEqual(errors,[]);assert.equal(editor.busy,false);
});

test('account transition aborts an unfinished crop even if the settings UI has not rerendered',async context=>{
  context.mock.timers.enable({apis:['setInterval']});
  let identity='a',signal;const saves=[];
  const editor=createProfilePhotoEditor({getIdentity:()=>identity,prepare:(_file,options)=>new Promise((_resolve,reject)=>{
    signal=options.signal;signal.addEventListener('abort',()=>reject(photoEditAborted()),{once:true});
  }),save:value=>saves.push(value)});
  const pending=editor.select('photo');identity='b';context.mock.timers.tick(250);
  assert.equal(signal.aborted,true);assert.equal(await pending,false);
  assert.deepEqual(saves,[]);assert.equal(editor.busy,false);
});

test('aborting image decoding revokes its temporary URL and removes event handlers',async()=>{
  const controller=new AbortController(),revoked=[];
  const image={set src(value){this.source=value;}};
  const pending=loadProfilePhoto({type:'image/jpeg',size:100,name:'photo.jpg'},{signal:controller.signal,createImage:()=>image,objectURLs:{createObjectURL:()=> 'blob:cancelled',revokeObjectURL:value=>revoked.push(value)}});
  controller.abort();await assert.rejects(pending,{name:'AbortError'});
  assert.deepEqual(revoked,['blob:cancelled']);assert.equal(image.onload,null);assert.equal(image.onerror,null);
});
