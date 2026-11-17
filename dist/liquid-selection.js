// A single glass surface travels between choices and follows the finger while held.
export function liquidSelectionFrames(from, to) {
  const dx = from.x - to.x, dy = from.y - to.y;
  const sx = from.width / to.width, sy = from.height / to.height;
  const horizontal = Math.abs(dx) >= Math.abs(dy);
  const stretch = Math.min(.065, Math.hypot(dx,dy) / Math.max(to.width,to.height) * .03);
  const transform = (x,y,w,h) => `translate(${x}px, ${y}px) scale(${w}, ${h})`;
  return [
    { transform:transform(dx,dy,sx,sy), offset:0 },
    { transform:transform(dx*.52,dy*.52,1+(sx-1)*.52+(horizontal?stretch:-stretch*.3),1+(sy-1)*.52+(horizontal?-stretch*.3:stretch)), offset:.48 },
    { transform:transform(dx*.07,dy*.07,1+(sx-1)*.07,1+(sy-1)*.07), offset:.8 },
    { transform:transform(-dx*.009,-dy*.009,horizontal?.996:1.004,horizontal?1.004:.996), offset:.92 },
    { transform:'translate(0px, 0px) scale(1, 1)', offset:1 },
  ];
}

export function createLiquidSelection(root, groups) {
  const doc=root?.ownerDocument, win=doc?.defaultView;
  if(!doc?.createElement || !win?.getComputedStyle) return {capture(){},sync(){},destroy(){}};
  const states=new Map();
  let captured=new Map(), resizeFrame=0, destroyed=false, gesture=null, suppressUntil=0, revision=0;
  const reduced=()=>win.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const now=()=>win.performance?.now?.() || Date.now();
  const keyFor=(target,config)=>config.key?.(target) || target.id || target.getAttribute('data-section') || target.getAttribute('data-card-filter') || target.getAttribute('data-background') || target.getAttribute('data-language') || target.getAttribute('data-plan') || target.previousElementSibling?.value || target.textContent.trim();
  function geometry(element,group) {
    const box=element.getBoundingClientRect(),base=group.getBoundingClientRect();
    return {x:box.left-base.left+group.scrollLeft-group.clientLeft,y:box.top-base.top+group.scrollTop-group.clientTop,width:box.width,height:box.height};
  }
  function place(surface,box) {
    Object.assign(surface.style,{left:`${box.x}px`,top:`${box.y}px`,width:`${box.width}px`,height:`${box.height}px`});
  }
  function disabled(choice) {
    const input=choice.closest?.('label')?.querySelector('input');
    return !!(choice.disabled || choice.matches?.(':disabled') || choice.getAttribute('aria-disabled')==='true' || input?.disabled || input?.matches?.(':disabled'));
  }
  function axisFor(choices,group) {
    const boxes=choices.map(choice=>geometry(choice,group));
    const xs=boxes.map(box=>box.x+box.width/2),ys=boxes.map(box=>box.y+box.height/2);
    return Math.max(...xs)-Math.min(...xs) >= Math.max(...ys)-Math.min(...ys) ? 'x' : 'y';
  }
  function clearState(state) {
    state.animation?.cancel();state.surface.remove();
    state.group.removeAttribute('data-liquid-ready');state.group.removeAttribute('data-liquid-drag-axis');state.group.removeAttribute('data-liquid-dragging');state.group.removeAttribute('data-liquid-scrollable');
    state.group.querySelectorAll('.liquid-choice').forEach(choice=>choice.classList.remove('liquid-choice','liquid-selected'));
    observer?.unobserve(state.group);
  }
  function capture() {
    captured=new Map();
    for(const [id,state] of states) {
      if(!state.group.isConnected)continue;
      captured.set(id,{...geometry(state.surface,state.group),key:state.key,scrollLeft:state.group.scrollLeft,scrollTop:state.group.scrollTop,moving:state.animation?.playState==='running'||state.dragging});
      state.animation?.cancel();state.animation=null;
    }
  }
  function sync({animate=true}={}) {
    if(destroyed)return;
    revision++;
    for(const config of groups) {
      const group=root.querySelector(config.group),selected=group?.querySelector(config.selected);
      let state=states.get(config.id);
      if(!group || !selected) {if(state)clearState(state);states.delete(config.id);continue;}
      const previous=captured.get(config.id);
      if(previous && state?.group!==group) {group.scrollLeft=previous.scrollLeft;group.scrollTop=previous.scrollTop;}
      const target=geometry(selected,group);
      if(!(target.width>0 && target.height>0))continue;
      if(state?.group!==group) {
        if(state)clearState(state);
        const surface=doc.createElement('span');surface.className='liquid-selection-surface';surface.setAttribute('aria-hidden','true');
        group.append(surface);state={group,surface,key:'',animation:null,width:group.getBoundingClientRect().width};states.set(config.id,state);observer?.observe(group);
      }
      group.setAttribute('data-liquid-ready','');
      const choices=[...group.querySelectorAll(config.choices || 'button')];
      choices.forEach(choice=>{choice.classList.add('liquid-choice');choice.classList.toggle('liquid-selected',choice===selected);});
      state.choices=choices;state.selected=selected;state.axis=axisFor(choices,group);state.config=config;
      group.setAttribute('data-liquid-drag-axis',state.axis);
      state.scrollable=state.axis==='x' && group.scrollWidth>group.clientWidth+1;
      if(state.scrollable)group.setAttribute('data-liquid-scrollable','');else group.removeAttribute('data-liquid-scrollable');
      // A resize/render must not fight a finger that is still holding this group.
      if(gesture?.state===state && gesture.started)continue;
      const key=keyFor(selected,config);
      place(state.surface,target);state.surface.style.borderRadius=win.getComputedStyle(selected).borderRadius;
      state.animation?.cancel();state.animation=null;state.dragging=false;
      if(animate && !reduced() && previous && (previous.key!==key || previous.moving) && state.surface.animate) {
        state.animation=state.surface.animate(liquidSelectionFrames(previous,target),{duration:720,easing:'cubic-bezier(.35,.08,.2,1)',fill:'none'});
      }
      state.key=key;state.width=group.getBoundingClientRect().width;
    }
    captured.clear();
  }
  function releaseCapture(current) {
    current?.state.group.removeAttribute('data-liquid-dragging');
    if(current && root.hasPointerCapture?.(current.id))root.releasePointerCapture(current.id);
  }
  function finish(commit=false) {
    const current=gesture;if(!current)return;
    gesture=null;
    if(!current.started){releaseCapture(current);return;}
    suppressUntil=now()+500;
    capture();releaseCapture(current);
    const before=revision;
    if(commit && current.target && current.target!==current.state.selected && !disabled(current.target) && current.state.group.isConnected)current.target.click();
    // Native handlers may already have rendered the destination, including radios.
    if(revision===before)sync();
  }
  function down(event) {
    if(destroyed || gesture || event.isPrimary===false || event.button!==0)return;
    // A fresh deliberate press must never inherit the previous drag's click shield.
    suppressUntil=0;
    const state=[...states.values()].find(item=>item.choices?.some(choice=>choice===event.target || choice.contains?.(event.target)));
    if(!state || !state.group.isConnected)return;
    const choice=state.choices.find(item=>item===event.target || item.contains?.(event.target));
    if(!choice || disabled(choice) || (state.axis==='y' || state.scrollable) && choice!==state.selected)return;
    gesture={id:event.pointerId,state,x:event.clientX,y:event.clientY,started:false,rejected:false,target:state.selected,originChoice:choice};
  }
  function move(event) {
    const current=gesture;
    if(!current || event.pointerId!==current.id || current.rejected)return;
    const {state}=current;
    if(!state.group.isConnected || disabled(state.selected)){finish(false);return;}
    const dx=event.clientX-current.x,dy=event.clientY-current.y;
    const distance=state.axis==='x'?dx:dy,cross=state.axis==='x'?dy:dx;
    if(!current.started) {
      if(Math.max(Math.abs(distance),Math.abs(cross))<8)return;
      if(Math.abs(distance)<=Math.abs(cross)*1.25){current.rejected=true;return;}
      current.started=true;state.dragging=true;
      // Finger travel is anchored to the pressed option, even during a prior animation.
      current.base=geometry(current.originChoice,state.group);
      state.animation?.cancel();state.animation=null;
      state.group.setAttribute('data-liquid-dragging','');
      try{root.setPointerCapture?.(current.id);}catch{}
    }
    if(event.cancelable)event.preventDefault();
    const choices=state.choices.filter(choice=>!disabled(choice)).map(choice=>({choice,box:geometry(choice,state.group)}));
    if(!choices.length){finish(false);return;}
    const {base}=current,axis=state.axis,size=axis==='x'?'width':'height';
    const centers=choices.map(({box})=>box[axis]+box[size]/2);
    const desired=base[axis]+base[size]/2+distance;
    const center=Math.max(Math.min(...centers),Math.min(Math.max(...centers),desired));
    const box={...base,[axis]:center-base[size]/2};
    place(state.surface,box);
    current.target=choices.reduce((best,item)=>Math.abs(item.box[axis]+item.box[size]/2-center)<Math.abs(best.box[axis]+best.box[size]/2-center)?item:best).choice;
  }
  function up(event) {if(gesture?.id===event.pointerId){move(event);finish(true);}}
  function cancel(event) {if(!event.pointerId || gesture?.id===event.pointerId)finish(false);}
  function otherPointer(event) {if(gesture && event.pointerId!==gesture.id)finish(false);}
  // Touch browsers transfer implicit capture from the pressed child to this root.
  function lostCapture(event) {if(event.target===root)cancel(event);}
  // Capturing blur also sees button focus changes; only leaving the window cancels.
  function windowBlur(event) {if(!event.target || event.target===win)finish(false);}
  function preventNativeDrag(event) {
    if([...states.values()].some(state=>state.choices?.some(choice=>choice===event.target || choice.contains?.(event.target))))event.preventDefault();
  }
  function click(event) {if(event.detail!==0 && now()<suppressUntil){suppressUntil=0;event.preventDefault();event.stopImmediatePropagation();}}
  const bindings=[[root,'pointerdown',down],[root,'dragstart',preventNativeDrag],[root,'click',click],[root,'lostpointercapture',lostCapture],[win,'pointermove',move],[win,'pointerup',up],[win,'pointercancel',cancel],[win,'pointerdown',otherPointer],[win,'blur',windowBlur]];
  bindings.forEach(([target,type,handler])=>target.addEventListener?.(type,handler,true));
  const onResize=()=>{if(!resizeFrame)resizeFrame=win.requestAnimationFrame(()=>{resizeFrame=0;sync({animate:false});});};
  let observedWidth=root.getBoundingClientRect().width;
  const observer=win.ResizeObserver ? new win.ResizeObserver(()=>{
    const width=root.getBoundingClientRect().width;let changed=width!==observedWidth;observedWidth=width;
    for(const state of states.values())if(state.group.isConnected){const groupWidth=state.group.getBoundingClientRect().width;if(groupWidth!==state.width){state.width=groupWidth;changed=true;}}
    if(changed)onResize();
  }) : null;
  observer?.observe(root);win.addEventListener('resize',onResize);
  return {capture,sync,destroy(){destroyed=true;const current=gesture;gesture=null;releaseCapture(current);observer?.disconnect();win.removeEventListener('resize',onResize);bindings.forEach(([target,type,handler])=>target.removeEventListener?.(type,handler,true));if(resizeFrame)win.cancelAnimationFrame(resizeFrame);for(const state of states.values())clearState(state);states.clear();}};
}
