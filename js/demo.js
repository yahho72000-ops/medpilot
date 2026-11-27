// デモモード用の架空の患者

import { state, savePatient, existingCodes } from './store.js';
import * as M from './model.js';
import { addDays, ymd, uuid } from './util.js';
import { encryptId, randomCode } from './crypto.js';
import * as K from './meds.js';

// 薬を足す（end を渡すと終了済み）
const med = (p, f, end = null) => {
  const m = K.newMed(f);
  if (end) K.endMed(m, end, new Date(`${end}T18:00`).getTime());
  p.meds.push(m);
  return m;
};
const at = (day, hm) => new Date(`${day}T${hm}`).getTime();
// 流量の薬（よく使う薬の組成を使い、mL/h で記録）
const flow = (p, name, start, steps) => {
  const f = K.findFav(K.defaultFavMeds(), name);
  const m = K.newMed({ name, cat: f.cat, start, unit: f.unit, conc: f, perDay: f.perDay });
  for (const [day, hm, ml] of steps) m.rates.push({ at: at(day, hm), ml });
  p.meds.push(m);
  return m;
};
const cul = (p, specimen, submitted, sets = null) => {
  const c = K.newCulture({ specimen, submitted, sets });
  p.cultures.push(c);
  return c;
};

const T = (p, label, state, opts = {}) => {
  const t = M.newTask({ label, steps: opts.steps || 2, kind: opts.kind || 'free', group: opts.group || 'er', dueDate: opts.due || null });
  M.setState(t, state);
  p.tasks.push(t);
  return t;
};

function setEr(p, states) {
  p.tasks.forEach((t, i) => M.setState(t, states[i] || 'todo'));
}

async function make(fields) {
  const fakeId = String(10000000 + Math.floor(Math.random() * 89999999));
  const encId = state.meta.idKeys ? await encryptId(state.meta.idKeys, fakeId) : null;
  const p = M.newPatient({ ...fields, code: randomCode(existingCodes()), encId }, state.meta.templates);
  return p;
}

function labs(p, date, values) {
  const items = state.meta.labItems;
  for (const [abbr, value, flag] of values) {
    const it = items.find((x) => x.abbr === abbr);
    if (it) p.labs.push({ id: uuid(), date, draw: 1, itemId: it.id, value: String(value), flag: flag || '' });
  }
}

