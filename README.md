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
  js/stage3d.js         '바다와 함께 걷기' 3D 체험을 어디서 띄울지 고른다 (시연 PC / 클라우드 / 2D)
  js/game.js            '바다와 함께 걷기' 2D 상담 데모 (3D를 열 수 없을 때 대신 보임)
  img/                  사진 · 스크린샷
bada3d/                 3D 체험 페이지 (언리얼 화면 + 목소리로만 하는 바다와의 대화)
  js/config.js          스트림 종류·주소 설정 (공개 페이지라 허용된 주소만 받음)
  js/ue-bridge.js       언리얼 연결 — 시연 PC(Epic 프런트엔드) / Eagle 3D Streaming(iframe)
  js/voice.js           마이크 · 말 끝 자동 감지 → WAV
  js/bada-chat.js       음성 대화 흐름 (글자 변환 → Claude → 음성 출력), 클라우드 자동 종료
tools/
  build-artifact.ps1    단일 HTML로 묶는 빌드 스크립트 (Artifact 게시용)
```

## 로컬에서 보기

`index.html`을 브라우저로 열면 그대로 동작합니다. 파일을 더블클릭해도 되고,
로컬 서버가 필요하면 아무 정적 서버나 쓰면 됩니다.

## 공개 주소

**https://jy3266.github.io/Rebreathe_Proposal/**

저장소: https://github.com/jy3266/Rebreathe_Proposal
GitHub Pages는 **main 브랜치 / (root)** 에서 배포하도록 설정되어 있습니다.
`.nojekyll` 파일이 있어 Jekyll 처리를 건너뛰고 파일을 그대로 서빙합니다.

### 수정한 내용을 반영하려면

```bash
git add -A
git commit -m "무엇을 고쳤는지"
git push
```

푸시하고 1~2분 뒤 공개 주소에 반영됩니다.
`?lang=en` 을 붙이면 영문으로 바로 열립니다 —
https://jy3266.github.io/Rebreathe_Proposal/?lang=en

## '바다와 함께 걷기' 3D 체험은 어떻게 연결되나

체험 구간(`#play`)은 `bada3d/` 체험 페이지를 iframe으로 띄웁니다. 언리얼 3D 화면은 아래 순서로 고릅니다.

1. **리브리드 시연 PC (켜져 있으면, 무료)**
   시연 PC에서 `start-demo.bat`을 실행하면 시그널링 서버 · 언리얼 빌드 · Cloudflare 터널이 켜지고,
   `register-stream.ps1`이 이번 터널 주소(`https://….trycloudflare.com`, 켤 때마다 바뀜)를
   대화 서버(Cloudflare Worker)의 KV에 저장합니다. `stage3d.js`가 Worker의 `GET /stream`으로
   주소를 받아 `bada3d/?ss=wss://…`로 엽니다.
2. **Eagle 3D Streaming 클라우드 (PC가 꺼져 있으면, 쓴 시간만큼 과금)**
   `stage3d.js` 맨 위 `CLOUD_STREAM`에 Eagle 링크가 있을 때만 씁니다. 체험 페이지에서
   **산책 시작하기**를 눌러야 클라우드 연결이 시작되고(구경만 해서는 과금되지 않음),
   5분 동안 대화가 없거나 Eagle이 세션을 끝내면 연결을 닫습니다.
3. 둘 다 안 되면 안내 문구와 함께 **2D로 바닷가 걷기** 버튼을 보여 주고, 누르면 기존 2D 데모가 나옵니다.

시연 PC 쪽은 사이트를 다시 배포할 필요 없이 켜 두기만 하면 됩니다.
클라우드 링크를 넣거나 바꿀 때만 `CLOUD_STREAM`을 고쳐 푸시합니다.
Worker 주소는 `stage3d.js` 맨 위 `WORKER` 값입니다.

### Eagle 3D Streaming 링크 넣기

1. Eagle Control Panel에 `Rebreathe_PixelStreaming_Win64.zip`(시연 PC의 `D:\Rebreathe_Web`)을 업로드
2. 앱의 Configuration에서 권장 설정: **Autoplay 켬**, **Log Out Automatically After Inactivity 켬**,
   최대 세션 길이 제한(예: 15분), 시작 비밀번호 없음
3. Configuration의 iframe 코드에서 `src` 주소(`https://connector.eagle3dstreaming.com/v5/…`)를 복사해
   `assets/js/stage3d.js`의 `var CLOUD_STREAM = '';` 따옴표 안에 넣고 푸시

체험 페이지는 `eagle3dstreaming.com` 주소만 받아들이고, 시그널링 서버도 `*.trycloudflare.com`만 받습니다
(공개 페이지에 다른 사이트를 끼워 넣는 링크를 막기 위해서). 로컬(`localhost`)에서는 제한이 없습니다.

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
