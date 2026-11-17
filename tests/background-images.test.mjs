import test from 'node:test';
import assert from 'node:assert/strict';
import { profileBackgroundSrc, resolveBackgroundImage, updateProfilePhoto, removeCustomBackground } from '../dist/background-images.js';
import { DEFAULT_AVATAR, DEMO_AVATAR, profileAvatarSrc } from '../dist/avatar.js';
import { createProfilePhotoEditor, photoEditAborted } from '../dist/profile-photo.js';
import { selectAccount, readStore, saveStore } from '../dist/model.js';

const PHOTO='data:image/jpeg;base64,YWJj',CUSTOM='data:image/webp;base64,ZGVm',REPLACEMENT='data:image/png;base64,Z2hp';
const state=(mode='profile')=>({profile:{name:'Pip',photo:PHOTO,photoRemoved:false},preferences:{backgroundMode:mode,backgroundPhoto:CUSTOM,backgroundProfilePhoto:'',backgroundFrost:75,pawPattern:true}});

test('avatar removal retains the exact current profile background without modifying its appearance settings',()=>{
  const before=state(),after=updateProfilePhoto(before,'');
  assert.deepEqual(resolveBackgroundImage(after),resolveBackgroundImage(before));
  assert.equal(profileAvatarSrc(after.profile),DEFAULT_AVATAR);
  assert.equal(after.preferences.backgroundProfilePhoto,PHOTO);
  assert.equal(after.preferences.backgroundFrost,75);assert.equal(after.preferences.pawPattern,true);
  assert.equal(before.profile.photo,PHOTO);assert.equal(before.profile.photoRemoved,false);
});

test('avatar removal leaves a selected custom background byte-identical, even after repeated removal',()=>{
  const before=state('custom'),after=updateProfilePhoto(before,'');
  assert.equal(after.preferences.backgroundPhoto,CUSTOM);
  assert.equal(after.preferences.backgroundMode,'custom');
  assert.deepEqual(resolveBackgroundImage(after),{mode:'custom',src:CUSTOM});
  assert.deepEqual(resolveBackgroundImage(updateProfilePhoto(after,'')),{mode:'custom',src:CUSTOM});
  assert.equal(profileBackgroundSrc(after),PHOTO,'profile choice retains its own image rather than the custom background');
});

test('custom background removal clears only that image and switches an active custom background to Silver',()=>{
  for(const mode of ['custom','profile','neutral']){
    const before=state(mode),after=removeCustomBackground(before);
    assert.equal(after.profile,before.profile);assert.equal(profileAvatarSrc(after.profile),PHOTO);
    assert.equal(after.preferences.backgroundPhoto,'');
    assert.equal(after.preferences.backgroundMode,mode==='custom'?'neutral':mode);
    assert.equal(before.preferences.backgroundPhoto,CUSTOM);
    if(mode==='custom')assert.deepEqual(resolveBackgroundImage(after),{mode:'neutral',src:''});
  }
});

test('removing an untouched demo avatar preserves the existing Mochi background rather than displaying the gray icon',()=>{
  const before={profile:{photo:'',photoRemoved:false},preferences:{backgroundMode:'profile'}};
  const after=updateProfilePhoto(before,'',{demo:true});
  assert.equal(profileAvatarSrc(after.profile,{demo:true}),DEFAULT_AVATAR);
  assert.equal(after.preferences.backgroundProfilePhoto,DEMO_AVATAR);
  assert.deepEqual(resolveBackgroundImage(after,{demo:true}),{mode:'profile',src:DEMO_AVATAR});
  assert.deepEqual(resolveBackgroundImage({profile:{photoRemoved:true},preferences:{backgroundProfilePhoto:'javascript:alert(1)'}},{demo:true}),{mode:'neutral',src:''});
});

test('retained photo survives persistence; crop cancellation leaves it unchanged and replacement can follow again',async()=>{
  const storage=new Map();globalThis.localStorage={getItem:key=>storage.get(key)??null,setItem:(key,value)=>storage.set(key,value)};
  const account={id:'background-photo-owner',petName:'Pip'};selectAccount(account);
  let store={...readStore(),...state()};
  assert.equal(saveStore(updateProfilePhoto(store,'')),true);
  selectAccount(account);store=readStore();
  assert.equal(profileAvatarSrc(store.profile),DEFAULT_AVATAR);
  assert.deepEqual(resolveBackgroundImage(store),{mode:'profile',src:PHOTO});
  const save=photo=>{const result=saveStore(updateProfilePhoto(store,photo));store=readStore();return result;};
  const cancelled=createProfilePhotoEditor({prepare:async()=>{throw photoEditAborted();},save});
  assert.equal(await cancelled.select('cancelled crop'),false);
  assert.equal(store.profile.photoRemoved,true);assert.equal(resolveBackgroundImage(store).src,PHOTO);
  const replacement=createProfilePhotoEditor({prepare:async()=>REPLACEMENT,save});
  assert.equal(await replacement.select('confirmed crop'),true);
  assert.equal(profileAvatarSrc(store.profile),REPLACEMENT);assert.equal(resolveBackgroundImage(store).src,REPLACEMENT);
  assert.equal(await replacement.remove(),true);
  assert.equal(store.preferences.backgroundProfilePhoto,REPLACEMENT);
  assert.equal(resolveBackgroundImage(readStore()).src,REPLACEMENT);
});
