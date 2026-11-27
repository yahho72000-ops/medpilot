// 申し送り：救急外来・入院患者のページに分けて、全員を縦に並べる（左右スワイプで切り替え）

import { esc } from '../util.js';
import { state, savePatient } from '../store.js';
import * as M from '../model.js';
import { render, current, back } from '../router.js';
import { header, emptyState, nick } from './common.js';
import { handoffItems } from '../handoff.js';
import * as ui from '../ui.js';
import { openPatient } from '../actions.js';

const TABS = [['er', '救急外来'], ['in', '入院患者']];

function listFor(tab) {
  if (tab === 'er') return M.sortEr(state.patients.filter((p) => p.location === 'er'));
  return M.sortInpatients(state.patients.filter((p) => p.location === 'inpatient'), state.meta.settings.inpatientSort || 'days');
}

const ul = (items) => `<ul class="ho-list">${items.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>`;

function card(p) {
  const h = handoffItems(p, state.meta.labItems);
  const who = [M.ageLabel(p.ageBand), M.SEX[p.sex]].filter(Boolean).join(' ');
  const when = p.location === 'inpatient' ? `入院${M.hospitalDay(p)}日目` : `${p.visitDate.slice(5).replace('-', '/')} 来院`;
  const sub = [who, when, `CODE ${M.CODE_STATUS[p.codeStatus] || '未確認'}`, p.ending ? M.endingLabel(p) : ''].filter(Boolean).join(' ・ ');
  const main = M.mainProblem(p);
  const secs = [
    ['今日したこと', h.done],
    ['介入', h.acts],
    ['申し送ること', h.todo],
  ].filter(([, a]) => a.length).map(([t, a]) => `<div class="ho-sec">${t}</div>${ul(a)}`).join('');
  return `<div class="card ho-card">
    <button class="ho-head" data-act="hoOpen" data-pid="${p.id}"><span class="code">${esc(p.code)}</span>${p.bed ? `　${esc(p.bed)}` : ''}　${nick(p)}<span class="muted small">　›</span></button>
    <div class="muted">${esc(sub)}</div>
    ${main ? `<div class="mainprob">${esc(main)}</div>` : ''}
    ${secs || '<div class="muted small">今日の記録・残りはありません</div>'}
    <div class="memo ${p.handoffMemo ? '' : 'memo-empty'}" data-act="editMemo" data-pid="${p.id}"><span class="muted small">申し送りメモ</span><div class="memo-text">${p.handoffMemo ? esc(p.handoffMemo) : '＋ 書く'}</div></div>
  </div>`;
}

export const handoffScreen = {
  render({ tab = 'er' }) {
    const lists = { er: listFor('er'), in: listFor('in') };
    const seg = `<div class="seg ptabs">${TABS.map(([k, l]) => `<button class="${k === tab ? 'on' : ''}" data-act="hoTab" data-v="${k}">${l} ${lists[k].length}人</button>`).join('')}</div>`;
    const list = lists[tab];
    return `${header('申し送り', 'メニュー')}
      ${seg}
      <div class="ppage ho">
        <div class="muted small">「今日」は朝6時から。名前をタップすると患者のページへ。</div>
        ${list.length ? list.map(card).join('') : emptyState(tab === 'er' ? '救急外来の患者はいません' : '入院患者はいません')}
        <div class="muted small center">左右にスワイプで${tab === 'er' ? '入院患者' : '救急外来'}へ</div>
        <button class="btn2" data-act="hoFinish">申し送りを終える</button>
      </div>`;
  },
  actions: {
    hoTab(ds) { switchTab(ds.v); },
    swipeNext() { switchTab('in'); },
    swipePrev() { switchTab('er'); },
    hoOpen(ds) {
      const p = state.patients.find((x) => x.id === ds.pid);
      if (p) openPatient(p);
    },
    async hoFinish() {
      const withMemo = state.patients.filter((p) => (p.location === 'er' || p.location === 'inpatient') && p.handoffMemo);
      if (withMemo.length) {
        const v = await ui.choose('申し送りを終えますか？', `申し送りメモが ${withMemo.length}人分あります。`, [
          { v: 'clear', label: 'メモを消して終える', tone: 'btn' },
          { v: 'keep', label: 'メモを残して終える', tone: 'btn2' },
        ]);
        if (!v) return;
        if (v === 'clear') for (const p of withMemo) { p.handoffMemo = ''; await savePatient(p); }
        ui.toast(v === 'clear' ? '申し送りメモを消しました' : '申し送りを終えました');
      } else {
        ui.toast('申し送りを終えました');
      }
      back();
    },
  },
};

function switchTab(tab) {
  const cur = current();
  const was = cur.params.tab || 'er';
  if (was === tab) return;
  cur.params.tab = tab;
  render();
  const el = document.querySelector('.ppage');
  if (el) el.classList.add(tab === 'in' ? 'from-right' : 'from-left');
}

