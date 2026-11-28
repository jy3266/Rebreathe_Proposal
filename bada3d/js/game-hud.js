// The walk game on top of the 3D scene, made for children:
//   top centre  ⭐ score (bounces when it grows) and what has been found so far
//   top left    the friend walking along (emoji + name)
//   top right   💩 gauge: walking fills the friend's tummy; when full, a toilet appears and a
//               countdown runs (RBBadaBridge in Unreal decides; this only shows it)
//   pop-ups     "+1 🍭 막대사탕!" and a speech bubble for what the friend says
// plus small cheerful sounds made with Web Audio (no sound files).

import { audioContext } from './audio.js';
import { ITEMS } from './friends.js';

export function createHud({ stage, lang }) {
  const T = (ko, en) => (lang === 'ko' ? ko : en);

  const root = document.createElement('div');
  root.className = 'hud';
  root.hidden = true;
  root.innerHTML = `
    <div class="hud__friend"><span class="hud__friend-emoji"></span><span class="hud__friend-name"></span></div>
    <div class="hud__center">
      <div class="hud__score" role="status" aria-live="polite">
        <span class="hud__score-icon" aria-hidden="true">⭐</span>
        <span class="hud__score-num">0</span>
        <span class="hud__score-unit">${T('점', 'pts')}</span>
      </div>
      <div class="hud__found" aria-label="${T('주운 것', 'Found')}"></div>
    </div>
    <div class="hud__poop">
      <span class="hud__poop-label">💩 ${T('똥 게이지', 'Poop meter')}</span>
      <div class="hud__poop-bar"><div class="hud__poop-fill"></div></div>
      <span class="hud__poop-timer" hidden></span>
    </div>
    <div class="hud__pops" aria-hidden="true"></div>
    <div class="hud__bubble" hidden></div>`;
  stage.append(root);

  const q = (s) => root.querySelector(s);
  const scoreBox = q('.hud__score');
  const scoreNum = q('.hud__score-num');
  const found = q('.hud__found');
  const poopBox = q('.hud__poop');
  const poopFill = q('.hud__poop-fill');
  const poopTimer = q('.hud__poop-timer');
  const pops = q('.hud__pops');
  const bubble = q('.hud__bubble');

  const counts = {};
  let urgeTimer = 0;
  let bubbleTimer = 0;
  let muted = false;

  // ---------- sounds ----------
  function tone(freq, start, dur, { type = 'sine', gain = 0.18, slideTo } = {}) {
    const ctx = audioContext();
    if (!ctx || muted) return;
    const t0 = ctx.currentTime + start;
    const osc = ctx.createOscillator();
    const amp = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
    amp.gain.setValueAtTime(0.0001, t0);
    amp.gain.exponentialRampToValueAtTime(gain, t0 + 0.015);
    amp.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(amp).connect(ctx.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }
  function noise(start, dur, { from = 900, to = 200, gain = 0.25, q = 1 } = {}) {
    const ctx = audioContext();
    if (!ctx || muted) return;
    const t0 = ctx.currentTime + start;
    const buf = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * dur), ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.Q.value = q;
    filter.frequency.setValueAtTime(from, t0);
    filter.frequency.exponentialRampToValueAtTime(to, t0 + dur);
    const amp = ctx.createGain();
    amp.gain.setValueAtTime(gain, t0);
    amp.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(filter).connect(amp).connect(ctx.destination);
    src.start(t0);
  }
  const SOUNDS = {
    pick: () => { tone(1046, 0, 0.12); tone(1318, 0.08, 0.18); },
    star: () => [1046, 1318, 1568, 2093].forEach((f, i) => tone(f, i * 0.07, 0.22, { gain: 0.15 })),
    sparkle: () => [1568, 2093, 2637, 3136, 2637, 3136].forEach((f, i) => tone(f, i * 0.06, 0.25, { type: 'triangle', gain: 0.12 })),
    urge: () => { tone(220, 0, 0.35, { type: 'sawtooth', gain: 0.08, slideTo: 330 }); tone(330, 0.35, 0.45, { type: 'sawtooth', gain: 0.08, slideTo: 196 }); },
    plop: () => { tone(160, 0, 0.25, { type: 'square', gain: 0.1, slideTo: 60 }); noise(0, 0.25, { from: 500, to: 120, gain: 0.3, q: 2 }); },
    flush: () => { noise(0, 1.3, { from: 2400, to: 300, gain: 0.22, q: 0.7 }); tone(523, 1.1, 0.15); tone(784, 1.2, 0.25); },
  };
  function play(name) { try { SOUNDS[name]?.(); } catch { /* no audio */ } }

  // ---------- pieces ----------
  function pop(text, kind = '') {
    const p = document.createElement('div');
    p.className = `hud__pop${kind ? ` hud__pop--${kind}` : ''}`;
    p.textContent = text;
    pops.append(p);
    setTimeout(() => p.remove(), 1600);
  }

  function bounce(el) {
    el.classList.remove('is-bounce');
    void el.offsetWidth; // restart the animation
    el.classList.add('is-bounce');
  }

  function renderFound() {
    found.replaceChildren(...Object.entries(counts).map(([kind, n]) => {
      const chip = document.createElement('span');
      chip.className = 'hud__chip';
      chip.textContent = `${ITEMS[kind]?.emoji ?? '❓'}${n > 1 ? ` ×${n}` : ''}`;
      return chip;
    }));
  }

  function setScore(n) {
    if (String(n) === scoreNum.textContent) return;
    scoreNum.textContent = String(n);
    bounce(scoreBox);
  }

  function setMeter(pct) {
    const v = Math.max(0, Math.min(100, Number(pct) || 0));
    poopFill.style.width = `${v}%`;
    poopBox.classList.toggle('is-high', v >= 70);
  }

  function stopUrge() {
    clearInterval(urgeTimer);
    urgeTimer = 0;
    poopTimer.hidden = true;
    poopBox.classList.remove('is-urge');
  }

  return {
    show() { root.hidden = false; },
    hide() { root.hidden = true; stopUrge(); },
    setMuted(m) { muted = m; },
    setFriend(friend) {
      q('.hud__friend-emoji').textContent = friend.emoji;
      q('.hud__friend-name').textContent = friend.name[lang];
      root.style.setProperty('--friend', friend.color);
    },
    setScore,
    setMeter,

    item(kind, points, score) {
      const info = ITEMS[kind] || { emoji: '🎉', ko: '찾았다', en: 'Found it' };
      if (kind !== 'toilet') {
        counts[kind] = (counts[kind] || 0) + 1;
        renderFound();
      }
      setScore(score);
      pop(`+${points} ${info.emoji} ${info[lang]}!`, kind === 'star' || kind === 'golden_poop' ? 'big' : '');
      play(kind === 'golden_poop' ? 'sparkle' : kind === 'star' ? 'star' : kind === 'toilet' ? 'flush' : 'pick');
    },

    urge(seconds) {
      stopUrge();
      setMeter(100);
      poopBox.classList.add('is-urge');
      play('urge');
      let left = Math.round(Number(seconds) || 0);
      if (left > 0) {
        poopTimer.hidden = false;
        poopTimer.textContent = `🚽 ${left}${T('초', 's')}`;
        urgeTimer = setInterval(() => {
          left = Math.max(0, left - 1);
          poopTimer.textContent = `🚽 ${left}${T('초', 's')}`;
          if (left <= 5) bounce(poopTimer);
          if (left === 0) clearInterval(urgeTimer);
        }, 1000);
      }
    },

    poopDone(how, score) {
      stopUrge();
      setMeter(0);
      setScore(score);
      if (how === 'toilet') return; // the "+5 🚽" item event plays the flush
      play('plop');
      if (how === 'golden') setTimeout(() => play('sparkle'), 350);
      pop(how === 'golden' ? '✨💩✨' : '💩', 'big');
    },

    say(text, ms = 4500) {
      bubble.textContent = text;
      bubble.hidden = false;
      bounce(bubble);
      clearTimeout(bubbleTimer);
      bubbleTimer = setTimeout(() => { bubble.hidden = true; }, ms);
    },
  };
}
