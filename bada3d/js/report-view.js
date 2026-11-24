// Draws the caregiver "마음 리포트" (from Worker /report) on the page, in the look of the app's weekly
// report: 마음 날씨 with a donut of feelings, 감정 리듬 as a curve with a stability score, keywords,
// then strengths and the parenting guide. Pure function: returns an HTML string.

const COLORS = {
  happy: '#F4867A', excited: '#FBD877', calm: '#7ECDC4', proud: '#F6A96B', curious: '#9BB7F0',
  loved: '#F49AC1', sad: '#8FA8D8', worried: '#B9A6E3', angry: '#E66A5A', frustrated: '#E89A6B',
  lonely: '#A3B1C6', tired: '#C2B8AE', scared: '#9C8FD0', embarrassed: '#F2B5A0',
};
const WEATHER = { sunny: '☀️', partly_cloudy: '⛅', cloudy: '☁️', rainy: '🌧️', stormy: '⛈️', rainbow: '🌈' };

const TEXT = {
  ko: {
    title: '오늘의 마음 리포트', weather: '오늘의 마음 날씨', main: '주요 감정', rhythm: '감정 리듬',
    stability: '안정성 점수', turn: (n) => `${n}번째 말`, keywords: '우리 아이 관심 키워드', summary: '한눈에 보기',
    strengths: '오늘 보인 아이의 힘', moments: '기억에 남는 아이의 말', guide: '양육 가이드', tips: '이렇게 해 보세요',
    starters: '오늘 저녁 건네 볼 말', avoid: '이런 반응은 잠시 미뤄 주세요', signals: '살펴봐 주세요',
    help: '도움이 필요하면: 청소년상담 1388 · 자살예방상담 109 · 위급하거나 아동학대 신고 112',
    basis: '이 리포트에 대해',
    disclaimer: 'AI(Claude)가 오늘 대화를 감정 코칭과 사회정서학습(CASEL)의 관점에서 읽고 만든 참고 자료이며, 표준화된 심리검사나 의학적 진단이 아닙니다.',
  },
  en: {
    title: "Today's Heart Report", weather: "Today's mood weather", main: 'Main feeling', rhythm: 'Emotional rhythm',
    stability: 'Stability score', turn: (n) => `Turn ${n}`, keywords: 'What your child cared about', summary: 'At a glance',
    strengths: 'Strengths your child showed', moments: 'Words worth remembering', guide: 'Parenting guide', tips: 'Try this',
    starters: 'Ways to start a talk tonight', avoid: 'Reactions to hold back', signals: 'Please keep an eye on',
    help: 'If you need help in Korea: Youth counselling 1388 · Suicide prevention 109 · Emergency or child abuse 112',
    basis: 'About this report',
    disclaimer: 'A reference written by AI (Claude), reading today\'s conversation through emotion coaching and social-emotional learning (CASEL). It is not a standardized psychological test or a medical diagnosis.',
  },
};

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function donut(emotions) {
  const r = 42;
  const c = 2 * Math.PI * r;
  let offset = 0;
  const arcs = emotions.map((e) => {
    const len = (e.percent / 100) * c;
    const arc = `<circle cx="60" cy="60" r="${r}" fill="none" stroke="${COLORS[e.key] || '#ccc'}" stroke-width="16"
      stroke-dasharray="${len.toFixed(2)} ${(c - len).toFixed(2)}" stroke-dashoffset="${(-offset).toFixed(2)}"
      transform="rotate(-90 60 60)" stroke-linecap="butt" />`;
    offset += len;
    return arc;
  }).join('');
  return `<svg class="rp-donut" viewBox="0 0 120 120" aria-hidden="true">${arcs}
    <circle cx="60" cy="60" r="30" fill="#fff"/><text x="60" y="67" text-anchor="middle" font-size="22">🙂</text></svg>`;
}

