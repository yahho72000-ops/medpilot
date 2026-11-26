// 画面で共通に使う部品（見出し、チップ、患者カード、タスクの行など）

import { esc, mdw, md } from '../util.js';
import { state } from '../store.js';
import * as M from '../model.js';
import { latestValues } from '../labs.js';

export function header(title, backLabel, right = '') {
  const back = backLabel
    ? `<button class="back" data-act="back">‹ ${esc(backLabel)}</button>`
    : '<span class="back"></span>';
  return `<div class="hdr">${back}<div class="hdr-title">${esc(title)}</div><div class="hdr-right">${right}</div></div>`;
}

export const chip = (text, tone, cls = '') => `<span class="chip ${tone} ${cls}">${esc(text)}</span>`;

export function demo(p) {
  const who = [M.ageLabel(p.ageBand), M.SEX[p.sex]].filter(Boolean).join(' ');
  return [who, p.disease].filter(Boolean).join(' ・ ');
}

export function codeText(p) {
  return `CODE ${M.CODE_STATUS[p.codeStatus] || '未確認'}`;
}

export function codeBadge(p, clickable = true) {
  const tone = !p.codeStatus || p.codeStatus === 'unknown' ? 'a' : 'o';
  const attrs = clickable ? `data-act="editCode" data-pid="${p.id}"` : '';
  return `<button class="chip big ${tone}" ${attrs}>${esc(codeText(p))}</button>`;
}

export function nameLine(p) {
  return `<span class="code">${esc(p.code)}</span><span class="who">${p.bed ? `　${esc(p.bed)}` : ''}　${esc(p.nickname)}</span>`;
}

// 患者ページの一番上のカード
export function patientCard(p, subLine, { readonly = false } = {}) {
  const tools = readonly
    ? `<button class="mini" data-act="revealId" data-pid="${p.id}">ID</button>`
    : `<button class="mini" data-act="revealId" data-pid="${p.id}">ID</button><button class="mini" data-act="editPatient" data-pid="${p.id}">編集</button>`;
  return `<div class="card pcard">
    <div class="row-between"><div class="pcode">${esc(p.code)}</div>${codeBadge(p, !readonly)}</div>
    <div class="row-between"><div class="pname">${esc(p.nickname)}${p.bed ? `　<span class="muted">${esc(p.bed)}</span>` : ''}</div><div class="tools">${tools}</div></div>
    <div class="muted">${esc(subLine)}</div>
  </div>`;
}

function bars(t) {
  if (t.steps !== 3 || t.state === 'none') return '';
  const n = M.stepCount(t);
  const tone = t.state === 'done' ? 'g' : 'a';
  let s = '<div class="bars">';
  for (let i = 0; i < 3; i++) s += `<span class="bar ${i < n ? tone : ''}"></span>`;
  return s + '</div>';
}

export function taskRow(p, t, { readonly = false } = {}) {
  const s = M.stateInfo(t);
  const extra = t.kind === 'free' ? '<span class="muted small">　自分で追加</span>' : '';
  const due = t.dueDate ? `<span class="muted small">　${mdw(t.dueDate)}</span>` : '';
  const attrs = readonly ? '' : `data-act="tapTask" data-lp="lpTask" data-pid="${p.id}" data-tid="${t.id}"`;
  return `<div class="trow" ${attrs}><div class="tlabel">${esc(t.label)}${due}${extra}</div><div class="tstate">${chip(s.text, s.tone)}${bars(t)}</div></div>`;
}

export function taskChip(t) {
  return chip(`${M.shortLabel(t.label)} ${M.shortState(t)}`, M.stateInfo(t).tone);
}

export function remainChip(p) {
  const n = M.openCount(p);
  return n ? chip(`残り${n}`, M.remainTone(p), 'bold') : chip('完了', 'g');
}

export function labGrid(p) {
  const list = latestValues(p, state.meta.labItems);
  if (!list.length) return '<div class="muted small">まだ記録がありません</div>';
  const lastDate = list.reduce((m, x) => (x.last.date > m ? x.last.date : m), '');
  const cells = list
    .map(({ item, last, prev, arrow }) => {
      const tone = last.flag === 'H' ? 'hi' : last.flag === 'L' ? 'lo' : '';
      const old = last.date !== lastDate ? `<div class="muted tiny">${md(last.date)}</div>` : '';
      return `<button class="lcell" data-act="labHistory" data-pid="${p.id}" data-item="${item.id}">
        <div class="muted small">${esc(item.abbr)}</div>
        <div class="lval ${tone}">${esc(last.value)}<span class="lflag">${esc(last.flag)}</span></div>
        <div class="muted small">${prev ? `${arrow} 前回 ${esc(prev.value)}` : '　'}</div>${old}
      </button>`;
    })
    .join('');
  return `<div class="muted small right">${md(lastDate)} の値（タップで経過）</div><div class="lgrid">${cells}</div>`;
}

export function devicesBlock(p, { readonly = false } = {}) {
  const devs = (p.devices || []).slice().sort((a, b) => (a.removedDate ? 1 : 0) - (b.removedDate ? 1 : 0) || (a.insertedDate < b.insertedDate ? -1 : 1));
  const rows = devs
    .map((d) => {
      const day = M.deviceDay(d);
      if (d.removedDate) {
        return `<div class="kv muted" ${readonly ? '' : `data-lp="lpDevice" data-pid="${p.id}" data-did="${d.id}"`}><span>${esc(d.type)}</span><span>${md(d.insertedDate)}〜${md(d.removedDate)}（${day}日間）</span></div>`;
      }
      const warn = M.deviceWarn(d);
      return `<div class="kv" ${readonly ? '' : `data-lp="lpDevice" data-pid="${p.id}" data-did="${d.id}"`}><span>${esc(d.type)}</span><span>${warn ? chip(`留置${day}日目`, 'r', 'bold') : `<span class="muted">留置${day}日目</span>`}${readonly ? '' : `<button class="mini" data-act="removeDevice" data-pid="${p.id}" data-did="${d.id}">抜去</button>`}</span></div>`;
    })
    .join('');
  return rows || '<div class="muted small">なし</div>';
}

export const sec = (title, right = '') => `<div class="sec"><span>${esc(title)}</span>${right}</div>`;

export function emptyState(text) {
  return `<div class="empty">${esc(text)}</div>`;
}
