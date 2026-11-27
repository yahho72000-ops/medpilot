// 患者とタスクの決まりごと（画面に依存しない部分）

import { uuid, ymd, dayKey, diffDays } from './util.js';
import { openCultures, clinicalCount, endOpenMeds } from './meds.js';
import { endOpenFeeds } from './nutrition.js';

// ---- ひな形（設定で編集できる。ここは最初の値） ----
export const DEFAULT_TEMPLATES = {
  er: [
    { label: '血液検査', kind: 'lab', steps: 3 },
    { label: '画像', kind: 'image', steps: 3 },
    { label: '心電図', kind: 'ecg', steps: 3 },
    { label: 'コンサルト', kind: 'consult', steps: 3 },
    { label: '家族IC', kind: 'ic', steps: 2 },
  ],
  admit: ['入院決定', '診療計画書', '翌日以降の採血オーダー', 'リハビリオーダー', '持参薬確認', '食事オーダー', '安静度', 'CODEの確認', '紹介元への返書'],
  home: ['処方', '次回受診の案内', '紹介状'],
  transfer: ['紹介状', '画像CD', '転院先への連絡', '搬送の手配'],
  death: ['死亡診断書'],
  discharge: ['退院サマリー', '紹介元への返書', '退院処方', '次回外来の予約'],
};

export const TEMPLATE_NAMES = {
  er: '救急外来の基本リスト',
  admit: '入院（救急科）のリスト',
  home: '帰宅のリスト',
  transfer: '転院のリスト',
  death: '死亡のリスト',
  discharge: '退院のリスト',
};

export const ER_ENDINGS = {
  home: { label: '帰宅', list: 'home' },
  admit_er: { label: '入院（救急科）', list: 'admit' },
  admit_other: { label: '入院（他科）', list: null },
  transfer: { label: '転院', list: 'transfer' },
  death: { label: '死亡', list: 'death' },
};

export const IN_ENDINGS = {
  discharge: { label: '退院', list: 'discharge' },
  transfer: { label: '転院', list: 'transfer' },
  transfer_dept: { label: '転科', list: null },
  death: { label: '死亡', list: 'death' },
};

export const GROUP_TITLES = {
  admit: '入院の手続き',
  home: '帰宅の準備',
  transfer: '転院の準備',
  death: '死亡時の手続き',
  discharge: '退院の準備',
};

export const DEVICE_TYPES = ['CV', 'Aライン', '尿カテ', '胃管', 'ドレーン', '挿管チューブ'];

// 病棟（選択肢）と病室（数字）
export const WARDS = ['2E', '2W', '3E', '3W', '4E', '4W', '5E', '5W', '6E', '6W', '7W', 'ER'];
export function bedLabel(ward, room) {
  if (!ward) return room || '';
  return room ? `${ward}-${room}` : ward;
}
export function parseBed(bed) {
  const m = String(bed || '').normalize('NFKC').toUpperCase().match(/^(2E|2W|3E|3W|4E|4W|5E|5W|6E|6W|7W|ER)[-\s]?(\d*)$/);
  return m ? { ward: m[1], room: m[2] } : { ward: '', room: '' };
}

// 今日の採血（4つの状態）
export const BLOOD = {
  unknown: { text: '未確認', short: '採血 未確認', tone: 'r' },
  none: { text: 'なし', short: '採血 なし', tone: 'g' },
  yes: { text: 'あり（確認未）', short: '採血 確認未', tone: 'a' },
  done: { text: 'あり（確認済）', short: '採血 確認済', tone: 'g' },
};
export const bloodOpen = (v) => v === 'unknown' || v === 'yes';
export const DEVICE_WARN_DAYS = 14;
export const IC_WARN_DAYS = 7;

export const OUTLOOKS = { thisweek: '今週', nextweek: '来週', over2w: '2週以上', unknown: '未定' };

export const CODE_STATUS = { full: 'Full', dnar: 'DNAR', partial: '一部制限', unknown: '未確認' };

export const AGE_BANDS = ['0', '10', '20', '30', '40', '50', '60', '70', '80', '90', '100'];
export function ageLabel(b) {
  if (b === '0') return '10歳未満';
  if (b === '100') return '100歳以上';
  return b ? `${b}代` : '';
}
export const ageButton = (b) => (b === '0' ? '0〜9' : b === '100' ? '100〜' : `${b}代`);
export const SEX = { M: '男性', F: '女性' };

