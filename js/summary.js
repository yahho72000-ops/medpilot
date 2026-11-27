// まとめカルテ：病院の AI の答え（iPhone の文字読み取りでコピーしたもの）を読んで、患者に入れる
// 答えの形は summaryPrompt で決める。iPhone の読み間違い（γ→y、#→井、0→O など）はここで直す
// 画面に依存しない部分（読み取り・入れる項目の一覧づくり）

import { uuid, ymd, addDays, diffDays, md, mdw, norm, dayKey } from './util.js';
import * as M from './model.js';
import * as K from './meds.js';
import * as F from './nutrition.js';
import { dayStart } from './handoff.js';

// ---- 病院の AI に登録するテンプレート ----
const listOf = (arr) => arr.filter(Boolean).join('、');

export function summaryPrompt(meta = {}) {
  const favs = meta.favMeds && meta.favMeds.length ? meta.favMeds : K.defaultFavMeds();
  const feeds = meta.favFeeds && meta.favFeeds.length ? meta.favFeeds : F.defaultFavFeeds();
  const diet = meta.diet || { forms: F.DEFAULT_DIET_FORMS, types: F.DEFAULT_DIET_TYPES };
  const names = (cat) => listOf(favs.filter((f) => f.cat === cat).map((f) => f.name));
  return `あなたは医師の仕事を手伝っています。
この文のあとに貼るカルテ（入院してからの経過のまとめ）を読んで、決まった形に書き出してください。
答えは、医師がスマホのカメラで画面の文字を読み取り、患者メモのアプリに取り込みます。形が少しでも違うと正しく取り込めないので、下の決まりを必ず守ってください。あいさつや説明は書かないでください。

■ 答えの形（この順番で。見出しは中身がなくても全部書く）
【MedPilot まとめ】
【プロフィール】
年齢：
性別：
体重：
入院日：
主病名：
CODE：
【プロブレム】
【経過】
【薬】
【培養】
【デバイス】
【栄養】
【IC】
【予定】
【おわり】

■ 全体の決まり
1. 見出しは【 】で囲み、上の順番どおりに全部書く。
2. 1行に1つのことだけ書く。表・太字・「*」「-」「・」の箇条書きは使わない。
3. 日付は必ず 2026/11/02 の形（年/月/日。月と日は2けた）。年が書いていない日付は、カルテのほかの日付から年を考えて書く。わからない日付は ? と書く。
4. カルテに書いていないことは書かない。推測で埋めない。迷ったら書かない。
5. 数字・日付・薬の名前は、カルテのとおり正確に写す。
6. 患者さんの名前・ID・生年月日・住所・電話番号・病室、家族やスタッフの名前は、どこにも書かない。
7. 下の「例：」で始まる行は書き方の見本。答えには「例：」を書かない。
8. 書き終えたら、カルテと見比べて、写し間違い・書きもらしがないか確かめてから答える。

■ プロフィールの書き方
年齢は数字だけ（例：82）。性別は 男 か 女。体重は kg の数字だけで、いちばん新しい値。入院日は今回の入院の日。主病名は今回の入院のいちばんの病名を1つ。CODE は Full、DNAR、一部制限 のどれか（書いていなければ空のまま）。

■ プロブレムの書き方
「#1 病名」の形で1行に1つ、大事な順に書く。
例：#1 誤嚥性肺炎

■ 経過の書き方
1行目は「既往：」、2行目は「アレルギー：」（なければ「アレルギー：なし」、書いていなければ「アレルギー：不明」）。
そのあと、プロブレムごとに「#1」で始めて、経過と今の方針を2〜3行で書く。番号はプロブレムと同じにする。家族への説明（IC）の内容もここに書く。

■ 薬の書き方
書くのは 抗菌薬・昇圧薬・鎮静薬・持続の点滴 だけ（内服薬やほかの点滴は書かない）。
1行に1つ、次の形で、間は空白1つ：
種類 名前 開始 日付 終了 日付 予定 ◯日 量 ◯
・種類は 抗菌薬、昇圧、鎮静、持続 のどれか
・開始は必ず書く（わからなければ「開始 ?」）
・終了は、もうやめた薬だけ（最後に使った日）。今も使っている薬には書かない
・予定は、使う日数が決まっているときだけ
・量は、昇圧・鎮静・持続の今の量だけ。単位は γ、mg/h、µg/h、単位/h、mL/h のどれか。抗菌薬には書かない
・今回の入院で使った抗菌薬は、やめたものも全部書く。同じ薬をやめてまた始めたときは2行に分ける
・名前は、一般名や商品名で書いてあっても、次の書き方にそろえる
　抗菌薬：${names('abx')}
　昇圧：${names('vaso')}
　鎮静：${names('sed')}
　持続：${names('drip')}
　この中にない薬は、カルテの書き方のまま（名前の中に空白を入れない）
例：抗菌薬 CTRX 開始 2026/11/02 終了 2026/11/05
例：抗菌薬 MEPM 開始 2026/11/06 予定 14日
例：昇圧 NAD 開始 2026/11/03 量 0.05γ

■ 培養の書き方
1行に1つ：提出日 検体 結果
・検体は ${listOf(K.SPECIMENS.filter((s) => s !== 'その他'))} のどれか（ほかはカルテのまま）。血液は「血液 2セット」のようにセット数も書く
・結果は「結果待ち」「陰性」、または「菌名 耐性 薬 薬 …」（耐性は判定が R の薬。R がなければ「耐性 なし」）
・菌が2つ以上のときは「 ／ 」（前後に空白）で区切る
例：2026/11/02 血液 2セット E. coli 耐性 ABPC LVFX
例：2026/11/02 尿 陰性
例：2026/11/24 痰 結果待ち

■ デバイスの書き方
今入っているものだけ。1行に1つ：名前 挿入 日付
名前は ${listOf(M.DEVICE_TYPES)} のどれか（ほかはカルテのまま）
例：CV 挿入 2026/11/03

■ 栄養の書き方
今のものだけ。1行に1つ、次のどれかの形：
経腸 名前 持続 ◯mL/h
経腸 名前 ◯パック ◯回
点滴 名前 持続 ◯mL/h
経口 形態 治療食
絶食
・経腸・点滴の名前は、できるだけ次の書き方にそろえる：${listOf(feeds.map((f) => f.name))}
・形態は ${listOf(diet.forms || [])} のどれか。治療食は ${listOf(diet.types || [])} など（なければ書かない）
例：経腸 ペプタメン AF 持続 40mL/h
例：経口 嚥下食2 糖尿病食

■ IC の書き方
家族に病状を説明した最後の日を1行：最終IC 日付
例：最終IC 2026/11/20

■ 予定の書き方
これから先の予定だけ。1行に1つ：日付 やること（やることは15字くらいまで。人の名前は書かない）
例：2026/11/30 CT 再検

最後の行は【おわり】にする。

ここからカルテ：
`;
}

