// 画面で共通に使う部品（見出し、チップ、患者カード、タスクの行など）

import { esc, mdw, md } from '../util.js';
import { state } from '../store.js';
import * as M from '../model.js';
import { latestValues } from '../labs.js';
import { nutritionLine } from '../nutrition.js';

export function header(title, backLabel, right = '') {
  const back = backLabel
    ? `<button class="back" data-act="back">‹ ${esc(backLabel)}</button>`
    : '<span class="back"></span>';
  return `<div class="hdr">${back}<div class="hdr-title">${esc(title)}</div><div class="hdr-right">${right}</div></div>`;
}

export const chip = (text, tone, cls = '') => `<span class="chip ${tone} ${cls}">${esc(text)}</span>`;

export const nick = (p) => (p.nickname ? esc(p.nickname) : '<span class="muted">あだ名なし</span>');

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

// 入っていない項目（ID・あだ名・年代・性別）があるときの印
export function missingChip(p, clickable = false) {
  if (!M.missingInfo(p)) return '';
  return clickable
    ? `<button class="chip r bold" data-act="editPatient" data-pid="${p.id}">未入力</button>`
    : chip('未入力', 'r', 'bold');
}

// 患者ページの切り替え（TODO｜詳細）。左右スワイプでも切り替わる
export function pageTabs(page) {
  return `<div class="seg ptabs" role="tablist">${[[1, 'TODO'], [2, '詳細']].map(([n, l]) => `<button class="${page === n ? 'on' : ''}" role="tab" aria-selected="${page === n}" data-act="setPage" data-v="${n}">${l}</button>`).join('')}</div>`;
}

// 1枚目のプロフィール：年代・性別・入院日数（来院日）・体重・メインプロブレム・警告
export function profileCard(p) {
  const who = [M.ageLabel(p.ageBand), M.SEX[p.sex]].filter(Boolean).join(' ');
  const when = p.location === 'inpatient' ? `入院${M.hospitalDay(p)}日目（${md(p.admitDate)}〜）` : `${md(p.visitDate)} 来院`;
  const wt = p.weight ? `${p.weight}kg` : '';
  const line = [who, when, wt].filter(Boolean).join(' ・ ');
  const main = M.mainProblem(p);
  const warns = [];
  if (M.icWarn(p)) warns.push(chip(`家族IC ${M.icDays(p)}日前`, 'r', 'bold'));
  for (const dv of M.activeDevices(p).filter(M.deviceWarn)) warns.push(chip(`${dv.type} ${M.deviceDay(dv)}日目`, 'r', 'bold'));
  return `<div class="card pcard">
    <div class="row-between"><div class="row-gap"><span class="pcode">${esc(p.code)}</span>${missingChip(p, true)}</div>${codeBadge(p, true)}</div>
    <div class="row-between"><div class="pname">${nick(p)}${p.bed ? `　<span class="muted">${esc(p.bed)}</span>` : ''}</div><div class="tools"><button class="mini" data-act="revealId" data-pid="${p.id}">ID</button><button class="mini" data-act="editPatient" data-pid="${p.id}">編集</button></div></div>
    <div class="muted">${esc(line)}</div>
    ${main ? `<div class="mainprob">${esc(main)}</div>` : ''}
    ${nutritionLine(p) ? `<div class="small">栄養：${esc(nutritionLine(p))}</div>` : ''}
    ${warns.length ? `<div class="chips-row">${warns.join('')}</div>` : ''}
  </div>`;
}

// 2枚目の上に出す小さな見出し（だれのページか）
export function miniHead(p) {
  return `<div class="minihead"><span class="code">${esc(p.code)}</span><span class="muted">　${nick(p)}${p.bed ? `　${esc(p.bed)}` : ''}</span></div>`;
}

// 患者ページの一番上のカード
export function patientCard(p, subLine, { readonly = false } = {}) {
  const tools = readonly
    ? `<button class="mini" data-act="revealId" data-pid="${p.id}">ID</button>`
    : `<button class="mini" data-act="revealId" data-pid="${p.id}">ID</button><button class="mini" data-act="editPatient" data-pid="${p.id}">編集</button>`;
  return `<div class="card pcard">
    <div class="row-between"><div class="row-gap"><span class="pcode">${esc(p.code)}</span>${readonly ? '' : missingChip(p, true)}</div>${codeBadge(p, !readonly)}</div>
    <div class="row-between"><div class="pname">${p.nickname ? esc(p.nickname) : '<span class="muted">あだ名なし</span>'}${p.bed ? `　<span class="muted">${esc(p.bed)}</span>` : ''}</div><div class="tools">${tools}</div></div>
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

const clock = (ms) => { const d = new Date(ms); return `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`; };

export function taskRow(p, t, { readonly = false } = {}) {
  const s = M.stateInfo(t);
  const timer = !readonly && t.timer && t.timer.at > Date.now() && M.isOpen(t) ? `<span class="timer small">　通知 ${clock(t.timer.at)}</span>` : '';
  const extra = (t.kind === 'free' ? '<span class="muted small">　自分で追加</span>' : '') + timer;
  const due = t.dueDate ? `<span class="muted small">　${mdw(t.dueDate)}</span>` : '';
  const attrs = readonly ? '' : `data-act="tapTask" data-pid="${p.id}" data-tid="${t.id}"`;
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
        return `<div class="kv muted" ${readonly ? '' : `data-act="lpDevice" data-pid="${p.id}" data-did="${d.id}"`}><span>${esc(d.type)}</span><span>${md(d.insertedDate)}〜${md(d.removedDate)}（${day}日間）</span></div>`;
      }
      const warn = M.deviceWarn(d);
      return `<div class="kv" ${readonly ? '' : `data-act="lpDevice" data-pid="${p.id}" data-did="${d.id}"`}><span>${esc(d.type)}</span><span>${warn ? chip(`留置${day}日目`, 'r', 'bold') : `<span class="muted">留置${day}日目</span>`}${readonly ? '' : `<button class="mini" data-act="removeDevice" data-pid="${p.id}" data-did="${d.id}">抜去</button>`}</span></div>`;
    })
    .join('');
  return rows || '<div class="muted small">なし</div>';
}

export const sec = (title, right = '') => `<div class="sec"><span>${esc(title)}</span>${right}</div>`;

export function emptyState(text) {
  return `<div class="empty">${esc(text)}</div>`;
}
