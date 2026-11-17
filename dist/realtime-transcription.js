// Live audio, not a sequence of finished recordings. The project key stays in
// the Worker; a 30-second client secret is held in memory for the handshake.
const RATE = 24000;
const PACKET_SAMPLES = 2400;
const MAX_MS = 120_000;
const WORKLET = `class PawprintLivePCM extends AudioWorkletProcessor {
  process(inputs) {
    if (inputs[0]?.[0]?.length) {
      const samples = inputs[0][0].slice();
      this.port.postMessage(samples, [samples.buffer]);
    }
    return true;
  }
} registerProcessor('pawprint-live-pcm', PawprintLivePCM);`;

export function supportsRealtimeTranscription() {
  return Boolean(window.WebSocket && (window.AudioContext || window.webkitAudioContext) && navigator.mediaDevices?.getUserMedia);
}

// Call synchronously from the user's tap, before capabilities or token fetches.
// Safari otherwise may leave Web Audio suspended after those network awaits.
// This opens no microphone and sends no audio.
export function prepareRealtimeAudio() {
  const Audio = window.AudioContext || window.webkitAudioContext;
  let context;
  try { context = new Audio({ sampleRate: RATE }); }
  catch { context = new Audio(); }
  void context.resume().catch(() => {});
  return context;
}

// Preserve fractional positions across microphone chunks (Safari may capture
// at 44.1/48 kHz even when 24 kHz is requested).
export function createPCMResampler(inputRate) {
  let pending = new Float32Array(), position = 0;
  const ratio = inputRate / RATE;
  return input => {
    const joined = new Float32Array(pending.length + input.length);
    joined.set(pending); joined.set(input, pending.length);
    const output = [];
    while (position + 1 < joined.length) {
      const left = Math.floor(position), fraction = position - left;
      output.push(joined[left] * (1 - fraction) + joined[left + 1] * fraction);
      position += ratio;
    }
    const consumed = Math.min(Math.floor(position), joined.length);
    pending = joined.slice(consumed); position -= consumed;
    return output;
  };
}

function encodedPCM(samples) {
  const bytes = new Uint8Array(samples.length * 2), view = new DataView(bytes.buffer);
  samples.forEach((value, i) => {
    const sample = Math.max(-1, Math.min(1, value));
    view.setInt16(i * 2, sample < 0 ? sample * 32768 : sample * 32767, true);
  });
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 8192) binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  return btoa(binary);
}