// ---- 読み取りの下ごしらえ ----
// 1行をきれいにする（全角→半角、太字や箇条書きの記号を外す、数字の間の O・o を 0 に）
export function cleanLine(raw) {
  let s = String(raw ?? '').normalize('NFKC').replace(/[​﻿]/g, '').trim();
  s = s.replace(/\*\*|__/g, '').replace(/^[・•●○◆◇■□▪►▶*]\s*/, '').replace(/^[-–—]\s+/, '').trim();
  s = s.replace(/(?<=\d)[Oo](?=[\d/.\s月日]|$)|(?<=[\d/.])[Oo](?=\d)/g, '0');
  return s;
}

const pad = (n) => String(n).padStart(2, '0');
const realDate = (y, m, d) => { const t = new Date(y, m - 1, d); return t.getFullYear() === y && t.getMonth() === m - 1 && t.getDate() === d; };

// 日付を探す。年がなければ、past は今日より先にならないように、future は2か月より前にならないように年を決める
export function findDate(s, today = ymd(), mode = 'past', atStart = false) {
  const re = /(?:(\d{4})\s*[/\-.年]\s*)?(\d{1,2})\s*[/\-.月]\s*(\d{1,2})(?!\d)\s*日?/g;
  let m;
  while ((m = re.exec(s))) {
    if (atStart && s.slice(0, m.index).trim()) return null;
    const mo = Number(m[2]);
    const da = Number(m[3]);
    let y = m[1] ? Number(m[1]) : Number(today.slice(0, 4));
    if (mo < 1 || mo > 12 || !realDate(y, mo, da)) { if (atStart) return null; continue; }
    let date = `${y}-${pad(mo)}-${pad(da)}`;
    if (!m[1]) {
      if (mode === 'past' && date > addDays(today, 1)) { y -= 1; date = `${y}-${pad(mo)}-${pad(da)}`; }
      if (mode === 'future' && date < addDays(today, -60)) { y += 1; date = `${y}-${pad(mo)}-${pad(da)}`; }
      if (!realDate(y, mo, da)) continue;
    }
    return { date, index: m.index, rest: s.slice(m.index + m[0].length) };
  }
  return null;
}

// 見出しの行か（【 】がなくても、見出しの言葉だけの行なら見出し）
const HEADS = { プロフィール: 'profile', プロブレム: 'problems', 経過: 'course', 薬: 'meds', 培養: 'cultures', デバイス: 'devices', 栄養: 'nutrition', IC: 'ic', 予定: 'plans' };
export function headOf(s) {
  const core = s.replace(/[\s【】[\]「」『』〔〕()<>〈〉《》|]/g, '');
  if (!core) return null;
  if (/^(med.{0,6})?まとめ$/i.test(core)) return 'start';
  if (/^(お|終)わ[りリ]$/.test(core)) return 'end';
  if (core.toUpperCase() === 'IC') return 'ic';
  return HEADS[core] || null;
}

