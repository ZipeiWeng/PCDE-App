const TILE_SIZE=256;
const MAX_LAT=85.05112878;
const clamp=(value,min,max)=>Math.min(max,Math.max(min,value));

export function projectCoordinate(point,zoom) {
  const size=TILE_SIZE*2**zoom,lat=clamp(point.lat,-MAX_LAT,MAX_LAT)*Math.PI/180;
  return {x:(point.lon+180)/360*size,y:(1-Math.log(Math.tan(lat)+1/Math.cos(lat))/Math.PI)/2*size};
}
export function unprojectCoordinate(point,zoom) {
  const size=TILE_SIZE*2**zoom,n=Math.PI-2*Math.PI*point.y/size;
  return {lat:clamp(Math.atan(Math.sinh(n))*180/Math.PI,-MAX_LAT,MAX_LAT),lon:((point.x/size*360)%360+360)%360-180};
}
export function wrapMapDelta(delta,zoom) {
  const size=TILE_SIZE*2**zoom;
  return ((delta+size/2)%size+size)%size-size/2;
}
export function fitMapView(center,points,width,height) {
  const valid=points.filter(p=>Number.isFinite(p.lat)&&Number.isFinite(p.lon));
  for(let zoom=15;zoom>=3;zoom--){
    const anchor=projectCoordinate(center,zoom),coords=[center,...valid].map(p=>{const c=projectCoordinate(p,zoom);return{x:anchor.x+wrapMapDelta(c.x-anchor.x,zoom),y:c.y};});
    const minX=Math.min(...coords.map(p=>p.x)),maxX=Math.max(...coords.map(p=>p.x)),minY=Math.min(...coords.map(p=>p.y)),maxY=Math.max(...coords.map(p=>p.y));
    if(zoom===3||(maxX-minX<=Math.max(70,width-80)&&maxY-minY<=Math.max(70,height-100)))return{zoom,center:unprojectCoordinate({x:(minX+maxX)/2,y:(minY+maxY)/2},zoom)};
  }
}

