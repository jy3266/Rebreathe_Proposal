// Settings for the "바다와 함께 걷기" 3D demo page.
// Values can be overridden with a URL parameter of the same name,
// e.g. index.html?stream=epic&ss=wss://...
//
// The proposal site (assets/js/stage3d.js) embeds this page and picks the stream:
//   - the REBREATHE studio PC, when it is on:  ?ss=wss://<quick tunnel host>
//   - Eagle 3D Streaming (cloud GPU) otherwise: ?stream=e3ds&e3ds=https://connector.eagle3dstreaming.com/v5/...
//
// This page is public (GitHub Pages), so a crafted link must not make it frame or connect to
// any other server. Outside local testing (localhost) only the expected hosts are accepted.

const params = new URLSearchParams(location.search);
const LOCAL = ['localhost', '127.0.0.1'].includes(location.hostname);

const WORKER = 'https://rebreathe-bada-chat.rebreathe-bada-chat.workers.dev';
const SELF_SS = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}`;

function parseUrl(value) {
  try { return value ? new URL(value) : null; } catch { return null; }
}

// Studio PC: a Cloudflare quick tunnel (wss://<random>.trycloudflare.com).
function pickSignalling(value) {
  const u = parseUrl(value);
  if (!u) return SELF_SS;
  if (LOCAL) return value;
  return u.protocol === 'wss:' && /^[a-z0-9-]+\.trycloudflare\.com$/.test(u.hostname) ? value : SELF_SS;
}

// Cloud: the Eagle 3D Streaming player.
function pickCloudPlayer(value) {
  const u = parseUrl(value);
  if (!u) return '';
  if (LOCAL) return value; // a test double of the player
  return u.protocol === 'https:' && /(^|\.)eagle3dstreaming\.com$/.test(u.hostname) ? value : '';
}

export const CONFIG = {
  // Cloudflare Worker that talks to Claude and turns speech into text (chat-worker, kept outside
  // this repo). Overridable only when testing locally (e.g. `wrangler dev`).
  worker: (LOCAL && params.get('worker')) || WORKER,

  // How the Unreal stream is shown:
  //   'epic'  - Epic Pixel Streaming frontend, connecting to the signalling server at `ss`
  //   'e3ds'  - Eagle 3D Streaming player in an iframe (`e3ds` link); starts only on "산책 시작하기",
  //             because the cloud bills every minute the stream is open
  //   'none'  - no stream (voice conversation only)
  stream: ['epic', 'e3ds', 'none'].includes(params.get('stream')) ? params.get('stream') : 'epic',

  // Signalling server URL for stream: 'epic'. Without one, connect back to the host that served
  // this page (the studio PC's signalling server serves it too).
  ss: pickSignalling(params.get('ss')),

  // Eagle 3D Streaming link for stream: 'e3ds' (Control Panel → the app's configuration → iframe).
  e3ds: pickCloudPlayer(params.get('e3ds')),

  // 'ko' or 'en'
  lang: params.get('lang') === 'en' ? 'en' : 'ko',
};
