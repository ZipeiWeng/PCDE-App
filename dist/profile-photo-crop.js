import { loadProfilePhoto, photoEditAborted } from './profile-photo.js';
import { normalizePhotoCrop, normalizePhotoSource } from './avatar.js';

const clamp = (value,minimum,maximum) => Math.min(maximum,Math.max(minimum,value));
const finite = (value,fallback=0) => Number.isFinite(value) ? value : fallback;

export function clampPhotoCrop(crop) {
  const zoom=clamp(finite(crop.zoom,1),1,4), scale=Math.max(crop.size/crop.width,crop.size/crop.height)*zoom;
  const limitX=Math.max(0,(crop.width*scale-crop.size)/2),limitY=Math.max(0,(crop.height*scale-crop.size)/2);
  return {...crop,zoom,x:clamp(finite(crop.x),-limitX,limitX),y:clamp(finite(crop.y),-limitY,limitY)};
}
export function createPhotoCrop(width,height,size) {
  if (![width,height,size].every(value=>Number.isFinite(value)&&value>0)) throw new Error('profilePhotoDecode');
  return clampPhotoCrop({width,height,size,zoom:1,x:0,y:0});
}
export function movePhotoCrop(crop,x,y) { return clampPhotoCrop({...crop,x,y}); }
export function zoomPhotoCrop(crop,zoom,anchor={x:0,y:0}) {
  const next=clamp(finite(zoom,1),1,4),ratio=next/crop.zoom;
  return clampPhotoCrop({...crop,zoom:next,x:anchor.x-(anchor.x-crop.x)*ratio,y:anchor.y-(anchor.y-crop.y)*ratio});
}
export function sourceCropRect(crop) {
  const safe=clampPhotoCrop(crop),scale=Math.max(safe.size/safe.width,safe.size/safe.height)*safe.zoom;
  const size=Math.min(safe.width,safe.height,safe.size/scale);
  return {x:clamp((safe.width-size)/2-safe.x/scale,0,safe.width-size),y:clamp((safe.height-size)/2-safe.y/scale,0,safe.height-size),size};
}

export function serializePhotoCrop(crop) {
  const square=sourceCropRect(crop);
  return {zoom:crop.zoom,centerX:(square.x+square.size/2)/crop.width,centerY:(square.y+square.size/2)/crop.height};
}

export function restorePhotoCrop(width,height,size,saved) {
  const initial=createPhotoCrop(width,height,size),frame=normalizePhotoCrop(saved);
  if(!frame)return initial;
  const scale=Math.max(size/width,size/height)*frame.zoom;
  return clampPhotoCrop({...initial,zoom:frame.zoom,x:(.5-frame.centerX)*width*scale,y:(.5-frame.centerY)*height*scale});
}

export function encodePhotoEdit(image,crop,{createCanvas=()=>document.createElement('canvas'),existingSource=''}={}) {
  const width=image.naturalWidth||image.width,height=image.naturalHeight||image.height;
  const square=sourceCropRect(crop),canvas=createCanvas();canvas.width=512;canvas.height=512;
  const context=canvas.getContext('2d');if(!context)throw new Error('profilePhotoDecode');
  context.fillStyle='#e8e9e9';context.fillRect(0,0,512,512);
  context.drawImage(image,square.x,square.y,square.size,square.size,0,0,512,512);
  const photo=canvas.toDataURL('image/jpeg',.88);
  if(!normalizePhotoSource(photo))throw new Error('profilePhotoDecode');
  let photoSource=normalizePhotoSource(existingSource);
  if(!photoSource||width>1440||height>1440){
    const ratio=Math.min(1,1440/Math.max(width,height)),sourceCanvas=createCanvas();
    sourceCanvas.width=Math.max(1,Math.round(width*ratio));sourceCanvas.height=Math.max(1,Math.round(height*ratio));
    const sourceContext=sourceCanvas.getContext('2d');if(!sourceContext)throw new Error('profilePhotoDecode');
    sourceContext.fillStyle='#e8e9e9';sourceContext.fillRect(0,0,sourceCanvas.width,sourceCanvas.height);
    sourceContext.drawImage(image,0,0,sourceCanvas.width,sourceCanvas.height);
    for(const quality of [.86,.78,.68]){photoSource=normalizePhotoSource(sourceCanvas.toDataURL('image/jpeg',quality));if(photoSource)break;}
    if(!photoSource)throw new Error('profilePhotoDecode');
  }
  return {photo,photoSource,photoCrop:serializePhotoCrop(crop)};
}

