// 薬と培養の決まりごと（画面に依存しない部分）

import { uuid, ymd, addDays, diffDays, md, norm } from './util.js';

// ---- 薬 ----
// flow: 流量を記録する（昇圧薬・鎮静薬）
export const MED_CATS = {
  abx: { label: '抗菌薬', color: '#1D9E75' },
  vaso: { label: '昇圧薬', color: '#D85A30', flow: true, unit: 'γ' },
  sed: { label: '鎮静薬', color: '#7F77DD', flow: true, unit: 'mg/h' },
  other: { label: 'その他', color: '#8E8E93' },
};
export const isFlow = (m) => !!(MED_CATS[m.cat] || {}).flow;

const DEFAULT_FAV_MEDS = [
  ['CTRX', 'abx'], ['CEZ', 'abx'], ['ABPC/SBT', 'abx'], ['TAZ/PIPC', 'abx'],
  ['MEPM', 'abx'], ['CFPM', 'abx'], ['VCM', 'abx'], ['LVFX', 'abx'],
  ['NAD', 'vaso', 'γ'], ['DOB', 'vaso', 'γ'], ['バソプレシン', 'vaso', '単位/h'],
  ['プロポフォール', 'sed', 'mg/h'], ['ミダゾラム', 'sed', 'mg/h'], ['デクスメデトミジン', 'sed', 'µg/h'], ['フェンタニル', 'sed', 'µg/h'],
];
export function defaultFavMeds() {
  return DEFAULT_FAV_MEDS.map(([name, cat, unit]) => ({ name, cat, unit: unit || '' }));
}
export const findFav = (favs, name) => (favs || []).find((f) => norm(f.name) === norm(name)) || null;

export function newMed({ name, cat = 'other', start = ymd(), planDays = null, unit = '', rate = null, rateAt = null }) {
  const m = { id: uuid(), name, cat, start, planDays: planDays ? Number(planDays) : null, end: null, unit: unit || '', rates: [] };
  if (isFlow(m) && rate !== null && rate !== '' && Number.isFinite(Number(rate))) m.rates.push({ at: rateAt || Date.now(), value: Number(rate) });
  return m;
}

// 数字をきれいに表示（0.150 → 0.15）
export const fmtNum = (v) => (v === null || v === undefined ? '' : String(Math.round(Number(v) * 1000) / 1000));

// その日に使っているか（終了日は「最後に使った日」）
export const medActiveOn = (m, day) => m.start <= day && (!m.end || m.end >= day);
export const medEnded = (m, day = ymd()) => !!m.end && m.end < day;

// 何日目か（開始日が1日目）
export function medDay(m, day = ymd()) {
  if (day < m.start) return 0;
  const last = m.end && m.end < day ? m.end : day;
  return diffDays(last, m.start) + 1;
}

export const medLastPlanned = (m) => (m.planDays ? addDays(m.start, m.planDays - 1) : null);

// 今の流量（時刻までの最後の記録）
export function curRate(m, at = Date.now()) {
  let r = null;
  for (const x of m.rates || []) if (x.at <= at) r = x;
  return r;
}

// 一覧などに出す短い説明
export function medStatus(m, day = ymd()) {
  if (medEnded(m, day)) return { text: `${md(m.start)}〜${md(m.end)}（${medDay(m, day)}日間）`, tone: 'g' };
  if (day < m.start) return { text: `${md(m.start)}から`, tone: 'g' };
  const k = medDay(m, day);
  if (isFlow(m)) {
    const r = curRate(m);
    return { text: `${r ? `${fmtNum(r.value)}${m.unit}` : '流量 未入力'} ・ ${k}日目`, tone: 'a' };
  }
  if (m.planDays) return { text: `${k}/${m.planDays}日目`, tone: k > m.planDays ? 'r' : k === m.planDays ? 'r' : 'a' };
  return { text: `継続中 ${k}日目`, tone: 'a' };
}

// 予定日数の最終日（または過ぎている）。今日のタスクと朝のまとめに出す
export function medFinal(m, day = ymd()) {
  if (!m.planDays || medEnded(m, day) || m.end) return null;
  const last = medLastPlanned(m);
  if (day < last) return null;
  return day === last ? 'final' : 'over';
}
export const medFinalLabel = (m, day = ymd()) => {
  const f = medFinal(m, day);
  if (!f) return '';
  return f === 'final' ? `${m.name} 最終日（${m.planDays}/${m.planDays}日目）` : `${m.name} 予定日数を過ぎています（${medDay(m, day)}/${m.planDays}日目）`;
};

