// 申し送り：患者ごとに「今日したこと」「介入」「申し送ること」を集める（画面に依存しない部分）
// 「今日」は朝6時から（dayKey と同じ区切り）

import { dayKey, md, mdw, addDays } from './util.js';
import * as M from './model.js';
import * as K from './meds.js';
import * as F from './nutrition.js';

export function dayStart(now = Date.now()) {
  return new Date(`${dayKey(new Date(now))}T06:00:00`).getTime();
}

const TASK_DONE = (t) => (t.steps === 3 ? '確認済' : '済');

function flowDose(m, r, weight) {
  if (!r) return '0';
  if (r.ml === undefined) return `${K.fmtNum(r.value)}${m.unit}`;
  const v = K.doseFromMl(m, r.ml, weight);
  return v === null ? `${K.fmtNum(r.ml)}mL/h` : K.doseText(m, v);
}

export function handoffItems(p, labItems = [], now = Date.now()) {
  const start = dayStart(now);
  const day = dayKey(new Date(now));
  const today = (ms) => ms && ms >= start && ms <= now;
  const done = [];
  const acts = [];
  const todo = [];

  // ---- 今日したこと ----
  let icTask = false;
  for (const t of p.tasks || []) {
    if (t.state === 'done' && today(t.doneAt)) {
      if (t.kind === 'ic') icTask = true;
      done.push(`${t.label} ${TASK_DONE(t)}`);
    }
  }
  if (!icTask && p.lastICDate === day) done.push('家族IC');
  const labsToday = (p.labs || []).filter((l) => (l.importedAt ? today(l.importedAt) : l.date === day));
  if (labsToday.length) {
    const byId = new Map(labItems.map((it) => [it.id, it]));
    const flagged = labsToday.filter((l) => l.flag).map((l) => `${(byId.get(l.itemId) || {}).abbr || '?'} ${l.value}${l.flag}`);
    const dates = [...new Set(labsToday.map((l) => md(l.date)))].join('・');
    done.push(flagged.length ? `検査値（${dates}）：${flagged.slice(0, 8).join('、')}${flagged.length > 8 ? ' ほか' : ''}` : `検査値（${dates}）を記録（H/L なし）`);
  }
  for (const c of p.cultures || []) {
    const title = K.cultureTitle(c);
    if (c.stage === 'negative' && c.doneAt === day) { done.push(`${title} 陰性`); continue; }
    if (c.sensAt === day) {
      const orgs = (c.organisms || []).map((o) => { const r = K.resistant(o); return `${o.name}${r.length ? `（R：${r.join(', ')}）` : ''}`; }).join('、');
      done.push(`${title} 感受性：${orgs || '—'}`);
    } else if (c.prelimAt === day) {
      done.push(`${title} 途中報告${c.gram ? `（${c.gram}）` : ''}${(c.organisms || []).length ? ` ${c.organisms.map((o) => o.name).join('、')}` : ''}`);
    }
    if (c.stage === 'done' && c.doneAt === day) done.push(`${title} 確認済`);
  }
  const it = F.intakeToday(p, day);
  if (it !== null) done.push(`食事 ${it}割 摂取`);
  for (const n of p.notes || []) {
    if (n.date === day) done.push(`メモ：${n.text.length > 40 ? `${n.text.slice(0, 40)}…` : n.text}`);
  }

  // ---- 介入 ----
  for (const m of p.meds || []) {
    const flow = K.isFlow(m);
    if (m.start === day) {
      const r0 = flow ? K.curRate(m, now) : null;
      acts.push(`${m.name} 開始${flow && r0 ? ` ${flowDose(m, r0, p.weight)}` : ''}`);
    } else if (flow && !(m.end && m.end < day)) {
      const changed = (m.rates || []).some((r) => today(r.at) && !(r.ml === 0 || r.value === 0));
      if (changed) {
        const before = K.curRate(m, start - 1);
        const after = K.curRate(m, now);
        if (after && !(after.ml === 0 || after.value === 0)) acts.push(`${m.name} ${flowDose(m, before, p.weight)} → ${flowDose(m, after, p.weight)}`);
      }
    }
    if (m.end === day) acts.push(`${m.name} 終了`);
  }
  for (const f of p.feeds || []) {
    const label = `${f.route === 'pn' ? '点滴の栄養' : '経腸栄養'} ${f.name}`;
    if (f.start === day) acts.push(`${label} 開始 ${F.changeText(f, F.feedAt(f, now))}`);
    else if ((f.changes || []).some((c) => today(c.at)) && f.end !== day) {
      acts.push(`${label} ${F.changeText(f, F.feedAt(f, start - 1))} → ${F.changeText(f, F.feedAt(f, now))}`);
    }
    if (f.end === day) acts.push(`${label} 終了`);
  }
  const oral = p.oral || [];
  for (let i = 0; i < oral.length; i++) {
    if (!today(oral[i].at)) continue;
    const prev = i > 0 ? F.oralText(oral[i - 1]) : '';
    const cur = F.oralText(oral[i]);
    acts.push(oral[i].npo ? '絶食 開始' : `食事 ${prev && !oral[i - 1].npo ? `${prev} → ` : prev ? '再開 ' : '開始 '}${cur}`);
  }
  for (const d of p.devices || []) {
    if (d.insertedDate === day) acts.push(`${d.type} 挿入`);
    if (d.removedDate === day) acts.push(`${d.type} 抜去`);
  }
  for (const c of p.cultures || []) if (c.submitted === day) acts.push(`${K.cultureTitle(c)} 提出`);

  // ---- 申し送ること ----
  for (const t of p.tasks || []) {
    if (!M.isOpen(t) || (t.dueDate && t.dueDate > day)) continue;
    todo.push(`${t.label}（${M.stateInfo(t).text}）${t.dueDate && t.dueDate < day ? ' 期限切れ' : ''}`);
  }
  if (p.location === 'inpatient') {
    const d = M.dailyGet(p);
    if (M.bloodOpen(d.blood)) todo.push(`今日の採血：${M.BLOOD[d.blood].text}`);
  }
  for (const m of p.meds || []) { const l = K.medFinalLabel(m, day); if (l) todo.push(l); }
  for (const c of K.openCultures(p)) {
    const s = K.CULTURE_STAGES[c.stage] || K.CULTURE_STAGES.submitted;
    todo.push(`${K.cultureTitle(c)} ${s.short}${c.due ? `（確認 ${c.due <= day ? '今日' : md(c.due)}）` : ''}`);
  }
  const limit = addDays(day, 3);
  for (const t of (p.tasks || []).filter((x) => M.isOpen(x) && x.dueDate && x.dueDate > day && x.dueDate <= limit).sort((a, b) => (a.dueDate < b.dueDate ? -1 : 1))) {
    todo.push(`${mdw(t.dueDate)} ${t.label}`);
  }
  if (M.icWarn(p)) todo.push(`家族IC ${M.icDays(p)}日前（7日超）`);
  for (const dv of M.activeDevices(p).filter(M.deviceWarn)) todo.push(`${dv.type} 留置${M.deviceDay(dv)}日目（14日超）`);

  return { done, acts, todo };
}

export const handoffCount = (patients) => patients.filter((p) => p.location === 'er' || p.location === 'inpatient').length;

