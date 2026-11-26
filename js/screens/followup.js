// 帰宅後フォロー・過去の一覧

import { esc, md, mdw, norm, $$ } from '../util.js';
import { state, findPatient } from '../store.js';
import * as M from '../model.js';
import { header, chip, demo, codeText, patientCard, taskRow, labGrid, devicesBlock, sec, emptyState } from './common.js';

function dueChip(t) {
  if (!M.isOpen(t)) return '';
  const today = M.today();
  if (!t.dueDate) return '';
  if (t.dueDate < today) return chip(`期限切れ ${md(t.dueDate)}`, 'r', 'bold');
  if (t.dueDate === today) return chip('期限 今日', 'r', 'bold');
  return chip(`期限 ${mdw(t.dueDate)}`, 'a');
}

export const followupScreen = {
  render() {
    const list = state.patients
      .filter((p) => p.location === 'followup')
      .sort((a, b) => {
        const da = Math.min(...a.tasks.filter(M.isOpen).map((t) => Date.parse(t.dueDate || '9999-12-31')));
        const db = Math.min(...b.tasks.filter(M.isOpen).map((t) => Date.parse(t.dueDate || '9999-12-31')));
        return da - db;
      });
    const cards = list
      .map((p) => {
        const tasks = p.tasks
          .filter((t) => t.group === 'followup' || M.isOpen(t))
          .map((t) => {
            const s = M.stateInfo(t);
            return `<div class="trow" data-act="tapTask" data-lp="lpTask" data-pid="${p.id}" data-tid="${t.id}"><div class="tlabel">${esc(t.label)}</div><div class="tstate row-gap">${dueChip(t)}${chip(s.text, s.tone)}</div></div>`;
          })
          .join('');
        return `<div class="card">
          <div class="row-between"><div class="nameline"><span class="code">${esc(p.code)}</span><span class="muted">　${esc(p.nickname)}</span></div><button class="mini" data-act="revealId" data-pid="${p.id}">IDを表示</button></div>
          <div class="muted small">${esc(demo(p))} ・ ${md(p.homeDate)} 帰宅</div>
          <div class="tlist">${tasks}</div>
          <div class="grid2"><button class="btn2" data-act="addTask" data-pid="${p.id}">＋ タスク</button><button class="btn3" data-act="endFollow" data-pid="${p.id}">フォローを終える</button></div>
        </div>`;
      })
      .join('');
    return `${header(`帰宅後フォロー　${list.length}人`, 'メニュー')}
      ${cards || emptyState('帰宅後フォローの患者はいません')}
      <div class="muted small">タップで済に ・ 長押しで期限や名前を変えられます</div>
      <button class="btn2" data-act="idLookup">識別番号から ID を調べる</button>`;
  },
};

export const pastScreen = {
  render() {
    const list = state.patients
      .filter((p) => p.location === 'past')
      .sort((a, b) => ((a.endedAt || '') < (b.endedAt || '') ? 1 : -1));
    const rows = list
      .map((p) => {
        const label = M.endingLabel(p) || '';
        const key = norm(`${p.code} ${p.nickname} ${p.disease} ${p.endedAt} ${p.visitDate} ${p.admitDate || ''} ${label}`);
        return `<button class="lrow" data-act="openPatient" data-id="${p.id}" data-key="${esc(key)}">
          <div class="row-between"><div class="nameline"><span class="code">${esc(p.code)}</span><span class="muted">　${esc(p.nickname)}</span></div><div class="muted small">${md(p.endedAt)}</div></div>
          <div class="muted small">${esc(demo(p))}${label ? ` ・ ${esc(label)}` : ''}</div>
        </button>`;
      })
      .join('');
    return `${header(`過去の一覧　${list.length}人`, 'メニュー')}
      <input id="past-q" type="search" placeholder="識別番号・あだ名・病名・日付（例 2026-11）で探す" autocomplete="off">
      <div class="lrows" id="past-list">${rows || emptyState('過去の患者はいません')}</div>
      <button class="btn2" data-act="idLookup">識別番号から ID を調べる</button>`;
  },
  mount() {
    const q = document.getElementById('past-q');
    q.addEventListener('input', () => {
      const k = norm(q.value);
      for (const el of $$('#past-list [data-key]')) el.classList.toggle('hidden', !!k && !el.dataset.key.includes(k));
    });
  },
};

export const pastViewScreen = {
  render({ id }) {
    const p = findPatient(id);
    if (!p) return `${header('過去の患者', '過去の一覧')}${emptyState('見つかりません')}`;
    const period = p.admitDate ? `入院 ${md(p.admitDate)}〜${md(p.endedAt)}` : `${md(p.visitDate)} 来院`;
    const tasks = p.tasks.map((t) => taskRow(p, t, { readonly: true })).join('');
    const notes = (p.notes || []).slice().sort((a, b) => (a.date < b.date ? 1 : -1))
      .map((n) => `<div class="note"><span class="muted note-date">${md(n.date)}</span><span class="note-text">${esc(n.text)}</span></div>`).join('');
    const probs = (p.problems || []).map((x, i) => `<div class="prob">#${i + 1}　${esc(x)}</div>`).join('');
    return `${header('過去の患者', '過去の一覧')}
      ${patientCard(p, `${demo(p)} ・ ${period}`, { readonly: true })}
      ${M.endingLabel(p) ? `<div class="card"><span class="tag">${esc(M.endingLabel(p))}</span><span class="muted small">　${md(p.endedAt)} に終了 ・ ${esc(codeText(p))}</span></div>` : ''}
      ${probs ? `${sec('Problem List')}<div class="card plist">${probs}</div>` : ''}
      ${sec('検査値')}${labGrid(p)}
      ${(p.devices || []).length ? `${sec('デバイス')}<div class="card kvlist">${devicesBlock(p, { readonly: true })}</div>` : ''}
      ${notes ? `${sec('経過メモ')}<div class="notes">${notes}</div>` : ''}
      ${tasks ? `${sec('タスク')}<div class="tlist">${tasks}</div>` : ''}
      <button class="danger" data-act="deletePast" data-pid="${p.id}">この記録を削除</button>`;
  },
};