// ---- タスク ----
export function newTask({ label, steps = 2, kind = 'free', group = 'er', dueDate = null }) {
  return { id: uuid(), label, steps: steps === 3 ? 3 : 2, kind, group, state: 'todo', dueDate, createdAt: Date.now(), doneAt: null };
}

const ORDER = { 3: ['todo', 'ordered', 'resulted', 'done'], 2: ['todo', 'done'] };

export function nextState(t) {
  if (t.state === 'none') return 'todo';
  const o = ORDER[t.steps] || ORDER[2];
  const i = o.indexOf(t.state);
  return i >= 0 && i < o.length - 1 ? o[i + 1] : t.state;
}

export function prevState(t) {
  if (t.state === 'none') return 'todo';
  const o = ORDER[t.steps] || ORDER[2];
  const i = o.indexOf(t.state);
  return i > 0 ? o[i - 1] : t.state;
}

export function setState(t, s) {
  t.state = s;
  t.doneAt = s === 'done' || s === 'none' ? Date.now() : null;
}

export const isOpen = (t) => t.state !== 'done' && t.state !== 'none';

// タップしたときに出す選択肢
export function stateChoices(t) {
  const consult = t.kind === 'consult';
  if (t.steps === 3) {
    return [
      ['todo', '未'],
      ['ordered', consult ? '依頼済（返事待ち）' : 'オーダー済（結果待ち）'],
      ['resulted', consult ? '返事あり（確認待ち）' : '結果あり（確認待ち）'],
      ['done', '確認済'],
      ['none', 'なし'],
    ];
  }
  return [['todo', '未'], ['done', '済'], ['none', 'なし']];
}

// 長い表示（患者ページ用）。tone: r=まだ, a=待ち, g=済・なし
export function stateInfo(t) {
  const consult = t.kind === 'consult';
  switch (t.state) {
    case 'none': return { text: 'なし', tone: 'g' };
    case 'done': return { text: t.steps === 3 ? '確認済' : '済', tone: 'g' };
    case 'ordered': return { text: consult ? '返事待ち' : '結果待ち', tone: 'a' };
    case 'resulted': return { text: consult ? '返事あり・確認待ち' : '結果あり・確認待ち', tone: 'a' };
    default: return { text: '未', tone: 'r' };
  }
}

// 短い表示（一覧のチップ用）
export function shortState(t) {
  switch (t.state) {
    case 'none': return 'なし';
    case 'done': return '済';
    case 'ordered': return t.kind === 'consult' ? '返事待ち' : '結果待ち';
    case 'resulted': return '確認待ち';
    default: return '未';
  }
}

const SHORT_LABEL = { 血液検査: '血液', コンサルト: 'コンサル' };
export function shortLabel(label) {
  const m = String(label).match(/^(.+?)[（(](.+)[）)]$/);
  if (m) return m[2];
  return SHORT_LABEL[label] || label;
}

export const stepCount = (t) => {
  const o = ORDER[t.steps] || ORDER[2];
  return t.state === 'none' ? 0 : Math.max(0, o.indexOf(t.state));
};

// ---- 患者 ----
export function newPatient(fields, templates) {
  const inpatient = fields.location === 'inpatient';
  return {
    id: uuid(),
    code: fields.code,
    encId: fields.encId || null,
    nickname: fields.nickname || '',
    ageBand: fields.ageBand || '',
    sex: fields.sex || '',
    ward: fields.ward || '',
    room: fields.room || '',
    bed: bedLabel(fields.ward, fields.room) || fields.bed || '',
    disease: fields.disease || '',
    weight: Number(fields.weight) > 0 ? Number(fields.weight) : null,
    codeStatus: fields.codeStatus || 'unknown',
    location: inpatient ? 'inpatient' : 'er',
    visitDate: ymd(),
    admitDate: inpatient ? fields.admitDate || ymd() : null,
    tasks: inpatient ? [] : templates.er.map((x) => newTask({ label: x.label, steps: x.steps, kind: x.kind, group: 'er' })),
    labs: [],
    notes: [],
    problems: [],
    devices: [],
    meds: [],
    cultures: [],
    feeds: [],
    oral: [],
    intake: {},
    handoffMemo: '',
    daily: {},
    lastICDate: null,
    outlook: null,
    transferStart: null,
    ending: null,
    registeredAt: Date.now(),
    updatedAt: Date.now(),
    manualOrder: Date.now(),
    createdBy: 'me',
  };
}

