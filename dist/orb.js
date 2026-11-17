import { waterDogPose, waterDogNodes, waterDogParticles, waterDogImpacts, waterDogContours, waterDogWake } from './water-dog.js';
const palettes = {
  unknown: { light:[240,244,247],mid:[178,190,201],deep:[83,100,114],glow:[217,227,235] },
  good: { light:[241,247,225],mid:[174,196,137],deep:[72,91,56],glow:[223,237,193] },
  watch: { light:[249,244,224],mid:[197,182,137],deep:[100,89,65],glow:[237,226,192] },
  alert: { light:[249,232,234],mid:[199,155,164],deep:[105,67,79],glow:[239,211,215] },
};
const tau=Math.PI*2, count=96;
const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
const lerp=(a,b,t)=>a+(b-a)*t;
const ease=t=>t*t*(3-2*t);
const rgba=(c,a)=>'rgba('+c.map(Math.round).join(',')+','+a+')';


function surfaceRadius(a,t,interaction){
  const ad=Math.atan2(Math.sin(a-interaction[0]),Math.cos(a-interaction[0]));
  const crest=Math.atan2(Math.sin(a+2.35-t*.38),Math.cos(a+2.35-t*.38));
  const returnCrest=Math.atan2(Math.sin(a-1.15+t*.31),Math.cos(a-1.15+t*.31));
  const contactAngle=interaction[3]||0,contactLift=interaction[4]||0;
  const contactDelta=Math.atan2(Math.sin(a-contactAngle),Math.cos(a-contactAngle));
  const age=interaction[5]||0,impact=interaction[6]||0;
  const impactRing=Math.abs(contactDelta)-(.08+age*.72);
  const impactDent=-11*Math.exp(-age*18)*Math.exp(-contactDelta*contactDelta/.035);
  const impactRecoil=5*Math.sin(Math.min(1,age/.27)*Math.PI)*Math.exp(-impactRing*impactRing/.035);
  return impact*(impactDent+impactRecoil)+90*(1+.048*Math.sin(a*3-t*.91)+.025*Math.sin(a*5+t*.74)+.008*Math.sin(a*9-t*1.4))
    +8*Math.exp(-crest*crest/.2)*(.74+.26*Math.cos(crest*12-t*1.2))
    +4.5*Math.exp(-returnCrest*returnCrest/.19)*(.6+.4*Math.sin(t*1.1))
    +interaction[1]*Math.exp(-ad*ad/.27)+interaction[2]*Math.sin(a*3+t*3)+contactLift*Math.exp(-contactDelta*contactDelta/.10);
}


/**
 * Two-and-a-half dimensional implicit water surfaces.
 * The silhouette is a smooth union of volumes, never a collection of strokes.
 * WebGL and the small CPU fallback share the same signed-distance geometry.
 */
