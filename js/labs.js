// 検査値：項目の初期値、AI への指示文、AI の答えの読み取り、最新値の計算

import { norm, uuid, ymd } from './util.js';

// 略称・単位・カルテでの呼び名（下書き。設定で直せる）
const DEFAULT_ITEMS = [
  ['WBC', '×10²/µL', '白血球数,白血球'],
  ['RBC', '×10⁴/µL', '赤血球数,赤血球'],
  ['Hb', 'g/dL', 'ヘモグロビン,血色素量,HGB'],
  ['Ht', '%', 'ヘマトクリット,HCT'],
  ['Plt', '×10⁴/µL', '血小板数,血小板,PLT'],
  ['Neut', '%', 'H-Neu,好中球,NEUT,NEUT%'],
  ['TP', 'g/dL', '総蛋白,総タンパク'],
  ['Alb', 'g/dL', 'アルブミン,ALB'],
  ['BUN', 'mg/dL', '尿素窒素,UN'],
  ['Cre', 'mg/dL', 'クレアチニン,CRE,Cr'],
  ['AST', 'U/L', 'GOT'],
  ['ALT', 'U/L', 'GPT'],
  ['LDH', 'U/L', 'LD'],
  ['ALP', 'U/L', ''],
  ['γGTP', 'U/L', 'γ-GT,γ-GTP,GGT'],
  ['T-Bil', 'mg/dL', '総ビリルビン,T-BIL,TB'],
  ['CK', 'U/L', 'CPK'],
  ['Na', 'mEq/L', ''],
  ['K', 'mEq/L', ''],
  ['Cl', 'mEq/L', ''],
  ['Ca', 'mg/dL', ''],
  ['IP', 'mg/dL', '無機リン,P'],
  ['Mg', 'mg/dL', ''],
  ['Glu', 'mg/dL', '血糖,グルコース,GLU,BS'],
  ['CRP', 'mg/dL', ''],
  ['PCT', 'ng/mL', 'プロカルシトニン'],
  ['PT-INR', '', 'INR'],
  ['APTT', '秒', ''],
  ['Fib', 'mg/dL', 'フィブリノーゲン,FIB'],
  ['D-dimer', 'µg/mL', 'Dダイマー,D-D'],
  ['BNP', 'pg/mL', ''],
];

export function defaultLabItems() {
  return DEFAULT_ITEMS.map(([abbr, unit, aliases], i) => ({
    id: uuid(),
    abbr,
    unit,
    aliases: aliases ? aliases.split(',') : [],
    order: i,
  }));
}

export const LAB_PROMPT = `この画像は電子カルテの血液検査の結果です。
次の形式だけで、表の値をすべて書き出してください。説明は不要です。

MEDPILOT-LAB v1
日付|項目名|値|H/L

・日付は列の見出しの日付（例：2026-10-09）
・項目名と値は画像のとおり（単位の変換はしない）
・H/L の印がなければ空欄
・読めない値は ? と書く`;

// ---- AI の答えを読む ----
function normDate(s, today = ymd()) {
  const t = String(s).normalize('NFKC').replace(/\s/g, '');
  let m = t.match(/^(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})日?$/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  m = t.match(/^(\d{1,2})[-/.月](\d{1,2})日?$/);
  if (m) return `${today.slice(0, 4)}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
  return null;
}

export function parseLabText(text, today = ymd()) {
  const rows = [];
  const skipped = [];
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.normalize('NFKC').replace(/｜/g, '|').trim();
    if (!line || line.startsWith('```') || /MEDPILOT/i.test(line)) continue;
    if (!line.includes('|')) { skipped.push(raw); continue; }
    const parts = line.split('|').map((x) => x.trim());
    if (parts[0] === '日付') continue;
    if (parts.length < 3) { skipped.push(raw); continue; }
    const date = normDate(parts[0], today);
    if (!date) { skipped.push(raw); continue; }
    let value = parts[2];
    let flag = (parts[3] || '').toUpperCase();
    const m = value.match(/^([-+]?[\d.,]+)\s*([HL])$/i);
    if (m) { value = m[1]; if (!flag) flag = m[2].toUpperCase(); }
    if (flag !== 'H' && flag !== 'L') flag = '';
    rows.push({ date, name: parts[1], value, flag });
  }
  return { rows, skipped };
}

