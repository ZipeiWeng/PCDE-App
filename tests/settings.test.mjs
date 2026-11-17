import test from 'node:test';
import assert from 'node:assert/strict';
import { connectionIndicator, bindFrostControl, cloudDeviceStatus, hardwareAPIContent, refreshCloudRecords } from '../dist/settings.js';
import { createDeviceConnection } from '../dist/device-connection.js';

test('connection indicator distinguishes a demo connection from an actual Bluetooth link', () => {
  assert.deepEqual(connectionIndicator({status:'idle'}, {online:true,demo:true}), {tone:'connected',labelKey:'demoOnline'});
  assert.deepEqual(connectionIndicator({status:'demo'}, {online:true}), {tone:'connected',labelKey:'demoOnline'});
  assert.deepEqual(connectionIndicator({status:'demo'}, {online:false}), {tone:'idle',labelKey:'demoOffline'});
  assert.deepEqual(connectionIndicator({status:'connected'}, {online:false,hasReadings:true}), {tone:'connected',labelKey:'connected'});
});

test('three connection colours distinguish absent, pending, interrupted and failed links', () => {
  for (const status of ['requesting','connecting']) assert.equal(connectionIndicator({status}, {online:true,demo:true}).tone,'pending');
  for (const state of [{status:'error'},{status:'error',error:'timeout'},{status:'error',error:'connection'},{status:'disconnected',disconnection:'lost'}]) {
    assert.equal(connectionIndicator(state,{online:true,demo:true}).tone,'warning');
  }
  for (const state of [{status:'unsupported'},{status:'idle',error:'cancelled'},{status:'error',error:'unsupported'},{status:'unsupported',error:'insecure'},{status:'disconnected',disconnection:'manual'}]) {
    assert.equal(connectionIndicator(state,{online:true,demo:true}).tone,'idle');
  }
  assert.equal(connectionIndicator({status:'idle'},{online:false}).tone,'idle');
});

function fakeCollar() {
  const listeners = new Map();
  const device = {name:'Pawprint One',addEventListener:(event,fn)=>listeners.set(event,fn),removeEventListener:event=>listeners.delete(event)};
  device.gatt={connected:false,async connect(){this.connected=true;return this;},disconnect(){this.connected=false;listeners.get('gattserverdisconnected')?.();}};
  return {device,lose(){device.gatt.connected=false;listeners.get('gattserverdisconnected')?.();}};
}

test('manual disconnect stays disconnected and gray; unexpected transport loss turns amber',async()=>{
  const collar=fakeCollar(),changes=[];
  const connection=createDeviceConnection({bluetooth:{requestDevice:async()=>collar.device},onChange:state=>changes.push(state)});
  await connection.connect();
  assert.equal(connectionIndicator(connection.getState()).tone,'connected');
  collar.lose();
  assert.equal(connection.getState().disconnection,'lost');
  assert.deepEqual(connectionIndicator(connection.getState()),{tone:'warning',labelKey:'connectionLost'});
  await connection.connect();
  assert.equal(connection.getState().disconnection,'');
  connection.disconnect();
  assert.equal(connection.getState().status,'disconnected','idle would restore simulated online state in the app');
  assert.equal(connection.getState().disconnection,'manual');
  assert.equal(connectionIndicator(connection.getState(),{online:true,demo:true}).tone,'idle');
  connection.demo();
  assert.equal(connection.getState().disconnection,'');
  connection.destroy();
});

test('cancelled pairing stays gray while a failed transport shows amber',async()=>{
  const cancelled=createDeviceConnection({bluetooth:{requestDevice:async()=>{throw Object.assign(new Error('cancelled'),{name:'NotFoundError'});}}});
  await cancelled.connect();
  assert.equal(cancelled.getState().status,'idle');
  assert.equal(connectionIndicator(cancelled.getState(),{online:true,demo:true}).tone,'idle');
  cancelled.destroy();
  const collar=fakeCollar();collar.device.gatt.connect=async()=>{throw Object.assign(new Error('lost'),{name:'NetworkError'});};
  const failed=createDeviceConnection({bluetooth:{requestDevice:async()=>collar.device}});
  await failed.connect();
  assert.deepEqual(connectionIndicator(failed.getState()),{tone:'warning',labelKey:'connectionIssue'});
  failed.destroy();
});

test('a new real account never inherits demo connectivity, even if a stale online flag exists',()=>{
  for(const status of [{},{online:true},{online:false},{online:true,demo:false}]){
    assert.deepEqual(connectionIndicator({status:'idle'},status),{tone:'idle',labelKey:'notConnected'});
  }
});

test('Bluetooth transport alone waits for readings instead of claiming a populated data connection',()=>{
  assert.deepEqual(connectionIndicator({status:'connected'},{online:true,hasReadings:false,demo:false}),{tone:'connected',labelKey:'connectedWaiting'});
  assert.deepEqual(connectionIndicator({status:'connected'},{online:true,demo:false}),{tone:'connected',labelKey:'connectedWaiting'});
});

test('a practice demo connection is online without changing real connectivity or ordinary demo offline state',()=>{
  const realStatus={online:false,demo:false,practice:true};
  assert.deepEqual(connectionIndicator({status:'demo'},realStatus),{tone:'connected',labelKey:'demoOnline'});
  assert.equal(realStatus.online,false);
  assert.deepEqual(connectionIndicator({status:'demo'},{online:false,demo:true,practice:false}),{tone:'idle',labelKey:'demoOffline'});
});

