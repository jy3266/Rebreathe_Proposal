// Microphone + voice activity detection for the voice-only conversation.
//
// While listening, the mic level is watched frame by frame. When the child starts talking and
// then pauses, that one utterance (with a little audio from just before it started) is handed to
// `onUtterance` as a 16 kHz mono WAV Blob, and listening stops until `listen()` is called again
// (so Bada's own voice is never recorded). Nothing is kept or sent while paused.

const TARGET_RATE = 16000; // what Whisper expects
const FRAME = 2048; // samples per analysis frame (~43 ms at 48 kHz)
const PREROLL_MS = 400; // audio kept from before speech was detected
const START_MS = 130; // this much loud audio in a row = speech started
const END_SILENCE_MS = 1100; // this much quiet after speech = utterance finished
const MIN_SPEECH_MS = 300; // shorter blips (a cough, a click) are dropped
const MAX_UTTERANCE_MS = 20000; // hard stop for one turn
const MIN_THRESHOLD = 0.012; // RMS floor for "loud"; scaled up in noisy rooms
// Virtual inputs with nothing feeding them (Oculus/Meta headset audio, NDI webcams, ...) deliver
// digital silence, while a real microphone always picks up some room noise: on the studio laptop
// every frame of the built-in mic was above 6e-4 RMS and every frame of the virtual ones was 0.
// While the page itself plays sound (Bada's voice), Chrome's echo canceller adds faint comfort
// noise (~1e-4) even to a dead input, so only frames heard while listening are judged: a device
// counts as silent when fewer than 20% of its first 1.5 s of listening carry any signal.
const ALIVE_RMS = 1e-5;
const DEAD_CHECK_MS = 1500;

/**
 * @param {{ onState?: (s: 'listening'|'hearing') => void,
 *           onLevel?: (level: number) => void,
 *           onUtterance: (wav: Blob) => void,
 *           onSilentInput?: () => void,
 *           deviceId?: string,
 *           stream?: MediaStream }} opts
 *   `deviceId` picks a specific microphone (otherwise the browser's choice);
 *   `onSilentInput` fires once if the device delivers nothing but digital silence;
 *   `stream` replaces the microphone (tests).
 */
