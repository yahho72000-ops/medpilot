// ロジックのテスト（tests.html を開くと実行）

import * as M from './model.js';
import { parseLabText, groupImport, matchItem, latestValues, defaultLabItems } from './labs.js';
import { hashPin, verifyPin, createIdKeys, encryptId, openPrivate, decryptId, changePass, randomCode, CODE_CHARS } from './crypto.js';
import { dayKey, addDays, diffDays, ymd, norm } from './util.js';
import * as K from './meds.js';
import { buildMorning, newTopic } from './notify.js';

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

  const ad = M.newPatient({ code: 'GGGG', nickname: '即入院', ageBand: '70', sex: 'F', ward: 'ER', room: '3', location: 'er' }, tpl);
  M.setState(ad.tasks[0], 'ordered');
  M.admitNow(ad, tpl, { ward: '5E', room: '512', date: '2026-11-27' });
  eq('入院決定ですぐ入院患者へ', [ad.location, ad.admitDate, ad.bed], ['inpatient', '2026-11-27', '5E-512']);
  eq('入院の手続きが追加される', ad.tasks.filter((t) => t.group === 'admit' && M.isOpen(t)).length, 9);
  eq('ERの結果待ちは引き継ぐ', ad.tasks[0].state, 'ordered');
  eq('入院後は終わり方なし', [ad.ending, M.progress(ad)], [null, null]);

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
  eq('入院患者の残り（回診・採血未確認）', M.openCount(ip), 2);
  eq('採血は最初「未確認」', M.dailyGet(ip).blood, 'unknown');
  M.dailySet(ip, 'blood', 'none');
  eq('採血なしなら残り1', M.openCount(ip), 1);
  M.dailySet(ip, 'blood', 'yes');
  eq('採血あり（確認未）は残る', M.openCount(ip), 2);
  ip.tasks.push(M.newTask({ label: '採血', group: 'inpatient', dueDate: ymd() }));
  const ip2 = { ...ip, daily: {} };
  eq('今日の採血予定があれば「あり（確認未）」', M.dailyGet(ip2).blood, 'yes');

  // タップで出す選択肢
  eq('3段階の選択肢', M.stateChoices(M.newTask({ label: 'x', steps: 3 })).map((x) => x[0]), ['todo', 'ordered', 'resulted', 'done', 'none']);
  eq('2段階の選択肢', M.stateChoices(M.newTask({ label: 'x', steps: 2 })).map((x) => x[0]), ['todo', 'done', 'none']);

  // 病棟と病室
  eq('病棟＋病室', M.bedLabel('5E', '512'), '5E-512');
  eq('病棟だけ', M.bedLabel('ER', ''), 'ER');
  eq('古い書き方を読む', M.parseBed('5e-12'), { ward: '5E', room: '12' });
  eq('読めない書き方', M.parseBed('5東-12'), { ward: '', room: '' });
  const wp = M.newPatient({ code: 'FFFF', nickname: 'x', ageBand: '50', sex: 'M', ward: '3W', room: '301', location: 'er' }, tpl);
  eq('登録時のベッド表示', wp.bed, '3W-301');

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

  // 薬：抗菌薬の通算（1日でもあいたら数え直す・重なりは1日）
  const D = (n) => addDays('2026-11-01', n);
  const mp = { meds: [] };
  const ctrx = K.newMed({ name: 'CTRX', cat: 'abx', start: D(0) });
  K.endMed(ctrx, D(4));
  mp.meds.push(ctrx);
  mp.meds.push(K.newMed({ name: 'MEPM', cat: 'abx', start: D(5) }));
  eq('切り替え（すき間なし）は通算', K.abxRun(mp, D(5)).days, 6);
  eq('通算の表示', K.abxText(mp, D(6)), '抗菌薬 通算7日目');
  mp.meds[1].start = D(6);
  eq('1日あいたら数え直す', K.abxRun(mp, D(6)).days, 1);
  mp.meds[1].start = D(4);
  eq('同じ日に切り替えは1日', K.abxRun(mp, D(5)).days, 6);
  const fin = { meds: [ctrx] };
  eq('終わった抗菌薬の表示', K.abxText(fin, D(10)), '抗菌薬 計5日（11/1〜11/5）');
  eq('抗菌薬以外は数えない', K.abxRun({ meds: [K.newMed({ name: 'NAD', cat: 'vaso', start: D(0) })] }, D(3)), null);
  const m7 = K.newMed({ name: 'CEZ', cat: 'abx', start: D(0), planDays: 7 });
  eq('開始日が1日目', K.medDay(m7, D(0)), 1);
  eq('予定日数の表示', K.medStatus(m7, D(2)).text, '3/7日目');
  eq('最終日', K.medFinal(m7, D(6)), 'final');
  eq('予定を過ぎた', K.medFinal(m7, D(7)), 'over');
  eq('最終日の前は出ない', K.medFinal(m7, D(5)), null);
  eq('終了日は最後に使った日', (() => { const x = K.newMed({ name: 'x', cat: 'abx', start: D(0) }); K.endMed(x, D(6)); return K.medStatus(x, D(9)).text; })(), '11/1〜11/7（7日間）');
  const nad = K.newMed({ name: 'NAD', cat: 'vaso', start: D(0), unit: 'γ', rate: 0.1, rateAt: Date.parse('2026-11-01T10:00:00') });
  nad.rates.push({ at: Date.parse('2026-11-02T10:00:00'), value: 0.25 });
  eq('今の流量', K.curRate(nad, Date.parse('2026-11-02T12:00:00')).value, 0.25);
  K.endMed(nad, D(2), Date.parse('2026-11-03T09:00:00'));
  eq('流量の薬を止めると 0 を記録', [nad.end, nad.rates[nad.rates.length - 1].value], [D(2), 0]);
  K.reopenMed(nad);
  eq('終了の取り消し', [nad.end, nad.rates.length], [null, 2]);
  eq('数字の表示', K.fmtNum(0.15000000001), '0.15');

  // 過去へ移すと続いている薬は終わる
  const pm = M.newPatient({ code: 'MMMM', nickname: 'x', ageBand: '70', sex: 'M', location: 'inpatient', admitDate: addDays(ymd(), -3) }, tpl);
  pm.meds.push(K.newMed({ name: 'MEPM', cat: 'abx', start: addDays(ymd(), -3) }));
  M.applyEnding(pm, 'transfer_dept', tpl);
  M.moveToPast(pm);
  eq('過去へ移すと薬は終了', pm.meds[0].end, ymd());

  // 培養
  const cu = K.newCulture({ specimen: '血液', submitted: '2026-11-01' });
  eq('血液培養は2セット・3日後に確認', [cu.sets, cu.due, K.cultureTitle(cu)], [2, '2026-11-04', '血液培養 2セット']);
  ok('確認日に今日のタスク', K.cultureDue(cu, '2026-11-04') && !K.cultureDue(cu, '2026-11-03'));
  K.deferCulture(cu, '2026-11-05');
  ok('先送り', !K.cultureDue(cu, '2026-11-04'));
  K.setCultureStage(cu, 'prelim', '2026-11-03');
  eq('途中報告で次は2日後', [cu.stage, cu.due], ['prelim', '2026-11-05']);
  K.setCultureStage(cu, 'sens', '2026-11-05');
  eq('感受性はその日に確認', cu.due, '2026-11-05');
  K.setCultureStage(cu, 'done', '2026-11-05');
  ok('確認済で終わり', !K.cultureOpen(cu) && cu.due === null);
  eq('尿培養はセット数なし', K.newCulture({ specimen: '尿' }).sets, null);

  // 帰宅：結果の出ていない培養はフォローへ
  const hc = M.newPatient({ code: 'HHHH', nickname: '帰宅', ageBand: '40', sex: 'M', location: 'er' }, tpl);
  hc.tasks.forEach((t) => M.setState(t, 'done'));
  hc.cultures.push(K.newCulture({ specimen: '尿' }));
  M.applyEnding(hc, 'home', tpl);
  hc.tasks.filter((t) => t.group === 'home').forEach((t) => M.setState(t, 'done'));
  eq('結果待ちの培養があればフォローへ', M.progress(hc), 'toFollowup');
  M.moveToFollowup(hc);
  eq('フォロー中は培養の結果を待つ', M.progress(hc), null);
  K.setCultureStage(hc.cultures[0], 'negative');
  eq('陰性ならフォロー終了', M.progress(hc), 'askPast');
  const due = M.newPatient({ code: 'IIII', nickname: 'x', ageBand: '50', sex: 'F', location: 'inpatient', admitDate: ymd() }, tpl);
  const before = M.openCount(due);
  due.cultures.push(K.newCulture({ specimen: '痰', submitted: addDays(ymd(), -3) }));
  eq('確認日の培養は残りに数える', M.openCount(due), before + 1);

  // 培養の報告書の読み取り
  const ctext = '```\nMEDPILOT-CULTURE v1\n検体|血液\nグラム|GNR\n菌|1|Escherichia coli|\n感受性|1|ABPC|>16|R\n感受性|1|CTRX|<=1|感性\n感受性|1|LVFX|2|中間\n菌|2|Enterococcus faecalis|少数\n感受性|2|ABPC|<=2|S\n説明です\n```';
  const cr = K.parseCultureText(ctext);
  eq('検体とグラム', [cr.specimen, cr.gram], ['血液', 'GNR']);
  eq('菌の数', cr.organisms.map((o) => o.name), ['Escherichia coli', 'Enterococcus faecalis']);
  eq('判定の言い換え', cr.organisms[0].sens.map((x) => x.sir), ['R', 'S', 'I']);
  eq('耐性の一覧', K.resistant(cr.organisms[0]), ['ABPC']);
  eq('陰性', K.parseCultureText('MEDPILOT-CULTURE v1\n検体|尿\n菌|0|陰性|').negative, true);

  // 入っていない項目
  ok('すぐ登録は未入力あり', M.missingInfo(M.newPatient({ code: 'JJJJ', nickname: '', location: 'er' }, tpl)));
  ok('全部入っていれば印なし', !M.missingInfo({ encId: { x: 1 }, nickname: 'a', ageBand: '50', sex: 'M' }));

  // 朝のまとめ（識別番号とタスク名だけ）
  const day = '2026-12-01';
  const mo = M.newPatient({ code: '7K3F', nickname: '秘密の名前', ageBand: '80', sex: 'F', ward: '5E', room: '512', disease: '肺炎', location: 'inpatient', admitDate: '2026-11-20' }, tpl);
  mo.tasks.push(M.newTask({ label: '胸部CT', group: 'inpatient', dueDate: day }));
  mo.tasks.push(M.newTask({ label: '明日の予定', group: 'inpatient', dueDate: addDays(day, 1) }));
  mo.cultures.push(K.newCulture({ specimen: '血液', submitted: '2026-11-28' }));
  mo.meds.push(K.newMed({ name: 'MEPM', cat: 'abx', start: '2026-11-25', planDays: 7 }));
  mo.devices.push({ type: 'CV', insertedDate: '2026-11-17', removedDate: null });
  const msg = buildMorning([mo], day);
  ok('回診の人数', msg.message.startsWith('回診 1人'));
  ok('今日の予定', msg.message.includes('・7K3F 胸部CT') && !msg.message.includes('明日の予定'));
  ok('培養の確認と抗菌薬の最終日', msg.message.includes('7K3F 血液培養 2セット 確認') && msg.message.includes('7K3F MEPM 最終日'));
  ok('IC 7日超とデバイス 14日超', msg.message.includes('IC 7日超：7K3F') && msg.message.includes('7K3F CV（15日目）'));
  ok('あだ名・ベッド・病名・年代は出さない', !/秘密|5E|512|肺炎|80代|女性/.test(msg.title + msg.message));
  ok('何もない日', buildMorning([], day).message.includes('今日の予定なし'));
  ok('受け取り先の名前', /^medpilot-[A-Za-z0-9]{22}$/.test(newTopic()));

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
