import test from 'node:test';
import assert from 'node:assert/strict';
import { createVoiceInput } from '../dist/voice-input.js';

const flush = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

function fixture(t, { speech = true, pcm = true, worklet = false, capabilities, fetchImpl, getMedia } = {}) {
  const old = new Map(), events = new Map(), recognitions = [], recorders = [], contexts = [], requests = [], tracks = [], worklets = [];
  const set = (key, value) => { old.set(key, Object.getOwnPropertyDescriptor(globalThis, key)); Object.defineProperty(globalThis, key, { configurable: true, writable: true, value }); };
  const node = () => ({ connect() {}, disconnect() { this.disconnected = true; } });
  class AudioContext {
    sampleRate = 16000;
    destination = {};
    constructor() { contexts.push(this); if (worklet) this.audioWorklet = { addModule: async () => {} }; }
    createMediaStreamSource() { return node(); }
    createAnalyser() { return { ...node(), fftSize: 256, getByteTimeDomainData(data) { data.fill(128); } }; }
    createGain() { return { ...node(), gain: { value: 1 } }; }
    createScriptProcessor() { this.processor = node(); return this.processor; }
    resume() { return Promise.resolve(); }
    close() { this.closed = true; return Promise.resolve(); }
    feed(seconds, amplitude = .1) {
      const data = new Float32Array(this.sampleRate * seconds).fill(amplitude);
      if (worklet) worklets.at(-1)?.port.onmessage?.({ data });
      else this.processor?.onaudioprocess?.({ inputBuffer: { getChannelData: () => data } });
    }
  }
  class Worklet {
    constructor() { worklets.push(this); }
    port = { close() { this.closed = true; } };
    connect() {}
    disconnect() { this.disconnected = true; }
  }
  class Recognition {
    constructor() { recognitions.push(this); }
    start() { this.onstart?.(); }
    stop() { this.stopped = true; }
    abort() { this.aborted = true; }
    result(...segments) { this.onresult?.({ results: segments.map(([text, final = false]) => Object.assign([{ transcript: text }], { isFinal: final })) }); }
  }
  class Recorder {
    static isTypeSupported(type) { return type.startsWith('audio/webm'); }
    constructor(stream, options) { this.stream = stream; this.mimeType = options?.mimeType || 'audio/webm'; this.state = 'inactive'; recorders.push(this); }
    start() { this.state = 'recording'; }
    stop() {
      this.state = 'inactive';
      queueMicrotask(() => { this.ondataavailable?.({ data: new Blob([new Uint8Array(100)], { type: this.mimeType }) }); this.onstop?.(); });
    }
  }
  set('window', { isSecureContext: true, MediaRecorder: Recorder, ...(speech ? { SpeechRecognition: Recognition } : {}), ...(pcm ? { AudioContext } : {}), ...(worklet ? { AudioWorkletNode: Worklet } : {}) });
  set('navigator', { language: 'en-GB', mediaDevices: { getUserMedia: getMedia || (async () => { const track = { stop() { this.stopped = true; } }; tracks.push(track); return { getTracks: () => [track] }; }) } });
  set('document', { documentElement: { lang: 'en' }, hidden: false, addEventListener(name, fn) { events.set(name, fn); }, removeEventListener(name) { events.delete(name); } });
  set('requestAnimationFrame', () => 1); set('cancelAnimationFrame', () => {});
  set('fetch', async (url, options) => { requests.push({ url, ...options }); return fetchImpl ? fetchImpl(url, options) : Response.json({ text: 'Mochi 今天很好。' }); });
  const states = [], transcripts = [], errors = [];
  const voice = createVoiceInput({ getCapabilities: capabilities || (async () => ({ authenticated: true, configured: true, transcription: true })), getTestMode: () => true, onState: value => states.push(value), onTranscript: value => transcripts.push(value), onError: value => errors.push(value) });
  t.after(() => { voice.destroy(); for (const [key, descriptor] of old) if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; });
  return { voice, states, transcripts, errors, recognitions, recorders, contexts, requests, tracks, events, worklets };
}

