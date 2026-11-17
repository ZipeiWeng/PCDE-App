import test from 'node:test';
import assert from 'node:assert/strict';
import { createPCMResampler, createRealtimeTranscription } from '../dist/realtime-transcription.js';
import { createVoiceInput } from '../dist/voice-input.js';

const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

function fixture(t, { adapter = false, speech = false, worklet = false, sampleRate = 48000, fetchImpl, getMedia, capabilities } = {}) {
  const globals = new Map(), sockets = [], contexts = [], tracks = [], requests = [], recognitions = [], worklets = [], events = new Map();
  const states = [], transcripts = [], errors = [], levels = [];
  const set = (key, value) => { globals.set(key, Object.getOwnPropertyDescriptor(globalThis, key)); Object.defineProperty(globalThis, key, { configurable: true, writable: true, value }); };
  const node = () => ({ connect() {}, disconnect() { this.disconnected = true; } });
  class AudioContext {
    sampleRate = sampleRate;
    destination = {};
    constructor() { contexts.push(this); if (worklet) this.audioWorklet = { addModule: async () => {} }; }
    createMediaStreamSource() { this.source = node(); return this.source; }
    createGain() { return { ...node(), gain: { value: 1 } }; }
    createScriptProcessor() { this.processor = node(); return this.processor; }
    resume() { this.resumed = true; return Promise.resolve(); }
    close() { this.closed = true; return Promise.resolve(); }
    feed(samples) {
      if (worklet) worklets.at(-1)?.port.onmessage?.({ data: samples });
      else this.processor?.onaudioprocess?.({ inputBuffer: { getChannelData: () => samples } });
    }
  }
  class Worklet {
    port = { close() { this.closed = true; } };
    constructor() { worklets.push(this); }
    connect() {}
    disconnect() { this.disconnected = true; }
  }
  class WebSocket {
    readyState = 0; bufferedAmount = 0; sent = [];
    constructor(url, protocols) { this.url = url; this.protocols = protocols; sockets.push(this); }
    open() { this.readyState = 1; this.onopen?.(); }
    message(value) { this.onmessage?.({ data: JSON.stringify(value) }); }
    acknowledge() { this.message({ type: 'session.created', session: { type: 'transcription' } }); }
    send(value) { this.sent.push(JSON.parse(value)); }
    close() { this.readyState = 3; this.closed = true; this.onclose?.(); }
  }
  class Recognition {
    constructor() { recognitions.push(this); }
    start() { this.onstart?.(); }
    abort() { this.aborted = true; }
    stop() { this.stopped = true; }
  }
  set('window', { isSecureContext: true, WebSocket, AudioContext, ...(worklet ? { AudioWorkletNode: Worklet } : {}), ...(speech ? { SpeechRecognition: Recognition } : {}) });
  set('navigator', { language: 'en-GB', mediaDevices: { getUserMedia: getMedia || (async () => { const track = { stop() { this.stopped = true; } }; tracks.push(track); return { getTracks: () => [track] }; }) } });
  set('document', { documentElement: { lang: 'en' }, hidden: false, addEventListener(name, fn) { events.set(name, fn); }, removeEventListener(name) { events.delete(name); } });
  set('cancelAnimationFrame', () => {});
  set('fetch', async (url, init) => { requests.push({ url, ...init }); return fetchImpl ? fetchImpl(url, init) : Response.json({ value: 'ek_ephemeral_test_only', expires_at: 9999999999 }); });
  const callbacks = { onState: value => states.push(value), onTranscript: value => transcripts.push(value), onError: value => errors.push(value), onLevel: value => levels.push(value) };
  const voice = adapter ? createVoiceInput({ ...callbacks, getTestMode: () => true, getCapabilities: capabilities || (async () => ({ configured: true, authenticated: true, transcription: true, realtimeTranscription: true })) }) : createRealtimeTranscription({ ...callbacks, testMode: true });
  t.after(() => { voice.destroy ? voice.destroy() : voice.cancel(); for (const [key, descriptor] of globals) if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; });
  async function connect() {
    const pending = voice.start(); await tick();
    const socket = sockets.at(-1); socket.open(); socket.acknowledge();
    await pending; return socket;
  }
  return { voice, connect, sockets, contexts, tracks, requests, states, transcripts, errors, levels, events, recognitions, worklets };
}

