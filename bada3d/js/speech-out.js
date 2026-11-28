// The friend's voice. Each sentence is read by a natural neural voice (Worker POST /tts) and
// played in order through Web Audio; while one plays, the next ones are already being fetched.
// When /tts is unavailable (no AI Gateway credits yet, offline, an error) that sentence is read by
// the browser's own speechSynthesis instead, and /tts is left alone for a minute, so the
// conversation never waits on it.

import { audioContext } from './audio.js';

const FETCH_TIMEOUT_MS = 8000;
const DOWN_MS = 60_000;
// The browser voice is the same for every friend, so it at least sounds a little different.
const SYNTH_PITCH = { bear: 0.85, cat: 1.3, owl: 1.0 };

export function createSpeechOut({ worker, pageLang, onStart, onIdle }) {
  const synth = window.speechSynthesis;
  const voices = { ko: null, en: null };
  let queue = []; // sentences waiting or playing, in order
  let gen = 0; // bumped by stop(); work of a stopped queue is ignored
  let downUntil = 0;
  let failures = 0;
  let last = { reply: null, text: '' }; // previous sentence (smoother intonation)

  // Prefer the natural-sounding online voices Chrome/Edge provide, in the main region
  // (ko-KR, en-US), then any voice of that region, then any voice of the language.
  function bestVoice(list, region) {
    const natural = (v) => /Natural|Online|Google/i.test(v.name);
    const inRegion = (v) => v.lang.replace('_', '-').toLowerCase() === region;
    return list.find((v) => natural(v) && inRegion(v)) || list.find(inRegion) || list.find(natural) || list[0] || null;
  }
  function pickVoices() {
    const all = synth.getVoices();
    voices.ko = bestVoice(all.filter((v) => v.lang.toLowerCase().startsWith('ko')), 'ko-kr');
    voices.en = bestVoice(all.filter((v) => v.lang.toLowerCase().startsWith('en')), 'en-us');
  }
  if (synth) {
    pickVoices();
    synth.addEventListener?.('voiceschanged', pickVoices);
  }

  function neuralReady() {
    return !!audioContext() && Date.now() >= downUntil;
  }

  function fetchVoice(item) {
    const ctrl = new AbortController();
    item.abort = () => ctrl.abort();
    const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
    return fetch(`${worker}/tts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: item.text, lang: item.lang, prev: item.prev || undefined, character: item.friend }),
      signal: ctrl.signal,
    })
      .then((res) => {
        if (res.status === 503) downUntil = Date.now() + DOWN_MS; // not set up (credits)
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.arrayBuffer();
      })
      .then((buf) => new Promise((resolve, reject) => audioContext().decodeAudioData(buf, resolve, reject)))
      .then((audio) => { failures = 0; return audio; })
      .catch((err) => {
        if (item.gen === gen) {
          console.warn('[voice] neural voice unavailable, using the browser voice:', err?.message || err);
          if (++failures >= 2) downUntil = Date.now() + DOWN_MS;
        }
        return null;
      })
      .finally(() => clearTimeout(timer));
  }

  function speak(text, { lang = pageLang, reply = null, friend = 'cat' } = {}) {
    if (!text.trim() || (!audioContext() && !synth)) return false;
    const item = { text, lang, reply, friend, gen, prev: last.reply === reply && reply !== null ? last.text : '' };
    last = { reply, text };
    if (neuralReady()) item.audio = fetchVoice(item);
    queue.push(item);
    if (queue.length === 1) playNext();
    return true;
  }

  function playNext() {
    const item = queue[0];
    if (!item) return;
    Promise.resolve(item.audio).then((buffer) => {
      if (item.gen !== gen || queue[0] !== item) return; // stopped meanwhile
      if (buffer) playBuffer(item, buffer);
      else playSynth(item);
    });
  }

  function finished(item) {
    if (item.done) return;
    item.done = true;
    clearTimeout(item.watchdog);
    if (item.gen !== gen) return;
    queue.shift();
    if (queue.length) playNext();
    else onIdle?.();
  }

  function playBuffer(item, buffer) {
    const ctx = audioContext();
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(ctx.destination);
    src.onended = () => finished(item);
    item.stop = () => { try { src.stop(); } catch { /* not started */ } };
    item.watchdog = setTimeout(() => finished(item), buffer.duration * 1000 + 2500);
    src.start();
    onStart?.(item.text);
  }

  function playSynth(item) {
    if (!synth) { finished(item); return; }
    const u = new SpeechSynthesisUtterance(item.text);
    u.lang = item.lang === 'ko' ? 'ko-KR' : 'en-US';
    if (voices[item.lang]) u.voice = voices[item.lang];
    u.rate = 1.0;
    u.pitch = SYNTH_PITCH[item.friend] ?? 1.1;
    // Some browsers occasionally never fire `end`; don't let that freeze the conversation.
    item.watchdog = setTimeout(() => finished(item), 4000 + item.text.length * (item.lang === 'ko' ? 320 : 130));
    u.onstart = () => onStart?.(item.text);
    u.onend = u.onerror = () => finished(item);
    synth.speak(u);
  }

  return {
    speak,
    /** Silences everything queued or playing (no onIdle). */
    stop() {
      gen++;
      queue.forEach((item) => { item.abort?.(); item.stop?.(); clearTimeout(item.watchdog); });
      queue = [];
      if (synth) synth.cancel();
    },
    get busy() { return queue.length > 0; },
    get available() { return !!(audioContext() || synth); },
  };
}
