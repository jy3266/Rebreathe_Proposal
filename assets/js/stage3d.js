/* ==========================================================
   '바다와 함께 걷기' 3D 체험
   ----------------------------------------------------------
   체험 페이지(bada3d/ — 3D 화면 + 목소리로 하는 대화, 원하면 키보드로도)를 iframe으로 띄운다.
   3D 화면은 두 곳 중 한 곳에서 온다.
     1) 리브리드 스튜디오 PC (켜져 있을 때, 무료)
        공개 주소(Cloudflare quick tunnel)는 켤 때마다 바뀌므로 대화 서버(Worker)의
        GET /stream 에 묻는다. PC 쪽 start-demo.bat → register-stream.ps1 이 등록한다.
     2) Eagle 3D Streaming 클라우드 (PC가 꺼져 있을 때, 쓴 시간만큼 과금)
        CLOUD_STREAM 에 링크가 있을 때만. 체험 페이지에서 '산책 시작하기'를 눌러야 연결된다.
   둘 다 안 되면 기존 2D 체험(#game, game.js)으로 걸을 수 있게 한다.
   ========================================================== */
(function () {
  'use strict';

  var WORKER = 'https://rebreathe-bada-chat.rebreathe-bada-chat.workers.dev';
  var TUNNEL = /^https:\/\/[a-z0-9-]+\.trycloudflare\.com$/;
  var DEMO_PAGE = 'bada3d/';
  /* Eagle 3D Streaming 링크 (Control Panel → 앱 → Configuration → iframe 의 src).
     비워 두면 클라우드를 쓰지 않는다. */
  var CLOUD_STREAM = 'https://connector.eagle3dstreaming.com/v5/Junoh/Rebreathe_PixelStreaming_Win64_v2/default';

  function byId(id) { return document.getElementById(id); }
  var root = byId('stage3d');
  if (!root) return;

  var el = {
    frame: byId('stage3dFrame'),
    panel: byId('stage3dPanel'),
    title: byId('stage3dTitle'),
    msg: byId('stage3dMsg'),
    to2d: byId('stage3dTo2d'),
    retry: byId('stage3dRetry'),
    bar: byId('stage3dBar'),
    live: byId('stage3dLive'),
    full: byId('stage3dFull'),
    open: byId('stage3dOpen'),
    note: byId('stage3dNote'),
    game: byId('game'),
    gameNote: byId('gameDisclaimer')
  };

  var TEXT = {
    checking: [
      ['3D 시연에 연결하는 중…', 'Connecting to the 3D demo…'],
      ['리브리드 스튜디오의 시연 PC를 찾고 있어요.', 'Looking for the demo PC in the REBREATHE studio.']
    ],
    offline: [
      ['지금은 3D 체험을 열 수 없어요', 'The 3D experience is not available right now'],
      ['3D 화면을 보내 줄 곳(리브리드 팀 PC나 클라우드)에 연결하지 못했어요. ' +
       '그동안 2D 버전으로 바닷가를 걸어 보세요.',
       'We could not reach a place to stream the 3D scene from (the REBREATHE team PC or the cloud). ' +
       'Meanwhile, take a walk along the shore in the 2D version.']
    ]
  };
  var LIVE = {
    studio: ['리브리드 스튜디오에서 실시간 스트리밍 중 · 화면 안에서 시작을 누르고 마이크를 허용해 주세요',
             'Streaming live from the REBREATHE studio · press start inside and allow the microphone'],
    cloud: ['클라우드 GPU에서 스트리밍 · 화면 안에서 시작을 누르면 연결되고, 마이크를 허용해 주세요',
            'Streamed from a cloud GPU · press start inside to connect, then allow the microphone']
  };

  var state = 'idle';
  var source = '';

  function paint() {
    var t = TEXT[state];
    if (t) {
      el.title.textContent = RB.t(t[0][0], t[0][1]);
      el.msg.textContent = RB.t(t[1][0], t[1][1]);
    }
    if (source) el.live.textContent = RB.t(LIVE[source][0], LIVE[source][1]);
  }

  function setState(s) {
    state = s;
    root.setAttribute('data-state', s);
    var online = s === 'online';
    el.panel.hidden = online;
    el.frame.hidden = !online;
    el.bar.hidden = !online;
    el.to2d.hidden = s !== 'offline';
    el.retry.hidden = s !== 'offline';
    paint();
  }

  function check() {
    setState('checking');
    var ctrl = window.AbortController ? new AbortController() : null;
    var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, 12000) : 0;
    fetch(WORKER + '/stream', { cache: 'no-store', signal: ctrl ? ctrl.signal : undefined })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (s) {
        if (s && s.online && TUNNEL.test(s.url)) {
          open('studio', { ss: 'wss://' + s.url.replace(/^https:\/\//, '') });
        } else {
          openCloudOrOffline();
        }
      })
      .catch(openCloudOrOffline)
      .then(function () { clearTimeout(timer); });
  }

  function openCloudOrOffline() {
    if (CLOUD_STREAM) open('cloud', { stream: 'e3ds', e3ds: CLOUD_STREAM });
    else setState('offline');
  }

  /* 체험 페이지를 통째로 띄운다 — 3D 화면과 바다와의 목소리 대화가 함께 들어 있다 */
  function open(kind, params) {
    var q = Object.keys(params).map(function (k) { return k + '=' + encodeURIComponent(params[k]); });
    if (RB.lang === 'en') q.push('lang=en');
    var src = DEMO_PAGE + '?' + q.join('&');
    source = kind;
    root.setAttribute('data-source', kind);
    el.frame.src = src;
    el.open.href = src;
    setState('online');
  }

  function show2d() {
    root.hidden = true;
    el.note.hidden = true;
    [el.game, el.gameNote].forEach(function (node) {
      if (!node) return;
      node.hidden = false;
      node.classList.add('is-in');
    });
    if (el.game) el.game.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  el.to2d.addEventListener('click', show2d);
  el.retry.addEventListener('click', check);

  var frameFullscreen = el.frame.requestFullscreen || el.frame.webkitRequestFullscreen;
  if (!frameFullscreen) el.full.hidden = true;
  el.full.addEventListener('click', function () {
    try {
      var p = frameFullscreen.call(el.frame);
      if (p && p.catch) p.catch(function () { /* 사용자가 거부하거나 지원하지 않음 */ });
    } catch (e) { /* 무시 */ }
  });

  RB.onLang(paint);

  /* 체험 구간 근처까지 내려왔을 때 처음 확인한다 */
  if (!window.fetch) { setState('offline'); return; }
  if ('IntersectionObserver' in window) {
    var io = new IntersectionObserver(function (entries) {
      if (!entries[0].isIntersecting) return;
      io.disconnect();
      check();
    }, { rootMargin: '600px 0px' });
    io.observe(root);
  } else {
    check();
  }
})();
