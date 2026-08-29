/* =============================================================
   리브리드 — '바다와 함께 걷기'
   2D 캔버스 해변 산책 + 텍스트 기반 아동 정서 상담 데모
   ============================================================= */
(function () {
  'use strict';

  var root = document.getElementById('game');
  if (!root) return;

  var canvas = document.getElementById('gameCanvas');
  var ctx = canvas.getContext('2d');
  if (!ctx) return;

  /* ===========================================================
     0. 색 · 보간 도구
     =========================================================== */

  function hex(h) {
    h = h.replace('#', '');
    return [parseInt(h.substr(0, 2), 16), parseInt(h.substr(2, 2), 16), parseInt(h.substr(4, 2), 16)];
  }
  function mix(a, b, t) {
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  }
  function rgb(c, alpha) {
    return 'rgba(' + Math.round(c[0]) + ',' + Math.round(c[1]) + ',' + Math.round(c[2]) + ',' + (alpha === undefined ? 1 : alpha) + ')';
  }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

  /* 무드 팔레트 — 0 흐림·슬픔 / 0.5 잔잔한 노을 / 1 맑음·기쁨 */
  var PALETTES = [
    { /* sad */
      skyTop: hex('#414a57'), skyBot: hex('#97a0ab'), sun: hex('#c3c8cf'), sunGlow: hex('#b0b6bf'),
      seaFar: hex('#5a6570'), seaNear: hex('#77828d'), foam: hex('#e6e9ec'),
      sandWet: hex('#9a978f'), sandDry: hex('#bab6ae'), cloud: hex('#8a919b'), cloudAmt: 1.0,
      hill: hex('#59616c'), grass: hex('#6d7562')
    },
    { /* calm sunset */
      skyTop: hex('#4a4e86'), skyBot: hex('#f7bd95'), sun: hex('#ffca7a'), sunGlow: hex('#ff9d5c'),
      seaFar: hex('#42527d'), seaNear: hex('#7e8fb4'), foam: hex('#fff2e4'),
      sandWet: hex('#b2947a'), sandDry: hex('#e3c7a6'), cloud: hex('#f0b79b'), cloudAmt: 0.7,
      hill: hex('#5b5580'), grass: hex('#8d7f63')
    },
    { /* happy */
      skyTop: hex('#2f8ed6'), skyBot: hex('#b3e0f5'), sun: hex('#fff4c9'), sunGlow: hex('#ffe89a'),
      seaFar: hex('#1a7ba6'), seaNear: hex('#5cc3d8'), foam: hex('#ffffff'),
      sandWet: hex('#cbb28c'), sandDry: hex('#f2e2bd'), cloud: hex('#ffffff'), cloudAmt: 0.45,
      hill: hex('#4f9ec4'), grass: hex('#87b06a')
    }
  ];

  function palette(m) {
    var a, b, t;
    if (m < 0.5) { a = PALETTES[0]; b = PALETTES[1]; t = m * 2; }
    else { a = PALETTES[1]; b = PALETTES[2]; t = (m - 0.5) * 2; }
    var out = {};
    Object.keys(a).forEach(function (k) {
      out[k] = (typeof a[k] === 'number') ? lerp(a[k], b[k], t) : mix(a[k], b[k], t);
    });
    return out;
  }

  /* ===========================================================
     1. 월드
     =========================================================== */

  var WORLD_MIN = -1400, WORLD_MAX = 2600;   // 걸을 수 있는 가로 범위 (px, 월드 좌표)
  var SHELL_TOTAL = 6;

  var world = {
    shells: [],
    prints: []          // 발자국 {x, d, life, side}
  };

  function resetWorld() {
    world.shells = [];
    world.prints = [];
    var spots = [-1150, -640, -180, 420, 1080, 1830];
    for (var i = 0; i < SHELL_TOTAL; i++) {
      world.shells.push({
        x: spots[i] + (i % 2 ? 60 : -40),
        d: 0.28 + ((i * 0.17) % 0.55),
        kind: i % 3,
        got: false,
        bob: i * 1.1
      });
    }
  }

  /* 주인공 · 동행 캐릭터 */
  var player = { x: 0, d: 0.55, face: 1, phase: 0, moving: false };
  var buddy = { x: 150, d: 0.62, face: -1, phase: 0, moving: false, talk: 0, bounce: 0 };

  /* ===========================================================
     2. 렌더링
     =========================================================== */

  /* HFULL = 캔버스 전체 높이, H = 장면(하늘·바다·모래밭)이 쓰는 높이.
     좁은 화면에서는 아래쪽을 대화 UI가 덮으므로 장면을 위로 압축한다. */
  var W = 0, H = 0, HFULL = 0, dpr = 1;

  /* 넓은 화면에서는 오른쪽에 대화 패널이 붙는다 — 놀이 공간의 중심을 그만큼 왼쪽으로 */
  var wideMQ = window.matchMedia('(min-width: 900px)');

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    var w = Math.max(1, Math.round(canvas.clientWidth));
    var h = Math.max(1, Math.round(canvas.clientHeight));
    if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
      canvas.width = w * dpr;
      canvas.height = h * dpr;
    }
    W = w; HFULL = h;
    H = wideMQ.matches ? h : h * 0.70;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  /* 깊이(d) → 화면 y / 크기 배율 */
  function groundY(d) { return H * (0.575 + d * 0.30); }
  function scaleOf(d) { return 0.86 + d * 0.62; }

  var HORIZON = function () { return H * 0.30; };

  function panelW() { return wideMQ.matches ? Math.min(360, W * 0.34) : 0; }
  function viewCX() { return (W - panelW()) / 2; }
  function playRight() { return W - panelW(); }

  function drawSky(p, t) {
    var g = ctx.createLinearGradient(0, 0, 0, HORIZON() + 30);
    g.addColorStop(0, rgb(p.skyTop));
    g.addColorStop(1, rgb(p.skyBot));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, HORIZON() + 32);

    /* 해 */
    var sunX = W * 0.22 - cam.x * 0.04;
    sunX = ((sunX % (W * 2)) + W * 2) % (W * 2) - W * 0.5;
    var sunY = HORIZON() - H * (0.04 + state.mood * 0.20);
    var r = H * 0.052;
    var glow = ctx.createRadialGradient(sunX, sunY, r * 0.5, sunX, sunY, r * 5.5);
    glow.addColorStop(0, rgb(p.sunGlow, 0.55));
    glow.addColorStop(1, rgb(p.sunGlow, 0));
    ctx.fillStyle = glow;
    ctx.beginPath(); ctx.arc(sunX, sunY, r * 5.5, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = rgb(p.sun, 0.95);
    ctx.beginPath(); ctx.arc(sunX, sunY, r, 0, Math.PI * 2); ctx.fill();

    /* 구름 — 느린 패럴랙스 */
    var cloudAlpha = 0.30 + p.cloudAmt * 0.42;
    for (var i = 0; i < 7; i++) {
      var seed = i * 137.3;
      var span = W * 2.4;
      var cx = ((seed * 5.1 - cam.x * 0.10 - t * 5) % span + span) % span - W * 0.7;
      var cy = H * (0.07 + ((i * 0.11) % 0.16));
      var cw = W * (0.14 + (i % 3) * 0.05);
      drawCloud(cx, cy, cw, rgb(p.cloud, cloudAlpha * (0.6 + (i % 3) * 0.2)));
    }
  }

  function drawCloud(x, y, w, color) {
    ctx.fillStyle = color;
    var h = w * 0.30;
    ctx.beginPath();
    /* moveTo 없이 ellipse를 이어 그리면 이전 점에서 선이 이어져 삼각형 흠집이 생긴다 */
    ctx.moveTo(x + w * 0.42, y);
    ctx.ellipse(x, y, w * 0.42, h * 0.62, 0, 0, Math.PI * 2);
    ctx.moveTo(x + w * 0.26 + w * 0.30, y - h * 0.20);
    ctx.ellipse(x + w * 0.26, y - h * 0.20, w * 0.30, h * 0.58, 0, 0, Math.PI * 2);
    ctx.moveTo(x - w * 0.28 + w * 0.26, y + h * 0.06);
    ctx.ellipse(x - w * 0.28, y + h * 0.06, w * 0.26, h * 0.44, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawSea(p, t) {
    var hz = HORIZON();
    var seaBottom = groundY(0.0) - H * 0.035;
    var g = ctx.createLinearGradient(0, hz, 0, seaBottom);
    g.addColorStop(0, rgb(p.seaFar));
    g.addColorStop(1, rgb(p.seaNear));
    ctx.fillStyle = g;
    ctx.fillRect(0, hz, W, seaBottom - hz);

    /* 햇빛 길 — 바다 위에 부드럽게 */
    var sunX = W * 0.22 - cam.x * 0.04;
    var lane = ctx.createLinearGradient(0, hz, 0, seaBottom);
    lane.addColorStop(0, rgb(p.sun, 0.20));
    lane.addColorStop(1, rgb(p.sun, 0));
    ctx.save();
    ctx.fillStyle = lane;
    /* 반짝이는 가로 조각들로 흩뿌려 하드한 삼각형처럼 보이지 않게 */
    for (var li = 0; li < 22; li++) {
      var lf = (li + 0.5) / 22;
      var ly = hz + (seaBottom - hz) * Math.pow(lf, 1.6);
      var lw = W * (0.02 + lf * 0.10) * (0.5 + 0.5 * Math.abs(Math.sin(t * 1.1 + li)));
      ctx.fillRect(sunX - lw, ly, lw * 2, Math.max(1.2, (seaBottom - hz) / 44));
    }
    ctx.restore();

    /* 물결 — 짧은 흰 마루가 흩어져 반짝인다 */
    var rows = 15;
    for (var i = 0; i < rows; i++) {
      var f = (i + 0.5) / rows;
      var y = hz + (seaBottom - hz) * Math.pow(f, 1.7);
      var seg = 26 + f * 90;
      var off = Math.sin(t * (0.35 + f * 0.7) + i * 2.3) * (8 + f * 30);
      ctx.strokeStyle = rgb(p.foam, 0.06 + f * 0.20);
      ctx.lineWidth = 1 + f * 1.8;
      ctx.lineCap = 'round';
      ctx.beginPath();
      for (var x = -seg * 3; x < W + seg * 3; x += seg * 2.6) {
        var jitter = Math.sin((x * 0.021) + i * 3.1) * seg * 0.5;
        var sx = x + off + jitter - ((cam.x * 0.16) % (seg * 2.6));
        ctx.moveTo(sx, y);
        ctx.lineTo(sx + seg * (0.30 + f * 0.4), y);
      }
      ctx.stroke();
    }
    ctx.lineCap = 'butt';
  }

  /* 파도가 들고나는 물가 곡선 */
  function foamY(x, t) {
    var base = groundY(0.0) - H * 0.035;
    var tide = Math.sin(t * 0.45) * H * 0.012;
    return base + tide + Math.sin(x * 0.006 + t * 0.8) * H * 0.010 + Math.sin(x * 0.017 - t * 1.3) * H * 0.005;
  }

  function drawBeach(p, t) {
    var top = groundY(0.0) - H * 0.05;

    /* 마른 모래 — 캔버스 바닥까지 채운다 */
    var g = ctx.createLinearGradient(0, top, 0, HFULL);
    g.addColorStop(0, rgb(p.sandWet));
    g.addColorStop(0.22, rgb(p.sandDry));
    g.addColorStop(1, rgb(mix(p.sandDry, [255, 255, 255], 0.10)));
    ctx.fillStyle = g;
    ctx.fillRect(0, top, W, HFULL - top);

    /* 젖은 모래 — 물가에 붙은 띠만 */
    ctx.save();
    ctx.beginPath();
    for (var x = 0; x <= W; x += 8) {
      var yTop = foamY(x + cam.x * 0.55, t);
      if (x === 0) ctx.moveTo(x, yTop); else ctx.lineTo(x, yTop);
    }
    for (var xb = W; xb >= 0; xb -= 8) {
      ctx.lineTo(xb, foamY(xb + cam.x * 0.55, t) + H * 0.075);
    }
    ctx.closePath();
    ctx.clip();
    var wetG = ctx.createLinearGradient(0, top, 0, top + H * 0.14);
    wetG.addColorStop(0, rgb(p.sandWet, 0.75));
    wetG.addColorStop(1, rgb(p.sandWet, 0));
    ctx.fillStyle = wetG;
    ctx.fillRect(0, top - H * 0.02, W, H * 0.22);
    ctx.restore();

    /* 포말 라인 */
    ctx.lineWidth = Math.max(3, H * 0.008);
    ctx.strokeStyle = rgb(p.foam, 0.92);
    ctx.beginPath();
    for (var x3 = 0; x3 <= W; x3 += 6) {
      var yy = foamY(x3 + cam.x * 0.55, t);
      if (x3 === 0) ctx.moveTo(x3, yy); else ctx.lineTo(x3, yy);
    }
    ctx.stroke();

    ctx.lineWidth = Math.max(1, H * 0.003);
    ctx.strokeStyle = rgb(p.foam, 0.45);
    ctx.beginPath();
    for (var x4 = 0; x4 <= W; x4 += 6) {
      var y2 = foamY(x4 + cam.x * 0.55, t) + H * 0.020 + Math.sin(x4 * 0.05 + t * 2) * 2;
      if (x4 === 0) ctx.moveTo(x4, y2); else ctx.lineTo(x4, y2);
    }
    ctx.stroke();

    /* 모래 알갱이 */
    ctx.fillStyle = rgb(mix(p.sandDry, [90, 78, 60], 0.5), 0.16);
    for (var i = 0; i < 130; i++) {
      var gx = ((i * 197.7 - cam.x) % (W + 60) + W + 60) % (W + 60) - 30;
      var gd = 0.05 + ((i * 0.0731) % 0.95);
      var gy = groundY(gd);
      if (gy < top) continue;
      ctx.fillRect(gx, gy, 2, 1.4);
    }

    /* 앞쪽 모래언덕 — 아래로 갈수록 따뜻하게 */
    var duneTop = Math.max(groundY(1.0), HFULL * 0.80);
    var dune = ctx.createLinearGradient(0, duneTop, 0, HFULL);
    dune.addColorStop(0, rgb(p.sandDry, 0));
    dune.addColorStop(1, rgb(mix(p.sandDry, [150, 118, 78], 0.42), 0.55));
    ctx.fillStyle = dune;
    ctx.fillRect(0, duneTop, W, HFULL - duneTop);

    /* 조약돌 · 마른 해초 */
    for (var j = 0; j < 22; j++) {
      var px = ((j * 331.7 - cam.x) % (W + 200) + W + 200) % (W + 200) - 100;
      var pd = 0.62 + ((j * 0.113) % 0.36);
      var py = groundY(pd);
      var ps = scaleOf(pd);
      if (j % 3 === 0) {
        ctx.fillStyle = rgb(mix(p.sandDry, [110, 96, 80], 0.55), 0.5);
        ctx.beginPath();
        ctx.ellipse(px, py, 3.4 * ps, 2.1 * ps, 0.3, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.strokeStyle = rgb(mix(p.grass, [120, 105, 70], 0.4), 0.34);
        ctx.lineWidth = 1.6 * ps; ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(px - 6 * ps, py);
        ctx.quadraticCurveTo(px, py - 4 * ps, px + 7 * ps, py + 1 * ps);
        ctx.stroke();
        ctx.lineCap = 'butt';
      }
    }
  }

  function drawPrints(p) {
    for (var i = 0; i < world.prints.length; i++) {
      var f = world.prints[i];
      var sx = f.x - cam.x + viewCX();
      if (sx < -30 || sx > W + 30) continue;
      var s = scaleOf(f.d);
      ctx.fillStyle = rgb(mix(p.sandDry, [70, 60, 45], 0.55), 0.22 * f.life);
      ctx.beginPath();
      ctx.ellipse(sx, groundY(f.d) + 2, 4.2 * s, 2.6 * s, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function drawShells(p, t) {
    for (var i = 0; i < world.shells.length; i++) {
      var sh = world.shells[i];
      if (sh.got) continue;
      var sx = sh.x - cam.x + viewCX();
      if (sx < -60 || sx > W + 60) continue;
      var s = scaleOf(sh.d) * 1.1;
      var y = groundY(sh.d) + Math.sin(t * 2 + sh.bob) * 1.5;

      ctx.fillStyle = 'rgba(60,50,40,.16)';
      ctx.beginPath(); ctx.ellipse(sx, y + 2 * s, 9 * s, 3.4 * s, 0, 0, Math.PI * 2); ctx.fill();

      var col = ['#f5d7c4', '#ffd9e2', '#e6ecff'][sh.kind];
      var edge = ['#d9a98c', '#f2adc0', '#b9c6ef'][sh.kind];
      ctx.save();
      ctx.translate(sx, y - 5 * s);
      ctx.scale(s, s);
      ctx.beginPath();
      ctx.moveTo(0, 6);
      ctx.quadraticCurveTo(-11, 2, -8, -6);
      ctx.quadraticCurveTo(0, -12, 8, -6);
      ctx.quadraticCurveTo(11, 2, 0, 6);
      ctx.closePath();
      ctx.fillStyle = col; ctx.fill();
      ctx.strokeStyle = edge; ctx.lineWidth = 1.2; ctx.stroke();
      for (var k = -2; k <= 2; k++) {
        ctx.beginPath();
        ctx.moveTo(0, 5);
        ctx.quadraticCurveTo(k * 3.4, -2, k * 4.6, -7.5);
        ctx.strokeStyle = edge; ctx.lineWidth = 0.7; ctx.stroke();
      }
      ctx.restore();

      /* 반짝임 */
      var tw = 0.5 + 0.5 * Math.sin(t * 3 + sh.bob * 2);
      ctx.fillStyle = 'rgba(255,255,255,' + (0.25 + tw * 0.5) + ')';
      ctx.beginPath(); ctx.arc(sx + 5 * s, y - 10 * s, 1.6 * s, 0, Math.PI * 2); ctx.fill();
    }
  }

  /* ---------- 캐릭터 ---------- */

  function shadow(x, y, s, a) {
    ctx.fillStyle = 'rgba(50,45,40,' + a + ')';
    ctx.beginPath();
    ctx.ellipse(x, y, 15 * s, 5 * s, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  /* 아이 (플레이어) */
  function drawChild(o, t) {
    var sx = o.x - cam.x + viewCX();
    var gy = groundY(o.d);
    var s = scaleOf(o.d) * (H / 460);
    var swing = o.moving ? Math.sin(o.phase) : 0;
    var bob = o.moving ? Math.abs(Math.sin(o.phase)) * 2 * s : 0;

    shadow(sx, gy + 1, s, 0.20);

    ctx.save();
    ctx.translate(sx, gy - bob);
    ctx.scale(o.face, 1);

    var skin = '#f7d3ba', hair = '#3a2c25', shirt = '#4fa8e0', pants = '#33507a';

    /* 다리 */
    ctx.strokeStyle = pants; ctx.lineCap = 'round'; ctx.lineWidth = 5.4 * s;
    ctx.beginPath(); ctx.moveTo(-1.5 * s, -20 * s); ctx.lineTo(-1.5 * s + swing * 7 * s, -1 * s); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(2.0 * s, -20 * s); ctx.lineTo(2.0 * s - swing * 7 * s, -1 * s); ctx.stroke();

    /* 신발 */
    ctx.fillStyle = '#2c3a55';
    ctx.beginPath(); ctx.ellipse(-1.5 * s + swing * 7 * s, 0, 4.2 * s, 2.2 * s, 0, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(2.0 * s - swing * 7 * s, 0, 4.2 * s, 2.2 * s, 0, 0, Math.PI * 2); ctx.fill();

    /* 몸통 */
    ctx.fillStyle = shirt;
    roundRect(-7 * s, -38 * s, 14 * s, 20 * s, 6 * s);
    ctx.fill();

    /* 팔 */
    ctx.strokeStyle = skin; ctx.lineWidth = 4.4 * s;
    ctx.beginPath(); ctx.moveTo(-5 * s, -34 * s); ctx.lineTo(-6 * s - swing * 5 * s, -22 * s); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(5 * s, -34 * s); ctx.lineTo(6 * s + swing * 5 * s, -22 * s); ctx.stroke();

    /* 머리 */
    ctx.fillStyle = skin;
    ctx.beginPath(); ctx.arc(0, -47 * s, 10 * s, 0, Math.PI * 2); ctx.fill();
    /* 머리카락 */
    ctx.fillStyle = hair;
    ctx.beginPath();
    ctx.arc(0, -49 * s, 10.2 * s, Math.PI * 1.02, Math.PI * 2.05);
    ctx.lineTo(9 * s, -45 * s);
    ctx.quadraticCurveTo(2 * s, -49 * s, -10 * s, -44 * s);
    ctx.closePath(); ctx.fill();
    /* 얼굴 */
    ctx.fillStyle = '#2b2b33';
    ctx.beginPath(); ctx.arc(3.6 * s, -46 * s, 1.35 * s, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(-1.6 * s, -46 * s, 1.35 * s, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#c2725f'; ctx.lineWidth = 1.1 * s;
    ctx.beginPath(); ctx.arc(1 * s, -43 * s, 2.4 * s, 0.15 * Math.PI, 0.85 * Math.PI); ctx.stroke();
    ctx.fillStyle = 'rgba(240,140,140,.45)';
    ctx.beginPath(); ctx.arc(6 * s, -44 * s, 2 * s, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(-4.6 * s, -44 * s, 2 * s, 0, Math.PI * 2); ctx.fill();

    ctx.restore();
  }

  /* 동행 캐릭터 '바다' (부엉이) */
  function drawBuddy(o, t) {
    var sx = o.x - cam.x + viewCX();
    var gy = groundY(o.d);
    var s = scaleOf(o.d) * (H / 460) * 1.05;
    var swing = o.moving ? Math.sin(o.phase) : 0;
    var breathe = Math.sin(t * 2.2) * 0.6 * s;
    var hop = o.bounce > 0 ? Math.abs(Math.sin(o.bounce * 9)) * 9 * s : 0;
    var bob = (o.moving ? Math.abs(Math.sin(o.phase)) * 2.4 * s : 0) + hop;

    shadow(sx, gy + 1, s * 1.05, 0.22 - hop * 0.004);

    ctx.save();
    ctx.translate(sx, gy - bob);
    ctx.scale(o.face, 1);

    var body = '#f3efe4', belly = '#fffdf6', wing = '#e3ddcd', beak = '#f2a53c';

    /* 발 */
    ctx.fillStyle = beak;
    ctx.beginPath(); ctx.ellipse(-4 * s + swing * 3 * s, -1 * s, 4.4 * s, 2.3 * s, 0, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(4.5 * s - swing * 3 * s, -1 * s, 4.4 * s, 2.3 * s, 0, 0, Math.PI * 2); ctx.fill();

    /* 몸 */
    ctx.fillStyle = body;
    ctx.beginPath(); ctx.ellipse(0, -20 * s - breathe, 15 * s, 19 * s, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = belly;
    ctx.beginPath(); ctx.ellipse(0.5 * s, -16 * s - breathe, 9.5 * s, 12 * s, 0, 0, Math.PI * 2); ctx.fill();

    /* 날개 */
    var flap = (o.talk > 0.05 ? Math.sin(t * 12) * 0.5 : 0) + swing * 0.25;
    ctx.fillStyle = wing;
    ctx.save(); ctx.translate(-13 * s, -22 * s); ctx.rotate(flap);
    ctx.beginPath(); ctx.ellipse(0, 0, 5 * s, 11 * s, 0, 0, Math.PI * 2); ctx.fill(); ctx.restore();
    ctx.save(); ctx.translate(13 * s, -22 * s); ctx.rotate(-flap);
    ctx.beginPath(); ctx.ellipse(0, 0, 5 * s, 11 * s, 0, 0, Math.PI * 2); ctx.fill(); ctx.restore();

    /* 머리 */
    var hy = -40 * s - breathe;
    ctx.fillStyle = body;
    ctx.beginPath(); ctx.arc(0, hy, 14 * s, 0, Math.PI * 2); ctx.fill();
    /* 귀깃 */
    ctx.beginPath();
    ctx.moveTo(-11 * s, hy - 8 * s); ctx.lineTo(-14 * s, hy - 18 * s); ctx.lineTo(-5 * s, hy - 12 * s);
    ctx.closePath(); ctx.fill();
    ctx.beginPath();
    ctx.moveTo(11 * s, hy - 8 * s); ctx.lineTo(14 * s, hy - 18 * s); ctx.lineTo(5 * s, hy - 12 * s);
    ctx.closePath(); ctx.fill();

    /* 눈 */
    var blink = (t % 4.3) < 0.13 ? 0.12 : 1;
    ctx.fillStyle = '#ffffff';
    ctx.beginPath(); ctx.ellipse(-5.2 * s, hy - 1 * s, 5.4 * s, 5.4 * s * blink, 0, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(5.2 * s, hy - 1 * s, 5.4 * s, 5.4 * s * blink, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#2c3040';
    ctx.beginPath(); ctx.ellipse(-4.6 * s + o.face * 0.6 * s, hy - 1 * s, 2.6 * s, 2.9 * s * blink, 0, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(5.8 * s + o.face * 0.6 * s, hy - 1 * s, 2.6 * s, 2.9 * s * blink, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,.95)';
    ctx.beginPath(); ctx.arc(-3.6 * s, hy - 2.6 * s, 1.1 * s, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(6.8 * s, hy - 2.6 * s, 1.1 * s, 0, Math.PI * 2); ctx.fill();

    /* 부리 — 말할 때 벌어진다 */
    var open = 1 + o.talk * 1.6;
    ctx.fillStyle = beak;
    ctx.beginPath();
    ctx.moveTo(0, hy + 3.2 * s);
    ctx.lineTo(-3.2 * s, hy + 6.4 * s);
    ctx.lineTo(3.2 * s, hy + 6.4 * s);
    ctx.closePath(); ctx.fill();
    if (o.talk > 0.05) {
      ctx.fillStyle = '#c9762a';
      ctx.beginPath();
      ctx.moveTo(-2.6 * s, hy + 6.2 * s);
      ctx.lineTo(2.6 * s, hy + 6.2 * s);
      ctx.lineTo(0, hy + (6.2 + 3.4 * open) * s);
      ctx.closePath(); ctx.fill();
    }

    /* 볼터치 */
    ctx.fillStyle = 'rgba(245,150,150,.42)';
    ctx.beginPath(); ctx.arc(-10 * s, hy + 3 * s, 3.1 * s, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(10 * s, hy + 3 * s, 3.1 * s, 0, Math.PI * 2); ctx.fill();

    ctx.restore();
  }

  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  /* 캐릭터 머리 위 말풍선(짧은 것만) */
  function drawFloatBubble(o, text, t) {
    if (!text) return;
    var sx = o.x - cam.x + viewCX();
    var s = scaleOf(o.d) * (H / 460);
    var y = groundY(o.d) - 66 * s - Math.sin(t * 2.2) * 2;

    ctx.font = '600 ' + Math.round(13 * Math.max(0.9, H / 560)) + 'px "Noto Sans KR", sans-serif';
    var w = Math.min(ctx.measureText(text).width + 22, W * 0.6);
    var h = 30;
    var bx = clamp(sx - w / 2, 10, W - w - 10);

    ctx.fillStyle = 'rgba(255,255,255,.95)';
    roundRect(bx, y - h, w, h, 12); ctx.fill();
    ctx.beginPath();
    ctx.moveTo(sx - 6, y); ctx.lineTo(sx + 6, y); ctx.lineTo(sx, y + 8);
    ctx.closePath(); ctx.fill();

    ctx.fillStyle = '#1d2440';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(text, bx + w / 2, y - h / 2, w - 16);
    ctx.textAlign = 'start'; ctx.textBaseline = 'alphabetic';
  }

  /* 화면 가장자리 안내 화살표 — 걸을 수 있는 방향 */
  function drawEdgeHints() {
    if (!running) return;
    var a = 0.30 + 0.22 * Math.sin(state.time * 2.5);
    var y = groundY(0.45);
    if (player.x > WORLD_MIN + 140) arrow(22, y, -1, a);
    if (player.x < WORLD_MAX - 140) arrow(playRight() - 22, y, 1, a);
  }
  function arrow(x, y, dir, a) {
    ctx.fillStyle = 'rgba(255,255,255,' + a + ')';
    ctx.strokeStyle = 'rgba(40,50,80,' + (a * 0.5) + ')';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x + dir * 8, y);
    ctx.lineTo(x - dir * 7, y - 10);
    ctx.lineTo(x - dir * 7, y + 10);
    ctx.closePath(); ctx.fill(); ctx.stroke();
  }

  var cam = { x: 0 };

  function render(t) {
    resize();
    var p = palette(state.mood);

    drawSky(p, t);
    drawSea(p, t);
    drawBeach(p, t);
    drawPrints(p);
    drawShells(p, t);

    /* 깊이 순서대로 그린다 */
    var order = [player, buddy].sort(function (a, b) { return a.d - b.d; });
    for (var i = 0; i < order.length; i++) {
      if (order[i] === player) drawChild(player, t);
      else drawBuddy(buddy, t);
    }

    drawFloatBubble(buddy, floatText, t);
    drawEdgeHints();

    /* 레벨업 반짝임 */
    if (state.spark > 0.01) {
      for (var k = 0; k < 26; k++) {
        var ang = (k / 26) * Math.PI * 2 + t * 1.5;
        var rad = (1 - state.spark) * 140 + 20;
        var bx = buddy.x - cam.x + viewCX() + Math.cos(ang) * rad;
        var by = groundY(buddy.d) - 40 + Math.sin(ang) * rad * 0.6;
        ctx.fillStyle = 'rgba(255,224,130,' + (state.spark * 0.9) + ')';
        ctx.beginPath(); ctx.arc(bx, by, 2.4 + state.spark * 2, 0, Math.PI * 2); ctx.fill();
      }
    }

    /* 비네트 — 아주 옅게 */
    var v = ctx.createRadialGradient(W / 2, HFULL * 0.5, HFULL * 0.42, W / 2, HFULL * 0.5, HFULL * 1.05);
    v.addColorStop(0, 'rgba(0,0,0,0)');
    v.addColorStop(1, 'rgba(15,20,40,.16)');
    ctx.fillStyle = v;
    ctx.fillRect(0, 0, W, HFULL);
  }

  /* ===========================================================
     3. 감정 분석 · 상담 대화 엔진 (규칙 기반)
     =========================================================== */

  /* i18n.js가 없어도 한국어로 그대로 동작하도록 */
  var RB = window.RB || { lang: 'ko', t: function (ko) { return ko; }, onLang: function () {} };
  function T(ko, en) { return RB.lang === 'en' ? en : ko; }
  function isEn() { return RB.lang === 'en'; }

  var LEXICON_KO = {
    sad:    ['슬프', '슬퍼', '슬펐', '속상', '울었', '울어', '눈물', '서운', '우울', '싫어', '싫었', '힘들', '외로', '쓸쓸', '실망', '보고싶'],
    angry:  ['화가', '화났', '짜증', '미워', '밉다', '억울', '분해', '열받', '싸웠', '때렸', '괴롭'],
    fear:   ['무서', '두려', '겁이', '겁나', '불안', '걱정', '떨려', '긴장', '실수할'],
    lonely: ['혼자', '외톨이', '아무도', '따돌', '끼워주지', '같이안', '친구가없'],
    happy:  ['좋았', '좋아', '재밌', '재미있', '신나', '행복', '기뻐', '기뻤', '즐거', '최고', '고마'],
    calm:   ['괜찮', '편안', '평온', '나아졌', '나아진', '고요', '했어', '해봤']
  };

  var LEXICON_EN = {
    sad:    ['sad', 'upset', 'cry', 'cried', 'crying', 'tear', 'miss ', 'missed', 'unhappy', 'hurt', 'awful', 'terrible', 'disappoint'],
    angry:  ['angry', 'mad ', 'annoy', 'furious', 'unfair', 'hate', 'fight', 'fought', 'mean to me', 'bully', 'took my', 'grabbed'],
    fear:   ['scare', 'scared', 'afraid', 'fear', 'worri', 'worry', 'nervous', 'anxious', 'shaking', 'panic'],
    lonely: ['alone', 'lonely', 'nobody', 'no one', 'left out', 'ignored', 'no friend', 'by myself'],
    happy:  ['happy', 'fun', 'great', 'glad', 'excite', 'love', 'best', 'awesome', 'thank', 'nice', 'enjoy', 'proud'],
    calm:   ['okay', 'ok', 'fine', 'calm', 'better', 'peaceful', 'did it', 'done', 'tried', 'relaxed', 'breathed']
  };

  var SAFETY_KO = [
    '죽고', '죽을', '죽어버', '자살', '사라지고싶', '없어지고싶', '살기싫',
    '자해', '칼로', '맞았', '때려요', '아저씨가', '비밀이라고', '학대', '피가나'
  ];

  var SAFETY_EN = [
    'kill myself', 'killing myself', 'kill me', 'want to die', 'wanna die', 'suicide',
    'end my life', 'disappear forever', 'want to disappear', 'not want to live',
    'hurt myself', 'hurting myself', 'cut myself', 'self harm', 'self-harm',
    'hits me', 'hit me', 'beat me', 'abuse', 'touched me', 'not to tell anyone',
    'keep it a secret', 'bleeding'
  ];

  var CAUSE_KO = [
    '친구', '엄마', '아빠', '동생', '형', '누나', '언니', '오빠', '선생님', '할머니', '할아버지',
    '학교', '유치원', '학원', '시험', '숙제', '발표', '게임', '장난감', '인형', '로봇', '강아지',
    '고양이', '이사', '전학', '생일', '병원', '주사', '축구', '그림', '피아노'
  ];

  var CAUSE_EN = [
    'friend', 'mum', 'mom', 'dad', 'mummy', 'daddy', 'brother', 'sister', 'teacher',
    'grandma', 'grandpa', 'school', 'kindergarten', 'class', 'test', 'homework',
    'presentation', 'game', 'toy', 'doll', 'robot', 'puppy', 'dog', 'cat', 'moving',
    'birthday', 'hospital', 'shot', 'soccer', 'football', 'drawing', 'piano'
  ];

  var MOOD_VALUE = { sad: 0.10, angry: 0.16, fear: 0.20, lonely: 0.13, neutral: 0.45, calm: 0.66, happy: 0.95 };

  var EMOTION_LABEL_KO = {
    sad: '슬픔', angry: '화남', fear: '불안', lonely: '외로움',
    neutral: '차분함', calm: '편안함', happy: '기쁨'
  };
  var EMOTION_LABEL_EN = {
    sad: 'Sadness', angry: 'Anger', fear: 'Worry', lonely: 'Loneliness',
    neutral: 'Steady', calm: 'At ease', happy: 'Joy'
  };
  function emotionLabel(key) {
    return (isEn() ? EMOTION_LABEL_EN : EMOTION_LABEL_KO)[key];
  }
  /* 문장 안에 들어갈 때 쓰는 형용사형 */
  var EMOTION_WORD_EN = {
    sad: 'sad', angry: 'angry', fear: 'worried', lonely: 'lonely',
    neutral: 'mixed up', calm: 'calm', happy: 'happy'
  };

  function analyze(text) {
    var t = (text || '').replace(/\s+/g, ' ').trim();
    /* 한국어는 조사가 붙으므로 공백을 지우고, 영어는 소문자로 낮춰 찾는다 */
    var flat = isEn() ? t.toLowerCase() : t.replace(/\s/g, '');
    var LEXICON = isEn() ? LEXICON_EN : LEXICON_KO;
    var SAFETY = isEn() ? SAFETY_EN : SAFETY_KO;
    var CAUSE_WORDS = isEn() ? CAUSE_EN : CAUSE_KO;

    for (var i = 0; i < SAFETY.length; i++) {
      if (flat.indexOf(SAFETY[i]) !== -1) return { emotion: 'risk', cause: null, raw: t };
    }

    var best = 'neutral', bestScore = 0;
    Object.keys(LEXICON).forEach(function (key) {
      var score = 0;
      LEXICON[key].forEach(function (w) { if (flat.indexOf(w) !== -1) score++; });
      if (score > bestScore) { bestScore = score; best = key; }
    });

    var cause = null, causeStrong = false;
    var hay = isEn() ? flat : t;
    for (var j = 0; j < CAUSE_WORDS.length; j++) {
      if (hay.indexOf(CAUSE_WORDS[j]) !== -1) { cause = CAUSE_WORDS[j]; causeStrong = true; break; }
    }
    if (!cause) {
      var words = t.split(/[\s,.!?]+/).filter(function (w) { return w.length >= 2; });
      if (words.length) cause = words.sort(function (a, b) { return b.length - a.length; })[0];
    }

    return { emotion: best, cause: cause, causeStrong: causeStrong, raw: t };
  }

  function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

  function Counselor() {
    this.stage = 'greet';
    this.turns = 0;
    this.emotions = [];
    this.cause = null;
    this.causeStrong = false;
    this.mainEmotion = 'neutral';
    this.riskFlag = false;
  }

  Counselor.prototype.opening = function () {
    this.stage = 'explore';
    return {
      say: T('안녕! 나는 바다야. 오늘 파도 소리가 참 좋다. 방향키로 같이 걸어보자. ' +
             '있잖아, 오늘 너한테는 어떤 일이 있었어?',
             'Hi! I am Bada. The waves sound lovely today. Use the arrow keys and walk with me. ' +
             'So tell me — how was your day?'),
      float: T('같이 걸을까?', 'Shall we walk?'),
      mood: 0.5,
      hint: T('아래 입력창에 오늘 있었던 일을 적어 보세요', 'Type what happened today in the box below'),
      quick: T(['오늘 속상한 일이 있었어', '친구랑 싸웠어', '오늘은 기분이 좋아'],
               ['Something upset me today', 'I had a fight with my friend', 'I feel good today'])
    };
  };

  Counselor.prototype.respond = function (text) {
    var a = analyze(text);
    this.turns++;
    if (a.emotion !== 'risk') this.emotions.push(a.emotion);

    if (a.emotion === 'risk') {
      this.riskFlag = true;
      this.stage = 'safety';
      return {
        say: T('지금 그 이야기를 해줘서 정말 고마워. 그건 너 혼자 견딜 일이 절대 아니야. ' +
               '이건 꼭 믿을 수 있는 어른이랑 같이 이야기해야 해. ' +
               '지금 옆에 있는 어른한테 "나 마음이 많이 힘들어"라고 말해줄 수 있을까? 내가 같이 있어줄게.',
               'Thank you for telling me that. This is not something you should carry on your own. ' +
               'This one we have to share with a grown-up you trust. ' +
               'Could you tell someone near you, "my heart feels really heavy"? I will stay right here with you.'),
        float: T('혼자 두지 않을게', 'You are not alone'),
        mood: 0.35,
        safety: true,
        hint: T('보호자에게 바로 알리는 것이 가장 안전해요', 'Telling a caregiver right away is the safest thing to do'),
        quick: T(['응, 말해볼게', '무서워'], ['Okay, I will tell them', 'I am scared'])
      };
    }

    if (a.cause && (!this.cause || (a.causeStrong && !this.causeStrong))) {
      this.cause = a.cause;
      this.causeStrong = a.causeStrong;
    }

    switch (this.stage) {
      case 'explore':   return this.explore(a);
      case 'empathize': return this.regulate(a);
      case 'regulate':  return this.reframe(a);
      case 'reframe':   return this.reinforce(a);
      default:          return this.closing(a);
    }
  };

  Counselor.prototype.explore = function (a) {
    this.mainEmotion = a.emotion;

    if (a.emotion === 'happy' || a.emotion === 'calm') {
      this.stage = 'reframe';
      return {
        say: isEn()
          ? 'Wow, just hearing that brightens me up! ' + (this.cause ? 'That story about your ' + this.cause + ' — ' : '') +
            'what colour did your heart feel like right then?'
          : '우와, 듣기만 해도 내 마음까지 환해진다! ' + (this.cause ? this.cause + ' 이야기, ' : '') +
            '그때 네 마음은 어떤 색깔이었어?',
        float: T('좋았겠다!', 'That sounds lovely!'),
        mood: MOOD_VALUE[a.emotion],
        hint: T('기분 좋았던 순간을 더 이야기해 주세요', 'Tell me more about the part that felt good'),
        quick: T(['노란색! 반짝반짝했어', '하늘색처럼 시원했어'],
                 ['Yellow! It was all sparkly', 'Sky blue, cool and breezy'])
      };
    }

    if (a.emotion === 'neutral' && this.turns < 2) {
      return {
        say: pick(T(
          ['음, 그랬구나. 조금 더 자세히 들려줄래? 오늘 제일 기억에 남는 순간은 뭐였어?',
           '그렇구나. 오늘 하루 중에 마음이 제일 크게 움직였던 순간이 있었어?'],
          ['Mm, I see. Could you tell me a bit more? What moment stayed with you most today?',
           'I see. Was there a moment today when your heart moved the most?']
        )),
        float: T('더 듣고 싶어', 'I want to hear more'),
        mood: 0.45,
        hint: T('기억에 남는 순간을 적어 주세요', 'Write down the moment you remember'),
        quick: T(['쉬는 시간에 있었던 일이야', '집에 오는 길에 그랬어'],
                 ['It happened at break time', 'It was on the way home'])
      };
    }

    this.stage = 'empathize';
    var say;
    if (isEn()) {
      var word = EMOTION_WORD_EN[a.emotion] || 'mixed up';
      var because = this.cause ? ' because of your ' + this.cause : '';
      say = pick([
        'Oh no… you must have felt really ' + word + because + '. That makes complete sense.',
        'I see. Your heart must have felt so heavy' + because + '. Thank you for telling me.'
      ]) + ' How did your body feel then? Was your chest tight, or did the tears come?';
    } else {
      var label = emotionLabel(a.emotion) || '복잡한 마음';
      var cause = this.cause ? this.cause + ' 때문에 ' : '';
      say = pick([
        '저런… ' + cause + '정말 ' + label + '을 느꼈겠다. 그 마음, 충분히 그럴 만해.',
        '그랬구나. ' + cause + '마음이 많이 무거웠겠다. 이야기해줘서 고마워.'
      ]) + ' 그때 몸은 어땠어? 가슴이 답답했어, 아니면 눈물이 났어?';
    }
    return {
      say: say,
      float: T('많이 속상했겠다', 'That must have hurt'),
      mood: MOOD_VALUE[a.emotion],
      hint: T('그때 몸이 어땠는지 적어 주세요', 'Write down how your body felt'),
      quick: T(['가슴이 답답했어', '눈물이 났어', '머리가 뜨거웠어'],
               ['My chest felt tight', 'I started crying', 'My head felt hot'])
    };
  };

  Counselor.prototype.regulate = function () {
    this.stage = 'regulate';
    return {
      say: T('그랬구나. 그럴 땐 마음이 뜨거워져서 숨이 짧아지거든. ' +
             '우리 같이 파도에 맞춰 숨을 쉬어볼까? 파도가 밀려올 때 코로 "스으읍", ' +
             '나갈 때 입으로 "후우우…". 세 번만 해보고 "했어"라고 적어줘.',
             'I understand. When that happens the heart gets hot and the breath gets short. ' +
             'Shall we breathe along with the waves? As a wave rolls in, breathe in through your nose — ' +
             'and as it rolls out, let it go through your mouth, hoooo. Do it three times, then type "I did it".'),
      float: T('스으읍… 후우우…', 'Breathe in… and out…'),
      mood: Math.min(0.58, MOOD_VALUE[this.mainEmotion] + 0.2),
      hint: T('천천히 세 번 숨을 쉬고 "했어"라고 적어 주세요', 'Breathe slowly three times, then type "I did it"'),
      quick: T(['했어', '조금 나아진 것 같아'], ['I did it', 'I feel a little better'])
    };
  };

  Counselor.prototype.reframe = function () {
    this.stage = 'reframe';
    var who = this.cause || T('그 일', 'that');
    return {
      say: isEn()
        ? 'Well done! You seem a little calmer now. Shall we think about it together? ' +
          'Why do you think ' + who + ' did that? Maybe ' + who + ' was in a rush too, ' +
          'or maybe they just wanted to play with you a bit longer? What do you think?'
        : '잘했어! 조금 진정된 것 같네. 이제 같이 생각해볼까? ' +
          who + ', 왜 그랬을까? 혹시 ' + who + '도 그때 마음이 급했거나, ' +
          '너랑 더 놀고 싶어서 그런 건 아니었을까? 네 생각은 어때?',
      float: T('같이 생각해보자', 'Let us think together'),
      mood: 0.64,
      hint: T('네 생각을 자유롭게 적어 주세요', 'Write whatever you think'),
      quick: T(['그럴 수도 있겠다', '그래도 속상해', '잘 모르겠어'],
               ['Maybe that is true', 'I am still upset', 'I do not know'])
    };
  };

  Counselor.prototype.reinforce = function () {
    this.stage = 'reinforce';
    return {
      say: T('우와! 방금 네 마음이 한 뼘 더 자랐어. ' +
             '속상한 마음을 말로 꺼내고, 다르게 생각해보는 건 어른도 어려운 일이거든. ' +
             '다음에 비슷한 일이 생기면 뭐라고 말해볼래?',
             'Wow! Your heart just grew a whole inch. ' +
             'Saying out loud what hurts, and then looking at it another way — even grown-ups find that hard. ' +
             'If something like this happens again, what would you like to say?'),
      float: T('한 뼘 자랐어!', 'An inch taller!'),
      mood: 0.9,
      levelUp: true,
      hint: T('다음에 해볼 말을 적어 주세요', 'Write what you would say next time'),
      quick: T(['같이 놀자고 말할래', '빌려달라고 먼저 말할래'],
               ['I will ask them to play with me', 'I will ask before borrowing'])
    };
  };

  Counselor.prototype.closing = function () {
    this.stage = 'done';
    return {
      say: T('멋지다! 오늘 나랑 걸어줘서 고마워. ' +
             '네 마음은 혼자 무너지지 않고, 혼자서만 회복되지도 않아. ' +
             '오늘 이야기는 너를 아끼는 어른한테도 살짝 전해둘게. 내일 또 여기서 만나자!',
             'That is wonderful! Thank you for walking with me today. ' +
             'Your heart does not break alone, and it does not heal alone either. ' +
             'I will quietly pass today on to a grown-up who cares about you. See you here again tomorrow!'),
      float: T('내일 또 만나!', 'See you tomorrow!'),
      mood: 0.95,
      end: true,
      hint: T('오늘 산책 끝!', 'That is the end of today’s walk!'),
      quick: []
    };
  };

  Counselor.prototype.report = function () {
    var counts = {};
    this.emotions.forEach(function (e) { counts[e] = (counts[e] || 0) + 1; });
    var total = this.emotions.length || 1;
    var rows = Object.keys(counts).map(function (k) {
      return { key: k, label: emotionLabel(k) || k, pct: Math.round(counts[k] / total * 100) };
    }).sort(function (x, y) { return y.pct - x.pct; });
    if (!rows.length) rows = [{ key: 'neutral', label: emotionLabel('neutral'), pct: 100 }];

    var first = this.emotions.length ? MOOD_VALUE[this.emotions[0]] : 0.45;
    var last = this.emotions.length ? MOOD_VALUE[this.emotions[this.emotions.length - 1]] : 0.45;
    var gain = Math.round((last - first) * 100);
    var score = Math.max(35, Math.min(98, Math.round(52 + last * 45 + Math.min(this.turns, 6) * 1.5)));

    return {
      rows: rows, score: score, gain: gain, turns: this.turns,
      cause: this.cause, main: emotionLabel(rows[0].key) || emotionLabel('neutral'), risk: this.riskFlag
    };
  };

  /* ===========================================================
     4. 상태 · 입력
     =========================================================== */

  var state = { time: 0, mood: 0.45, moodTarget: 0.5, spark: 0, walked: 0, shells: 0 };
  var running = false;
  var counselor = null;
  var floatText = '';
  var floatUntil = 0;
  var keys = { left: false, right: false, up: false, down: false };
  var visible = true;      // 관찰자가 아직 알려주지 않았어도 조작은 막지 않는다
  var voiceOn = false;

  var el = {
    start:  document.getElementById('gameStart'),
    hud:    document.getElementById('gameHud'),
    end:    document.getElementById('gameEnd'),
    report: document.getElementById('gameReport'),
    stage:  document.getElementById('gameStage'),
    mood:   document.getElementById('gameMood'),
    step:   document.getElementById('gameStep'),
    shell:  document.getElementById('gameShell'),
    notice: document.getElementById('gameNotice'),
    who:    document.getElementById('gameSubtitleWho'),
    sub:    document.getElementById('gameSubtitle'),
    hint:   document.getElementById('gameHint'),
    quick:  document.getElementById('gameQuick'),
    input:  document.getElementById('gameTextInput'),
    send:   document.getElementById('gameTextSend'),
    go:     document.getElementById('gameGo'),
    again:  document.getElementById('gameAgain'),
    quit:   document.getElementById('gameQuit'),
    voice:  document.getElementById('gameVoice'),
    pad:    document.getElementById('gamePad')
  };

  var STAGE_LABEL_KO = {
    greet: '만나기', explore: '이야기 듣기', empathize: '공감하기',
    regulate: '숨 고르기', reframe: '다르게 보기', reinforce: '칭찬하기',
    safety: '안전 우선', done: '마무리'
  };
  var STAGE_LABEL_EN = {
    greet: 'Meeting', explore: 'Listening', empathize: 'Empathising',
    regulate: 'Breathing', reframe: 'Reframing', reinforce: 'Celebrating',
    safety: 'Safety first', done: 'Wrapping up'
  };
  function stageLabel(key) {
    return (isEn() ? STAGE_LABEL_EN : STAGE_LABEL_KO)[key];
  }

  /* ---------- 키보드 ---------- */
  var KEYMAP = {
    arrowleft: 'left', a: 'left', arrowright: 'right', d: 'right',
    arrowup: 'up', w: 'up', arrowdown: 'down', s: 'down'
  };

  window.addEventListener('keydown', function (e) {
    if (!running || !visible) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    var k = String(e.key || '').toLowerCase();

    if (document.activeElement === el.input) {
      if (k === 'escape') { el.input.blur(); root.focus(); e.preventDefault(); }
      return;                                  // 입력 중에는 이동하지 않는다
    }
    if (KEYMAP[k]) { keys[KEYMAP[k]] = true; e.preventDefault(); }
    else if (k === ' ' || k === 'spacebar') { interact(); e.preventDefault(); }
    else if (k === 'enter') { el.input.focus(); e.preventDefault(); }
    else if (k === 'escape') { finish(); e.preventDefault(); }
    else if (k.length === 1 && /[가-힣a-z0-9]/.test(k)) { el.input.focus(); }
  });

  window.addEventListener('keyup', function (e) {
    var k = String(e.key || '').toLowerCase();
    if (KEYMAP[k]) keys[KEYMAP[k]] = false;
  });
  window.addEventListener('blur', function () {
    keys.left = keys.right = keys.up = keys.down = false;
  });

  /* ---------- 터치 패드 ---------- */
  if (el.pad) {
    Array.prototype.forEach.call(el.pad.querySelectorAll('button'), function (b) {
      var dir = b.getAttribute('data-dir');
      function on(e) { keys[dir] = true; e.preventDefault(); }
      function off() { keys[dir] = false; }
      b.addEventListener('pointerdown', on);
      b.addEventListener('pointerup', off);
      b.addEventListener('pointerleave', off);
      b.addEventListener('pointercancel', off);
    });
  }

  /* ---------- 상호작용 ---------- */
  function interact() {
    /* 가까운 조개 줍기 */
    for (var i = 0; i < world.shells.length; i++) {
      var sh = world.shells[i];
      if (sh.got) continue;
      if (Math.abs(sh.x - player.x) < 46 && Math.abs(sh.d - player.d) < 0.16) {
        collectShell(sh);
        return;
      }
    }
    /* 가까우면 대화창으로 */
    if (Math.abs(buddy.x - player.x) < 160) el.input.focus();
    else showFloat(T('이쪽으로 와!', 'Come over here!'), 1.6);
  }

  var SHELL_LINES_KO = [
    '예쁜 조개다! 마음 조각 하나 찾았네.',
    '이건 파도가 오래 다듬은 거야. 너처럼 반짝인다.',
    '조개는 속마음을 담아두는 주머니 같아.',
    '와, 이 소리 들어봐. 파도 소리가 들어 있어.',
    '하나 더 찾았네! 마음이 조금 가벼워졌지?',
    '마지막 조각이야. 오늘 정말 잘했어!'
  ];
  var SHELL_LINES_EN = [
    'What a pretty shell! You found a piece of your heart.',
    'The waves polished this one for years. It shines, just like you.',
    'A shell is like a little pouch for keeping feelings in.',
    'Listen to this one. It has the sound of the waves inside.',
    'One more! Does your heart feel a bit lighter?',
    'That is the last piece. You did so well today!'
  ];

  function collectShell(sh) {
    sh.got = true;
    state.shells++;
    state.spark = Math.max(state.spark, 0.5);
    buddy.bounce = 0.6;
    var lines = isEn() ? SHELL_LINES_EN : SHELL_LINES_KO;
    showFloat(lines[Math.min(state.shells - 1, lines.length - 1)], 2.6);
    state.moodTarget = Math.min(1, state.moodTarget + 0.05);
    updateChips();
  }

  function showFloat(text, sec) {
    floatText = text;
    floatUntil = state.time + (sec || 2.2);
  }

  /* ===========================================================
     5. 대화 흐름
     =========================================================== */

  var lastWho = 'buddy';   // 'buddy' | 'me' — 언어가 바뀌어도 누가 말했는지 기억한다

  function whoLabel(role) {
    return role === 'me' ? T('나', 'Me') : T('바다', 'Bada');
  }

  function setSubtitle(role, text) {
    lastWho = role;
    el.who.textContent = whoLabel(role);
    el.sub.textContent = text;
    el.sub.parentElement.classList.toggle('is-child', role === 'me');
  }

  function renderQuick(list) {
    el.quick.innerHTML = '';
    if (!list || !list.length) return;
    list.forEach(function (q) {
      var li = document.createElement('li');
      var b = document.createElement('button');
      b.type = 'button';
      b.textContent = q;
      b.addEventListener('click', function () { say(q); });
      li.appendChild(b);
      el.quick.appendChild(li);
    });
  }

  function updateChips() {
    if (!counselor) return;
    el.stage.textContent = stageLabel(counselor.stage) || T('산책 중', 'Walking');
    var m = state.mood;
    var label = m < 0.28 ? T('흐림', 'Cloudy')
              : m < 0.55 ? T('잔잔함', 'Calm')
              : m < 0.78 ? T('맑아짐', 'Clearing')
              : T('맑음', 'Clear');
    el.mood.textContent = T('마음 날씨 · ', 'Mood · ') + label;
    el.mood.style.setProperty('--mood', String(m));
    el.step.textContent = isEn()
      ? Math.round(state.walked) + ' m walked'
      : Math.round(state.walked) + 'm 걸었어요';
    el.shell.textContent = T('조개 ', 'Shells ') + state.shells + ' / ' + SHELL_TOTAL;
  }

  var speakTimer = null;

  function buddySays(res) {
    setSubtitle('buddy', res.say);
    el.hint.textContent = res.hint || '';
    renderQuick(res.quick);
    if (typeof res.mood === 'number') state.moodTarget = res.mood;
    if (res.levelUp) { state.spark = 1; buddy.bounce = 1.1; }
    if (res.safety) el.notice.hidden = false;
    if (res.float) showFloat(res.float, 3.2);

    /* 부리 애니메이션 — 글자 수에 비례해 말하는 시간을 준다 */
    buddy.talk = 1;
    clearTimeout(speakTimer);
    var dur = Math.min(6500, 1200 + res.say.length * 55);
    speakTimer = setTimeout(function () { buddy.talk = 0; }, dur);

    if (voiceOn) Speech.speak(res.say, res.mood);
    if (res.end) setTimeout(finish, 1400);

    updateChips();
  }

  function say(text) {
    if (!running || !counselor) return;
    text = (text || '').trim();
    if (!text) return;
    el.input.value = '';
    setSubtitle('me', text);
    renderQuick([]);
    var res = counselor.respond(text);
    setTimeout(function () { buddySays(res); }, 420);
  }

  /* ===========================================================
     5-1. 음성 출력 — 한 덩어리로 읽지 않고 문장마다 끊어 말한다
     =========================================================== */

  var Speech = (function () {
    var synth = window.speechSynthesis || null;
    var voice = null;
    var token = 0;

    /* 목소리 고르기 — 자연스러운 순으로 점수를 매긴다 */
    function score(v) {
      var n = (v.name || '').toLowerCase();
      var s = 0;
      if (n.indexOf('google') !== -1) s += 100;          // Chrome (가장 자연스러움)
      if (/natural|neural/.test(n)) s += 90;             // Edge Online (Natural)
      if (n.indexOf('online') !== -1) s += 40;
      if (/sunhi|yuna|jimin|seoyeon|nari/.test(n)) s += 25;   // 한국어
      if (/aria|jenny|samantha|zira|libby|sonia/.test(n)) s += 25;  // 영어
      if (n.indexOf('heami') !== -1) s += 10;            // Windows 기본 (다소 기계적)
      if (!v.localService) s += 15;
      return s;
    }

    function langTag() { return isEn() ? 'en-US' : 'ko-KR'; }

    function refresh() {
      if (!synth) return;
      var want = isEn() ? /^en/i : /^ko/i;
      var list = (synth.getVoices() || []).filter(function (v) { return want.test(v.lang || ''); });
      voice = list.length ? list.slice().sort(function (a, b) { return score(b) - score(a); })[0] : null;
    }

    if (synth) {
      refresh();
      if ('onvoiceschanged' in synth) synth.onvoiceschanged = refresh;
      RB.onLang(function () { cancel(); refresh(); });
    }

    /* 기계음처럼 읽히는 기호를 다듬는다 */
    function normalize(t) {
      return String(t)
        .replace(/…/g, ', ')
        .replace(/\.\.\./g, ', ')
        .replace(/~+/g, '')
        .replace(/["'“”‘’]/g, '')
        .replace(/\s*·\s*/g, ', ')
        .replace(/\s+/g, ' ')
        .trim();
    }

    /* 문장 단위로 자르고, 긴 문장은 쉼표에서 한 번 더 나눈다 */
    function split(t) {
      var out = [], cur = '';
      for (var i = 0; i < t.length; i++) {
        cur += t[i];
        if ('.!?'.indexOf(t[i]) !== -1) { out.push(cur.trim()); cur = ''; }
      }
      if (cur.trim()) out.push(cur.trim());

      var parts = [];
      out.forEach(function (s) {
        var maxLen = isEn() ? 72 : 46;
        while (s.length > maxLen) {
          var cut = s.lastIndexOf(',', maxLen);
          if (cut < 14) cut = s.indexOf(',', 20);
          if (cut < 0) { break; }
          parts.push(s.slice(0, cut + 1).trim());
          s = s.slice(cut + 1).trim();
        }
        if (s) parts.push(s);
      });
      return parts.filter(Boolean);
    }

    /* 마음 날씨에 따라 말하는 속도와 높이를 바꾼다 */
    function tone(mood) {
      if (mood < 0.35) return { rate: 0.86, pitch: 1.04 };   // 다독이듯 느리고 낮게
      if (mood > 0.78) return { rate: 1.00, pitch: 1.20 };   // 밝고 경쾌하게
      return { rate: 0.92, pitch: 1.12 };
    }

    function cancel() {
      token++;
      if (synth) { try { synth.cancel(); } catch (e) {} }
    }

    function speak(text, mood) {
      if (!synth) return;
      cancel();
      var mine = token;
      var parts = split(normalize(text));
      var base = tone(typeof mood === 'number' ? mood : 0.5);
      var i = 0;

      function next() {
        if (mine !== token || i >= parts.length) return;
        var s = parts[i++];
        var isQ = /[?]$/.test(s);
        var u = new SpeechSynthesisUtterance(s);
        u.lang = langTag();
        if (voice) u.voice = voice;
        /* 문장마다 아주 조금씩 달라져야 낭독처럼 들리지 않는다 */
        u.rate = base.rate * (i % 2 ? 1.02 : 0.98);
        u.pitch = base.pitch + (isQ ? 0.08 : 0) - Math.min(i - 1, 3) * 0.015;
        u.volume = 1;
        u.onend = function () { setTimeout(next, isQ ? 260 : 170); };
        u.onerror = function () { setTimeout(next, 60); };
        try { synth.speak(u); } catch (e) { setTimeout(next, 60); }
      }
      next();
    }

    return {
      available: !!synth,
      speak: speak,
      cancel: cancel,
      /* 지금 쓸 수 있는 목소리가 자연스러운 편인지 */
      isGood: function () { return !!voice && score(voice) >= 40; },
      name: function () { return voice ? voice.name : ''; }
    };
  })();

  /* ===========================================================
     6. 시작 / 종료
     =========================================================== */

  function start() {
    counselor = new Counselor();
    running = true;
    resetWorld();

    state.mood = 0.45; state.moodTarget = 0.5;
    state.spark = 0; state.walked = 0; state.shells = 0;
    player.x = 0; player.d = 0.55; player.face = 1; player.phase = 0;
    buddy.x = 150; buddy.d = 0.60; buddy.face = -1; buddy.talk = 0; buddy.bounce = 0;
    cam.x = 0;

    el.start.hidden = true;
    el.end.hidden = true;
    el.notice.hidden = true;
    el.hud.hidden = false;
    root.classList.remove('is-ended');
    root.classList.add('is-playing');
    root.focus({ preventScroll: true });

    buddySays(counselor.opening());
  }

  function finish() {
    if (!counselor || !running) return;
    running = false;
    buddy.talk = 0;
    clearTimeout(speakTimer);
    Speech.cancel();
    renderReport(counselor.report());
    el.end.hidden = false;
    el.hud.hidden = true;
    root.classList.add('is-ended');
    root.classList.remove('is-playing');
  }

  function renderReport(r) {
    var colors = {
      happy: '#f4796b', calm: '#57c4bd', sad: '#7e93d8', angry: '#f0a13c',
      fear: '#a98fdc', lonely: '#8fa0b8', neutral: '#c3ccdd'
    };
    var acc = 0;
    var stops = r.rows.map(function (row) {
      var from = acc; acc += row.pct;
      return (colors[row.key] || '#c3ccdd') + ' ' + from + '% ' + acc + '%';
    }).join(', ');

    var list = r.rows.map(function (row) {
      return '<li><i style="background:' + (colors[row.key] || '#c3ccdd') + '"></i>' +
             '<span>' + row.label + '</span><b>' + row.pct + '%</b></li>';
    }).join('');

    var tips;
    if (isEn()) {
      tips = r.risk
        ? ['<b>STEP 1 (make sure they are safe)</b> Your child mentioned a warning sign. Go to them now and let them feel safe.',
           '<b>STEP 2 (reach a professional)</b> In Korea you can call the suicide prevention line <b>109</b> or youth counselling <b>1388</b>. Elsewhere, contact your local crisis line.',
           '<b>STEP 3 (share the record)</b> Go through today’s conversation together with a professional.']
        : ['<b>STEP 1 (empathise)</b> Instead of working out who was right, try reading the feeling back first: “that must have really hurt”.',
           '<b>STEP 2 (ask)</b> ' + (r.cause ? 'Ask a question that lets your child tell the story about “' + r.cause + '” in their own words.' : 'Ask which moment of today stayed with them the most.'),
           '<b>STEP 3 (encourage)</b> Praise, specifically, the next step your child worked out for themselves.'];
    } else {
      tips = r.risk
        ? ['<b>STEP 1 (안전 확인)</b> 아이가 위험 신호를 이야기했어요. 지금 바로 아이 곁에서 안심시켜 주세요.',
           '<b>STEP 2 (전문 연결)</b> 자살예방 상담전화 <b>109</b>, 청소년 상담 <b>1388</b>로 상담받을 수 있어요.',
           '<b>STEP 3 (기록 공유)</b> 오늘 대화를 전문가와 함께 살펴보세요.']
        : ['<b>STEP 1 (공감하기)</b> 잘잘못을 따지기보다, 먼저 "많이 속상했겠다"라고 마음을 읽어주는 건 어떨까요?',
           '<b>STEP 2 (질문하기)</b> ' + (r.cause ? '"' + r.cause + '" 이야기를 아이 입으로 다시 꺼낼 수 있게 물어봐 주세요.' : '오늘 어떤 순간이 가장 기억에 남았는지 물어봐 주세요.'),
           '<b>STEP 3 (용기 주기)</b> 아이가 스스로 찾아낸 다음 행동을 구체적으로 칭찬해 주세요.'];
    }

    var meta = isEn()
      ? r.turns + ' exchanges · ' + Math.round(state.walked) + ' m walked · ' +
        state.shells + '/' + SHELL_TOTAL + ' shells'
      : '주고받은 대화 ' + r.turns + '회 · 걸은 거리 ' + Math.round(state.walked) + 'm · 조개 ' +
        state.shells + '/' + SHELL_TOTAL + '개';

    el.report.innerHTML =
      '<div class="report__grid">' +
        '<div class="report__card">' +
          '<p class="report__label">' + T('오늘의 마음 날씨', 'Today’s mood forecast') + '</p>' +
          '<div class="report__donut" style="background:conic-gradient(' + stops + ')"><span>' + r.main + '</span></div>' +
          '<ul class="report__legend">' + list + '</ul>' +
        '</div>' +
        '<div class="report__card">' +
          '<p class="report__label">' + T('감정 안정성', 'Emotional stability') + '</p>' +
          '<p class="report__score">' + r.score + '<em>/100</em></p>' +
          '<p class="report__delta ' + (r.gain >= 0 ? 'is-up' : 'is-down') + '">' +
            (r.gain >= 0 ? '▲ +' : '▼ ') + Math.abs(r.gain) + '% ' +
            T('대화 시작 대비', 'vs. the start of the talk') + '</p>' +
          '<p class="report__meta">' + meta + '</p>' +
          (r.cause ? '<p class="report__keyword">' + T('오늘의 키워드 ', 'Today’s keyword ') + '<b>' + r.cause + '</b></p>' : '') +
        '</div>' +
        '<div class="report__card report__card--wide">' +
          '<p class="report__label">' + T('엄마·아빠를 위한 3가지 제안', 'Three suggestions for mum and dad') + '</p>' +
          '<ol class="report__tips"><li>' + tips.join('</li><li>') + '</li></ol>' +
        '</div>' +
      '</div>';
  }

  /* ---------- 이벤트 ---------- */
  el.go.addEventListener('click', start);
  el.again.addEventListener('click', start);
  el.quit.addEventListener('click', finish);
  el.send.addEventListener('click', function () { say(el.input.value); });
  el.input.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') { e.preventDefault(); say(el.input.value); }
  });

  function paintVoiceButton() {
    el.voice.textContent = voiceOn ? T('🔊 목소리 켬', '🔊 Voice on') : T('🔈 목소리 끔', '🔈 Voice off');
  }

  /* 산책을 시작하기 전에도 HUD 글자는 지금 언어로 */
  function paintHud() {
    paintVoiceButton();
    el.who.textContent = whoLabel(lastWho);
    if (counselor) { updateChips(); return; }
    el.stage.textContent = stageLabel('greet');
    el.mood.textContent = T('마음 날씨 · 잔잔함', 'Mood · Calm');
    el.step.textContent = isEn() ? '0 m walked' : '0m 걸었어요';
    el.shell.textContent = T('조개 ', 'Shells ') + '0 / ' + SHELL_TOTAL;
  }
  paintHud();

  el.voice.addEventListener('click', function () {
    if (!Speech.available) {
      el.hint.textContent = T('이 브라우저는 음성 읽어주기를 지원하지 않아요.',
                              'This browser does not support read-aloud.');
      return;
    }
    voiceOn = !voiceOn;
    el.voice.setAttribute('aria-pressed', String(voiceOn));
    paintVoiceButton();

    if (voiceOn) {
      /* 켜자마자 지금 하고 있는 말을 다시 들려준다 */
      var now = el.sub.textContent;
      if (now && lastWho === 'buddy') Speech.speak(now, state.mood);
      el.hint.textContent = Speech.isGood()
        ? ''
        : T('기본 음성이라 조금 딱딱해요 — Chrome이나 Edge에서 더 자연스럽게 들립니다.',
            'This is the default voice, so it sounds a little flat — Chrome or Edge sound more natural.');
    } else {
      Speech.cancel();
    }
  });

  /* 언어를 바꾸면 화면에 남아 있는 표시를 다시 그린다 */
  RB.onLang(function () {
    paintHud();
    if (counselor && !running && !el.end.hidden) renderReport(counselor.report());
  });

  if ('IntersectionObserver' in window) {
    new IntersectionObserver(function (entries) {
      visible = entries[0].isIntersecting;
      if (!visible) keys.left = keys.right = keys.up = keys.down = false;
    }, { threshold: 0.25 }).observe(root);
  } else visible = true;

  /* ===========================================================
     7. 루프
     =========================================================== */

  var SPEED_X = 190;     // px/s (월드 좌표)
  var SPEED_D = 0.34;    // 깊이/초
  var printTimer = 0;

  function update(dt) {
    state.time += dt;
    state.mood += (state.moodTarget - state.mood) * Math.min(1, dt * 1.1);
    state.spark = Math.max(0, state.spark - dt * 0.55);
    if (buddy.bounce > 0) buddy.bounce = Math.max(0, buddy.bounce - dt);
    if (floatText && state.time > floatUntil) floatText = '';

    /* 플레이어 이동 */
    var vx = (keys.right ? 1 : 0) - (keys.left ? 1 : 0);
    var vd = (keys.down ? 1 : 0) - (keys.up ? 1 : 0);
    var moving = running && (vx !== 0 || vd !== 0);

    if (moving) {
      var norm = (vx !== 0 && vd !== 0) ? 0.72 : 1;
      player.x = clamp(player.x + vx * SPEED_X * norm * dt, WORLD_MIN, WORLD_MAX);
      player.d = clamp(player.d + vd * SPEED_D * norm * dt, 0.10, 0.98);
      if (vx !== 0) player.face = vx > 0 ? 1 : -1;
      player.phase += dt * 9.5;
      state.walked += Math.abs(vx) * SPEED_X * norm * dt * 0.02;

      printTimer -= dt;
      if (printTimer <= 0) {
        printTimer = 0.24;
        world.prints.push({ x: player.x + (Math.random() - 0.5) * 6, d: player.d, life: 1 });
        if (world.prints.length > 90) world.prints.shift();
      }
    }
    player.moving = moving;

    for (var i = world.prints.length - 1; i >= 0; i--) {
      world.prints[i].life -= dt * 0.055;
      if (world.prints[i].life <= 0) world.prints.splice(i, 1);
    }

    /* 조개 자동 줍기 (아주 가까우면) */
    if (running) {
      for (var j = 0; j < world.shells.length; j++) {
        var sh = world.shells[j];
        if (!sh.got && Math.abs(sh.x - player.x) < 22 && Math.abs(sh.d - player.d) < 0.09) collectShell(sh);
      }
    }

    /* 동행 캐릭터가 따라온다 */
    var wantX = player.x - player.face * 118;
    var dx = wantX - buddy.x;
    if (Math.abs(dx) > 6) {
      var step = clamp(dx, -SPEED_X * 1.15 * dt, SPEED_X * 1.15 * dt);
      buddy.x += step;
      buddy.phase += dt * 9;
      buddy.moving = true;
      buddy.face = step > 0 ? 1 : -1;
    } else {
      buddy.moving = false;
      buddy.face = player.x >= buddy.x ? 1 : -1;
    }
    buddy.d += ((player.d + 0.05) - buddy.d) * Math.min(1, dt * 2.2);

    /* 카메라 */
    var camWant = player.x;
    cam.x += (camWant - cam.x) * Math.min(1, dt * 3.4);

    if (running && Math.floor(state.time * 3) % 3 === 0) updateChips();
  }

  var last = 0;
  function loop(ts) {
    requestAnimationFrame(loop);
    var dt = Math.min((ts - last) / 1000 || 0, 0.05);
    last = ts;
    if (!visible && running) { /* 화면 밖이면 갱신만 최소화 */ }
    update(dt);
    render(state.time);
  }

  /* 시작 전에도 장면은 살아 있게 */
  resetWorld();
  player.x = 0; buddy.x = 150;
  requestAnimationFrame(loop);
})();
