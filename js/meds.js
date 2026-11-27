// 薬と培養の決まりごと（画面に依存しない部分）

import { uuid, ymd, addDays, diffDays, md, norm } from './util.js';

// ---- 薬 ----
// flow: 流量（mL/h）を記録する（昇圧薬・鎮静薬・持続薬）
export const MED_CATS = {
  abx: { label: '抗菌薬', color: '#1D9E75' },
  vaso: { label: '昇圧薬', color: '#D85A30', flow: true, unit: 'γ' },
  sed: { label: '鎮静薬', color: '#7F77DD', flow: true, unit: 'mg/h' },
  drip: { label: '持続薬', color: '#378ADD', flow: true, unit: 'mg/h' },
  other: { label: 'その他', color: '#8E8E93' },
};
export const isFlow = (m) => !!(MED_CATS[m.cat] || {}).flow;

// よく使う薬。流量の薬は組成（薬の量／全量 mL）と表示の単位を持つ（ユーザーの病院の組成）
// [名前, 種類, 表示の単位, 薬の量, 量の単位, 全量 mL, 1日量も出す]
const DEFAULT_FAV_MEDS = [
  ['CTRX', 'abx'], ['CEZ', 'abx'], ['ABPC/SBT', 'abx'], ['TAZ/PIPC', 'abx'],
  ['MEPM', 'abx'], ['CFPM', 'abx'], ['VCM', 'abx'], ['LVFX', 'abx'],
  ['NAD', 'vaso', 'γ', 5, 'mg', 50],
  ['DOB', 'vaso', 'γ', 150, 'mg', 50],
  ['バソプレシン', 'vaso', '単位/h', 1, '単位', 1],
  ['プロポフォール', 'sed', 'mg/h', 400, 'mg', 40],
  ['ミダゾラム', 'sed', 'mg/h', 50, 'mg', 50],
  ['デクスメデトミジン', 'sed', 'µg/h', 200, 'µg', 50],
  ['フェンタニル', 'sed', 'µg/h', 0.5, 'mg', 10],
  ['ニカルジピン', 'drip', 'mg/h', 40, 'mg', 40],
  ['ヘパリン', 'drip', 'U/h', 10000, 'U', 50, true],
  ['インスリン', 'drip', 'U/h', 50, 'U', 50],
];
const favOf = ([name, cat, unit, amount, amountUnit, volume, perDay]) => {
  const f = { name, cat, unit: unit || '' };
  if (amount) Object.assign(f, { amount, amountUnit, volume });
  if (perDay) f.perDay = true;
  return f;
};
export function defaultFavMeds() {
  return DEFAULT_FAV_MEDS.map(favOf);
}
export const findFav = (favs, name) => (favs || []).find((f) => norm(f.name) === norm(name)) || null;

// 0.3.0 で保存したよく使う薬に、組成と新しい持続薬を足す（1回だけ）
export function upgradeFavMeds(favs) {
  let changed = false;
  for (const row of DEFAULT_FAV_MEDS) {
    const d = favOf(row);
    const f = findFav(favs, d.name);
    if (!f) {
      favs.push(d);
      changed = true;
    } else if (d.amount && !f.amount) {
      Object.assign(f, { amount: d.amount, amountUnit: d.amountUnit, volume: d.volume, unit: d.unit });
      if (d.perDay) f.perDay = true;
      changed = true;
    }
  }
  return changed;
}

// ---- 流量（mL/h）→ γ・mg/h などへの計算 ----
const baseOf = (u) => {
  const t = String(u || '').normalize('NFKC').replace(/μ/g, 'µ');
  if (t === 'γ' || /^(µg|ug|mcg)/i.test(t)) return 'µg';
  if (/^mg/i.test(t)) return 'mg';
  if (/^(U|単位|IU)/i.test(t)) return 'U';
  return null;
};

