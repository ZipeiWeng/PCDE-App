import { createRealtimeTranscription, prepareRealtimeAudio, supportsRealtimeTranscription } from './realtime-transcription.js';

const MAX_MS = 30_000;
const MAX_AUDIO_BYTES = 10 * 1024 * 1024;
const LIVE_PREVIEW_SECONDS = 7;
const MAX_LIVE_PREVIEWS = 3;
// A worklet copies actual microphone PCM; its output remains silent. A bounded
// WAV snapshot is independently playable, unlike an unfinished recorder chunk.
const PCM_WORKLET = `class PawprintPCM extends AudioWorkletProcessor {
  constructor() { super(); this.chunk = new Float32Array(2048); this.offset = 0; }
  process(inputs) {
    const samples = inputs[0]?.[0];
    if (samples) for (const sample of samples) {
      this.chunk[this.offset++] = sample;
      if (this.offset === this.chunk.length) {
        this.port.postMessage(this.chunk, [this.chunk.buffer]);
        this.chunk = new Float32Array(2048); this.offset = 0;
      }
    }
    return true;
  }
} registerProcessor('pawprint-voice-pcm', PawprintPCM);`;

function pcmWave(chunks, sampleCount, sampleRate) {
  const buffer = new ArrayBuffer(44 + sampleCount * 2), view = new DataView(buffer);
  const label = (offset, value) => [...value].forEach((letter, index) => view.setUint8(offset + index, letter.charCodeAt(0)));
  label(0, 'RIFF'); view.setUint32(4, buffer.byteLength - 8, true); label(8, 'WAVE'); label(12, 'fmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true); view.setUint16(34, 16, true); label(36, 'data'); view.setUint32(40, sampleCount * 2, true);
  let offset = 44;
  for (const chunk of chunks) for (const value of chunk) {
    const sample = Math.max(-1, Math.min(1, value));
    view.setInt16(offset, sample < 0 ? sample * 32768 : sample * 32767, true); offset += 2;
  }
  return new Blob([buffer], { type: 'audio/wav' });
}

const speechErrors = {
  'not-allowed': 'Microphone access is blocked. Allow it in your browser’s site settings, then try again.',
  'service-not-allowed': 'Your browser’s speech service is unavailable. You can type, or try a supported browser.',
  'audio-capture': 'No microphone was found. Check your microphone connection and browser permission.',
  'no-speech': 'No speech was detected. Try speaking closer to the microphone.',
  network: 'The browser’s speech service could not connect. Check your connection and try again.',
  'language-not-supported': 'Your browser’s speech service could not recognize this language. Type your message instead.',
};

const transcriptionErrors = {
  authentication_required: 'Sign in to use audio transcription. Your recording was not transcribed.',
  not_configured: 'Server audio transcription is not connected yet. You can type your message.',
  provider_authentication: 'The transcription service’s API credentials were not accepted. Its connection needs attention. You can type instead.',
  provider_quota: 'Audio transcription is unavailable because the AI project has reached a billing or usage limit. You can type instead.',
  provider_access_denied: 'The AI provider denied this project access to transcription. Its access settings need attention. You can type instead.',
  provider_model_unavailable: 'The configured transcription model is unavailable to this project. You can type instead.',
  provider_busy: 'The transcription service is busy. Try again shortly, or type your message.',
  provider_timeout: 'The transcription service took too long to respond. Try again, or type your message.',
  provider_unavailable: 'The transcription service could not respond. Try again later, or type your message.',
};
const testSessionEnded = 'Your test session has ended. Open the test account again, then record a new message.';

/**
 * Real, user-initiated speech capture. No generated transcripts or imitation audio levels.
 * onError receives {code, message, signInPath?}. onLevel is 0–1 for microphone
 * audio, and null when a browser speech service does not expose microphone PCM.
 * getTestMode is captured at recording start; its header only restricts server access.
 */
export function createVoiceInput({ onState = () => {}, onTranscript = () => {}, onLevel = () => {}, onError = () => {}, getCapabilities, getTestMode = () => false } = {}) {
  let generation = 0;
  let destroyed = false;
  let session = null;

  function emitState(state, engine, live = session?.live || '') { onState({ state, engine, live }); }
  function valid(current) { return !destroyed && session === current && current.id === generation; }
  function error(code, message, extras = {}) { onError({ code, message, ...extras }); }

  function clearResources(current) {
    current.realtime?.cancel();
    current.realtime = null;
    current.preparedAudio?.close().catch(() => {});
    current.preparedAudio = null;
    clearTimeout(current.timer);
    clearTimeout(current.finishTimer);
    cancelAnimationFrame(current.frame || 0);
    current.frame = 0;
    current.previewController?.abort();
    current.previewController = null;
    clearTimeout(current.previewTimer);
    if (current.pcmNode) {
      current.pcmNode.onaudioprocess = null;
      if (current.pcmNode.port) { current.pcmNode.port.onmessage = null; current.pcmNode.port.close(); }
      try { current.pcmNode.disconnect(); } catch {}
    }
    current.pcmNode = null;
    current.pcmChunks = [];
    if (current.recognition) {
      current.recognition.onstart = current.recognition.onresult = current.recognition.onerror = current.recognition.onend = null;
      try { current.recognition.abort(); } catch {}
      current.recognition = null;
    }
    current.stream?.getTracks().forEach(track => track.stop());
    current.stream = null;
    if (current.audioContext) current.audioContext.close().catch(() => {});
    current.audioContext = null;
    onLevel(null);
  }

  function finishBrowser(current) {
    if (!valid(current) || current.finished) return;
    current.finished = true;
    clearResources(current);
    const transcript = current.text.trim();
    if (transcript) onTranscript({ text: transcript, final: true });
    emitState(transcript ? 'review' : 'idle', 'browser');
    if (!transcript && !current.failed) error('no-speech', speechErrors['no-speech']);
    session = null;
  }

  function startBrowser(current, Speech, preview = false) {
    const recognition = new Speech();
    current.recognition = recognition;
    // Browser fallback follows the browser’s locale; multilingual detection is
    // provided by server transcription, not by a forced recognition language.
    recognition.lang = navigator.language || document.documentElement.lang || '';
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;
    recognition.onstart = () => {
      if (!valid(current)) { try { recognition.abort(); } catch {} return; }
      if (preview && current.recognition !== recognition) return;
      if (current.stopping) { try { recognition.stop(); } catch {} return; }
      if (preview) { current.live = 'browser'; emitState('listening', 'server'); }
      else { emitState('listening', 'browser'); onLevel(null); current.timer = setTimeout(() => stop(), MAX_MS); }
    };
    recognition.onresult = event => {
      if (!valid(current) || current.finished || (preview && (current.stopping || current.recognition !== recognition))) return;
      // A result event includes the whole current result list. Rebuild it,
      // rather than append interim hypotheses and accidentally repeat words.
      const segments = Array.from(event.results || []).map(result => ({
        text: String(result[0]?.transcript || '').trim(), final: Boolean(result.isFinal),
      }));
      current.text = segments.map(result => result.text).filter(Boolean).join(' ').trim();
      current.browserSamples = current.pcmSamples || 0;
      if (preview) current.live = 'browser';
      onTranscript({ text: current.text, final: !preview && segments.length > 0 && segments.every(result => result.final) });
    };
    recognition.onerror = event => {
      if (!valid(current)) return;
      const code = event.error || 'recognition-error';
      if (code === 'aborted' && current.stopping) return;
      if (preview) { endPreview(); return; }
      current.failed = true;
      error(code, speechErrors[code] || 'Voice input stopped unexpectedly. Review any captured words or try again.');
      finishBrowser(current);
      try { recognition.abort(); } catch {}
    };
    function endPreview() {
      if (!valid(current) || current.stopping) return;
      recognition.onstart = recognition.onresult = recognition.onerror = recognition.onend = null;
      if (current.recognition === recognition) current.recognition = null;
      try { recognition.abort(); } catch {}
      current.live = 'unavailable';
      emitState('listening', 'server');
    }
    recognition.onend = () => preview ? endPreview() : finishBrowser(current);
    try { recognition.start(); }
    catch (cause) {
      if (preview) { endPreview(); return; }
      current.failed = true;
      error('recognition-start', cause?.name === 'NotAllowedError' ? speechErrors['not-allowed'] : 'Voice input could not start. Check microphone permission or type your message.');
      finishBrowser(current);
    }
  }

  async function livePreview(current) {
    if (!valid(current) || current.stopping || current.previewBusy || current.previewDisabled || current.previewCount >= MAX_LIVE_PREVIEWS) return;
    const rate = current.audioContext?.sampleRate;
    if (!rate || current.pcmSamples - current.previewSamples < rate * LIVE_PREVIEW_SECONDS || !current.pcmHasSound) return;
    if (current.live === 'browser' && current.pcmSamples - current.browserSamples < rate * LIVE_PREVIEW_SECONDS) return;
    current.previewBusy = true; current.previewCount++; current.previewSamples = current.pcmSamples;
    const audio = pcmWave(current.pcmChunks, current.pcmSamples, rate);
    const controller = new AbortController(); current.previewController = controller;
    const browserSamples = current.browserSamples;
    current.previewTimer = setTimeout(() => controller.abort(), 12_000);
    try {
      const body = new FormData(); body.append('audio', audio, 'voice-live.wav');
      const response = await fetch('/api/transcribe', { method: 'POST', body, credentials: 'same-origin', signal: controller.signal, headers: { Accept: 'application/json', ...(current.testMode ? { 'X-Pawprint-Test-Mode': '1' } : {}) } });
      const result = await response.json().catch(() => ({}));
      if (!valid(current) || current.stopping || controller.signal.aborted) return;
      if (!response.ok) {
        // No retry storm: protect the shared request limit and leave the full
        // final recording available. Silence is normal and can be retried.
        if (response.status !== 422) { current.previewDisabled = true; if (current.live !== 'browser') current.live = 'unavailable'; }
        if (response.status === 401 || result.code === 'authentication_required') {
          error('authentication_required', current.testMode ? testSessionEnded : transcriptionErrors.authentication_required);
          cancel(); return;
        }
        emitState('listening', 'server'); return;
      }
      const text = typeof result.text === 'string' ? result.text.trim() : '';
      // A slower server preview must not overwrite newer browser hypotheses.
      if (text && current.browserSamples === browserSamples) { current.text = text; onTranscript({ text, final: false }); }
    } catch {
      if (valid(current) && !current.stopping) { current.previewDisabled = true; if (current.live !== 'browser') current.live = 'unavailable'; emitState('listening', 'server'); }
    } finally {
      clearTimeout(current.previewTimer);
      if (current.previewController === controller) current.previewController = null;
      current.previewBusy = false;
    }
  }

  async function capturePCM(current, context, source) {
    const maxSamples = Math.min(Math.floor(context.sampleRate * MAX_MS / 1000), Math.floor((MAX_AUDIO_BYTES - 44) / 2));
    const receive = values => {
      if (!valid(current) || current.stopping || current.pcmSamples >= maxSamples) return;
      const count = Math.min(values.length, maxSamples - current.pcmSamples);
      const samples = new Float32Array(values.slice(0, count));
      current.pcmChunks.push(samples); current.pcmSamples += samples.length;
      if (!current.pcmHasSound) current.pcmHasSound = samples.some(value => Math.abs(value) > .008);
      void livePreview(current);
    };
    let node;
    if (context.audioWorklet && window.AudioWorkletNode) {
      const url = URL.createObjectURL(new Blob([PCM_WORKLET], { type: 'text/javascript' }));
      try {
        await context.audioWorklet.addModule(url);
        if (!valid(current) || current.stopping) return;
        node = new window.AudioWorkletNode(context, 'pawprint-voice-pcm');
        node.port.onmessage = event => receive(event.data);
      } catch { /* Older engines retain a ScriptProcessor fallback below. */ }
      finally { URL.revokeObjectURL(url); }
    }
    if (!valid(current) || current.stopping) return;
    if (!node && context.createScriptProcessor) {
      node = context.createScriptProcessor(4096, 1, 1);
      node.onaudioprocess = event => receive(event.inputBuffer.getChannelData(0));
    }
    if (!node) return;
    current.pcmNode = node;
    const silence = context.createGain(); silence.gain.value = 0;
    source.connect(node); node.connect(silence); silence.connect(context.destination);
    // Periodic recording previews are useful as a fallback, but are not a
    // realtime stream. Only the WebSocket engine may report live:'realtime'.
    if (current.live !== 'browser') { current.live = 'unavailable'; emitState('listening', 'server'); }
  }

  function watchLevel(current) {
    const Audio = window.AudioContext || window.webkitAudioContext;
    if (!Audio || !current.stream) { onLevel(null); return; }
    try {
      const context = new Audio();
      current.audioContext = context;
      const source = context.createMediaStreamSource(current.stream);
      void capturePCM(current, context, source).catch(() => {});
      const analyser = context.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      // The meter never plays audio; PCM capture uses a separate silent branch.
      const data = new Uint8Array(analyser.fftSize);
      context.resume().catch(() => {
        if (valid(current) && !current.stopping && current.live !== 'browser') { current.live = 'unavailable'; emitState('listening', 'server'); }
      });
      const tick = () => {
        if (!valid(current) || current.stopping) return;
        analyser.getByteTimeDomainData(data);
        let squares = 0;
        for (const value of data) squares += ((value - 128) / 128) ** 2;
        onLevel(Math.min(1, Math.sqrt(squares / data.length) * 4));
        current.frame = requestAnimationFrame(tick);
      };
      tick();
    } catch { onLevel(null); }
  }

  async function transcribe(current) {
    if (!valid(current) || current.failed) return;
    current.stopping = true;
    clearResources(current);
    const audio = new Blob(current.chunks, { type: current.recorder?.mimeType || current.mime || 'audio/webm' });
    current.chunks = [];
    if (audio.size < 64) {
      error('empty-recording', 'No audio was captured. Check your microphone and try again.');
      emitState('idle', 'server'); session = null; return;
    }
    if (audio.size > MAX_AUDIO_BYTES) {
      error('audio-too-large', 'This recording is too large. Record a shorter message.');
      emitState('idle', 'server'); session = null; return;
    }
    emitState('transcribing', 'server');
    const body = new FormData();
    const extension = audio.type.includes('mp4') ? 'm4a' : audio.type.includes('wav') ? 'wav' : 'webm';
    body.append('audio', audio, `voice.${extension}`);
    // Omitting language lets the transcription model detect English, Chinese,
    // and code-switching from the recording itself.
    const controller = new AbortController();
    current.controller = controller;
    current.timer = setTimeout(() => controller.abort(), 45_000);
    try {
      const response = await fetch('/api/transcribe', { method: 'POST', body, credentials: 'same-origin', signal: controller.signal, headers: { Accept: 'application/json', ...(current.testMode ? { 'X-Pawprint-Test-Mode': '1' } : {}) } });
      const result = await response.json().catch(() => ({}));
      if (!valid(current)) return;
      if (!response.ok) {
        const messages = {
          401: 'Sign in to use audio transcription. Your recording was not transcribed.',
          403: 'Audio transcription is not available for this account.',
          413: 'This recording is too large. Record a shorter message.',
          429: 'The transcription limit was reached. Wait a moment, then try again.',
          503: 'Audio transcription is temporarily unavailable. Try again later, or type your message.',
        };
        const code = typeof result.code === 'string' ? result.code : `transcription-${response.status}`;
        const message = current.testMode && (code === 'authentication_required' || response.status === 401)
          ? testSessionEnded
          : Object.hasOwn(transcriptionErrors, code) ? transcriptionErrors[code] : messages[response.status] || 'Audio transcription failed. Your audio was not turned into a message.';
        error(code, message, result.signInPath ? { signInPath: result.signInPath } : {});
        emitState('idle', 'server');
        return;
      }
      const text = typeof result.text === 'string' ? result.text.trim() : '';
      if (!text) { error('no-speech', speechErrors['no-speech']); emitState('idle', 'server'); return; }
      current.text = text;
      onTranscript({ text, final: true });
      emitState('review', 'server');
    } catch (cause) {
      if (!valid(current)) return;
      error(cause?.name === 'AbortError' ? 'transcription-timeout' : 'transcription-network', cause?.name === 'AbortError' ? 'Transcription took too long. Try a shorter recording.' : 'Could not reach transcription. Check your connection, or type your message.');
      emitState('idle', 'server');
    } finally {
      clearTimeout(current.timer);
      if (valid(current)) session = null;
    }
  }

  async function startRecorder(current) {
    let checkingCapabilities = true;
    try {
      const capabilities = typeof getCapabilities === 'function' ? await getCapabilities() : await fetch('/api/capabilities', { credentials: 'same-origin', headers: { Accept: 'application/json', ...(current.testMode ? { 'X-Pawprint-Test-Mode': '1' } : {}) } }).then(response => {
        if (!response.ok) throw new Error('Capabilities could not be checked.');
        return response.json();
      });
      checkingCapabilities = false;
      if (!valid(current)) return;
      // The server intentionally disables transcription while signed out.
      // Check the reason before treating that disabled capability as unavailable.
      if (capabilities?.requiresSignIn === true || (capabilities?.authenticated === false && capabilities?.configured !== false)) {
        error('authentication_required', current.testMode ? testSessionEnded : 'Sign in to use audio transcription before recording.', capabilities.signInPath ? { signInPath: capabilities.signInPath } : {});
        emitState('idle', 'server'); session = null; return;
      }
      if (capabilities?.configured === false) {
        error('not_configured', transcriptionErrors.not_configured);
        emitState('idle', 'server'); session = null; return;
      }
      if (!capabilities?.transcription) {
        error('speech-unavailable', 'Server audio transcription is unavailable. You can type instead.');
        emitState('idle', 'server'); session = null; return;
      }
      if (capabilities.realtimeTranscription && supportsRealtimeTranscription()) {
        const realtime = createRealtimeTranscription({
          testMode: current.testMode,
          audioContext: current.preparedAudio,
          onState: value => {
            if (!valid(current)) return;
            current.live = value.live;
            onState(value);
            if (value.state === 'review' || value.state === 'idle') {
              current.finished = true;
              session = null;
            }
          },
          onTranscript: value => { if (valid(current)) { current.text = value.text; onTranscript(value); } },
          onLevel: value => { if (valid(current)) onLevel(value); },
          onError: value => { if (valid(current)) onError(value); },
        });
        current.preparedAudio = null;
        current.realtime = realtime;
        try { await realtime.start(); return; }
        catch (cause) {
          current.realtime = null;
          if (!valid(current)) return;
          if (['NotAllowedError', 'SecurityError', 'NotFoundError', 'NotReadableError'].includes(cause?.name)) throw cause;
          const code = cause?.code;
          if (['authentication_required', 'origin_not_allowed', 'not_configured', 'rate_limited'].includes(code)) {
            error(code, current.testMode && code === 'authentication_required' ? testSessionEnded : transcriptionErrors[code] || 'Audio transcription is unavailable. Try again shortly or type instead.');
            emitState('idle', 'server'); session = null; return;
          }
          const Speech = window.SpeechRecognition || window.webkitSpeechRecognition;
          if (Speech) {
            current.engine = 'browser'; current.live = 'browser';
            error('live-browser-fallback', 'Live captions could not connect. Using your browser’s speech recognition; review the words before sending.');
            startBrowser(current, Speech);
            return;
          }
          error('live-unavailable', 'Live captions could not connect. Record your message, then finish to review its transcription.');
        }
      }
      if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
        error('microphone-unsupported', 'This browser cannot record microphone audio. Try a current browser or type instead.');
        emitState('idle', 'server'); session = null; return;
      }
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true }, video: false });
      if (!valid(current) || current.stopping) { stream.getTracks().forEach(track => track.stop()); return; }
      current.stream = stream;
      const Recorder = window.MediaRecorder;
      current.mime = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm', 'audio/wav'].find(type => Recorder.isTypeSupported?.(type)) || '';
      const recorder = new Recorder(stream, current.mime ? { mimeType: current.mime } : undefined);
      current.recorder = recorder;
      if (recorder.mimeType && !/audio\/(?:webm|mp4|wav)/i.test(recorder.mimeType)) {
        clearResources(current);
        error('recording-format', 'This browser records an unsupported audio format. Try a current browser or type instead.');
        emitState('idle', 'server'); session = null; return;
      }
      current.chunks = [];
      recorder.ondataavailable = event => {
        if (valid(current) && event.data?.size) current.chunks.push(event.data);
      };
      recorder.onstop = () => transcribe(current);
      recorder.onerror = () => {
        if (!valid(current)) return;
        current.failed = true;
        clearResources(current);
        error('recording-error', 'The microphone recording stopped unexpectedly. Please try again.');
        emitState('idle', 'server'); session = null;
      };
      recorder.start(1000);
      emitState('listening', 'server');
      watchLevel(current);
      const Speech = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (Speech) {
        try { startBrowser(current, Speech, true); }
        catch { current.live = 'unavailable'; emitState('listening', 'server'); }
      }
      current.timer = setTimeout(() => stop(), MAX_MS);
    } catch (cause) {
      if (!valid(current)) return;
      clearResources(current);
      const denied = ['NotAllowedError', 'SecurityError'].includes(cause?.name);
      if (checkingCapabilities) error('capabilities-unavailable', 'Could not check the transcription connection. Check your connection and try again, or type your message.');
      else error(denied ? 'not-allowed' : 'microphone-error', denied ? speechErrors['not-allowed'] : 'The microphone could not start. Check that it is connected and not being used by another app.');
      emitState('idle', 'server'); session = null;
    } finally {
      current.preparedAudio?.close().catch(() => {});
      current.preparedAudio = null;
    }
  }

  async function start() {
    if (destroyed) return;
    cancel();
    const Speech = window.SpeechRecognition || window.webkitSpeechRecognition;
    const canRecord = Boolean(navigator.mediaDevices?.getUserMedia && window.MediaRecorder) || supportsRealtimeTranscription();
    const selected = !canRecord && Speech ? 'browser' : 'server';
    const current = { id: ++generation, engine: selected, testMode: typeof getTestMode === 'function' && getTestMode() === true, text: '', stopping: false, failed: false, finished: false, live: selected === 'browser' ? 'browser' : 'unavailable', pcmChunks: [], pcmSamples: 0, browserSamples: 0, previewSamples: 0, previewCount: 0 };
    session = current;
    onTranscript({ text: '', final: false });
    emitState('requesting', selected);
    if (window.isSecureContext === false) {
      error('insecure-context', 'Microphone input needs a secure HTTPS page. You can still type your message.');
      emitState('idle', selected); session = null; return;
    }
    if (selected === 'browser') {
      error('browser-fallback', 'Using your browser’s speech service. Automatic mixed-language recognition is unavailable here; review the words or type instead.');
      startBrowser(current, Speech);
    }
    else {
      if (supportsRealtimeTranscription()) {
        try { current.preparedAudio = prepareRealtimeAudio(); } catch { /* A browser fallback can still work. */ }
      }
      await startRecorder(current);
    }
  }

  function stop() {
    const current = session;
    if (!current || current.stopping) return;
    current.stopping = true;
    if (current.realtime) { current.realtime.stop(); return; }
    clearTimeout(current.timer);
    current.previewController?.abort();
    if (current.engine === 'browser') {
      // stop(), unlike abort(), gives the speech service time to send its final result.
      emitState('transcribing', 'browser');
      try { current.recognition?.stop(); }
      catch { finishBrowser(current); }
      if (!valid(current)) return;
      current.finishTimer = setTimeout(() => {
        if (!valid(current)) return;
        try { current.recognition?.abort(); } catch {}
        finishBrowser(current);
      }, 2500);
    } else if (current.recorder?.state === 'recording' || current.recorder?.state === 'paused') {
      try { current.recorder.stop(); }
      catch { clearResources(current); emitState('idle', 'server'); session = null; }
      current.stream?.getTracks().forEach(track => track.stop());
    } else if (!current.recorder && !current.controller) {
      // User cancelled while a permission prompt or capability check was pending.
      generation++;
      clearResources(current);
      session = null;
      emitState('idle', 'server');
    }
  }

  function cancel() {
    const current = session;
    generation++;
    session = null;
    if (current) {
      current.stopping = true;
      current.controller?.abort();
      if (current.recognition) {
        current.recognition.onresult = null;
        current.recognition.onerror = null;
        current.recognition.onend = null;
        try { current.recognition.abort(); } catch {}
      }
      if (current.recorder) {
        current.recorder.ondataavailable = null;
        current.recorder.onstop = null;
        current.recorder.onerror = null;
        if (current.recorder.state !== 'inactive') try { current.recorder.stop(); } catch {}
      }
      clearResources(current);
      if (!destroyed) emitState('idle', current.engine);
    }
  }

  const onVisibility = () => { if (document.hidden) cancel(); };
  document.addEventListener('visibilitychange', onVisibility);
  return {
    start, stop, cancel,
    destroy() { if (destroyed) return; cancel(); destroyed = true; document.removeEventListener('visibilitychange', onVisibility); },
  };
}
