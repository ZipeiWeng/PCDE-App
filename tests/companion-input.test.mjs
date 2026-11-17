import test from 'node:test';
import assert from 'node:assert/strict';

const flush = () => new Promise(resolve => setImmediate(resolve));
class Surface {
  listeners = new Map(); attributes = new Map(); dataset = {}; style = {}; value = ''; children = []; hidden = false;
  classes = new Set();
  classList = { add: name => this.classes.add(name), remove: name => this.classes.delete(name), toggle: (name, enabled) => enabled ? this.classes.add(name) : this.classes.delete(name), contains: name => this.classes.has(name) };
  addEventListener(type, listener) { if (!this.listeners.has(type)) this.listeners.set(type, []); this.listeners.get(type).push(listener); }
  removeEventListener() {}
  emit(type, event = {}) { this.listeners.get(type)?.forEach(listener => listener(event)); }
  click() { this.emit('click'); }
  setAttribute(name, value) { this.attributes.set(name, value); }
  getAttribute(name) { return this.attributes.get(name); }
  append(...items) { this.children.push(...items); }
  replaceChildren(...items) { this.children = items; }
  focus() { this.focused = true; }
  blur() { this.focused = false; }
  getBoundingClientRect() { return { width: 0, height: 0 }; }
  getContext() { return null; }
  closest() { return null; }
  close() { this.open = false; this.emit('close'); }
  showModal() { this.open = true; }
  scrollIntoView() {}
}

async function fixture(t, { transcribe = () => Response.json({text:'Mochi is doing well.'}) } = {}) {
  const old = new Map(), nodes = new Map(), storage = new Map(), speech = [], tracks = [], requests = [];
  const set = (name, value) => { old.set(name, Object.getOwnPropertyDescriptor(globalThis, name)); Object.defineProperty(globalThis, name, { configurable: true, writable: true, value }); };
  const node = key => { if (!nodes.has(key)) { const value = new Surface(); value.querySelector = selector => node(`${key} ${selector}`); nodes.set(key, value); } return nodes.get(key); };
  const root = node('root'), dialog = node('dialog');
  class Recognition {
    constructor() { speech.push(this); }
    start() { this.onstart?.(); }
    abort() { this.aborted = true; }
    result(text) { this.onresult?.({ results: [Object.assign([{ transcript: text }], { isFinal: false })] }); }
  }
  class Recorder {
    static isTypeSupported() { return true; }
    constructor() { this.mimeType = 'audio/webm'; this.state = 'inactive'; }
    start() { this.state = 'recording'; }
    stop() { this.state = 'inactive';this.ondataavailable?.({data:new Blob(['audio'.repeat(30)],{type:'audio/webm'})}); queueMicrotask(() => this.onstop?.()); }
  }
  set('window', { isSecureContext: true, SpeechRecognition: Recognition, MediaRecorder: Recorder, matchMedia: () => ({ matches: true, addEventListener() {} }), addEventListener() {} });
  set('document', { documentElement: { dataset: {}, lang: 'en' }, getElementById: id => id === 'app-sheet' ? dialog : node(`id:${id}`), addEventListener() {}, removeEventListener() {}, createElement: () => new Surface() });
  set('navigator', { language: 'en', mediaDevices: { getUserMedia: async () => { const track = { stop() { this.stopped = true; } }; tracks.push(track); return { getTracks: () => [track] }; } } });
  set('sessionStorage', { getItem: key => storage.get(key) || null, setItem: (key, value) => storage.set(key, value) });
  set('ResizeObserver', class { observe() {} }); set('requestAnimationFrame', () => 1); set('cancelAnimationFrame', () => {});
  set('fetch', async (url, init) => { requests.push({ url, init });return url==='/api/transcribe'?transcribe(init):Response.json({ configured: true, authenticated: true, chat: true, transcription: true }); });
  storage.set('pawprint.companion.session.v1', JSON.stringify([{ role: 'user', text: 'Saved conversation', source: 'offline' }]));
  storage.set('pawprint.companion.voice-consent.v2:guest', 'yes');
  const { initCompanion } = await import('../dist/companion.js');
  const { openSheet, closeSheet } = await import('../dist/ui.js');
  let opened = 0, cancelled = 0;
  const companion = initCompanion(root, { getStore: () => ({ profile: { name: 'Mochi' } }), getSnapshot: () => ({}), persist() {}, onChange() {}, onTextMode: () => opened++, onInputCancel: () => cancelled++ });
  companion.render(); await flush();
  t.after(() => { companion.deactivate();openSheet({title:'',body:''});closeSheet(); for (const [key, descriptor] of old) if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; });
  return { companion, root, node: selector => node(`root ${selector}`), dialog, speech, tracks, storage, requests, opened: () => opened, cancelled: () => cancelled };
}