test('real microphone PCM is sent while listening and provider deltas appear before Finish', async t => {
  const f = fixture(t, { adapter: true });
  const socket = await f.connect();
  assert.equal(socket.url, 'wss://api.openai.com/v1/realtime?intent=transcription');
  assert.deepEqual(socket.protocols, ['realtime', 'openai-insecure-api-key.ek_ephemeral_test_only']);
  assert.deepEqual(f.states.at(-1), { state: 'listening', engine: 'server', live: 'realtime' });
  assert.equal(f.requests.length, 1); assert.equal(f.requests[0].url, '/api/transcribe/session');
  assert.equal(f.requests[0].headers['X-Pawprint-Test-Mode'], '1');
  assert.equal(f.requests[0].credentials, 'same-origin'); assert.equal(f.requests[0].body, '{}');
  f.contexts[0].feed(new Float32Array(9600).fill(.25));
  assert.equal(socket.sent.length, 2, '200 ms microphone audio sends two 100 ms packets');
  assert.ok(socket.sent.every(event => event.type === 'input_audio_buffer.append'));
  const pcm = Buffer.from(socket.sent[0].audio, 'base64');
  assert.equal(pcm.length, 2400 * 2); assert.equal(pcm.readInt16LE(0), 8191, '16-bit little-endian PCM comes from actual samples');
  socket.message({ type: 'conversation.item.input_audio_transcription.delta', event_id: 'd1', item_id: 'i1', delta: 'Mochi ' });
  socket.message({ type: 'conversation.item.input_audio_transcription.delta', event_id: 'd2', item_id: 'i1', delta: '今天很好。' });
  assert.deepEqual(f.transcripts.at(-1), { text: 'Mochi 今天很好。', final: false });
  assert.equal(f.states.at(-1).state, 'listening'); assert.equal(f.tracks[0].stopped, undefined);
  assert.equal(socket.sent.some(event => event.type === 'input_audio_buffer.commit'), false);
  assert.equal(f.requests.length, 1, 'no REST recording snapshots or finished recording uploads');
});

test('Finish stops microphone immediately, commits once, then replaces interim text with the final review', async t => {
  const f = fixture(t, { adapter: true, sampleRate: 24000 }); const socket = await f.connect();
  f.contexts[0].feed(new Float32Array(3500).fill(.1));
  socket.message({ type: 'conversation.item.input_audio_transcription.delta', event_id: 'd1', item_id: 'i1', delta: 'feeling' });
  f.voice.stop(); f.voice.stop();
  assert.ok(f.tracks[0].stopped && f.contexts[0].closed); assert.equal(f.states.at(-1).state, 'transcribing');
  assert.equal(socket.sent.filter(event => event.type === 'input_audio_buffer.commit').length, 1);
  assert.equal(socket.sent.at(-2).type, 'input_audio_buffer.append', 'partial audio packet is flushed before commit');
  socket.message({ type: 'input_audio_buffer.committed', item_id: 'i1' });
  socket.message({ type: 'conversation.item.input_audio_transcription.completed', item_id: 'i1', transcript: 'Feeling better.' });
  assert.deepEqual(f.transcripts.at(-1), { text: 'Feeling better.', final: true });
  assert.equal(f.states.at(-1).state, 'review'); assert.ok(socket.closed);
  assert.equal(f.requests.length, 1, 'review never submits a chat message');
});

test('duplicate deltas and late partials do not repeat or overwrite completed words', async t => {
  const f = fixture(t); const socket = await f.connect();
  const delta = { type: 'conversation.item.input_audio_transcription.delta', event_id: 'd1', item_id: 'i1', delta: 'hello' };
  socket.message(delta); socket.message(delta);
  assert.equal(f.transcripts.at(-1).text, 'hello');
  socket.message({ type: 'conversation.item.input_audio_transcription.completed', item_id: 'i1', transcript: 'Hello.' });
  socket.message({ ...delta, event_id: 'd2', delta: ' duplicate' });
  assert.equal(f.transcripts.at(-1).text, 'Hello.');
});

test('transport open does not report live listening until the session is accepted', async t => {
  const f = fixture(t, { adapter: true }); const pending = f.voice.start(); await tick();
  f.sockets[0].open(); await tick();
  assert.equal(f.states.at(-1).state, 'requesting'); assert.equal(f.contexts[0].processor, undefined);
  f.sockets[0].acknowledge(); await pending;
  assert.equal(f.states.at(-1).live, 'realtime');
});

test('cancel closes stream, worklet, context and socket; queued messages cannot resurrect input', async t => {
  const f = fixture(t, { adapter: true, worklet: true }); const socket = await f.connect();
  assert.equal(f.contexts[0].processor, undefined, 'AudioWorklet is used when supported');
  f.contexts[0].feed(new Float32Array(4800).fill(.2));
  const queuedMessage = socket.onmessage, queuedPCM = f.worklets[0].port.onmessage;
  f.voice.cancel(); const count = f.transcripts.length, sent = socket.sent.length;
  queuedMessage({ data: JSON.stringify({ type: 'conversation.item.input_audio_transcription.delta', item_id: 'late', delta: 'stale' }) });
  queuedPCM({ data: new Float32Array(4800).fill(.2) });
  assert.equal(f.transcripts.length, count); assert.equal(socket.sent.length, sent);
  assert.ok(f.tracks[0].stopped && f.contexts[0].closed && socket.closed && f.worklets[0].port.closed && f.worklets[0].disconnected);
  assert.equal(f.requests[0].signal.aborted, true); assert.equal(f.states.at(-1).state, 'idle');
});