export function matchItem(name, items) {
  const n = norm(name);
  return items.find((it) => norm(it.abbr) === n || it.aliases.some((a) => norm(a) === n)) || null;
}

// 読み取った行を日付ごとにまとめ、その日の何回目の採血かを決める
export function groupImport(rows, items, patient) {
  const byDate = new Map();
  for (const r of rows) {
    if (!byDate.has(r.date)) byDate.set(r.date, []);
    const item = matchItem(r.name, items);
    byDate.get(r.date).push({ ...r, itemId: item ? item.id : null });
  }
  return [...byDate.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([date, entries]) => {
      const draws = (patient.labs || []).filter((l) => l.date === date).map((l) => l.draw);
      return { date, draw: draws.length ? Math.max(...draws) + 1 : 1, entries };
    });
}

export const num = (v) => {
  const x = parseFloat(String(v).replace(/,/g, ''));
  return Number.isFinite(x) ? x : null;
};

const keyOf = (l) => `${l.date}#${String(l.draw).padStart(3, '0')}`;

// 項目ごとの最新値と前回値
export function latestValues(patient, items) {
  const labs = patient.labs || [];
  const out = [];
  for (const it of [...items].sort((a, b) => a.order - b.order)) {
    const list = labs.filter((l) => l.itemId === it.id).sort((a, b) => (keyOf(a) < keyOf(b) ? -1 : 1));
    if (!list.length) continue;
    const last = list[list.length - 1];
    const prev = list.length > 1 ? list[list.length - 2] : null;
    let arrow = '';
    if (prev) {
      const a = num(last.value);
      const b = num(prev.value);
      if (a !== null && b !== null) arrow = a > b ? '↑' : a < b ? '↓' : '→';
    }
    out.push({ item: it, last, prev, arrow });
  }
  return out;
}

export function historyOf(patient, itemId) {
  return (patient.labs || [])
    .filter((l) => l.itemId === itemId)
    .sort((a, b) => (keyOf(a) < keyOf(b) ? 1 : -1));
}

// ---- CCr（Cockcroft-Gault）----
// CCr ＝ (140 − 年齢) × 体重 ÷ (72 × Cre)、女性は × 0.85
// 年齢は年代しかないので、真ん中（80代→85歳）で計算し、両端（80歳・89歳）の幅も出す。Cre は値そのまま（切り上げない）
export function ccrFormula(age, weight, cre, sex) {
  return ((140 - age) * weight) / (72 * cre) * (sex === 'F' ? 0.85 : 1);
}

export function ccrOf(p, items) {
  const it = items.find((x) => x.abbr === 'Cre');
  if (!it) return null;
  const last = historyOf(p, it.id).find((l) => num(l.value) !== null);
  if (!last) return null; // Cre がなければ何も出さない
  const cre = num(last.value);
  const base = { cre: last.value, date: last.date };
  if (p.ageBand === '0') return null; // 10歳未満には出さない
  if (!p.ageBand) return { ...base, missing: '年代' };
  if (!p.sex) return { ...base, missing: '性別' };
  if (!(Number(p.weight) > 0)) return { ...base, missing: '体重' };
  if (!(cre > 0)) return null;
  const b = Number(p.ageBand);
  const [young, mid, old] = b >= 100 ? [100, 100, 100] : [b, b + 5, b + 9];
  const w = Number(p.weight);
  return {
    ...base,
    mid: Math.round(ccrFormula(mid, w, cre, p.sex)),
    lo: Math.round(ccrFormula(old, w, cre, p.sex)),
    hi: Math.round(ccrFormula(young, w, cre, p.sex)),
    age: mid,
    weight: w,
  };
}

export function ccrText(c) {
  if (!c) return '';
  if (c.missing) return `CCr：${c.missing}を入れると出ます`;
  return c.lo === c.hi ? `CCr 約${c.mid}mL/min` : `CCr 約${c.mid}（${c.lo}〜${c.hi}）mL/min`;
}
