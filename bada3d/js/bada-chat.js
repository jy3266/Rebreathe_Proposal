// Voice conversation with the walking friend (the child picks 🐻 포근이, 🐱 살랑이 or 🦉 호호 on the
// start card; friends.js), on top of the 3D walk with its little game (game-hud.js):
//   mic (voice.js detects one utterance) -> Worker /stt (Whisper) -> Worker /chat (Claude)
//   -> the friend's voice (speech-out.js: Worker /tts, else speechSynthesis), then listen again.
// Unreal (RBBadaBridge) walks the chosen friend along, scatters items to pick up, keeps the score
// and runs the poop game; its events arrive through the bridge and are shown in the HUD.
// On phones and tablets the scene gets touch controls (touch-controls.js).
// A child who would rather write opens ⌨️: typed lines go straight to /chat, and the microphone
// stays paused until 🎤 is tapped or ⌨️ is closed.
// The child may talk in Korean or English whatever the page language: /stt detects which, Claude
// answers in the child's language, and each spoken sentence gets a Korean or English voice.
// Each step is mirrored to Unreal through the bridge (Bada turns to the child, bobs while talking).

import { CONFIG } from './config.js';
import { createBridge } from './ue-bridge.js';
import { createMic } from './voice.js';
import { renderReport } from './report-view.js';
import { FRIENDS, FRIEND_IDS, ITEMS, GAME_LINES } from './friends.js';
import { unlockAudio } from './audio.js';
import { createSpeechOut } from './speech-out.js';
import { createHud } from './game-hud.js';
import { createTouchControls, prefersTouch } from './touch-controls.js';
import { runIntro } from './intro.js';

const KO = CONFIG.lang === 'ko';
const T = (ko, en) => (KO ? ko : en);

// The friend chosen on the start card (remembered for the next visit).
let friendId = (() => {
  try {
    const saved = localStorage.getItem('bada.friend');
    return FRIEND_IDS.includes(saved) ? saved : 'bear';
  } catch { return 'bear'; }
})();
const friend = () => FRIENDS[friendId];
const friendName = () => friend().name[CONFIG.lang];
const opening = () => friend().opening[CONFIG.lang];

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
  startForm: document.getElementById('start-form'),
  email: document.getElementById('report-email'),
  consent: document.getElementById('report-consent'),
  startError: document.getElementById('start-error'),
  finish: document.getElementById('finish-btn'),
  reportPanel: document.getElementById('report-panel'),
  reportStatus: document.getElementById('report-status'),
  reportBody: document.getElementById('report-body'),
  reportClose: document.getElementById('report-close'),
  reportAgain: document.getElementById('report-again'),
  typeBtn: document.getElementById('type-btn'),
  typeForm: document.getElementById('type-form'),
  typeInput: document.getElementById('type-input'),
  typeSend: document.getElementById('type-send'),
  hint: document.querySelector('.chat__hint'),
};

// Static page text: Korean in the HTML, English in data-en / data-en-* attributes.
if (!KO) {
  document.title = 'Walk with Bada';
  document.querySelectorAll('[data-en]').forEach((n) => { n.innerHTML = n.dataset.en; });
  document.querySelectorAll('[data-en-aria-label]').forEach((n) => n.setAttribute('aria-label', n.dataset.enAriaLabel));
  document.querySelectorAll('[data-en-placeholder]').forEach((n) => { n.placeholder = n.dataset.enPlaceholder; });
}

const history = []; // [{ role, content }] sent to the Worker
let voiceOn = true;
let typing = false; // ⌨️ is open
let bridge;
let mic = null;

// ---------- UI helpers ----------

function addBubble(role, text) {
  const div = document.createElement('div');
  div.className = `bubble bubble--${role}`;
  const who = document.createElement('span');
  who.className = 'bubble__who';
  who.textContent = role === 'user' ? T('나', 'Me') : role === 'system' ? '' : `${friend().emoji} ${friendName()}`;
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
  if (s === 'playing') streamPlaying = true;
  if (s === 'disconnected' || s === 'failed') stopGame();
}

// ---------- Ending a cloud walk ----------
// The cloud stream bills every open minute, so a walk ends after a quiet spell or when the
// player ends the session; the start card then offers a fresh walk (page reload).
const IDLE_END_MS = 5 * 60 * 1000;
let started = false;
let walkEnded = false;
let finished = false; // "산책 마치기": the conversation is over, never listen again
let lastActivity = Date.now();
const touch = () => { lastActivity = Date.now(); };

