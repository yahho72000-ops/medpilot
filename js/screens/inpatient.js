// 入院患者：一覧・患者ページ

import { esc, md, mdw, ymd, dayKey } from '../util.js';
import { state, findPatient, savePatient, saveMeta } from '../store.js';
import * as M from '../model.js';
import { go, render } from '../router.js';
import { header, chip, demo, codeText, patientCard, taskRow, taskChip, labGrid, devicesBlock, sec, emptyState } from './common.js';
import * as ui from '../ui.js';

function rowChips(p) {
  const out = [];
  const d = M.dailyGet(p);
  if (d.visit === 'todo') out.push(chip('回診 未', 'r'));
  if (M.bloodOpen(d.blood)) out.push(chip(M.BLOOD[d.blood].short, M.BLOOD[d.blood].tone));
  const open = M.openTasks(p);
  const admitOpen = open.filter((t) => t.group === 'admit').length;
  if (admitOpen) out.push(chip(`入院手続き 残り${admitOpen}`, 'r'));
  for (const t of open.filter((x) => x.group !== 'admit')) out.push(taskChip(t));
  if (M.icWarn(p)) out.push(chip(`家族IC ${M.icDays(p)}日前`, 'r', 'bold'));
  for (const dv of M.activeDevices(p).filter(M.deviceWarn)) out.push(chip(`${dv.type} ${M.deviceDay(dv)}日目`, 'r', 'bold'));
  if (p.transferStart) out.push(chip(`転院調整中（${md(p.transferStart)}〜）`, 'g'));
  return out.join('');
}

// ---- 一覧 ----
export const inListScreen = {
  render() {
    const mode = state.meta.settings.inpatientSort || 'days';
    const list = M.sortInpatients(state.patients.filter((p) => p.location === 'inpatient'), mode);
    const sorts = Object.entries(M.IN_SORTS)
      .map(([k, l]) => `<button class="pill ${k === mode ? 'on' : ''}" data-act="inSort" data-v="${k}">${l}</button>`)
      .join('');
    const rows = list
      .map((p, i) => {
        const tag = p.ending ? `<span class="tag">${esc(M.endingLabel(p))}</span>` : '';
        const move = mode === 'manual'
          ? `<div class="move"><button class="mini" data-act="moveUp" data-pid="${p.id}" ${i === 0 ? 'disabled' : ''} aria-label="上へ">▲</button><button class="mini" data-act="moveDown" data-pid="${p.id}" ${i === list.length - 1 ? 'disabled' : ''} aria-label="下へ">▼</button></div>`
          : '';
        return `<div class="lrow-wrap"><button class="lrow" data-act="openPatient" data-id="${p.id}">
            <div class="row-between"><div class="nameline"><span class="code">${esc(p.code)}</span><span class="muted">${p.bed ? `　${esc(p.bed)}` : ''}　${esc(p.nickname)}</span></div><div class="muted small">入院${M.hospitalDay(p)}日目</div></div>
            <div class="row-gap wrap">${tag}<span class="muted small">${esc(demo(p))} ・ ${esc(codeText(p))}</span></div>
            <div class="chips-row">${rowChips(p)}</div>
          </button>${move}</div>`;
      })
      .join('');
    return `${header(`入院患者　${list.length}人`, 'メニュー')}
      <div class="chips-row">${sorts}</div>
      <div class="lrows">${rows || emptyState('入院患者はいません')}</div>
      <div class="bottom-space"></div>
      <button class="btn fixed-bottom" data-act="goRegister" data-to="in">＋ 入院患者を登録</button>`;
  },
  actions: {
    async inSort(ds) {
      if (ds.v === 'manual') {
        // 今の並びを手動の並びの出発点にする
        const cur = M.sortInpatients(state.patients.filter((p) => p.location === 'inpatient'), state.meta.settings.inpatientSort);
        let i = 0;
        for (const p of cur) { p.manualOrder = i++; await savePatient(p); }
      }
      state.meta.settings.inpatientSort = ds.v;
      await saveMeta('settings');
      render();
    },
    async moveUp(ds) { await move(ds.pid, -1); },
    async moveDown(ds) { await move(ds.pid, 1); },
    goRegister(ds) { go('register', { to: ds.to }); },
  },
};

