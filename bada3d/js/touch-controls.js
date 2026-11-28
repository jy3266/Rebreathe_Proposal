// Touch controls for phones and tablets, over the 3D scene.
//   left part of the scene:  a thumb joystick appears where the thumb lands -> walk
//   right part of the scene: drag -> look around (turn)
// Both work at once (two thumbs). They go to Unreal as UIInteraction messages, which both stream
// paths forward unchanged (studio PC and Eagle 3D Streaming):
//   { bada: 'move', x, y }        x = right, y = forward, each -1..1; repeated while held
//   { bada: 'look', yaw, pitch }  degrees to turn now (yaw > 0 = right, pitch > 0 = up)
// RBBadaBridge (Unreal) walks the player and turns the camera. Builds without that code don't
// answer "touch" to hello, and then the controls are never shown.

const JOY_RADIUS = 56; // px: how far the knob travels
const DEADZONE = 0.12;
const MOVE_REPEAT_MS = 150; // Unreal stops walking 600 ms after the last move message
const LOOK_FLUSH_MS = 33; // ~30 messages a second at most
const LOOK_DEG_PER_WIDTH = 240; // a drag across the whole scene turns this far
const PITCH_SHARE = 0.6; // looking up and down is slower than turning

/** True on devices whose main pointer is a finger (phones, tablets). `?touch=1|0` overrides. */
export function prefersTouch() {
  const forced = new URLSearchParams(location.search).get('touch');
  if (forced === '1') return true;
  if (forced === '0') return false;
  return matchMedia('(pointer: coarse)').matches || (navigator.maxTouchPoints > 0 && !matchMedia('(pointer: fine)').matches);
}

/**
 * @param {{ stage: HTMLElement, send: (msg: object) => void, lang: 'ko'|'en',
 *           onUse?: () => void }} opts   onUse: called whenever the child walks or looks around
 */