function frostSurface() {
  const events={},attributes={},styles={},output={value:''};
  const input={value:'60',addEventListener:(type,handler)=>{events[type]=handler;},setAttribute:(name,value)=>{attributes[name]=value;},style:{setProperty:(name,value)=>{styles[name]=value;}}};
  // Preferences contains no Profile form or Edit photo control.
  const root={querySelector:selector=>{
    if(selector==='[data-frost]')return input;
    if(selector==='[data-frost-value]')return output;
    throw new Error(`Unexpected control lookup: ${selector}`);
  }};
  return {root,input,events,attributes,styles,output};
}

test('Preferences frost binding works without Profile controls, previews immediately and saves on change',async()=>{
  const view=frostSurface(),previews=[],saves=[];let stored=60;
  bindFrostControl(view.root,{getValue:()=>stored,saveValue:async value=>{saves.push(value);stored=value;},onPreview:value=>previews.push(value)});
  assert.equal(view.styles['--frost-progress'],'60%');
  view.input.value='78';view.events.input();
  assert.deepEqual(previews,[78]);assert.deepEqual(saves,[]);
  assert.equal(view.output.value,'78%');assert.equal(view.attributes['aria-valuetext'],'78%');
  await view.events.change();assert.deepEqual(saves,[78]);assert.equal(stored,78);
});

test('a completed frost save cannot update the preview after Preferences closes or rerenders',async()=>{
  const view=frostSurface(),previews=[];let finish,current=true;
  bindFrostControl(view.root,{getValue:()=>85,saveValue:()=>new Promise(resolve=>{finish=resolve;}),onPreview:value=>previews.push(value),isCurrent:()=>current});
  view.input.value='85';const pending=view.events.change();current=false;finish();await pending;
  assert.deepEqual(previews,[]);assert.equal(view.output.value,'');
});


test('cloud upload freshness drives the device indicator independently of browser Bluetooth support',()=>{
  for (const [status,tone,labelKey] of [['waiting','idle','waitingForUpload'],['connected','connected','receivedData'],['stale','warning','noRecentData']]) {
    const cloud={status,source:'device',provisioned:true};
    assert.deepEqual(connectionIndicator({status:'unsupported',error:'unsupported'},{cloud}),{tone,labelKey});
  }
  assert.deepEqual(connectionIndicator({status:'demo'},{practice:true,cloud:{status:'stale'}}),{tone:'connected',labelKey:'demoOnline'},'guided demo remains independent of actual device status');
});

test('seeded example devices and revoked keys cannot claim an actual cloud connection',()=>{
  const seed={id:'seed',status:'connected',source:'test',provisioned:false};
  const revoked={id:'old',status:'revoked',source:'device',provisioned:true};
  assert.equal(cloudDeviceStatus([seed,revoked]),null);
  const waiting={id:'waiting',status:'waiting',provisioned:true};
  const stale={id:'stale',status:'stale',provisioned:true};
  const receiving={id:'active',status:'connected',provisioned:true};
  assert.equal(cloudDeviceStatus([seed,waiting,stale,receiving]),receiving);
  assert.equal(cloudDeviceStatus([waiting,stale]),stale);
});

test('guest hardware section never renders device provisioning or a supplied credential',()=>{
  const html=hardwareAPIContent({authenticated:false},{credential:{uploadToken:'SECRET_SENTINEL',uploadUrl:'https://example.test/upload'}});
  assert.match(html,/Sign in to connect hardware/);
  assert.doesNotMatch(html,/SECRET_SENTINEL|data-hardware-form|data-upload-token/);
});

test('hardware setup escapes labels and one-time secrets and marks test uploads visibly',()=>{
  const html=hardwareAPIContent({authenticated:true,isTest:true,devices:[{id:'device-1',label:'<img src=x onerror=alert(1)>',provisioned:true,source:'test',status:'waiting'}]}, {open:true,credential:{uploadUrl:'https://example.test/api/v1/telemetry',uploadToken:'</textarea><script>secret</script>'}});
  assert.match(html,/Test account · uploads remain example data/);
  assert.match(html,/Waiting for upload/);
  assert.match(html,/only shown once/);
  assert.match(html,/&lt;\/textarea&gt;&lt;script&gt;secret&lt;\/script&gt;/);
  assert.doesNotMatch(html,/<script>|<img src=x/);
  assert.match(html,/data-revoke-upload="device-1"/);
  assert.match(html,/href="\/docs\/hardware-api.html"/);
  assert.doesNotMatch(html,/data-hardware-form/,'new credential cannot be overwritten by creating a second device before Done');
});

test('revoked devices remain visible without another revoke action and seeded data has no token controls',()=>{
  const html=hardwareAPIContent({authenticated:true,devices:[{id:'revoked',label:'Old collar',status:'revoked',provisioned:true},{id:'seed',label:'Examples',status:'connected',source:'test',provisioned:false}]});
  assert.match(html,/Key revoked/);
  assert.match(html,/Example data/);
  assert.doesNotMatch(html,/data-revoke-upload/);
  assert.match(html,/data-hardware-form/);
});


test('manual cloud refresh cannot report success when the repository resolves a failed request as null',async()=>{
  await assert.rejects(refreshCloudRecords({refresh:async()=>null,getState:()=>({error:'Connection unavailable'})}),/Connection unavailable/);
  const result={pet:{revision:4},devices:[],snapshot:{heart:82}};
  assert.equal(await refreshCloudRecords({refresh:async()=>result,getState:()=>({error:''})}),result);
});