test('text mode has visible Cancel, discards draft and closes keyboard without removing conversation', async t => {
  const f = await fixture(t), input = f.node('.companion-text-composer textarea');
  f.node('.companion-type').click(); input.value = 'unsent text'; input.emit('input');
  assert.equal(f.opened(), 1); assert.equal(f.node('[data-companion-cancel]').hidden, false);
  assert.equal(f.node('.companion-text-composer').hidden, false);
  f.node('[data-companion-cancel]').click();
  assert.equal(input.value, ''); assert.equal(input.focused, false);
  assert.equal(f.node('.companion-text-composer').hidden, true); assert.equal(f.node('[data-companion-cancel]').hidden, true);
  assert.equal(f.node('.companion-scene').dataset.mode, 'voice'); assert.equal(f.cancelled(), 1);
  assert.equal(f.node('.chat-log').children.length, 1); assert.match(f.storage.get('pawprint.companion.session.v1'), /Saved conversation/);
  assert.equal(f.requests.some(item => item.url === '/api/chat'), false);
});

test('leaving and returning starts idle instead of reopening text, and does not notify guide of an explicit Cancel', async t => {
  const f = await fixture(t), input = f.node('.companion-text-composer textarea');
  f.node('.companion-type').click(); input.value = 'discard me';
  f.companion.deactivate(); f.companion.render();
  assert.equal(input.value, ''); assert.equal(f.node('.companion-text-composer').hidden, true);
  assert.equal(f.node('.voice-panel').hidden, true); assert.equal(f.node('.companion-scene').dataset.voice, 'idle');
  assert.equal(f.cancelled(), 0); assert.equal(f.node('.chat-log').children.length, 1);
});

test('live voice text is visible; cancel and page exit both release microphone and reject late results', async t => {
  const f = await fixture(t);
  f.node('.companion-voice').click(); await flush();
  f.speech[0].result('words while speaking');
  assert.equal(f.node('.voice-transcript').textContent, 'words while speaking');
  assert.equal(f.node('.voice-transcript').dataset.live, 'true');
  assert.equal(f.node('.voice-send').disabled, false, 'Send is available as soon as live words appear');
  assert.equal(f.node('.voice-stop').hidden, false);
  assert.equal(f.node('.voice-review-actions').hidden, false);
  assert.equal(f.node('.companion-voice').getAttribute('aria-hidden'), 'true', 'the redundant main microphone is hidden during recording');
  assert.equal(f.node('.companion-scene').dataset.voice, 'listening');
  assert.equal(f.node('[data-companion-cancel]').hidden, false);
  const stale = f.speech[0].onresult;
  f.node('[data-companion-cancel]').click();
  stale({ results: [Object.assign([{ transcript: 'late words' }], { isFinal: true })] });
  assert.equal(f.node('.voice-transcript').textContent, ''); assert.equal(f.node('.voice-panel').hidden, true);
  assert.equal(f.tracks[0].stopped, true); assert.equal(f.cancelled(), 1);
  f.node('.companion-voice').click(); await flush(); f.speech[1].result('second draft');
  f.companion.deactivate(); f.companion.render();
  assert.equal(f.tracks[1].stopped, true); assert.equal(f.node('.voice-panel').hidden, true);
  assert.equal(f.node('.voice-transcript').textContent, ''); assert.equal(f.node('.companion-scene').dataset.voice, 'idle');
  assert.equal(f.cancelled(), 1); assert.equal(f.requests.some(item => item.url === '/api/chat'), false);
});

