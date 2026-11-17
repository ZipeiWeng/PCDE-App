import { onboardingSteps, nextTourStep } from './onboarding-flow.js';
export { onboardingSteps, nextTourStep } from './onboarding-flow.js';
import { coachVisual } from './onboarding-motion.js';
import { coachCopy } from './onboarding-copy.js';
import { createOnboardingGuard } from './onboarding-guard.js';
import { colourLesson, advanceColourLesson, colourTapAction } from './onboarding-colours.js';
import { advanceExploration, canExplorePage, explorationComplete, activityScrollComplete } from './onboarding-exploration.js';
import { placeCoachNote, placeActivityCoach, placeAlertCoach } from './onboarding-position.js';
import { isOnboardingTextEntry, onboardingInputPolicy } from './onboarding-input-policy.js';
export { placeCoachNote } from './onboarding-position.js';
const icon = name => `<svg class="icon" aria-hidden="true"><use href="#i-${name}"/></svg>`;
const clamp = (value,min,max) => Math.max(min,Math.min(max,value));
const escapeText = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

// The guide owns one out-of-flow top-layer surface. Nothing is inserted into
// a card, a scroll region, or the home layout to make space for annotations.
export function createOnboarding({shell,getLanguage=()=> 'en',getNeedsConnection=()=>false,showPage,getPage,onStep=()=>{},onFinish=()=>{},restore}) {
  const doc=shell.ownerDocument,win=doc.defaultView;
  let active=false,id='score',returnPage=1,returnFocus,layer,host,target,note,arrow,frame,observer,mutation,oldDescription=null;
  let trackUntil=0,preparing=false,rendering=false,entering=false,epoch=0,composing=false,layoutHeight=0,opened=false,needsConnection=false,interactionGuard,colourProgress=0,lastColourTap=-Infinity,clinicIntroduced=false,exploration=0,activityReviewed=false;
  const expanded=new Map(),scrollPositions=new Map(),lang=()=>getLanguage()==='zh'?'zh':'en';
  const steps=()=>onboardingSteps(lang(),{needsConnection});
  const current=()=>{
    const def=steps().find(item=>item.id===id),zh=lang()==='zh';
    if(!def)return def;
    const back={home:false,event:'continue',continueLabel:zh?'返回主页':'Back to home',dismiss:true};
    if(id==='score'&&doc.querySelector('#app-sheet[open]')){
      return {...def,home:false,target:'#app-sheet .insight-data-summary',label:zh?'了解当前健康状态':'Understand their current health',description:zh?'查看读数变化、可能原因与下一步建议。':'See what changed, possible causes and what to do next.',visual:undefined,gesture:undefined,event:'continue',continueLabel:zh?'查看警报示例':'See alert example',dismiss:false};
    }
    if(id==='score'){const lesson=colourLesson(colourProgress,lang());return {...def,...lesson,event:lesson.complete?'health-open':'orb-tap',visual:lesson.complete?'tap':'colours',gesture:lesson.complete?'tap':undefined,dismiss:false};}
    if(id==='red-alert'&&doc.querySelector('#app-sheet.insight-alert[open]'))return {...def,home:false,target:'[data-find-vet]',visual:undefined,gesture:'tap',event:'vet',separateAlertHeading:true};
    if(id==='red-alert'&&doc.querySelector('#app-sheet[open] .vet-search-form'))return {...def,target:'.vet-search-form',label:zh?'查找附近医院':'Find a nearby clinic',description:zh?'输入城市或邮编，也可以直接使用示例。':'Enter a town or postcode, or use an example.',allow:'.vet-search-form',visual:'search',skipAction:'vet-example',skipLabel:zh?'使用示例':'Use example'};
    if(id==='vet-results'&&clinicIntroduced)return {...def,target:'#sheet-close',label:zh?'向右滑，返回主页':'Swipe right to return home',description:zh?'也可以点右上角 × 返回。':'Or use × at the top right.',visual:'swipe',gesture:'return',dismiss:true};
    if(id==='vet-results'&&doc.querySelector('#app-sheet.vet-detail-sheet'))return {...def,target:'.vet-clinic h3',label:zh?'医院详情，集中在这里':'Clinic details in one place',description:zh?'地址、电话和评价。可返回列表继续比较。':'Address, contact and reviews. Go back to compare clinics.',visual:'clinic',event:'continue',continueLabel:zh?'知道了':'Got it'};
    if(id==='device'&&!doc.querySelector('#settings-screen')?.hidden){
      const deviceBack={...back,skipEvent:undefined,skipLabel:undefined,continueLabel:zh?'体验健康示例':'Try the health demo'};
      if(doc.querySelector('#settings-screen[data-section="connect"]')){
        const connection=doc.querySelector('.settings-connect-card')?.dataset.connectionStatus;
        if(connection==='demo')return {...def,...deviceBack,target:'.settings-connect-card h2',label:zh?'示例已经准备好了':'Your demo is ready',description:zh?'用示例读数，了解健康功能。':'Explore the health features with sample readings.',visual:'connect'};
        if(connection==='connected')return {...def,...deviceBack,target:'.settings-connect-card h2',label:zh?'项圈已连接':'Your collar is connected',description:zh?'收到实际读数后才能显示健康状态。现在可以先体验示例。':'Health status needs actual readings. You can explore an example while you wait.',visual:'connect'};
        const demo=doc.querySelector('[data-pair]')?.disabled;
        return {...def,...deviceBack,target:demo?'[data-connect-demo]':'[data-pair]',label:zh?'连接项圈，或先体验':'Connect, or try the demo',description:demo?(zh?'此浏览器暂不支持蓝牙，可先体验示例。':'Bluetooth is unavailable here. You can explore the demo.'):(zh?'项圈开机并靠近手机，然后点 Choose device。':'Power on your collar, keep it nearby, then Choose device.'),visual:'connect'};
      }
      return {...def,...deviceBack,target:'[data-connect]',label:zh?'在这里连接项圈':'Connect your collar here',description:zh?'点 Connect。将项圈开机，放在手机附近。':'Tap Connect. Turn on the collar and keep it nearby.',visual:'connect'};
    }
    if(id==='card'&&!doc.querySelector('#card-screen')?.hidden)return {...def,...back,target:'#card-screen [data-summary-module] summary',label:zh?'健康记录，都在这里':'Their health history, together',description:zh?'试着点标题收起记录。以后可用 Scan 或 Add 添加。':'Try folding a heading. Later, use Scan or Add for new records.',visual:'fold',prepareSummary:true};
    if(id==='profile'&&!doc.querySelector('#settings-screen')?.hidden){
      const section=doc.querySelector('#settings-screen')?.dataset.section;
      const settings={...def,...back,target:'#settings-sidebar',label:zh?'按你的喜好调整':'Make Pawprint yours',description:zh?'宠物资料、背景、语言与订阅都在这里。试着点侧栏选项。':'Pet details, backgrounds, language and plans live here. Try a sidebar option.',visual:'settings'};
      const copy={preferences:[zh?'自定义背景':'Background options',zh?'这里可以设置图片、磨砂度与爪印暗纹。':'Photo, frost level and paw pattern settings live here.','settings'],language:[zh?'显示语言':'App language',zh?'语言会应用到整个 App。':'Your choice applies throughout the app.',''],subscription:[zh?'订阅与价格':'Plans and pricing',zh?'在这里查看 Plus 功能与年费。':'See Plus features and the annual price here.','']};
      if(copy[section])return {...settings,target:'.settings-topbar h1',label:copy[section][0],description:copy[section][1],visual:copy[section][2]};
      return settings;
    }
    if(id==='explore'&&getPage()===0)return {...def,done:false,target:'#data-screen .screen-scroll',label:activityReviewed?(zh?'向右滑，认识 AI 助手':'Swipe right for your assistant'):(zh?'向下浏览 Activity':'Scroll down to explore'),description:activityReviewed?(zh?'已浏览到底部，继续看看对话功能。':'You’ve reached the end. Try a conversation next.'):(zh?'查看目标、趋势、睡眠与提醒。':'See goals, trends, sleep and alerts.'),visual:'activity-scroll',navigation:activityReviewed};
    if(id==='explore'&&getPage()===2)return {...def,done:explorationComplete(exploration,2),target:'.companion-input-controls',label:zh?'这是你的 AI 助手':'Your AI companion',description:zh?'用语音或文字提问，了解健康变化、整理记录。':'Speak or type to understand changes and organize records.',visual:'explore-page'};
    if(id==='device'&&!opened)return {...def,event:def.entry.type,dismiss:false,label:zh?'先连接你的项圈':'First, connect your collar',description:zh?'点右上角的设备按钮，连接项圈。':'Tap the Device button at the top right to connect.'};
    if(id==='explore')return {...def,done:false,label:zh?'向右滑，查看活动页':'Swipe right for Activity',description:zh?'向右滑动屏幕，查看每天的活动数据。':'Swipe across the screen to see their daily readings.'};
    return def.entry&&!opened?{...def,event:def.entry.type,dismiss:false}:def;
  };
  const inputPolicy=()=>onboardingInputPolicy({editableFocused:isOnboardingTextEntry(doc.activeElement||{}),composing,layoutHeight:Math.max(layoutHeight,doc.documentElement.clientHeight),viewportHeight:win.visualViewport?.height||win.innerHeight,dismissible:Boolean(current()?.dismiss)});
  const supportsPopover=()=>typeof layer?.showPopover==='function';
  function clearTarget(){
    if(target){if(oldDescription===null)target.removeAttribute('aria-describedby');else target.setAttribute('aria-describedby',oldDescription);}
    target=null;oldDescription=null;
  }
  function attach(){
    const next=doc.querySelector('#app-sheet[open]')||shell;
    if(host!==next||!layer.isConnected){
      if(supportsPopover()&&layer.matches(':popover-open'))layer.hidePopover();
      host=next;host.append(layer);
    }
    if(supportsPopover()&&!layer.matches(':popover-open'))layer.showPopover();
  }
  function bounds(){
    const box=shell.getBoundingClientRect(),viewport=win.visualViewport;
    layer.style.borderRadius=win.getComputedStyle(shell).borderRadius;
    const left=Math.max(box.left,viewport?.offsetLeft||0),top=Math.max(box.top,viewport?.offsetTop||0);
    const right=Math.min(box.right,(viewport?.offsetLeft||0)+(viewport?.width||win.innerWidth));
    const bottom=Math.min(box.bottom,(viewport?.offsetTop||0)+(viewport?.height||win.innerHeight));
    if(supportsPopover())Object.assign(layer.style,{left:`${left}px`,top:`${top}px`,width:`${Math.max(0,right-left)}px`,height:`${Math.max(0,bottom-top)}px`});
    else {const parent=host.getBoundingClientRect();Object.assign(layer.style,{left:`${left-parent.left}px`,top:`${top-parent.top+host.scrollTop}px`,width:`${right-left}px`,height:`${bottom-top}px`});}
    return layer.getBoundingClientRect();
  }
  function localRect(node,base){
    const r=node?.getBoundingClientRect();if(!r||!r.width||!r.height)return null;
    return {left:r.left-base.left,right:r.right-base.left,top:r.top-base.top,bottom:r.bottom-base.top,width:r.width,height:r.height};
  }
  function focusRect(node,base){
    let r=localRect(node,base);if(!r)return null;
    // Large record sections are introduced at their own heading; the section
    // itself remains untouched and retains its normal scrolling/expansion.
    if(r.height>base.height*.5&&node.id!=='wellness-orb'){
      const heading=node.querySelector('summary,h2,h3,.vet-results-heading');
      const h=localRect(heading,base);if(h)r={...h,bottom:h.bottom+8,height:h.height+8};
      else r={...r,bottom:r.top+Math.min(180,r.height),height:Math.min(180,r.height)};
    }
    return r;
  }
  function position(){
    if(!active||rendering||!layer)return;
    attach();
    const base=bounds(),def=current();
    const next=doc.querySelector(def.target);
    if(target!==next){clearTarget();target=next;if(target){oldDescription=target.getAttribute('aria-describedby');target.setAttribute('aria-describedby',[oldDescription,'coach-action-label'].filter(Boolean).join(' '));}}
    const targetRect=id==='explore'&&def.visual==='explore-page'?localRect(target,base):focusRect(target,base),width=base.width,height=base.height;
    const editing=inputPolicy();layer.dataset.editing=String(editing.editing||editing.keyboardOpen);
    const endButton=layer.querySelector('[data-coach-skip]');if(endButton)endButton.hidden=!editing.showEndTour;
    const centred=['welcome','swipe','clinic','connect','records','settings','activity','complete'].includes(def.visual)&&!['vet-results','device','card','profile'].includes(id);
    const modalRect=host===shell?null:localRect(host,base);
    const compactModal=modalRect&&modalRect.height<height*.6;
    const r=compactModal&&!def.separateAlertHeading?modalRect:targetRect;
    if(width<1||height<1)return;
    const hint=layer.querySelector('.coach-interaction-hint');
    if(hint){
      const hintWidth=Math.min(300,width-44),header=localRect(doc.querySelector('.app-topbar'),base);
      hint.style.width=`${hintWidth}px`;
      Object.assign(hint.style,{left:`clamp(22px, ${((r?.left||0)+(r?.right||width)-hintWidth)/2}px, ${width-hintWidth-22}px)`,top:`${Math.max((header?.bottom||0)+10,(r?.top||0)-hint.getBoundingClientRect().height-18)}px`});
    }
    note.style.width=`${Math.min(300,width-44)}px`;
    const noteHeight=note.getBoundingClientRect().height;
    const obstacleRoot=host===shell?shell:host;
    const obstacles=[...obstacleRoot.querySelectorAll('h1,h2,h3,p,label,summary,button,span:not(:has(*)),.metric-value,.metric-label,.app-topbar,.page-dots,.companion-empty:not([hidden]),.companion-text-composer:not([hidden])')]
      .filter(node=>!node.closest('.coach-layer,[hidden],[inert]')&&!node.closest('.screen[aria-hidden="true"]')&&node!==target&&!node.contains(target)&&win.getComputedStyle(node).visibility!=='hidden')
      .map(node=>localRect(node,base)).filter(rect=>rect&&rect.bottom>0&&rect.top<height&&rect.right>0&&rect.left<width);
    if(hint)obstacles.push(localRect(hint,base));
    const toolbar=localRect(layer.querySelector('.coach-toolbar'),base);
    const measured=r||{left:width/2-12,right:width/2+12,top:height/2-12,bottom:height/2+12};
    let placement=centred?{left:(width-Math.min(300,width-44))/2,top:clamp(height*.46-noteHeight/2,70,Math.max(70,height-noteHeight-68)),width:Math.min(300,width-44)}:placeCoachNote({width,height,target:measured,noteWidth:Math.min(300,width-44),noteHeight,obstacles:editing.editing?[measured]:obstacles,gap:id==='score'?12:32,bottomInset:toolbar?height-toolbar.top+8:48,preferredSide:compactModal||id==='score'&&def.home?'below':def.home?'above':undefined});
    const dots=id==='explore'?localRect(doc.querySelector('.page-dots'),base):null;
    if(def.separateAlertHeading){
      const heading=layer.querySelector('.coach-alert-title');
      heading.style.width=`${Math.min(300,width-44)}px`;
      const alertPlacement=placeAlertCoach({width,height,target:targetRect||measured,headingHeight:heading.getBoundingClientRect().height,noteHeight,bottomInset:toolbar?height-toolbar.top+8:64});
      Object.assign(heading.style,{left:`${alertPlacement.heading.left}px`,top:`${alertPlacement.heading.top}px`,visibility:alertPlacement.heading.visible?'':'hidden'});
      placement=alertPlacement.note;
    }else if(def.visual==='activity-scroll'){
      note.style.width=`${Math.min(350,width-40)}px`;
      placement=placeActivityCoach({width,height,dotsTop:dots?.top,noteHeight:note.getBoundingClientRect().height});
      layer.style.setProperty('--activity-coach-band',`${height-placement.top+28}px`);
      shell.style.setProperty('--activity-coach-clearance',`${Math.max(30,height-placement.top-28)}px`);
    }else if(def.visual==='explore-page'){
      const availableBottom=(dots?.top||height-60)-36;
      const candidate=getPage()===0?(targetRect?.bottom||height*.7)+10:(targetRect?.top||height*.65)-noteHeight-24;
      placement={left:(width-Math.min(300,width-44))/2,top:clamp(candidate,96,Math.max(96,availableBottom-noteHeight)),width:Math.min(300,width-44)};
    }
    Object.assign(note.style,{left:`${placement.left}px`,top:`${placement.top}px`});
    if(def.visual==='activity-scroll'&&!activityReviewed){
      const scroll=doc.querySelector('#data-screen .screen-scroll');
      if(scroll&&activityScrollComplete(scroll)){activityReviewed=true;render(false);return;}
    }
    const focus=layer.querySelector('.coach-focus');
    focus.setAttribute('viewBox',`0 0 ${width} ${height}`);
    const cutout=focus.querySelector('[data-focus-window]');
    const fr=r||measured,pad=10;
    cutout.setAttribute('rx',target?.id==='wellness-orb'?Math.min(fr.right-fr.left,fr.bottom-fr.top)/2+pad:24);
    cutout.style.display=def.visual==='activity-scroll'||centred&&!def.dismiss?'none':'';
    const dock=focus.querySelector('#coach-activity-dock');
    if(def.visual==='activity-scroll'){dock.setAttribute('y1',placement.top-28);dock.setAttribute('y2',height);}
    layer.querySelector('[data-coach-shade]').setAttribute('fill',def.visual==='activity-scroll'?'url(#coach-activity-dock)':id==='welcome'?'#080c10':'#15212c');
    layer.querySelector('[data-coach-shade]').setAttribute('fill-opacity',def.visual==='activity-scroll'?'1':id==='welcome'?'.65':def.visual==='explore-page'?'.4':centred?'.82':'.72');
    const gesture=layer.querySelector('.coach-gesture');
    if(gesture){Object.assign(gesture.style,{left:`${width/2}px`,top:`${clamp((fr.top+fr.bottom)/2,130,height-160)}px`});}
    for(const [key,value] of Object.entries({x:fr.left-pad,y:fr.top-pad,width:Math.max(0,fr.right-fr.left+pad*2),height:Math.max(0,fr.bottom-fr.top+pad*2)}))cutout.setAttribute(key,value);
    const dotsWindow=focus.querySelector('[data-dots-window]');
    const activeDot=id==='explore'?localRect(doc.querySelector('.page-dots [aria-current="page"]'),base):null;
    if(dotsWindow){dotsWindow.style.display=activeDot?'':'none';if(activeDot)for(const [key,value] of Object.entries({x:activeDot.left+activeDot.width/2-18,y:activeDot.top+activeDot.height/2-18,width:36,height:36}))dotsWindow.setAttribute(key,value);}
    const location=layer.querySelector('.coach-page-location');
    if(location&&dots)Object.assign(location.style,{left:`${width/2}px`,top:`${dots.top-25}px`});
    layer.style.visibility=host.inert?'hidden':'';
    arrow.hidden=true;
    if(!r||r.top>=height-30||r.bottom<=0||def.done||centred||def.visual==='explore-page'||def.visual==='activity-scroll'||def.visual==='tap'||editing.editing)return;
    const n={left:placement.left,right:placement.left+placement.width,top:placement.top,bottom:placement.top+noteHeight};
    const clipped={left:clamp(r.left,12,width-12),right:clamp(r.right,12,width-12),top:clamp(r.top,8,height-42),bottom:clamp(r.bottom,8,height-42)};
    let start,end;
    if(n.bottom+8<clipped.top){const x=clamp((clipped.left+clipped.right)/2,n.left+20,n.right-20);start={x,y:n.bottom+5};end={x:clamp(x,clipped.left+8,clipped.right-8),y:clipped.top-7};}
    else if(n.top>clipped.bottom+8){const x=clamp((clipped.left+clipped.right)/2,n.left+20,n.right-20);start={x,y:n.top-5};end={x:clamp(x,clipped.left+8,clipped.right-8),y:clipped.bottom+7};}
    else if(n.left>clipped.right+8){start={x:n.left-6,y:(n.top+n.bottom)/2};end={x:clipped.right+7,y:clamp(start.y,clipped.top+8,clipped.bottom-8)};}
    else if(n.right+8<clipped.left){start={x:n.right+6,y:(n.top+n.bottom)/2};end={x:clipped.left-7,y:clamp(start.y,clipped.top+8,clipped.bottom-8)};}
    if(!start||!end)return;
    const distance=Math.hypot(end.x-start.x,end.y-start.y);if(distance<15||distance>190)return;
    // A short curved pointer, never a ring or a box around the water.
    arrow.hidden=false;arrow.setAttribute('viewBox',`0 0 ${width} ${height}`);
    const bend=Math.min(18,distance*.16);
    arrow.querySelector(':scope > path').setAttribute('d',`M ${start.x} ${start.y} Q ${(start.x+end.x)/2+bend} ${(start.y+end.y)/2} ${end.x} ${end.y}`);
  }
  function tick(){frame=null;if(!active)return;position();if(win.performance.now()<trackUntil)frame=win.requestAnimationFrame(tick);}
  function schedule(duration=0){if(Number.isFinite(duration)&&duration>0)trackUntil=Math.max(trackUntil,win.performance.now()+duration);if(frame==null)frame=win.requestAnimationFrame(tick);}
  function rememberScroll(node){if(node&&!scrollPositions.has(node))scrollPositions.set(node,{top:node.scrollTop,left:node.scrollLeft});}
  function prepareTarget(def){
    preparing=true;
    if(def.prepareSummary){const summary=doc.querySelector('[data-card-tab="overview"]');if(summary?.getAttribute('aria-selected')==='false')summary.click();}
    if(def.ensureOpen){const section=doc.querySelector(`#card-screen [data-summary-module="${def.ensureOpen}"]`);if(section){if(!expanded.has(section))expanded.set(section,section.open);section.open=true;}}
    const node=doc.querySelector(def.target);
    let details=node?.parentElement?.closest('details');
    while(details){if(!expanded.has(details))expanded.set(details,details.open);if(def.event!=='module-toggle')details.open=true;details=details.parentElement?.closest('details');}
    const scroll=node?.closest('.settings-content,.card-scroll,.screen-scroll,.app-sheet');
    rememberScroll(scroll);
    if(node&&!def.home){
      if(def.dismiss&&['#sheet-close','#card-back','[data-settings-close]'].includes(def.target)){if(host!==shell)host.scrollTop=0;if(scroll)scroll.scrollTop=0;}
      else{
        const r=node.getBoundingClientRect(),clip=(scroll||host).getBoundingClientRect();
        if(r.top<clip.top+75||r.top>clip.bottom-140||Math.min(r.bottom,r.top+140)>clip.bottom-55){
          const anchor=node.querySelector?.('summary,h2,h3')||node;
          const container=scroll||host;rememberScroll(container);container.scrollTop+=anchor.getBoundingClientRect().top-clip.top-Math.max(88,Math.min(160,clip.height*.25));
        }
      }
    }
    preparing=false;
  }
  function render(prepare=true){
    if(!active)return;
    rendering=true;clearTarget();attach();
    // A reused dialog can re-enter the top layer after the guide. Raise the
    // guide once per scene so async clinic results cannot paint over it.
    if(supportsPopover()&&layer.matches(':popover-open')){layer.hidePopover();layer.showPopover();}
    const def=current(),zh=lang()==='zh';
    layer.dataset.step=id;layer.dataset.page=String(getPage());layer.dataset.gesture=def.gesture||'';layer.dataset.visual=def.visual||'';layer.dataset.reviewed=String(activityReviewed);shell.dataset.tourStep=id;
    const route=steps(),text=def.label||coachCopy(id,lang()),visual=coachVisual(def.visual,lang()),stepIndex=route.findIndex(item=>item.id===id)+1;
    const buttonLabel=def.done?(def.doneLabel||(zh?'完成':'Done')):(def.continueLabel||(zh?'下一步':'Next'));
    const showHand=def.visual==='tap';
    layer.innerHTML=`<svg class="coach-focus" aria-hidden="true"><defs><linearGradient id="coach-activity-dock" gradientUnits="userSpaceOnUse" x1="0" x2="0"><stop offset="0" stop-color="#15212c" stop-opacity="0"/><stop offset=".24" stop-color="#15212c" stop-opacity=".91"/><stop offset="1" stop-color="#15212c" stop-opacity=".96"/></linearGradient><filter id="coach-focus-feather"><feGaussianBlur stdDeviation="7"/></filter><mask id="coach-focus-mask"><rect width="100%" height="100%" fill="white"/><rect data-focus-window rx="24" fill="black" filter="url(#coach-focus-feather)"/><rect data-dots-window rx="24" fill="black" filter="url(#coach-focus-feather)" style="display:none"/></mask></defs><rect data-coach-shade width="100%" height="100%" fill="#15212c" fill-opacity=".72" mask="url(#coach-focus-mask)"/></svg><svg class="coach-arrow" aria-hidden="true"><defs><marker id="coach-arrowhead" markerWidth="16" markerHeight="16" refX="9" refY="8" orient="auto" markerUnits="userSpaceOnUse"><path d="m3 2 6 6-6 6"/></marker></defs><path marker-end="url(#coach-arrowhead)"/></svg>${showHand?`<div class="coach-gesture">${coachVisual('tap',lang())}</div>`:''}${def.hint?`<span class="coach-interaction-hint">${escapeText(def.hint)}</span>`:''}${def.separateAlertHeading?`<p class="coach-alert-title">${escapeText(text)}</p>`:''}<div class="coach-note" role="status" aria-live="polite">${def.visual==='activity-scroll'?`<span class="coach-scroll-cue" aria-hidden="true">${icon(activityReviewed?'arrow-right':'back')}</span>`:def.visual!=='tap'?visual:''}${def.separateAlertHeading?'':`<p id="coach-action-label">${escapeText(text)}</p>`}<span ${def.separateAlertHeading?'id="coach-action-label"':''} class="${def.showDescription?'coach-description':'sr-only'}">${escapeText(def.description)}</span>${def.event==='continue'||def.done?`<button type="button" class="coach-next is-labeled" ${def.done?'data-coach-done':'data-coach-continue'}>${escapeText(buttonLabel)}${icon(def.done?'check':'arrow-right')}</button>`:''}${def.skipAction||def.skipEvent?`<button type="button" class="coach-secondary" data-coach-secondary>${escapeText(def.skipLabel)}</button>`:''}</div>${id==='explore'?`<span class="coach-page-location">${zh?'大圆点 = 当前页':'Large dot = current page'}</span>`:''}<div class="coach-toolbar"><span class="coach-progress">${stepIndex}<span> / ${route.length}</span>${def.example?`<small>${zh?'演示':'Demo'}</small>`:''}</span><div class="coach-progress-track" aria-hidden="true"><i style="width:${stepIndex/route.length*100}%"></i></div><button type="button" data-coach-skip>${zh?'结束引导':'End tour'}</button></div>`;
    note=layer.querySelector('.coach-note');arrow=layer.querySelector('.coach-arrow');
    layer.querySelector('[data-coach-skip]').addEventListener('click',()=>{if(inputPolicy().showEndTour)finish('skip');});
    layer.querySelector('[data-coach-secondary]')?.addEventListener('click',()=>{doc.activeElement?.blur?.();const option=current();if(option.skipEvent)notify({type:option.skipEvent});else onStep({action:option.skipAction});});
    layer.querySelector('[data-coach-continue]')?.addEventListener('click',()=>notify({type:'continue'}));
    layer.querySelector('[data-coach-done]')?.addEventListener('click',()=>finish('complete'));
    if(prepare)prepareTarget(def);rendering=false;position();schedule(800);
    if(!prepare)return;
    if(def.event==='continue'||def.done)note.querySelector('button')?.focus({preventScroll:true});
    else if(!['.vet-search-form'].includes(def.target)&&id!=='input-cancel'&&target?.matches('button,input,textarea,summary,[tabindex]'))target.focus({preventScroll:true});
  }
  function enter(next){
    if(!active||!steps().some(item=>item.id===next))return;
    id=next;if(id==='score'){colourProgress=0;lastColourTap=-Infinity;}if(id==='vet-results')clinicIntroduced=false;if(id==='explore'){exploration=0;activityReviewed=false;}opened=Boolean(steps().find(item=>item.id===id)?.startsOpen);const ticket=++epoch,def=current();entering=true;let ready;try{ready=onStep(def);}finally{entering=false;}
    if(!active||ticket!==epoch)return;render();
    if(ready&&typeof ready.then==='function')ready.then(()=>{if(active&&ticket===epoch)render();}).catch(()=>schedule());
  }
  function interactionPolicy(){
    const def=current(),sheet=Boolean(doc.querySelector('#app-sheet[open]'));
    let allowedSelectors='',gestureSelectors='',scrollSelectors='';
    if(id==='device'){
      allowedSelectors=opened?'[data-connect],[data-connect-back],[data-pair],[data-connect-demo],[data-settings-close]':'#device-button';
      if(opened)scrollSelectors='#settings-screen .settings-content';
    }else if(id==='score'){
      allowedSelectors=sheet?'':'#wellness-orb';
      if(sheet)scrollSelectors='#app-sheet';
    }else if(id==='red-alert'&&opened){
      allowedSelectors=doc.querySelector('#app-sheet .vet-search-form')?'.vet-search-form':'[data-find-vet]';
      scrollSelectors='#app-sheet';
    }else if(id==='vet-results'){
      allowedSelectors=clinicIntroduced?'#sheet-close':'[data-vet-detail],[data-vet-pin],[data-vet-back],[data-vet-condition],[data-detail-condition],.vet-map,.vet-clinic-map';
      if(clinicIntroduced)gestureSelectors='#app-sheet';
      scrollSelectors='#app-sheet';
    }else if(id==='card'){
      allowedSelectors=opened?'#card-screen summary,[data-card-tab],#card-back':'#health-card-button';
      if(opened)scrollSelectors='#card-screen .card-scroll';
    }else if(id==='profile'){
      allowedSelectors=opened?'#settings-sidebar [data-section="profile"],#settings-sidebar [data-section="preferences"],#settings-sidebar [data-section="language"],#settings-sidebar [data-section="subscription"],[data-settings-menu],[data-settings-close]':'#account-button';
      if(opened)scrollSelectors='#settings-screen .settings-content';
    }else if(id==='explore'){
      allowedSelectors=getPage()===0&&!activityReviewed?'':exploration>=2?'[data-page-step],[data-position]':`[data-page-step="-1"],[data-position="${exploration===0?0:2}"]`;gestureSelectors=def.navigation?'#page-track':'';scrollSelectors='#page-track .screen-scroll';
    }
    return {allowedSelectors,gestureSelectors,scrollSelectors,scrollControlSelectors:id==='explore'?'#data-screen summary':'',scrollElement:id==='explore'&&getPage()===0?doc.querySelector('#data-screen .screen-scroll'):null,gestureControlSelectors:id==='explore'?'#wellness-orb':'',deniedSelectors:'a[href]',keyboardSelectors:'#card-screen [data-card-tab],.vet-map [tabindex],.vet-clinic-map [tabindex]',allowNavigationKeys:Boolean(def.navigation)};
  }
  function keydown(event){
    if(!active||event.key!=='Escape')return;
    event.preventDefault();event.stopImmediatePropagation();
    if(inputPolicy().escapeAction==='blur')doc.activeElement?.blur?.();
    schedule(350);
  }
  function dialogCancel(event){if(active&&inputPolicy().preventDialogCancel){event.preventDefault();schedule(350);}}
  function composition(event){composing=event.type==='compositionstart';schedule(350);}

  function toggle(event){if(active&&!preparing&&current().event==='module-toggle'&&event.target?.dataset?.summaryModule)notify({type:'module-toggle',module:event.target.dataset.summaryModule,open:event.target.open});}
  function notify(event){
    if(!active||entering)return;
    if(id==='vet-results'&&opened&&!clinicIntroduced&&event.type==='continue'&&doc.querySelector('#app-sheet.vet-detail-sheet[open]')){
      clinicIntroduced=true;render();return;
    }
    if(id==='score'&&!colourLesson(colourProgress).complete){
      if(event.type!=='orb-tap')return;
      const nextProgress=advanceColourLesson(colourProgress,event.tone);
      if(nextProgress===colourProgress)return;
      colourProgress=nextProgress;
      const lesson=colourLesson(colourProgress);
      entering=true;try{onStep({action:lesson.tone==='watch'?'set-watch':lesson.tone==='alert'?'set-alert':'set-good'});}finally{entering=false;}
      render(false);
      doc.querySelector('#wellness-orb')?.focus({preventScroll:true});
      return;
    }
    if(id==='explore'&&event.type==='page'){
      if(exploration===0&&event.index===0){const scroll=doc.querySelector('#data-screen .screen-scroll');rememberScroll(scroll);if(scroll)scroll.scrollTop=0;}
      exploration=advanceExploration(exploration,event.index,{activityReviewed});
    }
    const def=current();
    if(def.entry&&def.entry.type===event.type&&(!def.entry.section||def.entry.section===event.section))opened=true;
    const next=nextTourStep(id,event,{opened,needsConnection,coloursComplete:colourLesson(colourProgress).complete,clinicIntroduced});
    if(next!==id){
      if(def.continueAction){entering=true;try{onStep({action:def.continueAction});}finally{entering=false;}}
      enter(next);
    }else if((['score','red-alert'].includes(id)&&['health-open','health-alert'].includes(event.type))||(['device','profile'].includes(id)&&event.type==='settings')||(id==='card'&&event.type==='card-open'))render();
    else if((['red-alert','vet-results'].includes(id)&&event.type==='vet')||(id==='explore'&&event.type==='page')||(id==='card'&&event.type==='sheet-close'))render(false);
    else schedule(350);
  }
  function activateOrb(event={}) {
    if(!active||id!=='score'||doc.querySelector('#app-sheet[open]'))return false;
    const now=win.performance.now();
    const action=colourTapAction(colourProgress,event,now-lastColourTap);
    if(action==='open')return false;
    if(action==='advance'){
      lastColourTap=now;
      notify({type:'orb-tap',tone:colourLesson(colourProgress).tone});
    }
    return true;
  }
  function close(){
    if(!active)return;
    active=false;interactionGuard?.destroy();interactionGuard=null;++epoch;win.cancelAnimationFrame(frame);frame=null;trackUntil=0;observer?.disconnect();mutation?.disconnect();clearTarget();
    for(const [node,open] of expanded)if(node.isConnected)node.open=open;expanded.clear();
    for(const [node,position] of scrollPositions)if(node.isConnected){node.scrollTop=position.top;node.scrollLeft=position.left;}scrollPositions.clear();
    doc.removeEventListener('focusin',schedule,true);doc.removeEventListener('focusout',schedule,true);doc.removeEventListener('compositionstart',composition,true);doc.removeEventListener('compositionend',composition,true);doc.querySelector('#app-sheet')?.removeEventListener('cancel',dialogCancel);
    doc.removeEventListener('keydown',keydown,true);doc.removeEventListener('scroll',schedule,true);doc.removeEventListener('toggle',toggle,true);
    win.removeEventListener('resize',schedule);win.visualViewport?.removeEventListener('resize',schedule);win.visualViewport?.removeEventListener('scroll',schedule);
    if(supportsPopover()&&layer.matches(':popover-open'))layer.hidePopover();layer?.remove();delete shell.dataset.tourStep;shell.style.removeProperty('--activity-coach-clearance');
    if(restore)restore(returnPage);else showPage(returnPage,false);
    if(returnFocus?.isConnected&&!returnFocus.closest('[hidden],[inert]'))returnFocus.focus({preventScroll:true});
  }
  function finish(reason){if(!active)return;close();onFinish({reason});}
  function start(){
    if(active)close();returnPage=getPage();returnFocus=doc.activeElement;active=true;composing=false;needsConnection=Boolean(getNeedsConnection());layoutHeight=win.visualViewport?.height||win.innerHeight;
    layer=doc.createElement('div');layer.className='onboarding-overlay coach-layer';
    if(supportsPopover())layer.setAttribute('popover','manual');else layer.classList.add('coach-fallback');
    host=null;attach();
    interactionGuard=createOnboardingGuard({doc,layer,getPolicy:interactionPolicy});interactionGuard.mount();
    doc.addEventListener('focusin',schedule,true);doc.addEventListener('focusout',schedule,true);doc.addEventListener('compositionstart',composition,true);doc.addEventListener('compositionend',composition,true);doc.querySelector('#app-sheet')?.addEventListener('cancel',dialogCancel);
    doc.addEventListener('keydown',keydown,true);doc.addEventListener('scroll',schedule,true);doc.addEventListener('toggle',toggle,true);
    win.addEventListener('resize',schedule);win.visualViewport?.addEventListener('resize',schedule);win.visualViewport?.addEventListener('scroll',schedule);
    if(win.ResizeObserver){observer=new win.ResizeObserver(schedule);observer.observe(shell);}
    if(win.MutationObserver){mutation=new win.MutationObserver(records=>{if(records.some(record=>!record.target.closest?.('.coach-layer')))schedule();});mutation.observe(shell,{childList:true,subtree:true,attributes:true,attributeFilter:['open','hidden','inert']});const dialog=doc.querySelector('#app-sheet');if(dialog)mutation.observe(dialog,{childList:true,subtree:true,attributes:true,attributeFilter:['open','hidden','inert']});}
    showPage(1,false);enter('welcome');
  }
  return {start,close,notify,activateOrb,get orbInstruction(){return active&&id==='score'&&!colourLesson(colourProgress).complete?colourLesson(colourProgress,lang()).hint:'';},canNavigateTo(index){return active&&id==='explore'&&canExplorePage(exploration,index,{activityReviewed});},get active(){return active;},get step(){return id;},get allowPageChange(){return active&&Boolean(current()?.navigation);},get allowDismiss(){return active&&Boolean(current()?.dismiss);},get allowSwipeDismiss(){return active&&id==='vet-results'&&opened&&clinicIntroduced;},get allowSettingsGestures(){return false;}};
}