const blank = (v) => !v || /^[?？-]$|^(不明|なし|無し|空欄|未記載)$/.test(v);
const joinTo = (cur, s) => {
  if (!cur) return s;
  if (cur.includes(s)) return cur;
  return /[A-Za-z0-9]$/.test(cur) && /^[A-Za-z0-9]/.test(s) ? `${cur} ${s}` : `${cur}${s}`;
};

// ---- それぞれの見出しの中の1行 ----
function pProfile(s, r, today) {
  const m = s.match(/^(年齢|性別|体重|入院日|主病名|病名|CODE|コード)\s*[:：]?\s*(.*)$/i);
  if (!m) return false;
  const key = m[1].toUpperCase();
  const v = m[2].trim();
  if (blank(v)) return 0; // 見出しだけ（中身なし）：読めた数には入れない
  if (key === '年齢') {
    const n = v.match(/(\d{1,3})/);
    if (n) {
      const a = Number(n[1]);
      r.profile.ageBand = a >= 100 ? '100' : a < 10 ? '0' : String(Math.floor(a / 10) * 10);
    }
  } else if (key === '性別') {
    if (/女|^F/i.test(v)) r.profile.sex = 'F';
    else if (/男|^M/i.test(v)) r.profile.sex = 'M';
  } else if (key === '体重') {
    const n = v.match(/(\d+(?:\.\d+)?)/);
    if (n && Number(n[1]) > 0 && Number(n[1]) < 400) r.profile.weight = Number(n[1]);
  } else if (key === '入院日') {
    const d = findDate(v, today, 'past');
    if (d) r.profile.admitDate = d.date;
  } else if (key === '主病名' || key === '病名') {
    r.profile.disease = v;
  } else {
    if (/DNAR|DNR/i.test(v)) r.profile.codeStatus = 'dnar';
    else if (/一部|部分|制限|partial/i.test(v)) r.profile.codeStatus = 'partial';
    else if (/FULL|フル/i.test(v)) r.profile.codeStatus = 'full';
  }
  return true;
}

const NUM_HEAD = /^[#井♯]\s*(\d+)\s*[.:：)）]?\s*/;

function pProblem(s, r) {
  const t = s.replace(NUM_HEAD, '').replace(/^\d+\s*[.)）]\s*/, '').trim();
  if (!t) return false;
  r.problems.push(t);
  return true;
}

function pCourse(s, r) {
  let m;
  if ((m = s.match(/^既往(?:歴)?\s*[:：]\s*(.*)$/))) { r.past = m[1].trim(); r.last = 'past'; return true; }
  if ((m = s.match(/^アレルギー\s*[:：]\s*(.*)$/))) { r.allergy = m[1].trim(); r.last = 'allergy'; return true; }
  if ((m = s.match(NUM_HEAD))) { r.course.push({ no: m[1], text: s.slice(m[0].length).trim() }); r.last = 'course'; return true; }
  // 折り返した続きの行
  if (r.last === 'past') r.past = joinTo(r.past, s);
  else if (r.last === 'allergy') r.allergy = joinTo(r.allergy, s);
  else if (r.course.length) { const c = r.course[r.course.length - 1]; c.text = joinTo(c.text, s); }
  else { r.course.push({ no: '', text: s }); r.last = 'course'; }
  return true;
}

// 薬の名前（一般名・商品名・略語）→ よく使う薬の名前
const MED_ALIASES = {
  CTRX: ['セフトリアキソン', 'ロセフィン'],
  CEZ: ['セファゾリン', 'セファメジン'],
  'ABPC/SBT': ['アンピシリン/スルバクタム', 'アンピシリン・スルバクタム', 'スルバクタム/アンピシリン', 'スルバクタム・アンピシリン', 'ユナシン', 'ユナシンS', 'SBT/ABPC'],
  'TAZ/PIPC': ['タゾバクタム/ピペラシリン', 'タゾバクタム・ピペラシリン', 'ピペラシリン/タゾバクタム', 'ピペラシリン・タゾバクタム', 'ゾシン', 'PIPC/TAZ'],
  MEPM: ['メロペネム', 'メロペン'],
  CFPM: ['セフェピム', 'マキシピーム'],
  VCM: ['バンコマイシン'],
  LVFX: ['レボフロキサシン', 'クラビット'],
  NAD: ['ノルアドレナリン', 'ノルエピネフリン', 'ノルアド', 'NA', 'NE'],
  DOB: ['ドブタミン', 'ドブポン', 'ドブトレックス'],
  バソプレシン: ['バソプレッシン', 'ピトレシン', 'AVP'],
  プロポフォール: ['ディプリバン', 'PROP', 'プロポ'],
  ミダゾラム: ['ドルミカム', 'MDZ'],
  デクスメデトミジン: ['プレセデックス', 'DEX', 'デクスメデ'],
  フェンタニル: ['フェンタ', 'FENT'],
  ニカルジピン: ['ペルジピン'],
  ヘパリン: ['ヘパリンNa', 'ヘパリンナトリウム', 'UFH'],
  インスリン: ['ヒューマリンR', 'ヒューマリン', 'ノボリンR', '速効型インスリン'],
};
const ALIAS_MAP = new Map();
for (const [name, list] of Object.entries(MED_ALIASES)) for (const a of [name, ...list]) ALIAS_MAP.set(norm(a), name);