// 1mL あたりの量（表示の単位にそろえる）。組成がなければ null
export function concPerMl(c, unit) {
  if (!c || !Number(c.amount) || !Number(c.volume)) return null;
  const to = baseOf(unit);
  const from = baseOf(c.amountUnit);
  if (!to || !from) return null;
  let a = Number(c.amount);
  if (from === 'mg' && to === 'µg') a *= 1000;
  else if (from === 'µg' && to === 'mg') a /= 1000;
  else if (from !== to) return null;
  return a / Number(c.volume);
}
export const isGamma = (m) => m.unit === 'γ';
export const hasConc = (m) => concPerMl(m.conc, m.unit) !== null;

// mL/h から量へ（γ は体重が必要。計算できなければ null）
export function doseFromMl(m, ml, weight) {
  const c = concPerMl(m.conc, m.unit);
  if (c === null || ml === null || ml === undefined || ml === '') return null;
  if (isGamma(m)) return Number(weight) > 0 ? (Number(ml) * c) / Number(weight) / 60 : null;
  return Number(ml) * c;
}
// 量から mL/h へ（逆の計算）
export function mlFromDose(m, dose, weight) {
  const c = concPerMl(m.conc, m.unit);
  if (!c || dose === null || dose === undefined || dose === '') return null;
  if (isGamma(m)) return Number(weight) > 0 ? (Number(dose) * Number(weight) * 60) / c : null;
  return Number(dose) / c;
}

const round = (v, d) => { const k = 10 ** d; return Math.round(Number(v) * k) / k; };
// γ は小数第2位まで、それ以外は小数第1位まで
export const fmtDose = (m, v) => String(round(v, isGamma(m) ? 2 : 1));
export function doseText(m, v) {
  if (v === null || v === undefined) return '';
  const t = `${fmtDose(m, v)}${m.unit}`;
  return m.perDay ? `${t}（${Math.round(Number(v) * 24)}${m.unit.replace('/h', '')}/日）` : t;
}

// 確かめるための計算式
export function formulaText(m, ml, weight) {
  const c = concPerMl(m.conc, m.unit);
  if (c === null || ml === '' || ml === null || !Number.isFinite(Number(ml))) return '';
  const base = isGamma(m) ? 'µg' : m.unit.replace('/h', '');
  const head = `${fmtNum(ml)}mL/h × ${fmtNum(c)}${base}/mL`;
  if (isGamma(m)) {
    if (!(Number(weight) > 0)) return `${head} ÷ 体重 ÷ 60（体重を入れると γ が出ます）`;
    return `${head} ÷ ${fmtNum(weight)}kg ÷ 60 ＝ ${fmtDose(m, doseFromMl(m, ml, weight))}γ`;
  }
  const v = doseFromMl(m, ml, weight);
  return `${head} ＝ ${fmtDose(m, v)}${m.unit}${m.perDay ? `（× 24 ＝ ${Math.round(v * 24)}${m.unit.replace('/h', '')}/日）` : ''}`;
}

export const concText = (m) => {
  if (!m.conc || !m.conc.amount) return '';
  const c = concPerMl(m.conc, m.unit);
  const base = isGamma(m) ? 'µg' : m.unit.replace('/h', '');
  return `${fmtNum(m.conc.amount)}${m.conc.amountUnit}／${fmtNum(m.conc.volume)}mL${c !== null ? `（${fmtNum(c)}${base}/mL）` : ''}`;
};

// 記録 1 件の量（新しい記録は mL/h、0.3.0 の記録は量そのもの）
export function rateDose(m, r, weight) {
  if (!r) return null;
  if (r.ml !== undefined) return doseFromMl(m, r.ml, weight);
  return r.value;
}
const rateZero = (r) => (r.ml !== undefined ? Number(r.ml) === 0 : Number(r.value) === 0);