// Smooth curve through the child's turns (Catmull-Rom as cubic Béziers), with a soft area below.
// A single turn is drawn as a level line across, so the chart is not an empty box with one dot.
function curve(input) {
  const W = 300, H = 120, padX = 14, padY = 14;
  const single = input.length === 1;
  const points = single ? [input[0], input[0]] : input;
  const n = points.length;
  const xs = points.map((_, i) => padX + (i * (W - 2 * padX)) / (n - 1));
  const ys = points.map((p) => padY + ((100 - p.mood) / 100) * (H - 2 * padY));
  let d = `M${xs[0].toFixed(1)},${ys[0].toFixed(1)}`;
  for (let i = 0; i < n - 1; i++) {
    const x0 = xs[i - 1] ?? xs[i], y0 = ys[i - 1] ?? ys[i];
    const x3 = xs[i + 2] ?? xs[i + 1], y3 = ys[i + 2] ?? ys[i + 1];
    const c1x = xs[i] + (xs[i + 1] - x0) / 6, c1y = ys[i] + (ys[i + 1] - y0) / 6;
    const c2x = xs[i + 1] - (x3 - xs[i]) / 6, c2y = ys[i + 1] - (y3 - ys[i]) / 6;
    d += ` C${c1x.toFixed(1)},${c1y.toFixed(1)} ${c2x.toFixed(1)},${c2y.toFixed(1)} ${xs[i + 1].toFixed(1)},${ys[i + 1].toFixed(1)}`;
  }
  const area = `${d} L${xs[n - 1].toFixed(1)},${H} L${xs[0].toFixed(1)},${H} Z`;
  const marks = single ? [[W / 2, ys[0]]] : xs.map((x, i) => [x, ys[i]]);
  const dots = marks.map(([x, y]) => `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="4.5" fill="#F4867A" stroke="#fff" stroke-width="2"/>`).join('');
  const labels = marks.map(([x], i) => `<text x="${x.toFixed(1)}" y="${H + 16}" text-anchor="middle" font-size="11" fill="#9A8A80">${i + 1}</text>`).join('');
  return `<svg class="rp-curve" viewBox="0 0 ${W} ${H + 22}" aria-hidden="true">
    <defs><linearGradient id="rpArea" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#F4867A" stop-opacity=".28"/><stop offset="1" stop-color="#F4867A" stop-opacity="0"/></linearGradient></defs>
    <path d="${area}" fill="url(#rpArea)"/><path d="${d}" fill="none" stroke="#F4867A" stroke-width="3" stroke-linecap="round"/>
    ${dots}${labels}</svg>`;
}

export function renderReport(r, lang) {
  const t = TEXT[lang === 'en' ? 'en' : 'ko'];
  const main = r.emotions[0];
  const card = (title, body, right = '') =>
    `<section class="rp-card"><header class="rp-card__head"><h3>${title}</h3>${right}</header>${body}</section>`;
  const titled = (items) => items.map((s) => `<div class="rp-item"><b>${esc(s.title)}</b><p>${esc(s.detail)}</p></div>`).join('');

  const signals = r.signals.level === 'none' ? '' : `
    <section class="rp-signal rp-signal--${r.signals.level}">
      <h3>⚠️ ${t.signals}</h3>
      ${r.signals.notes.map((n) => `<p>· ${esc(n)}</p>`).join('')}
      <p class="rp-signal__help">${t.help}</p>
    </section>`;

  return `
  ${signals}
  ${card(t.weather, `
    <div class="rp-weather">
      <span class="rp-weather__icon">${WEATHER[r.weather.key] || '⛅'}</span>
      <span class="rp-weather__label"><small>${t.main}</small>${esc(r.weather.label)}</span>
      ${main ? `<span class="rp-weather__main"><b>${main.percent}%</b><small>${esc(main.label)}</small></span>` : ''}
    </div>
    <div class="rp-feelings">
      ${donut(r.emotions)}
      <ul>${r.emotions.map((e) => `<li><i style="background:${COLORS[e.key] || '#ccc'}"></i>${esc(e.label)}<b>${e.percent}%</b></li>`).join('')}</ul>
    </div>
    <p class="rp-text">${esc(r.weather.summary)}</p>`)}
  ${card(t.rhythm, `
    <div class="rp-score"><small>${t.stability}</small><b>${r.rhythm.stability}</b><span>/100</span></div>
    ${curve(r.rhythm.points)}
    <ol class="rp-notes">${r.rhythm.points.map((p) => `<li>${esc(p.note)}</li>`).join('')}</ol>`,
    r.rhythm.trend_label ? `<span class="rp-chip">↗ ${esc(r.rhythm.trend_label)}</span>` : '')}
  ${r.keywords.length ? card(t.keywords, `<div class="rp-tags">${r.keywords.map((k) => `<span>#${esc(k)}</span>`).join('')}</div>`) : ''}
  ${card(t.summary, `<p class="rp-text">${esc(r.summary)}</p>`)}
  ${r.strengths.length ? card(t.strengths, titled(r.strengths)) : ''}
  ${r.moments.length ? card(t.moments, r.moments.map((m) => `<div class="rp-item"><b class="rp-quote">“${esc(m.quote)}”</b><p>${esc(m.meaning)}</p></div>`).join('')) : ''}
  ${card(t.guide, `
    <h4>${t.tips}</h4>${titled(r.guide.tips)}
    ${r.guide.starters.length ? `<h4>${t.starters}</h4>${r.guide.starters.map((s) => `<p class="rp-say">“${esc(s)}”</p>`).join('')}` : ''}
    ${r.guide.avoid.length ? `<h4 class="rp-muted">${t.avoid}</h4>${r.guide.avoid.map((s) => `<p class="rp-text">· ${esc(s)}</p>`).join('')}` : ''}`)}
  <footer class="rp-foot"><b>${t.basis}</b><br>${esc(r.evidence_note)}<br>${t.disclaimer}</footer>`;
}
