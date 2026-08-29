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

  /* ---------- 5. 스크롤 진행 막대 + 히어로 패럴랙스 ---------- */
  var progress = document.getElementById('scrollProgress');
  var heroImg = document.querySelector('.hero__bg img');
  var heroSection = document.querySelector('.hero');
  var ticking = false;

  function onScrollFrame() {
    ticking = false;
    var doc = document.documentElement;
    var max = doc.scrollHeight - window.innerHeight;
    var ratio = max > 0 ? Math.min(window.scrollY / max, 1) : 0;
    if (progress) progress.style.width = (ratio * 100).toFixed(2) + '%';

    if (heroImg && !reduceMotion && heroSection) {
      var h = heroSection.offsetHeight;
      if (window.scrollY < h) {
        var p = window.scrollY / h;
        heroImg.style.transform = 'translate3d(0,' + (p * 14).toFixed(2) + '%,0) scale(' + (1 + p * 0.06).toFixed(3) + ')';
      }
    }
  }

  window.addEventListener('scroll', function () {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(onScrollFrame);
  }, { passive: true });
  onScrollFrame();

  /* ---------- 6. 카드 위 커서 빛 ---------- */
  var fine = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  if (fine && !reduceMotion) {
    document.addEventListener('pointermove', function (e) {
      var card = e.target.closest('.card');
      if (!card) return;
      var r = card.getBoundingClientRect();
      card.style.setProperty('--mx', ((e.clientX - r.left) / r.width * 100).toFixed(1) + '%');
      card.style.setProperty('--my', ((e.clientY - r.top) / r.height * 100).toFixed(1) + '%');
    }, { passive: true });
  }

  /* ---------- 7. 자석 버튼 ---------- */
  if (fine && !reduceMotion) {
    document.querySelectorAll('.btn--magnet').forEach(function (btn) {
      btn.addEventListener('pointermove', function (e) {
        var r = btn.getBoundingClientRect();
        var dx = (e.clientX - (r.left + r.width / 2)) / r.width;
        var dy = (e.clientY - (r.top + r.height / 2)) / r.height;
        btn.style.transform = 'translate(' + (dx * 10).toFixed(1) + 'px,' + (dy * 8).toFixed(1) + 'px)';
      });
      btn.addEventListener('pointerleave', function () { btn.style.transform = ''; });
    });
  }

  /* ---------- 8. 방향성 있는 등장 ---------- */
  var mediaBlock = document.querySelector('.solution__media');
  if (mediaBlock) mediaBlock.classList.add('reveal--left');
  document.querySelectorAll('.flow > li').forEach(function (li) { li.classList.add('reveal--right'); });
})();
