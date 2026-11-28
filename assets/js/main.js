/* 리브리드(REBREATHE) — 사이트 인터랙션 */
(function () {
  'use strict';

  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  document.body.setAttribute('data-reveal-ready', '1');

  /* ---------- 1. 스크롤 등장 애니메이션 ---------- */
  var revealables = document.querySelectorAll('.reveal');
  if (reduceMotion || !('IntersectionObserver' in window)) {
    revealables.forEach(function (el) { el.classList.add('is-in'); });
  } else {
    var revealObserver = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('is-in');
        revealObserver.unobserve(entry.target);
      });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });

    revealables.forEach(function (el, i) {
      // 같은 행의 카드들이 살짝 시차를 두고 나타나도록
      var delay = (i % 4) * 70;
      el.style.transitionDelay = delay + 'ms';
      revealObserver.observe(el);
    });
  }

  /* ---------- 2. 네비게이션 ---------- */
  var nav = document.getElementById('nav');
  var toggle = document.getElementById('navToggle');
  var links = document.getElementById('navLinks');
  var toTop = document.getElementById('toTop');

  /* i18n.js가 없어도 한국어로 동작하도록 */
  var RB = window.RB || { lang: 'ko', t: function (ko) { return ko; }, onLang: function () {} };

  function menuLabel(open) {
    return open ? RB.t('메뉴 닫기', 'Close menu') : RB.t('메뉴 열기', 'Open menu');
  }

  function closeMenu() {
    links.classList.remove('is-open');
    toggle.setAttribute('aria-expanded', 'false');
    toggle.setAttribute('aria-label', menuLabel(false));
  }

  toggle.addEventListener('click', function () {
    var open = links.classList.toggle('is-open');
    toggle.setAttribute('aria-expanded', String(open));
    toggle.setAttribute('aria-label', menuLabel(open));
  });

  links.addEventListener('click', function (e) {
    if (e.target.tagName === 'A') closeMenu();
  });

  window.addEventListener('scroll', function () {
    var y = window.scrollY;
    nav.classList.toggle('is-stuck', y > 8);
    toTop.classList.toggle('is-show', y > 700);
  }, { passive: true });

  toTop.addEventListener('click', function () {
    window.scrollTo({ top: 0, behavior: reduceMotion ? 'auto' : 'smooth' });
  });

  /* 현재 보고 있는 섹션을 메뉴에 표시 */
  var navAnchors = Array.prototype.filter.call(
    links.querySelectorAll('a[href^="#"]'),
    function (a) { return !a.classList.contains('nav__cta'); }
  );
  var sections = navAnchors
    .map(function (a) { return document.querySelector(a.getAttribute('href')); })
    .filter(Boolean);

  if ('IntersectionObserver' in window && sections.length) {
    var visible = {};
    var sectionObserver = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        visible[entry.target.id] = entry.isIntersecting ? entry.intersectionRatio : 0;
      });
      var topId = null, topRatio = 0;
      Object.keys(visible).forEach(function (id) {
        if (visible[id] > topRatio) { topRatio = visible[id]; topId = id; }
      });
      navAnchors.forEach(function (a) {
        a.classList.toggle('is-active', topId !== null && a.getAttribute('href') === '#' + topId);
      });
    }, { rootMargin: '-30% 0px -55% 0px', threshold: [0, 0.15, 0.4, 0.75, 1] });

    sections.forEach(function (s) { sectionObserver.observe(s); });
  }

  /* ---------- 3. 히어로 숫자 카운트업 ---------- */
  var counters = document.querySelectorAll('[data-count]');

  function formatNumber(value, decimals) {
    if (decimals > 0) return value.toFixed(decimals);
    return Math.round(value).toLocaleString(RB.lang === 'en' ? 'en-US' : 'ko-KR');
  }

  function finalText(el) {
    return formatNumber(parseFloat(el.getAttribute('data-count')),
                        parseInt(el.getAttribute('data-decimals') || '0', 10)) +
           (el.getAttribute('data-suffix') || '');
  }

  /* 언어를 바꾸면 단위(명 / %)가 달라지므로 이미 센 숫자는 다시 써준다 */
  RB.onLang(function () {
    counters.forEach(function (el) { if (el.__rbCounted) el.textContent = finalText(el); });
  });

  function runCounter(el) {
    var target = parseFloat(el.getAttribute('data-count'));
    var decimals = parseInt(el.getAttribute('data-decimals') || '0', 10);
    var suffix = el.getAttribute('data-suffix') || '';
    el.__rbCounted = true;

    if (reduceMotion) {
      el.textContent = formatNumber(target, decimals) + suffix;
      return;
    }
    var duration = 1400;
    var start = null;
    function step(ts) {
      if (start === null) start = ts;
      var p = Math.min((ts - start) / duration, 1);
      var eased = 1 - Math.pow(1 - p, 3);
      el.textContent = formatNumber(target * eased, decimals) + suffix;
      if (p < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }

  if ('IntersectionObserver' in window) {
    var counterObserver = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        runCounter(entry.target);
        counterObserver.unobserve(entry.target);
      });
    }, { threshold: 0.5 });
    counters.forEach(function (el) { counterObserver.observe(el); });
  } else {
    counters.forEach(runCounter);
  }

  /* ---------- 5. 스크롤에 맞춘 움직임 ----------
     · 히어로 장면: 장면의 윗변이 메뉴 바로 아래에 닿을 때까지 폭이 화면 끝까지 넓어진다 (--p 0→1)
     · 선언 제목: 화면 85% 지점에서 35% 지점으로 올라가는 동안 줄마다 왼쪽부터 칠해진다 (--frac 0→1)
     모션을 줄이는 설정이면 둘 다 멈춘 모습 그대로 둔다(CSS 기본값). */
  var hero = document.querySelector('.hero');
  var heroVisual = document.querySelector('.hero__visual');
  var fillLines = document.querySelectorAll('.statement__line');
  var fillTitle = fillLines.length ? fillLines[0].parentNode : null;
  var ticking = false;

  function clamp01(v) { return v < 0 ? 0 : (v > 1 ? 1 : v); }

  function onScrollFrame() {
    ticking = false;
    if (reduceMotion) return;
    var vh = window.innerHeight;

    if (heroVisual) {
      var startY = heroVisual.getBoundingClientRect().top + window.scrollY - nav.offsetHeight;
      var p = startY > 0 ? clamp01(window.scrollY / startY) : 1;
      heroVisual.style.setProperty('--p', p.toFixed(4));
    }

    if (fillTitle) {
      var t = clamp01((vh * 0.85 - fillTitle.getBoundingClientRect().top) / (vh * 0.5));
      var n = fillLines.length;
      for (var i = 0; i < n; i++) {
        fillLines[i].style.setProperty('--frac', clamp01(t * n - i).toFixed(4));
      }
    }
  }

  if (!reduceMotion) {
    window.addEventListener('scroll', function () {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(onScrollFrame);
    }, { passive: true });
    window.addEventListener('resize', onScrollFrame, { passive: true });
    onScrollFrame();
  }

  /* 히어로 제목이 줄마다 올라온다. 첫 화면(9번)이 떠 있으면 그것이 걷힐 때 시작한다. */
  function heroIn() {
    if (!hero) return;
    requestAnimationFrame(function () { hero.classList.add('is-in'); });
  }
  if (!document.documentElement.classList.contains('gate-open')) heroIn();

  /* ---------- 8. 방향성 있는 등장 ---------- */
  var mediaBlock = document.querySelector('.solution__media');
  if (mediaBlock) mediaBlock.classList.add('reveal--left');
  document.querySelectorAll('.flow > li').forEach(function (li) { li.classList.add('reveal--right'); });

  /* ---------- 9. 첫 화면: 리브리드 / 스타그라운드 고르기 ---------- */
  /* 띄울지는 <head> 스크립트가 정한다(html.gate-open). 리브리드를 고르면 첫 화면이 걷히고 이 탭에서는
     다시 뜨지 않는다. 스타그라운드 쪽은 평범한 링크라 그 사이트로 이동한다. */
  var gate = document.getElementById('gate');
  var root = document.documentElement;
  if (gate && root.classList.contains('gate-open')) {
    var enter = document.getElementById('gateRebreathe');
    var closed = false;
    var closeGate = function () {
      if (closed) return;
      closed = true;
      try { sessionStorage.setItem('rb-gate', 'rebreathe'); } catch (e) { /* 사생활 보호 모드 */ }
      gate.classList.add('is-leaving');
      root.classList.remove('gate-open');
      root.classList.add('gate-skip');
      heroIn();
      var finish = function () {
        gate.hidden = true;
        gate.classList.remove('is-leaving');
      };
      if (reduceMotion) finish();
      else setTimeout(finish, 500); /* .gate.is-leaving 의 opacity 전환 시간 */
      var brand = document.querySelector('.nav .brand');
      if (brand) brand.focus({ preventScroll: true });
    };
    enter.addEventListener('click', closeGate);
    gate.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { e.preventDefault(); closeGate(); return; }
      if (e.key !== 'Tab') return;
      /* 첫 화면이 떠 있는 동안 포커스는 그 안에서만 돈다 */
      var items = gate.querySelectorAll('button, a[href]');
      var first = items[0];
      var last = items[items.length - 1];
      if (e.shiftKey && (document.activeElement === first || document.activeElement === gate)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    });
    /* 화면 읽기 프로그램이 첫 화면부터 읽도록 (테두리는 그리지 않는다) */
    gate.setAttribute('tabindex', '-1');
    gate.focus({ preventScroll: true });
  } else if (gate) {
    gate.hidden = true;
  }
})();