// Only tiles in the visible viewport are requested. Browser HTTP caching is left
// intact; the origin referrer and permanent OSM attribution meet tile policy.
export function mountVetMap(root,{center,vets=[],onSelect=()=>{}}={}) {
  const doc=root.ownerDocument,win=doc.defaultView;
  root.classList.add('vet-map-surface');root.dataset.noSettingsSwipe='';
  root.setAttribute('role','region');root.setAttribute('aria-label','Map of nearby veterinary clinics');root.tabIndex=0;
  root.innerHTML='<div class="vet-map-tiles" aria-hidden="true"></div><div class="vet-map-markers"></div><div class="vet-map-controls"><button type="button" data-map-zoom="1" aria-label="Zoom in">+</button><button type="button" data-map-zoom="-1" aria-label="Zoom out">−</button><button type="button" data-map-fit aria-label="Show all clinics">⌖</button></div><span class="vet-map-error" hidden>Map background unavailable. Clinic positions are shown.</span><a class="vet-map-attribution" href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">© OpenStreetMap contributors</a>';
  const tiles=root.querySelector('.vet-map-tiles'),markers=root.querySelector('.vet-map-markers'),tileNodes=new Map(),markerNodes=[];
  let zoom=13,view={...center},width=0,height=0,destroyed=false,frame=0,selected=-1,first=true,failed=0,loaded=0;
  const search=doc.createElement('span');search.className='vet-map-search-point';search.setAttribute('title','Search location');markers.append(search);
  vets.forEach((vet,index)=>{const b=doc.createElement('button');b.type='button';b.className='vet-map-pin';b.textContent=String(index+1);b.setAttribute('aria-label',`${index+1}. ${vet.name}`);b.addEventListener('click',()=>{select(index);onSelect(index);});markers.append(b);markerNodes.push(b);});
  function updatePoint(node,point){const p=projectCoordinate(point,zoom),c=projectCoordinate(view,zoom);node.style.left=`${width/2+wrapMapDelta(p.x-c.x,zoom)}px`;node.style.top=`${height/2+p.y-c.y}px`;}
  function render(){
    frame=0;if(destroyed||!width||!height)return;
    const p=projectCoordinate(view,zoom),left=p.x-width/2,top=p.y-height/2,world=2**zoom,visible=new Set();
    for(let x=Math.floor(left/TILE_SIZE);x<=Math.floor((left+width)/TILE_SIZE);x++)for(let y=Math.floor(top/TILE_SIZE);y<=Math.floor((top+height)/TILE_SIZE);y++){
      if(y<0||y>=world)continue;
      const wrapped=((x%world)+world)%world,key=`${zoom}/${wrapped}/${y}`,positionKey=`${key}/${x}`;visible.add(positionKey);
      let img=tileNodes.get(positionKey);
      if(!img){img=doc.createElement('img');img.alt='';img.draggable=false;img.referrerPolicy='strict-origin-when-cross-origin';img.decoding='async';img.addEventListener('load',()=>{loaded++;root.querySelector('.vet-map-error').hidden=true;});img.addEventListener('error',()=>{failed++;if(!loaded&&failed>=2)root.querySelector('.vet-map-error').hidden=false;});img.src=`https://tile.openstreetmap.org/${key}.png`;tiles.append(img);tileNodes.set(positionKey,img);}
      img.style.transform=`translate(${Math.round(x*TILE_SIZE-left)}px,${Math.round(y*TILE_SIZE-top)}px)`;
    }
    for(const[key,img]of tileNodes)if(!visible.has(key)){img.remove();tileNodes.delete(key);}
    updatePoint(search,center);markerNodes.forEach((node,index)=>updatePoint(node,vets[index]));
    root.querySelector('[data-map-zoom="1"]').disabled=zoom>=18;root.querySelector('[data-map-zoom="-1"]').disabled=zoom<=3;
  }
  function schedule(){if(!frame&&!destroyed)frame=win.requestAnimationFrame(render);}
  function fit(){const fitted=fitMapView(center,vets,width,height);view=fitted.center;zoom=fitted.zoom;schedule();}
  function resize(){const r=root.getBoundingClientRect();width=Math.round(r.width);height=Math.round(r.height);if(first&&width&&height){first=false;fit();}else schedule();}
  function select(index){selected=index;markerNodes.forEach((b,i)=>{b.classList.toggle('is-selected',i===index);b.setAttribute('aria-pressed',String(i===index));});}
  function zoomBy(delta){zoom=clamp(zoom+delta,3,18);schedule();}
  const pointers=new Map();let drag=null,pinch=null,moved=false;
  function down(e){if(e.target.closest('button,a')||(e.pointerType==='mouse'&&e.button!==0))return;e.preventDefault();root.setPointerCapture?.(e.pointerId);pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});moved=false;if(pointers.size===1){drag={x:e.clientX,y:e.clientY,view:projectCoordinate(view,zoom)};root.classList.add('is-dragging');}else{const p=[...pointers.values()];pinch={distance:Math.hypot(p[1].x-p[0].x,p[1].y-p[0].y),zoom};drag=null;}}
  function move(e){if(!pointers.has(e.pointerId))return;pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});if(pointers.size===2&&pinch){const p=[...pointers.values()],ratio=Math.hypot(p[1].x-p[0].x,p[1].y-p[0].y)/Math.max(1,pinch.distance);zoom=clamp(pinch.zoom+Math.round(Math.log2(ratio)),3,18);moved=true;schedule();}else if(drag){const dx=e.clientX-drag.x,dy=e.clientY-drag.y;moved||=Math.abs(dx)+Math.abs(dy)>6;view=unprojectCoordinate({x:drag.view.x-dx,y:drag.view.y-dy},zoom);schedule();}}
  function up(e){pointers.delete(e.pointerId);if(root.hasPointerCapture?.(e.pointerId))root.releasePointerCapture(e.pointerId);if(!pointers.size){drag=null;pinch=null;root.classList.remove('is-dragging');}else{const p=[...pointers.values()][0];drag={x:p.x,y:p.y,view:projectCoordinate(view,zoom)};pinch=null;}}
  function key(e){if(e.target!==root)return;const deltas={ArrowLeft:[-70,0],ArrowRight:[70,0],ArrowUp:[0,-70],ArrowDown:[0,70]};if(deltas[e.key]){e.preventDefault();const p=projectCoordinate(view,zoom),d=deltas[e.key];view=unprojectCoordinate({x:p.x+d[0],y:p.y+d[1]},zoom);schedule();}else if(['+','=','-','Home'].includes(e.key)){e.preventDefault();if(e.key==='Home')fit();else zoomBy(e.key==='-'?-1:1);}}
  root.querySelectorAll('[data-map-zoom]').forEach(b=>b.addEventListener('click',()=>zoomBy(Number(b.dataset.mapZoom))));root.querySelector('[data-map-fit]').addEventListener('click',fit);
  root.addEventListener('pointerdown',down);root.addEventListener('pointermove',move);root.addEventListener('pointerup',up);root.addEventListener('pointercancel',up);root.addEventListener('keydown',key);
  const observer=typeof win.ResizeObserver==='function'?new win.ResizeObserver(resize):null;observer?.observe(root);resize();
  return{select,fit,destroy(){destroyed=true;observer?.disconnect();if(frame)win.cancelAnimationFrame(frame);root.removeEventListener('pointerdown',down);root.removeEventListener('pointermove',move);root.removeEventListener('pointerup',up);root.removeEventListener('pointercancel',up);root.removeEventListener('keydown',key);tileNodes.clear();}};
}