test('Finish opens the final words for editing without sending', async t => {
  const f=await fixture(t),input=f.node('.companion-text-composer textarea');
  f.node('.companion-voice').click();await flush();
  assert.equal(f.node('.voice-send').disabled,true,'empty recording cannot be sent');
  f.speech[0].result('Mochi is doing');
  f.node('.voice-stop').click();
  assert.equal(f.node('.voice-send').disabled,true,'wait for final words');
  await flush();await flush();
  assert.equal(input.value,'Mochi is doing well.');
  assert.equal(input.focused,true);
  assert.equal(f.node('.companion-scene').dataset.mode,'text');
  assert.equal(f.node('.voice-panel').hidden,true);
  assert.equal(f.node('.companion-type').getAttribute('aria-label'),'Continue voice input');
  assert.equal(f.node('.companion-record-again').hidden,false);
  assert.equal(f.node('.chat-log').children.length,1,'finishing a recording does not send it');
  input.value='Edited words';
  f.node('.companion-text-composer').emit('submit',{preventDefault(){}});await flush();
  const messages=JSON.parse(f.storage.get('pawprint.companion.session.v1'));
  assert.equal(messages.at(-1).text,'Edited words');
  assert.equal(f.node('.companion-text-composer').hidden,true);
  assert.equal(f.node('.companion-scene').dataset.mode,'voice');
  assert.equal(f.tracks[0].stopped,true);
});

test('Send while recording waits for final recognition then sends once, without opening edit', async t => {
  let finish;
  const f=await fixture(t,{transcribe:()=>new Promise(resolve=>{finish=resolve;})});
  f.node('.companion-voice').click();await flush();f.speech[0].result('interim words');
  f.node('.voice-send').click();await flush();
  assert.equal(f.node('.voice-send').disabled,true);
  assert.equal(f.node('.voice-stop').disabled,true);
  assert.equal(f.node('[data-companion-cancel]').hidden,false);
  assert.equal(f.node('.chat-log').children.length,1,'do not send the unfinished interim text');
  assert.equal(f.tracks[0].stopped,true);
  f.node('.voice-send').click();
  finish(Response.json({text:'Final recognized words.'}));await flush();await flush();
  const users=JSON.parse(f.storage.get('pawprint.companion.session.v1')).filter(item=>item.role==='user');
  assert.deepEqual(users.map(item=>item.text),['Saved conversation','Final recognized words.']);
  assert.equal(f.opened(),0,'Send has no intervening edit step');
  assert.equal(f.node('.voice-panel').hidden,true);
  assert.equal(f.node('.companion-text-composer').hidden,true);
});

test('Continue appends new speech to the edited draft without duplicating interim text',async t=>{
  const f=await fixture(t),input=f.node('.companion-text-composer textarea');
  f.node('.companion-voice').click();await flush();f.speech[0].result('First recording');
  f.node('.voice-stop').click();await flush();
  input.value='My corrected draft.';input.emit('input');
  f.node('.companion-type').click();await flush();
  assert.equal(input.focused,false);
  assert.equal(f.node('.voice-transcript').textContent,'My corrected draft.');
  f.speech[1].result('New');f.speech[1].result('New words');
  assert.equal(f.node('.voice-transcript').textContent,'My corrected draft. New words');
  f.node('.voice-stop').click();await flush();
  assert.equal(input.value,'My corrected draft. Mochi is doing well.');
  assert.equal(f.node('.chat-log').children.length,1);
});

test('Record again is labelled and clears the old draft before a new recording',async t=>{
  const f=await fixture(t),input=f.node('.companion-text-composer textarea');
  f.node('.companion-voice').click();await flush();f.speech[0].result('Discard these words');
  f.node('.voice-stop').click();await flush();
  input.value='Old edited draft';input.emit('input');
  assert.equal(f.node('.companion-record-again').hidden,false);
  assert.match(f.root.innerHTML,/companion-record-again[^>]*>[\s\S]*?<span>Record again<\/span>/);
  f.node('.companion-record-again').click();await flush();
  assert.equal(input.value,'');
  assert.equal(f.node('.voice-transcript').textContent,'I’m listening…');
  assert.equal(f.node('.voice-send').disabled,true);
  f.speech[1].result('Fresh words');
  assert.equal(f.node('.voice-transcript').textContent,'Fresh words');
  f.node('.voice-stop').click();await flush();
  assert.equal(input.value,'Mochi is doing well.');
  assert.equal(f.node('.chat-log').children.length,1);
});

