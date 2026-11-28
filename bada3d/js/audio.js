// One AudioContext for everything the page plays (the friends' voices, game sounds).
// Mobile browsers only let a page make sound after a tap, so unlockAudio() runs inside the
// "산책 시작하기" click; after that, sound can start at any time.

let ctx = null;

export function audioContext() {
  return ctx;
}

export function unlockAudio() {
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return null;
  if (!ctx) {
    try { ctx = new Ctx(); } catch { return null; }
  }
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  // iOS also wants something actually played during the tap.
  try {
    const src = ctx.createBufferSource();
    src.buffer = ctx.createBuffer(1, 1, 22050);
    src.connect(ctx.destination);
    src.start(0);
  } catch { /* ignore */ }
  return ctx;
}
