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

// 病院の AI に登録するテンプレート（電カルの検査結果の文を貼って使う）
export function labPrompt(items) {
  const names = (items && items.length ? [...items].sort((a, b) => a.order - b.order).map((it) => it.abbr) : DEFAULT_ITEMS.map((r) => r[0])).join(' ');
  return `この文のあとに貼る血液検査の結果を、決まった形に書き出してください。
答えは、医師が文字のままコピーして、アプリに取り込みます。形が少しでも違うと正しく取り込めないので、下の決まりを必ず守ってください。あいさつや説明は書かないでください。

■ 答えの形
【MedPilot 検査】
日付 年/月/日 年/月/日 …
項目名 値 値 …
【おわり】

■ 決まり
1. 1行目は【MedPilot 検査】、最後の行は【おわり】にする。
2. 2行目は「日付」のあとに、検査した日を古い順に空白で区切って並べる。日付は 2026/11/24 の形（年も書く）。
3. 日付が6日分以上あるときは、新しい5日分だけにする。同じ日に2回あるときは、あとの結果だけにする。
4. そのあと1項目1行。項目名のあとに、日付と同じ順で値を空白で区切って並べる。
5. その日に値がないときは - と書いて、値の数を日付の数とそろえる。
6. H・L の印は、値のすぐ後ろに空白なしで付ける（例：12.3H）。印がなければ付けない。
7. 値はカルテのとおりに写す。単位は書かない。単位の変換もしない。読めない値は ? と書く。
8. 項目名の中に空白を入れない。できるだけ次の書き方にそろえる：
${names}
この中にない項目は、カルテの書き方のまま。
9. 表・太字・箇条書きは使わない。患者さんの名前・ID は書かない。
10. 下の「例：」で始まる行は書き方の見本。答えには「例：」を書かない。
11. 書き終えたら、カルテと見比べて、数字の写し間違いがないか確かめてから答える。

例：日付 2026/11/24 2026/11/25 2026/11/26
例：WBC 12.3H 10.1H 8.2
例：CRP 15.20H - 8.10H

ここから検査結果：
`;
}

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
  const old = parseLabPipe(text, today);
  if (old.rows.length) return old;
  const nw = parseLabSpace(text, today);
  return nw.rows.length ? nw : old;
}

// 前の形（「日付|項目名|値|H/L」）
function parseLabPipe(text, today) {
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

// 病院の AI の形（「日付 2026/11/24 …」の行と「WBC 12.3H 10.1H」の行）。iPhone の文字読み取りの読み間違いも直す
const DASH = /^[-‐‑‒–—―−ー一－~〜]+$/;
function splitDates(s, today) {
  const out = [];
  const re = /(?:(\d{4})\s*[/\-.年]\s*)?(\d{1,2})\s*[/\-.月]\s*(\d{1,2})(?!\d)\s*日?/g;
  let m;
  while ((m = re.exec(s))) {
    const d = normDate(m[1] ? `${m[1]}/${m[2]}/${m[3]}` : `${m[2]}/${m[3]}`, today);
    if (d) out.push(d > today && !m[1] ? `${Number(d.slice(0, 4)) - 1}${d.slice(4)}` : d);
  }
  return out;
}
function parseLabSpace(text, today) {
  const rows = [];
  const skipped = [];
  const lines = String(text).split(/\r?\n/).map((x) => x.normalize('NFKC').replace(/\*\*/g, '').trim()).filter(Boolean);
  const isStart = (l) => /^[【[]?(med.{0,6})?検査[】\]]?$/i.test(l.replace(/\s/g, ''));
  const isEnd = (l) => /^[【[]?(お|終)わ[りリ][】\]]?$/.test(l.replace(/\s/g, ''));
  const hasStart = lines.some(isStart);
  let on = !hasStart;
  let dates = [];
  for (const raw of lines) {
    if (isStart(raw)) { on = true; dates = []; continue; }
    if (isEnd(raw)) { on = false; continue; }
    if (!on || /^例\s*[:：)）]/.test(raw)) continue;
    const line = raw.replace(/(?<=\d)[Oo](?=[\d./HL\s]|$)|(?<=[\d./\s])[Oo](?=\d)/g, '0');
    if (/^日付/.test(line)) { dates = splitDates(line.replace(/^日付\s*[:：]?/, ''), today); continue; }
    if (!dates.length) { skipped.push(raw); continue; }
    // 「12.3 H」のように離れた印をくっつける
    const tk = [];
    for (const t of line.split(/\s+/)) {
      if (/^[HL]$/i.test(t) && tk.length && /\d$/.test(tk[tk.length - 1])) tk[tk.length - 1] += t.toUpperCase();
      else tk.push(DASH.test(t) ? '-' : t);
    }
    if (tk.length < dates.length + 1) { skipped.push(raw); continue; }
    const vals = tk.slice(-dates.length);
    let name = tk.slice(0, tk.length - dates.length).join('');
    name = name.replace(/^[yY](?=-?GT)/, 'γ');
    vals.forEach((v, i) => {
      if (v === '-' || v === '?' || v === '？') return;
      const m = v.match(/^([<>≦≧≤≥]?[-+]?[\d.,]+)([HL])?$/i);
      rows.push({ date: dates[i], name, value: m ? m[1] : v, flag: m && m[2] ? m[2].toUpperCase() : '' });
    });
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
