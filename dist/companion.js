import { icon, escapeHTML, openSheet, closeSheet, toast } from './ui.js';
import { createVoiceInput } from './voice-input.js';
import { isHealthNoteRequest } from './note-intent.js';
import { paintWords, replyParticles } from './companion-motion.js';

const formatNumber = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 1 });
const sensorKeys = ['heart','temp','steps','sleep'];
const finiteReading = value => typeof value==='number' && Number.isFinite(value) && value>=0;
const noDeviceReadings = 'No device readings yet. Connect a collar to begin.';
const isSimulated = snapshot => snapshot?.simulated===true || ['good','watch','alert'].includes(snapshot?.scenario);
const availableSensorKeys = snapshot => snapshot?.source==='unavailable'?[]:sensorKeys.filter(key=>finiteReading(snapshot?.[key]));

export function companionDeviceReply(text,snapshot={},name='Your pet') {
  const lower=String(text||'').toLowerCase();
  const summary=/summary|summari[sz]e|overview|how (?:is|was) [^?]{0,40}(?:doing|today)|all (?:the )?readings|device data|总结/.test(lower);
  const score=/score|baseline|评分/.test(lower);
  const asksReading=/how (?:many|much|long)|what(?:'s| is| was| are)|show|reading|count|今天|多少/.test(lower);
  const specs=[['heart','heart rate|bpm|pulse|心率|心跳','Heart rate','bpm'],['temp','temperature|temp|温度|体温','Skin temperature','°C'],['steps','steps|step count|步数','Steps','steps'],['sleep','sleep|slept|睡眠|睡觉','Estimated sleep','hours']];
  const found=asksReading?specs.filter(([,expression])=>new RegExp(expression).test(lower)):[];
  if(!summary&&!score&&!found.length)return null;
  const available=availableSensorKeys(snapshot);
  if(!available.length)return noDeviceReadings;
  const number=value=>formatNumber.format(value);
  const disclaimer=isSimulated(snapshot)?'\n\nSimulated device readings, not a diagnosis.':'';
  if(summary)return `${name} today\n${specs.map(([key,,label,unit])=>available.includes(key)?`${label}: ${number(snapshot[key])} ${unit}`:`${label}: no reading yet`).join('\n')}${disclaimer}`;
  if(score){
    const hasBaseline=sensorKeys.every(key=>finiteReading(snapshot.baseline?.[key])&&snapshot.baseline[key]>0);
    if(available.length!==sensorKeys.length||!hasBaseline||!finiteReading(snapshot.score))return 'A health score is not available yet. More readings and a personal baseline are needed.';
    const changes=[...(snapshot.deviations||[])].filter(item=>finiteReading(item.current)&&finiteReading(item.baseline)).sort((a,b)=>Number(b.impact||0)-Number(a.impact||0)).slice(0,3);
    return `Score: ${snapshot.score}/100${changes.length?'\n\n'+changes.map(item=>`${item.label}: ${number(item.current)} ${item.unit||''} · usual ${number(item.baseline)}`).join('\n'):''}${isSimulated(snapshot)?'\n\nThe demo score compares simulated readings with a personal baseline. It has not been clinically validated.':''}`;
  }
  return found.map(([key,,label,unit])=>{
    if(!available.includes(key))return `${label}: no reading yet.`;
    const baseline=finiteReading(snapshot.baseline?.[key])?`\nUsual: ${number(snapshot.baseline[key])} ${unit}`:'';
    return `${label}: ${number(snapshot[key])} ${unit}${baseline}`;
  }).join('\n\n')+disclaimer;
}

export function companionHealthContext(store={},s={}) {
  const available=availableSensorKeys(s),hasReadings=available.length>0;
  const baseline=Object.fromEntries(sensorKeys.filter(key=>hasReadings&&finiteReading(s.baseline?.[key])).map(key=>[key,s.baseline[key]]));
  const canAssess=available.length===sensorKeys.length&&sensorKeys.every(key=>baseline[key]>0);
  const signs=Array.isArray(s.observedSigns)?s.observedSigns.filter(sign=>typeof sign==='string'):[];
  const reportedSigns=hasReadings||s.observationSource==='owner'?signs:[];
  const ownerEmergency=s.observationSource==='owner'&&reportedSigns.length>0&&s.triage?.level==='alert';
  const simulated=hasReadings&&isSimulated(s);
  const profile={name:store.profile?.name,breed:store.profile?.breed,age:store.profile?.age,weight:store.profile?.weight,sex:store.profile?.sex,allergies:store.allergies,conditions:store.conditions};
  const snapshot={
    availability:!hasReadings?'unavailable':available.length===sensorKeys.length?'available':'partial',
    source:!hasReadings?'unavailable':s.source||(simulated?'demo':'device'),simulated,
    score:canAssess&&finiteReading(s.score)?s.score:null,
    status:ownerEmergency?'alert':canAssess?s.status:'unknown',scenario:simulated?s.scenario:null,
    updatedAt:hasReadings&&typeof s.updatedAt==='string'?s.updatedAt:null,
    ...Object.fromEntries(sensorKeys.map(key=>[key,available.includes(key)?s[key]:null])),baseline,
    observedSigns:reportedSigns,observationSource:reportedSigns.length?s.observationSource:hasReadings?s.observationSource:'unavailable',
    ...((canAssess||ownerEmergency)&&s.triage?{triage:{level:s.triage.level,emergencySigns:s.triage.emergencySigns||[],assessedAt:s.triage.assessedAt}}:{}),
  };
  const records=[...(store.records||[])].filter(record=>record.type!=='meal').sort((a,b)=>String(b.date).localeCompare(String(a.date))).slice(0,12).map(record=>({type:record.type,title:String(record.title||'').slice(0,120),date:record.date,details:String(record.details||'').slice(0,600),author:record.author,sample:Boolean(record.sample),...(record.dose?{dose:String(record.dose).slice(0,80)}:{})}));
  return {profile,snapshot,records,allergies:store.allergies,conditions:store.conditions};
}
const recordTypes = [
  ['observation', 'Observation'],
  ['medication', 'Medication'],
  ['vaccine', 'Vaccination'],
  ['parasite', 'Parasite care'],
];

function inputDate(date) {
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

function draftFromNote(note) {
  const lower = note.toLowerCase();
  let type = 'observation';
  let title = 'Health observation';
  let dose = '';
  if (/vacci|booster|疫苗/.test(lower)) {
    type = 'vaccine';
    title = 'Vaccination noted';
  } else if (/deworm|worming|parasite|flea|tick treatment|驱虫/.test(lower)) {
    type = 'parasite';
    title = 'Parasite care noted';
  } else if (/medicin|medication|tablet|capsule|dose|gave .*\b(?:mg|ml)\b|用药|吃药|喂药/.test(lower)) {
    type = 'medication';
    title = 'Medication noted';
    dose = note.match(/\b\d+(?:\.\d+)?\s*(?:mg|ml|g|tablets?|capsules?|drops?)\b/i)?.[0] || '';
  } else if (/cough|咳嗽/.test(lower)) {
    title = 'Coughing observation';
  } else if (/sleep|slept|睡眠|睡觉/.test(lower)) {
    title = 'Estimated sleep observation';
  }
  const date = new Date();
  if (/\byesterday\b|昨天/.test(lower)) date.setDate(date.getDate() - 1);
  const explicitDate = note.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (explicitDate) {
    const candidate = new Date(`${explicitDate[0]}T12:00:00`);
    if (Number.isFinite(candidate.valueOf()) && candidate.toISOString().slice(0, 10) === explicitDate[0]) {
      date.setFullYear(candidate.getFullYear(), candidate.getMonth(), candidate.getDate());
    }
  }
  const times = [...note.matchAll(/\b(1[0-2]|0?[1-9])(?::([0-5]\d))?\s*(am|pm)\b/gi)];
  let timeHint = 'An exact time was not extracted. The draft uses the current local time; please confirm it.';
  if (times.length === 1) {
    const hour = Number(times[0][1]) % 12 + (times[0][3].toLowerCase() === 'pm' ? 12 : 0);
    date.setHours(hour, Number(times[0][2] || 0), 0, 0);
    timeHint = 'The time was taken from your note. Please confirm the date and details.';
  } else if (times.length > 1) {
    timeHint = 'Your note mentions several times. They are preserved below; choose a date and time for this combined entry.';
  }
  return { type, title, date: inputDate(date), details: note, dose, timeHint };
}

function emergencyReply(text) {
  if (!/difficulty breathing|struggling to breathe|blue gums|collaps|can.t breathe|呼吸困难|昏倒|倒下/.test(text.toLowerCase())) return null;
  return 'If your pet is having difficulty breathing, has blue gums, or is weak or collapsing, seek emergency veterinary care now and call ahead if possible. A demo score cannot assess an emergency. You can bring the health card with you, but do not delay care to complete it.';
}

const CHAT_KEY = 'pawprint.companion.session.v1';
const AI_CONSENT_KEY = 'pawprint.companion.ai-consent.v1';
const VOICE_CONSENT_KEY = 'pawprint.companion.voice-consent.v2';
const keyboardIcon = '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><rect x="2" y="5" width="20" height="14" rx="4"/><path d="M6 9h.01M10 9h.01M14 9h.01M18 9h.01M6 12h.01M10 12h.01M14 12h.01M18 12h.01M8 15h8"/></svg>';
const historyIcon = '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7v5h5M4.5 11a8 8 0 1 1 2 7M12 7v5l3 2"/></svg>';

function sessionRead(key) { try { return sessionStorage.getItem(key); } catch { return null; } }
function sessionWrite(key, value) { try { sessionStorage.setItem(key, value); } catch {} }
function safeSignInPath(path) { return typeof path === 'string' && /^\/(?![\/\\])[^\\\r\n]*$/.test(path) ? path : ''; }
function readMessages(key = CHAT_KEY) {
  try {
    const saved = JSON.parse(sessionRead(key) || '[]');
    if (!Array.isArray(saved)) return [];
    return saved.filter(item => item && ['user','assistant'].includes(item.role) && typeof item.text === 'string').slice(-30).map((item,index) => ({
      id:index+1,role:item.role,text:item.text.slice(0,8000),source:['ai','device','note','offline','auth','safety'].includes(item.source)?item.source:'offline',liked:item.liked===true,
      ...(item.draft && recordTypes.some(([type])=>type===item.draft.type) && typeof item.draft.details==='string' ? {draft:{...item.draft,details:item.draft.details.slice(0,1600)}} : {}),saved:Boolean(item.saved),
    }));
  } catch { return []; }
}

/** Decorative water movement. Microphone strength is used only when the engine supplies real RMS. */
function mountCompanionRipples(canvas) {
  const context=canvas.getContext('2d');
  const preference=window.matchMedia('(prefers-reduced-motion: reduce)');
  const reduced = () => preference.matches || document.documentElement.dataset.motion === 'reduced';
  let width=0,height=0,frame=0,lastFrame=0,time=0,active=true,state='idle',level=null,strength=0;
  let sinceRipple=0;
  let ripples=[{born:-.3,seed:.7},{born:-1.55,seed:2.6},{born:-2.8,seed:4.8}];
  const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));
  function trace(radius,seed,elapsed,offset=0) {
    const path=new Path2D();
    const originX=width*.5+Math.sin(seed)*12;
    const originY=height+26+Math.cos(seed)*9;
    const amplitude=2.2+strength*6;
    const points=[];
    for(let index=0;index<100;index++){
      const angle=index/100*Math.PI*2;
      const warp=Math.sin(angle*3+seed+elapsed*.47)*amplitude+Math.sin(angle*5-seed*.7-elapsed*.29)*amplitude*.4;
      const distance=radius+warp+offset;
      points.push([originX+Math.cos(angle)*distance,originY+Math.sin(angle)*distance*.75]);
    }
    path.moveTo((points[99][0]+points[0][0])/2,(points[99][1]+points[0][1])/2);
    points.forEach((point,index)=>{const next=points[(index+1)%points.length];path.quadraticCurveTo(point[0],point[1],(point[0]+next[0])/2,(point[1]+next[1])/2);});
    path.closePath();return path;
  }
  function draw() {
    if(!context||!width||!height)return;
    context.clearRect(0,0,width,height);
    const originY=height+20;
    const glow=context.createRadialGradient(width*.5,originY,5,width*.5,originY,width*.72);
    glow.addColorStop(0,'rgba(245,247,250,.22)');glow.addColorStop(.42,'rgba(188,201,216,.07)');glow.addColorStop(.7,'rgba(209,196,209,.035)');glow.addColorStop(1,'rgba(213,218,224,0)');
    context.fillStyle=glow;context.fillRect(0,0,width,height);
    if(reduced())return;
    for(const ripple of ripples){
      const age=time-ripple.born;
      const duration=5.8;
      if(age<0||age>duration)continue;
      const progress=age/duration;
      const radius=22+progress*(Math.max(width,height)*1.03);
      const visibility=Math.sin(Math.min(1,progress*3)*Math.PI*.5)*Math.pow(1-progress,1.45);
      const alpha=visibility*(.32+strength*.17);
      const path=trace(radius,ripple.seed,time);
      const edge=context.createLinearGradient(0,height*.5,width,height);
      edge.addColorStop(0,`rgba(255,255,255,${alpha*.5})`);edge.addColorStop(.32,`rgba(248,253,255,${alpha})`);edge.addColorStop(.68,`rgba(232,222,234,${alpha*.62})`);edge.addColorStop(1,`rgba(255,255,255,${alpha*.85})`);
      context.strokeStyle=edge;context.lineWidth=1.1+visibility*.8;context.shadowColor=`rgba(242,247,254,${alpha*.45})`;context.shadowBlur=5;context.stroke(path);
      context.shadowBlur=0;
      context.strokeStyle=`rgba(93,106,124,${visibility*.065})`;context.lineWidth=.7;context.stroke(trace(radius,ripple.seed,time,2.8));
      context.strokeStyle=`rgba(255,255,255,${alpha*.18})`;context.lineWidth=5;context.stroke(trace(radius,ripple.seed,time,-2));
    }
  }
  function tick(now){
    frame=0;
    if(!active||document.hidden)return;
    const delta=lastFrame?Math.min((now-lastFrame)/1000,.05):1/60;
    lastFrame=now;
    const listening=state==='listening';
    const wanted=level===null ? (listening ? .42 : state==='transcribing' ? .23 : .1) : clamp(level,0,1);
    strength+=(wanted-strength)*.08;
    time+=delta*(listening?1.12:1);
    sinceRipple+=delta;
    const interval=listening?1.05-strength*.32:state==='transcribing'?1.1:1.65;
    if(sinceRipple>interval){ripples.push({born:time,seed:time*1.79});sinceRipple=0;}
    ripples=ripples.filter(ripple=>time-ripple.born<5.8);
    draw();
    if(!reduced())frame=requestAnimationFrame(tick);
  }
  function schedule(){if(active&&!document.hidden&&!frame){lastFrame=0;frame=requestAnimationFrame(tick);}}
  function resize(){
    const box=canvas.getBoundingClientRect();width=box.width;height=box.height;
    const ratio=Math.min(window.devicePixelRatio||1,2);canvas.width=Math.round(width*ratio);canvas.height=Math.round(height*ratio);context?.setTransform(ratio,0,0,ratio,0,0);draw();schedule();
  }
  const observer=new ResizeObserver(resize);observer.observe(canvas);
  const motionChanged=()=>{cancelAnimationFrame(frame);frame=0;draw();schedule();};
  preference.addEventListener('change',motionChanged);
  window.addEventListener('pawprint:preferences',motionChanged);
  resize();
  return {
    update(nextState,nextLevel){state=nextState;level=nextLevel;schedule();},
    setActive(value){active=value;if(!active){cancelAnimationFrame(frame);frame=0;lastFrame=0;}else schedule();},
  };
}