export function medName(raw, favs = []) {
  const alias = ALIAS_MAP.get(norm(raw).replace(/・/g, '/')) || ALIAS_MAP.get(norm(raw));
  const fav = K.findFav(favs, alias || raw) || K.findFav(favs, raw);
  if (fav) return { name: fav.name, fav };
  return { name: alias || raw, fav: null };
}

const MED_KIND = [
  [/^(抗菌薬|抗菌剤|抗生剤|抗生物質|抗菌)/, 'abx'],
  [/^昇圧(薬|剤)?/, 'vaso'],
  [/^鎮静(薬|剤)?/, 'sed'],
  [/^持続(点滴|薬)?/, 'drip'],
  [/^その他(の薬)?/, 'other'],
];
const KW = /開始|終了|予定|量/;

function field(tail, kw) {
  const i = tail.indexOf(kw);
  if (i < 0) return undefined;
  const sub = tail.slice(i + kw.length);
  const j = sub.search(KW);
  return (j < 0 ? sub : sub.slice(0, j)).replace(/^\s*[:：]?\s*/, '').trim();
}

// 量（γ は iPhone が y と読むことがある）
export function parseDose(f) {
  const t = String(f || '').replace(/\s/g, '').replace(/μ/g, 'µ');
  const m = t.match(/^(\d+(?:\.\d+)?)(γ|y|ガンマ|mg\/(?:h|hr|時)|(?:µg|ug|mcg)\/(?:h|hr|時)|(?:単位|U|IU)\/(?:h|hr|時)|(?:mL|cc)\/(?:h|hr|時))?/i);
  if (!m) return null;
  const v = Number(m[1]);
  const u = (m[2] || '').toLowerCase();
  let unit = null;
  if (u === 'γ' || u === 'y' || u === 'ガンマ') unit = 'γ';
  else if (u.startsWith('mg')) unit = 'mg/h';
  else if (/^(µg|ug|mcg)/.test(u)) unit = 'µg/h';
  else if (/^(単位|u|iu)/.test(u)) unit = 'U/h';
  else if (/^(ml|cc)/.test(u)) unit = 'mL/h';
  return { value: v, unit };
}

function pMed(s, r, today, ctx) {
  let cat = null;
  let rest = s;
  for (const [re, c] of MED_KIND) {
    const m = s.match(re);
    if (m) { cat = c; rest = s.slice(m[0].length).replace(/^\s*[:：]?\s*/, ''); break; }
  }
  let k = rest.search(KW);
  const d0 = findDate(rest, today, 'past');
  if (d0 && (k < 0 || d0.index < k)) k = d0.index;
  if (k <= 0) return false;
  const raw = rest.slice(0, k).trim().replace(/\s+/g, ' ');
  if (!raw) return false;
  const { name, fav } = medName(raw, ctx.favMeds);
  if (fav) cat = fav.cat;
  if (!cat) return false;
  const tail = rest.slice(k);
  const fs = field(tail, '開始');
  let start = fs !== undefined ? findDate(fs, today, 'past') : null;
  if (fs === undefined && d0) start = d0;
  const fe = field(tail, '終了');
  const end = fe ? findDate(fe, today, 'past') : null;
  const fp = field(tail, '予定');
  const pm = fp ? fp.match(/(\d+)/) : null;
  const fd = field(tail, '量');
  r.meds.push({
    cat,
    name,
    start: start ? start.date : null,
    end: end ? end.date : null,
    planDays: pm ? Number(pm[1]) : null,
    dose: fd ? parseDose(fd) : null,
  });
  return true;
}

const SPECIMEN_ALIASES = [[/^喀痰/, '痰'], [/^(血液|血培)/, '血液'], [/^尿/, '尿'], [/^便/, '便'], [/^髄液/, '髄液'], [/^胸水/, '胸水'], [/^腹水/, '腹水'], [/^(膿|創部|膿・創部)/, '膿・創部'], [/^(カテ先|カテーテル先)/, 'カテ先']];

