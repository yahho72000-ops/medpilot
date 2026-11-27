// 一覧の「残りTODO」ページ（入院患者・救急外来それぞれ）。患者ごとに、今やることだけを並べる
// 項目をタップすると、患者ページと同じ選択肢がその場で出る。全部終わったら「おつかれさま！」

import { esc } from '../util.js';
import * as M from '../model.js';
import { render, current } from '../router.js';
import { chip, nick } from './common.js';

export function listTabs(view, n) {
  const todo = view === 'todo';
  return `<div class="seg ptabs" role="tablist">
    <button class="${todo ? '' : 'on'}" role="tab" aria-selected="${!todo}" data-act="listView" data-v="list">患者</button>
    <button class="${todo ? 'on' : ''}" role="tab" aria-selected="${todo}" data-act="listView" data-v="todo">残りTODO ${n}</button>
  </div>`;
}

const ACT = {
  task: (it) => `data-act="tapTask" data-tid="${it.id}"`,
  daily: (it) => `data-act="tapDaily" data-f="${it.f}"`,
  culture: (it) => `data-act="tapCulture" data-cid="${it.id}"`,
  med: (it) => `data-act="tapMed" data-mid="${it.id}"`,
  ic: () => 'data-act="todoIc"',
  device: (it) => `data-act="todoDevice" data-did="${it.id}"`,
};

function itemRow(p, it) {
  return `<div class="trow" ${ACT[it.type](it)} data-pid="${p.id}"><div class="tlabel">${esc(it.label)}${it.sub ? `<span class="muted small">　${esc(it.sub)}</span>` : ''}</div><div class="tstate">${chip(it.state, it.tone)}</div></div>`;
}

export function todoView(list, sub = (p) => '') {
  const cards = list.map((p) => ({ p, items: M.remainingItems(p) })).filter((x) => x.items.length);
  if (!cards.length) {
    return `<div class="card done-card"><div class="done-title">おつかれさま！</div><div class="muted">残りの TODO はありません。</div></div>`;
  }
  return `${cards.map(({ p, items }) => `<div class="card todo-card">
      <button class="todo-head" data-act="openPatient" data-id="${p.id}"><span class="code">${esc(p.code)}</span><span class="muted">${p.bed ? `　${esc(p.bed)}` : ''}　${nick(p)}</span><span class="muted small todo-sub">${esc(sub(p))}　›</span></button>
      <div class="tlist">${items.map((it) => itemRow(p, it)).join('')}</div>
    </div>`).join('')}
    <div class="muted small center">結果待ち（オーダー済）と明日以降の予定は出しません</div>`;
}

// 「患者」と「残りTODO」を切り替える（右から／左から少し動かす）
export function switchView(v) {
  const cur = current();
  const was = cur.params.view === 'todo' ? 'todo' : 'list';
  if (was === v) return;
  cur.params.view = v;
  render();
  const el = document.querySelector('.ppage');
  if (el) el.classList.add(v === 'todo' ? 'from-right' : 'from-left');
}

export const viewActions = {
  listView(ds) { switchView(ds.v); },
  swipeNext() { switchView('todo'); },
  swipePrev() { switchView('list'); },
};