export function createTouchControls({ stage, send, lang, onUse }) {
  const T = (ko, en) => (lang === 'ko' ? ko : en);

  const pad = document.createElement('div');
  pad.className = 'touch';
  pad.hidden = true;
  pad.setAttribute('aria-hidden', 'true');
  pad.innerHTML = `
    <div class="touch__stick" hidden><div class="touch__knob"></div></div>
    <div class="touch__hint">
      <span class="touch__hint-walk">👈 ${T('여기를 밀면 걸어요', 'Slide here to walk')}</span>
      <span class="touch__hint-look">${T('여기를 밀면 둘러봐요', 'Slide here to look')} 👉</span>
    </div>`;
  stage.append(pad);
  const stick = pad.querySelector('.touch__stick');
  const knob = pad.querySelector('.touch__knob');
  const hint = pad.querySelector('.touch__hint');

  let enabled = false;
  let joy = null; // { id, x0, y0, x, y }
  let lookId = null;
  let lookLast = null;
  let lookAcc = { x: 0, y: 0 };
  let lookTimer = 0;
  let moveTimer = 0;
  let lastMove = { x: 0, y: 0 };
  let used = false;

  // Every walk or look counts as activity (the cloud walk ends after a quiet spell); the hint
  // fades after the first one.
  function markUsed() {
    onUse?.();
    if (used) return;
    used = true;
    setTimeout(() => hint.classList.add('is-gone'), 1500);
  }

  // ---------- walking ----------
  function joyVector() {
    if (!joy) return { x: 0, y: 0 };
    let dx = (joy.x - joy.x0) / JOY_RADIUS;
    let dy = (joy.y - joy.y0) / JOY_RADIUS;
    const len = Math.hypot(dx, dy);
    if (len > 1) { dx /= len; dy /= len; }
    if (len < DEADZONE) return { x: 0, y: 0 };
    return { x: +dx.toFixed(2), y: +(-dy).toFixed(2) }; // screen up = forward
  }

  function sendMove() {
    const v = joyVector();
    if (v.x !== lastMove.x || v.y !== lastMove.y || v.x || v.y) send({ bada: 'move', ...v });
    if (v.x || v.y) onUse?.();
    lastMove = v;
  }

  function drawStick() {
    if (!joy) { stick.hidden = true; return; }
    const box = pad.getBoundingClientRect();
    stick.hidden = false;
    stick.style.left = `${joy.x0 - box.left}px`;
    stick.style.top = `${joy.y0 - box.top}px`;
    let dx = joy.x - joy.x0;
    let dy = joy.y - joy.y0;
    const len = Math.hypot(dx, dy);
    if (len > JOY_RADIUS) { dx *= JOY_RADIUS / len; dy *= JOY_RADIUS / len; }
    knob.style.transform = `translate(${dx}px, ${dy}px)`;
  }

  function endJoy() {
    joy = null;
    clearInterval(moveTimer);
    moveTimer = 0;
    lastMove = { x: 0, y: 0 };
    send({ bada: 'move', x: 0, y: 0 });
    drawStick();
  }

  // ---------- looking ----------
  function flushLook() {
    lookTimer = 0;
    if (!lookAcc.x && !lookAcc.y) return;
    const k = LOOK_DEG_PER_WIDTH / Math.max(pad.clientWidth, 320);
    send({ bada: 'look', yaw: +(lookAcc.x * k).toFixed(2), pitch: +(-lookAcc.y * k * PITCH_SHARE).toFixed(2) });
    lookAcc = { x: 0, y: 0 };
  }

  // ---------- pointer events (touch and pen only; a mouse keeps its usual control) ----------
  function isFinger(e) { return e.pointerType === 'touch' || e.pointerType === 'pen'; }

  pad.addEventListener('pointerdown', (e) => {
    if (!enabled || !isFinger(e)) return;
    e.preventDefault();
    const box = pad.getBoundingClientRect();
    const leftSide = e.clientX - box.left < box.width * 0.45;
    if (leftSide && !joy) {
      joy = { id: e.pointerId, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY };
      pad.setPointerCapture(e.pointerId);
      drawStick();
      clearInterval(moveTimer);
      moveTimer = setInterval(sendMove, MOVE_REPEAT_MS);
    } else if (lookId === null) {
      lookId = e.pointerId;
      lookLast = { x: e.clientX, y: e.clientY };
      pad.setPointerCapture(e.pointerId);
    }
  });

  pad.addEventListener('pointermove', (e) => {
    if (!enabled) return;
    if (joy && e.pointerId === joy.id) {
      joy.x = e.clientX;
      joy.y = e.clientY;
      drawStick();
      if (Math.hypot(joy.x - joy.x0, joy.y - joy.y0) > JOY_RADIUS * DEADZONE) markUsed();
    } else if (e.pointerId === lookId) {
      lookAcc.x += e.clientX - lookLast.x;
      lookAcc.y += e.clientY - lookLast.y;
      lookLast = { x: e.clientX, y: e.clientY };
      if (!lookTimer) lookTimer = setTimeout(flushLook, LOOK_FLUSH_MS);
      markUsed();
    }
  });

  function onUp(e) {
    if (joy && e.pointerId === joy.id) endJoy();
    if (e.pointerId === lookId) {
      clearTimeout(lookTimer);
      flushLook();
      lookId = null;
    }
  }
  pad.addEventListener('pointerup', onUp);
  pad.addEventListener('pointercancel', onUp);
  pad.addEventListener('lostpointercapture', onUp);
  // No long-press menu, text selection or double-tap zoom on the scene.
  pad.addEventListener('contextmenu', (e) => e.preventDefault());

  return {
    enable() {
      if (enabled) return;
      enabled = true;
      pad.hidden = false;
    },
    disable() {
      if (!enabled) return;
      if (joy) endJoy();
      lookId = null;
      enabled = false;
      pad.hidden = true;
    },
    get enabled() { return enabled; },
  };
}
