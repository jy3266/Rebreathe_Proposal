// Voice-only conversation with "바다":
//   mic (voice.js detects one utterance) -> Worker /stt (Whisper) -> Worker /chat (Claude)
//   -> speechSynthesis, then listen again. No typing.
// Each step is mirrored to Unreal through the bridge (Bada turns to the child, bobs while talking).

import { CONFIG } from './config.js';
import { createBridge } from './ue-bridge.js';
import { createMic } from './voice.js';

const KO = CONFIG.lang === 'ko';
const T = (ko, en) => (KO ? ko : en);

const OPENING = T(
  '안녕! 나는 바다야. 오늘 파도 소리가 참 좋다. 있잖아, 오늘 너한테는 어떤 일이 있었어?',
  'Hi! I am Bada. The waves sound lovely today. So tell me, how was your day?'
);

// Same risk words as the 2D demo (game.js). Used only to show the caregiver notice on screen;
// Bada's spoken reply is handled by Claude's own safety instructions.
const SAFETY_KO = ['죽고', '죽을', '죽어버', '자살', '사라지고싶', '없어지고싶', '살기싫',
  '자해', '칼로', '맞았', '때려요', '아저씨가', '비밀이라고', '학대', '피가나'];
const SAFETY_EN = ['kill myself', 'want to die', 'wanna die', 'suicide', 'end my life',
  'want to disappear', 'not want to live', 'hurt myself', 'cut myself', 'self harm', 'self-harm',
  'hits me', 'hit me', 'beat me', 'abuse', 'touched me', 'not to tell anyone', 'keep it a secret'];

const el = {
  stage: document.getElementById('stage'),
  status: document.getElementById('stream-status'),
  log: document.getElementById('chat-log'),
  mic: document.getElementById('mic-btn'),
  voiceStatus: document.getElementById('voice-status'),
  voice: document.getElementById('voice-btn'),
  safety: document.getElementById('safety-notice'),
  start: document.getElementById('start-btn'),
  startOverlay: document.getElementById('start-overlay'),
  micPick: document.getElementById('mic-pick'),
  micSelect: document.getElementById('mic-select'),
};

// Static page text: Korean in the HTML, English in data-en / data-en-* attributes.
if (!KO) {
  document.title = 'Walk with Bada';
  document.querySelectorAll('[data-en]').forEach((n) => { n.innerHTML = n.dataset.en; });
  document.querySelectorAll('[data-en-aria-label]').forEach((n) => n.setAttribute('aria-label', n.dataset.enAriaLabel));
}

const history = []; // [{ role, content }] sent to the Worker
let voiceOn = true;
let bridge;
let mic = null;

// ---------- UI helpers ----------

function addBubble(role, text) {
  const div = document.createElement('div');
  div.className = `bubble bubble--${role}`;
  const who = document.createElement('span');
  who.className = 'bubble__who';
  who.textContent = role === 'user' ? T('나', 'Me') : T('바다', 'Bada');
  const body = document.createElement('p');
  body.textContent = text;
  div.append(who, body);
  el.log.append(div);
  el.log.scrollTop = el.log.scrollHeight;
  return body;
}

const STATUS_TEXT = {
  'chat-only': T('대화 전용 모드', 'Chat-only mode'),
  connecting: T('3D 화면 연결 중…', 'Connecting to the 3D scene…'),
  connected: T('연결됨', 'Connected'),
  playing: '',
  'click-to-play': T('화면을 한 번 눌러 재생해 주세요', 'Tap the scene once to play'),
  disconnected: T('연결이 끊겼어요. 새로고침해 주세요', 'Disconnected. Please reload.'),
  failed: T('3D 화면에 연결하지 못했어요', 'Could not connect to the 3D scene'),
  // Eagle 3D Streaming (cloud)
  'cloud-starting': T('클라우드에서 3D 공원을 여는 중… (1~2분 걸릴 수 있어요)', 'Opening the 3D park in the cloud… (may take 1–2 minutes)'),
  // Eagle reports position 1 even when nobody else is walking (it is assigning a cloud GPU),
  // so only a later position means other people are ahead.
  queued: (n) => (n > 1
    ? T(`다른 분이 먼저 산책 중이에요. 대기 ${n}번째`, `Others are walking right now. You are #${n} in line`)
    : T('클라우드에서 3D 공원을 준비하는 중… (1~2분 걸릴 수 있어요)', 'Getting the 3D park ready in the cloud… (may take 1–2 minutes)')),
};
function setStatus(s, extra) {
  if (s === 'ended') {
    endWalk(extra);
    return;
  }
  const t = STATUS_TEXT[s];
  el.status.textContent = typeof t === 'function' ? t(extra) : (t ?? s);
  el.status.hidden = !el.status.textContent;
}

