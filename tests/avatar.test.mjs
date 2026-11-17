import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_AVATAR, DEMO_AVATAR, profileAvatarSrc, profilePhotoPatch } from '../dist/avatar.js';
import { createProfilePhotoEditor, photoEditAborted } from '../dist/profile-photo.js';
import { selectAccount, readStore, saveStore } from '../dist/model.js';

const PHOTO='data:image/jpeg;base64,YWJj';

test('only an untouched demo avatar falls back to Mochi; real and removed profiles use the gray dog',()=>{
  assert.equal(profileAvatarSrc({}, {demo:true}),DEMO_AVATAR);
  assert.equal(profileAvatarSrc({}),DEFAULT_AVATAR);
  assert.equal(profileAvatarSrc({photo:PHOTO}),PHOTO);
  assert.equal(profileAvatarSrc({photo:'',photoRemoved:true},{demo:true}),DEFAULT_AVATAR);
  assert.equal(profileAvatarSrc({photo:PHOTO,photoRemoved:true},{demo:true}),DEFAULT_AVATAR);
});

test('avatar source rejects remote, script, oversized and SVG payloads',()=>{
  for(const photo of ['https://example.com/pet.jpg','javascript:alert(1)','data:image/svg+xml;base64,YWJj',`data:image/jpeg;base64,${'A'.repeat(1800000)}`]){
    assert.equal(profileAvatarSrc({photo}),DEFAULT_AVATAR);
    assert.throws(()=>profilePhotoPatch(photo),/profilePhotoDecode/);
  }
});

test('removing the demo photo persists the empty avatar across reload; cropped replacement restores the chosen photo',async()=>{
  const storage=new Map();
  globalThis.localStorage={getItem:key=>storage.get(key)??null,setItem:(key,value)=>storage.set(key,value)};
  selectAccount({demo:true});
  let store=readStore();
  const save=photo=>{const result=saveStore({...store,profile:{...store.profile,...profilePhotoPatch(photo)}});store=readStore();return result;};
  const editor=createProfilePhotoEditor({prepare:async()=>PHOTO,save});
  assert.equal(await editor.remove(),true);
  assert.equal(store.profile.photo,'');assert.equal(store.profile.photoRemoved,true);
  selectAccount({id:'avatar-other-owner',petName:'Other'});
  assert.equal(readStore().profile.photoRemoved,false);
  selectAccount({demo:true});store=readStore();
  assert.equal(profileAvatarSrc(store.profile,{demo:true}),DEFAULT_AVATAR);
  assert.equal(await editor.select('confirmed-crop'),true);
  assert.equal(store.profile.photoRemoved,false);
  assert.equal(profileAvatarSrc(readStore().profile,{demo:true}),PHOTO);
});

test('cancelling a new crop leaves an explicitly removed avatar empty',async()=>{
  let profile=profilePhotoPatch(''),saved=false;
  const editor=createProfilePhotoEditor({prepare:async()=>{throw photoEditAborted();},save:photo=>{saved=true;profile=profilePhotoPatch(photo);}});
  assert.equal(await editor.select('cancelled-crop'),false);
  assert.equal(saved,false);assert.equal(profileAvatarSrc(profile,{demo:true}),DEFAULT_AVATAR);
});