function createWaterSurface() {
  let surface = document.createElement('canvas');
  surface.width = surface.height = 320;
  let gl = surface.getContext('webgl', { alpha: true, antialias: false, premultipliedAlpha: false, preserveDrawingBuffer: true });
  let program, uniforms, buffer, animalTexture, rendererDetail='';
  const vertex = 'attribute vec2 position; varying vec2 uv; void main(){uv=position*.5+.5;gl_Position=vec4(position,0.,1.);}';
  const fragment = [
    'precision highp float;',
    'varying vec2 uv;',
    'uniform float mode,time,touchAngle,touchPull,impulse,contactAngle,contactLift,impactAge,impactStrength;',
    'uniform vec3 tint;',
    'uniform sampler2D animalDistance;',
    'float sm(float a,float b){float h=max(2.8-abs(a-b),0.)/2.8;return min(a,b)-h*h*.7;}',
    'float sdf(vec2 p){',
    'if(mode<.5){float a=atan(p.y,p.x);float r=90.*(1.+.048*sin(a*3.-time*.91)+.025*sin(a*5.+time*.74)+.008*sin(a*9.-time*1.4));float ad=atan(sin(a-touchAngle),cos(a-touchAngle));float ca=atan(sin(a+2.35-time*.38),cos(a+2.35-time*.38));float cb=atan(sin(a-1.15+time*.31),cos(a-1.15+time*.31));r+=8.*exp(-ca*ca/.2)*(.74+.26*cos(ca*12.-time*1.2));r+=4.5*exp(-cb*cb/.19)*(.6+.4*sin(time*1.1));float cd=atan(sin(a-contactAngle),cos(a-contactAngle));r+=touchPull*exp(-ad*ad/.27)+impulse*sin(a*3.+time*3.)+contactLift*exp(-cd*cd/.10);float ir=abs(cd)-(.08+impactAge*.72);r+=impactStrength*(-11.*exp(-impactAge*18.)*exp(-cd*cd/.035)+5.*sin(min(1.,impactAge/.27)*3.14159265)*exp(-ir*ir/.035));return length(p)-r;}',
    'p+=vec2(.8*sin(p.y*.13+time*1.4),.8*sin(p.x*.11-time*1.2));',
    'return texture2D(animalDistance,(p+110.)/220.).r*128.-64.;}',
    'float heightAt(vec2 p){float d=sdf(p);if(d>0.)return 0.;if(mode<.5){float radial=length(p);float rr=90.+(radial-d-90.)*smoothstep(0.,55.,radial);float h=sqrt(max(0.,rr*rr-radial*radial))*.75;float roll=sin(p.x*.048+time*1.12)*sin(p.y*.065-time*.83)+.55*sin(p.x*.085+p.y*.04-time*.72);return h+roll*10.5*smoothstep(0.,7.,-d);}float h=sqrt(max(0.,-d*8.));float roll=(sin(p.x*.12+time)*sin(p.y*.15-time*.7)+.4*sin(p.x*.23+p.y*.16-time*1.1));return h+roll*2.1*smoothstep(0.,5.,-d);}',
    'void main(){vec2 p=(uv-.5)*vec2(220.,-220.);float d=sdf(p);if(d>1.2){gl_FragColor=vec4(0.);return;}',
    'float h=heightAt(p);float dx=(heightAt(p+vec2(.8,0.))-heightAt(p-vec2(.8,0.)))/1.6;float dy=(heightAt(p+vec2(0.,.8))-heightAt(p-vec2(0.,.8)))/1.6;',
    'vec3 n=normalize(vec3(-dx,-dy,mode<.5?1.2:1.05));vec3 r=reflect(vec3(0.,0.,-1.),n);',
    'float fres=pow(1.-max(n.z,0.),2.3);',
    'float band=exp(-pow((r.y+.21+.16*sin(r.x*6.+time*.2))/(mode<.5?.19:.105),2.));',
    'float panel=exp(-pow((r.x+r.y*.46+.35)/(mode<.5?.24:.15),2.))*smoothstep(-.7,.55,-r.y);',
    'float spec=pow(max(0.,dot(n,normalize(vec3(-.52,-.74,1.)))),38.);',
    'float spec2=pow(max(0.,dot(n,normalize(vec3(.68,.43,.44)))),65.);',
    'float edgeLight=(.5+.5*sin(atan(p.y,p.x)*3.-time*1.2))*smoothstep(-8.,0.,d);float white=clamp(panel*.76+spec+spec2*.85+(mode<.5?edgeLight*.28:0.),0.,1.);',
    'float edge=1.-smoothstep(0.,mode<.5?15.:7.,-d);',
    'float dark=mode<.5?clamp(band*.45+fres*.22,0.,.72):clamp(band*.54+fres*.25,0.,.78);',
    'vec3 base=mix(vec3(.65,.72,.74),tint,mode<.5?.62:.55);vec3 c=mix(base,mode<.5?vec3(.32,.44,.47):vec3(.14,.23,.26),dark);c=mix(c,vec3(.98,.995,1.),white);',
    'float a;if(mode<.5){float rim=smoothstep(.58,1.,length(p)/90.);a=.16+fres*.10+(dark*.32+white*.34)*(.72+rim*.14);a*=1.-smoothstep(-8.,0.,d)*.3*(1.-edgeLight);c=mix(c,tint,.16*(1.-white*.8));}',
    'else{a=.10+fres*.28+dark*.24+white*.59+edge*.08;}',
    'a*=1.-smoothstep(mode<.5?-1.1:-.7,mode<.5?1.2:1.,d);gl_FragColor=vec4(c,clamp(a,0.,.97));}'
  ].join('\n');
  try {
    if (!gl) throw new Error('No WebGL');
    const compile = (type, source) => {
      const shader = gl.createShader(type); gl.shaderSource(shader, source); gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) { const detail=gl.getShaderInfoLog(shader); gl.deleteShader(shader); throw new Error(detail||'Water shader unsupported'); }
      return shader;
    };
    const vs = compile(gl.VERTEX_SHADER, vertex), fs = compile(gl.FRAGMENT_SHADER, fragment);
    program = gl.createProgram(); gl.attachShader(program, vs); gl.attachShader(program, fs); gl.linkProgram(program);
    gl.deleteShader(vs); gl.deleteShader(fs);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error('Water program unsupported');
    gl.useProgram(program);
    buffer = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]), gl.STATIC_DRAW);
    const attribute = gl.getAttribLocation(program, 'position');
    gl.enableVertexAttribArray(attribute); gl.vertexAttribPointer(attribute, 2, gl.FLOAT, false, 0, 0);
    uniforms = Object.fromEntries(['mode','time','touchAngle','touchPull','impulse','contactAngle','contactLift','impactAge','impactStrength','tint','animalDistance'].map(name => [name, gl.getUniformLocation(program, name)]));
    animalTexture=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,animalTexture);
    // Keep the sampler complete even when the first frame is a hidden dog pose.
    gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,1,1,0,gl.RGBA,gl.UNSIGNED_BYTE,new Uint8Array([255,255,255,255]));
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
    gl.uniform1i(uniforms.animalDistance,0);
    gl.viewport(0, 0, 320, 320);
    gl.disable(gl.DEPTH_TEST); gl.disable(gl.BLEND);
  } catch (error) {
    rendererDetail=String(error.message||'WebGL unavailable');
    if (gl && program) gl.deleteProgram(program);
    gl = null;
    surface = document.createElement('canvas');
    surface.width = surface.height = 160;
  }
  const cpuTargets = new Map();
  // Lookup tables keep full-volume CPU shading inexpensive after warmup.
  const gaussian=new Float32Array(4097),fresnel=new Float32Array(1025),specular=new Float32Array(1025),reflectionSine=new Float32Array(1025);
  for(let i=0;i<=4096;i++)gaussian[i]=Math.exp(-i/256);
  for(let i=0;i<=1024;i++){fresnel[i]=Math.pow(i/1024,2.3);specular[i]=Math.pow(i/1024,38);}
  let reflectionTime=NaN;
  function cpuTarget(mode) {
    if (!cpuTargets.has(mode)) {
      const size=mode===0?320:160,canvas=document.createElement('canvas');
      canvas.width=canvas.height=size;
      const context=canvas.getContext('2d'),coords=new Float32Array(size),radial=new Float32Array(size*size),angles=new Float32Array(size*size),list=[];
      for(let x=0;x<size;x++)coords[x]=(x+.5)*220/size-110;
      for(let y=1;y<size-1;y++)for(let x=1;x<size-1;x++){
        const i=y*size+x,r=Math.sqrt(coords[x]*coords[x]+coords[y]*coords[y]);
        radial[i]=r;angles[i]=(Math.atan2(coords[y],coords[x])+Math.PI)/tau*512;
        if(mode===0?r<=108:true)list.push(i);
      }
      cpuTargets.set(mode,{canvas,context,size,coords,radial,angles,candidates:new Uint32Array(list),radii:new Float32Array(513),edgeLights:new Float32Array(513),
        warpX:new Float32Array(size*size),warpY:new Float32Array(size*size),sx:new Float32Array(size),sy:new Float32Array(size),
        cx:new Float32Array(size),cy:new Float32Array(size),ux:new Float32Array(size),uy:new Float32Array(size),
        pixels:context.createImageData(size,size),depths:new Float32Array(size*size),distances:new Float32Array(size*size)});
    }
    return cpuTargets.get(mode);
  }
  // The same continuous silhouette supplies the GPU texture and CPU fallback.
  // A linear two-pass distance transform is much cheaper than checking dozens
  // of separate body parts at every pixel, and removes their visible seams.
  const maskSize=160,mask=document.createElement('canvas');mask.width=mask.height=maskSize;
  const maskContext=mask.getContext('2d',{willReadFrequently:true});
  const field=new Float32Array(maskSize*maskSize),inside=new Uint8Array(maskSize*maskSize),encoded=new Uint8Array(maskSize*maskSize*4);
  let maskTime=NaN;
  function prepareAnimal(t,contours){
    if(maskTime===t)return;
    maskTime=t;maskContext.clearRect(0,0,maskSize,maskSize);
    maskContext.save();maskContext.scale(maskSize/220,maskSize/220);maskContext.translate(110,110);maskContext.fillStyle='#fff';
    for(const points of contours){
      const path=new Path2D(),last=points[points.length-1],first=points[0];
      path.moveTo((last[0]+first[0])/2,(last[1]+first[1])/2);
      for(let j=0;j<points.length;j++){const p=points[j],n=points[(j+1)%points.length];path.quadraticCurveTo(p[0],p[1],(p[0]+n[0])/2,(p[1]+n[1])/2);}
      path.closePath();maskContext.fill(path);
    }
    maskContext.restore();
    const pixels=maskContext.getImageData(0,0,maskSize,maskSize).data;
    for(let i=0;i<inside.length;i++)inside[i]=pixels[i*4+3]>127?1:0;
    field.fill(1000);
    for(let y=1;y<maskSize-1;y++)for(let x=1;x<maskSize-1;x++){
      const i=y*maskSize+x,v=inside[i];
      if(v!==inside[i-1]||v!==inside[i+1]||v!==inside[i-maskSize]||v!==inside[i+maskSize])field[i]=.5;
    }
    for(let y=1;y<maskSize-1;y++)for(let x=1;x<maskSize-1;x++){
      const i=y*maskSize+x;field[i]=Math.min(field[i],field[i-1]+1,field[i-maskSize]+1,field[i-maskSize-1]+1.4142,field[i-maskSize+1]+1.4142);
    }
    for(let y=maskSize-2;y>0;y--)for(let x=maskSize-2;x>0;x--){
      const i=y*maskSize+x;field[i]=Math.min(field[i],field[i+1]+1,field[i+maskSize]+1,field[i+maskSize+1]+1.4142,field[i+maskSize-1]+1.4142);
    }
    for(let i=0;i<field.length;i++){
      // The alpha edge gives a smooth subpixel crossing rather than a jagged rim.
      field[i]=(inside[i]?-1:1)*field[i]*220/maskSize;
      const value=Math.round(clamp((field[i]+64)/128,0,1)*255),off=i*4;
      encoded[off]=encoded[off+1]=encoded[off+2]=value;encoded[off+3]=255;
    }
  }
  function animalDistanceAt(x,y){
    const fx=clamp((x+110)*maskSize/220-.5,0,maskSize-1.001),fy=clamp((y+110)*maskSize/220-.5,0,maskSize-1.001);
    const ix=fx|0,iy=fy|0,u=fx-ix,v=fy-iy,i=iy*maskSize+ix;
    return lerp(lerp(field[i],field[i+1],u),lerp(field[i+maskSize],field[i+maskSize+1],u),v);
  }
  function render(mode, t, nodes, color, interaction, contours=null) {
    if(mode===1)prepareAnimal(t,contours||waterDogContours(t));
    if (gl?.isContextLost()) { gl=null;rendererDetail='WebGL context lost'; }
    if (gl) {
      gl.useProgram(program);
      gl.uniform1f(uniforms.mode,mode); gl.uniform1f(uniforms.time,t);
      gl.uniform1f(uniforms.touchAngle,interaction[0]); gl.uniform1f(uniforms.touchPull,interaction[1]); gl.uniform1f(uniforms.impulse,interaction[2]);
      gl.uniform1f(uniforms.contactAngle,interaction[3]||0);gl.uniform1f(uniforms.contactLift,interaction[4]||0);
      gl.uniform1f(uniforms.impactAge,interaction[5]||0);gl.uniform1f(uniforms.impactStrength,interaction[6]||0);
      gl.uniform3fv(uniforms.tint,color.map(c=>c/255));
      if(mode===1){gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,animalTexture);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,maskSize,maskSize,0,gl.RGBA,gl.UNSIGNED_BYTE,encoded);}
      gl.drawArrays(gl.TRIANGLES,0,6);
      return surface;
    }
    const target=cpuTarget(mode),{context:cpu,pixels,depths,distances,size,coords,radial,angles:pixelAngles,candidates,warpX,warpY}=target;
    const scale=220/size, inverseScale=1/scale;
    if(reflectionTime!==t){for(let i=0;i<=1024;i++)reflectionSine[i]=Math.sin((i/512-1)*6+t*.2);reflectionTime=t;}
    distances.fill(1000); depths.fill(0); pixels.data.fill(0);
    // The complete water volume shares cached polar geometry; the centre is shaded too.
    if(mode===0){
      const radii=target.radii;
      for(let j=0;j<=512;j++){
        const a=-Math.PI+j*tau/512;
        radii[j]=surfaceRadius(a,t,interaction);target.edgeLights[j]=.5+.5*Math.sin(a*3-t*1.2);
      }
      for(let j=0;j<candidates.length;j++){
        const i=candidates[j],a=pixelAngles[i],k=a|0;
        distances[i]=radial[i]-lerp(radii[k],radii[k+1],a-k);
      }
    }else{
      for(let j=0;j<candidates.length;j++){
        const i=candidates[j],y=(i/size)|0,x=i-y*size;
        const px=coords[x]+.8*Math.sin(coords[y]*.13+t*1.4),py=coords[y]+.8*Math.sin(coords[x]*.11-t*1.2);
        distances[i]=animalDistanceAt(px,py);
      }
    }
    // Separable wave factors replace per-pixel trigonometry in the height pass.
    const sx=target.sx,sy=target.sy,cx=target.cx,cy=target.cy,ux=target.ux,uy=target.uy;
    for(let q=0;q<size;q++){
      sx[q]=Math.sin(coords[q]*(mode===0?.048:.12)+t*(mode===0?1.12:1));
      sy[q]=Math.sin(coords[q]*(mode===0?.065:.15)-t*(mode===0?.83:.7));
      cx[q]=Math.cos(coords[q]*(mode===0?.085:.23));ux[q]=Math.sin(coords[q]*(mode===0?.085:.23));
      cy[q]=Math.cos(coords[q]*(mode===0?.04:.16)-t*(mode===0?.72:1.1));uy[q]=Math.sin(coords[q]*(mode===0?.04:.16)-t*(mode===0?.72:1.1));
    }
    for(let j=0;j<candidates.length;j++){
      const i=candidates[j],d=distances[i];
      if(d>=0)continue;
      const y=(i/size)|0,x=i-y*size;
      const roll=sx[x]*sy[y]+(mode===0?.55:.4)*(ux[x]*cy[y]+cx[x]*uy[y]);
      const radialBlend=clamp(radial[i]/55,0,1),rr=90+(radial[i]-d-90)*ease(radialBlend);
      depths[i]=mode===0?Math.sqrt(Math.max(0,rr*rr-radial[i]*radial[i]))*.75+roll*10.5*Math.min(1,-d/7):Math.sqrt(-d*8)+roll*2.1*Math.min(1,-d*.2);
    }
    const pigment=mode===0?.62:.55,baseR=.65*(1-pigment)+color[0]/255*pigment,baseG=.72*(1-pigment)+color[1]/255*pigment,baseB=.74*(1-pigment)+color[2]/255*pigment;
    const nz0=mode===0?1.2:1.05,gradientScale=1/(2*scale),data=pixels.data;
    for(let j=0;j<candidates.length;j++){
      const i=candidates[j],d=distances[i];
      if(d>1.2)continue;
      const off=i*4;
      const dx=(depths[i+1]-depths[i-1])*gradientScale;
      const dy=(depths[i+size]-depths[i-size])*gradientScale;
      const inverseLength=1/Math.sqrt(dx*dx+dy*dy+nz0*nz0),nx=-dx*inverseLength,ny=-dy*inverseLength,nz=nz0*inverseLength;
      const rx=2*nz*nx,ry=2*nz*ny;
      const fres=fresnel[clamp(((1-nz)*1024)|0,0,1024)],bandTerm=(ry+.21+.16*reflectionSine[clamp(((rx+1)*512)|0,0,1024)])/(mode===0?.19:.105);
      const bandSquared=bandTerm*bandTerm,panelTerm=(rx+ry*.46+.35)/(mode===0?.24:.15),panelSquared=panelTerm*panelTerm;
      const band=bandSquared>16?0:gaussian[(bandSquared*256)|0];
      const panel=(panelSquared>16?0:gaussian[(panelSquared*256)|0])*clamp((-.7-ry)*.8+1,0,1);
      const spec=specular[clamp((((-.52*nx-.74*ny+nz)/1.348)*1024)|0,0,1024)];
      const edgeFactor=mode===0?clamp((d+8)/8,0,1):0;
      const edgeGlow=mode===0?target.edgeLights[pixelAngles[i]|0]*edgeFactor:0;
      const white=Math.min(1,panel*.76+spec+edgeGlow*.28),dark=mode===0?Math.min(.72,band*.45+fres*.22):Math.min(.78,band*.54+fres*.25);
      const rim=mode===0?clamp((radial[i]/90-.58)/.42,0,1):0;
      let alpha=mode===0?.16+fres*.10+(dark*.32+white*.34)*(.72+rim*.14):.10+fres*.28+dark*.24+white*.59+(1-clamp(-d/7,0,1))*.08;
      alpha*=mode===0?(1-clamp((d+1.1)/2.3,0,1))*(1-edgeFactor*.3*(1-edgeGlow)):(1-clamp((d+.7)/1.7,0,1));
      const remain=1-white;
      const pigmentReflection=mode===0?.16*(1-white*.8):0;
      data[off]=255*lerp((baseR+((mode===0?.32:.14)-baseR)*dark)*remain+.98*white,color[0]/255,pigmentReflection);
      data[off+1]=255*lerp((baseG+((mode===0?.44:.23)-baseG)*dark)*remain+.995*white,color[1]/255,pigmentReflection);
      data[off+2]=255*lerp((baseB+((mode===0?.47:.26)-baseB)*dark)*remain+white,color[2]/255,pigmentReflection);
      data[off+3]=255*Math.min(.97,alpha);
    }
    cpu.putImageData(pixels,0,0);return target.canvas;
  }
  return { render, get mode(){return gl?'gpu-volume':'cpu-volume';}, get detail(){return rendererDetail;}, destroy(){if(gl){gl.deleteTexture(animalTexture);gl.deleteBuffer(buffer);gl.deleteProgram(program);gl.getExtension('WEBGL_lose_context')?.loseContext();}} };
}