function endWalk(reason) {
  if (walkEnded) return;
  walkEnded = true;
  mic?.pause();
  stopSpeaking();
  stopGame();
  bridge?.stop?.();
  el.status.hidden = true;
  const card = el.startOverlay.querySelector('.start__card');
  card.querySelector('h2').textContent = T('산책을 잠시 쉬고 있어요', 'The walk is resting');
  card.querySelector('p').textContent = reason
    ? T(`3D 연결이 끝났어요 (${reason}). 다시 걸으려면 아래 버튼을 눌러 주세요.`, `The 3D session ended (${reason}). Press below to walk again.`)
    : T('한동안 조용해서 3D 산책을 멈췄어요. 다시 걸으려면 아래 버튼을 눌러 주세요.',
      'It was quiet for a while, so the 3D walk paused. Press below to walk again.');
  el.start.textContent = T('🎤 다시 걷기', '🎤 Walk again');
  el.startForm.classList.add('is-again');
  el.startOverlay.hidden = false;
  // The walk is over: the caregiver who gave an email still gets the report.
  if (reportEmail && reportState === 'idle' && childTurns() >= 1) finishWalk();
}

if (CONFIG.stream === 'e3ds') {
  setInterval(() => {
    const idle = state === 'listening' || state === 'paused' || state === 'nomic';
    if (started && !walkEnded && idle && Date.now() - lastActivity > IDLE_END_MS) endWalk();
  }, 15000);
}

// The child may speak either language, so check both word lists.
function isRisk(text) {
  const flat = text.replace(/\s/g, '');
  const lower = text.toLowerCase();
  return SAFETY_KO.some((w) => flat.includes(w)) || SAFETY_EN.some((w) => lower.includes(w));
}

// ---------- Conversation state (shown on the mic button) ----------

const VOICE_TEXT = {
  off: ['', ''],
  starting: ['마이크를 켜는 중…', 'Turning on the microphone…'],
  listening: ['듣고 있어요. 편하게 말해 보세요', "I'm listening — go ahead and talk"],
  hearing: ['듣는 중… 말을 마치면 {name}(이)가 대답해요', 'Listening… {name} answers when you finish'],
  transcribing: ['무슨 말인지 알아듣는 중…', 'Catching your words…'],
  thinking: ['{name}(이)가 생각하고 있어요…', '{name} is thinking…'],
  speaking: ['{name}(이)가 말하고 있어요 · 🎤 를 누르면 바로 말할 수 있어요', '{name} is talking · tap 🎤 to talk right away'],
  paused: ['잠시 쉬는 중 · 🎤 를 누르면 다시 들어요', 'Paused · tap 🎤 to listen again'],
  missed: ['잘 못 들었어요. 한 번 더 말해 줄래요?', "I didn't catch that. Could you say it again?"],
  nomic: ['마이크를 쓸 수 없어요. 허용한 뒤 🎤 를 누르거나 ⌨️ 로 써 주세요', 'No microphone. Allow it and tap 🎤, or write with ⌨️'],
  error: ['연결이 잠깐 끊겼어요. 🎤 를 눌러 다시 말해 주세요', 'Connection hiccup. Tap 🎤 and say it again'],
  typing: ['글로 써서 보내 보세요 · 🎤 를 누르면 말로도 할 수 있어요', 'Write to {name} · tap 🎤 to talk instead'],
};
let state = 'off';

// '{name}(이)가' -> '포근이가' / '호호가': Korean picks 이가 or 가 by the last syllable.
function withName(text) {
  const name = friendName();
  const last = name.charCodeAt(name.length - 1);
  const batchim = last >= 0xac00 && last <= 0xd7a3 && (last - 0xac00) % 28 !== 0;
  return text.replaceAll('{name}(이)가', name + (batchim ? '이가' : '가')).replaceAll('{name}', name);
}

