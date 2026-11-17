import test from 'node:test';
import assert from 'node:assert/strict';
import { createPhotoCrop, movePhotoCrop, zoomPhotoCrop, serializePhotoCrop, restorePhotoCrop, sourceCropRect, encodePhotoEdit } from '../dist/profile-photo-crop.js';
import { DEMO_AVATAR, profilePhotoEditSource, profilePhotoPatch } from '../dist/avatar.js';
import { createProfilePhotoEditor, loadProfilePhoto, photoEditAborted } from '../dist/profile-photo.js';
import { updateProfilePhoto, resolveBackgroundImage } from '../dist/background-images.js';
import { selectAccount, readStore, saveStore } from '../dist/model.js';

const PHOTO='data:image/jpeg;base64,YWJj',SOURCE='data:image/jpeg;base64,ZGVm';
const FRAME={zoom:2.5,centerX:.4,centerY:.55};
const near=(actual,expected)=>assert.ok(Math.abs(actual-expected)<1e-8,`${actual} ≠ ${expected}`);

function canvasFixture() {
  const canvases=[];
  return {canvases,createCanvas(){
    const index=canvases.length,draws=[];
    const canvas={width:0,height:0,draws,getContext:()=>({fillRect(){},drawImage(...args){draws.push(args);}}),toDataURL:(type)=>{assert.equal(type,'image/jpeg');return index===0?PHOTO:SOURCE;}};
    canvases.push(canvas);return canvas;
  }};
}

test('confirmed crop saves a 512px avatar and a separate bounded full image, never the original upload bytes',()=>{
  const image={naturalWidth:2400,naturalHeight:1600,src:'blob:original-with-camera-metadata'};
  const crop=movePhotoCrop(zoomPhotoCrop(createPhotoCrop(2400,1600,300),2.5),40,-25);
  const fixture=canvasFixture(),result=encodePhotoEdit(image,crop,fixture);
  assert.equal(result.photo,PHOTO);assert.equal(result.photoSource,SOURCE);
  assert.deepEqual(fixture.canvases.map(canvas=>[canvas.width,canvas.height]),[[512,512],[1440,960]]);
  const rect=sourceCropRect(crop);
  assert.deepEqual(fixture.canvases[0].draws[0],[image,rect.x,rect.y,rect.size,rect.size,0,0,512,512]);
  assert.deepEqual(fixture.canvases[1].draws[0],[image,0,0,1440,960]);
  assert.deepEqual(result.photoCrop,serializePhotoCrop(crop));
  assert.equal(JSON.stringify(result).includes('camera-metadata'),false);
});

test('saved framing reopens at the same photo position across viewport sizes and source resizing',()=>{
  const crop=movePhotoCrop(zoomPhotoCrop(createPhotoCrop(2400,1600,300),2.5),40,-25),saved=serializePhotoCrop(crop);
  const reopened=restorePhotoCrop(1440,960,220,saved);
  near(reopened.zoom,crop.zoom);near(reopened.x/crop.x,220/300);near(reopened.y/crop.y,220/300);
  const first=sourceCropRect(crop),second=sourceCropRect(reopened);
  near(first.x/2400,second.x/1440);near(first.y/1600,second.y/960);near(first.size/2400,second.size/1440);
});

test('re-editing a saved source avoids repeated JPEG re-encoding while retaining the full source',()=>{
  const fixture=canvasFixture(),image={naturalWidth:1440,naturalHeight:960};
  const result=encodePhotoEdit(image,restorePhotoCrop(1440,960,300,FRAME),{...fixture,existingSource:SOURCE});
  assert.equal(fixture.canvases.length,1);assert.equal(result.photoSource,SOURCE);
  assert.equal(result.photoCrop.zoom,FRAME.zoom);near(result.photoCrop.centerX,FRAME.centerX);near(result.photoCrop.centerY,FRAME.centerY);
});

test('Edit uses a retained source when available, otherwise the existing crop or untouched Mochi; gray avatars cannot edit',()=>{
  assert.deepEqual(profilePhotoEditSource({photo:PHOTO,photoSource:SOURCE,photoCrop:FRAME}),{src:SOURCE,photoCrop:FRAME,reuseSource:true});
  assert.deepEqual(profilePhotoEditSource({photo:PHOTO,photoCrop:FRAME}),{src:PHOTO,photoCrop:null,reuseSource:false});
  assert.deepEqual(profilePhotoEditSource({photo:''},{demo:true}),{src:DEMO_AVATAR,photoCrop:null,reuseSource:false});
  assert.equal(profilePhotoEditSource({photo:PHOTO,photoSource:SOURCE,photoRemoved:true},{demo:true}),null);
  assert.equal(profilePhotoEditSource({photo:''}),null);
});

test('structured confirmation persists editable framing; cancel keeps all data and remove clears only avatar edit assets',async()=>{
  const storage=new Map();globalThis.localStorage={getItem:key=>storage.get(key)??null,setItem:(key,value)=>storage.set(key,value)};
  const account={id:'editable-photo-owner',petName:'Pip'};selectAccount(account);let store=readStore();
  // This case exercises preserving a deliberately selected profile background.
  store.preferences.backgroundMode='profile';
  const save=(photo,edit)=>{const success=saveStore(updateProfilePhoto(store,photo,{edit}));store=readStore();return success;};
  const editor=createProfilePhotoEditor({prepare:async()=>({photo:PHOTO,photoSource:SOURCE,photoCrop:FRAME}),save});
  assert.equal(await editor.select('new-upload'),true);
  selectAccount(account);store=readStore();
  assert.deepEqual(profilePhotoEditSource(store.profile),{src:SOURCE,photoCrop:FRAME,reuseSource:true});
  const saved=JSON.stringify(store);
  const cancelled=createProfilePhotoEditor({prepare:async()=>{throw photoEditAborted();},save});
  assert.equal(await cancelled.select(profilePhotoEditSource(store.profile)),false);
  assert.equal(JSON.stringify(store),saved);
  assert.equal(await editor.remove(),true);
  assert.equal(store.profile.photo,'');assert.equal(store.profile.photoSource,'');assert.equal(store.profile.photoCrop,null);
  assert.equal(resolveBackgroundImage(store).src,PHOTO,'background keeps the visible crop, not the full original');
  assert.equal(profilePhotoEditSource(store.profile),null);
});

test('legacy image replacements discard old edit metadata rather than reopening an unrelated source',()=>{
  const old={photo:PHOTO,photoSource:SOURCE,photoCrop:FRAME};
  const replaced={...old,...profilePhotoPatch(SOURCE)};
  assert.equal(replaced.photoSource,'');assert.equal(replaced.photoCrop,null);
  assert.equal(profilePhotoEditSource(replaced).src,SOURCE);
});

test('saved avatars load locally without new file upload URLs or arbitrary remote image access',async()=>{
  for(const src of [SOURCE,DEMO_AVATAR]){
    let objectCalls=0;
    const image={naturalWidth:100,naturalHeight:100,set src(value){this.loaded=value;queueMicrotask(()=>this.onload?.());}};
    const loaded=await loadProfilePhoto(src,{createImage:()=>image,objectURLs:{createObjectURL(){objectCalls++;},revokeObjectURL(){objectCalls++;}}});
    assert.equal(image.loaded,src);loaded.release();assert.equal(objectCalls,0);
  }
  await assert.rejects(loadProfilePhoto('https://example.com/dog.jpg'),/profilePhotoFormat/);
});