function pCulture(s, r, today) {
  const d = findDate(s, today, 'past', true);
  if (!d) return false;
  let rest = d.rest.replace(/^\s*提出\s*/, '').trim();
  let specimen = '';
  for (const [re, sp] of SPECIMEN_ALIASES) {
    const m = rest.match(re);
    if (m) { specimen = sp; rest = rest.slice(m[0].length); break; }
  }
  if (!specimen) {
    const m = rest.match(/^(\S+)/);
    if (!m) return false;
    specimen = m[1].replace(/培養$/, '');
    rest = rest.slice(m[0].length);
  }
  rest = rest.replace(/^\s*培養/, '').trim();
  let sets = null;
  const sm = rest.match(/^(\d)\s*セット/);
  if (sm) { sets = Number(sm[1]); rest = rest.slice(sm[0].length).trim(); }
  let result = 'positive';
  let organisms = [];
  if (!rest || /結果待ち|待ち|未報告|提出中|検査中|培養中/.test(rest)) result = 'pending';
  else if (/^(陰性|発育なし|発育を認めず|発育せず|検出せず|検出されず|no ?growth)/i.test(rest)) result = 'negative';
  else {
    organisms = rest.split(/\s\/\s?|\s?\/\s/).map((chunk) => {
      const i = chunk.search(/耐性/);
      const nm = (i >= 0 ? chunk.slice(0, i) : chunk).trim();
      const res = i >= 0 ? chunk.slice(i + 2).split(/[\s、,]+/).map((x) => x.replace(/^[:：]/, '').trim()).filter((x) => x && !/^(なし|無し|-)$/.test(x)) : [];
      return { name: nm, resistant: res };
    }).filter((o) => o.name);
    if (!organisms.length) return false;
  }
  r.cultures.push({ submitted: d.date, specimen, sets, result, organisms });
  return true;
}

const DEVICE_ALIASES = [
  [/^(CVC?|CVカテ(ーテル)?|中心静脈(カテーテル)?|PICC)$/i, 'CV'],
  [/^(Aライン|A-?line|動脈ライン|動脈圧ライン|ART(ライン)?)$/i, 'Aライン'],
  [/^(尿カテ|尿道カテ(ーテル)?|膀胱留置カテ(ーテル)?|尿道留置カテ(ーテル)?|バルーン(カテーテル)?|フォーリー)$/i, '尿カテ'],
  [/^(胃管|経鼻胃管|NGチューブ|NG)$/i, '胃管'],
  [/^(挿管チューブ|気管チューブ|挿管|気管挿管|ETT)$/i, '挿管チューブ'],
  [/^ドレーン$/, 'ドレーン'],
];

function pDevice(s, r, today) {
  const d = findDate(s, today, 'past');
  if (!d) return false;
  const raw = s.slice(0, d.index).replace(/(挿入|留置)(日)?\s*[:：]?\s*$/, '').trim();
  if (!raw) return false;
  const hit = DEVICE_ALIASES.find(([re]) => re.test(raw.replace(/\s/g, '')));
  r.devices.push({ type: hit ? hit[1] : raw, date: d.date });
  return true;
}

function pNutrition(s, r) {
  if (/^絶食/.test(s)) { r.oral = { npo: true, words: '' }; return true; }
  let m = s.match(/^経口\s*(?:摂取)?\s*[:：]?\s*(.*)$/);
  if (m) { r.oral = { npo: false, words: m[1].trim() }; return true; }
  m = s.match(/^(経腸|経管|点滴|静脈|中心静脈|TPN|PPN)\s*(?:栄養)?\s*[:：]?\s*(.+)$/i);
  if (!m) return false;
  const route = /^(経腸|経管)/.test(m[1]) ? 'en' : 'pn';
  const rest = m[2];
  const c = rest.match(/(?:持続\s*[:：]?\s*)?(\d+(?:\.\d+)?)\s*(?:mL|cc)\s*\/\s*(?:h|hr|時間?)/i);
  const b = rest.match(/(\d+(?:\.\d+)?)\s*(?:パック|袋|本|P)\s*[×xX*]?\s*(\d+)\s*回/);
  let f;
  if (c) f = { route, mode: 'cont', ml: Number(c[1]), name: rest.slice(0, c.index) };
  else if (b) f = { route, mode: 'bolus', packs: Number(b[1]), times: Number(b[2]), name: rest.slice(0, b.index) };
  else return false;
  f.name = f.name.replace(/\s*(持続|単回)\s*$/, '').trim().replace(/\s+/g, ' ');
  if (!f.name) return false;
  r.feeds.push(f);
  return true;
}

function pIC(s, r, today) {
  const d = findDate(s, today, 'past');
  if (!d) return false;
  if (!r.lastIC || d.date > r.lastIC) r.lastIC = d.date;
  return true;
}

function pPlan(s, r, today) {
  const d = findDate(s, today, 'future', true);
  if (!d) return false;
  const label = d.rest.replace(/^\s*[:：]?\s*/, '').trim().slice(0, 40);
  if (!label) return false;
  r.plans.push({ date: d.date, label });
  return true;
}

const PARSERS = { profile: pProfile, problems: pProblem, course: pCourse, meds: pMed, cultures: pCulture, devices: pDevice, nutrition: pNutrition, ic: pIC, plans: pPlan };