export async function openProfilePhotoCrop(file, {
  signal,isCurrent=()=>true,document:doc=globalThis.document,language='en',returnEdit=false,
} = {}) {
  const editing=file&&typeof file.src==='string'?file:null;
  const source=await loadProfilePhoto(editing?editing.src:file,{signal});
  if (signal?.aborted || !isCurrent()) { source.release(); throw photoEditAborted(); }
  const zh=language==='zh';
  const copy=zh ? {title:'调整头像',hint:'拖动或双指缩放，调整照片位置。',zoom:'缩放',cancel:'取消',save:'保存头像',preview:'照片取景预览。方向键移动，加减号缩放，Home 重置。',error:'暂时无法裁剪这张照片，请重试。'}
    : {title:'Adjust photo',hint:'Drag or pinch to frame.',zoom:'Zoom',cancel:'Cancel',save:'Save photo',preview:'Photo framing preview. Arrow keys move, plus or minus zoom, Home resets.',error:'This photo could not be cropped. Please try again.'};
  return new Promise((resolve,reject)=>{
    const dialog=doc.createElement('dialog'),previousFocus=doc.activeElement,win=doc.defaultView;
    let settled=false,observer,identityTimer,crop,gesture=null;
    const pointers=new Map();
    dialog.className='profile-crop-dialog';
    dialog.setAttribute('aria-labelledby','profile-crop-title');
    dialog.setAttribute('data-no-settings-swipe','');
    dialog.innerHTML=`<h2 id="profile-crop-title">${copy.title}</h2><p class="profile-crop-hint">${copy.hint}</p><div class="profile-crop-viewport" tabindex="0" role="group" aria-label="${copy.preview}"><span class="profile-crop-circle" aria-hidden="true"></span></div><label class="profile-crop-zoom"><span>${copy.zoom}<output data-crop-zoom-value>1.0×</output></span><input type="range" min="1" max="4" step="0.01" value="1" aria-label="${copy.zoom}" data-crop-zoom></label><p class="profile-crop-error" role="alert"></p><div class="profile-crop-actions"><button type="button" class="button glass" data-crop-cancel>${copy.cancel}</button><button type="button" class="button primary" data-crop-save>${copy.save}</button></div>`;
    function finish(value,error) {
      if(settled)return;settled=true;
      observer?.disconnect();clearInterval(identityTimer);pointers.clear();
      signal?.removeEventListener('abort',abort);
      if(dialog.open)dialog.close();dialog.remove();source.release();
      if(previousFocus?.isConnected)previousFocus.focus?.({preventScroll:true});
      error ? reject(error) : resolve(value);
    }
    const abort=()=>finish(null,photoEditAborted());
    try {
      doc.body.appendChild(dialog);
      const viewport=dialog.querySelector('.profile-crop-viewport'),range=dialog.querySelector('[data-crop-zoom]'),output=dialog.querySelector('[data-crop-zoom-value]');
      const image=source.image;
      image.className='profile-crop-image';image.alt='';image.draggable=false;
      viewport.prepend(image);
      dialog.showModal();
      crop=restorePhotoCrop(image.naturalWidth||image.width,image.naturalHeight||image.height,viewport.clientWidth||280,editing?.photoCrop);
      function draw() {
        const scale=Math.max(crop.size/crop.width,crop.size/crop.height)*crop.zoom;
        image.style.width=`${crop.width*scale}px`;image.style.height=`${crop.height*scale}px`;
        image.style.transform=`translate(calc(-50% + ${crop.x}px),calc(-50% + ${crop.y}px))`;
        range.value=String(crop.zoom);output.value=`${crop.zoom.toFixed(1)}×`;range.setAttribute('aria-valuetext',`${crop.zoom.toFixed(1)}×`);
      }
      function allowed() { if(!isCurrent()){abort();return false;}return !settled; }
      function point(event){const box=viewport.getBoundingClientRect();return {x:event.clientX-box.left,y:event.clientY-box.top};}
      function resetGesture() {
        const points=[...pointers.values()];
        if(points.length===1)gesture={kind:'pan',point:points[0],crop:{...crop}};
        else if(points.length===2)gesture={kind:'pinch',distance:Math.max(1,Math.hypot(points[1].x-points[0].x,points[1].y-points[0].y)),center:{x:(points[0].x+points[1].x)/2,y:(points[0].y+points[1].y)/2},crop:{...crop}};
        else gesture=null;
      }
      viewport.addEventListener('pointerdown',event=>{
        if(!allowed() || (event.pointerType==='mouse'&&event.button!==0) || pointers.size>=2)return;
        event.preventDefault();viewport.focus({preventScroll:true});pointers.set(event.pointerId,point(event));viewport.setPointerCapture?.(event.pointerId);resetGesture();
      });
      viewport.addEventListener('pointermove',event=>{
        if(!pointers.has(event.pointerId)||!gesture||!allowed())return;
        event.preventDefault();pointers.set(event.pointerId,point(event));
        const points=[...pointers.values()];
        if(gesture.kind==='pan'&&points.length===1)crop=movePhotoCrop(gesture.crop,gesture.crop.x+points[0].x-gesture.point.x,gesture.crop.y+points[0].y-gesture.point.y);
        if(gesture.kind==='pinch'&&points.length===2){
          const center={x:(points[0].x+points[1].x)/2,y:(points[0].y+points[1].y)/2};
          const distance=Math.hypot(points[1].x-points[0].x,points[1].y-points[0].y);
          const zoomed=zoomPhotoCrop(gesture.crop,gesture.crop.zoom*distance/gesture.distance,{x:gesture.center.x-crop.size/2,y:gesture.center.y-crop.size/2});
          crop=movePhotoCrop(zoomed,zoomed.x+center.x-gesture.center.x,zoomed.y+center.y-gesture.center.y);
        }
        draw();
      });
      const release=event=>{pointers.delete(event.pointerId);resetGesture();};
      viewport.addEventListener('pointerup',release);viewport.addEventListener('pointercancel',release);viewport.addEventListener('lostpointercapture',release);
      viewport.addEventListener('keydown',event=>{
        if(!allowed())return;const step=event.shiftKey?24:8;
        if(event.key==='ArrowLeft')crop=movePhotoCrop(crop,crop.x-step,crop.y);
        else if(event.key==='ArrowRight')crop=movePhotoCrop(crop,crop.x+step,crop.y);
        else if(event.key==='ArrowUp')crop=movePhotoCrop(crop,crop.x,crop.y-step);
        else if(event.key==='ArrowDown')crop=movePhotoCrop(crop,crop.x,crop.y+step);
        else if(event.key==='+'||event.key==='=')crop=zoomPhotoCrop(crop,crop.zoom+.1);
        else if(event.key==='-'||event.key==='_')crop=zoomPhotoCrop(crop,crop.zoom-.1);
        else if(event.key==='Home')crop=createPhotoCrop(crop.width,crop.height,crop.size);
        else return;
        event.preventDefault();draw();
      });
      range.addEventListener('input',()=>{if(allowed()){crop=zoomPhotoCrop(crop,Number(range.value));draw();}});
      dialog.querySelector('[data-crop-cancel]').addEventListener('click',abort);
      dialog.addEventListener('cancel',event=>{event.preventDefault();abort();});
      dialog.addEventListener('close',()=>{if(!settled)abort();});
      dialog.querySelector('[data-crop-save]').addEventListener('click',()=>{
        if(!allowed())return;
        try{
          const result=encodePhotoEdit(image,crop,{createCanvas:()=>doc.createElement('canvas'),existingSource:editing?.reuseSource?editing.src:''});
          finish(returnEdit?result:result.photo);
        }catch{dialog.querySelector('.profile-crop-error').textContent=copy.error;}
      });
      if(win?.ResizeObserver){observer=new win.ResizeObserver(()=>{
        if(!viewport.clientWidth||viewport.clientWidth===crop.size)return;
        const ratio=viewport.clientWidth/crop.size;crop=clampPhotoCrop({...crop,size:viewport.clientWidth,x:crop.x*ratio,y:crop.y*ratio});draw();
      });observer.observe(viewport);}
      signal?.addEventListener('abort',abort,{once:true});
      identityTimer=setInterval(()=>{if(!isCurrent())abort();},250);
      draw();viewport.focus({preventScroll:true});
      if(signal?.aborted)abort();
    }catch(error){finish(null,error?.name==='AbortError'?error:new Error('profilePhotoDecode'));}
  });
}
