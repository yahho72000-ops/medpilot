// ロジックのテスト（tests.html を開くと実行）

import * as M from './model.js';
import { parseLabText, groupImport, matchItem, latestValues, defaultLabItems } from './labs.js';
import { hashPin, verifyPin, createIdKeys, encryptId, openPrivate, decryptId, changePass, randomCode, CODE_CHARS } from './crypto.js';
import { dayKey, addDays, diffDays, ymd, norm } from './util.js';

const results = [];
const eq = (name, got, want) => results.push({ name, ok: JSON.stringify(got) === JSON.stringify(want), got, want });
const ok = (name, cond) => results.push({ name, ok: !!cond, got: cond, want: true });

async function run() {
  // 日付
  eq('dayKey 5:59 は前日', dayKey(new Date(2026, 10, 28, 5, 59)), '2026-11-27');
  eq('dayKey 6:00 は当日', dayKey(new Date(2026, 10, 28, 6, 0)), '2026-11-28');
  eq('addDays 月またぎ', addDays('2026-11-30', 1), '2026-12-01');
  eq('diffDays', diffDays('2026-12-01', '2026-11-27'), 4);
  eq('norm 半角カナ', norm('ﾍﾓｸﾞﾛﾋﾞﾝ'), 'ヘモグロビン');

  // タスクの段階
  const t3 = M.newTask({ label: '血液検査', steps: 3, kind: 'lab' });
  const seq = [];
  for (let i = 0; i < 4; i++) { M.setState(t3, M.nextState(t3)); seq.push(t3.state); }
  eq('3段階の順番', seq, ['ordered', 'resulted', 'done', 'done']);
  M.setState(t3, M.prevState(t3));
  eq('1つ戻す', t3.state, 'resulted');
  const t2 = M.newTask({ label: '家族IC', steps: 2, kind: 'ic' });
  M.setState(t2, M.nextState(t2));
  eq('2段階', t2.state, 'done');
  eq('コンサルトの表示', M.stateInfo({ ...M.newTask({ label: 'コンサルト', steps: 3, kind: 'consult' }), state: 'ordered' }).text, '返事待ち');
  eq('短い名前（かっこ）', M.shortLabel('画像（CT）'), 'CT');
  eq('短い名前（血液）', M.shortLabel('血液検査'), '血液');

  // 患者と終わり方
  const tpl = JSON.parse(JSON.stringify(M.DEFAULT_TEMPLATES));
  const p = M.newPatient({ code: 'AAAA', nickname: 'テスト', ageBand: '80', sex: 'F', location: 'er' }, tpl);
  eq('ER 基本リスト 5 件', p.tasks.length, 5);
  eq('最初の残り', M.openCount(p), 5);
  M.applyEnding(p, 'admit_er', tpl);
  eq('入院リスト 9 件追加', p.tasks.filter((t) => t.group === 'admit').length, 9);
  p.tasks.filter((t) => t.group === 'admit').forEach((t) => M.setState(t, 'done'));
  eq('入院手続きが終われば入院患者へ', M.progress(p), 'toInpatient');
  M.moveToInpatient(p);
  eq('入院日', p.admitDate, ymd());
  eq('入院1日目', M.hospitalDay(p), 1);

  const h = M.newPatient({ code: 'BBBB', nickname: '帰宅', ageBand: '40', sex: 'M', location: 'er' }, tpl);
  M.applyEnding(h, 'home', tpl);
  h.tasks.filter((t) => t.group === 'home').forEach((t) => M.setState(t, 'done'));
  eq('帰宅：残りがあればフォローへ', M.progress(h), 'toFollowup');
  M.moveToFollowup(h);
  eq('フォローの期限は3日後', h.tasks.filter(M.isOpen)[0].dueDate, addDays(ymd(), 3));
  h.tasks.forEach((t) => M.setState(t, 'done'));
  eq('フォローが終われば過去へ', M.progress(h), 'askPast');

  const o = M.newPatient({ code: 'CCCC', nickname: '他科', ageBand: '70', sex: 'M', location: 'er' }, tpl);
  M.applyEnding(o, 'admit_other', tpl, '脳外科');
  eq('他科入院はリストなし', o.tasks.length, 5);
  eq('他科入院の表示', M.endingLabel(o), '他科入院（脳外科）');
  o.tasks.forEach((t) => M.setState(t, 'none'));
  eq('他科入院：結果確認が終われば過去へ', M.progress(o), 'askPast');

  const dc = M.newPatient({ code: 'EEEE', nickname: '退院', ageBand: '70', sex: 'M', location: 'inpatient' }, tpl);
  dc.tasks.push(M.newTask({ label: '採血', group: 'inpatient', dueDate: addDays(ymd(), 3) }));
  M.applyEnding(dc, 'discharge', tpl);
  eq('退院：リストが残っていれば待つ', M.progress(dc), null);
  dc.tasks.filter((t) => t.group === 'discharge').forEach((t) => M.setState(t, 'done'));
  eq('退院：先の予定が残っていてもリストが済めば過去へ', M.progress(dc), 'askPast');

  // IC とデバイス
  const ip = M.newPatient({ code: 'DDDD', nickname: '入院', ageBand: '90', sex: 'M', location: 'inpatient', admitDate: addDays(ymd(), -7) }, tpl);
  ok('IC 7日で警告', M.icWarn(ip));
  ip.lastICDate = addDays(ymd(), -6);
  ok('IC 6日は警告なし', !M.icWarn(ip));
  const dev = { type: '尿カテ', insertedDate: addDays(ymd(), -13), removedDate: null };
  eq('留置14日目', M.deviceDay(dev), 14);
  ok('14日目で警告', M.deviceWarn(dev));
  eq('入院患者の残り（回診）', M.openCount(ip), 1);

  // 検査値の読み取り
  const text = '```\nMEDPILOT-LAB v1\n日付|項目名|値|H/L\n2026-10-09|白血球数|113|H\n2026/10/9|ﾍﾓｸﾞﾛﾋﾞﾝ|9.7|L\n10/10|ｸﾚｱﾁﾆﾝ|0.56|\n2026-10-10|AST|73H\n2026-10-10|謎の項目|?|\nこれは説明文\n```';
  const { rows, skipped } = parseLabText(text, '2026-11-27');
  eq('読めた行数', rows.length, 5);
  eq('説明文は飛ばす', skipped.length, 1);
  eq('年なしの日付', rows[2].date, '2026-10-10');
  eq('値に付いた H', [rows[3].value, rows[3].flag], ['73', 'H']);
  const items = defaultLabItems();
  eq('半角カナの項目名', matchItem('ﾍﾓｸﾞﾛﾋﾞﾝ', items).abbr, 'Hb');
  eq('H-Neu', matchItem('H-Neu', items).abbr, 'Neut');
  eq('知らない項目', matchItem('謎の項目', items), null);
  const lp = { labs: [{ date: '2026-10-09', draw: 1, itemId: 'x', value: '1', flag: '' }] };
  const groups = groupImport(rows, items, lp);
  eq('日付ごとにまとめる', groups.map((g) => g.date), ['2026-10-09', '2026-10-10']);
  eq('同じ日は2回目', groups[0].draw, 2);
  const wbc = items.find((x) => x.abbr === 'WBC');
  const lp2 = { labs: [
    { date: '2026-10-09', draw: 1, itemId: wbc.id, value: '113', flag: 'H' },
    { date: '2026-10-10', draw: 1, itemId: wbc.id, value: '105', flag: 'H' },
    { date: '2026-10-10', draw: 2, itemId: wbc.id, value: '120', flag: 'H' },
  ] };
  const lv = latestValues(lp2, items);
  eq('最新値（2回目）と矢印', [lv[0].last.value, lv[0].prev.value, lv[0].arrow], ['120', '105', '↑']);

  // 暗号
  const rec = await hashPin('123456');
  ok('PIN 正しい', await verifyPin('123456', rec));
  ok('PIN 違う', !(await verifyPin('654321', rec)));
  const keys = await createIdKeys('correct horse battery');
  const ct = await encryptId(keys, '47291056');
  const priv = await openPrivate(keys, 'correct horse battery');
  eq('ID を取り出せる', await decryptId(priv, ct), '47291056');
  let failed = false;
  try { await openPrivate(keys, 'wrong passphrase!!'); } catch (e) { failed = true; }
  ok('違う合言葉では開かない', failed);
  const keys2 = await changePass(keys, 'correct horse battery', 'new passphrase 123');
  eq('合言葉を変えても同じ ID', await decryptId(await openPrivate(keys2, 'new passphrase 123'), ct), '47291056');
  const c1 = await encryptId(keys, '47291056');
  ok('同じ ID でも毎回違う暗号文', c1 !== ct);
  const code = randomCode(new Set());
  ok('識別番号は4文字・紛らわしい文字なし', code.length === 4 && [...code].every((ch) => CODE_CHARS.includes(ch)));

  const pass = results.filter((r) => r.ok).length;
  const lines = results.map((r) => `${r.ok ? 'OK ' : 'NG '} ${r.name}${r.ok ? '' : `\n     got:  ${JSON.stringify(r.got)}\n     want: ${JSON.stringify(r.want)}`}`);
  document.getElementById('out').textContent = `${pass} / ${results.length} 合格\n\n${lines.join('\n')}`;
}

run().catch((e) => {
  document.getElementById('out').textContent = `エラー: ${e.stack || e}`;
});
