// Bridge between the web page and the Unreal build (studio PC via Epic's frontend, or the
// Eagle 3D Streaming cloud player in an iframe).
// The page sends small JSON messages over the Pixel Streaming data channel;
// the RBBadaBridge C++ class in the Unreal project receives them (descriptor field "bada").
//
//   { bada: 'speak_start', text }   Bada starts talking (UE animates the nearest AI_CH)
//   { bada: 'speak_end' }           Bada stopped talking
//   { bada: 'listen_start' }        the child is talking (UE turns AI_CH toward the player)
//   { bada: 'listen_end' }
//   { bada: 'safety' }              risk words detected (UE keeps AI_CH close and calm)
//
// UE answers on the response channel "bada", e.g. { bada: 'ready', character: 'Bear' }.

// The library's UMD build expects the `sdp` package as a global. ESM CDN wrappers of the
// library break on sdp's CommonJS export ("splitSections is not a function"), so load both
// explicitly instead.
const SDP_LIB = 'https://esm.sh/sdp@3.2.3';
const EPIC_UMD =
  'https://cdn.jsdelivr.net/npm/@epicgames-ps/lib-pixelstreamingfrontend-ue5.4@1.1.6/dist/lib-pixelstreamingfrontend.js';

async function loadEpicLib() {
  if (!window['lib-pixelstreamingfrontend']) {
    const mod = await import(SDP_LIB);
    window.sdp = typeof mod.splitSections === 'function' ? mod : mod.default;
    await new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = EPIC_UMD;
      s.onload = resolve;
      s.onerror = () => reject(new Error('Pixel Streaming library failed to load'));
      document.head.appendChild(s);
    });
  }
  return window['lib-pixelstreamingfrontend'];
}

export async function createBridge(config, container, onStatus) {
  if (config.stream === 'epic') return createEpicBridge(config, container, onStatus);
  if (config.stream === 'e3ds' && config.e3ds) return createE3dsBridge(config, container, onStatus);
  return createNullBridge(onStatus);
}

// ---------- Eagle 3D Streaming (cloud) ----------
// Docs: https://docs.eagle3dstreaming.com/wiki/embed-stream-using-iframe
//       https://docs.eagle3dstreaming.com/wiki/sending-and-receiving-data
// The player iframe is created only by play() ("산책 시작하기"): an open stream uses paid minutes.
// Messages for Unreal go through postMessage as a JSON *string* with cmd
// "sendMessageToStreamingBuild" (anything else is dropped silently), and only after the
// iframe reports `build.listening`. The player reports its lifecycle as { type, phase, ... }.
const E3DS_HOST = /(^|\.)eagle3dstreaming\.com$/;

