// The opening of the walk: a short film of the three friends playing with children (made with
// Higgsfield, media/intro.mp4), then the REBREATHE card, then the start card underneath.
//   - It starts with a tap ("▶ 시작"): a tap is what lets the film play with sound on phones,
//     and it also unlocks the friends' voices for later.
//   - "건너뛰기" skips it; it is shown once per browser session (a "다시 걷기" reload skips it);
//     ?intro=0 turns it off, ?intro=1 forces it.

const SEEN_KEY = 'bada.introSeen';
const BRAND_MS = 2600;

export function runIntro({ lang, onTap }) {
  const root = document.getElementById('intro');
  const video = document.getElementById('intro-video');
  if (!root || !video) return Promise.resolve();
  const T = (ko, en) => (lang === 'ko' ? ko : en);
  const param = new URLSearchParams(location.search).get('intro');
  let seen = false;
  try { seen = sessionStorage.getItem(SEEN_KEY) === '1'; } catch { /* private mode */ }
  if (param === '0' || (seen && param !== '1')) {
    root.remove();
    return Promise.resolve();
  }

  const play = root.querySelector('.intro__play');
  const skip = root.querySelector('.intro__skip');
  const brand = root.querySelector('.intro__brand');
  play.querySelector('span').textContent = T('눌러서 시작해요', 'Tap to start');
  skip.textContent = T('건너뛰기 ⏭', 'Skip ⏭');
  root.hidden = false;

  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      try { sessionStorage.setItem(SEEN_KEY, '1'); } catch { /* ignore */ }
      video.pause();
      // The company card, then fade away to the start card.
      root.classList.add('is-brand');
      brand.hidden = false;
      setTimeout(() => {
        root.classList.add('is-out');
        setTimeout(() => { root.remove(); resolve(); }, 600);
      }, BRAND_MS);
    };

    play.addEventListener('click', () => {
      onTap?.();
      play.hidden = true;
      skip.hidden = false;
      root.classList.add('is-playing');
      video.muted = false;
      const p = video.play();
      // No film (missing file, unsupported format) or the browser refuses: go on to the card.
      if (p && p.catch) {
        p.catch(() => {
          video.muted = true;
          video.play().catch(finish);
        });
      }
    }, { once: true });
    skip.addEventListener('click', finish, { once: true });
    video.addEventListener('ended', finish);
    video.addEventListener('error', () => { if (!play.hidden) return; finish(); });
  });
}