test('browser hypotheses replace interim words during recording; server final detects mixed language', async t => {
  const f = fixture(t);
  await f.voice.start();
  const recognition = f.recognitions[0];
  assert.equal(recognition.interimResults, true); assert.equal(recognition.lang, 'en-GB');
  recognition.result(['Mochi is']); recognition.result(['Mochi is feeling']);
  assert.deepEqual(f.transcripts.at(-1), { text: 'Mochi is feeling', final: false });
  assert.equal(f.states.at(-1).state, 'listening'); assert.equal(f.recorders[0].state, 'recording');
  assert.equal(f.requests.length, 0);
  recognition.result(['Mochi is feeling well.', true], ['今天']);
  assert.equal(f.transcripts.at(-1).text, 'Mochi is feeling well. 今天');
  f.voice.stop(); await flush();
  assert.deepEqual(f.transcripts.at(-1), { text: 'Mochi 今天很好。', final: true });
  assert.equal(f.states.at(-1).state, 'review');
  assert.equal(f.requests[0].body.get('language'), null);
  assert.equal(f.requests[0].credentials, 'same-origin');
  assert.equal(f.requests[0].headers['X-Pawprint-Test-Mode'], '1');
  assert.ok(f.tracks[0].stopped && recognition.aborted);
});

test('without browser speech, playable real PCM snapshots update during recording and remain bounded', async t => {
  const f = fixture(t, { speech: false }); await f.voice.start();
  const context = f.contexts[0];
  context.feed(7); await flush();
  assert.equal(f.recorders[0].state, 'recording'); assert.equal(f.states.at(-1).state, 'listening');
  assert.deepEqual(f.transcripts.at(-1), { text: 'Mochi 今天很好。', final: false });
  const wave = f.requests[0].body.get('audio'); assert.equal(wave.type, 'audio/wav');
  const bytes = await wave.arrayBuffer(), view = new DataView(bytes);
  assert.equal(new TextDecoder().decode(bytes.slice(0, 4)), 'RIFF');
  assert.equal(view.getUint32(24, true), 16000);
  assert.equal(view.getUint32(40, true), 7 * 16000 * 2);
  assert.ok(view.getInt16(44, true) > 0, 'samples come from microphone input, not an empty placeholder');
  context.feed(7); await flush(); context.feed(7); await flush(); context.feed(7); await flush();
  assert.equal(f.requests.length, 3, 'three previews maximum per recording');
  f.voice.stop(); await flush();
  assert.equal(f.requests.length, 4); assert.equal(f.transcripts.at(-1).final, true);
});

test('silent PCM makes no preview calls and recorded fallback never claims realtime captions', async t => {
  const f = fixture(t); await f.voice.start();
  f.recognitions[0].onerror({ error: 'network' });
  assert.equal(f.states.at(-1).live, 'unavailable'); assert.equal(f.errors.length, 0);
  f.contexts[0].feed(7, 0); await flush(); assert.equal(f.requests.length, 0);
  f.contexts[0].feed(1); await flush(); assert.equal(f.requests.length, 1);
});

test('cancel aborts preview and ignores its eventual response, old browser results and queued recording events', async t => {
  const pending = deferred(), f = fixture(t, { fetchImpl: () => pending.promise }); await f.voice.start();
  f.contexts[0].feed(7); await flush();
  const staleResult = f.recognitions[0].onresult;
  f.voice.cancel(); const count = f.transcripts.length;
  assert.equal(f.requests[0].signal.aborted, true); assert.ok(f.tracks[0].stopped);
  pending.resolve(Response.json({ text: 'stale partial' }));
  staleResult({ results: [Object.assign([{ transcript: 'stale browser' }], { isFinal: true })] });
  await flush();
  assert.equal(f.transcripts.length, count); assert.equal(f.states.at(-1).state, 'idle');
  assert.equal(f.requests.length, 1, 'cancelling never launches final transcription');
});