export function createRealtimeTranscription({ onState = () => {}, onTranscript = () => {}, onLevel = () => {}, onError = () => {}, testMode = false, audioContext } = {}) {
  let active = true, started = false, stopping = false, socket, stream, context = audioContext, processor, source, silence;
  let controller, timer, finishTimer, openingReject, openingResolve, packets = [], totalSamples = 0, committedItem = null;
  const items = new Map(), seen = new Set();
  const text = () => [...items.values()].map(item => item.text).join(' ').trim();
  const state = value => onState({ state: value, engine: 'server', live: 'realtime' });
  function releaseAudio() {
    if (processor?.port) { processor.port.onmessage = null; processor.port.close(); }
    if (processor) { processor.onaudioprocess = null; try { processor.disconnect(); } catch {} }
    try { source?.disconnect(); silence?.disconnect(); } catch {}
    stream?.getTracks().forEach(track => track.stop()); stream = null;
    if (context) Promise.resolve(context.close()).catch(() => {}); context = null;
    processor = source = silence = null; onLevel(null);
  }
  function clean() {
    clearTimeout(timer); clearTimeout(finishTimer); controller?.abort();
    openingResolve = openingReject = null;
    releaseAudio(); packets = [];
    if (socket) {
      socket.onopen = socket.onmessage = socket.onclose = socket.onerror = null;
      try { socket.close(1000, 'Input closed'); } catch {}
      socket = null;
    }
  }
  function finish() {
    if (!active) return;
    const transcript = text(); active = false; clean();
    if (!transcript) onError({ code: 'no-speech', message: 'No speech was detected. Try again or type your message.' });
    if (transcript) onTranscript({ text: transcript, final: true });
    state(transcript ? 'review' : 'idle');
  }
  function fail(code, message) {
    if (!active) return;
    if (!started && openingReject) { openingReject({ code, message }); return; }
    onError({ code, message });
    const transcript = text(); active = false; clean();
    if (transcript) onTranscript({ text: transcript, final: true });
    state(transcript ? 'review' : 'idle');
  }
  function sendSamples(samples) {
    if (!samples.length || socket?.readyState !== 1) return;
    if (socket.bufferedAmount > 512 * 1024) { fail('live-network', 'Live captions lost their connection. Review the captured words or try again.'); return; }
    try {
      socket.send(JSON.stringify({ type: 'input_audio_buffer.append', audio: encodedPCM(samples) }));
      totalSamples += samples.length;
    } catch { fail('live-network', 'Live captions lost their connection. Review the captured words or try again.'); }
  }
  async function attachAudio() {
    const resample = createPCMResampler(context.sampleRate);
    const receive = values => {
      if (!active || stopping || !started) return;
      let squares = 0;
      for (const value of values) squares += value * value;
      onLevel(Math.min(1, Math.sqrt(squares / Math.max(1, values.length)) * 4));
      packets.push(...resample(values));
      while (packets.length >= PACKET_SAMPLES && active) sendSamples(packets.splice(0, PACKET_SAMPLES));
    };
    source = context.createMediaStreamSource(stream);
    if (context.audioWorklet && window.AudioWorkletNode) {
      const url = URL.createObjectURL(new Blob([WORKLET], { type: 'text/javascript' }));
      try {
        await context.audioWorklet.addModule(url);
        if (!active) return;
        processor = new window.AudioWorkletNode(context, 'pawprint-live-pcm');
        processor.port.onmessage = event => receive(event.data);
      } catch { /* Older WebKit uses a silent ScriptProcessor capture branch. */ }
      finally { URL.revokeObjectURL(url); }
    }
    if (!active) return;
    if (!processor && context.createScriptProcessor) {
      processor = context.createScriptProcessor(4096, 1, 1);
      processor.onaudioprocess = event => receive(event.inputBuffer.getChannelData(0));
    }
    if (!processor) throw { code: 'live-unsupported', message: 'Live microphone capture is unavailable in this browser.' };
    silence = context.createGain(); silence.gain.value = 0;
    source.connect(processor); processor.connect(silence); silence.connect(context.destination);
    await new Promise((resolve, reject) => {
      openingReject = reject;
      timer = setTimeout(() => reject({ code: 'live-audio-suspended', message: 'The microphone could not start live audio. Tap to try again.' }), 5000);
      Promise.resolve(context.resume()).then(resolve, reject);
    }).finally(() => { clearTimeout(timer); openingReject = null; });
  }
  function event(message) {
    if (!active) return;
    let data;
    try { data = JSON.parse(message.data); } catch { return; }
    if (data.type === 'session.created' || data.type === 'transcription_session.created') {
      clearTimeout(timer); openingReject = null; openingResolve?.(); openingResolve = null;
      return;
    }
    if (data.event_id) { if (seen.has(data.event_id)) return; seen.add(data.event_id); }
    if (data.type === 'input_audio_buffer.committed') { committedItem = data.item_id; if (stopping && items.get(committedItem)?.final) finish(); return; }
    if (data.type === 'conversation.item.input_audio_transcription.delta' && typeof data.delta === 'string') {
      const item = items.get(data.item_id) || { text: '', final: false };
      if (item.final) return;
      item.text += data.delta; items.set(data.item_id, item);
      onTranscript({ text: text(), final: false });
    } else if (data.type === 'conversation.item.input_audio_transcription.completed' && typeof data.transcript === 'string') {
      items.set(data.item_id, { text: data.transcript, final: true });
      onTranscript({ text: text(), final: false });
      if (stopping && (!committedItem || committedItem === data.item_id)) finish();
    } else if (data.type === 'conversation.item.input_audio_transcription.failed' || data.type === 'error') {
      // Only fixed messages reach the UI, never raw provider errors or tokens.
      fail('live-transcription', 'Live captions stopped. Review the captured words or try again.');
    }
  }
  async function start() {
    try {
      context ||= prepareRealtimeAudio();
      const microphone = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true }, video: false });
      if (!active) { microphone.getTracks().forEach(track => track.stop()); return false; }
      stream = microphone;
      controller = new AbortController();
      timer = setTimeout(() => controller.abort(), 15_000);
      const response = await fetch('/api/transcribe/session', {
        method: 'POST', credentials: 'same-origin', signal: controller.signal,
        headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...(testMode ? { 'X-Pawprint-Test-Mode': '1' } : {}) }, body: '{}',
      });
      const result = await response.json().catch(() => ({}));
      clearTimeout(timer);
      if (!active) return false;
      if (!response.ok) throw { code: result.code || 'live-unavailable', message: result.message || 'Live captions could not connect.' };
      if (typeof result.value !== 'string' || !result.value.startsWith('ek_')) throw { code: 'live-unavailable', message: 'Live captions could not connect.' };
      socket = new window.WebSocket('wss://api.openai.com/v1/realtime?intent=transcription', ['realtime', `openai-insecure-api-key.${result.value}`]);
      // Never persist the ephemeral secret. The negotiated session is configured
      // by our Worker and cannot expose its project key.
      result.value = '';
      await new Promise((resolve, reject) => {
        openingReject = reject; openingResolve = resolve;
        timer = setTimeout(() => reject({ code: 'live-timeout', message: 'Live captions could not connect. Try again.' }), 12_000);
        // An open transport is not yet an accepted transcription session. Wait
        // for the provider's acknowledgement so failed access can fall back.
        socket.onopen = () => {};
        socket.onmessage = event;
        socket.onerror = () => fail('live-network', 'Live captions could not connect. Check your connection and try again.');
        socket.onclose = () => { if (stopping) finish(); else fail('live-network', 'Live captions lost their connection. Try again.'); };
      });
      if (!active) return false;
      await attachAudio();
      if (!active) return false;
      started = true;
      state('listening');
      timer = setTimeout(stop, MAX_MS);
      return true;
    } catch (error) {
      const cancelled = !active;
      active = false; clean();
      if (cancelled) return false;
      throw error;
    }
  }
  function stop() {
    if (!active || stopping) return;
    if (!started) { cancel(); state('idle'); return; }
    stopping = true; clearTimeout(timer);
    sendSamples(packets); packets = []; releaseAudio();
    if (!active) return;
    if (totalSamples < RATE / 10) { finish(); return; }
    state('transcribing');
    try { socket.send(JSON.stringify({ type: 'input_audio_buffer.commit' })); }
    catch { finish(); return; }
    finishTimer = setTimeout(() => {
      if (!active) return;
      onError({ code: 'live-final-timeout', message: 'Live captions stopped. You can review the words already captured.' });
      finish();
    }, 10_000);
  }
  function cancel() {
    if (!active) return;
    active = false;
    openingReject?.({ code: 'cancelled' }); openingReject = null;
    clean();
  }
  return { start, stop, cancel };
}