function setState(s, textKey = s) {
  state = s;
  el.mic.dataset.state = s;
  el.mic.setAttribute('aria-pressed', String(s === 'listening' || s === 'hearing'));
  const t = VOICE_TEXT[textKey] || VOICE_TEXT.off;
  el.voiceStatus.textContent = withName(T(t[0], t[1]));
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

let replyStreaming = false;
// A new line can be sent only once the friend's reply has fully arrived (the history must alternate).
function setReplyStreaming(on) {
  replyStreaming = on;
  if (el.typeSend) el.typeSend.disabled = on;
}
let replyId = 0;
let silencedReply = -1; // the child talked over this reply: show the rest, don't speak it

const speech = createSpeechOut({
  worker: CONFIG.worker,
  pageLang: CONFIG.lang,
  onStart(sentence) {
    touch();
    bridge?.send({ bada: 'speak_start', text: sentence });
    if (['off', 'starting', 'transcribing', 'thinking'].includes(state)) setState('speaking');
  },
  onIdle() {
    bridge?.send({ bada: 'speak_end' });
    afterBadaTurn();
  },
});

// Which voice reads a sentence: Korean if it has Hangul, English if it has Latin letters.
function languageOf(text) {
  if (/[ㄱ-ㆎ가-힣]/.test(text)) return 'ko';
  if (/[a-z]/i.test(text)) return 'en';
  return CONFIG.lang;
}

function speak(sentence, forReply = replyId) {
  if (!voiceOn || !sentence.trim() || forReply === silencedReply) return;
  speech.speak(sentence, { lang: languageOf(sentence), reply: forReply, friend: friendId });
}

function stopSpeaking() {
  if (speech.busy) bridge?.send({ bada: 'speak_end' });
  speech.stop();
}

// Once Bada has finished (reply fully streamed and spoken), it is the child's turn again.
function afterBadaTurn() {
  if (finished || replyStreaming || speech.busy) return;
  if (typing) {
    // The child is writing: the microphone opens only when 🎤 is tapped.
    if (!mic?.active) setState('paused', 'typing');
    return;
  }
  if (!mic) {
    setState('nomic');
    return;
  }
  if (state === 'paused' || mic.active) return;
  setTimeout(() => {
    if (!replyStreaming && !speech.busy && state !== 'paused' && !mic.active) listen();
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
  if (finished) return;
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
    // Korean or English, detected per utterance; the page language decides when unsure.
    const res = await fetch(`${CONFIG.worker}/stt?lang=auto&hint=${CONFIG.lang}`, {
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

async function converse(text, { typed = false } = {}) {
  addBubble('user', text);
  history.push({ role: 'user', content: text });

  if (isRisk(text)) {
    el.safety.hidden = false;
    bridge?.send({ bada: 'safety' });
  }

  setState('thinking');
  setReplyStreaming(true);
  const id = ++replyId;
  const body = addBubble('assistant', '…');
  let reply = '';
  let pending = '';

  try {
    const res = await fetch(`${CONFIG.worker}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: history, character: friendId, notes: gameNotes() }),
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
    if (typed && !el.typeInput.value) el.typeInput.value = text; // or send the same words again
    setReplyStreaming(false);
    speak(reply, id);
    afterBadaTurn(); // no-op while the apology is being spoken; continues when it ends
    return;
  }

  history.push({ role: 'assistant', content: reply.trim() || '…' });
  setReplyStreaming(false);
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
  if (finished) return;
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
  if (!voiceOn && speech.busy) {
    stopSpeaking();
    afterBadaTurn();
  }
  el.voice.textContent = voiceOn ? T('🔊 목소리 켬', '🔊 Voice on') : T('🔈 목소리 끔', '🔈 Voice off');
  el.voice.setAttribute('aria-pressed', String(voiceOn));
});

// ---------- Typing (⌨️) ----------
// For a child who cannot or would rather not talk (a quiet room, no microphone, shyness).
// While it is open the microphone does not reopen on its own after Bada answers, so it does not
// pick up the room while the child writes; 🎤 still listens once when tapped.

function setTyping(on) {
  typing = on;
  el.typeForm.hidden = !on;
  el.typeBtn.setAttribute('aria-pressed', String(on));
  if (on) {
    if (mic?.active) {
      mic.pause();
      bridge?.send({ bada: 'listen_end' });
    }
    if (!['transcribing', 'thinking', 'speaking'].includes(state)) setState('paused', 'typing');
    el.typeInput.focus();
    return;
  }
  returnFocusToScene(el.typeBtn); // back to walking
  if (!started || finished || walkEnded) return;
  if (!mic) setState('nomic');
  else if (!replyStreaming && !speech.busy && !mic.active) listen(); // back to talking
}

function sendTyped() {
  const text = el.typeInput.value.trim();
  if (!text || !started || finished || walkEnded || replyStreaming) return;
  el.typeInput.value = '';
  touch();
  if (mic?.active) {
    mic.pause();
    bridge?.send({ bada: 'listen_end' });
  }
  stopSpeaking(); // writing over Bada works like talking over her
  converse(text, { typed: true });
}

if (el.typeBtn && el.typeForm && el.typeInput) {
  el.typeBtn.addEventListener('click', () => setTyping(!typing));

  // Enter sends. With a Korean IME the Enter that commits the last syllable arrives while still
  // composing; sending then would clear the box before that syllable lands (it would reappear
  // alone). So wait for the composition to end, and take the value only after that.
  let sendAfterComposition = false;
  el.typeInput.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      returnFocusToScene(el.typeInput); // walk again without closing the box
      return;
    }
    if (e.key !== 'Enter') return;
    e.preventDefault(); // no implicit form submit: the cases are handled here
    // Only isComposing: some mobile keyboards report keyCode 229 for every key, even with no
    // composition (no compositionend would follow), and Safari ends the composition before this.
    if (e.isComposing) {
      sendAfterComposition = true;
      return;
    }
    sendTyped();
  });
  el.typeInput.addEventListener('compositionend', () => {
    if (!sendAfterComposition) return;
    sendAfterComposition = false;
    setTimeout(sendTyped, 0); // an Enter right after may already have sent it: then the box is empty
  });
  el.typeInput.addEventListener('input', touch); // writing is activity (the cloud idle timer)
  el.typeForm.addEventListener('submit', (e) => {
    e.preventDefault(); // the Send button
    sendTyped();
    el.typeInput.focus();
  });
  // Keys typed here are text, not walking: Pixel Streaming reads keys on `document`, and the
  // window handler below would hand focus back to the scene.
  ['keydown', 'keyup', 'keypress'].forEach((type) => el.typeForm.addEventListener(type, (e) => e.stopPropagation()));
}

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

// ---------- The friend and the walk game ----------
// On the start card the child picks a friend (big emoji cards). When the walk starts, the page
// says hello to Unreal (repeating until it answers, since a cloud build may still be loading);
// a build that knows the game answers "ready" with "touch,game", walks the chosen friend along and
// then reports items found, the score and the poop game. Older builds never answer that way, and
// then the page simply has no HUD or touch controls.

const SESSION = crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const hud = createHud({ stage: el.stage, lang: CONFIG.lang });
const touchPad = createTouchControls({
  stage: el.stage,
  lang: CONFIG.lang,
  send: (msg) => bridge?.send(msg),
  onUse: touch, // walking counts as activity for the cloud idle timer
});
let ueReady = false;
let helloTimer = 0;
let streamPlaying = false;
const game = { score: 0, found: 0, lastItem: '', events: [] };

function renderFriendPicker() {
  const box = document.getElementById('friend-pick');
  if (!box) return;
  box.replaceChildren(...FRIEND_IDS.map((id) => {
    const f = FRIENDS[id];
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'friend';
    b.style.setProperty('--friend', f.color);
    b.setAttribute('aria-pressed', String(id === friendId));
    b.innerHTML = `<span class="friend__emoji" aria-hidden="true">${f.emoji}</span>` +
      `<span class="friend__name">${f.name[CONFIG.lang]}</span>` +
      `<span class="friend__about">${f.about[CONFIG.lang]}</span>`;
    b.addEventListener('click', () => {
      friendId = id;
      try { localStorage.setItem('bada.friend', id); } catch { /* private mode */ }
      renderFriendPicker();
      applyFriend();
    });
    return b;
  }));
}

// The chosen friend everywhere on the page (HUD, status texts; Unreal on the next hello).
function applyFriend() {
  hud.setFriend(friend());
  document.documentElement.style.setProperty('--friend', friend().color);
  if (ueReady) bridge?.send({ bada: 'character', value: friendId });
  if (state !== 'off') setState(state);
}

function startGame() {
  if (helloTimer || ueReady) return;
  let tries = 0;
  const hello = () => {
    if (ueReady || walkEnded || ++tries > 160) { // a cloud start can take a couple of minutes
      clearInterval(helloTimer);
      helloTimer = 0;
      return;
    }
    // The cloud player drops messages until the build listens; the studio stream until it plays.
    if (streamPlaying || CONFIG.stream === 'e3ds') bridge?.send({ bada: 'hello', session: SESSION, character: friendId });
  };
  hello();
  helloTimer = setInterval(hello, 1500);
}

function stopGame() {
  clearInterval(helloTimer);
  helloTimer = 0;
  touchPad.disable();
  hud.hide();
}

// What just happened in the game, for the friend's replies (Worker /chat `notes`).
function gameNotes() {
  if (!ueReady) return [];
  const notes = [];
  if (game.found) {
    notes.push(`아이가 지금까지 아이템 ${game.found}개를 주워서 점수가 ${game.score}점이야. 방금 주운 건 ${game.lastItem}.`);
  }
  return notes.concat(game.events.slice(-4));
}
function noteEvent(text) {
  game.events.push(text);
  if (game.events.length > 8) game.events.shift();
}

// The friend says something about the game: always in the bubble over the scene and the chat log;
// aloud only when that does not cut into the conversation (nobody is talking or thinking).
function announce(line) {
  const text = line[CONFIG.lang];
  hud.say(`${friend().emoji} ${text}`);
  addBubble('game', text);
  if (!voiceOn || finished || walkEnded || replyStreaming || speech.busy) return;
  if (state !== 'listening') return; // talking, thinking, typing or paused: just the bubble
  mic?.pause();
  bridge?.send({ bada: 'listen_end' });
  setState('speaking');
  speak(text, -2); // when it ends, afterBadaTurn() listens again
}

// Unreal's responses. The cloud player may deliver the same response twice, so an identical
// message within a second is ignored (every real game event carries a new score or value).
let lastRaw = '';
let lastRawAt = 0;
function onUnrealMessage(raw) {
  let msg = raw;
  if (typeof msg === 'string') {
    try { msg = JSON.parse(msg); } catch { return; }
  }
  if (!msg || typeof msg !== 'object' || typeof msg.bada !== 'string') return;
  const key = JSON.stringify(msg);
  if (key === lastRaw && Date.now() - lastRawAt < 1000) return;
  lastRaw = key;
  lastRawAt = Date.now();
  console.debug('[from UE]', key);

  switch (msg.bada) {
    case 'ready': {
      const caps = String(msg.value || '').split(',');
      if (!caps.includes('game') || ueReady) return;
      ueReady = true;
      clearInterval(helloTimer);
      helloTimer = 0;
      hud.setFriend(friend());
      hud.setScore(Number(msg.score) || 0);
      hud.show();
      if (caps.includes('touch') && prefersTouch()) {
        touchPad.enable();
        if (el.hint) el.hint.textContent = T('왼쪽을 밀면 걷고, 오른쪽을 밀면 둘러봐요 · 반짝이는 선물을 주워 봐요!', 'Slide left to walk, slide right to look · pick up the shiny treats!');
      } else if (el.hint) {
        el.hint.textContent = T('방향키로 걷고 마우스로 둘러봐요 · 반짝이는 선물을 주워 봐요!', 'Walk with the arrow keys, look with the mouse · pick up the shiny treats!');
      }
      break;
    }
    case 'item': {
      const kind = String(msg.value || '');
      const points = Number(msg.points) || 0;
      game.score = Number(msg.score) || 0;
      if (kind !== 'toilet') {
        game.found++;
        game.lastItem = ITEMS[kind]?.ko || kind;
      }
      hud.item(kind, points, game.score);
      if (kind === 'poop' || kind === 'golden_poop') noteEvent(`아이가 친구(너)의 ${kind === 'golden_poop' ? '황금똥' : '똥'}을 치워 줬어.`);
      touch();
      break;
    }
    case 'poop_meter':
      hud.setMeter(msg.value);
      break;
    case 'poop_urge':
      hud.urge(msg.value);
      noteEvent('친구(너)가 똥이 마려워서 아이와 함께 화장실을 찾기 시작했어.');
      announce(msg.toilet === false ? GAME_LINES.urgeNoToilet : GAME_LINES.urge);
      break;
    case 'poop_done': {
      const how = String(msg.value || 'ground');
      game.score = Number(msg.score) || game.score;
      hud.poopDone(how, game.score);
      noteEvent(how === 'toilet'
        ? '아이와 같이 화장실에 제때 도착해서 친구(너)가 시원하게 볼일을 봤어.'
        : `친구(너)가 화장실까지 못 참고 길에 ${how === 'golden' ? '황금똥' : '똥'}을 싸 버렸어. 조금 부끄러워.`);
      announce(how === 'toilet' ? GAME_LINES.toilet : how === 'golden' ? GAME_LINES.golden : GAME_LINES.ground);
      break;
    }
    default:
      break;
  }
}

renderFriendPicker();
applyFriend();
runIntro({ lang: CONFIG.lang, onTap: unlockAudio });

// ---------- Caregiver report ----------
// The optional email given at the start receives the "마음 리포트" (Worker /report) when the walk
// ends: by "산책 마치기", after a quiet spell in the cloud, or — if the page is simply closed — by a
// last beacon. Without an email the report is only shown here.

const EMAIL_RE = /^[^\s@<>()"',;:]{1,64}@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/;
let reportEmail = '';
let reportState = 'idle'; // idle | working | done
let lastReport = null;
const childTurns = () => history.filter((m) => m.role === 'user').length;

function reportStatus(text, kind = '') {
  el.reportStatus.textContent = text;
  el.reportStatus.className = 'report__status' + (kind ? ` is-${kind}` : '');
}

async function finishWalk() {
  if (reportState === 'working') return;
  if (reportState === 'done' && lastReport) { el.reportPanel.hidden = false; return; }
  if (childTurns() < 1) {
    addBubble('system', T('바다와 한마디라도 나눈 뒤에 리포트를 만들 수 있어요.', 'Say something to Bada first, then I can make the report.'));
    return;
  }
  reportState = 'working';
  finished = true; // no more listening
  walkEnded = true; // the quiet-spell timer stops; "다시 걷기" starts over
  mic?.pause();
  stopSpeaking();
  setState('paused');
  bridge?.send({ bada: 'speak_end' });
  stopGame();
  bridge?.stop?.(); // the cloud stream bills by the minute
  el.finish.hidden = true;
  const bye = T('오늘 같이 걸어 줘서 고마워. 네 마음 이야기, 잘 들었어. 또 만나!', 'Thank you for walking with me today. I loved hearing about your day. See you again!');
  addBubble('assistant', bye);
  speak(bye);

  el.reportBody.innerHTML = `<div class="report__loading"><i></i>${T('바다와 나눈 이야기를 읽고 마음 리포트를 만들고 있어요… (30초쯤 걸려요)', 'Reading the talk with Bada and writing the heart report… (about 30 seconds)')}</div>`;
  reportStatus('');
  el.reportPanel.hidden = false;

  try {
    const res = await fetch(`${CONFIG.worker}/report`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: reportEmail || undefined, consent: !!reportEmail, lang: CONFIG.lang, messages: history }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.report) {
      const err = new Error(data.error || `HTTP ${res.status}`);
      err.status = res.status;
      throw err;
    }
    lastReport = data.report;
    el.reportBody.innerHTML = renderReport(data.report, CONFIG.lang);
    if (data.emailed) reportStatus(T(`📧 ${reportEmail} 로 리포트를 보냈어요.`, `📧 The report was sent to ${reportEmail}.`), 'ok');
    else if (!reportEmail) reportStatus(T('이메일을 넣지 않아서 이 화면에서만 보여 드려요.', 'No email was given, so the report is shown here only.'));
    else if (data.mailError === 'not-configured') reportStatus(T('이메일 보내기 설정이 아직 끝나지 않아, 이번에는 이 화면에서만 보여 드려요.', 'Email sending is not set up yet, so this time the report is shown here only.'), 'warn');
    else reportStatus(T('이메일을 보내지 못했어요. 이 화면의 리포트를 확인해 주세요.', 'The email could not be sent. Please read the report here.'), 'warn');
    reportState = 'done';
  } catch (err) {
    console.error('Report failed', err);
    reportState = 'idle';
    el.finish.hidden = false;
    el.finish.textContent = T('🔁 리포트 다시 만들기', '🔁 Try the report again');
    el.reportBody.innerHTML = '';
    reportStatus(err.status === 429
      ? T('오늘 만들 수 있는 리포트 수를 넘었어요. 내일 다시 해 주세요.', 'The daily report limit was reached. Please try again tomorrow.')
      : T('리포트를 만들지 못했어요. 잠시 뒤 위의 버튼으로 다시 시도해 주세요.', 'The report could not be made. Please try again in a moment.'), 'warn');
  }
}

el.finish?.addEventListener('click', () => {
  el.finish.blur();
  finishWalk();
});
el.reportClose?.addEventListener('click', () => {
  el.reportPanel.hidden = true;
  if (reportState === 'done') {
    el.finish.hidden = false;
    el.finish.textContent = T('📄 리포트 보기', '📄 View report');
  }
});
el.reportAgain?.addEventListener('click', () => location.reload());

// Closing the page mid-walk: still send the report to the given email (fire and forget).
// text/plain keeps it a simple request; a beacon body must stay under ~64 KB.
addEventListener('pagehide', () => {
  if (!reportEmail || reportState !== 'idle' || childTurns() < 2) return;
  let messages = history.slice(-40);
  let body = JSON.stringify({ email: reportEmail, consent: true, lang: CONFIG.lang, messages });
  while (new Blob([body]).size > 60000 && messages.length > 4) {
    messages = messages.slice(4);
    body = JSON.stringify({ email: reportEmail, consent: true, lang: CONFIG.lang, messages });
  }
  if (navigator.sendBeacon?.(`${CONFIG.worker}/report`, new Blob([body], { type: 'text/plain' }))) reportState = 'done';
});

// Typing the email must not also walk the character (Pixel Streaming reads keys on `document`).
['keydown', 'keyup', 'keypress'].forEach((type) => el.startForm?.addEventListener(type, (e) => e.stopPropagation()));

// A click is needed before the browser lets the page speak, play the stream or use the mic.
el.startForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (walkEnded) {
    location.reload(); // a fresh walk: new stream session, new conversation
    return;
  }
  const email = el.email.value.trim();
  const problem = email && !EMAIL_RE.test(email)
    ? T('이메일 주소를 다시 확인해 주세요.', 'Please check the email address.')
    : email && !el.consent.checked
      ? T('리포트를 받으려면 동의에 체크해 주세요. 받지 않으려면 이메일 칸을 비워 두세요.', 'To get the report, please tick the consent box. Leave the email empty to skip it.')
      : '';
  if (problem) {
    el.startError.textContent = problem;
    el.startError.hidden = false;
    return;
  }
  el.startError.hidden = true;
  reportEmail = email;
  el.startForm.classList.add('is-again');
  el.finish.hidden = false;
  started = true;
  touch();
  unlockAudio(); // inside the tap: phones allow sound from now on
  el.startOverlay.hidden = true;
  applyFriend();
  bridge?.play();
  startGame();
  el.start.blur();
  // The greeting comes first in the log and the history even while the browser is still asking
  // for the microphone: a child may already be typing (⌨️) during that prompt.
  addBubble('assistant', opening());
  history.push({ role: 'assistant', content: opening() });
  const micReady = await startMic(); // asks for microphone permission here
  if (childTurns() === 0) {
    // Spoken only now, so that the microphone can take over when the greeting ends. If the child
    // has written meanwhile, the conversation has moved on: don't say hello over it.
    if (voiceOn && speech.available) speak(opening());
    else if (micReady && !typing) listen();
  }
  if (!micReady) addBubble('system', T(
    '바다와 말로 이야기하려면 마이크가 필요해요. 주소창 옆의 마이크 아이콘에서 허용한 뒤 아래 🎤 를 누르거나, 위의 ⌨️ 키보드로 써 주세요.',
    'To talk with Bada, allow the microphone from the icon next to the address bar and tap 🎤 below, or write with ⌨️ above.'));
});

(async () => {
  document.documentElement.lang = CONFIG.lang;
  try {
    bridge = await createBridge(CONFIG, el.stage, setStatus);
  } catch (err) {
    console.error('Stream setup failed', err);
    setStatus('failed');
  }
  bridge?.onResponse(onUnrealMessage);
  // Local testing only: send raw messages to Unreal from the console, e.g.
  // __bada.send({ bada: 'config', poopMeters: 20 }).
  if (['localhost', '127.0.0.1'].includes(location.hostname)) {
    window.__bada = { send: (msg) => bridge?.send(msg), game, get ready() { return ueReady; } };
  }
})();