// ---------- Ending a cloud walk ----------
// The cloud stream bills every open minute, so a walk ends after a quiet spell or when the
// player ends the session; the start card then offers a fresh walk (page reload).
const IDLE_END_MS = 5 * 60 * 1000;
let started = false;
let walkEnded = false;
let lastActivity = Date.now();
const touch = () => { lastActivity = Date.now(); };

function endWalk(reason) {
  if (walkEnded) return;
  walkEnded = true;
  mic?.pause();
  stopSpeaking();
  bridge?.stop?.();
  el.status.hidden = true;
  const card = el.startOverlay.querySelector('.start__card');
  card.querySelector('h2').textContent = T('산책을 잠시 쉬고 있어요', 'The walk is resting');
  card.querySelector('p').textContent = reason
    ? T(`3D 연결이 끝났어요 (${reason}). 다시 걸으려면 아래 버튼을 눌러 주세요.`, `The 3D session ended (${reason}). Press below to walk again.`)
    : T('한동안 조용해서 3D 산책을 멈췄어요. 다시 걸으려면 아래 버튼을 눌러 주세요.',
      'It was quiet for a while, so the 3D walk paused. Press below to walk again.');
  el.start.textContent = T('🎤 다시 걷기', '🎤 Walk again');
  el.startOverlay.hidden = false;
}

if (CONFIG.stream === 'e3ds') {
  setInterval(() => {
    const idle = state === 'listening' || state === 'paused' || state === 'nomic';
    if (started && !walkEnded && idle && Date.now() - lastActivity > IDLE_END_MS) endWalk();
  }, 15000);
}

function isRisk(text) {
  const flat = KO ? text.replace(/\s/g, '') : text.toLowerCase();
  return (KO ? SAFETY_KO : SAFETY_EN).some((w) => flat.includes(w));
}

// ---------- Conversation state (shown on the mic button) ----------

const VOICE_TEXT = {
  off: ['', ''],
  starting: ['마이크를 켜는 중…', 'Turning on the microphone…'],
  listening: ['듣고 있어요. 편하게 말해 보세요', "I'm listening — go ahead and talk"],
  hearing: ['듣는 중… 말을 마치면 바다가 대답해요', 'Listening… Bada answers when you finish'],
  transcribing: ['무슨 말인지 알아듣는 중…', 'Catching your words…'],
  thinking: ['바다가 생각하고 있어요…', 'Bada is thinking…'],
  speaking: ['바다가 말하고 있어요 · 🎤 를 누르면 바로 말할 수 있어요', 'Bada is talking · tap 🎤 to talk right away'],
  paused: ['잠시 쉬는 중 · 🎤 를 누르면 다시 들어요', 'Paused · tap 🎤 to listen again'],
  missed: ['잘 못 들었어요. 한 번 더 말해 줄래요?', "I didn't catch that. Could you say it again?"],
  nomic: ['마이크를 쓸 수 없어요. 마이크를 허용한 뒤 🎤 를 눌러 주세요', 'No microphone. Allow it, then tap 🎤'],
  error: ['연결이 잠깐 끊겼어요. 🎤 를 눌러 다시 말해 주세요', 'Connection hiccup. Tap 🎤 and say it again'],
};
let state = 'off';