// ---- 答えの全体を読む ----
// 何回かに分けて貼ったもの（重なりあり）でもよい。【MedPilot まとめ】〜【おわり】の間だけを読む
export function parseSummaryText(text, { today = ymd(), favMeds = [] } = {}) {
  const r = { profile: {}, problems: [], past: '', allergy: '', course: [], meds: [], cultures: [], devices: [], feeds: [], oral: null, lastIC: null, plans: [], skipped: [], complete: false, found: [], count: 0 };
  const ctx = { favMeds };
  const lines = String(text ?? '').split(/\r?\n/).map(cleanLine).filter(Boolean);
  const hasStart = lines.some((l) => headOf(l) === 'start');
  let on = !hasStart;
  let sec = null;
  let since = 0;
  const found = new Set();
  const okLines = new Set();
  for (const s of lines) {
    const h = headOf(s);
    if (h === 'start') { on = true; sec = null; since = 0; continue; }
    if (h === 'end') { if (on && since > 0) r.complete = true; on = false; sec = null; continue; }
    if (!on) continue;
    if (h) { sec = h; continue; }
    if (/^例\s*[:：)）]/.test(s)) continue;
    if (!sec) { r.skipped.push(s); continue; }
    const res = PARSERS[sec](s, r, today, ctx);
    if (res === 0) continue;
    if (res) { since++; found.add(sec); okLines.add(s); } else r.skipped.push(s);
  }
  // 重ねて貼ったときの重なり（ほかの所で読めた行）は「読めなかった行」に出さない
  r.skipped = [...new Set(r.skipped)].filter((s) => !okLines.has(s));
  delete r.last;
  dedupe(r);
  r.found = Object.keys(PARSERS).filter((k) => found.has(k) || (k === 'profile' && Object.keys(r.profile).length));
  r.count = since;
  return r;
}

function uniqBy(arr, key, merge) {
  const out = [];
  const seen = new Map();
  for (const x of arr) {
    const k = key(x);
    if (seen.has(k)) { if (merge) merge(seen.get(k), x); continue; }
    seen.set(k, x);
    out.push(x);
  }
  return out;
}

function dedupe(r) {
  r.problems = uniqBy(r.problems, norm);
  // 経過：同じ番号で、片方がもう片方に含まれるもの（読み取りの重なり）は長いほうを残す
  const course = [];
  for (const c of r.course) {
    const same = course.find((x) => x.no === c.no && (x.text.includes(c.text) || c.text.includes(x.text)));
    if (same) { if (c.text.length > same.text.length) same.text = c.text; } else course.push(c);
  }
  r.course = course;
  const fill = (a, b) => { for (const k of Object.keys(b)) if ((a[k] === null || a[k] === undefined || a[k] === '') && b[k] !== null && b[k] !== undefined) a[k] = b[k]; };
  r.meds = uniqBy(r.meds, (m) => `${norm(m.name)}#${m.start || ''}`, fill);
  r.cultures = uniqBy(r.cultures, (c) => `${c.submitted}#${c.specimen}`, (a, b) => { if (a.result === 'pending' && b.result !== 'pending') Object.assign(a, b); });
  r.devices = uniqBy(r.devices, (d) => `${norm(d.type)}#${d.date}`);
  r.feeds = uniqBy(r.feeds, (f) => norm(f.name));
  r.plans = uniqBy(r.plans, (p) => `${p.date}#${norm(p.label)}`);
}

// 経過のまとめ（2枚目の欄に入る文）
export function courseText(r) {
  const lines = [];
  if (r.past) lines.push(`既往：${r.past}`);
  if (r.allergy) lines.push(`アレルギー：${r.allergy}`);
  for (const c of r.course) lines.push(c.no ? `#${c.no} ${c.text}` : c.text);
  return lines.join('\n');
}

// ---- 入れる項目の一覧（確認画面のチェック1つずつ） ----
const r1 = (v) => Math.round(Number(v) * 10) / 10;

// 量 → mL/h（計算できなければ null）
export function doseToMl(m, dose, weight) {
  if (!dose || dose.value === null || dose.value === undefined) return null;
  if (dose.unit === 'mL/h') return r1(dose.value);
  if (!dose.unit) return null;
  const base = (u) => (u === 'γ' ? 'γ' : /^mg/.test(u) ? 'mg' : /^µg/.test(u) ? 'µg' : /^(U|単位)/.test(u) ? 'U' : null);
  const from = base(dose.unit);
  const to = base(m.unit);
  let v = dose.value;
  if (!from || !to) return null;
  if (from !== to) {
    if (from === 'mg' && to === 'µg') v *= 1000;
    else if (from === 'µg' && to === 'mg') v /= 1000;
    else return null;
  }
  const ml = K.mlFromDose(m, v, weight);
  return ml === null ? null : r1(ml);
}

const doseLabel = (d) => (d ? `${K.fmtNum(d.value)}${d.unit === 'U/h' ? '単位/h' : d.unit || ''}` : '');