export async function createMic({ onState, onLevel, onUtterance, onSilentInput, deviceId, stream }) {
  const media =
    stream ||
    (await navigator.mediaDevices.getUserMedia({
      audio: {
        ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
        echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1,
      },
    }));
  const track = media.getAudioTracks()[0];
  const Ctx = window.AudioContext || window.webkitAudioContext;
  const ctx = new Ctx();
  if (ctx.state === 'suspended') await ctx.resume().catch(() => {});

  const source = ctx.createMediaStreamSource(media);
  // ScriptProcessorNode is deprecated but runs everywhere (incl. Safari) without a worklet file.
  const proc = ctx.createScriptProcessor(FRAME, 1, 1);
  const sink = ctx.createGain();
  sink.gain.value = 0; // the processor only runs when connected to the output; keep it silent
  source.connect(proc);
  proc.connect(sink);
  sink.connect(ctx.destination);

  const rate = ctx.sampleRate;
  const frameMs = (FRAME / rate) * 1000;

  let active = false;
  let inSpeech = false;
  let loudMs = 0;
  let quietMs = 0;
  let speechMs = 0;
  let noise = 0.004; // running estimate of the room's background level (RMS)
  let preroll = [];
  let chunks = [];

  function reset() {
    inSpeech = false;
    loudMs = quietMs = speechMs = 0;
    preroll = [];
    chunks = [];
  }

  // Dead-input check over the first DEAD_CHECK_MS of listening (see ALIVE_RMS).
  let checkFrames = 0;
  let aliveFrames = 0;
  let deadChecked = !onSilentInput;
  let closed = false;

  proc.onaudioprocess = (e) => {
    if (!active) return;
    const frame = new Float32Array(e.inputBuffer.getChannelData(0)); // copy: the buffer is reused
    let sum = 0;
    for (let i = 0; i < frame.length; i++) sum += frame[i] * frame[i];
    const rms = Math.sqrt(sum / frame.length);

    if (!deadChecked) {
      checkFrames++;
      if (rms > ALIVE_RMS) aliveFrames++;
      if (checkFrames * frameMs >= DEAD_CHECK_MS) {
        deadChecked = true;
        if (aliveFrames < checkFrames * 0.2) {
          setTimeout(() => { if (!closed) onSilentInput(); }, 0); // outside the audio callback
        }
      }
    }
    const threshold = Math.max(MIN_THRESHOLD, noise * 3.2);
    const loud = rms > threshold;
    onLevel?.(Math.min(1, rms / (threshold * 3)));

    if (!inSpeech) {
      preroll.push(frame);
      while (preroll.length * frameMs > PREROLL_MS) preroll.shift();
      if (loud) {
        loudMs += frameMs;
        if (loudMs >= START_MS) {
          inSpeech = true;
          chunks = preroll;
          preroll = [];
          speechMs = loudMs;
          quietMs = 0;
          onState?.('hearing');
        }
      } else {
        loudMs = 0;
        noise = noise * 0.95 + rms * 0.05;
      }
      return;
    }

    chunks.push(frame);
    speechMs += frameMs;
    quietMs = loud ? 0 : quietMs + frameMs;
    if (quietMs >= END_SILENCE_MS || speechMs >= MAX_UTTERANCE_MS) finish();
  };

  function finish() {
    const voicedMs = speechMs - quietMs;
    const data = chunks;
    reset();
    if (voicedMs < MIN_SPEECH_MS) {
      onState?.('listening');
      return;
    }
    active = false; // the caller resumes listening once Bada has answered
    onLevel?.(0);
    onUtterance(encodeWav(downsample(concat(data), rate, TARGET_RATE), TARGET_RATE));
  }

  return {
    listen() {
      if (ctx.state === 'suspended') ctx.resume().catch(() => {});
      reset();
      active = true;
      onState?.('listening');
    },
    pause() {
      active = false;
      reset();
      onLevel?.(0);
    },
    get active() {
      return active;
    },
    /** Device label, e.g. "Microphone Array (Intel® Smart Sound Technology …)". */
    label: track?.label || '',
    deviceId: track?.getSettings?.().deviceId || deviceId || '',
    close() {
      closed = true;
      active = false;
      proc.disconnect();
      source.disconnect();
      if (!stream) media.getTracks().forEach((t) => t.stop());
      ctx.close().catch(() => {});
    },
  };
}

function concat(frames) {
  const out = new Float32Array(frames.reduce((n, f) => n + f.length, 0));
  let o = 0;
  for (const f of frames) {
    out.set(f, o);
    o += f.length;
  }
  return out;
}

// Box-filter decimation: averages the source samples that fall into each output sample.
function downsample(buf, from, to) {
  if (from === to) return buf;
  const ratio = from / to;
  const out = new Float32Array(Math.floor(buf.length / ratio));
  for (let i = 0; i < out.length; i++) {
    const start = Math.floor(i * ratio);
    const end = Math.min(buf.length, Math.floor((i + 1) * ratio));
    let sum = 0;
    for (let j = start; j < end; j++) sum += buf[j];
    out[i] = end > start ? sum / (end - start) : 0;
  }
  return out;
}

function encodeWav(samples, rate) {
  const buf = new ArrayBuffer(44 + samples.length * 2);
  const v = new DataView(buf);
  const str = (o, s) => {
    for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i));
  };
  str(0, 'RIFF');
  v.setUint32(4, 36 + samples.length * 2, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  v.setUint32(16, 16, true); // fmt chunk size
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, 1, true); // mono
  v.setUint32(24, rate, true);
  v.setUint32(28, rate * 2, true); // byte rate
  v.setUint16(32, 2, true); // block align
  v.setUint16(34, 16, true); // bits per sample
  str(36, 'data');
  v.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Blob([buf], { type: 'audio/wav' });
}