async function move(pid, dir) {
  const list = M.sortInpatients(state.patients.filter((p) => p.location === 'inpatient'), 'manual');
  const i = list.findIndex((p) => p.id === pid);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= list.length) return;
  [list[i], list[j]] = [list[j], list[i]];
  for (let k = 0; k < list.length; k++) {
    if (list[k].manualOrder !== k) { list[k].manualOrder = k; await savePatient(list[k]); }
  }
  render();
}

// ---- 患者ページ ----
function dailyRows(p) {
  const d = M.dailyGet(p);
  const visit = d.visit === 'done' ? chip('済', 'g') : chip('未', 'r');
  const b = M.BLOOD[d.blood] || M.BLOOD.unknown;
  const blood = chip(b.text, b.tone);
  return `<div class="trow" data-act="tapDaily" data-f="visit" data-pid="${p.id}"><div class="tlabel">回診</div><div class="tstate">${visit}</div></div>
    <div class="trow" data-act="tapDaily" data-f="blood" data-pid="${p.id}"><div class="tlabel">今日の採血</div><div class="tstate">${blood}</div></div>`;
}

export const inPatientScreen = {
  render({ id }) {
    const p = findPatient(id);
    if (!p || p.location !== 'inpatient') return `${header('患者', '入院患者')}${emptyState('この患者は入院患者にいません')}`;
    const todayKey = dayKey();
    // 済んだものは、入院後に追加したタスクだけ「今日」の間は見えるようにする
    const doneToday = (t) => !M.isOpen(t) && t.group === 'inpatient' && t.doneAt && dayKey(new Date(t.doneAt)) === todayKey;
    const listGroup = p.ending && (M.IN_ENDINGS[p.ending.type] || {}).list;
    const todayTasks = p.tasks.filter((t) => t.group !== listGroup && t.group !== 'admit' && ((M.isOpen(t) && M.isDueNow(t)) || doneToday(t)));
    const future = M.futureTasks(p).filter((t) => t.group !== listGroup && t.group !== 'admit');
    const listTasks = listGroup ? p.tasks.filter((t) => t.group === listGroup) : [];
    // 入院の手続き：まだ残っている間だけ表示する
    const admitTasks = p.tasks.filter((t) => t.group === 'admit');
    const admitOpen = admitTasks.filter(M.isOpen).length;
    const icd = M.icDays(p);
    const icText = p.lastICDate ? `前回 ${mdw(p.lastICDate)}（${icd}日前）` : `まだ（入院から${icd}日）`;
    const problems = (p.problems || [])
      .map((x, i) => `<div class="prob" data-act="lpProblem" data-pid="${p.id}" data-i="${i}">#${i + 1}　${esc(x)}</div>`)
      .join('');
    const notes = (p.notes || [])
      .slice()
      .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b.at - a.at))
      .map((n) => `<div class="note" data-act="lpNote" data-pid="${p.id}" data-nid="${n.id}"><span class="muted note-date">${md(n.date)}</span><span class="note-text">${esc(n.text)}</span></div>`)
      .join('');
    const endingBox = p.ending
      ? `<div class="card ending"><div class="row-between"><div><span class="tag">${esc(M.endingLabel(p))}</span><span class="muted small">　${md(p.ending.at)}</span></div><button class="mini" data-act="cancelEnding" data-pid="${p.id}">取り消す</button></div></div>`
      : '';
    return `${header('患者', '入院患者')}
      ${patientCard(p, `${demo(p)} ・ 入院${M.hospitalDay(p)}日目（${md(p.admitDate)}〜）`)}
      ${endingBox}
      ${listTasks.length ? `${sec(M.GROUP_TITLES[listGroup])}<div class="tlist">${listTasks.map((t) => taskRow(p, t)).join('')}</div>` : ''}
      ${admitOpen ? `${sec(`入院の手続き（残り${admitOpen}）`)}<div class="tlist">${admitTasks.map((t) => taskRow(p, t)).join('')}</div>` : ''}
      ${sec('今日のタスク（朝6時にリセット）')}
      <div class="tlist">${dailyRows(p)}${todayTasks.map((t) => taskRow(p, t)).join('')}</div>
      ${future.length ? `<div class="future">${future.map((t) => `<div class="frow" data-act="tapTask" data-pid="${p.id}" data-tid="${t.id}">予定　${mdw(t.dueDate)}　${esc(t.label)}</div>`).join('')}</div>` : ''}
      <div class="grid2"><button class="btn2" data-act="addTask" data-pid="${p.id}">＋ タスク</button><button class="btn2" data-act="addTask" data-pid="${p.id}" data-dated="1">＋ 日付つき予定</button></div>
      ${sec('Problem List', `<button class="mini" data-act="addProblem" data-pid="${p.id}">＋ 追加</button>`)}
      <div class="card plist">${problems || '<div class="muted small">まだありません</div>'}</div>
      ${sec('最新の検査値')}
      ${labGrid(p)}
      <button class="btn2" data-act="openLabImport" data-pid="${p.id}">検査値を読み込む</button>
      ${sec('デバイス', `<button class="mini" data-act="addDevice" data-pid="${p.id}">＋ 追加</button>`)}
      <div class="card kvlist">${devicesBlock(p)}</div>
      ${sec('家族IC・退院・転院')}
      <div class="card kvlist">
        <div class="kv"><span>家族IC</span><span>${M.icWarn(p) ? chip(icText, 'r', 'bold') : `<span class="muted">${esc(icText)}</span>`}<button class="mini" data-act="icToday" data-pid="${p.id}">今日した</button></span></div>
        <div class="kv" data-act="setOutlook" data-pid="${p.id}"><span>退院見込み</span><span class="muted">${esc(M.OUTLOOKS[p.outlook] || '未設定')} ›</span></div>
        <div class="kv" data-act="setTransfer" data-pid="${p.id}"><span>転院調整</span><span class="muted">${p.transferStart ? `開始 ${mdw(p.transferStart)}` : 'まだ'} ›</span></div>
      </div>
      ${sec('経過メモ', `<button class="mini" data-act="addNote" data-pid="${p.id}">＋ 書く</button>`)}
      <div class="notes">${notes || '<div class="muted small">まだありません</div>'}</div>
      ${p.ending ? '' : `<button class="btn3" data-act="inEnd" data-pid="${p.id}">終わり方を選ぶ（退院・転院・転科・死亡）</button>`}`;
  },
  actions: {
    async tapDaily(ds) {
      const p = findPatient(ds.pid);
      const d = M.dailyGet(p);
      const isVisit = ds.f === 'visit';
      const opts = isVisit
        ? [['todo', '未'], ['done', '済']]
        : Object.entries(M.BLOOD).map(([k, b]) => [k, b.text]);
      const cur = d[ds.f];
      const v = await ui.choose(isVisit ? '回診' : '今日の採血', '', opts.map(([k, l]) => ({ v: k, label: l, tone: k === cur ? 'btn' : 'btn2' })));
      if (!v || v === cur) return;
      M.dailySet(p, ds.f, v);
      await savePatient(p);
      render();
      ui.toast(`${isVisit ? '回診' : '今日の採血'}：${opts.find(([k]) => k === v)[1]}`);
    },
    async icToday(ds) {
      const p = findPatient(ds.pid);
      const before = p.lastICDate;
      p.lastICDate = ymd();
      await savePatient(p);
      render();
      ui.toast('家族IC：今日にしました', async () => { p.lastICDate = before; await savePatient(p); render(); });
    },
    async setOutlook(ds) {
      const p = findPatient(ds.pid);
      const v = await ui.choose('退院見込み', '', [...Object.entries(M.OUTLOOKS).map(([k, l]) => ({ v: k, label: l, tone: k === p.outlook ? 'btn' : 'btn2' })), { v: '__clear', label: '未設定に戻す', tone: 'btn3' }]);
      if (!v) return;
      p.outlook = v === '__clear' ? null : v;
      await savePatient(p);
      render();
    },
    async setTransfer(ds) {
      const p = findPatient(ds.pid);
      const opts = p.transferStart
        ? [{ v: 'date', label: '開始日を変える' }, { v: 'clear', label: '「まだ」に戻す', tone: 'btn3' }]
        : [{ v: 'today', label: '今日開始にする', tone: 'btn' }, { v: 'date', label: '日付を選んで開始' }];
      const v = await ui.choose('転院調整', p.transferStart ? `開始 ${mdw(p.transferStart)}` : 'まだ始めていません', opts);
      if (!v) return;
      if (v === 'today') p.transferStart = ymd();
      if (v === 'clear') p.transferStart = null;
      if (v === 'date') {
        const d = await ui.custom(`<div class="sheet-title">転院調整の開始日</div><input id="sheet-date" type="date" value="${p.transferStart || ymd()}"><div class="grid2"><button class="btn3" data-act="sheetCancel">やめる</button><button class="btn" data-act="dateOk">決定</button></div>`);
        if (!d) return;
        p.transferStart = d;
      }
      await savePatient(p);
      render();
    },
    async addProblem(ds) {
      const p = findPatient(ds.pid);
      const t = await ui.promptText({ title: 'Problem List に追加', placeholder: '例：誤嚥性肺炎' });
      if (!t) return;
      p.problems = [...(p.problems || []), t];
      await savePatient(p);
      render();
    },
    async lpProblem(ds) {
      const p = findPatient(ds.pid);
      const i = Number(ds.i);
      const v = await ui.choose(`#${i + 1}　${p.problems[i]}`, '', [
        { v: 'edit', label: '書き直す' },
        ...(i > 0 ? [{ v: 'up', label: '上へ' }] : []),
        { v: 'del', label: '削除する', tone: 'danger' },
      ]);
      if (!v) return;
      if (v === 'edit') {
        const t = await ui.promptText({ title: '書き直す', value: p.problems[i] });
        if (!t) return;
        p.problems[i] = t;
      }
      if (v === 'up') [p.problems[i - 1], p.problems[i]] = [p.problems[i], p.problems[i - 1]];
      if (v === 'del') p.problems.splice(i, 1);
      await savePatient(p);
      render();
    },
    async addNote(ds) {
      const p = findPatient(ds.pid);
      const t = await ui.promptText({ title: `経過メモ（${md(ymd())}）`, multiline: true, placeholder: '例：解熱。食事5割摂取。' });
      if (!t) return;
      p.notes = [...(p.notes || []), { id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()), date: ymd(), at: Date.now(), text: t }];
      await savePatient(p);
      render();
    },
    async lpNote(ds) {
      const p = findPatient(ds.pid);
      const n = (p.notes || []).find((x) => x.id === ds.nid);
      if (!n) return;
      const v = await ui.choose(`${md(n.date)} のメモ`, esc(n.text), [{ v: 'edit', label: '書き直す' }, { v: 'del', label: '削除する', tone: 'danger' }]);
      if (!v) return;
      if (v === 'edit') {
        const t = await ui.promptText({ title: '書き直す', value: n.text, multiline: true });
        if (!t) return;
        n.text = t;
      }
      if (v === 'del') p.notes = p.notes.filter((x) => x !== n);
      await savePatient(p);
      render();
    },
  },
};
