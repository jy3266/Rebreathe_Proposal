// The three walking friends. The Unreal level has three AI characters (a bear, a cat and an owl,
// all the AI_CH Blueprint); the child picks one on the start card, and that one walks along,
// talks (its own name and voice: Worker /chat `character`, /tts `character`) and plays the game.
//
// GAME_LINES are said when something happens in the walk game (bada-chat.js announce()).

export const FRIENDS = {
  bear: {
    emoji: '🐻',
    name: { ko: '포근이', en: 'Cozy' },
    kind: { ko: '곰', en: 'bear' },
    about: { ko: '꼭 안아 주는 하늘색 곰', en: 'A sky-blue bear who gives warm hugs' },
    color: '#5aa9e6',
    opening: {
      ko: '안녕! 나는 곰 포근이야. 너랑 같이 걸으니까 마음이 포근해. 있잖아, 오늘 너한테는 어떤 일이 있었어?',
      en: "Hi! I'm Cozy the bear. Walking with you feels so cozy. So, how was your day?",
    },
  },
  cat: {
    emoji: '🐱',
    name: { ko: '살랑이', en: 'Breezy' },
    kind: { ko: '고양이', en: 'cat' },
    about: { ko: '머리에 별을 단 하얀 고양이', en: 'A white cat with a star on her head' },
    color: '#f39bc0',
    opening: {
      ko: '안녕! 나는 고양이 살랑이야. 바람이 살랑살랑 기분 좋다냥. 오늘 너는 어떤 하루를 보냈어?',
      en: "Hi! I'm Breezy the cat. The breeze feels so nice today. How was your day?",
    },
  },
  owl: {
    emoji: '🦉',
    name: { ko: '호호', en: 'Hoho' },
    kind: { ko: '부엉이', en: 'owl' },
    about: { ko: '동그란 안경을 쓴 척척박사 부엉이', en: 'A wise owl with round glasses' },
    color: '#b08a6a',
    opening: {
      ko: '안녕! 나는 부엉이 호호야. 호호, 오늘 산책길이 참 예쁘다. 오늘 너한테는 무슨 일이 있었어?',
      en: "Hi! I'm Hoho the owl. What a pretty path for a walk. So, what happened today?",
    },
  },
};

export const FRIEND_IDS = Object.keys(FRIENDS);

// Things to find in the park (RBBadaProps in the Unreal project).
export const ITEMS = {
  star: { emoji: '⭐', ko: '반짝별', en: 'Star' },
  lollipop: { emoji: '🍭', ko: '막대사탕', en: 'Lollipop' },
  balloon: { emoji: '🎈', ko: '풍선', en: 'Balloon' },
  icecream: { emoji: '🍦', ko: '아이스크림', en: 'Ice cream' },
  gift: { emoji: '🎁', ko: '선물 상자', en: 'Gift' },
  apple: { emoji: '🍎', ko: '빨간 사과', en: 'Apple' },
  poop: { emoji: '💩', ko: '똥 치우기 착한 일', en: 'Cleaned up the poop' },
  golden_poop: { emoji: '✨💩', ko: '황금똥', en: 'Golden poop' },
  toilet: { emoji: '🚽', ko: '화장실 도착', en: 'Made it to the toilet' },
};

// What the friend says during the poop game. {name} is the friend's name.
export const GAME_LINES = {
  urge: {
    ko: '앗! 나 똥 마려워! 저기 화장실까지 같이 뛰어가 줄래?',
    en: 'Uh-oh! I need to poop! Can you run with me to that toilet?',
  },
  urgeNoToilet: {
    ko: '앗! 나 똥 마려워! 화장실이 안 보여, 어떡해!',
    en: "Uh-oh! I need to poop! I can't see a toilet anywhere!",
  },
  toilet: {
    ko: '휴, 시원하다! 같이 와 줘서 고마워!',
    en: 'Phew, that feels better! Thanks for coming with me!',
  },
  ground: {
    ko: '앗, 참지 못했어! 부끄러워라. 같이 치워 줄래?',
    en: "Oops, I couldn't hold it! So embarrassing. Will you help me clean up?",
  },
  golden: {
    ko: '우와! 반짝반짝 황금똥이야! 얼른 주워 봐!',
    en: 'Wow! A shiny golden poop! Quick, pick it up!',
  },
};