// 終了にする（流量の薬は 0 を記録して線を止める）
export function endMed(m, date = ymd(), now = Date.now()) {
  m.end = date < m.start ? m.start : date;
  if (isFlow(m)) {
    const r = curRate(m, Infinity);
    if (r && r.value !== 0) {
      const endOfDay = new Date(`${m.end}T23:59:00`).getTime();
      m.rates.push({ at: Math.max(r.at + 60000, Math.min(now, endOfDay)), value: 0 });
    }
  }
}

export function reopenMed(m) {
  m.end = null;
  const rs = m.rates || [];
  if (rs.length && rs[rs.length - 1].value === 0) rs.pop();
}

// 帰宅・退院などで過去に移すとき、続いている薬をその日で終える
export function endOpenMeds(p, date = ymd(), now = Date.now()) {
  for (const m of p.meds || []) if (!m.end) endMed(m, date, now);
}

// 抗菌薬の通算：1日でも使わない日があれば数え直す。重なった日は1日
export function abxRun(p, day = ymd()) {
  const set = new Set();
  for (const m of p.meds || []) {
    if (m.cat !== 'abx' || m.start > day) continue;
    const last = m.end && m.end < day ? m.end : day;
    let d = m.start;
    for (let guard = 0; d <= last && guard < 2000; guard++) {
      set.add(d);
      d = addDays(d, 1);
    }
  }
  if (!set.size) return null;
  const lastDay = [...set].sort().pop();
  let n = 0;
  let d = lastDay;
  while (set.has(d)) { n++; d = addDays(d, -1); }
  return { days: n, start: addDays(lastDay, -(n - 1)), last: lastDay, active: lastDay === day };
}

export function abxText(p, day = ymd()) {
  const r = abxRun(p, day);
  if (!r) return '';
  return r.active ? `抗菌薬 通算${r.days}日目` : `抗菌薬 計${r.days}日（${md(r.start)}〜${md(r.last)}）`;
}

// ---- 培養 ----
export const SPECIMENS = ['血液', '尿', '痰', '便', '髄液', '胸水', '腹水', '膿・創部', 'カテ先', 'その他'];
export const CULTURE_DUE_DAYS = 3;
export const CULTURE_PRELIM_NEXT = 2;

export const CULTURE_STAGES = {
  submitted: { text: '提出済（結果待ち）', short: '結果待ち', tone: 'a' },
  prelim: { text: '途中報告あり（感受性待ち）', short: '途中報告', tone: 'a' },
  sens: { text: '感受性あり・確認待ち', short: '確認待ち', tone: 'a' },
  done: { text: '確認済', short: '確認済', tone: 'g' },
  negative: { text: '陰性', short: '陰性', tone: 'g' },
};

export function newCulture({ specimen, sets = null, submitted = ymd() }) {
  return {
    id: uuid(),
    specimen: specimen || 'その他',
    sets: specimen === '血液' ? Number(sets) || 2 : null,
    submitted,
    stage: 'submitted',
    due: addDays(submitted, CULTURE_DUE_DAYS),
    gram: '',
    organisms: [],
    positiveSets: null,
    prelimAt: null,
    sensAt: null,
    doneAt: null,
  };
}

export const cultureOpen = (c) => c.stage !== 'done' && c.stage !== 'negative';
export const openCultures = (p) => (p.cultures || []).filter(cultureOpen);
export const cultureDue = (c, day = ymd()) => cultureOpen(c) && !!c.due && c.due <= day;

export function cultureTitle(c) {
  const base = c.specimen === 'その他' ? '培養' : `${c.specimen}培養`;
  return c.sets ? `${base} ${c.sets}セット` : base;
}

export function setCultureStage(c, stage, day = ymd()) {
  c.stage = stage;
  if (stage === 'submitted') { const d3 = addDays(c.submitted, CULTURE_DUE_DAYS); c.due = d3 > day ? d3 : day; }
  if (stage === 'prelim') { c.prelimAt = c.prelimAt || day; c.due = addDays(day, CULTURE_PRELIM_NEXT); }
  if (stage === 'sens') { c.sensAt = day; c.prelimAt = c.prelimAt || day; c.due = day; }
  if (stage === 'done' || stage === 'negative') { c.doneAt = day; c.due = null; }
}

// 先送り（基本は明日）
export function deferCulture(c, toDate) {
  c.due = toDate;
}

