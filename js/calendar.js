// 何日でも選べるカレンダー（今日から4週間。選んである日がもっと先なら、そこまで広げる）

import { md, addDays, parseYmd, diffDays, dayKey, $, $$ } from './util.js';

const WD = ['日', '月', '火', '水', '木', '金', '土'];

export function calSummaryText(dates) {
  return dates.length ? `選んだ日：${dates.length}日（${dates.map(md).join('・')}）` : 'まだ選んでいません';
}

export function calendarHtml(selected = [], { from = dayKey(), days = 28 } = {}) {
  const sel = new Set(selected.filter((d) => d >= from));
  const last = [...sel].sort().pop();
  const span = last ? Math.max(days, diffDays(last, from) + 1) : days;
  const start = parseYmd(from);
  const cells = WD.map((w, i) => `<span class="cal-head ${i === 0 ? 'sun' : i === 6 ? 'sat' : ''}">${w}</span>`);
  for (let i = 0; i < start.getDay(); i++) cells.push('<span class="cal-pad"></span>');
  for (let i = 0; i < span; i++) {
    const d = addDays(from, i);
    const dt = parseYmd(d);
    const dow = dt.getDay();
    const label = i === 0 || dt.getDate() === 1 ? `${dt.getMonth() + 1}/${dt.getDate()}` : String(dt.getDate());
    const cls = ['cal-day', sel.has(d) ? 'on' : '', dow === 0 ? 'sun' : dow === 6 ? 'sat' : '', i === 0 ? 'today' : ''].filter(Boolean).join(' ');
    cells.push(`<button type="button" class="${cls}" data-act="calDay" data-d="${d}" aria-label="${md(d)}（${WD[dow]}）${i === 0 ? ' 今日' : ''}">${label}</button>`);
  }
  return `<div class="cal"><div class="cal-grid">${cells.join('')}</div><div class="muted small" id="cal-sum">${calSummaryText([...sel].sort())}</div></div>`;
}

export const calSelected = () => $$('.cal-day.on').map((b) => b.dataset.d).sort();

export function toggleCalDay(el) {
  el.classList.toggle('on');
  const s = $('#cal-sum');
  if (s) s.textContent = calSummaryText(calSelected());
}
