/* ==========================================================
   '바다와 함께 걷기' 3D 체험
   ----------------------------------------------------------
   리브리드 팀 PC에서 돌아가는 언리얼 빌드를 Pixel Streaming 으로 보여준다.
   그 PC의 공개 주소(Cloudflare quick tunnel)는 켤 때마다 바뀌므로, 대화 서버(Worker)의
   GET /stream 에 지금 주소와 접속 가능 여부를 묻는다. 주소는 PC 쪽 start-demo.bat →
   register-stream.ps1 이 등록한다.
   PC가 꺼져 있으면 기존 2D 체험(#game, game.js)으로 걸을 수 있게 한다.
   ========================================================== */
(function () {
  'use strict';

  var WORKER = 'https://rebreathe-bada-chat.rebreathe-bada-chat.workers.dev';
  var TUNNEL = /^https:\/\/[a-z0-9-]+\.trycloudflare\.com$/;

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
      ['지금은 3D 시연 PC가 쉬고 있어요', 'The 3D demo PC is resting right now'],
      ['3D 체험은 리브리드 팀의 PC에서 실시간으로 스트리밍되어, 그 PC가 켜져 있을 때만 열려요. ' +
       '그동안 2D 버전으로 바닷가를 걸어 보세요.',
       'The 3D experience streams live from a REBREATHE team PC, so it opens only while that PC is on. ' +
       'Meanwhile, take a walk along the shore in the 2D version.']
    ]
  };

  var state = 'idle';

  function paint() {
    var t = TEXT[state];
    if (!t) return;
    el.title.textContent = RB.t(t[0][0], t[0][1]);
    el.msg.textContent = RB.t(t[1][0], t[1][1]);
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
        if (s && s.online && TUNNEL.test(s.url)) open(s.url);
        else setState('offline');
      })
      .catch(function () { setState('offline'); })
      .then(function () { clearTimeout(timer); });
  }

  /* 데모 페이지(web-demo)를 통째로 띄운다 — 화면 스트림과 바다와의 대화창이 함께 들어 있다 */
  function open(url) {
    var src = url + '/' + (RB.lang === 'en' ? '?lang=en' : '');
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

  /* 스트림 연결은 무거우니 체험 구간 근처까지 내려왔을 때 처음 확인한다 */
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
