// デモモード用の架空の患者

import { state, savePatient, existingCodes } from './store.js';
import * as M from './model.js';
import { addDays, ymd, uuid } from './util.js';
import { encryptId, randomCode } from './crypto.js';

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
  const a = await make({ nickname: 'サクラ', ageBand: '80', sex: 'F', bed: 'ER-3', disease: '肺炎疑い', codeStatus: 'unknown' });
  setEr(a, ['ordered', 'resulted', 'todo', 'none', 'todo']);
  T(a, '喀痰培養の提出', 'todo');
  await savePatient(a);

  const b = await make({ nickname: 'ゴロー', ageBand: '50', sex: 'M', bed: 'ER-1', disease: '腹痛', codeStatus: 'full' });
  setEr(b, ['ordered', 'resulted', 'done', 'none', 'done']);
  await savePatient(b);

  const c = await make({ nickname: 'トラ', ageBand: '70', sex: 'M', bed: 'ER-5', disease: '頭部打撲', codeStatus: 'full' });
  setEr(c, ['done', 'resulted', 'none', 'done', 'done']);
  c.tasks[1].label = '画像（MRI）';
  M.applyEnding(c, 'admit_other', state.meta.templates, '脳外科');
  await savePatient(c);

  // 入院患者
  const inp = async (f, admitAgo) => {
    const p = await make({ ...f, location: 'inpatient', admitDate: d(-admitAgo) });
    return p;
  };
  const e = await inp({ nickname: 'ジロー', ageBand: '90', sex: 'M', bed: '5西-11', disease: '誤嚥性肺炎', codeStatus: 'dnar' }, 6);
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
  e.notes = [
    { id: uuid(), date: t, at: Date.now(), text: '解熱。食事5割摂取。' },
    { id: uuid(), date: d(-1), at: Date.now() - 86400000, text: '酸素 1L に減量。' },
    { id: uuid(), date: d(-2), at: Date.now() - 2 * 86400000, text: '喀痰培養で耐性菌。CTRX から MEPM に変更。' },
  ];
  await savePatient(e);

  const f = await inp({ nickname: 'サクラ', ageBand: '80', sex: 'F', bed: '5東-12', disease: '肺炎', codeStatus: 'full' }, 0);
  f.problems = ['市中肺炎'];
  M.dailySet(f, 'blood', 'yes');
  await savePatient(f);

  const g = await inp({ nickname: 'タロウ', ageBand: '70', sex: 'M', bed: '5東-08', disease: '心不全', codeStatus: 'dnar' }, 3);
  g.lastICDate = d(-2);
  await savePatient(g);

  const h = await inp({ nickname: 'ハナコ', ageBand: '60', sex: 'F', bed: '5西-03', disease: '尿路感染症', codeStatus: 'full' }, 8);
  h.lastICDate = d(-8);
  M.dailySet(h, 'visit', 'done');
  await savePatient(h);

  const i = await inp({ nickname: 'マツ', ageBand: '80', sex: 'F', bed: '5東-02', disease: '脳梗塞', codeStatus: 'partial' }, 15);
  i.lastICDate = d(-4);
  i.transferStart = d(-7);
  i.devices = [{ id: uuid(), type: '尿カテ', insertedDate: d(-15), removedDate: null }, { id: uuid(), type: '胃管', insertedDate: d(-15), removedDate: d(-5) }];
  M.dailySet(i, 'visit', 'done');
  await savePatient(i);

  // 帰宅後フォロー
  const j = await make({ nickname: 'ゴロー', ageBand: '40', sex: 'M', bed: 'ER-2', disease: '腹痛', codeStatus: 'full' });
  setEr(j, ['done', 'done', 'done', 'none', 'done']);
  T(j, '血液培養の結果確認', 'todo', { group: 'followup', due: t });
  T(j, '紹介状', 'done', { group: 'followup' });
  j.location = 'followup';
  j.homeDate = d(-1);
  await savePatient(j);

  const k = await make({ nickname: 'ハナ', ageBand: '30', sex: 'F', bed: 'ER-4', disease: '尿路感染症', codeStatus: 'full' });
  setEr(k, ['done', 'none', 'none', 'none', 'none']);
  T(k, '尿培養の結果確認', 'todo', { group: 'followup', due: d(2) });
  k.location = 'followup';
  k.homeDate = d(-2);
  await savePatient(k);

  // 過去の一覧
  const l = await make({ nickname: 'ケン', ageBand: '20', sex: 'M', bed: 'ER-1', disease: '急性アルコール中毒', codeStatus: 'full' });
  setEr(l, ['done', 'none', 'done', 'none', 'done']);
  M.applyEnding(l, 'home', state.meta.templates);
  l.tasks.forEach((x) => M.setState(x, x.state === 'todo' ? 'done' : x.state));
  M.moveToPast(l);
  l.endedAt = d(-3);
  await savePatient(l);
}
