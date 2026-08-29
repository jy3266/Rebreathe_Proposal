/* =============================================================
   리브리드(REBREATHE) — 한국어 / English 전환
   -------------------------------------------------------------
   · 한국어 원문은 HTML 안에 그대로 두고, 영어만 data-en 속성으로 적는다.
       <p data-en="Hello">안녕하세요</p>
   · 속성 번역은 data-en-<속성이름>:
       data-en-alt / data-en-placeholder / data-en-title /
       data-en-aria-label / data-en-value / data-en-content / data-en-suffix
   · 다른 스크립트는 RB.lang 으로 현재 언어를 읽고,
     RB.t('한국어', 'English') 로 문자열을 고르고,
     RB.onLang(fn) 으로 전환 시점을 구독한다.
   ============================================================= */
(function () {
  'use strict';

  var STORE = 'rebreathe:lang';
  var LANGS = ['ko', 'en'];

  /* <head> 안의 문서 정보는 속성이 아니라 여기서 통째로 바꾼다 */
  var META = {
    ko: {
      title: '리브리드(REBREATHE) — AI 기반 아동 멘탈케어 플랫폼',
      description: '멀티모달 AI·VR·블록체인 기반 4~12세 아동 정신건강 증진 플랫폼. 아이에겐 매일 만나는 단짝 친구, 부모에겐 가장 정확한 마음 번역기.',
      ogTitle: '리브리드(REBREATHE)',
      ogDescription: '아이에겐 매일 만나는 단짝 친구, 부모에겐 가장 정확한 마음 번역기'
    },
    en: {
      title: 'REBREATHE — AI-Powered Mental Care for Children',
      description: 'A mental health platform for children aged 4–12, built on multimodal AI, VR and blockchain. A best friend the child meets every day, and the most accurate translator of that child\u2019s heart for parents.',
      ogTitle: 'REBREATHE',
      ogDescription: 'A best friend the child meets every day — and the most accurate translator of that heart for parents'
    }
  };

  var ATTR_MAP = {
    'data-en-alt': 'alt',
    'data-en-placeholder': 'placeholder',
    'data-en-title': 'title',
    'data-en-aria-label': 'aria-label',
    'data-en-value': 'value',
    'data-en-content': 'content',
    'data-en-suffix': 'data-suffix'
  };

  var SELECTOR = ['[data-en]'].concat(
    Object.keys(ATTR_MAP).map(function (k) { return '[' + k + ']'; })
  ).join(',');

  var listeners = [];
  var current = null;

  function saved() {
    try { return localStorage.getItem(STORE); } catch (e) { return null; }
  }
  function remember(lang) {
    try { localStorage.setItem(STORE, lang); } catch (e) { /* 사생활 보호 모드 */ }
  }

  function initialLang() {
    var q = /[?&]lang=(ko|en)/i.exec(location.search) || /[#&]lang=(ko|en)/i.exec(location.hash);
    if (q) return q[1].toLowerCase();
    var s = saved();
    if (s && LANGS.indexOf(s) !== -1) return s;
    var n = (navigator.language || navigator.userLanguage || 'ko').toLowerCase();
    return n.indexOf('ko') === 0 ? 'ko' : 'en';
  }

  /* ---------- 화면에 적용 ---------- */
  function applyTo(el, lang) {
    if (el.hasAttribute('data-en')) {
      if (el.__rbKo === undefined) el.__rbKo = el.innerHTML;
      el.innerHTML = (lang === 'en') ? el.getAttribute('data-en') : el.__rbKo;
    }
    Object.keys(ATTR_MAP).forEach(function (src) {
      if (!el.hasAttribute(src)) return;
      var target = ATTR_MAP[src];
      if (!el.__rbKoAttr) el.__rbKoAttr = {};
      if (el.__rbKoAttr[target] === undefined) el.__rbKoAttr[target] = el.getAttribute(target) || '';
      el.setAttribute(target, (lang === 'en') ? el.getAttribute(src) : el.__rbKoAttr[target]);
    });
  }

  function paint(lang) {
    var els = document.querySelectorAll(SELECTOR);
    for (var i = 0; i < els.length; i++) applyTo(els[i], lang);

    var m = META[lang] || META.ko;
    document.title = m.title;
    setMeta('name', 'description', m.description);
    setMeta('property', 'og:title', m.ogTitle);
    setMeta('property', 'og:description', m.ogDescription);

    document.documentElement.setAttribute('lang', lang);

    var btns = document.querySelectorAll('[data-lang]');
    for (var j = 0; j < btns.length; j++) {
      var on = btns[j].getAttribute('data-lang') === lang;
      btns[j].classList.toggle('is-on', on);
      btns[j].setAttribute('aria-pressed', String(on));
    }
  }

  function setMeta(attr, key, value) {
    var el = document.head && document.head.querySelector('meta[' + attr + '="' + key + '"]');
    if (el) el.setAttribute('content', value);
  }

  function set(lang, opts) {
    if (LANGS.indexOf(lang) === -1) lang = 'ko';
    if (lang === current) return;
    current = lang;
    RB.lang = lang;
    paint(lang);
    if (!opts || opts.remember !== false) remember(lang);
    listeners.forEach(function (fn) {
      try { fn(lang); } catch (e) { /* 한 구독자의 오류가 전환을 막지 않도록 */ }
    });
  }

  var RB = window.RB = window.RB || {};
  RB.lang = 'ko';
  RB.set = set;
  RB.t = function (ko, en) { return RB.lang === 'en' ? en : ko; };
  RB.onLang = function (fn) { if (typeof fn === 'function') listeners.push(fn); };
  /* 나중에 만들어진 DOM 조각에도 현재 언어를 입힌다 */
  RB.localize = function (rootEl) {
    var scope = rootEl || document;
    var els = scope.querySelectorAll(SELECTOR);
    for (var i = 0; i < els.length; i++) applyTo(els[i], RB.lang);
  };

  /* ---------- 탭 버튼 ---------- */
  document.addEventListener('click', function (e) {
    var btn = e.target.closest && e.target.closest('[data-lang]');
    if (!btn) return;
    e.preventDefault();
    set(btn.getAttribute('data-lang'));
  });

  set(initialLang(), { remember: false });
})();