export const today = () => ymd();

// 今日やるべきタスク（予定日が未来のものは除く）
export const isDueNow = (t) => !t.dueDate || t.dueDate <= today();
export const openTasks = (p) => p.tasks.filter((t) => isOpen(t) && isDueNow(t));
export const futureTasks = (p) =>
  p.tasks.filter((t) => isOpen(t) && t.dueDate && t.dueDate > today()).sort((a, b) => (a.dueDate < b.dueDate ? -1 : 1));

// 毎日のチェック（回診・今日の採血）
export function dailyGet(p, key = dayKey()) {
  const d = p.daily && p.daily[key];
  if (d) return d;
  const bloodToday = p.tasks.some((t) => t.dueDate === ymd() && /採血/.test(t.label) && t.state !== 'none');
  return { visit: 'todo', blood: bloodToday ? 'yes' : 'unknown' };
}

export function dailySet(p, field, value, key = dayKey()) {
  p.daily = p.daily || {};
  p.daily[key] = { ...dailyGet(p, key), [field]: value };
  // 古い記録は 14 日分だけ残す
  const keys = Object.keys(p.daily).sort();
  while (keys.length > 14) delete p.daily[keys.shift()];
}

// メインプロブレム：Problem List の #1、なければ登録した病名
export function mainProblem(p) {
  const first = (p.problems || [])[0];
  if (first) return `#1 ${first}`;
  return p.disease || '';
}

// 入っていない項目（ID・あだ名・年代・性別）があるか
export const missingInfo = (p) => !p.encId || !p.nickname || !p.ageBand || !p.sex;

export function openCount(p) {
  let n = openTasks(p).length;
  if (p.location !== 'past') n += clinicalCount(p);
  if (p.location === 'inpatient') {
    const d = dailyGet(p);
    if (d.visit === 'todo') n++;
    if (bloodOpen(d.blood)) n++;
  }
  return n;
}

// 一覧の「残り」チップの色：未があれば赤、待ちだけなら黄
export function remainTone(p) {
  const open = openTasks(p);
  if (p.location === 'inpatient') {
    const d = dailyGet(p);
    if (d.visit === 'todo' || d.blood === 'unknown') return 'r';
  }
  if (open.some((t) => t.state === 'todo')) return 'r';
  if (p.location !== 'past' && clinicalCount(p)) return 'r';
  return openCount(p) ? 'a' : 'g';
}

export const hospitalDay = (p) => (p.admitDate ? diffDays(today(), p.admitDate) + 1 : null);

export function icDays(p) {
  const base = p.lastICDate || p.admitDate;
  return base ? diffDays(today(), base) : null;
}
export const icWarn = (p) => p.location === 'inpatient' && !p.ending && icDays(p) !== null && icDays(p) >= IC_WARN_DAYS;

export const deviceDay = (d) => diffDays(d.removedDate || today(), d.insertedDate) + 1;
export const deviceWarn = (d) => !d.removedDate && deviceDay(d) >= DEVICE_WARN_DAYS;
export const activeDevices = (p) => (p.devices || []).filter((d) => !d.removedDate);

// ---- 終わり方 ----
export function endingLabel(p) {
  if (!p.ending) return '';
  const e = ER_ENDINGS[p.ending.type] || IN_ENDINGS[p.ending.type];
  if (!e) return '';
  if (p.ending.type === 'admit_other' && p.ending.dept) return `他科入院（${p.ending.dept}）`;
  return e.label;
}

export function applyEnding(p, type, templates, dept = '') {
  const table = p.location === 'inpatient' ? IN_ENDINGS : ER_ENDINGS;
  const e = table[type];
  p.ending = { type, at: today(), dept: dept || '', from: p.location };
  if (e.list) {
    for (const label of templates[e.list] || []) p.tasks.push(newTask({ label, steps: 2, kind: 'list', group: e.list }));
  }
}

export function cancelEnding(p) {
  if (!p.ending) return;
  const e = ER_ENDINGS[p.ending.type] || IN_ENDINGS[p.ending.type];
  if (e && e.list) p.tasks = p.tasks.filter((t) => t.group !== e.list || !(t.kind === 'list'));
  p.ending = null;
}