// p：入れる先の患者（新しく登録するときは、まだ保存していない患者）
export function buildItems(r, p, meta = {}, now = Date.now()) {
  const today = ymd(new Date(now));
  const before = dayStart(now) - 60000; // 「今日したこと」に出さないように、今日の申し送りより前の時刻にする
  const items = [];
  const add = (sec, text, apply, { on = true, note = '', dup = false, off = false } = {}) => {
    items.push({ id: `s${items.length}`, sec, text, apply: off ? null : apply, on: on && !dup && !off, note: dup ? 'すでにあります' : note, dup, off });
  };
  const weight = Number(p.weight) > 0 ? Number(p.weight) : Number(r.profile.weight) > 0 ? Number(r.profile.weight) : null;
  const favs = meta.favMeds || [];

  // プロフィール（登録してある患者のときだけ。新しく登録するときは登録画面に入れる）
  if (p.code) {
    const pr = r.profile;
    const prof = (field, label, v, cur, show) => {
      if (v === undefined || v === null || v === '') return;
      if (cur === v) return;
      add('profile', `${label}：${show(v)}`, (q) => { q[field] = v; }, { on: !cur, note: cur ? `今：${show(cur)}` : '' });
    };
    prof('ageBand', '年代', pr.ageBand, p.ageBand, M.ageLabel);
    prof('sex', '性別', pr.sex, p.sex, (v) => M.SEX[v]);
    prof('weight', '体重', pr.weight, p.weight, (v) => `${K.fmtNum(v)}kg`);
    if (p.location === 'inpatient') prof('admitDate', '入院日', pr.admitDate, p.admitDate, (v) => mdw(v));
    prof('disease', '主病名', pr.disease, p.disease, (v) => v);
    if (pr.codeStatus) prof('codeStatus', 'CODE', pr.codeStatus, p.codeStatus === 'unknown' ? '' : p.codeStatus, (v) => M.CODE_STATUS[v]);
  }

  // Problem List
  const have = new Set((p.problems || []).map(norm));
  for (const t of r.problems) add('problems', t, (q) => { q.problems = [...(q.problems || []), t]; }, { dup: have.has(norm(t)) });

  // 薬
  for (const m of r.meds) {
    const { fav } = medName(m.name, favs);
    const cat = K.MED_CATS[m.cat] ? m.cat : 'other';
    const proto = K.newMed({ name: m.name, cat, unit: fav ? fav.unit : K.MED_CATS[cat].unit || '', conc: fav && fav.amount ? fav : null, perDay: !!(fav && fav.perDay) });
    const start = m.start || p.admitDate || r.profile.admitDate || today;
    const dup = (p.meds || []).some((x) => norm(x.name) === norm(m.name) && x.start === start);
    let note = '';
    let flowText = '';
    if (K.isFlow(proto) && m.dose && !m.end) {
      const ml = doseToMl(proto, m.dose, weight);
      flowText = ` 量 ${doseLabel(m.dose)}`;
      note = ml !== null ? `${ml}mL/h として入れます` : `mL/h に直せません（${proto.unit === 'γ' && !weight ? '体重がありません' : '組成か単位が合いません'}）。流量はあとで入れてください`;
    }
    if (!m.start) note = '開始日がわかりません（入院日にしています）';
    const text = `${K.MED_CATS[cat].label} ${m.name}　${md(start)}〜${m.end ? md(m.end) : ''}${m.planDays ? ` 予定${m.planDays}日` : ''}${flowText}`;
    add('meds', text, (q) => {
      const x = K.newMed({ name: m.name, cat, start, planDays: m.planDays, unit: proto.unit, conc: proto.conc || null, perDay: !!proto.perDay });
      if (K.isFlow(x) && m.dose && !m.end) {
        const ml = doseToMl(x, m.dose, Number(q.weight) > 0 ? q.weight : weight);
        if (ml !== null) {
          const at = start === today ? now : Math.max(new Date(`${start}T00:00:00`).getTime(), before);
          x.rates.push({ at, ml });
        }
      }
      if (m.end) K.endMed(x, m.end, now);
      q.meds = [...(q.meds || []), x];
    }, { dup, on: cat !== 'other' && !!m.start, note: cat === 'other' ? 'その他の薬' : note });
  }

  // 培養
  for (const c of r.cultures) {
    const title = K.cultureTitle({ specimen: c.specimen, sets: c.specimen === '血液' ? c.sets || 2 : null });
    const res = c.result === 'pending' ? '結果待ち' : c.result === 'negative' ? '陰性' : c.organisms.map((o) => `${o.name}${o.resistant.length ? `（R：${o.resistant.join(', ')}）` : ''}`).join('、');
    const dup = (p.cultures || []).some((x) => x.specimen === c.specimen && x.submitted === c.submitted);
    add('cultures', `${md(c.submitted)} ${title} ${res}`, (q) => {
      const x = K.newCulture({ specimen: c.specimen, sets: c.sets, submitted: c.submitted });
      if (c.result === 'pending') K.setCultureStage(x, 'submitted', today);
      else {
        x.stage = c.result === 'negative' ? 'negative' : 'done';
        x.doneAt = c.submitted;
        x.due = null;
        x.organisms = c.organisms.map((o, i) => ({ no: String(i + 1), name: o.name, amount: '', sens: o.resistant.map((drug) => ({ drug, mic: '', sir: 'R' })) }));
      }
      q.cultures = [...(q.cultures || []), x];
    }, { dup, note: c.result === 'pending' ? '確認日のタスクができます' : '確認済として入れます' });
  }

  // デバイス
  for (const d of r.devices) {
    const dup = M.activeDevices(p).some((x) => norm(x.type) === norm(d.type));
    const days = diffDays(today, d.date) + 1;
    add('devices', `${d.type} 挿入 ${md(d.date)}（${days}日目）`, (q) => {
      q.devices = [...(q.devices || []), { id: uuid(), type: d.type, insertedDate: d.date, removedDate: null }];
    }, { dup });
  }

  // 栄養
  for (const f of r.feeds) {
    const fav = F.findFeedFav(meta.favFeeds, f.name);
    if (!fav) {
      add('nutrition', `${F.ROUTES[f.route].label} ${f.name}`, null, { off: true, note: 'よく使う栄養にないので入れられません（設定 → 栄養 で足すと入れられます）' });
      continue;
    }
    const proto = F.newFeed({ ...fav, mode: f.mode, ml: f.ml ?? null, packs: f.packs ?? null, times: f.times ?? null, at: before });
    const c = F.feedAt(proto, Infinity);
    const dup = (p.feeds || []).some((x) => F.feedActive(x, today) && norm(x.name) === norm(fav.name));
    add('nutrition', `${F.ROUTES[fav.route].label} ${fav.name} ${F.changeText(proto, c)}（${Math.round(F.kcalDay(proto, c))}kcal/日）`, (q) => {
      // 開始日は昨日にしておく（今日の申し送りに「開始」と出ないように）
      q.feeds = [...(q.feeds || []), F.newFeed({ ...fav, mode: f.mode, ml: f.ml ?? null, packs: f.packs ?? null, times: f.times ?? null, start: addDays(dayKey(new Date(now)), -1), at: before })];
    }, { dup });
  }
  if (r.oral) {
    const o = resolveOral(r.oral, meta.diet);
    const cur = F.oralNow(p);
    const dup = !!cur && !!cur.npo === !!o.npo && F.oralText(cur) === F.oralText(o);
    add('nutrition', o.npo ? '絶食' : `経口 ${F.oralText(o)}`, (q) => {
      q.oral = [...(q.oral || []), { at: before, ...o }].sort((a, b) => a.at - b.at);
    }, { dup });
  }

  // 家族IC
  if (r.lastIC) {
    const newer = !p.lastICDate || r.lastIC > p.lastICDate;
    add('ic', `最終IC ${mdw(r.lastIC)}（${diffDays(today, r.lastIC)}日前）`, (q) => { if (!q.lastICDate || r.lastIC > q.lastICDate) q.lastICDate = r.lastIC; }, { dup: !newer, note: !newer && p.lastICDate ? `今：${mdw(p.lastICDate)}` : '' });
  }

  // 予定（日付つきのタスク）
  for (const t of r.plans) {
    const dup = (p.tasks || []).some((x) => M.isOpen(x) && x.dueDate === t.date && norm(x.label) === norm(t.label));
    const past = t.date < today;
    add('plans', `${mdw(t.date)} ${t.label}`, (q) => {
      q.tasks = [...(q.tasks || []), M.newTask({ label: t.label, steps: 2, kind: 'free', group: q.location === 'inpatient' ? 'inpatient' : q.location === 'followup' ? 'followup' : 'er', dueDate: t.date })];
    }, { dup, on: !past, note: past ? '過ぎた日付です' : '' });
  }
  return items;
}