export function newMed({ name, cat = 'other', start = ymd(), planDays = null, unit = '', conc = null, perDay = false, ml = null, rate = null, rateAt = null }) {
  const m = { id: uuid(), name, cat, start, planDays: planDays ? Number(planDays) : null, end: null, unit: unit || '', rates: [] };
  if (isFlow(m)) {
    if (conc && conc.amount) m.conc = { amount: Number(conc.amount), amountUnit: conc.amountUnit, volume: Number(conc.volume) };
    if (perDay) m.perDay = true;
    if (ml !== null && ml !== '' && Number.isFinite(Number(ml))) m.rates.push({ at: rateAt || Date.now(), ml: Number(ml) });
    else if (rate !== null && rate !== '' && Number.isFinite(Number(rate))) m.rates.push({ at: rateAt || Date.now(), value: Number(rate) });
  }
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

// 今の流量の説明（例：0.05γ と 3mL/h）
export function flowNow(m, weight, at = Date.now()) {
  const r = curRate(m, at);
  if (!r) return { dose: '流量 未入力', ml: '' };
  if (r.ml === undefined) return { dose: `${fmtNum(r.value)}${m.unit}`, ml: '' };
  const v = doseFromMl(m, r.ml, weight);
  const ml = `${fmtNum(r.ml)}mL/h`;
  if (v === null) return { dose: ml, ml: hasConc(m) && isGamma(m) ? '体重を入れると γ が出ます' : '', needWeight: hasConc(m) && isGamma(m) };
  return { dose: doseText(m, v), ml };
}

// 一覧などに出す短い説明（weight は γ の計算用）
export function medStatus(m, day = ymd(), weight = null) {
  if (medEnded(m, day)) return { text: `${md(m.start)}〜${md(m.end)}（${medDay(m, day)}日間）`, tone: 'g' };
  if (day < m.start) return { text: `${md(m.start)}から`, tone: 'g' };
  const k = medDay(m, day);
  if (isFlow(m)) {
    const f = flowNow(m, weight);
    return { text: `${f.dose}${f.ml && !f.needWeight ? `（${f.ml}）` : ''} ・ ${k}日目`, tone: 'a', flow: f, day: k };
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
    if (r && !rateZero(r)) {
      const endOfDay = new Date(`${m.end}T23:59:00`).getTime();
      const at = Math.max(r.at + 60000, Math.min(now, endOfDay));
      m.rates.push(r.ml !== undefined ? { at, ml: 0 } : { at, value: 0 });
    }
  }
}

export function reopenMed(m) {
  m.end = null;
  const rs = m.rates || [];
  if (rs.length && rateZero(rs[rs.length - 1])) rs.pop();
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

// ---- 培養の報告書を病院の AI に読んでもらう（テンプレート） ----
export const CULTURE_PROMPT = `この文のあとに貼る細菌検査（培養）の報告を、決まった形に書き出してください。
答えは、医師がスマホのカメラで画面の文字を読み取り、アプリに取り込みます。形が少しでも違うと正しく取り込めないので、下の決まりを必ず守ってください。あいさつや説明は書かないでください。

■ 答えの形
【MedPilot 培養】
検体：
グラム：
菌1：
感受性1：
【おわり】

■ 決まり
1. 1行目は【MedPilot 培養】、最後の行は【おわり】にする。
2. 検体は ${SPECIMENS.filter((s) => s !== 'その他').join('、')} のどれか（ほかは報告のとおり）。
3. グラム染色の結果があれば「グラム：」の行に書く（なければ行ごと書かない）。
4. 菌は「菌1：」「菌2：」と番号を付けて1行に1つ。菌量があれば、菌名のあとに「菌量 ◯」と書く。
5. 感受性は1つの薬を1行で「感受性1：薬の名前 MIC 判定」。番号は菌の番号と同じにする。判定は S、I、R のどれか（書いていなければ書かない）。
6. 菌が出ていない（陰性・発育なし）ときは「菌：陰性」とだけ書く。
7. 薬の名前・MIC は報告のとおり。名前の中に空白を入れない。読めない文字は ? と書く。
8. 表・太字・箇条書きは使わない。患者さんの名前・ID は書かない。
9. 下の「例：」で始まる行は書き方の見本。答えには「例：」を書かない。
10. 書き終えたら、報告と見比べて、写し間違い・書きもらしがないか確かめてから答える。

例：検体：血液
例：グラム：GNR
例：菌1：Escherichia coli 菌量 3+
例：感受性1：ABPC >16 R
例：感受性1：CEZ <=2 S

ここから報告：
`;

function normSir(s) {
  const t = String(s || '').normalize('NFKC').trim().toUpperCase();
  if (/^S|感/.test(t)) return 'S';
  if (/^R|耐/.test(t)) return 'R';
  if (/^I|中/.test(t)) return 'I';
  return '';
}

// 病院の AI の形（「菌1：…」「感受性1：ABPC >16 R」）を前の形の区切りにそろえる。
// iPhone の文字読み取りは S を 5、I を 1 や l と読むことがある
const ocrSir = (t) => (/^[S5$]$/i.test(t) ? 'S' : /^[I1l|]$/.test(t) ? 'I' : /^R$/i.test(t) ? 'R' : normSir(t));
function cultureParts(line) {
  let m;
  if ((m = line.match(/^検体\s*[:：]?\s*(.*)$/))) return ['検体', m[1].trim()];
  if ((m = line.match(/^グラム(?:染色)?\s*[:：]?\s*(.*)$/))) return ['グラム', m[1].trim()];
  if ((m = line.match(/^感受性\s*(\d*)\s*[:：]?\s*(.+)$/))) {
    const tk = m[2].trim().split(/\s+/);
    const drug = tk[0];
    if (!/[A-Za-z぀-ヿ一-鿿]/.test(drug)) return null;
    const rest = tk.slice(1);
    let mic = '';
    let sir = '';
    if (rest.length >= 2) { sir = ocrSir(rest[rest.length - 1]); mic = rest.slice(0, -1).join(' '); }
    else if (rest.length === 1) { if (/^[SIR]$/i.test(rest[0])) sir = rest[0].toUpperCase(); else mic = rest[0]; }
    return ['感受性', m[1] || '1', drug, mic, sir];
  }
  if ((m = line.match(/^菌\s*(\d*)\s*[:：]?\s*(.+)$/))) {
    const body = m[2].trim();
    const i = body.indexOf('菌量');
    const name = (i >= 0 ? body.slice(0, i) : body).trim();
    const amount = i >= 0 ? body.slice(i + 2).replace(/^\s*[:：]?\s*/, '').trim() : '';
    if (!/[A-Za-z぀-ヿ一-鿿]/.test(name)) return null;
    return ['菌', m[1] || '1', name, amount];
  }
  return null;
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
  const lines = String(text).split(/\r?\n/).map((x) => x.normalize('NFKC').replace(/｜/g, '|').replace(/\*\*/g, '').trim());
  const isStart = (l) => /^[【[]?med.{0,6}培養[】\]]?$/i.test(l.replace(/\s/g, ''));
  const isEnd = (l) => /^[【[]?(お|終)わ[りリ][】\]]?$/.test(l.replace(/\s/g, ''));
  let on = !lines.some(isStart);
  for (const line of lines) {
    if (isStart(line)) { on = true; continue; }
    if (isEnd(line)) { on = false; continue; }
    if (!on || !line || line.startsWith('```') || /MEDPILOT/i.test(line) || /^例\s*[:：)）]/.test(line)) continue;
    const parts = line.includes('|') ? line.split('|').map((x) => x.trim()) : cultureParts(line);
    if (!parts) { out.skipped.push(line); continue; }
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
      if (!parts[2]) { out.skipped.push(line); continue; }
      org(parts[1]).sens.push({ drug: parts[2], mic: parts[3] || '', sir: normSir(parts[4]) });
    } else out.skipped.push(line);
  }
  out.gram = grams.join('／');
  out.organisms = [...byNo.values()]
    .filter((o) => o.name || o.sens.length)
    .map((o) => ({ ...o, name: o.name || '?' }))
    .sort((a, b) => (Number(a.no) || 0) - (Number(b.no) || 0));
  if (out.organisms.length) out.negative = false;
  return out;
}