test('stopping aborts a preview; its late response cannot overwrite the final recording', async t => {
  const partial = deferred(); let calls = 0;
  const f = fixture(t, { speech: false, fetchImpl: () => ++calls === 1 ? partial.promise : Response.json({ text: 'final words' }) });
  await f.voice.start(); f.contexts[0].feed(7); await flush();
  f.voice.stop(); await flush(); assert.equal(f.requests[0].signal.aborted, true);
  partial.resolve(Response.json({ text: 'older prefix' })); await flush();
  assert.deepEqual(f.transcripts.at(-1), { text: 'final words', final: true });
  assert.equal(f.states.at(-1).state, 'review');
});

test('a cancelled final request cannot affect a new recording', async t => {
  const pending = deferred(), f = fixture(t, { fetchImpl: () => pending.promise });
  await f.voice.start(); f.voice.stop(); await flush();
  await f.voice.start(); f.recognitions[1].result(['new input']);
  pending.resolve(Response.json({ text: 'old final' })); await flush();
  assert.deepEqual(f.transcripts.at(-1), { text: 'new input', final: false });
  assert.equal(f.states.at(-1).state, 'listening'); assert.equal(f.requests[0].signal.aborted, true);
});

test('a slow preview does not overwrite newer browser words, and rate limiting disables more previews', async t => {
  const pending = deferred(); let calls = 0;
  const f = fixture(t, { fetchImpl: () => ++calls === 1 ? pending.promise : Response.json({ code: 'rate_limited' }, { status: 429 }) });
  await f.voice.start(); f.contexts[0].feed(7); await flush();
  f.recognitions[0].result(['newer browser words']);
  pending.resolve(Response.json({ text: 'older server prefix' })); await flush();
  assert.equal(f.transcripts.at(-1).text, 'newer browser words');
  f.recognitions[0].onerror({ error: 'network' });
  f.contexts[0].feed(7); await flush(); f.contexts[0].feed(7); await flush();
  assert.equal(f.requests.length, 2); assert.equal(f.states.at(-1).live, 'unavailable');
});

test('cancel during permission prompt releases late microphone without starting recorder or speech', async t => {
  const pending = deferred(), track = { stop() { this.stopped = true; } };
  const f = fixture(t, { getMedia: () => pending.promise });
  const start = f.voice.start(); await flush(); f.voice.cancel();
  pending.resolve({ getTracks: () => [track] }); await start;
  assert.equal(track.stopped, true); assert.equal(f.recorders.length, 0); assert.equal(f.recognitions.length, 0);
});

test('capability denial prevents every microphone and recognition request', async t => {
  const f = fixture(t, { capabilities: async () => ({ configured: true, authenticated: false, requiresSignIn: true }) });
  await f.voice.start(); assert.equal(f.tracks.length, 0); assert.equal(f.recognitions.length, 0); assert.equal(f.requests.length, 0);
  assert.equal(f.errors[0].code, 'authentication_required');
});

test('AudioWorklet PCM updates live and cancel disconnects and rejects queued worklet messages', async t => {
  const f = fixture(t, { speech: false, worklet: true }); await f.voice.start(); await flush();
  assert.equal(f.worklets.length, 1); assert.equal(f.contexts[0].processor, undefined, 'modern browsers avoid ScriptProcessor');
  f.contexts[0].feed(7); await flush(); assert.equal(f.requests.length, 1);
  const queued = f.worklets[0].port.onmessage;
  f.voice.cancel(); queued({ data: new Float32Array(16000 * 7).fill(.1) }); await flush();
  assert.equal(f.requests.length, 1); assert.equal(f.worklets[0].disconnected, true); assert.equal(f.worklets[0].port.closed, true);
});