// 経口の言葉を形態・治療食に分ける
export function resolveOral(o, diet = {}) {
  if (o.npo) return { npo: true, form: '', diet: '' };
  const forms = diet.forms || F.DEFAULT_DIET_FORMS;
  const types = diet.types || F.DEFAULT_DIET_TYPES;
  const words = String(o.words || '').replace(/嚥下食\s*(\d)/g, '嚥下食$1').split(/[\s、,・/]+/).filter(Boolean);
  let form = '';
  const ds = [];
  for (const w of words) {
    const f = forms.find((x) => norm(x) === norm(w));
    const t = types.find((x) => norm(x) === norm(w));
    if (f && !form) form = f;
    else if (t) ds.push(t);
    else if (!form) form = w;
    else ds.push(w);
  }
  return { npo: false, form, diet: ds.join('・') };
}

// チェックしたものを入れる。入れた数を返す
export function applyItems(p, items, picked, { course = null, now = Date.now() } = {}) {
  let n = 0;
  for (const it of items) {
    if (!it.apply || !picked.has(it.id)) continue;
    it.apply(p);
    n++;
  }
  if (course !== null && course.trim()) {
    p.summaryText = course.trim();
    p.summaryAt = now;
    n++;
  }
  p.updatedAt = now;
  return n;
}

export const SECTION_TITLES = { profile: 'プロフィール', problems: 'Problem List', meds: '薬', cultures: '培養', devices: 'デバイス', nutrition: '栄養', ic: '家族IC', plans: '予定（日付つきのタスク）' };
export const FOUND_LABELS = { profile: 'プロフィール', problems: 'プロブレム', course: '経過', meds: '薬', cultures: '培養', devices: 'デバイス', nutrition: '栄養', ic: 'IC', plans: '予定' };

