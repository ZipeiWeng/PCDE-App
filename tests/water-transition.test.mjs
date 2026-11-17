import test from 'node:test';
import assert from 'node:assert/strict';
import {waterTransitionState,WATER_TRANSITION_DURATION} from '../dist/water-transition.js';

test('water covers the screen before revealing the next page',()=>{
  for(let time=0;time<WATER_TRANSITION_DURATION+100;time+=5){
    const state=waterTransitionState(time);
    if(state.reveal)assert.equal(state.spread,1);
    if(state.coalesce>0)assert.ok(state.reveal);
  }
});
test('impact, fill and coalescence have visible intermediate states and monotonic progress',()=>{
  const values={impact:[],spread:[],coalesce:[]};
  for(let time=0;time<WATER_TRANSITION_DURATION;time+=16){
    const state=waterTransitionState(time);
    for(const name of Object.keys(values))values[name].push(state[name]);
  }
  for(const sequence of Object.values(values)){
    assert.ok(sequence.filter(v=>v>0&&v<1).length>15);
    sequence.forEach((value,i)=>{assert.ok(value>=0&&value<=1);if(i)assert.ok(value>=sequence[i-1]);});
  }
});
test('animation resolves predictably even for oversized or invalid frame timestamps',()=>{
  assert.equal(waterTransitionState(NaN).reveal,false);
  assert.equal(waterTransitionState(-1).spread,0);
  assert.equal(waterTransitionState(WATER_TRANSITION_DURATION-1).done,false);
  const done=waterTransitionState(WATER_TRANSITION_DURATION+60000);
  assert.equal(done.done,true);assert.equal(done.settle,1);assert.equal(done.coalesce,1);
});

test('full transition uses finite canvas geometry, reveals once and restores interactivity',async()=>{
  const {waterTransition}=await import('../dist/water-transition.js');
  const names=['document','window','matchMedia','getComputedStyle','devicePixelRatio','requestAnimationFrame','cancelAnimationFrame','Path2D'];
  const original=Object.fromEntries(names.map(name=>[name,globalThis[name]]));
  const queue=new Map();let rafId=0,reveals=0,removed=false,geometryCalls=0;
  const numeric=(...args)=>{for(const n of args)if(typeof n==='number')assert.ok(Number.isFinite(n),'non-finite drawn coordinate');geometryCalls++;};
  const gradient={addColorStop:numeric};
  const context=new Proxy({}, {get:(_,name)=>String(name).startsWith('create')?(...args)=>{numeric(...args);return gradient;}:numeric,set:()=>true});
  const panels=[0,1].map(index=>({style:{opacity:'',visibility:''},isConnected:true,getBoundingClientRect:()=>({left:24,top:70+index*320,width:342,height:300})}));
  const dialog={style:{opacity:''},inert:false,open:true,scrollTop:0,querySelectorAll:()=>panels,addEventListener(){},removeEventListener(){},append(){},getBoundingClientRect:()=>({left:0,top:0}),querySelector:()=>({focus(){}})};
  const canvas={style:{},dataset:{},setAttribute(){},removeAttribute(){},getContext:()=>context,remove(){removed=true;}};
  const shell={inert:false,getBoundingClientRect:()=>({left:0,top:0,width:390,height:844})};
  try{
    globalThis.document={hidden:false,documentElement:{dataset:{}},createElement:()=>canvas,body:{append(){}},querySelector:()=>reveals?dialog:null,addEventListener(){},removeEventListener(){}};
    globalThis.window={addEventListener(){},removeEventListener(){}};
    globalThis.matchMedia=()=>({matches:false});globalThis.getComputedStyle=()=>({borderRadius:'30px'});globalThis.devicePixelRatio=1;
    globalThis.requestAnimationFrame=callback=>{queue.set(++rafId,callback);return rafId;};globalThis.cancelAnimationFrame=id=>queue.delete(id);
    globalThis.Path2D=class {moveTo(...args){numeric(...args);}quadraticCurveTo(...args){numeric(...args);}bezierCurveTo(...args){numeric(...args);}closePath(){}};
    let now=performance.now();
    const transition=waterTransition({source:{getBoundingClientRect:()=>({left:30,top:210,width:330,height:400})},shell,reveal(){reveals++;}});
    let frames=0;
    while(queue.size&&frames++<200){const [id,callback]=queue.entries().next().value;queue.delete(id);callback(now+=16);}
    await transition;
    assert.equal(reveals,1);assert.ok(geometryCalls>1000);assert.equal(removed,true);assert.equal(shell.inert,false);assert.equal(dialog.inert,false);
    for(const panel of panels)assert.equal(panel.style.opacity,'');
  }finally{
    for(const name of names){if(original[name]===undefined)delete globalThis[name];else globalThis[name]=original[name];}
  }
});