export function initCompanion(root, { getStore, getSnapshot, persist, onChange, onTextMode = () => {}, onInputCancel = () => {} }) {
  const messages = readMessages();
  let sessionKey = CHAT_KEY;
  let messageNumber = messages.length;
  let mounted = false;
  let pending = false;
  let accountGeneration = 0;
  let consentScope = 'guest';
  let isTestAccount = false;
  let capabilities = { configured:false, authenticated:false, requiresSignIn:false, chat:false, transcription:false };
  let capabilityLoaded = false;
  let capabilityPromise;
  let capabilityController;
  let capabilityRequest = 0;
  let capabilityCheckedAt = 0;
  let chatController;
  const capabilityTTL = 30000;
  const consentKey = key => `${key}:${consentScope}`;
  let voiceState = 'idle';
  let voiceText = '';
  let voiceError = '';
  let voiceEngine = '';
  let voiceLive = '';
  let voicePanelOpen = false;
  let voiceBase = '';
  let voiceDraft = false;
  let voiceCompletion = null;
  let mode = 'voice';
  let inputGeneration = 0;
  let voiceConsentOpen = false;
  let log, input, mic, status, scene, transcript, voicePanel, controls;
  let waterWaves=null,voiceLevel=null;
  let aiSignInPath = '';

  function petName() { return getStore().profile.name; }
  function persistMessages() {
    sessionWrite(sessionKey,JSON.stringify(messages.filter(message=>!message.pending).slice(-30).map(({id,role,text,source,draft,saved,liked})=>({id,role,text,source,draft,saved,liked}))));
  }
  async function loadCapabilities(refresh = false) {
    if (!refresh && capabilityPromise) return capabilityPromise;
    if (!refresh && capabilityLoaded && Date.now()-capabilityCheckedAt<capabilityTTL) return capabilities;
    capabilityController?.abort();
    const generation=accountGeneration, request=++capabilityRequest;
    const controller=new AbortController();capabilityController=controller;
    const timeout=setTimeout(()=>controller.abort(),8000);
    const isCurrent=()=>generation===accountGeneration && request===capabilityRequest;
    const latest=()=>generation===accountGeneration ? capabilityPromise || capabilities : null;
    capabilityPromise=(async()=>{
      try {
        const response=await fetch('/api/capabilities',{credentials:'same-origin',cache:'no-store',headers:{Accept:'application/json',...(isTestAccount?{'X-Pawprint-Test-Mode':'1'}:{})},signal:controller.signal});
        if(!response.ok)throw new Error('capability-unavailable');
        const value=await response.json();
        if(!isCurrent())return latest();
        const configured=value.configured===true,authenticated=value.authenticated===true;
        const requiresSignIn=value.requiresSignIn===true || (configured && !authenticated);
        capabilities={configured,authenticated,requiresSignIn,chat:configured&&authenticated&&value.chat===true,transcription:configured&&authenticated&&value.transcription===true,realtimeTranscription:configured&&authenticated&&value.realtimeTranscription===true,signInPath:safeSignInPath(value.signInPath)};
        aiSignInPath=requiresSignIn?capabilities.signInPath:'';
      } catch {
        if(!isCurrent())return latest();
        capabilities={chat:false,transcription:false,connectionFailed:true};aiSignInPath='';
      } finally {
        clearTimeout(timeout);
        if(isCurrent()){capabilityPromise=null;capabilityController=null;capabilityLoaded=true;capabilityCheckedAt=Date.now();updateConnection();}
      }
      return capabilities;
    })();
    return capabilityPromise;
  }
  function connectionLabel() {
    return !capabilityLoaded?'Connecting…':capabilities.requiresSignIn?'Sign in for AI':capabilities.chat?'Connected':capabilities.connectionFailed?'Connection unavailable':capabilities.configured?'AI unavailable':'AI not connected';
  }
  function unavailableText(available=capabilities) {
    if(available.requiresSignIn && isTestAccount)return 'Your test session is no longer active. Log out in Settings, then choose “Mochi · Test account” to start again. Device readings and local notes still work.';
    if(available.requiresSignIn)return 'Sign in to use AI. You can still ask for device readings or say “Record…” to prepare a health note.';
    if(available.connectionFailed)return 'Could not check the AI connection. Try again, or ask for device readings and local health notes.';
    return 'AI is not connected right now. You can still ask for device readings or say “Record…” to prepare a health note.';
  }
  function applyUnavailable(answer,available) {
    answer.text=unavailableText(available);answer.source=available.requiresSignIn?'auth':'offline';
    answer.signInPath=available.requiresSignIn?safeSignInPath(available.signInPath):'';
  }
  function updateConnection() {
    if (!mounted) return;
    const indicator = root.querySelector('.companion-connection');
    indicator.textContent = pending && capabilities.chat ? 'Thinking…' : capabilities.chat ? 'AI' : connectionLabel();
    if(capabilities.requiresSignIn && aiSignInPath){
      const link=document.createElement('a');link.href=aiSignInPath;link.target='_top';link.textContent='Sign in for AI';indicator.replaceChildren(link);
    }
    indicator.dataset.online = String(capabilities.chat);
    indicator.setAttribute('aria-label',capabilities.chat?'AI service connected':capabilities.requiresSignIn?'Sign in to use AI. Device data and notes still work.':`${connectionLabel()}. Device data and notes still work.`);
  }
  const voice = createVoiceInput({
    getCapabilities:()=>loadCapabilities(true),
    getTestMode:()=>isTestAccount,
    onState({state,engine,live}) {
      voiceState=state;voiceEngine=engine;voiceLive=live;
      const canComplete=state==='review'||(state==='idle'&&voiceCompletion?.action==='edit');
      if(state==='idle'&&!canComplete)voiceCompletion=null;
      if(canComplete&&voicePanelOpen&&mode==='voice'){
        // The engine emits its final transcript before review. Wait until its
        // cleanup finishes, and bind this intent to this draft and account.
        const completion=voiceCompletion || {action:'edit',input:inputGeneration,account:accountGeneration};
        voiceCompletion=completion;
        queueMicrotask(()=>{
          if(voiceCompletion!==completion || completion.input!==inputGeneration || completion.account!==accountGeneration || voiceState!==state || !voicePanelOpen)return;
          voiceCompletion=null;
          if(completion.action==='send'&&!completion.failed)submitText(voiceText);
          else setTextMode(true);
        });
      }
      updateVoice();
    },
    onTranscript({text}) {
      const words=String(text||'');
      const separator=voiceBase&&words&&!/\s$/.test(voiceBase)&&!/^\s/.test(words)&&!(/[\u3400-\u9fff]$/.test(voiceBase)&&/^[\u3400-\u9fff]/.test(words))?' ':'';
      voiceText=(voiceBase+separator+words).slice(0,1600);
      updateVoice();if(transcript&&voiceState==='listening')transcript.scrollTop=transcript.scrollHeight;
    },
    onLevel(level) { voiceLevel=level;waterWaves?.update(voiceState,voiceLevel); },
    onError(error) { if(voiceCompletion)voiceCompletion.failed=true;voiceError=error.message || 'Voice input could not finish. Please try again.'; if(error.signInPath)aiSignInPath=safeSignInPath(error.signInPath);if(error.code==='authentication_required'){capabilities={...capabilities,chat:false,transcription:false,authenticated:false,requiresSignIn:true,signInPath:aiSignInPath};capabilityCheckedAt=0;}updateVoice(); },
  });

  function updateVoice() {
    if(!mounted)return;
    const busyVoice=['requesting','listening','transcribing'].includes(voiceState);
    scene.dataset.voice=voiceState;
    waterWaves?.update(voiceState,voiceLevel);
    scene.dataset.mode=mode;
    scene.dataset.reply=pending?'pending':'idle';
    updateConnection();
    scene.classList.toggle('has-messages',messages.length>0);
    scene.classList.toggle('has-transcript',voicePanelOpen);
    voicePanel.hidden=!voicePanelOpen;
    paintWords(transcript,voiceText || (voiceState==='listening' ? 'I’m listening…' : voiceState==='transcribing' ? 'Finishing…' : voiceState==='requesting' ? 'One moment…' : ''),{live:voiceState==='listening'});
    transcript.classList.toggle('is-placeholder',!voiceText);
    transcript.dataset.live=String(voiceState==='listening'&&Boolean(voiceText));
    transcript.setAttribute('aria-live',voiceState==='listening'?'off':'polite');
    status.textContent=voiceError || ({requesting:'Connecting microphone',listening:['browser','realtime'].includes(voiceLive)?'Listening · live text':voiceLive==='server'?'Listening · updating text':'Recording · live text unavailable',transcribing:'Finishing your words',review:'Ready to send',idle:voiceText?'Ready to send':''}[voiceState]);
    status.classList.toggle('is-error',Boolean(voiceError));
    const finishing=Boolean(voiceCompletion)||voiceState==='transcribing';
    root.querySelector('.voice-send').disabled=!voiceText.trim() || voiceState==='requesting' || finishing || pending;
    root.querySelector('.voice-edit').disabled=!voiceText.trim() || busyVoice;
    root.querySelector('.voice-edit').hidden=busyVoice;
    root.querySelector('.voice-retry').disabled=busyVoice;
    root.querySelector('.voice-retry').hidden=busyVoice;
    root.querySelector('.voice-review-actions').hidden=false;
    root.querySelector('.voice-stop').hidden=!busyVoice;
    root.querySelector('.voice-stop').disabled=voiceState!=='listening'||finishing;
    root.querySelector('.voice-stop').textContent=finishing?'Finishing…':'Finish';
    mic.setAttribute('aria-label',busyVoice?'Stop voice input':'Start voice input');
    mic.setAttribute('aria-pressed',String(busyVoice));
    mic.disabled=mode==='text' || voicePanelOpen || pending;
    mic.tabIndex=mode==='text'||voicePanelOpen?-1:0;
    mic.setAttribute('aria-hidden',String(mode==='text'||voicePanelOpen));
    mic.querySelector('.voice-tap-label').textContent=voiceState==='listening'?'Tap to stop':voiceState==='transcribing'?'Transcribing…':voiceState==='requesting'?'Connecting…':'Tap to speak';
    root.querySelector('.companion-empty').hidden=messages.length>0 || voicePanelOpen || mode==='text';
    root.querySelector('.companion-text-composer').hidden=mode!=='text';
    root.querySelector('.companion-type').setAttribute('aria-label',mode==='text'?(input.value.trim()?'Continue voice input':'Start voice input'):'Type a message');
    root.querySelector('.companion-type').innerHTML=mode==='text'?`${icon('mic')}<span>${input.value.trim()?'Continue':'Speak'}</span>`:keyboardIcon;
    root.querySelector('.companion-type').disabled=finishing||voiceState==='requesting'||pending;
    root.querySelector('.companion-record-again').hidden=mode!=='text'||!voiceDraft;
    root.querySelector('.companion-record-again').disabled=pending;
    root.querySelector('.companion-send').disabled=pending || !input.value.trim();
    const cancel = root.querySelector('[data-companion-cancel]');
    cancel.hidden=mode!=='text' && !voicePanelOpen && !busyVoice;
    cancel.setAttribute('aria-label',mode==='text'?'Cancel message input':'Cancel voice input');
  }

  function cancelInput({ notify = false } = {}) {
    inputGeneration++;
    voiceCompletion=null;voiceBase='';voiceDraft=false;
    voice.cancel();
    voiceState='idle';voiceText='';voiceError='';voiceEngine='';voiceLive='';voiceLevel=null;voicePanelOpen=false;mode='voice';
    if(input){input.value='';input.style.height='';input.blur();}
    if(voiceConsentOpen){voiceConsentOpen=false;closeSheet();}
    updateVoice();
    if(notify)onInputCancel();
  }
  function deactivate() {
    waterWaves?.setActive(false);
    cancelInput();
  }
  function setTextMode(withTranscript = false) {
    inputGeneration++;
    voiceCompletion=null;
    voice.cancel();
    mode='text';
    if(withTranscript)input.value=voiceText;
    input.style.height='auto';
    input.style.height=`${Math.min(input.scrollHeight,170)}px`;
    voicePanelOpen=false;
    voiceError='';
    updateVoice();
    input.focus({preventScroll:true});
    onTextMode();
  }
  function finishVoice(action) {
    if(voiceState!=='listening'||voiceCompletion||pending||(action==='send'&&!voiceText.trim()))return;
    voiceCompletion={action,input:inputGeneration,account:accountGeneration};
    updateVoice();
    voice.stop();
  }
  function startVoice(base = '') {
    closeSheet();
    voiceCompletion=null;
    voice.cancel();
    mode='voice';voiceBase=String(base).slice(0,1600);voiceDraft=true;
    voiceText=voiceBase;voiceError='';voicePanelOpen=true;
    input.value='';input.style.height='';input.blur();
    updateVoice();
    voice.start();
  }
  function requestVoice({restart=false} = {}) {
    if(['requesting','listening'].includes(voiceState)){finishVoice('edit');return;}
    if(voiceState==='transcribing'||voiceCompletion||pending)return;
    const base=restart?'':mode==='text'?input.value:voiceText;
    const generation=accountGeneration, inputRequest=++inputGeneration, key=consentKey(VOICE_CONSENT_KEY);
    if(sessionRead(key)==='yes'){startVoice(base);return;}
    voiceConsentOpen=true;
    openSheet({title:'Voice input',body:`<div class="companion-disclosure"><p>Audio is sent to our AI speech service while you speak, so your words appear as you go.</p><p>Tap Send to send your words, or Finish to edit them first. Cancel stops the microphone and discards the draft.</p><button type="button" class="button primary" data-enable-voice>Enable microphone</button><button type="button" class="button secondary" data-type-instead>Type instead</button></div>`,onOpen(dialog){
      dialog.querySelector('[data-enable-voice]').addEventListener('click',()=>{if(generation!==accountGeneration||inputRequest!==inputGeneration)return;sessionWrite(key,'yes');startVoice(base);});
      dialog.querySelector('[data-type-instead]').addEventListener('click',()=>{if(generation!==accountGeneration||inputRequest!==inputGeneration)return;closeSheet();setTextMode();});
    },onClose(){voiceConsentOpen=false;}});
  }

  function messageElement(message,{reveal=false}={}) {
    const item=document.createElement('article');item.className=`chat-message chat-message--${message.role}`;item.dataset.message=String(message.id);
    const bubble=document.createElement('div');bubble.className='chat-bubble';
    if(message.pending){bubble.classList.add('is-pending');bubble.innerHTML=replyParticles();}
    else{const text=document.createElement('p');paintWords(text,message.text,{reveal:reveal&&message.role==='assistant'});bubble.append(text);if(reveal&&message.role==='assistant')item.classList.add('is-materializing');}
    if(message.role==='assistant'&&!message.pending){
      if(['ai','device','note'].includes(message.source)){
        const actions=document.createElement('div');actions.className='chat-message-actions';
        const like=document.createElement('button');like.type='button';like.className='chat-helpful';like.innerHTML='<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 5c-3-3-6-1-8 1-2-2-5-4-8-1s-2 6 1 9l7 6 7-6c3-3 4-6 1-9Z"/></svg>';
        like.setAttribute('aria-label','Mark reply as helpful');like.setAttribute('aria-pressed',String(Boolean(message.liked)));
        like.addEventListener('click',()=>{message.liked=!message.liked;like.setAttribute('aria-pressed',String(message.liked));persistMessages();});
        const more=document.createElement('button');more.type='button';more.className='chat-more';more.innerHTML=icon('plus');more.setAttribute('aria-label','Reply actions');more.setAttribute('aria-expanded','false');
        const menu=document.createElement('div');menu.className='chat-reply-menu';menu.hidden=true;
        const copy=document.createElement('button');copy.type='button';copy.textContent='Copy reply';copy.addEventListener('click',async()=>{try{await navigator.clipboard.writeText(message.text);toast('Reply copied.');}catch{toast('Could not copy. Select the reply to copy it.');}menu.hidden=true;more.setAttribute('aria-expanded','false');});
        menu.append(copy);more.addEventListener('click',()=>{menu.hidden=!menu.hidden;more.setAttribute('aria-expanded',String(!menu.hidden));});
        actions.append(like,more,menu);bubble.append(actions);
      }
      const source=document.createElement('small');source.className='chat-source';source.textContent={ai:'AI · may be inaccurate',device:'Device data',note:'Local draft · review before saving',offline:'AI unavailable',auth:'Sign-in required',safety:'Safety guidance'}[message.source]||'AI unavailable';bubble.append(source);
    }
    if(message.draft){
      const preview=document.createElement('div');preview.className='chat-draft-preview';
      const title=document.createElement('strong');title.textContent=message.draft.title;
      const button=document.createElement('button');button.type='button';button.className='chat-draft-button';button.innerHTML=`${icon(message.saved?'check':'card')}<span>${message.saved?'Saved':'Review note'}</span>`;button.disabled=Boolean(message.saved);button.addEventListener('click',()=>reviewDraft(message));
      preview.append(title,button);bubble.append(preview);
    }
    if(message.retryText){const retry=document.createElement('button');retry.type='button';retry.className='chat-retry';retry.textContent='Try again';retry.addEventListener('click',()=>retryMessage(message));bubble.append(retry);}
    if(message.signInPath){const link=document.createElement('a');link.className='chat-retry';link.href=message.signInPath;link.target='_top';link.textContent='Sign in to use AI';bubble.append(link);}
    item.append(bubble);return item;
  }
  function repaintMessage(message){if(!messages.includes(message))return;log.querySelector(`[data-message="${message.id}"]`)?.replaceWith(messageElement(message,{reveal:message.role==='assistant'&&!message.pending}));log.scrollTop=log.scrollHeight;persistMessages();updateVoice();}
  function appendMessage(role,text,draft,source='offline') {
    const message={id:++messageNumber,role,text,source,...(draft?{draft}:{})};messages.push(message);
    if(messages.length>40){const removed=messages.shift();log.querySelector(`[data-message="${removed.id}"]`)?.remove();}
    log.append(messageElement(message,{reveal:role==='assistant'}));log.scrollTop=log.scrollHeight;persistMessages();updateVoice();return message;
  }
  function animateSentDraft(message,from) {
    // Move the actual sent message from the live words into its conversation
    // position, rather than flash a second, decorative copy of the words.
    if(!from?.width||window.matchMedia('(prefers-reduced-motion: reduce)').matches)return;
    const bubble=log.querySelector(`[data-message="${message.id}"] .chat-bubble`);
    if(!bubble?.animate)return;
    const to=bubble.getBoundingClientRect();if(!to.width||!to.height)return;
    const scale=Math.max(.65,Math.min(1.15,from.width/to.width));
    bubble.animate([
      {transform:`translate(${from.left-to.left}px,${from.top-to.top}px) scale(${scale})`,opacity:.72,filter:'blur(3px)',borderRadius:'22px'},
      {transform:'translate(0,0) scale(1)',opacity:1,filter:'blur(0px)',borderRadius:'22px'},
    ],{duration:780,easing:'cubic-bezier(.16,.76,.22,1)',fill:'none'});
  }
  function reviewDraft(message) {
    const generation=accountGeneration;
    if (message.saved || !messages.includes(message)) return;
    const draft = message.draft;
    const typeOptions = recordTypes.map(([value, label]) => `<option value="${value}" ${draft.type === value ? 'selected' : ''}>${label}</option>`).join('');
    openSheet({
      title: 'Review note',
      eyebrow: 'OWNER RECORD',
      body: `<form class="chat-draft-form">
        <p class="chat-review-intro">Check the extracted details before adding them to ${escapeHTML(petName())}’s health card.</p>
        <label class="field">Record type<select name="type" class="input">${typeOptions}</select></label>
        <label class="field">Title<input name="title" class="input" value="${escapeHTML(draft.title)}" maxlength="90" required></label>
        <label class="field">Date and time<input name="date" class="input" type="datetime-local" value="${escapeHTML(draft.date)}" required></label>
        <p class="chat-time-hint">${escapeHTML(draft.timeHint)}</p>
        <label class="field">Details<textarea name="details" class="input" rows="4" maxlength="1600" required>${escapeHTML(draft.details)}</textarea></label>
        <label class="field chat-dose-field" ${draft.type !== 'medication' ? 'hidden' : ''}>Recorded amount <span class="chat-optional">optional</span><input name="dose" class="input" value="${escapeHTML(draft.dose)}" maxlength="80" placeholder="Copy the amount actually given"></label>
        <p class="chat-form-error" role="alert"></p>
        <button type="submit" class="button primary chat-save-button">${icon('check')}Save to health card</button>
      </form>`,
      onOpen(dialog) {
        const form = dialog.querySelector('.chat-draft-form');
        form.elements.type.addEventListener('change', () => {
          form.querySelector('.chat-dose-field').hidden = form.elements.type.value !== 'medication';
        });
        form.addEventListener('submit', event => {
          event.preventDefault();
          if (generation!==accountGeneration || message.saved || !messages.includes(message)) return;
          const fields = new FormData(form);
          const title = fields.get('title').trim();
          const details = fields.get('details').trim();
          const date = new Date(fields.get('date'));
          if (!title || !details || !Number.isFinite(date.valueOf())) {
            form.querySelector('.chat-form-error').textContent = 'Add a title, details and a valid date.';
            return;
          }
          const entry = {
            id: typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `note-${Date.now()}-${message.id}`,
            type: fields.get('type'),
            title,
            date: date.toISOString(),
            details,
            author: 'Owner',
          };
          if (entry.type === 'medication' && fields.get('dose').trim()) entry.dose = fields.get('dose').trim();
          const store = getStore();
          if (!persist({ ...store, records: [...store.records, entry] })) {
            form.querySelector('.chat-form-error').textContent = 'This note could not be saved in this browser. Please try again.';
            return;
          }
          message.saved = true;
          message.draft = { ...draft, title, details, type: entry.type, date: fields.get('date') };
          log.querySelector(`[data-message="${message.id}"]`)?.replaceWith(messageElement(message));
          closeSheet();
          onChange();
          toast('Health note saved.');
          persistMessages();
          appendMessage('assistant', 'Saved to the health card.', undefined, 'note');
        });
      },
    });
  }


  function deviceReply(text) {
    return companionDeviceReply(text,getSnapshot(),petName());
  }
  function requestContext() {
    return companionHealthContext(getStore(),getSnapshot());
  }
  async function requestAssistant(userMessage, answer) {
    const generation=accountGeneration;
    answer ||= appendMessage('assistant','',undefined,'ai');
    if(!messages.includes(answer))return;
    answer.pending=true;delete answer.retryText;delete answer.signInPath;repaintMessage(answer);
    const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),45000);chatController=controller;
    const isCurrent=()=>generation===accountGeneration && messages.includes(answer);
    try{
      const history=messages.filter(item=>item.id<=userMessage.id && !item.pending && (item.role==='user'||!['offline','auth'].includes(item.source))).slice(-16).map(item=>({role:item.role,content:item.text.slice(0,4000)}));
      while(history.length>1 && history.reduce((total,item)=>total+item.content.length,0)>16000)history.shift();
      const response=await fetch('/api/chat',{method:'POST',headers:{'Content-Type':'application/json',Accept:'application/json',...(isTestAccount?{'X-Pawprint-Test-Mode':'1'}:{})},credentials:'same-origin',body:JSON.stringify({messages:history.length?history:[{role:'user',content:userMessage.text}],context:requestContext()}),signal:controller.signal});
      if(!isCurrent())return;
      const result=await response.json().catch(()=>({}));
      if(!isCurrent())return;
      if(!response.ok){
        const providerMessages={provider_authentication:'The AI service credentials need attention. Device data and local health notes still work.',provider_quota:'The AI service has reached its usage limit. Try again later. Device data and local health notes still work.',provider_access_denied:'The AI service does not have access to this model. Device data and local health notes still work.',provider_model_unavailable:'The AI model is unavailable. Please try again later.',provider_busy:'AI is busy right now. Try again in a moment.',provider_timeout:'AI took too long to respond. Try again when you’re ready.',provider_unavailable:'The AI service is temporarily unavailable. Please try again later.',authentication_unavailable:'Sign-in could not be checked. Please try again shortly.'};
        const providerMessage=typeof result.code==='string' && Object.hasOwn(providerMessages,result.code)?providerMessages[result.code]:'';
        const needsSignIn=response.status===401 && !providerMessage;
        const explanation=providerMessage || ({401:'Sign in to use AI. Your message has not received an AI reply.',403:'AI is not available for this account. Device data and health notes still work.',429:'AI is busy right now. Try again in a moment.',503:'AI is not connected right now. Device data and health notes still work.'}[response.status]) || 'AI could not answer this time. Your message is still here.';
        answer.text=needsSignIn && isTestAccount?unavailableText({requiresSignIn:true}):explanation;answer.source=needsSignIn?'auth':'offline';answer.retryText=userMessage.text;answer.retryUserId=userMessage.id;answer.signInPath=needsSignIn?safeSignInPath(result.signInPath)||aiSignInPath:'';
        if(needsSignIn){capabilities={...capabilities,chat:false,transcription:false,authenticated:false,requiresSignIn:true,signInPath:answer.signInPath};aiSignInPath=answer.signInPath;capabilityCheckedAt=0;}
      }else if(typeof result.reply==='string' && result.reply.trim()){
        answer.text=result.reply.trim().slice(0,16000);answer.source='ai';
      }else{
        answer.text='AI returned an empty reply. You can try again.';answer.source='offline';answer.retryText=userMessage.text;answer.retryUserId=userMessage.id;
      }
    }catch(error){
      if(!isCurrent())return;
      answer.text=error?.name==='AbortError'?'AI took too long to respond. Try again when you’re ready.':'Could not reach AI. Check your connection and try again.';
      answer.source='offline';answer.retryText=userMessage.text;answer.retryUserId=userMessage.id;
    }finally{
      clearTimeout(timeout);
      if(chatController===controller)chatController=null;
      if(isCurrent()){answer.pending=false;pending=false;repaintMessage(answer);}
    }
  }
  function withAIConsent(userMessage,answer) {
    const generation=accountGeneration,key=consentKey(AI_CONSENT_KEY);
    if(sessionRead(key)==='yes'){requestAssistant(userMessage,answer);return;}
    let agreed=false;
    openSheet({title:'Connect to AI',body:`<div class="companion-disclosure"><p>Your message, pet profile, readings and up to 12 recent health records will be sent to our AI service.</p><p>AI can be wrong. Check important concerns with your vet. Nothing is added to the health card without your review.</p><button type="button" class="button primary" data-connect-ai>Continue</button><button type="button" class="button secondary" data-cancel-ai>Cancel</button></div>`,onOpen(dialog){
      dialog.querySelector('[data-connect-ai]').addEventListener('click',()=>{if(generation!==accountGeneration)return;agreed=true;sessionWrite(key,'yes');closeSheet();requestAssistant(userMessage,answer);});
      dialog.querySelector('[data-cancel-ai]').addEventListener('click',()=>{if(generation===accountGeneration)closeSheet();});
    },onClose(){if(generation===accountGeneration&&!agreed){pending=false;appendMessage('assistant','Not sent to AI.',undefined,'offline');updateVoice();}}});
  }
  async function retryMessage(message) {
    if(pending||!messages.includes(message))return;
    const generation=accountGeneration;
    pending=true;updateVoice();
    const available=await loadCapabilities(true);
    if(generation!==accountGeneration||!messages.includes(message)||!available)return;
    if(!available.chat){pending=false;applyUnavailable(message,available);repaintMessage(message);return;}
    const userMessage=messages.find(item=>item.id===message.retryUserId)||{id:message.id-1,role:'user',text:message.retryText};
    withAIConsent(userMessage,message);
  }
  async function submitText(text) {
    const clean=String(text||'').trim().slice(0,1600);
    if(!clean||pending)return;
    const generation=accountGeneration;
    const sourceRect=(voicePanelOpen?transcript:input)?.getBoundingClientRect();
    inputGeneration++;voiceCompletion=null;voiceBase='';voiceDraft=false;
    pending=true;voice.cancel();voiceState='idle';voicePanelOpen=false;voiceText='';voiceError='';mode='voice';
    input.value='';input.style.height='';input.blur();
    const userMessage=appendMessage('user',clean);
    animateSentDraft(userMessage,sourceRect);
    const urgent=emergencyReply(clean);
    if(urgent){pending=false;appendMessage('assistant',urgent,undefined,'safety');return;}
    if(isHealthNoteRequest(clean)){
      pending=false;
      if(clean.length<20 || /^(?:please )?(?:log|record|save|add)(?: a)? (?:health )?note[.!]?$/i.test(clean))appendMessage('assistant','Tell me what happened, when, and any amount or frequency. I’ll prepare a note for you to review.',undefined,'note');
      else appendMessage('assistant','Check these details before saving.',draftFromNote(clean),'note');
      return;
    }
    const available=await loadCapabilities();
    if(generation!==accountGeneration||!messages.includes(userMessage)||!available)return;
    if(!available.chat){
      pending=false;
      const local=deviceReply(clean);
      if(local)appendMessage('assistant',local,undefined,'device');
      else{const answer=appendMessage('assistant',unavailableText(available),undefined,available.requiresSignIn?'auth':'offline');answer.retryText=clean;answer.retryUserId=userMessage.id;answer.signInPath=available.requiresSignIn?safeSignInPath(available.signInPath):'';repaintMessage(answer);}
      return;
    }
    withAIConsent(userMessage);
  }
  function showHistory(){
    if(!messages.length){toast('No messages yet.');return;}
    openSheet({title:'Conversation',body:`<div class="companion-history">${messages.filter(item=>!item.pending).map(item=>`<button type="button" data-jump-message="${item.id}"><span>${item.role==='user'?'You':item.source==='ai'?'AI':item.source==='device'?'Device data':'Companion'}</span><p>${escapeHTML(item.text.slice(0,120))}${item.text.length>120?'…':''}</p></button>`).join('')}</div>`,onOpen(dialog){dialog.querySelectorAll('[data-jump-message]').forEach(button=>button.addEventListener('click',()=>{closeSheet();voicePanelOpen=false;mode='voice';updateVoice();log.querySelector(`[data-message="${button.dataset.jumpMessage}"]`)?.scrollIntoView({block:'center',behavior:'smooth'});}));}});
  }
  function render() {
    if(mounted){waterWaves?.setActive(true);updateVoice();loadCapabilities();return;}
    mounted=true;root.classList.add('chat-root');
    root.innerHTML=`<div class="companion-scene" data-mode="voice" data-voice="idle">
      <div class="companion-ambient" aria-hidden="true"></div><canvas class="companion-water" aria-hidden="true"></canvas>
      <div class="companion-tools"><span class="companion-connection" role="status">Connecting…</span><button type="button" class="companion-history-button" aria-label="Conversation history">${historyIcon}</button></div>
      <button type="button" class="companion-empty">What’s on your mind?</button>
      <div class="chat-log" role="log" aria-live="polite" aria-relevant="additions" aria-label="Conversation"></div>
      <div class="voice-panel" hidden><p class="chat-voice-status" role="status"></p><p class="voice-transcript" aria-label="Live voice transcript" aria-live="polite" aria-atomic="true"></p><div class="voice-review-actions"><button type="button" class="voice-stop" aria-label="Finish recording and edit">Finish</button><button class="voice-retry" type="button" aria-label="Record again">${icon('refresh')}<span>Record again</span></button><button class="voice-edit" type="button">Edit</button><button class="voice-send" type="button">Send ${icon('arrow-right')}</button></div></div>
      <div class="companion-bottom"><form class="companion-text-composer" hidden><textarea rows="1" maxlength="1600" aria-label="Message Companion" placeholder="Message…"></textarea><button type="submit" class="companion-send" aria-label="Send message">${icon('arrow-right')}</button></form><div class="companion-input-controls"><button type="button" class="companion-type" aria-label="Type a message">${keyboardIcon}</button><button type="button" class="companion-voice" aria-label="Start voice input" aria-pressed="false"><span class="voice-core" aria-hidden="true">${icon('mic')}</span><span class="voice-tap-label">Tap to speak</span></button><button type="button" class="companion-record-again" aria-label="Discard draft and record again" hidden>${icon('refresh')}<span>Record again</span></button><span class="companion-control-spacer"><button type="button" class="companion-cancel" data-companion-cancel hidden>${icon('close')}<span>Cancel</span></button></span></div></div>
    </div>`;
    scene=root.querySelector('.companion-scene');log=root.querySelector('.chat-log');input=root.querySelector('.companion-text-composer textarea');mic=root.querySelector('.companion-voice');status=root.querySelector('.chat-voice-status');transcript=root.querySelector('.voice-transcript');voicePanel=root.querySelector('.voice-panel');controls=root.querySelector('.companion-input-controls');
    waterWaves=mountCompanionRipples(root.querySelector('.companion-water'));
    log.append(...messages.map(messageElement));
    root.querySelector('.companion-text-composer').addEventListener('submit',event=>{event.preventDefault();submitText(input.value);});
    input.addEventListener('input',()=>{input.style.height='auto';input.style.height=`${Math.min(input.scrollHeight,170)}px`;updateVoice();});
    input.addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();cancelInput({notify:true});}else if(event.key==='Enter'&&!event.shiftKey&&!event.isComposing){event.preventDefault();submitText(input.value);}});
    root.querySelector('.companion-type').addEventListener('click',()=>{if(mode==='text')requestVoice();else if(voiceState==='listening')finishVoice('edit');else setTextMode(voicePanelOpen);});
    root.querySelector('.companion-record-again').addEventListener('click',()=>requestVoice({restart:true}));
    root.querySelector('[data-companion-cancel]').addEventListener('click',()=>cancelInput({notify:true}));
    mic.addEventListener('click',requestVoice);root.querySelector('.companion-empty').addEventListener('click',requestVoice);
    root.querySelector('.voice-stop').addEventListener('click',()=>finishVoice('edit'));
    root.querySelector('.voice-retry').addEventListener('click',()=>requestVoice({restart:true}));
    root.querySelector('.voice-edit').addEventListener('click',()=>setTextMode(true));
    root.querySelector('.voice-send').addEventListener('click',()=>{if(voiceState==='listening')finishVoice('send');else if(!['requesting','transcribing'].includes(voiceState)&&!voiceCompletion)submitText(voiceText);});
    root.querySelector('.companion-history-button').addEventListener('click',showHistory);
    updateVoice();loadCapabilities();log.scrollTop=log.scrollHeight;
  }
  document.addEventListener('visibilitychange',()=>{if(document.hidden)deactivate();else if(root.closest('.screen')?.getAttribute('aria-hidden')!=='true' && !root.closest('[hidden]')){waterWaves?.setActive(true);if(mounted)loadCapabilities(true);}});
  function setAccount(account) {
    accountGeneration++;
    capabilityRequest++;
    capabilityController?.abort();capabilityController=null;capabilityPromise=null;
    chatController?.abort();chatController=null;
    capabilityLoaded=false;capabilityCheckedAt=0;aiSignInPath='';
    capabilities={configured:false,authenticated:false,requiresSignIn:false,chat:false,transcription:false};
    consentScope=account?.demo?'demo':String(account?.id||'guest');
    isTestAccount=account?.isTest===true;
    deactivate();
    sessionKey=account?.demo ? CHAT_KEY : `${CHAT_KEY}:${String(account?.id || 'guest')}`;
    messages.splice(0,messages.length,...readMessages(sessionKey));
    messageNumber=messages.length;pending=false;voiceText='';voiceError='';voicePanelOpen=false;mode='voice';
    if(mounted){input.value='';input.style.height='';log.replaceChildren(...messages.map(messageElement));updateVoice();loadCapabilities(true);}
  }
  return {render,deactivate,setAccount,cancelInput};
}