export function mountOrb(container,{tone='good',reducedMotion}={}) {
  const canvas=document.createElement('canvas');
  canvas.className='orb-canvas';canvas.setAttribute('aria-hidden','true');
  container.setAttribute('data-orb','');container.prepend(canvas);
  const ctx=canvas.getContext('2d',{alpha:true});
  const water=createWaterSurface();
  container.dataset.orbRenderer=water.mode;
  if(water.detail)container.dataset.orbRendererDetail=water.detail;
  const media=window.matchMedia('(prefers-reduced-motion: reduce)');
  let applicationReducedMotion=Boolean(reducedMotion),motionReduced=media.matches||applicationReducedMotion;
  container.dataset.orbMotion=motionReduced?'reduced':'full';
  container.dataset.orbFrameCount='0';
  let colors=structuredClone(palettes[tone]||palettes.good),targetColors=palettes[tone]||palettes.good;
  let width=0,height=0,radius=0,centerX=0,centerY=0;
  let destroyed=false,frame=0,lastFrame=0,elapsed=0,visible=true;
  let pointer=null,pointerAngle=0,pull=0,centerPullX=0,centerPullY=0,currentCenterX=0,currentCenterY=0;
  let burstStarted=null,burstProgress=null,burstResolve=null,burstPromise=null;
  let frameAverage=0,frameSamples=0;
  const displacement=new Float32Array(count),velocity=new Float32Array(count);
  function resize(){
    const box=container.getBoundingClientRect();width=box.width;height=box.height;
    const ratio=Math.min(2,window.devicePixelRatio||1);
    canvas.width=Math.max(1,Math.round(width*ratio));canvas.height=Math.max(1,Math.round(height*ratio));
    ctx?.setTransform(ratio,0,0,ratio,0,0);
    radius=Math.min(width*.429,height*.425,190);centerX=width/2;centerY=height*.49;
    lastFrame=0;schedule();
  }
  const pose=t=>waterDogPose(t,radius);
  const dogNodes=waterDogNodes;
  function droplet(x,y,size,angle,alpha=1,stretch=1){
    if(size<.15||alpha<=0)return;
    ctx.save();ctx.translate(x,y);ctx.rotate(angle);ctx.scale(1,stretch);
    const g=ctx.createRadialGradient(-size*.22,-size*.31,.1,0,0,size);
    g.addColorStop(0,'rgba(255,255,255,'+alpha*.96+')');
    g.addColorStop(.35,rgba(colors.light,alpha*.08));g.addColorStop(.72,rgba(colors.deep,alpha*.27));
    g.addColorStop(.86,'rgba(255,255,255,'+alpha*.72+')');g.addColorStop(1,rgba(colors.deep,alpha*.42));
    ctx.fillStyle=g;ctx.beginPath();ctx.ellipse(0,0,size*.68,size,0,0,tau);ctx.fill();ctx.restore();
  }

  function liquidContour(x,y,t,drag){
    const path=new Path2D(),points=[];
    for(let i=0;i<80;i++){
      const a=i/80*tau,r=surfaceRadius(a,t,drag)*radius/90;
      points.push({x:x+Math.cos(a)*r,y:y+Math.sin(a)*r});
    }
    const last=points[79],first=points[0];
    path.moveTo((last.x+first.x)*.5,(last.y+first.y)*.5);
    points.forEach((p,i)=>{const n=points[(i+1)%80];path.quadraticCurveTo(p.x,p.y,(p.x+n.x)*.5,(p.y+n.y)*.5);});
    path.closePath();return path;
  }
  function drawInteriorWater(x,y,t,drag,dogPose){
    ctx.save();ctx.clip(liquidContour(x,y,t,drag));
    const pigmentGlow=ctx.createRadialGradient(x-radius*.12,y+radius*.04,0,x,y,radius*.94);
    pigmentGlow.addColorStop(0,rgba(colors.mid,.18));
    pigmentGlow.addColorStop(.4,rgba(colors.mid,.16));
    pigmentGlow.addColorStop(1,rgba(colors.mid,.04));
    ctx.fillStyle=pigmentGlow;ctx.fillRect(x-radius*1.15,y-radius*1.15,radius*2.3,radius*2.3);
    // Broad overlapping currents shade the whole water volume, not just a soap rim.
    // They have no drawn outlines: depth comes from moving light across their mass.
    for(let layer=0;layer<4;layer++){
      const phase=t*.76+layer*2.12;
      ctx.save();
      ctx.translate(x+Math.sin(phase*.73)*radius*.16+(dogPose?.x||0)*.17,y+Math.cos(phase)*radius*.27+(dogPose?.y||0)*.17);
      ctx.rotate(Math.sin(phase*.64+layer)*.63+layer*.87);
      const rx=radius*(.73+.06*Math.sin(phase)),ry=radius*(.34+.07*Math.cos(phase*.9));
      ctx.scale(rx,ry);
      const light=ctx.createRadialGradient(-.22,-.23,.02,0,0,1.16);
      light.addColorStop(0,'rgba(255,255,255,.21)');
      light.addColorStop(.32,'rgba(255,255,255,.10)');
      light.addColorStop(.68,rgba(colors.light,.035));
      light.addColorStop(1,rgba(colors.light,0));
      ctx.fillStyle=light;ctx.beginPath();ctx.arc(0,0,1.17,0,tau);ctx.fill();
      const refraction=ctx.createRadialGradient(.38,.2,.02,.3,.15,.9);
      refraction.addColorStop(0,rgba(colors.deep,.10));
      refraction.addColorStop(.45,rgba(colors.mid,.055));
      refraction.addColorStop(1,rgba(colors.mid,0));
      ctx.fillStyle=refraction;ctx.beginPath();ctx.arc(.3,.15,.91,0,tau);ctx.fill();
      ctx.restore();
    }
    drawDogCurrent(x,y,t,dogPose);
    ctx.restore();
  }

  function drawDogCurrent(x,y,t,p){
    const wake=waterDogWake(t,radius);
    if(wake.length>2){
      const sides=[[],[]];
      wake.forEach((v,i)=>{
        const before=wake[Math.max(0,i-1)],after=wake[Math.min(wake.length-1,i+1)];
        const dx=after.x-before.x,dy=after.y-before.y,length=Math.max(.01,Math.hypot(dx,dy));
        const width=v.width*Math.sin((i/(wake.length-1)*.85+.08)*Math.PI);
        sides[0].push({x:x+v.x-dy/length*width,y:y+v.y+dx/length*width});
        sides[1].unshift({x:x+v.x+dy/length*width,y:y+v.y-dx/length*width});
      });
      const points=sides[0].concat(sides[1]),path=new Path2D();
      path.moveTo(points[0].x,points[0].y);
      points.forEach((v,i)=>{const n=points[(i+1)%points.length];path.quadraticCurveTo(v.x,v.y,(v.x+n.x)*.5,(v.y+n.y)*.5);});
      path.closePath();
      const front=wake[0],back=wake[wake.length-1];
      const sheen=ctx.createLinearGradient(x+front.x,y+front.y-radius*.12,x+back.x,y+back.y+radius*.18);
      sheen.addColorStop(0,rgba(colors.light,.01));sheen.addColorStop(.22,'rgba(255,255,255,.27)');
      sheen.addColorStop(.45,rgba(colors.deep,.09));sheen.addColorStop(.64,rgba(colors.light,.14));sheen.addColorStop(1,rgba(colors.light,0));
      ctx.fillStyle=sheen;ctx.fill(path);
    }
    if(p.hidden)return;
    // Refracted pressure lobes follow the animal, opening outward as it pushes
    // through the surrounding water. Filled gradients avoid decorative wires.
    for(let i=0;i<3;i++){
      const age=(t*1.35+i/3)%1,spread=.16+age*.24;
      ctx.save();ctx.translate(x+p.x-p.direction*radius*age*.14,y+p.y+radius*.065);ctx.rotate(p.tilt);
      ctx.scale(radius*spread,radius*spread*.46);
      const wave=ctx.createRadialGradient(0,0,.2,0,0,1);
      wave.addColorStop(0,rgba(colors.light,0));wave.addColorStop(.52,rgba(colors.light,0));
      wave.addColorStop(.67,'rgba(255,255,255,'+(.24*(1-age))+')');
      wave.addColorStop(.79,rgba(colors.deep,.07*(1-age)));wave.addColorStop(1,rgba(colors.light,0));
      ctx.fillStyle=wave;ctx.beginPath();ctx.arc(0,0,1,0,tau);ctx.fill();ctx.restore();
    }
  }




  function wallAdjustedPose(p,t,drag){
    if(!Number.isFinite(p.wallAngle))return {...p,wallShiftX:0,wallShiftY:0};
    const strength=Math.max(p.contactStrength||0,p.hidden?1:0);
    const shift=(surfaceRadius(p.wallAngle,t,drag)/90-1)*radius*strength;
    const dx=Math.cos(p.wallAngle)*shift,dy=Math.sin(p.wallAngle)*shift;
    return {...p,x:p.x+dx,y:p.y+dy,wallShiftX:dx,wallShiftY:dy};
  }
  function drawWallMembrane(x,y,t,p,drag){
    const entry=p.contactKind==='merge';
    const strength=clamp(p.contactStrength||0,0,1)*(entry?clamp(1-(p.contactAge||0)/.14,0,1):1),recoil=entry?0:clamp(p.contactRecoil||0,0,1);
    if(!Number.isFinite(p.wallAngle)||(!strength&&!recoil))return;
    const angle=p.wallAngle,nx=Math.cos(angle),ny=Math.sin(angle);
    const wallR=surfaceRadius(angle,t,drag)/90*radius;
    const ax=x+nx*wallR,ay=y+ny*wallR;
    const anchor=p.contactAnchor||{x:0,y:0};
    const localX=(Array.isArray(anchor)?anchor[0]:anchor.x)*p.scale*p.turn;
    const localY=(Array.isArray(anchor)?anchor[1]:anchor.y)*p.scale*(1-.045*p.tuck);
    const c=Math.cos(p.tilt),s=Math.sin(p.tilt);
    const bx=x+p.x+localX*c-localY*s,by=y+p.y+localX*s+localY*c;
    const dx=bx-ax,dy=by-ay,length=Math.sqrt(dx*dx+dy*dy);
    if(strength>.015&&length>1){
      const tx=-dy/length,ty=dx/length,stretch=clamp(p.stretchBridge||0,0,1);
      const baseWidth=radius*.1*Math.sqrt(strength),tipWidth=radius*.048*Math.sqrt(strength);
      const left=[],right=[];
      for(let j=0;j<=26;j++){
        const u=j/26,bow=Math.sin(u*Math.PI)*radius*.035*Math.sin(t*2.2+angle);
        const px=lerp(ax,bx,u)+tx*bow,py=lerp(ay,by,u)+ty*bow;
        const neck=1-(.24+.72*stretch)*Math.pow(Math.sin(u*Math.PI),3);
        const half=lerp(baseWidth,tipWidth,u)*neck;
        left.push({x:px+tx*half,y:py+ty*half});right.unshift({x:px-tx*half,y:py-ty*half});
      }
      const points=left.concat(right),path=new Path2D();
      const last=points[points.length-1],first=points[0];
      path.moveTo((last.x+first.x)*.5,(last.y+first.y)*.5);
      points.forEach((v,j)=>{const next=points[(j+1)%points.length];path.quadraticCurveTo(v.x,v.y,(v.x+next.x)*.5,(v.y+next.y)*.5);});
      path.closePath();
      const glass=ctx.createLinearGradient(ax-tx*baseWidth,ay-ty*baseWidth,bx+tx*tipWidth,by+ty*tipWidth);
      glass.addColorStop(0,rgba(colors.light,.1));
      glass.addColorStop(.19,'rgba(255,255,255,.64)');
      glass.addColorStop(.34,rgba(colors.deep,.16));
      glass.addColorStop(.51,rgba(colors.mid,.06));
      glass.addColorStop(.75,'rgba(255,255,255,.42)');
      glass.addColorStop(1,rgba(colors.deep,.08));
      ctx.save();ctx.globalAlpha*=Math.min(1,strength*1.5);ctx.fillStyle=glass;ctx.fill(path);ctx.restore();
    }
    if(recoil>.025){
      for(let j=0;j<4;j++){
        const side=j%2?1:-1,across=side*radius*(.035+j*.018)*(1-recoil*.35);
        const inward=radius*(.015+(1-recoil)*.095);
        droplet(ax-nx*inward-ny*across,ay-ny*inward+nx*across,(1.7+j*.65)*Math.sqrt(recoil),angle,.72*recoil,1.2+recoil*.5);
      }
    }
  }
  function drawDogParticle(x,y,t,p,d,drag){
    if(Number.isFinite(d.wallAngle)&&d.wallOffset){
      const a=d.wallAngle,normal=d.wallOffset.normal||0,tangent=d.wallOffset.tangent||0;
      const r=surfaceRadius(a,t,drag)/90*radius+normal*radius;
      droplet(x+Math.cos(a)*r-Math.sin(a)*tangent*radius,y+Math.sin(a)*r+Math.cos(a)*tangent*radius,d.size,d.angle,d.alpha,d.stretch);
    }else{
      droplet(x+d.x+(p.wallShiftX||0),y+d.y+(p.wallShiftY||0),d.size,d.angle,d.alpha,d.stretch);
    }
  }


  function drawDog(x,y,t,burst=null,suppliedPose=null,drag=[0,0,0]){
    const p=suppliedPose||pose(t),lunge=burst===null?0:ease(clamp(burst/.5,0,1));
    const dissolve=burst===null?p.disperse:ease(clamp((burst-.38)/.25,0,1));
    const alpha=burst===null?p.opacity:1-dissolve;
    const scale=p.scale*(1+lunge*lunge*2.5);
    if(alpha>.01){
      const image=water.render(1,t,dogNodes(t,p.tuck),colors.mid,[0,0,0],waterDogContours(t,p.tuck));
      if(image){
        ctx.save();ctx.globalAlpha*=alpha*(burst===null?.80+(1-p.immersion)*.20:1);ctx.translate(x+p.x*(1-lunge),y+p.y*(1-lunge)-radius*lunge*.1);
        ctx.rotate(p.tilt*(1-lunge));ctx.scale(scale*p.turn,scale*(1-.045*p.tuck));
        ctx.drawImage(image,-110,-110,220,220);ctx.restore();
      }
    }
    if(burst===null){
      for(const d of waterDogParticles(t,radius))drawDogParticle(x,y,t,p,d,drag);
      return;
    }
    // The click lunge keeps its coordinated dissolve into the full-screen impact.
    for(let i=0;i<17;i++){
      const q=(t*.24+i*.071)%1;
      const travel=dissolve===0?q*.25:dissolve;
      const a=i*2.39996,dx=Math.cos(a)*radius*(.13+travel*.52),dy=Math.sin(a)*radius*(.08+travel*.3);
      const fade=(dissolve>.01?(1-dissolve*.65):Math.sin(q*Math.PI)*.42)*(burst===null?1:clamp((1-burst)/.37,0,1));
      droplet(x+p.x+dx-p.direction*radius*.2,y+p.y+dy-radius*.11+travel*travel*radius*.1,(1.6+i%4*.8)*(dissolve>.01?1.6:1),a,.65*fade,1.2+travel*.5);
    }
  }
  // The contact is a one-shot sheet of water, not a persistent ring or bubbles.
  // This is deliberately drawn outside the sphere clip so the plunge breaks its edge.
  function drawImpactSpray(x,y,t,event,drag){
    const age=event.age,life=clamp(1-age/(event.duration||.8),0,1);
    if(life<=0)return;
    const angle=event.angle,nx=Math.cos(angle),ny=Math.sin(angle),tx=-ny,ty=nx;
    const wall=surfaceRadius(angle,t,drag)/90*radius;
    const ax=x+nx*wall,ay=y+ny*wall;
    const rise=Math.sin(Math.min(1,age/.43)*Math.PI);
    const alpha=Math.pow(life,.72);
    ctx.save();ctx.translate(ax,ay);ctx.rotate(angle);
    // Six asymmetric lobes form a broken crown, folding back into the volume.
    for(let side=-1;side<=1;side+=2)for(let j=0;j<3;j++){
      const spread=radius*(.035+age*(.20+j*.075));
      const reach=radius*(.075+j*.028)*rise;
      const root=side*radius*(.018+j*.017),tip=side*spread;
      const crest=reach*(j===1?1.2:.85),sheet=new Path2D();
      sheet.moveTo(-radius*.055,root);
      sheet.bezierCurveTo(-radius*.01,root+side*radius*.035,crest*.4,tip*.55,crest,tip);
      sheet.quadraticCurveTo(crest+radius*.018,tip+side*radius*.025,crest*.73,tip+side*radius*.028);
      sheet.bezierCurveTo(crest*.18,tip*.6,-radius*.05,root+side*radius*.07,-radius*.085,root+side*radius*.055);
      sheet.closePath();
      const g=ctx.createLinearGradient(-radius*.09,0,Math.max(1,crest),0);
      g.addColorStop(0,rgba(colors.mid,.035*alpha));
      g.addColorStop(.36,rgba(colors.deep,.12*alpha));
      g.addColorStop(.58,rgba(colors.light,.10*alpha));
      g.addColorStop(.83,'rgba(255,255,255,'+.72*alpha+')');
      g.addColorStop(1,rgba(colors.deep,.2*alpha));
      ctx.fillStyle=g;ctx.fill(sheet);
    }
    ctx.restore();
    // Short, fast ballistic jets are visible beyond the wall, then fall back.
    for(let i=0;i<30;i++){
      const seed=(i*0.61803398875)%1,side=i%2?1:-1;
      const launch=(i%5)*.007,flight=age-launch;
      if(flight<0)continue;
      const tangent=side*(.04+seed*.09+flight*(.26+(i%7)*.045));
      const normal=flight*(.65+(i%4)*.13)-flight*flight*1.42;
      const px=ax+nx*normal*radius+tx*tangent*radius;
      const py=ay+ny*normal*radius+ty*tangent*radius+flight*flight*radius*.22;
      const size=(1.65+(i%5)*.5)*(.7+.3*life);
      const fade=alpha*clamp(flight/.018,0,1)*clamp((.78-flight)/.18,0,1);
      droplet(px,py,size,angle+Math.PI/2+side*.35,.86*fade,1.2+Math.max(0,.28-flight)*4.5);
    }
  }
  function interaction(dogPose=null,t=0,impacts=[]){
    let energy=0;
    for(let i=0;i<count;i++)energy+=Math.abs(displacement[i]);
    const nearest=Math.round(((pointerAngle/tau+1)%1)*count)%count;
    const contact=dogPose?.contactStrength||0,recoil=dogPose?.contactRecoil||0;
    const lift=contact*(dogPose?.contactKind==='emerge'?-3.2:3.8)+recoil*4.5*Math.sin(t*12);
    const impact=impacts[0];
    return [pointerAngle,displacement[nearest]/Math.max(radius,1)*90,Math.min(2.1,energy/count*.15),impact?.angle??dogPose?.wallAngle??0,lift,impact?.age||0,impact?.strength||0];
  }
  function render(){
    if(!ctx||!radius)return;
    const started=performance.now(),x=centerX+currentCenterX,y=centerY+currentCenterY,t=motionReduced?1.8:elapsed;
    ctx.clearRect(0,0,width,height);
    ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='high';
    const shellAlpha=burstProgress===null?1:1-ease(clamp((burstProgress-.2)/.42,0,1));
    ctx.save();ctx.globalAlpha=shellAlpha;
    // A very soft reflected pool supports the clear suspended volume.
    ctx.save();ctx.translate(x,y+radius*1.06);ctx.scale(1,.075);
    const pool=ctx.createRadialGradient(0,0,0,0,0,radius*.77);pool.addColorStop(0,rgba(colors.deep,.14));pool.addColorStop(1,rgba(colors.deep,0));
    ctx.fillStyle=pool;ctx.beginPath();ctx.arc(0,0,radius*.77,0,tau);ctx.fill();ctx.restore();
    const impacts=!motionReduced&&burstProgress===null?waterDogImpacts(t):[];
    const basePose=pose(t),drag=interaction(burstProgress===null?basePose:null,t,impacts),dogPose=wallAdjustedPose(basePose,t,drag);
    if(shellAlpha>.001)drawInteriorWater(x,y,t,drag,dogPose);
    if(burstProgress===null){
      ctx.save();ctx.clip(liquidContour(x,y,t,drag));
      drawWallMembrane(x,y,t,dogPose,drag);
      drawDog(x,y,t,null,dogPose,drag);
      ctx.restore();
    }
    const size=radius*220/90;
    const sphere=shellAlpha>.001?water.render(0,t,dogNodes(t,0),colors.mid,drag):null;
    if(sphere)ctx.drawImage(sphere,x-size/2,y-size/2,size,size);
    for(const impact of impacts)drawImpactSpray(x,y,t,impact,drag);
    // Beads lift from the moving crest, then return and merge with its water.
    if(!motionReduced)for(let i=0;i<7;i++){
      const age=(t*.23+i*.143)%1,a=-2.35+t*.38+(i%3-1)*.09;
      const lift=Math.sin(age*Math.PI),r=(surfaceRadius(a,t,drag)/90+.12*lift)*radius;
      droplet(x+Math.cos(a)*r,y+Math.sin(a)*r,(2+i%3*.9)*lift,a,.58*lift,1+lift*.3);
    }
    ctx.restore();
    if(burstProgress!==null&&burstProgress<1){
      drawDog(x,y,t,burstProgress);
      if(burstProgress>.38){
        const spread=(burstProgress-.38)/.62;
        for(let i=0;i<39;i++){const a=i*2.39996,d=radius*(.12+spread*(1.6+i%6*.17));droplet(x+Math.cos(a)*d,y+Math.sin(a)*d*.84+spread*spread*48,(2+i%5*1.2)*(1-spread*.4),a+Math.PI/2,(1-spread)*.85,1+spread*1.6);}
      }
    }
    const frameCost=performance.now()-started;
    frameAverage=frameSamples?frameAverage*.9+frameCost*.1:frameCost;
    if(frameSamples++%30===0){container.dataset.orbRenderer=water.mode;container.dataset.orbFrameMs=frameAverage.toFixed(1);container.dataset.orbMotion=motionReduced?'reduced':'full';}
    container.dataset.orbFrameCount=String(frameSamples);
    container.dataset.orbDogPhase=burstProgress===null?(dogPose.phase||'idle'):'burst';
    container.dataset.orbDogHop=String(dogPose.hop??0);container.dataset.orbDogHops=String(dogPose.hops??0);
    container.dataset.orbDogX=dogPose.x.toFixed(1);container.dataset.orbDogY=dogPose.y.toFixed(1);container.dataset.orbDogHidden=String(Boolean(dogPose.hidden));
    container.dataset.orbImpactId=impacts[0]?.id||'';container.dataset.orbImpactAge=impacts.length?impacts[0].age.toFixed(3):'';container.dataset.orbImpactPunch=impacts.length?impacts[0].punch.toFixed(3):'0';
  }

  function animate(time) {
    frame = 0;
    if (destroyed || document.hidden || (!visible && burstStarted === null)) return;
    const seconds = lastFrame ? clamp((time - lastFrame) / 1000, 0, .15) : 1 / 60;
    const delta = clamp(seconds * 60, .2, 2);
    lastFrame = time;
    if (!motionReduced) elapsed += seconds;
    if (burstStarted !== null) {
      burstProgress = clamp((time - burstStarted) / (motionReduced ? 110 : 980), 0, 1);
      if (burstProgress >= 1) {
        burstStarted = null;
        const done = burstResolve;
        burstResolve = null;
        done?.();
      }
    }
    let unsettled = Math.abs(currentCenterX) + Math.abs(currentCenterY) > .1;
    for (let i = 0; i < count; i++) {
      const a = i * tau / count;
      const difference = Math.atan2(Math.sin(a - pointerAngle), Math.cos(a - pointerAngle));
      const desired = pointer === null ? 0 : Math.exp(-difference * difference / .28) * pull - pull * .12;
      const neighbours = (displacement[(i + count - 1) % count] + displacement[(i + 1) % count]) / 2;
      const force = (desired - displacement[i]) * .043 + (neighbours - displacement[i]) * .12;
      velocity[i] = (velocity[i] + force * delta) * Math.pow(.84, delta);
      displacement[i] = clamp(displacement[i] + velocity[i] * delta, -radius * .13, radius * .13);
      if (Math.abs(velocity[i]) + Math.abs(displacement[i]) > .05) unsettled = true;
    }
    currentCenterX += (centerPullX - currentCenterX) * .12 * delta;
    currentCenterY += (centerPullY - currentCenterY) * .12 * delta;
    for (const key of Object.keys(colors)) {
      for (let channel = 0; channel < 3; channel++) {
        const difference = targetColors[key][channel] - colors[key][channel];
        colors[key][channel] += difference * (motionReduced ? 1 : Math.min(1, .08 * delta));
        if (Math.abs(difference) > .1) unsettled = true;
      }
    }
    render();
    if (burstProgress !== 1 && (!motionReduced || pointer !== null || unsettled || burstStarted !== null)) schedule();
  }

  function schedule() {
    if (!destroyed && !frame && !document.hidden && (visible || burstStarted !== null)) frame = requestAnimationFrame(animate);
  }
  function nudge() {
    if (!motionReduced) for (let i = 0; i < count; i++) velocity[i] += Math.sin(i / count * tau * 3 + .7) * 1.9;
    schedule();
  }
  function release() {
    const captured = pointer;
    pointer = null;
    if (captured !== null && container.hasPointerCapture(captured)) container.releasePointerCapture(captured);
    pull = centerPullX = centerPullY = 0;
    container.classList.remove('is-touching');
    schedule();
  }
  function burst() {
    if (destroyed) return Promise.resolve();
    if (burstPromise) return burstPromise;
    release();
    burstStarted = performance.now();
    burstProgress = 0;
    container.classList.add('is-bursting');
    burstPromise = new Promise(resolve => { burstResolve = resolve; });
    schedule();
    if (document.hidden) { burstProgress = 1; burstStarted = null; burstResolve?.(); burstResolve = null; }
    return burstPromise;
  }
  function restore() {
    burstResolve?.();
    burstResolve = burstPromise = burstStarted = burstProgress = null;
    container.classList.remove('is-bursting');
    nudge();
    schedule();
  }
  function updatePointer(event) {
    const box = container.getBoundingClientRect();
    const dx = event.clientX - box.left - centerX, dy = event.clientY - box.top - centerY;
    pointerAngle = Math.atan2(dy, dx);
    pull = clamp(Math.hypot(dx, dy) * .29, 8, radius * .19);
    centerPullX = clamp(dx * .045, -6, 6);
    centerPullY = clamp(dy * .045, -6, 6);
    schedule();
  }
  function pointerDown(event) {
    if ((event.pointerType === 'mouse' && event.button !== 0) || pointer !== null) return;
    pointer = event.pointerId;
    container.setPointerCapture(pointer);
    container.classList.add('is-touching');
    updatePointer(event);
    nudge();
  }
  function pointerMove(event) { if (pointer === event.pointerId) updatePointer(event); }
  function pointerEnd(event) { if (pointer === event.pointerId) release(); }
  function visibilityChange() {
    lastFrame = 0;
    if (document.hidden) {
      if (burstResolve) { burstProgress = 1; burstStarted = null; burstResolve(); burstResolve = null; }
      cancelAnimationFrame(frame);
      frame = 0;
    } else schedule();
  }
  function motionChange(event) {
    motionReduced = event.matches || applicationReducedMotion;
    container.dataset.orbMotion=motionReduced?'reduced':'full';
    lastFrame = 0;
    schedule();
  }
  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(container);
  const intersectionObserver = typeof IntersectionObserver === 'function' ? new IntersectionObserver(entries => {
    visible = entries[0]?.isIntersecting !== false;
    lastFrame = 0;
    if (visible) schedule();
    else if (burstStarted === null) { cancelAnimationFrame(frame); frame = 0; }
  }, { threshold: .01 }) : null;
  intersectionObserver?.observe(container);
  container.addEventListener('pointerdown', pointerDown);
  container.addEventListener('pointermove', pointerMove);
  container.addEventListener('pointerup', pointerEnd);
  container.addEventListener('pointercancel', pointerEnd);
  container.addEventListener('lostpointercapture', pointerEnd);
  document.addEventListener('visibilitychange', visibilityChange);
  media.addEventListener('change', motionChange);
  resize();

  return {
    setTone(nextTone) { targetColors = palettes[nextTone] || palettes.good; schedule(); },
    setReducedMotion(value) {
      applicationReducedMotion = Boolean(value);
      motionReduced = media.matches || applicationReducedMotion;
      container.dataset.orbMotion=motionReduced?'reduced':'full';
      lastFrame = 0;
      schedule();
    },
    nudge, release, burst, restore,
    // Kept as a harmless compatibility hook. Water is now wholly procedural.
    setPuppyImage() { return Promise.resolve(false); },
    destroy() {
      destroyed = true;
      burstResolve?.();
      burstResolve = null;
      cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      intersectionObserver?.disconnect();
      container.removeEventListener('pointerdown', pointerDown);
      container.removeEventListener('pointermove', pointerMove);
      container.removeEventListener('pointerup', pointerEnd);
      container.removeEventListener('pointercancel', pointerEnd);
      container.removeEventListener('lostpointercapture', pointerEnd);
      document.removeEventListener('visibilitychange', visibilityChange);
      media.removeEventListener('change', motionChange);
      container.classList.remove('is-touching', 'is-bursting');
      water.destroy();
      canvas.remove();
    },
  };
}

