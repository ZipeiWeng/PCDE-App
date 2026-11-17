const clamp = v => Math.max(0, Math.min(1, v));
const mix = (a,b,p) => a + (b-a)*p;
const smooth = p => { p=clamp(p); return p*p*(3-2*p); };
const out = p => 1-Math.pow(1-clamp(p),3);
const tau=Math.PI*2;
export const WATER_TRANSITION_DURATION=2080;
/** Staged timings are shared with tests; no full-screen jump occurs at impact. */
export function waterTransitionState(milliseconds){
  const t=Math.max(0,Number.isFinite(milliseconds)?milliseconds:0);
  return {
    lunge:smooth(t/360), impact:smooth((t-260)/350),
    spread:smooth((t-410)/810), coalesce:smooth((t-1220)/740),
    settle:smooth((t-1860)/220), reveal:t>=1220,
    phase:t<260?'lunge':t<610?'impact':t<1220?'spread':t<1860?'coalescence':'settle',
    done:t>=WATER_TRANSITION_DURATION,
  };
}

/** One continuous mass: approach, screen impact, spreading, then two glass panels. */
export async function waterTransition({source,shell,reveal}) {
  if(matchMedia('(prefers-reduced-motion: reduce)').matches ||
    document.documentElement.dataset.motion==='reduced' || document.hidden) { reveal(); return; }
  const box=shell.getBoundingClientRect(),orb=source.getBoundingClientRect();
  if(!box.width||!box.height){reveal();return;}
  const canvas=document.createElement('canvas');
  canvas.className='water-transition';
  canvas.setAttribute('aria-hidden','true');
  canvas.style.cssText='position:fixed;inset:auto;z-index:1000;pointer-events:auto;touch-action:none;left:'+box.left+'px;top:'+box.top+'px;width:'+box.width+'px;height:'+box.height+'px;max-width:none;max-height:none;margin:0;padding:0;border:0;border-radius:'+getComputedStyle(shell).borderRadius+';background:transparent;overflow:hidden;';
  const ratio=Math.min(2,devicePixelRatio||1),w=box.width,h=box.height;
  canvas.width=Math.round(w*ratio);canvas.height=Math.round(h*ratio);
  const ctx=canvas.getContext('2d');
  if(!ctx){reveal();return;}
  ctx.setTransform(ratio,0,0,ratio,0,0);
  document.body.append(canvas);
  let popover=typeof canvas.showPopover==='function';
  if(popover){canvas.setAttribute('popover','manual');try{canvas.showPopover();}catch{popover=false;canvas.removeAttribute('popover');}}
  const origin={x:orb.left+orb.width*.5-box.left,y:orb.top+orb.height*.49-box.top};
  const base=Math.min(orb.width,orb.height)*.35;
  const shellInert=shell.inert;
  shell.inert=true;
  let dialog=null,dialogInert=false,dialogOpacity="",panels=[],panelStyles=[],shown=false,raf=0,deadline=0,finish;
  const preventCancel=event=>event.preventDefault();
  function show(){
    if(shown)return;shown=true;reveal();
    dialog=document.querySelector('dialog#app-sheet.insight-detail[open]');
    if(dialog){
      dialogInert=dialog.inert;dialog.inert=true;dialogOpacity=dialog.style.opacity;if(popover)dialog.style.opacity='0';dialog.addEventListener('cancel',preventCancel);
      panels=[...dialog.querySelectorAll('.insight-panel')].slice(0,2);
      panelStyles=panels.map(panel=>({opacity:panel.style.opacity,visibility:panel.style.visibility}));
      panels.forEach(panel=>{panel.style.opacity='0';});
    }
    if(popover){try{canvas.hidePopover();canvas.showPopover();}catch{popover=false;canvas.removeAttribute('popover');}}
    if(!popover&&dialog){
      const bounds=dialog.getBoundingClientRect();dialog.append(canvas);
      canvas.style.position='absolute';canvas.style.left=(box.left-bounds.left)+'px';canvas.style.top=(box.top-bounds.top+dialog.scrollTop)+'px';
    }
  }
  function contour(rect,round,amplitude,t,seed=0,radial=0){
    const points=[],r=Math.min(round,rect.w*.5,rect.h*.5);
    const corners=[
      [rect.x+rect.w-r,rect.y+r,-Math.PI/2,0],
      [rect.x+rect.w-r,rect.y+rect.h-r,0,Math.PI/2],
      [rect.x+r,rect.y+rect.h-r,Math.PI/2,Math.PI],
      [rect.x+r,rect.y+r,Math.PI,Math.PI*1.5],
    ];
    for(let q=0;q<4;q++){
      const c=corners[q],next=corners[(q+1)%4];
      for(let j=0;j<=12;j++){
        const a=mix(c[2],c[3],j/12);
        points.push([c[0]+Math.cos(a)*r,c[1]+Math.sin(a)*r]);
      }
      const a=c[3],end=[c[0]+Math.cos(a)*r,c[1]+Math.sin(a)*r];
      const start=[next[0]+Math.cos(next[2])*r,next[1]+Math.sin(next[2])*r];
      for(let j=1;j<10;j++)points.push([mix(end[0],start[0],j/10),mix(end[1],start[1],j/10)]);
    }
    const cx=rect.x+rect.w*.5,cy=rect.y+rect.h*.5;
    for(const p of points){
      if(radial>0){
        const a=Math.atan2((p[1]-cy)/(rect.h*.5),(p[0]-cx)/(rect.w*.5));
        // Broad connected fingers, with smaller broken crests between them.
        const fingers=1+.18*Math.sin(a*5+t*.0027)+.075*Math.sin(a*8-t*.0033)+.045*Math.sin(a*13+t*.004);
        p[0]=mix(p[0],cx+Math.cos(a)*rect.w*.5*fingers,radial);
        p[1]=mix(p[1],cy+Math.sin(a)*rect.h*.5*fingers,radial);
      }
      const a=Math.atan2(p[1]-cy,p[0]-cx),wave=amplitude*(Math.sin(a*5+t*.006+seed)+.38*Math.sin(a*11-t*.009));
      p[0]+=Math.cos(a)*wave;p[1]+=Math.sin(a)*wave;
    }
    const path=new Path2D(),last=points[points.length-1],first=points[0];
    path.moveTo((last[0]+first[0])*.5,(last[1]+first[1])*.5);
    points.forEach((p,i)=>{const next=points[(i+1)%points.length];path.quadraticCurveTo(p[0],p[1],(p[0]+next[0])*.5,(p[1]+next[1])*.5);});
    path.closePath();return path;
  }
  function membrane(rect,round,amplitude,t,alpha=1,impact=0,seed=0,radial=0){
    if(alpha<=0)return;
    const path=contour(rect,round,amplitude,t,seed,radial);
    ctx.save();ctx.globalAlpha=alpha;
    // Broad connected translucent surfaces, with refracted light across their volume.
    const body=ctx.createLinearGradient(rect.x-rect.w*.2,rect.y,rect.x+rect.w,rect.y+rect.h);
    body.addColorStop(0,'rgba(255,255,255,.62)');
    body.addColorStop(.16,'rgba(87,115,128,.25)');
    body.addColorStop(.31,'rgba(240,251,255,.34)');
    body.addColorStop(.5,'rgba(221,235,240,.12)');
    body.addColorStop(.69,'rgba(77,108,121,.23)');
    body.addColorStop(.83,'rgba(255,255,255,.55)');
    body.addColorStop(1,'rgba(204,229,238,.21)');
    ctx.fillStyle=body;ctx.fill(path);
    ctx.save();ctx.clip(path);
    // A wide specular light panel folds with the water; it is a filled sheet, not a line.
    const shift=Math.sin(t*.002+seed)*rect.w*.12;
    const sheen=ctx.createLinearGradient(rect.x+shift,rect.y,rect.x+rect.w+shift,rect.y+rect.h*.5);
    sheen.addColorStop(0,'rgba(255,255,255,0)');
    sheen.addColorStop(.22,'rgba(255,255,255,.03)');
    sheen.addColorStop(.37,'rgba(255,255,255,'+(.44+impact*.24)+')');
    sheen.addColorStop(.46,'rgba(255,255,255,.06)');
    sheen.addColorStop(.69,'rgba(57,91,108,.12)');
    sheen.addColorStop(.85,'rgba(255,255,255,.27)');
    sheen.addColorStop(1,'rgba(255,255,255,0)');
    ctx.fillStyle=sheen;ctx.fillRect(rect.x-30,rect.y-30,rect.w+60,rect.h+60);
    // A thick perimeter meniscus gives the mass physical thickness.
    const rim=ctx.createRadialGradient(rect.x+rect.w*.42,rect.y+rect.h*.36,Math.min(rect.w,rect.h)*.13,rect.x+rect.w*.5,rect.y+rect.h*.5,Math.max(rect.w,rect.h)*.61);
    rim.addColorStop(0,'rgba(255,255,255,0)');
    rim.addColorStop(.63,'rgba(255,255,255,0)');
    rim.addColorStop(.83,'rgba(60,97,115,.24)');
    rim.addColorStop(.91,'rgba(255,255,255,.64)');
    rim.addColorStop(.97,'rgba(76,116,134,.3)');
    rim.addColorStop(1,'rgba(255,255,255,.75)');
    ctx.fillStyle=rim;ctx.fillRect(rect.x-40,rect.y-40,rect.w+80,rect.h+80);
    ctx.restore();
    const edge=ctx.createLinearGradient(rect.x,rect.y,rect.x+rect.w,rect.y+rect.h);
    edge.addColorStop(0,'rgba(255,255,255,.96)');edge.addColorStop(.32,'rgba(52,87,106,.42)');
    edge.addColorStop(.58,'rgba(255,255,255,.76)');edge.addColorStop(.84,'rgba(64,103,122,.35)');edge.addColorStop(1,'rgba(255,255,255,.9)');
    ctx.strokeStyle=edge;ctx.lineWidth=2.1;ctx.stroke(path);
    ctx.restore();
  }
  function drop(px,py,size,angle,alpha,stretch=1){
    if(alpha<=0)return;
    ctx.save();ctx.globalAlpha=alpha;ctx.translate(px,py);ctx.rotate(angle);ctx.scale(stretch,1);
    const g=ctx.createRadialGradient(-size*.22,-size*.28,.1,0,0,size);
    g.addColorStop(0,'rgba(255,255,255,.96)');g.addColorStop(.27,'rgba(232,249,255,.08)');
    g.addColorStop(.68,'rgba(55,93,113,.36)');g.addColorStop(.84,'rgba(255,255,255,.89)');g.addColorStop(1,'rgba(75,116,133,.35)');
    ctx.fillStyle=g;ctx.beginPath();ctx.ellipse(0,0,size,size*.68,0,0,tau);ctx.fill();ctx.restore();
  }
  function rayToEdge(angle){
    const dx=Math.cos(angle),dy=Math.sin(angle);
    const horizontal=Math.abs(dx)<1e-6?Infinity:dx>0?(w-origin.x+18)/dx:(-origin.x-18)/dx;
    const vertical=Math.abs(dy)<1e-6?Infinity:dy>0?(h-origin.y+18)/dy:(-origin.y-18)/dy;
    return Math.min(horizontal,vertical);
  }
  function fluidPath(points){
    const path=new Path2D(),last=points[points.length-1],first=points[0];
    path.moveTo((last[0]+first[0])*.5,(last[1]+first[1])*.5);
    points.forEach((p,i)=>{const n=points[(i+1)%points.length];path.quadraticCurveTo(p[0],p[1],(p[0]+n[0])*.5,(p[1]+n[1])*.5);});
    path.closePath();return path;
  }
  function drawExplosion(t){
    if(t<260||t>1510)return;
    // Connected thin jets peel off first, then break into moving droplets.
    // Different launch times and directions avoid a rigid radial starburst.
    for(let i=0;i<11;i++){
      const age=(t-260-i%4*31)/1000;if(age<0||age>.67)continue;
      const a=i*2.399963+.28,travel=out(age/.57),distance=rayToEdge(a)*(.43+(i%3)*.13)*travel;
      const start=base*.08+distance*.18,end=base*.12+distance;
      const width=(11+i%4*3)*(1-travel*.85),bend=Math.sin(i*1.7)*distance*.11;
      ctx.save();ctx.translate(origin.x,origin.y);ctx.rotate(a);
      const jet=new Path2D();jet.moveTo(start,-width*.5);
      jet.bezierCurveTo(start+distance*.22,bend-width,end-distance*.2,bend-width*.6,end,-width*.13);
      jet.quadraticCurveTo(end+width*.7,0,end,width*.15);
      jet.bezierCurveTo(end-distance*.22,bend+width*.4,start+distance*.2,bend+width*.7,start,width*.5);jet.closePath();
      const g=ctx.createLinearGradient(0,-width,0,width);
      g.addColorStop(0,'rgba(255,255,255,.04)');g.addColorStop(.3,'rgba(255,255,255,.62)');
      g.addColorStop(.51,'rgba(73,106,123,.18)');g.addColorStop(.8,'rgba(246,254,255,.42)');g.addColorStop(1,'rgba(255,255,255,.02)');
      ctx.globalAlpha=Math.sin(clamp(age/.67)*Math.PI)*.8;ctx.fillStyle=g;ctx.fill(jet);ctx.restore();
    }
    for(let i=0;i<52;i++){
      const age=(t-285-(i%8)*25)/1000;if(age<0||age>1.02)continue;
      const a=i*2.399963+.16,flight=out(age/.73),edge=rayToEdge(a),distance=edge*(.44+(i%7)*.08)*flight;
      const px=origin.x+Math.cos(a)*distance,py=origin.y+Math.sin(a)*distance+age*age*48;
      const lens=smooth(age/.24),flatten=smooth((age-.4)/.27),fade=(1-smooth((age-.67)/.35));
      drop(px,py,(2.5+i%6*1.3)*(1+lens*.8),a,fade*.82,1.9-flatten*.8);
    }
  }
  function drawApproach(t){
    if(t<240||t>1540)return;
    const state=waterTransitionState(t),spread=state.spread;
    const impact=out((t-240)/340),points=[];
    // The wet front runs along the screen at different speeds. It has lobes,
    // shallow bays and falling fingers, never a circle stretched into a box.
    for(let i=0;i<112;i++){
      const a=i/112*tau,edge=rayToEdge(a);
      const lag=(.5+.5*Math.sin(a*3+.7))*.14+(.5+.5*Math.sin(a*7-1.1))*.06;
      const growth=out(clamp((spread-lag)/(1-lag)));
      const fingers=1+.16*Math.sin(a*5-t*.0023)+.07*Math.sin(a*9+t*.0017);
      const initial=base*(.14+impact*.55)*fingers;
      const reach=mix(initial,edge+14,growth);
      const undulation=(1-growth)*base*.075*Math.sin(a*11+t*.005);
      points.push([origin.x+Math.cos(a)*(reach+undulation),origin.y+Math.sin(a)*(reach+undulation)+Math.sin(a)*impact*(1-growth)*12]);
    }
    const path=fluidPath(points),alpha=clamp((t-240)/100)*(1-smooth((t-1270)/270));
    ctx.save();ctx.globalAlpha=alpha;
    const water=ctx.createLinearGradient(0,h*.14,w,h*.88);
    water.addColorStop(0,'rgba(242,252,255,.30)');water.addColorStop(.23,'rgba(255,255,255,.55)');
    water.addColorStop(.43,'rgba(110,137,147,.19)');water.addColorStop(.65,'rgba(246,252,255,.39)');water.addColorStop(1,'rgba(204,229,235,.27)');
    ctx.fillStyle=water;ctx.fill(path);ctx.save();ctx.clip(path);
    for(let i=0;i<3;i++){
      const shift=(t*.14+i*w*.47)%(w*1.7)-w*.45;
      const g=ctx.createLinearGradient(shift,0,shift+w*.57,h);
      g.addColorStop(0,'rgba(255,255,255,0)');g.addColorStop(.37,'rgba(255,255,255,.02)');
      g.addColorStop(.52,'rgba(255,255,255,.31)');g.addColorStop(.61,'rgba(77,112,128,.08)');g.addColorStop(1,'rgba(255,255,255,0)');
      ctx.fillStyle=g;ctx.fillRect(0,0,w,h);
    }
    ctx.restore();
    const rim=ctx.createLinearGradient(0,0,w,h);rim.addColorStop(0,'rgba(255,255,255,.83)');rim.addColorStop(.31,'rgba(92,129,144,.23)');rim.addColorStop(.58,'rgba(255,255,255,.70)');rim.addColorStop(1,'rgba(84,121,139,.28)');
    ctx.strokeStyle=rim;ctx.lineWidth=1.4;ctx.stroke(path);ctx.restore();
  }
  function targetRect(panel,index){
    if(panel?.isConnected){const r=panel.getBoundingClientRect();return{x:r.left-box.left,y:r.top-box.top,w:r.width,h:r.height};}
    return{x:28,y:h*.26+index*h*.27,w:w-56,h:h*.23};
  }
  function drawCoalescence(t){
    if(!shown||t<1220)return;
    const p=clamp((t-1220)/740),travel=smooth(clamp(p/.80));
    if(dialog&&popover)dialog.style.opacity=String(smooth(clamp(p/.42)));
    const materialFade=1-smooth((p-.69)/.31);
    panels.forEach((panel,index)=>{
      const target=targetRect(panel,index);
      const start=panels.length===1?{x:-w*.04,y:-h*.025,w:w*1.08,h:h*1.05}:{x:-w*.035,y:index===0?-h*.02:h*.47,w:w*1.07,h:h*.57};
      const rect={x:mix(start.x,target.x,travel),y:mix(start.y,target.y,travel),w:mix(start.w,target.w,travel),h:mix(start.h,target.h,travel)};
      const alpha=clamp((t-1220)/90)*materialFade;
      membrane(rect,mix(72,28,travel),22*(1-travel),t,alpha*.86,0,index*2.1,.24*(1-travel));
      // Separate droplets are pulled into the growing panel at the final stage.
      if(p<.75)for(let j=0;j<5;j++){
        const a=j/5*tau+index,r=(1-travel)*Math.min(w,h)*.24;
        drop(rect.x+rect.w*.5+Math.cos(a)*(rect.w*.42+r),rect.y+rect.h*.5+Math.sin(a)*(rect.h*.4+r),5+j*.8,a,(1-p)*.55,1);
      }
      panel.style.opacity=String(smooth((p-.48)/.35));
    });
  }
  const onVisibility=()=>{if(document.hidden)finish?.();};
  const onResize=()=>finish?.();
  try{
    await new Promise(resolve=>{
      let done=false;
      finish=()=>{if(done)return;done=true;cancelAnimationFrame(raf);clearTimeout(deadline);resolve();};
      const start=performance.now();
      function frame(now){
        if(done)return;
        const t=now-start;
        try{
          const state=waterTransitionState(t);canvas.dataset.phase=state.phase;
          if(state.reveal)show();
          ctx.clearRect(0,0,w,h);
          drawApproach(t);drawExplosion(t);drawCoalescence(t);
          if(t<WATER_TRANSITION_DURATION)raf=requestAnimationFrame(frame);else finish();
        }catch{finish();}
      }
      document.addEventListener('visibilitychange',onVisibility);
      window.addEventListener('resize',onResize,{once:true});
      deadline=setTimeout(finish,2600);
      raf=requestAnimationFrame(frame);
    });
  }finally{
    cancelAnimationFrame(raf);clearTimeout(deadline);
    document.removeEventListener('visibilitychange',onVisibility);window.removeEventListener('resize',onResize);
    try{show();}finally{
      panels.forEach((panel,i)=>{panel.style.opacity=panelStyles[i]?.opacity||'';panel.style.visibility=panelStyles[i]?.visibility||'';});
      if(dialog){dialog.style.opacity=dialogOpacity;dialog.inert=dialogInert;dialog.removeEventListener('cancel',preventCancel);}
      shell.inert=shellInert;canvas.remove();
      if(dialog?.open&&!dialogInert){const focus=dialog.querySelector('button,[tabindex="0"]');focus?.focus({preventScroll:true});}
    }
  }
}