for(const action of ['cancel','exit','account'])test(`${action} during final recognition discards pending Send and ignores its late result`,async t=>{
  let finish;
  const f=await fixture(t,{transcribe:()=>new Promise(resolve=>{finish=resolve;})});
  f.node('.companion-voice').click();await flush();f.speech[0].result('Pending words');
  f.node('.voice-send').click();await flush();
  const request=f.requests.find(item=>item.url==='/api/transcribe');
  if(action==='cancel')f.node('[data-companion-cancel]').click();
  else if(action==='exit'){f.companion.deactivate();f.companion.render();}
  else f.companion.setAccount({id:'another-account'});
  assert.equal(request.init.signal.aborted,true);
  finish(Response.json({text:'Late words must not send'}));await flush();await flush();
  assert.equal(f.node('.voice-panel').hidden,true);
  assert.equal(f.node('.companion-text-composer').hidden,true);
  assert.equal(f.node('.voice-transcript').textContent,'');
  assert.equal(f.opened(),0);
  assert.equal(f.requests.some(item=>item.url==='/api/chat'),false);
  assert.equal([...f.storage.values()].some(value=>value.includes('Late words must not send')),false);
});

test('failed final recognition cannot send the interim draft',async t=>{
  const f=await fixture(t,{transcribe:()=>Response.json({error:'transcription_failed'},{status:500})});
  f.node('.companion-voice').click();await flush();f.speech[0].result('Unfinished words');
  f.node('.voice-send').click();await flush();
  assert.equal(f.node('.chat-log').children.length,1);
  assert.equal(f.node('.voice-panel').hidden,false);
  assert.equal(f.node('.voice-retry').hidden,false);
  assert.equal(f.node('[data-companion-cancel]').hidden,false);
});

for(const result of ['empty','failed'])test(`Finish opens an editable draft even when final recognition is ${result}`,async t=>{
  const f=await fixture(t,{transcribe:()=>result==='empty'?Response.json({text:''}):Response.json({error:'transcription_failed'},{status:500})});
  f.node('.companion-type').click();const input=f.node('.companion-text-composer textarea');input.value='Keep my edited words.';
  f.node('.companion-type').click();await flush();
  f.node('.voice-stop').click();await flush();
  assert.equal(f.node('.companion-scene').dataset.mode,'text');
  assert.equal(input.value,'Keep my edited words.');
  assert.equal(f.node('.chat-log').children.length,1);
});

test('sending typed words closes the keyboard and leaves a clean input state',async t=>{
  const f=await fixture(t),input=f.node('.companion-text-composer textarea');
  f.node('.companion-type').click();input.value='Record a note';
  f.node('.companion-text-composer').emit('submit',{preventDefault(){}});await flush();
  assert.equal(input.value,'');assert.equal(input.focused,false);
  assert.equal(f.node('.companion-text-composer').hidden,true);
  assert.equal(f.node('[data-companion-cancel]').hidden,true);
  assert.equal(f.node('.companion-scene').dataset.mode,'voice');
  assert.equal(f.node('.chat-log').children.length,3);
});

test('Escape discards text, and the microphone continues an existing typed draft', async t => {
  const f = await fixture(t), input = f.node('.companion-text-composer textarea');
  f.node('.companion-type').click(); input.value = 'draft';
  let prevented = false; input.emit('keydown', { key: 'Escape', preventDefault() { prevented = true; } });
  assert.equal(prevented, true); assert.equal(input.value, ''); assert.equal(f.cancelled(), 1);
  f.node('.companion-type').click(); input.value = 'another draft'; f.node('.companion-type').click();
  await flush();
  assert.equal(input.value, ''); assert.equal(f.cancelled(), 1); assert.equal(f.node('.companion-scene').dataset.mode, 'voice');
  assert.equal(f.node('.voice-transcript').textContent,'another draft');
});

test('live-transmission consent is requested again after old consent; stale enable button cannot restart input after exit', async t => {
  const f = await fixture(t);
  f.storage.delete('pawprint.companion.voice-consent.v2:guest');
  f.storage.set('pawprint.companion.voice-consent.v1:guest', 'yes');
  f.node('.companion-voice').click();
  assert.match(f.dialog.querySelector('.sheet-body').innerHTML, /while you speak/);
  const enable = f.dialog.querySelector('[data-enable-voice]');
  f.companion.deactivate(); enable.click(); await flush();
  assert.equal(f.tracks.length, 0); assert.equal(f.storage.has('pawprint.companion.voice-consent.v2:guest'), false);
});
