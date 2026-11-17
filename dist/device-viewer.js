// Dependency-free interactive 3D concept model. No product photograph is rotated.
// The rounded shell, glass face, strap loops and underside sensors are real meshes.
export function mountDeviceViewer(container, options = {}) {
  const zh = String(options.language || '').startsWith('zh');
  const label = (zh ? '设备概念模型。拖动可旋转；方向键旋转，Home 键复位。' : 'Concept device. Drag to rotate; use arrow keys to rotate and Home to reset.') + (options.connectionLabel ? ` ${options.connectionLabel}.` : '');
  const lampTone = options.connectionTone === 'connected' ? 'connected' : ['pending','warning'].includes(options.connectionTone) ? options.connectionTone : 'offline';
  const lampRGB = {connected:[105,211,126],pending:[245,196,75],warning:[245,196,75],offline:[145,155,163]}[lampTone];
  const lampColor = lampRGB.map(value => value / 255);
  const canvas = document.createElement('canvas');
  canvas.className = 'device-viewer-canvas';
  canvas.setAttribute('aria-hidden', 'true');
  Object.assign(canvas.style, { width:'100%', height:'100%', display:'block', touchAction:'none', cursor:'grab', background:'radial-gradient(ellipse 34% 6% at 50% 81%,rgba(53,65,80,.15),transparent 100%)' });
  const previous = { tabIndex:container.getAttribute('tabindex'), label:container.getAttribute('aria-label'), role:container.getAttribute('role'), position:container.style.position };
  if(getComputedStyle(container).position==='static')container.style.position='relative';
  container.tabIndex = 0;
  container.setAttribute('role', 'group');
  container.setAttribute('aria-label', label);
  container.append(canvas);
  const lampGlow = document.createElement('span');
  lampGlow.className = `device-model-light is-${lampTone}`;
  lampGlow.setAttribute('aria-hidden', 'true');
  Object.assign(lampGlow.style,{position:'absolute',zIndex:'1',pointerEvents:'none',borderRadius:'50%',background:`radial-gradient(circle,rgba(${lampRGB},.62) 0%,rgba(${lampRGB},.30) 25%,rgba(${lampRGB},.10) 48%,rgba(${lampRGB},0) 72%)`,transform:'translate(-50%,-50%)'});
  container.append(lampGlow);
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const motionReduced = () => reduced.matches || document.documentElement.dataset.motion === 'reduced';
  let gl;
  try { gl = canvas.getContext('webgl', { alpha:true, antialias:true, premultipliedAlpha:false, powerPreference:'low-power' }); } catch {}
  let xRotation=-.26, yRotation=.48, pointer=null, disposed=false, raf=0, visible=true, lastTime=0, interacted=false, program, buffer;
  const vertices=[];
  const pearl=[.77,.79,.81], metal=[.48,.53,.58], graphite=[.13,.16,.19], glass=[.075,.115,.145], rim=[.66,.71,.76], back=[.34,.38,.42];
  function normal(a,b,c) {
    const u=b.map((v,i)=>v-a[i]),v=c.map((n,i)=>n-a[i]);
    const n=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]];
    const length=Math.hypot(...n)||1;return n.map(value=>value/length);
  }
  function triangle(a,b,c,color,n) { const vector=n||normal(a,b,c); for(const point of [a,b,c]) vertices.push(...point,...vector,...color); }
  function quad(a,b,c,d,color,n) { triangle(a,b,c,color,n);triangle(a,c,d,color,n); }
  function outline(w,h,r,cx=0,cy=0,z=0,count=12) {
    const result=[];
    for(let corner=0;corner<4;corner++) {
      const angle=corner*Math.PI/2;
      const centerX=cx+Math.cos(angle+Math.PI/4)*Math.SQRT2*(w/2-r);
      const centerY=cy+Math.sin(angle+Math.PI/4)*Math.SQRT2*(h/2-r);
      for(let step=0;step<count;step++) { const theta=angle+step/count*Math.PI/2;result.push([centerX+Math.cos(theta)*r,centerY+Math.sin(theta)*r,z]); }
    }
    return result;
  }
  function bridge(a,b,color,reverse=false) {
    for(let index=0;index<a.length;index++) { const next=(index+1)%a.length; if(reverse)quad(a[index],b[index],b[next],a[next],color);else quad(a[index],a[next],b[next],b[index],color); }
  }
  function fillFace(points,color,front=true) {
    const center=points.reduce((sum,p)=>sum.map((value,i)=>value+p[i]/points.length),[0,0,0]);
    for(let i=0;i<points.length;i++) triangle(center,points[i],points[(i+1)%points.length],color,[0,0,front?1:-1]);
  }
  function roundedBody(cx,cy,w,h,r,layers,colors) {
    const rings=layers.map(([inset,z])=>outline(w-inset*2,h-inset*2,Math.max(.04,r-inset),cx,cy,z));
    for(let i=0;i<rings.length-1;i++)bridge(rings[i],rings[i+1],colors[Math.min(i,colors.length-1)]);
    fillFace(rings[0],colors[0],false);fillFace(rings.at(-1),colors.at(-1),true);
  }
  function disc(cx,cy,z,r,color,front=true,segments=40) {
    const points=Array.from({length:segments},(_,i)=>[cx+Math.cos(i/segments*Math.PI*2)*r,cy+Math.sin(i/segments*Math.PI*2)*r,z]);fillFace(points,color,front);return points;
  }
  function cylinder(cx,cy,r,z0,z1,color,cap=color) { const a=disc(cx,cy,z0,r,color,false),b=disc(cx,cy,z1,r,cap,true);bridge(a,b,color); }
  function loop(cx) {
    const outerA=outline(.72,1.20,.25,cx,0,-.11),outerB=outline(.72,1.20,.25,cx,0,.10);
    const innerA=outline(.35,.77,.12,cx,0,-.11),innerB=outline(.35,.77,.12,cx,0,.10);
    bridge(outerA,outerB,graphite);bridge(innerB,innerA,graphite);bridge(outerB,innerB,[.23,.27,.30]);bridge(innerA,outerA,[.18,.21,.24]);
  }
  loop(-1.53);loop(1.53);
  roundedBody(0,0,2.65,1.62,.47,[[.13,-.27],[.035,-.23],[0,-.13],[0,.12],[.055,.25],[.12,.28]],[back,metal,pearl,pearl,rim,pearl]);
  roundedBody(0,.025,1.75,.82,.30,[[0,.283],[.035,.305],[.065,.315]],[metal,rim,glass]);
  // A recessed rim makes the illuminated connection lamp part of the device.
  cylinder(.91,.46,.098,.275,.307,[.34,.43,.48],[.50,.56,.59]);
  const lampStart=vertices.length/9;
  disc(.91,.46,.310,.074,lampColor);
  disc(.893,.481,.311,.020,lampColor.map(value=>value*.35+.65));
  const lampCount=vertices.length/9-lampStart;
  // Optical highlight and three understated readout marks.
  for(let i=0;i<3;i++)roundedBody(-.21+i*.21,.025,.065,.19,.032,[[0,.318],[.005,.323]],[[.54,.63,.67],[.68,.76,.78]]);
  roundedBody(-.18,.285,1.10,.026,.013,[[0,.319],[0,.320]],[[.43,.51,.55],[.43,.51,.55]]);
  // The underside is visible when the user turns the model around.
  cylinder(0,0,.39,-.335,-.272,[.15,.19,.23],[.21,.26,.30]);
  disc(0,0,-.339,.30,[.055,.09,.115],false);
  disc(-.10,.09,-.343,.065,[.23,.34,.42],false);
  disc(.11,-.07,-.343,.055,[.30,.36,.45],false);
  for(const px of [-.64,.64])cylinder(px,-.27,.052,-.307,-.273,[.52,.53,.48],[.73,.72,.63]);
  // A slightly raised side control follows the case edge.
  roundedBody(.78,-.615,.48,.12,.05,[[0,.14],[.014,.195]],[[.38,.43,.48],[.48,.54,.59]]);

  const vertexSource=`attribute vec3 aPosition;attribute vec3 aNormal;attribute vec3 aColor;uniform mat3 uRotation;uniform float uAspect;uniform float uScale;varying vec3 vNormal;varying vec3 vPosition;varying vec3 vColor;void main(){vec3 p=uRotation*aPosition;vPosition=p;vNormal=uRotation*aNormal;vColor=aColor;float perspective=1.0/(1.0-p.z*.065);gl_Position=vec4(p.x*uScale*perspective/uAspect,p.y*uScale*perspective+.035,-p.z*.13,1.0);}`;
  const fragmentSource=`precision mediump float;uniform float uEmission;varying vec3 vNormal;varying vec3 vPosition;varying vec3 vColor;void main(){vec3 n=normalize(vNormal);vec3 l=normalize(vec3(-.45,.75,1.0));float diffuse=max(dot(n,l),0.0);float fill=max(dot(n,normalize(vec3(.8,-.25,.5))),0.0);float spec=pow(max(dot(n,normalize(l+vec3(0.,0.,1.))),0.0),48.0);float edge=pow(1.0-abs(n.z),3.0);vec3 color=vColor*(.44+.56*diffuse+.16*fill)+vec3(.96,.98,1.)*spec*.32+vec3(.08,.10,.13)*edge;gl_FragColor=vec4(mix(color,vColor,uEmission),1.0);}`;
  let positions,normals,colors,rotation,aspect,scale,emission;
  function initGL() {
    if(!gl)return false;
    const compile=(type,source)=>{const shader=gl.createShader(type);gl.shaderSource(shader,source);gl.compileShader(shader);if(!gl.getShaderParameter(shader,gl.COMPILE_STATUS)){gl.deleteShader(shader);throw Error('shader unavailable');}return shader;};
    try {
      const vertex=compile(gl.VERTEX_SHADER,vertexSource),fragment=compile(gl.FRAGMENT_SHADER,fragmentSource);
      program=gl.createProgram();gl.attachShader(program,vertex);gl.attachShader(program,fragment);gl.linkProgram(program);gl.deleteShader(vertex);gl.deleteShader(fragment);
      if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw Error('program unavailable');
      buffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(vertices),gl.STATIC_DRAW);
      positions=gl.getAttribLocation(program,'aPosition');normals=gl.getAttribLocation(program,'aNormal');colors=gl.getAttribLocation(program,'aColor');rotation=gl.getUniformLocation(program,'uRotation');aspect=gl.getUniformLocation(program,'uAspect');scale=gl.getUniformLocation(program,'uScale');emission=gl.getUniformLocation(program,'uEmission');
      gl.enable(gl.DEPTH_TEST);gl.depthFunc(gl.LEQUAL);gl.disable(gl.CULL_FACE);gl.clearColor(0,0,0,0);return true;
    } catch { return false; }
  }
  function rotationMatrix() {
    const cx=Math.cos(xRotation),sx=Math.sin(xRotation),cy=Math.cos(yRotation),sy=Math.sin(yRotation);
    return [cy,sx*sy,-cx*sy,0,cx,sx,sy,-sx*cy,cx*cy];
  }
  function draw() {
    if(disposed||!visible)return;
    const rect=container.getBoundingClientRect(),width=Math.max(1,rect.width),height=Math.max(1,rect.height),dpr=Math.min(devicePixelRatio||1,1.6);
    const pixelWidth=Math.round(width*dpr),pixelHeight=Math.round(height*dpr);
    if(canvas.width!==pixelWidth||canvas.height!==pixelHeight){canvas.width=pixelWidth;canvas.height=pixelHeight;}
    if(gl&&program&&!gl.isContextLost()) {
      gl.viewport(0,0,pixelWidth,pixelHeight);gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);gl.useProgram(program);gl.bindBuffer(gl.ARRAY_BUFFER,buffer);
      for(const [attribute,offset] of [[positions,0],[normals,12],[colors,24]]){gl.enableVertexAttribArray(attribute);gl.vertexAttribPointer(attribute,3,gl.FLOAT,false,36,offset);}
      gl.uniformMatrix3fv(rotation,false,new Float32Array(rotationMatrix()));gl.uniform1f(aspect,width/height);gl.uniform1f(scale,Math.min(.49,.43*width/height));gl.uniform1f(emission,0);gl.drawArrays(gl.TRIANGLES,0,vertices.length/9);
      // Repaint only the lens with emission, retaining depth occlusion as it rotates.
      gl.uniform1f(emission,1);gl.drawArrays(gl.TRIANGLES,lampStart,lampCount);
      positionLampGlow(width,height,true);
    } else {drawFallback(width,height,dpr);positionLampGlow(width,height,false);}
  }
  function positionLampGlow(width,height,hardware) {
    const m=rotationMatrix(),x=.91,y=.46,z=.312;
    const tx=m[0]*x+m[3]*y+m[6]*z,ty=m[1]*x+m[4]*y+m[7]*z,tz=m[2]*x+m[5]*y+m[8]*z,q=1/(1-tz*.065);
    const size=hardware?Math.min(.49,.43*width/height)*height/2:Math.min(width/4.6,height/3.2);
    lampGlow.style.left=`${width/2+tx*size*q}px`;
    lampGlow.style.top=`${height*(hardware ? .4825 : .48)-ty*size*q}px`;
    lampGlow.style.width=lampGlow.style.height=`${Math.max(18,size*.48*q)}px`;
    lampGlow.style.opacity=String((lampTone==='offline' ? .18 : 1)*Math.max(0,Math.min(1,(m[8]-.04)*2)));
  }
  // The software renderer uses an actual per-pixel depth buffer. Sorting whole
  // triangles is insufficient for the inset glass and the curved, layered case.
  let fallbackCanvas,ctx,softwareImage,softwareDepth,lastSoftwarePaint=0,forceDraw=true;
  function drawFallback(width,height,dpr) {
    if(!fallbackCanvas){fallbackCanvas=document.createElement('canvas');fallbackCanvas.setAttribute('aria-hidden','true');fallbackCanvas.style.cssText=canvas.style.cssText;fallbackCanvas.style.position='absolute';fallbackCanvas.style.inset='0';fallbackCanvas.style.pointerEvents='none';container.append(fallbackCanvas);ctx=fallbackCanvas.getContext('2d');}
    if(!ctx)return;
    // Supersample modestly for a smooth silhouette, with a strict mobile budget.
    const quality=Math.min(dpr,1.4,420/Math.max(width,height));
    const w=Math.max(1,Math.round(width*quality)),h=Math.max(1,Math.round(height*quality));
    if(fallbackCanvas.width!==w||fallbackCanvas.height!==h||!softwareImage){fallbackCanvas.width=w;fallbackCanvas.height=h;softwareImage=ctx.createImageData(w,h);softwareDepth=new Float32Array(w*h);}
    const pixels=softwareImage.data;pixels.fill(0);softwareDepth.fill(-Infinity);
    const m=rotationMatrix(),size=Math.min(w/4.6,h/3.2),centerX=w/2,centerY=h*.48;
    // Unit directional lights match the WebGL material, including a soft metal glint.
    const light=[-.338,.563,.751],fill=[.820,-.256,.512],half=[-.181,.301,.936];
    const projected=new Float64Array(9);
    for(let index=0;index<vertices.length;index+=27){
      for(let vertex=0;vertex<3;vertex++){
        const offset=index+vertex*9,x=vertices[offset],y=vertices[offset+1],z=vertices[offset+2];
        const tx=m[0]*x+m[3]*y+m[6]*z,ty=m[1]*x+m[4]*y+m[7]*z,tz=m[2]*x+m[5]*y+m[8]*z,q=1/(1-tz*.065);
        projected[vertex*3]=centerX+tx*size*q;projected[vertex*3+1]=centerY-ty*size*q;projected[vertex*3+2]=tz*q;
      }
      const ax=projected[0],ay=projected[1],az=projected[2],bx=projected[3],by=projected[4],bz=projected[5],cx=projected[6],cy=projected[7],cz=projected[8];
      const area=(bx-ax)*(cy-ay)-(by-ay)*(cx-ax);
      if(Math.abs(area)<.00001)continue;
      const minX=Math.max(0,Math.floor(Math.min(ax,bx,cx))),maxX=Math.min(w-1,Math.ceil(Math.max(ax,bx,cx)));
      const minY=Math.max(0,Math.floor(Math.min(ay,by,cy))),maxY=Math.min(h-1,Math.ceil(Math.max(ay,by,cy)));
      if(minX>maxX||minY>maxY)continue;
      const nx0=vertices[index+3],ny0=vertices[index+4],nz0=vertices[index+5];
      const nx=m[0]*nx0+m[3]*ny0+m[6]*nz0,ny=m[1]*nx0+m[4]*ny0+m[7]*nz0,nz=m[2]*nx0+m[5]*ny0+m[8]*nz0;
      const diffuse=Math.max(0,nx*light[0]+ny*light[1]+nz*light[2]),bounce=Math.max(0,nx*fill[0]+ny*fill[1]+nz*fill[2]);
      const spec=Math.pow(Math.max(0,nx*half[0]+ny*half[1]+nz*half[2]),48)*.32,edge=Math.pow(1-Math.abs(nz),3);
      const luminance=.44+.56*diffuse+.16*bounce;
      const isLamp=index>=lampStart*9&&index<(lampStart+lampCount)*9;
      const red=Math.min(255,Math.round((isLamp?vertices[index+6]:vertices[index+6]*luminance+.96*spec+.08*edge)*255));
      const green=Math.min(255,Math.round((isLamp?vertices[index+7]:vertices[index+7]*luminance+.98*spec+.10*edge)*255));
      const blue=Math.min(255,Math.round((isLamp?vertices[index+8]:vertices[index+8]*luminance+spec+.13*edge)*255));
      // Barycentric weights and depth advance linearly across each scanline.
      const inv=1/area,duDx=(by-cy)*inv,duDy=(cx-bx)*inv,dvDx=(cy-ay)*inv,dvDy=(ax-cx)*inv;
      const originX=minX+.5,originY=minY+.5;
      let rowU=((by-cy)*(originX-cx)+(cx-bx)*(originY-cy))*inv;
      let rowV=((cy-ay)*(originX-cx)+(ax-cx)*(originY-cy))*inv;
      for(let y=minY;y<=maxY;y++){
        let u=rowU,v=rowV,pixel=y*w+minX;
        for(let x=minX;x<=maxX;x++,pixel++,u+=duDx,v+=dvDx){
          const third=1-u-v;
          if(u<-.000001||v<-.000001||third<-.000001)continue;
          const depth=u*az+v*bz+third*cz;
          if(depth<=softwareDepth[pixel])continue;
          softwareDepth[pixel]=depth;const offset=pixel*4;
          pixels[offset]=red;pixels[offset+1]=green;pixels[offset+2]=blue;pixels[offset+3]=255;
        }
        rowU+=duDy;rowV+=dvDy;
      }
    }
    ctx.putImageData(softwareImage,0,0);
  }
  if(!initGL())gl=null;
  function frame(time) {
    raf=0;if(disposed||!visible)return;
    const dt=Math.min(40,time-lastTime||16);lastTime=time;
    if(!pointer&&!interacted&&!motionReduced())yRotation+=dt*.000045;
    const hardware=gl&&program&&!gl.isContextLost();
    // Idle software animation is 15 fps; pointer/keyboard changes render next frame.
    if(forceDraw||hardware||time-lastSoftwarePaint>=66){draw();lastSoftwarePaint=time;forceDraw=false;}
    if(!motionReduced()&&!interacted)raf=requestAnimationFrame(frame);
  }
  function requestDraw(){forceDraw=true;if(!raf&&!disposed)raf=requestAnimationFrame(frame);}
  function down(event){if(event.button!==0)return;event.preventDefault();event.stopPropagation();interacted=true;pointer={id:event.pointerId,x:event.clientX,y:event.clientY};canvas.setPointerCapture?.(event.pointerId);canvas.style.cursor='grabbing';container.focus({preventScroll:true});}
  function move(event){if(!pointer||pointer.id!==event.pointerId)return;event.preventDefault();event.stopPropagation();yRotation+=(event.clientX-pointer.x)*.012;xRotation=Math.max(-1.4,Math.min(1.4,xRotation+(event.clientY-pointer.y)*.009));pointer={id:event.pointerId,x:event.clientX,y:event.clientY};requestDraw();}
  function up(event){if(!pointer||pointer.id!==event.pointerId)return;event.stopPropagation();pointer=null;canvas.style.cursor='grab';requestDraw();}
  function key(event){if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home'].includes(event.key))return;event.preventDefault();event.stopPropagation();interacted=true;if(event.key==='Home'){xRotation=-.26;yRotation=.48;}else if(event.key==='ArrowLeft')yRotation-=.18;else if(event.key==='ArrowRight')yRotation+=.18;else xRotation=Math.max(-1.4,Math.min(1.4,xRotation+(event.key==='ArrowUp'?-.15:.15)));requestDraw();}
  function lost(event){event.preventDefault();cancelAnimationFrame(raf);raf=0;program=null;requestDraw();}
  function restored(){if(initGL()){fallbackCanvas?.remove();fallbackCanvas=null;ctx=null;}requestDraw();}
  function pageVisibility(){visible=!document.hidden;visible?requestDraw():cancelAnimationFrame(raf);if(!visible)raf=0;}
  canvas.addEventListener('pointerdown',down);canvas.addEventListener('pointermove',move);canvas.addEventListener('pointerup',up);canvas.addEventListener('pointercancel',up);canvas.addEventListener('webglcontextlost',lost);canvas.addEventListener('webglcontextrestored',restored);container.addEventListener('keydown',key);document.addEventListener('visibilitychange',pageVisibility);
  const resize=new ResizeObserver(requestDraw);resize.observe(container);
  const observer=typeof IntersectionObserver==='function'?new IntersectionObserver(entries=>{visible=entries[0]?.isIntersecting!==false&&!document.hidden;if(visible)requestDraw();else{cancelAnimationFrame(raf);raf=0;}}):null;observer?.observe(container);
  reduced.addEventListener?.('change',requestDraw);window.addEventListener('pawprint:preferences',requestDraw);requestDraw();
  return { destroy(){disposed=true;cancelAnimationFrame(raf);resize.disconnect();observer?.disconnect();reduced.removeEventListener?.('change',requestDraw);window.removeEventListener('pawprint:preferences',requestDraw);document.removeEventListener('visibilitychange',pageVisibility);container.removeEventListener('keydown',key);canvas.removeEventListener('pointerdown',down);canvas.removeEventListener('pointermove',move);canvas.removeEventListener('pointerup',up);canvas.removeEventListener('pointercancel',up);canvas.removeEventListener('webglcontextlost',lost);canvas.removeEventListener('webglcontextrestored',restored);if(gl){if(buffer)gl.deleteBuffer(buffer);if(program)gl.deleteProgram(program);}canvas.remove();fallbackCanvas?.remove();lampGlow.remove();container.style.position=previous.position;for(const [name,value] of [['tabindex',previous.tabIndex],['aria-label',previous.label],['role',previous.role]])value===null?container.removeAttribute(name):container.setAttribute(name,value); } };
}
