// 栄養の決まりごと：経腸栄養・点滴の栄養（kcal とタンパク質の計算）、経口摂取・絶食、摂取量（◯割）

import { uuid, ymd, md, diffDays, dayKey, norm } from './util.js';

export const ROUTES = {
  en: { label: '経腸栄養', unit: 'パック', color: '#BA7517' },
  pn: { label: '点滴の栄養', unit: '袋', color: '#993556' },
};

// よく使う栄養（1パック・1袋あたり）。タンパク質は確かめた値だけ入れる（ほかは設定で入れる）
// [名前, 種類, 量 mL, kcal, タンパク質 g（点滴はアミノ酸 g）]
const DEFAULT_FEEDS = [
  ['ペプチーノ', 'en', 200, 200, null],
  ['ペプタメン プレビオ', 'en', 200, 300, null],
  ['アイソカル サポート Bag', 'en', 267, 400, null],
  ['ペプタメン AF', 'en', 200, 300, 19.0], // パッケージの表示
  ['MA-R2.0', 'en', 250, 500, null],
  ['ビーフリード', 'pn', 500, 210, 15.0], // 添付文書：総熱量 210kcal・総遊離アミノ酸量 15.00g
];
export function defaultFavFeeds() {
  return DEFAULT_FEEDS.map(([name, route, packMl, packKcal, protein]) => ({ name, route, packMl, packKcal, protein }));
}
export const findFeedFav = (favs, name) => (favs || []).find((f) => norm(f.name) === norm(name)) || null;

export const DEFAULT_DIET_FORMS = ['嚥下食1', '嚥下食2', '嚥下食3', '嚥下食4', '軟食', '三分粥', '五分粥', '普通食'];
export const DEFAULT_DIET_TYPES = ['糖尿病食', '肝臓食', '腎臓食', '減塩食'];

const r1 = (v) => Math.round(Number(v) * 10) / 10;
const n0 = (v) => String(Math.round(Number(v)));

// ---- 経腸栄養・点滴の栄養 ----
// mode: 'cont'（持続 mL/h）／ 'bolus'（単回：パック数 × 回数/日）
export function newFeed({ route = 'en', name, packMl, packKcal, protein = null, mode = 'cont', start = ymd(), at = Date.now(), ml = null, packs = null, times = null }) {
  const f = { id: uuid(), route, name, packMl: Number(packMl), packKcal: Number(packKcal), protein: protein === null || protein === '' ? null : Number(protein), mode, start, end: null, changes: [] };
  if (mode === 'cont' && ml !== null && ml !== '') f.changes.push({ at, ml: Number(ml) });
  if (mode === 'bolus' && packs !== null && times !== null) f.changes.push({ at, packs: Number(packs), times: Number(times) });
  return f;
}

export const kcalPerMl = (f) => (f.packMl ? f.packKcal / f.packMl : 0);

export function feedAt(f, at = Date.now()) {
  let c = null;
  for (const x of f.changes || []) if (x.at <= at) c = x;
  return c;
}
const zero = (f, c) => !c || (f.mode === 'cont' ? !(Number(c.ml) > 0) : !(Number(c.packs) > 0 && Number(c.times) > 0));

// 1日あたり（持続は24時間で計算）
export function kcalDay(f, c) {
  if (zero(f, c)) return 0;
  return f.mode === 'cont' ? Number(c.ml) * 24 * kcalPerMl(f) : Number(c.packs) * Number(c.times) * f.packKcal;
}
export function proteinDay(f, c) {
  if (f.protein === null || f.protein === undefined) return null;
  if (zero(f, c)) return 0;
  return f.mode === 'cont' ? (Number(c.ml) * 24 * f.protein) / f.packMl : Number(c.packs) * Number(c.times) * f.protein;
}

export function changeText(f, c) {
  if (!c) return '未入力';
  if (f.mode === 'cont') return `${r1(c.ml)}mL/h`;
  return `${r1(c.packs)}${ROUTES[f.route].unit} × ${n0(c.times)}回`;
}

export const feedEnded = (f, day = ymd()) => !!f.end && f.end < day;
export const feedActive = (f, day = ymd()) => f.start <= day && !feedEnded(f, day);

export function feedStatus(f, day = ymd()) {
  if (feedEnded(f, day)) return { main: `${md(f.start)}〜${md(f.end)}`, sub: '終了', ended: true };
  const c = feedAt(f);
  return { main: changeText(f, c), sub: `${n0(kcalDay(f, c))}kcal/日` };
}