test('cancel during a permission prompt stops the late microphone without minting a token', async t => {
  const media = deferred(), track = { stop() { this.stopped = true; } };
  const f = fixture(t, { adapter: true, getMedia: () => media.promise }); const pending = f.voice.start(); await tick();
  f.voice.cancel(); media.resolve({ getTracks: () => [track] }); await pending;
  assert.ok(track.stopped && f.contexts[0].closed); assert.equal(f.requests.length, 0); assert.equal(f.sockets.length, 0);
});

test('Safari audio is unlocked in the tap before asynchronous capability checks; denial closes it without microphone capture', async t => {
  const capability = deferred();
  const f = fixture(t, { adapter: true, capabilities: () => capability.promise });
  const pending = f.voice.start();
  assert.equal(f.contexts.length, 1); assert.equal(f.contexts[0].resumed, true, 'Web Audio resume runs synchronously in the gesture');
  assert.equal(f.tracks.length, 0); assert.equal(f.requests.length, 0);
  capability.resolve({ configured: true, authenticated: false, requiresSignIn: true }); await pending;
  assert.ok(f.contexts[0].closed); assert.equal(f.tracks.length, 0); assert.equal(f.errors.at(-1).code, 'authentication_required');
});

test('cancel during handshake rejects startup and leaves no live state or socket', async t => {
  const f = fixture(t, { adapter: true }); const pending = f.voice.start(); await tick();
  f.voice.cancel(); await pending;
  assert.ok(f.sockets[0].closed && f.tracks[0].stopped); assert.equal(f.states.at(-1).state, 'idle');
  assert.ok(f.states.every(event => event.live !== 'realtime'));
});

test('expired authentication cannot fall back to a browser service or request another microphone', async t => {
  const f = fixture(t, { adapter: true, speech: true, fetchImpl: async () => Response.json({ code: 'authentication_required' }, { status: 401 }) });
  await f.voice.start();
  assert.equal(f.errors.at(-1).code, 'authentication_required');
  assert.equal(f.recognitions.length, 0); assert.equal(f.sockets.length, 0); assert.ok(f.tracks[0].stopped);
  assert.equal(f.states.at(-1).state, 'idle');
});

test('unavailable live model falls back transparently to browser interim recognition', async t => {
  const f = fixture(t, { adapter: true, speech: true, fetchImpl: async () => Response.json({ code: 'provider_model_unavailable' }, { status: 502 }) });
  await f.voice.start();
  assert.equal(f.errors.at(-1).code, 'live-browser-fallback');
  assert.deepEqual(f.states.at(-1), { state: 'listening', engine: 'browser', live: 'browser' });
  assert.equal(f.recognitions[0].interimResults, true); assert.ok(f.tracks[0].stopped);
  f.recognitions[0].onresult({ results: [Object.assign([{ transcript: 'actual browser words' }], { isFinal: false })] });
  assert.deepEqual(f.transcripts.at(-1), { text: 'actual browser words', final: false });
});

test('provider session rejection falls back without ever declaring realtime active', async t => {
  const f = fixture(t, { adapter: true, speech: true }); const pending = f.voice.start(); await tick();
  f.sockets[0].open(); f.sockets[0].message({ type: 'error', error: { message: 'do not leak provider detail' } });
  await pending;
  assert.equal(f.states.at(-1).live, 'browser'); assert.ok(f.sockets[0].closed);
  assert.ok(f.states.every(event => event.live !== 'realtime')); assert.ok(f.errors.every(error => !error.message.includes('provider detail')));
});

test('network failure preserves real partial words for review and releases microphone', async t => {
  const f = fixture(t, { adapter: true }); const socket = await f.connect();
  socket.message({ type: 'conversation.item.input_audio_transcription.delta', item_id: 'i1', delta: 'captured words' });
  socket.onerror();
  assert.equal(f.errors.at(-1).code, 'live-network');
  assert.deepEqual(f.transcripts.at(-1), { text: 'captured words', final: true });
  assert.equal(f.states.at(-1).state, 'review'); assert.ok(f.tracks[0].stopped && socket.closed);
});

test('leaving the page cancels realtime capture instead of keeping its input mode open', async t => {
  const f = fixture(t, { adapter: true }); const socket = await f.connect();
  document.hidden = true; f.events.get('visibilitychange')();
  assert.ok(socket.closed && f.tracks[0].stopped); assert.equal(f.states.at(-1).state, 'idle');
});

test('resampling preserves timing and values across arbitrary 44.1/48 kHz microphone chunk boundaries', () => {
  for (const sampleRate of [24000, 44100, 48000]) {
    const source = Float32Array.from({ length: sampleRate }, (_, i) => Math.sin(i / 47));
    const complete = createPCMResampler(sampleRate)(source);
    const resample = createPCMResampler(sampleRate), chunked = [];
    for (let offset = 0; offset < source.length; offset += 128) chunked.push(...resample(source.subarray(offset, offset + 128)));
    assert.ok(Math.abs(complete.length - 24000) <= 1); assert.ok(Math.abs(chunked.length - complete.length) <= 1);
    for (let i = 0; i < Math.min(complete.length, chunked.length); i++) assert.ok(Math.abs(chunked[i] - complete[i]) < .000001, `sample ${i} at ${sampleRate} Hz is continuous`);
  }
});