function setState(s, textKey = s) {
  state = s;
  el.mic.dataset.state = s;
  el.mic.setAttribute('aria-pressed', String(s === 'listening' || s === 'hearing'));
  const t = VOICE_TEXT[textKey] || VOICE_TEXT.off;
  el.voiceStatus.textContent = T(t[0], t[1]);
}

let levelFrame = 0;
function setLevel(level) {
  if (levelFrame) return;
  levelFrame = requestAnimationFrame(() => {
    levelFrame = 0;
    el.mic.style.setProperty('--level', level.toFixed(3));
  });
}

// ---------- Speech out ----------

const synth = window.speechSynthesis;
let voice = null;
let speaking = 0; // utterances queued or playing
let speechGen = 0; // bumped by stopSpeaking(); callbacks of cancelled utterances are ignored
let replyStreaming = false;
let replyId = 0;
let silencedReply = -1; // the child talked over this reply: show the rest, don't speak it

function pickVoice() {
  if (!synth) return;
  const want = KO ? 'ko' : 'en';
  const voices = synth.getVoices().filter((v) => v.lang.toLowerCase().startsWith(want));
  // Prefer the natural-sounding online voices Chrome/Edge provide.
  voice = voices.find((v) => /Natural|Online|Google/i.test(v.name)) || voices[0] || null;
}
if (synth) {
  pickVoice();
  synth.addEventListener?.('voiceschanged', pickVoice);
}

function speak(sentence, forReply = replyId) {
  if (!voiceOn || !synth || !sentence.trim() || forReply === silencedReply) return;
  const u = new SpeechSynthesisUtterance(sentence);
  u.lang = KO ? 'ko-KR' : 'en-US';
  if (voice) u.voice = voice;
  u.rate = 1.0;
  u.pitch = 1.1;
  const gen = speechGen;
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    clearTimeout(watchdog);
    if (gen !== speechGen) return; // cancelled by stopSpeaking()
    speaking = Math.max(0, speaking - 1);
    if (speaking === 0) {
      bridge?.send({ bada: 'speak_end' });
      afterBadaTurn();
    }
  };
  // Some browsers occasionally never fire `end`; don't let that freeze the conversation.
  const watchdog = setTimeout(finish, 4000 + sentence.length * (KO ? 320 : 130));
  u.onstart = () => {
    touch();
    bridge?.send({ bada: 'speak_start', text: sentence });
  };
  u.onend = u.onerror = finish;
  speaking++;
  if (['off', 'starting', 'transcribing', 'thinking'].includes(state)) setState('speaking');
  synth.speak(u);
}

function stopSpeaking() {
  speechGen++;
  if (synth) synth.cancel();
  if (speaking) bridge?.send({ bada: 'speak_end' });
  speaking = 0;
}

// Once Bada has finished (reply fully streamed and spoken), it is the child's turn again.
function afterBadaTurn() {
  if (replyStreaming || speaking > 0) return;
  if (!mic) {
    setState('nomic');
    return;
  }
  if (state === 'paused' || mic.active) return;
  setTimeout(() => {
    if (!replyStreaming && speaking === 0 && state !== 'paused' && !mic.active) listen();
  }, 350); // a short breath so the tail of Bada's voice is not recorded
}