export function feedSpec(f) {
  return `${r1(kcalPerMl(f))}kcal/mL ・ ${f.mode === 'cont' ? '持続' : '単回'}`;
}

export function endFeed(f, date = ymd(), now = Date.now()) {
  f.end = date < f.start ? f.start : date;
  const c = feedAt(f, Infinity);
  if (c && !zero(f, c)) {
    const endOfDay = new Date(`${f.end}T23:59:00`).getTime();
    const at = Math.max(c.at + 60000, Math.min(now, endOfDay));
    f.changes.push(f.mode === 'cont' ? { at, ml: 0 } : { at, packs: 0, times: 0 });
  }
}
export function reopenFeed(f) {
  f.end = null;
  const cs = f.changes || [];
  if (cs.length && zero(f, cs[cs.length - 1])) cs.pop();
}
export function endOpenFeeds(p, date = ymd(), now = Date.now()) {
  for (const f of p.feeds || []) if (!f.end) endFeed(f, date, now);
}

// 合計（今使っているもの）。タンパク質は、全部に値があるときだけ出す
export function totals(p, day = ymd(), at = Date.now()) {
  const act = (p.feeds || []).filter((f) => feedActive(f, day));
  let kcal = 0;
  let protein = 0;
  let proteinKnown = true;
  for (const f of act) {
    const c = feedAt(f, at);
    kcal += kcalDay(f, c);
    const pr = proteinDay(f, c);
    if (pr === null) proteinKnown = false; else protein += pr;
  }
  const w = Number(p.weight) > 0 ? Number(p.weight) : null;
  return {
    any: act.length > 0,
    kcal,
    kcalPerKg: w ? kcal / w : null,
    protein: proteinKnown ? protein : null,
    proteinPerKg: proteinKnown && w ? protein / w : null,
  };
}

export function totalsText(t) {
  if (!t.any) return '';
  const parts = [`合計 ${n0(t.kcal)}kcal/日${t.kcalPerKg !== null ? `（${r1(t.kcalPerKg)}kcal/kg）` : ''}`];
  if (t.protein !== null) parts.push(`タンパク質 ${r1(t.protein)}g/日${t.proteinPerKg !== null ? `（${r1(t.proteinPerKg)}g/kg）` : ''}`);
  return parts.join(' ・ ');
}

// ---- 経口摂取・絶食 ----
// p.oral = [{ at, npo, form, diet }]（新しいものが最後）
export const oralNow = (p) => { const o = p.oral || []; return o.length ? o[o.length - 1] : null; };
export function oralText(o) {
  if (!o) return '';
  if (o.npo) return '絶食';
  return [o.form, o.diet].filter(Boolean).join(' ・ ') || '経口';
}

// 絶食◯日目（絶食が続いている最初の日を1日目）
export function npoDay(p, day = ymd()) {
  const o = p.oral || [];
  if (!o.length || !o[o.length - 1].npo) return null;
  let i = o.length - 1;
  while (i > 0 && o[i - 1].npo) i--;
  return diffDays(day, ymd(new Date(o[i].at))) + 1;
}

// 摂取量（◯割）。p.intake = { 'YYYY-MM-DD'（6時で切り替わる日）: 0〜10 }
export const intakeToday = (p, key = dayKey()) => (p.intake && p.intake[key] !== undefined ? p.intake[key] : null);
export function setIntake(p, v, key = dayKey()) {
  p.intake = p.intake || {};
  if (v === null) delete p.intake[key]; else p.intake[key] = v;
  const keys = Object.keys(p.intake).sort();
  while (keys.length > 30) delete p.intake[keys.shift()];
}

// 1枚目のプロフィールに出す1行
export function nutritionLine(p) {
  const parts = [];
  for (const f of (p.feeds || []).filter((x) => feedActive(x))) {
    parts.push(`${f.route === 'pn' ? '点滴' : '経腸'} ${f.name} ${changeText(f, feedAt(f))}`);
  }
  const o = oralNow(p);
  if (o) {
    if (o.npo) parts.push(`絶食 ${npoDay(p)}日目`);
    else {
      const it = intakeToday(p);
      parts.push(`経口 ${oralText(o)}${it !== null ? `（今日 ${it}割）` : ''}`);
    }
  }
  return parts.join(' ／ ');
}
