# 리브리드 (REBREATHE) — 브랜드 사이트

AI 기반 아동 멘탈케어 플랫폼 **리브리드(REBREATHE)** 소개 사이트입니다.
빌드 도구 없이 브라우저에서 바로 열리는 정적 사이트이며, **한국어 / English** 전환을 지원합니다.

> An introduction site for **REBREATHE**, an AI-powered mental care platform for children.
> A static site with no build step, available in **Korean and English**.

---

## 폴더 구조

```
index.html              사이트 본문 (한국어 원문 + data-en 영문)
assets/
  css/style.css         전체 스타일
  js/i18n.js            한국어 / English 전환 엔진
  js/main.js            스크롤 애니메이션 · 네비게이션 · 카운터
  js/game.js            '바다와 함께 걷기' 2D 상담 데모
  img/                  사진 · 스크린샷
tools/
  build-artifact.ps1    단일 HTML로 묶는 빌드 스크립트 (Artifact 게시용)
```

## 로컬에서 보기

`index.html`을 브라우저로 열면 그대로 동작합니다. 파일을 더블클릭해도 되고,
로컬 서버가 필요하면 아무 정적 서버나 쓰면 됩니다.

## GitHub Pages로 공개하기

1. GitHub에서 새 저장소를 만듭니다 (예: `rebreathe-website`).
2. 이 폴더에서 원격 주소를 연결하고 올립니다.

   ```bash
   git remote add origin https://github.com/<사용자이름>/rebreathe-website.git
   git push -u origin main
   ```

3. 저장소 **Settings → Pages**로 가서
   *Source*는 **Deploy from a branch**, *Branch*는 **main / (root)** 로 지정하고 저장합니다.
4. 1~2분 뒤 `https://<사용자이름>.github.io/rebreathe-website/` 에서 사이트가 열립니다.

저장소가 **Public**이어야 무료 플랜에서 Pages가 동작합니다.
`.nojekyll` 파일이 들어 있어 Jekyll 처리를 건너뛰고 파일을 그대로 서빙합니다.

## 언어 전환은 어떻게 동작하나

한국어 원문은 HTML 안에 그대로 두고, 영어만 `data-en` 속성으로 함께 적습니다.

```html
<h2 class="sec-head__title" data-en="A crisis in children&#39;s mental health">아동 정신건강 위기</h2>
```

속성을 번역할 때는 `data-en-` 을 앞에 붙입니다 —
`data-en-alt`, `data-en-placeholder`, `data-en-aria-label`, `data-en-title`,
`data-en-content`, `data-en-value`, `data-en-suffix`.

`assets/js/i18n.js`가 상단 탭(한국어 / EN)을 처리하고, 선택한 언어를
`localStorage`에 기억합니다. 저장된 값이 없으면 브라우저 언어를 보고 정합니다
(한국어면 한국어, 그 외에는 영어). 주소 뒤에 `?lang=en` 또는 `?lang=ko` 를 붙여
특정 언어로 바로 열 수도 있습니다.

JS 안의 문자열은 `RB.t('한국어', 'English')` 로 고르고,
언어가 바뀌는 시점은 `RB.onLang(fn)` 으로 구독합니다.

### 문구를 고칠 때

한국어는 HTML 본문을, 영어는 같은 태그의 `data-en` 값을 함께 고치면 됩니다.
게임 데모(`assets/js/game.js`)의 대사는 `RB.t(...)` 또는 `T(...)` 호출 안에
두 언어가 나란히 들어 있습니다.

## Artifact(단일 HTML)로 묶기

CSS·JS·이미지를 전부 인라인한 자체 완결형 HTML을 만듭니다.

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File tools/build-artifact.ps1 out.html
```

## 저장소에 올리지 않는 것

IR 원본 PDF는 용량이 크고 공개 자료가 아니라 `.gitignore`로 제외해 두었습니다.
함께 공개하려면 `.gitignore`에서 `*.pdf` 와 `assets/doc/` 줄을 지우세요.

## 문의

rebreathe.starground@gmail.com