export function cultureStatus(c, day = ymd()) {
  const s = CULTURE_STAGES[c.stage] || CULTURE_STAGES.submitted;
  if (cultureDue(c, day)) return { text: c.due < day ? `確認日を過ぎています（${md(c.due)}）` : '今日 確認', tone: 'r' };
  if (cultureOpen(c) && c.due) return { text: `${s.short} ・ 確認 ${md(c.due)}`, tone: s.tone };
  return { text: s.short, tone: s.tone };
}

// 耐性（R）の薬
export const resistant = (o) => (o.sens || []).filter((x) => x.sir === 'R').map((x) => x.drug);

export function cultureResultLine(c) {
  const parts = [];
  if (c.sets && c.positiveSets !== null && c.positiveSets !== undefined && c.positiveSets !== '') parts.push(`${c.positiveSets}/${c.sets}セット陽性`);
  if (c.gram) parts.push(`グラム：${c.gram}`);
  for (const o of c.organisms || []) {
    const r = resistant(o);
    parts.push(`${o.name}${r.length ? `（R：${r.join(', ')}）` : ''}`);
  }
  return parts.join(' ・ ');
}

// 今日のタスクに出す薬と培養
export function todayClinical(p, day = ymd()) {
  return {
    cultures: (p.cultures || []).filter((c) => cultureDue(c, day)),
    meds: (p.meds || []).filter((m) => medFinal(m, day)),
  };
}
export function clinicalCount(p, day = ymd()) {
  const t = todayClinical(p, day);
  return t.cultures.length + t.meds.length;
}

// ---- 培養の報告書を AI に読んでもらう ----
export const CULTURE_PROMPT = `この画像は電子カルテの細菌検査（培養）の報告です。
次の形式だけで書き出してください。説明は不要です。

MEDPILOT-CULTURE v1
検体|検体の種類（血液・尿・痰など）
グラム|グラム染色の結果（なければこの行は不要）
菌|番号|菌名|菌量
感受性|番号|薬剤名|MIC|判定

・菌が複数あれば、番号を 1、2… と分ける（感受性の行も同じ番号）
・判定は S・I・R のどれか（書いていなければ空欄）
・菌が出ていない（陰性・発育なし）ときは「菌|0|陰性|」と書く
・読めない文字は ? と書く`;

function normSir(s) {
  const t = String(s || '').normalize('NFKC').trim().toUpperCase();
  if (/^S|感/.test(t)) return 'S';
  if (/^R|耐/.test(t)) return 'R';
  if (/^I|中/.test(t)) return 'I';
  return '';
}

export function parseCultureText(text) {
  const out = { specimen: '', gram: '', organisms: [], negative: false, skipped: [] };
  const byNo = new Map();
  const org = (no) => {
    const k = String(no || '1');
    if (!byNo.has(k)) byNo.set(k, { no: k, name: '', amount: '', sens: [] });
    return byNo.get(k);
  };
  const grams = [];
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.normalize('NFKC').replace(/｜/g, '|').trim();
    if (!line || line.startsWith('```') || /MEDPILOT/i.test(line)) continue;
    if (!line.includes('|')) { out.skipped.push(raw); continue; }
    const parts = line.split('|').map((x) => x.trim());
    const key = parts[0];
    if (key === '検体') out.specimen = parts[1] || '';
    else if (/^グラム/.test(key)) { const g = parts.slice(1).filter(Boolean).join(' '); if (g) grams.push(g); }
    else if (key === '菌') {
      const no = parts[1] || '1';
      const name = parts[2] || '';
      if (no === '0' || /陰性|発育(なし|を認めず|せず)|検出(せず|されず)|no growth/i.test(name)) { out.negative = true; continue; }
      const o = org(no);
      o.name = name || o.name;
      o.amount = parts[3] || o.amount;
    } else if (key === '感受性') {
      if (!parts[2]) { out.skipped.push(raw); continue; }
      org(parts[1]).sens.push({ drug: parts[2], mic: parts[3] || '', sir: normSir(parts[4]) });
    } else out.skipped.push(raw);
  }
  out.gram = grams.join('／');
  out.organisms = [...byNo.values()]
    .filter((o) => o.name || o.sens.length)
    .map((o) => ({ ...o, name: o.name || '?' }))
    .sort((a, b) => (Number(a.no) || 0) - (Number(b.no) || 0));
  if (out.organisms.length) out.negative = false;
  return out;
}