function createE3dsBridge(config, container, onStatus) {
  const iframe = document.createElement('iframe');
  iframe.className = 'stage__frame';
  iframe.title = 'Bada 3D stream';
  iframe.allow = 'autoplay; fullscreen';
  iframe.allowFullscreen = true;

  let appListening = false;
  let ended = false;
  const listeners = [];

  // The player posts to window.top, not to its parent. When the proposal site embeds this page
  // (#play, same origin), its messages land on the site's page, so listen there as well.
  // A top window from another origin is not ours to listen on.
  const targets = [window];
  try {
    if (window.top !== window && window.top.location.origin === location.origin) targets.push(window.top);
  } catch { /* cross-origin top */ }
  targets.forEach((w) => w.addEventListener('message', onMessage));
  // Don't leave a listener behind on the site's page when this frame goes away.
  window.addEventListener('pagehide', () => {
    targets.forEach((w) => { if (w !== window) w.removeEventListener('message', onMessage); });
  });

  function onMessage(e) {
    let host = '';
    try { host = new URL(e.origin).hostname; } catch { return; }
    if (!E3DS_HOST.test(host)) return;
    let data = e.data;
    if (typeof data === 'string') {
      try { data = JSON.parse(data); } catch { /* plain text from Unreal */ }
    }
    if (data && typeof data === 'object' && typeof data.type === 'string' && data.phase) {
      onLifecycle(data);
      return;
    }
    // Anything else is a Pixel Streaming response from Unreal, e.g. { bada: 'ready' }.
    listeners.forEach((fn) => fn(data));
  }

  function onLifecycle(ev) {
    switch (ev.type) {
      case 'session.queued':
      case 'session.queuePositionChanged':
        onStatus('queued', ev.queuePosition);
        break;
      case 'session.hostFound':
      case 'session.hostReserved':
      case 'build.acquiring':
      case 'build.preparing':
      case 'build.started':
        onStatus('cloud-starting');
        break;
      case 'stream.ready':
        onStatus('click-to-play'); // only shown until stream.playing (Autoplay skips the click)
        break;
      case 'build.listening':
        appListening = true;
        break;
      case 'stream.playing':
        onStatus('playing');
        break;
      case 'session.ending':
      case 'session.expired':
      case 'build.stopped':
      case 'stream.failed':
      case 'session.error':
        if (!ended) {
          ended = true;
          appListening = false;
          onStatus('ended', ev.message);
        }
        break;
      default:
        break;
    }
  }

  return {
    send(msg) {
      // Before the app listens, messages are discarded by the player; these are only animation
      // cues, so dropping them is fine.
      if (!appListening || !iframe.contentWindow) return;
      iframe.contentWindow.postMessage(
        JSON.stringify({ cmd: 'sendMessageToStreamingBuild', value: msg }), '*');
    },
    onResponse(fn) { listeners.push(fn); },
    play() {
      if (iframe.src) return;
      iframe.src = config.e3ds;
      container.append(iframe);
      onStatus('cloud-starting');
    },
    stop() {
      appListening = false;
      ended = true;
      iframe.remove(); // closing the player ends the session (and its billing)
      iframe.removeAttribute('src');
    },
    // The cloud player only receives walking keys while its iframe has focus.
    focus() {
      if (iframe.isConnected) iframe.focus();
    },
  };
}

function createNullBridge(onStatus) {
  onStatus('chat-only');
  return {
    send(msg) { console.debug('[ue-bridge:none]', msg); },
    onResponse() {},
    play() {},
    stop() {},
    focus() {},
  };
}

async function createEpicBridge(config, container, onStatus) {
  const { Config, PixelStreaming } = await loadEpicLib();
  const psConfig = new Config({
    useUrlParams: false,
    initialSettings: {
      ss: config.ss,
      AutoConnect: true,
      AutoPlayVideo: true,
      StartVideoMuted: true, // browsers block unmuted autoplay; Bada's voice comes from the page
      HoveringMouse: true,
      MatchViewportRes: true,
    },
  });
  // Keyboard input stays on so the child can walk with the arrow keys / WASD
  // (the conversation is voice-only, so no text box competes for the keys).

  const ps = new PixelStreaming(psConfig, { videoElementParent: container });
  const listeners = [];
  ps.addResponseEventListener('bada', (raw) => {
    let data = raw;
    try { data = JSON.parse(raw); } catch { /* plain string */ }
    listeners.forEach((fn) => fn(data));
  });

  onStatus('connecting');
  ps.addEventListener('webRtcConnected', () => onStatus('connected'));
  ps.addEventListener('playStream', () => onStatus('playing'));
  ps.addEventListener('playStreamRejected', () => onStatus('click-to-play'));
  ps.addEventListener('webRtcDisconnected', () => onStatus('disconnected'));
  ps.addEventListener('webRtcFailed', () => onStatus('failed'));

  return {
    send(msg) {
      try { ps.emitUIInteraction(msg); } catch (e) { console.warn('emitUIInteraction failed', e); }
    },
    onResponse(fn) { listeners.push(fn); },
    play() { try { ps.play(); } catch { /* ignore */ } },
    stop() {}, // the studio PC costs nothing to keep connected
    focus() {}, // Pixel Streaming reads keys on `document`, wherever focus is
  };
}