function listDone(p, type) {
  const e = ER_ENDINGS[type] || IN_ENDINGS[type];
  if (!e || !e.list) return true;
  return !p.tasks.some((x) => x.group === e.list && isOpen(x));
}

// タスクが動いたあとに次に何をするか
//   'toInpatient' 入院患者の画面へ / 'toFollowup' 帰宅後フォローへ / 'askPast' 過去の一覧へ（残すか聞く）
export function progress(p) {
  const allOpen = p.tasks.filter(isOpen);
  if (p.location === 'er' && p.ending) {
    const t = p.ending.type;
    if (t === 'admit_er') {
      const list = p.tasks.filter((x) => x.group === 'admit');
      if (list.length && !list.some(isOpen)) return 'toInpatient';
      return null;
    }
    if (t === 'home') {
      const list = p.tasks.filter((x) => x.group === 'home');
      if (list.some(isOpen)) return null;
      // 結果の出ていない培養も帰宅後フォローへ
      return allOpen.length || openCultures(p).length ? 'toFollowup' : 'askPast';
    }
    // 他科入院は結果確認がすべて終わるまで待つ
    if (t === 'admit_other') return allOpen.length ? null : 'askPast';
    // 転院・死亡は、そのリストが終われば終わり
    return listDone(p, t) ? 'askPast' : null;
  }
  if (p.location === 'inpatient' && p.ending) {
    if (p.ending.type === 'transfer_dept') return 'askPast';
    return listDone(p, p.ending.type) ? 'askPast' : null;
  }
  if (p.location === 'followup') return allOpen.length || openCultures(p).length ? null : 'askPast';
  return null;
}

// 帰宅後フォローに移すもの（タスク＋結果の出ていない培養）の数
export const followupCount = (p) => p.tasks.filter(isOpen).length + openCultures(p).length;

// 救急外来から救急科に入院：その場で病棟・病室・入院日を入れて、すぐ入院患者へ
// 入院の手続きのリストは入院患者のページに出す
export function admitNow(p, templates, { ward, room, date }) {
  p.ward = ward || '';
  p.room = room || '';
  p.bed = bedLabel(p.ward, p.room);
  for (const label of templates.admit || []) p.tasks.push(newTask({ label, steps: 2, kind: 'list', group: 'admit' }));
  p.location = 'inpatient';
  p.admitDate = date || today();
  p.ending = null;
}

export function moveToInpatient(p) {
  p.location = 'inpatient';
  p.admitDate = p.ending ? p.ending.at : today();
  p.ending = null;
}

export function moveToFollowup(p, defaultDays = 3) {
  p.location = 'followup';
  p.homeDate = today();
  endOpenMeds(p, p.homeDate);
  endOpenFeeds(p, p.homeDate);
  for (const t of p.tasks) {
    if (isOpen(t)) {
      t.group = 'followup';
      if (!t.dueDate) {
        const d = new Date();
        d.setDate(d.getDate() + defaultDays);
        t.dueDate = ymd(d);
      }
    }
  }
}

export function moveToPast(p) {
  p.endedFrom = p.endedFrom || (p.ending ? p.ending.from : p.location);
  // 続いている薬は、その日（終わり方を選んだ日）で終了にする
  endOpenMeds(p, p.ending && p.ending.at ? p.ending.at : today());
  endOpenFeeds(p, p.ending && p.ending.at ? p.ending.at : today());
  p.location = 'past';
  p.endedAt = today();
}

// ---- 並び順 ----
export function sortEr(list) {
  return [...list].sort((a, b) => openCount(b) - openCount(a) || a.registeredAt - b.registeredAt);
}

export const IN_SORTS = { days: '入院日数の短い順', tasks: 'タスクが多い順', bed: 'ベッド順', manual: '手で並べる' };

export function sortInpatients(list, mode) {
  const arr = [...list];
  const coll = new Intl.Collator('ja', { numeric: true });
  if (mode === 'tasks') return arr.sort((a, b) => openCount(b) - openCount(a) || (a.admitDate < b.admitDate ? 1 : -1));
  if (mode === 'bed') return arr.sort((a, b) => coll.compare(a.bed || '', b.bed || ''));
  if (mode === 'manual') return arr.sort((a, b) => (a.manualOrder || 0) - (b.manualOrder || 0));
  return arr.sort((a, b) => (a.admitDate < b.admitDate ? 1 : a.admitDate > b.admitDate ? -1 : a.registeredAt - b.registeredAt));
}