export async function seedDemo() {
  const t = ymd();
  const d = (n) => addDays(t, n);

  // 救急外来
  const a = await make({ nickname: 'サクラ', ageBand: '80', sex: 'F', ward: 'ER', room: '3', disease: '肺炎疑い', codeStatus: 'unknown' });
  setEr(a, ['ordered', 'resulted', 'todo', 'none', 'todo']);
  T(a, '喀痰培養の提出', 'todo');
  cul(a, '血液', t, 2);
  med(a, { name: 'CTRX', cat: 'abx', start: t });
  await savePatient(a);

  // すぐ登録した患者（ID などが未入力）
  const q = M.newPatient({ code: randomCode(existingCodes()), nickname: '', ward: 'ER', room: '6', location: 'er' }, state.meta.templates);
  M.setState(q.tasks[0], 'ordered');
  await savePatient(q);

  const b = await make({ nickname: 'ゴロー', ageBand: '50', sex: 'M', ward: 'ER', room: '1', disease: '腹痛', codeStatus: 'full' });
  setEr(b, ['ordered', 'resulted', 'done', 'none', 'done']);
  await savePatient(b);

  const c = await make({ nickname: 'トラ', ageBand: '70', sex: 'M', ward: 'ER', room: '5', disease: '頭部打撲', codeStatus: 'full' });
  setEr(c, ['done', 'resulted', 'none', 'done', 'done']);
  c.tasks[1].label = '画像（MRI）';
  M.applyEnding(c, 'admit_other', state.meta.templates, '脳外科');
  await savePatient(c);

  // 入院患者
  const inp = async (f, admitAgo) => {
    const p = await make({ ...f, location: 'inpatient', admitDate: d(-admitAgo) });
    return p;
  };
  const e = await inp({ nickname: 'ジロー', ageBand: '90', sex: 'M', ward: '5W', room: '511', disease: '誤嚥性肺炎', codeStatus: 'dnar', weight: 42 }, 6);
  e.problems = ['誤嚥性肺炎', 'アルツハイマー型認知症', '低アルブミン血症'];
  e.lastICDate = d(-3);
  e.outlook = 'nextweek';
  e.transferStart = d(-1);
  e.devices = [{ id: uuid(), type: '尿カテ', insertedDate: d(-6), removedDate: null }];
  T(e, '持参薬の再開を検討', 'todo', { group: 'inpatient' });
  T(e, '嚥下評価', 'todo', { group: 'inpatient', due: d(1) });
  T(e, '胸部CT', 'todo', { group: 'inpatient', due: d(4) });
  M.dailySet(e, 'visit', 'done');
  M.dailySet(e, 'blood', 'yes');
  labs(e, d(-6), [['WBC', 152, 'H'], ['CRP', 12.5, 'H'], ['Alb', 2.8, 'L'], ['Hb', 10.4, 'L'], ['Plt', 18.1, ''], ['Cre', 0.66, '']]);
  labs(e, d(-5), [['WBC', 171, 'H'], ['CRP', 15.8, 'H']]);
  labs(e, d(-3), [['WBC', 133, 'H'], ['CRP', 10.2, 'H'], ['Alb', 2.7, 'L'], ['Hb', '10.0', 'L'], ['Plt', 14.1, 'L'], ['Cre', 0.58, '']]);
  labs(e, d(-1), [['WBC', 121, 'H'], ['CRP', 6.4, 'H'], ['Alb', 2.9, 'L'], ['Hb', '10.0', 'L'], ['Plt', 14.1, 'L'], ['Cre', 0.58, '']]);
  labs(e, t, [['WBC', 98, 'H'], ['CRP', 4.1, 'H'], ['Alb', 3.1, 'L'], ['Hb', 10.1, 'L'], ['Plt', 15.2, 'L'], ['Cre', 0.61, '']]);
  med(e, { name: 'CTRX', cat: 'abx', start: d(-6) }, d(-4));
  med(e, { name: 'MEPM', cat: 'abx', start: d(-3), planDays: 7 });
  const eb = cul(e, '血液', d(-6), 2);
  eb.positiveSets = 0;
  K.setCultureStage(eb, 'negative', d(-1));
  const es = cul(e, '痰', d(-6));
  es.gram = 'GNR';
  es.organisms = [{ no: '1', name: 'Klebsiella pneumoniae（ESBL）', amount: '3+', sens: [
    { drug: 'ABPC', mic: '>16', sir: 'R' }, { drug: 'CEZ', mic: '>16', sir: 'R' }, { drug: 'CTRX', mic: '>32', sir: 'R' },
    { drug: 'TAZ/PIPC', mic: '8', sir: 'S' }, { drug: 'MEPM', mic: '<=0.25', sir: 'S' }, { drug: 'LVFX', mic: '>4', sir: 'R' },
  ] }];
  K.setCultureStage(es, 'prelim', d(-4));
  K.setCultureStage(es, 'sens', d(-3));
  K.setCultureStage(es, 'done', d(-3));
  cul(e, '尿', d(-3));
  e.notes = [
    { id: uuid(), date: t, at: Date.now(), text: '解熱。食事5割摂取。' },
    { id: uuid(), date: d(-1), at: Date.now() - 86400000, text: '酸素 1L に減量。' },
    { id: uuid(), date: d(-2), at: Date.now() - 2 * 86400000, text: '喀痰培養で耐性菌。CTRX から MEPM に変更。' },
  ];
  await savePatient(e);

  const f = await inp({ nickname: 'サクラ', ageBand: '80', sex: 'F', ward: '5E', room: '512', disease: '肺炎', codeStatus: 'full' }, 0);
  f.problems = ['市中肺炎'];
  med(f, { name: 'CTRX', cat: 'abx', start: t, planDays: 7 });
  cul(f, '血液', t, 2);
  cul(f, '痰', t);
  M.dailySet(f, 'blood', 'yes');
  await savePatient(f);

  const g = await inp({ nickname: 'タロウ', ageBand: '70', sex: 'M', ward: '5E', room: '508', disease: '心不全', codeStatus: 'dnar' }, 3);
  g.lastICDate = d(-2);
  g.weight = 58;
  const dob = flow(g, 'DOB', d(-3), [[d(-3), '14:00', 3.5], [d(-2), '10:00', 2.3], [d(-1), '09:30', 1.2]]);
  K.endMed(dob, d(-1), at(d(-1), '17:00'));
  med(g, { name: 'フロセミド', cat: 'other', start: d(-3) });
  await savePatient(g);

  const h = await inp({ nickname: 'ハナコ', ageBand: '60', sex: 'F', ward: '5W', room: '503', disease: '尿路感染症', codeStatus: 'full' }, 8);
  h.lastICDate = d(-8);
  med(h, { name: 'CEZ', cat: 'abx', start: d(-6), planDays: 7 });
  const hu = cul(h, '尿', d(-8));
  hu.gram = 'GNR';
  hu.organisms = [{ no: '1', name: 'Escherichia coli', amount: '10^5', sens: [
    { drug: 'ABPC', mic: '>16', sir: 'R' }, { drug: 'CEZ', mic: '<=2', sir: 'S' }, { drug: 'CTRX', mic: '<=1', sir: 'S' }, { drug: 'LVFX', mic: '>4', sir: 'R' },
  ] }];
  K.setCultureStage(hu, 'sens', d(-6));
  K.setCultureStage(hu, 'done', d(-6));
  M.dailySet(h, 'visit', 'done');
  await savePatient(h);

  const i = await inp({ nickname: 'マツ', ageBand: '80', sex: 'F', ward: '5E', room: '502', disease: '脳梗塞', codeStatus: 'partial' }, 15);
  i.lastICDate = d(-4);
  i.transferStart = d(-7);
  i.devices = [{ id: uuid(), type: '尿カテ', insertedDate: d(-15), removedDate: null }, { id: uuid(), type: '胃管', insertedDate: d(-15), removedDate: d(-5) }];
  M.dailySet(i, 'visit', 'done');
  await savePatient(i);

  const s = await inp({ nickname: 'ケンジ', ageBand: '60', sex: 'M', ward: '6E', room: '601', disease: '敗血症性ショック', codeStatus: 'full' }, 4);
  s.problems = ['敗血症性ショック（尿路感染症）', '急性腎障害'];
  s.lastICDate = d(-1);
  s.devices = [
    { id: uuid(), type: 'CV', insertedDate: d(-4), removedDate: null },
    { id: uuid(), type: 'Aライン', insertedDate: d(-4), removedDate: null },
    { id: uuid(), type: '挿管チューブ', insertedDate: d(-4), removedDate: null },
  ];
  med(s, { name: 'MEPM', cat: 'abx', start: d(-4), planDays: 7 });
  med(s, { name: 'VCM', cat: 'abx', start: d(-4) }, d(-2));
  s.weight = 65;
  flow(s, 'NAD', d(-4), [[d(-4), '22:00', 3.9], [d(-3), '03:00', 9.8], [d(-2), '08:00', 5.9], [d(-1), '10:00', 2]]);
  const vp = flow(s, 'バソプレシン', d(-3), [[d(-3), '04:00', 1.8]]);
  K.endMed(vp, d(-2), at(d(-2), '12:00'));
  flow(s, 'プロポフォール', d(-4), [[d(-4), '22:30', 10], [d(-2), '09:00', 6]]);
  flow(s, 'フェンタニル', d(-4), [[d(-4), '22:30', 1]]);
  flow(s, 'ヘパリン', d(-3), [[d(-3), '12:00', 2], [d(-1), '08:00', 2.5]]);
  flow(s, 'インスリン', d(-2), [[d(-2), '18:00', 2], [d(-1), '06:00', 1.5]]);
  const sb = cul(s, '血液', d(-4), 2);
  sb.positiveSets = 2;
  sb.gram = 'GNR';
  sb.organisms = [{ no: '1', name: 'Escherichia coli', amount: '', sens: [] }];
  K.setCultureStage(sb, 'prelim', d(-3));
  sb.due = t;
  const su = cul(s, '尿', d(-4));
  su.gram = 'GNR';
  K.setCultureStage(su, 'prelim', d(-3));
  su.due = d(1);
  M.dailySet(s, 'blood', 'yes');
  labs(s, d(-4), [['WBC', 236, 'H'], ['CRP', 21.4, 'H'], ['Cre', 2.31, 'H'], ['Plt', 9.8, 'L'], ['PCT', 38.2, 'H']]);
  labs(s, d(-3), [['WBC', 284, 'H'], ['CRP', 28.9, 'H'], ['Cre', 2.65, 'H'], ['Plt', 7.2, 'L']]);
  labs(s, d(-2), [['WBC', 198, 'H'], ['CRP', 22.1, 'H'], ['Cre', 1.98, 'H'], ['Plt', 6.9, 'L']]);
  labs(s, d(-1), [['WBC', 141, 'H'], ['CRP', 13.5, 'H'], ['Cre', 1.42, 'H'], ['Plt', 8.8, 'L']]);
  labs(s, t, [['WBC', 102, 'H'], ['CRP', 7.8, 'H'], ['Cre', 1.12, 'H'], ['Plt', 11.6, 'L']]);
  await savePatient(s);

  // 帰宅後フォロー
  const j = await make({ nickname: 'ゴロー', ageBand: '40', sex: 'M', ward: 'ER', room: '2', disease: '腹痛', codeStatus: 'full' });
  setEr(j, ['done', 'done', 'done', 'none', 'done']);
  const jc = cul(j, '血液', d(-1), 2);
  jc.due = t;
  T(j, '紹介状', 'done', { group: 'followup' });
  j.location = 'followup';
  j.homeDate = d(-1);
  await savePatient(j);

  const k = await make({ nickname: 'ハナ', ageBand: '30', sex: 'F', ward: 'ER', room: '4', disease: '尿路感染症', codeStatus: 'full' });
  setEr(k, ['done', 'none', 'none', 'none', 'none']);
  T(k, '尿培養の結果確認', 'todo', { group: 'followup', due: d(2) });
  k.location = 'followup';
  k.homeDate = d(-2);
  await savePatient(k);

  // 過去の一覧
  const l = await make({ nickname: 'ケン', ageBand: '20', sex: 'M', ward: 'ER', room: '1', disease: '急性アルコール中毒', codeStatus: 'full' });
  setEr(l, ['done', 'none', 'done', 'none', 'done']);
  M.applyEnding(l, 'home', state.meta.templates);
  l.tasks.forEach((x) => M.setState(x, x.state === 'todo' ? 'done' : x.state));
  M.moveToPast(l);
  l.endedAt = d(-3);
  await savePatient(l);
}