// Split streamed text into sentences so speech can start before the reply is finished.
function takeSentences(buffer, flush) {
  const out = [];
  const re = /[^.!?。…~\n]+[.!?。…~\n]+["'”’)]*\s*/g;
  let m;
  let last = 0;
  while ((m = re.exec(buffer))) {
    out.push(m[0].trim());
    last = re.lastIndex;
  }
  let rest = buffer.slice(last);
  if (flush && rest.trim()) {
    out.push(rest.trim());
    rest = '';
  }
  return { sentences: out.filter(Boolean), rest };
}

// ---------- Speech in ----------

function listen() {
  if (!mic) {
    setState('nomic');
    return;
  }
  if (replyStreaming) silencedReply = replyId; // talking over Bada: she stops and listens
  stopSpeaking();
  mic.listen();
}

async function onUtterance(wav) {
  setState('transcribing');
  bridge?.send({ bada: 'listen_end' });
  let text = '';
  try {
    const res = await fetch(`${CONFIG.worker}/stt?lang=${CONFIG.lang}`, {
      method: 'POST',
      headers: { 'Content-Type': 'audio/wav' },
      body: wav,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    text = ((await res.json()).text || '').trim();
  } catch (err) {
    console.error('Speech-to-text failed', err);
    setState('paused', 'error');
    return;
  }
  if (!text) {
    mic.listen();
    setState('listening', 'missed');
    return;
  }
  converse(text);
}

// ---------- Talking to the Worker ----------

async function converse(text) {
  addBubble('user', text);
  history.push({ role: 'user', content: text });

  if (isRisk(text)) {
    el.safety.hidden = false;
    bridge?.send({ bada: 'safety' });
  }

  setState('thinking');
  replyStreaming = true;
  const id = ++replyId;
  const body = addBubble('assistant', '…');
  let reply = '';
  let pending = '';

  try {
    const res = await fetch(`${CONFIG.worker}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: history }),
    });
    if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value, { stream: true });
      reply += chunk;
      pending += chunk;
      body.textContent = reply;
      el.log.scrollTop = el.log.scrollHeight;
      const { sentences, rest } = takeSentences(pending, false);
      sentences.forEach((s) => speak(s, id));
      pending = rest;
    }
    takeSentences(pending, true).sentences.forEach((s) => speak(s, id));
  } catch (err) {
    console.error(err);
    reply = T('미안, 지금은 바다랑 연결이 잘 안 돼. 잠시 후에 다시 말해 줄래?',
      'Sorry, I cannot reach Bada right now. Could you try again in a moment?');
    body.textContent = reply;
    history.pop(); // the child can simply say it again
    replyStreaming = false;
    speak(reply, id);
    afterBadaTurn(); // no-op while the apology is being spoken; continues when it ends
    return;
  }

  history.push({ role: 'assistant', content: reply.trim() || '…' });
  replyStreaming = false;
  afterBadaTurn(); // continues now if nothing is being spoken, otherwise when speech ends
}

// ---------- Microphone ----------
// Chrome remembers a ranking of microphones per profile and may pick a virtual input with nothing
// behind it (Oculus/Meta headset audio, NDI webcam audio, ...): the page then hears pure digital
// silence and "듣고 있어요" never changes. voice.js reports such a device, and it is swapped for the
// next one here (likely-physical microphones first). The picker under the mic button shows which
// microphone is in use and lets the visitor choose another.

const LIKELY_VIRTUAL = /virtual|oculus|meta quest|ndi|stereo mix|cable|vb-audio|voicemeeter|steam streaming|obs/i;
const silentMics = new Set(); // labels (or ids) of devices that delivered nothing
let switchingMic = false;

const micKey = (d) => d.label || d.deviceId;

// Real devices only: 'default' / 'communications' are aliases listed again under their own id.
async function inputDevices() {
  const all = await navigator.mediaDevices.enumerateDevices();
  return all.filter((d) => d.kind === 'audioinput' && d.deviceId &&
    d.deviceId !== 'default' && d.deviceId !== 'communications');
}

// opts.previousId: the microphone in use before the visitor picked this one (to go back to it).
async function openMic(deviceId, opts = {}) {
  const m = await createMic({
    deviceId,
    onState: (s) => {
      if (m && m !== mic) return; // a microphone that is being replaced
      setState(s);
      if (s === 'hearing') {
        touch();
        stopSpeaking();
        bridge?.send({ bada: 'listen_start' });
      }
    },
    onLevel: setLevel,
    onUtterance,
    onSilentInput: () => onSilentMic(m, opts),
  });
  return m;
}

// Swap in another microphone, keeping whatever the conversation was doing.
async function replaceMic(deviceId, opts) {
  const old = mic;
  const wasListening = !!old?.active;
  const next = await openMic(deviceId, opts); // throws if the device cannot be opened
  old?.pause();
  mic = next;
  old?.close();
  if (wasListening) mic.listen();
  renderMicPicker();
}

// A silent microphone is never worth keeping, however it was chosen (by the browser, or by a
// picker change, even an accidental one): go back to the one used before, else try the others.
async function onSilentMic(dead, { previousId } = {}) {
  if (dead !== mic || switchingMic) return;
  silentMics.add(micKey(dead));
  renderMicPicker();
  switchingMic = true;
  try {
    const candidates = (await inputDevices())
      .filter((d) => d.deviceId !== dead.deviceId && !silentMics.has(micKey(d)) &&
        !(d.label && dead.label.endsWith(d.label))) // "Default - X" is X itself
      .sort((a, b) => (b.deviceId === previousId) - (a.deviceId === previousId) ||
        LIKELY_VIRTUAL.test(a.label) - LIKELY_VIRTUAL.test(b.label));
    for (const d of candidates) {
      try {
        await replaceMic(d.deviceId);
        console.info('[mic] silent input', dead.label, '-> switched to', d.label);
        addBubble('system', d.deviceId === previousId
          ? T('🎤 고른 마이크에서는 소리가 들어오지 않아서 원래 마이크로 돌아왔어요.',
            '🎤 No sound came from that microphone, so I went back to the previous one.')
          : T(`🎤 소리가 들어오지 않는 마이크라서 "${d.label || '다른 마이크'}"(으)로 바꿨어요.`,
            `🎤 That microphone was silent, so I switched to "${d.label || 'another microphone'}".`));
        return; // if this one is silent too, its own check moves on to the next
      } catch (err) {
        console.warn('[mic] could not open', d.label, err);
        silentMics.add(micKey(d));
      }
    }
    addBubble('system', T(
      '마이크에서 소리가 들어오지 않아요. 마이크가 연결돼 있는지 확인하고, 아래 "마이크"에서 골라 주세요.',
      'No sound is coming from the microphone. Check that one is connected and pick it under "Mic" below.'));
  } finally {
    switchingMic = false;
  }
}

async function renderMicPicker() {
  if (!el.micPick || !el.micSelect) return; // an older cached index.html without the picker
  if (!mic) { el.micPick.hidden = true; return; }
  let devices = [];
  try { devices = await inputDevices(); } catch { /* ignore */ }
  if (!devices.length) { el.micPick.hidden = true; return; }
  el.micSelect.replaceChildren(...devices.map((d) => {
    const silent = silentMics.has(micKey(d)) ? T(' (소리 없음)', ' (silent)') : '';
    const o = new Option((d.label || T('마이크', 'Microphone')) + silent, d.deviceId);
    o.selected = d.deviceId === mic.deviceId || (!!d.label && mic.label.endsWith(d.label));
    return o;
  }));
  el.micPick.hidden = false;
}

async function startMic() {
  setState('starting');
  try {
    mic = await openMic();
  } catch (err) {
    console.error('Microphone unavailable', err);
    mic = null;
    // Permission refused: nothing else will work. Otherwise (device busy or gone) try the others.
    if (err?.name !== 'NotAllowedError' && err?.name !== 'SecurityError') {
      for (const d of await inputDevices().catch(() => [])) {
        try { mic = await openMic(d.deviceId); break; } catch { silentMics.add(micKey(d)); }
      }
    }
    if (!mic) {
      setState('nomic');
      return false;
    }
  }
  renderMicPicker();
  return true;
}

// The device in use, resolved to its own id (a microphone the browser picked reports 'default').
async function currentDeviceId() {
  if (!mic) return undefined;
  if (mic.deviceId && mic.deviceId !== 'default' && mic.deviceId !== 'communications') return mic.deviceId;
  const devices = await inputDevices().catch(() => []);
  return devices.find((d) => d.label && mic.label.endsWith(d.label))?.deviceId;
}

el.micSelect?.addEventListener('change', async () => {
  const id = el.micSelect.value;
  returnFocusToScene(el.micSelect); // keys go back to walking, not to the picker
  try {
    await replaceMic(id, { previousId: await currentDeviceId() });
  } catch (err) {
    console.error('Could not open the chosen microphone', err);
    addBubble('system', T('그 마이크를 열 수 없어요. 다른 것을 골라 주세요.', 'Could not open that microphone. Please pick another one.'));
    renderMicPicker();
  }
});
navigator.mediaDevices?.addEventListener?.('devicechange', () => renderMicPicker());

// ---------- Wiring ----------

// The mic button: talk over Bada, pause / resume listening, or retry the microphone.
el.mic.addEventListener('click', async () => {
  if (state === 'nomic' || !mic) {
    if (await startMic()) listen();
    return;
  }
  if (state === 'speaking') { listen(); return; }
  if (state === 'listening' || state === 'hearing') {
    mic.pause();
    bridge?.send({ bada: 'listen_end' });
    setState('paused');
    return;
  }
  if (state === 'paused') listen();
});

el.voice.addEventListener('click', () => {
  voiceOn = !voiceOn;
  if (!voiceOn && speaking) {
    stopSpeaking();
    afterBadaTurn();
  }
  el.voice.textContent = voiceOn ? T('🔊 목소리 켬', '🔊 Voice on') : T('🔈 목소리 끔', '🔈 Voice off');
  el.voice.setAttribute('aria-pressed', String(voiceOn));
});

// Keys belong to the walk. A click leaves focus on the chat control that was clicked, and the
// browser would then let walking keys operate it: arrows or a letter pick another microphone in
// the picker (W jumps to "Webcam …", a silent virtual input), Space presses the focused button
// (pausing the microphone). So while a chat control has focus, a walking key or a letter is
// swallowed and focus goes back to the 3D scene; the character still moves, because Pixel
// Streaming has already read the key on `document` before this window listener runs.
// Walking keys must not scroll the outer page either (the proposal site embeds this page).
const WALK_KEYS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' ', 'w', 'a', 's', 'd', 'W', 'A', 'S', 'D']);
const SCROLL_KEYS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' ', 'PageUp', 'PageDown', 'Home', 'End']);

function returnFocusToScene(control) {
  control?.blur();
  bridge?.focus?.(); // the cloud player is an iframe and only gets keys while focused
}

window.addEventListener('keydown', (e) => {
  const control = e.target.closest?.('.chat select, .chat button');
  if (control && !e.altKey && !e.ctrlKey && !e.metaKey &&
      (WALK_KEYS.has(e.key) || (control.tagName === 'SELECT' && e.key.length === 1))) {
    e.preventDefault();
    returnFocusToScene(control);
    return;
  }
  if (SCROLL_KEYS.has(e.key) && !e.target.closest?.('input, textarea, select, button')) e.preventDefault();
});

// A click is needed before the browser lets the page speak, play the stream or use the mic.
el.start.addEventListener('click', async () => {
  if (walkEnded) {
    location.reload(); // a fresh walk: new stream session, new conversation
    return;
  }
  started = true;
  touch();
  el.startOverlay.hidden = true;
  bridge?.play();
  el.start.blur();
  const micReady = await startMic(); // asks for microphone permission here
  addBubble('assistant', OPENING);
  history.push({ role: 'assistant', content: OPENING });
  if (voiceOn && synth) speak(OPENING);
  if (micReady && (!voiceOn || !synth)) listen();
  if (!micReady) addBubble('system', T(
    '바다와 이야기하려면 마이크가 필요해요. 주소창 옆의 마이크 아이콘에서 허용한 뒤, 아래 🎤 를 눌러 주세요.',
    'Bada needs your microphone. Allow it from the icon next to the address bar, then tap 🎤 below.'));
});

(async () => {
  document.documentElement.lang = CONFIG.lang;
  try {
    bridge = await createBridge(CONFIG, el.stage, setStatus);
  } catch (err) {
    console.error('Stream setup failed', err);
    setStatus('failed');
  }
  bridge?.onResponse((msg) => console.debug('[from UE]', msg));
})();
