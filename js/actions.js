// 患者まわりの共通の操作（どの画面からでも使う）

import { esc, ymd, addDays, md, mdw, $ } from './util.js';
import { state, findPatient, savePatient, removePatient, saveMeta, remember, wipeIds } from './store.js';
import * as M from './model.js';
import * as ui from './ui.js';
import { go, back, backTo, render, current } from './router.js';
import { openPrivate, decryptId } from './crypto.js';
import { historyOf } from './labs.js';

const P = (ds) => findPatient(ds.pid);

// 病棟（選択）＋病室（数字）の入力欄
export function wardRoomFields(prefix, ward = '', room = '') {
  const opts = ['<option value="">選ぶ</option>', ...M.WARDS.map((w) => `<option value="${w}" ${w === ward ? 'selected' : ''}>${w}</option>`)].join('');
  return `<div class="ward-room"><select id="${prefix}-ward" aria-label="病棟">${opts}</select><input id="${prefix}-room" type="text" inputmode="numeric" pattern="[0-9]*" maxlength="4" value="${esc(room)}" placeholder="病室（数字）" aria-label="病室" autocomplete="off"></div>`;
}
const T = (p, ds) => p && p.tasks.find((t) => t.id === ds.tid);

function listScreenFor(p) {
  if (p.location === 'inpatient') return 'inList';
  if (p.location === 'followup') return 'followup';
  if (p.location === 'past') return 'past';
  return 'erList';
}

function patientScreenFor(p) {
  if (p.location === 'inpatient') return 'inPatient';
  if (p.location === 'past') return 'pastView';
  if (p.location === 'followup') return 'followup';
  return 'erPatient';
}

export function openPatient(p, opts) {
  const s = patientScreenFor(p);
  go(s, s === 'followup' ? {} : { id: p.id }, opts);
}

// 終わったときに「過去の一覧に残すか」を聞く
async function askPast(p, title) {
  const v = await ui.choose(title, '過去の一覧に残しますか？', [
    { v: 'keep', label: '残す', tone: 'btn' },
    { v: 'del', label: '残さない（削除する）', tone: 'danger' },
    { v: 'later', label: 'まだ終わらない', tone: 'btn2' },
  ]);
  if (!v || v === 'later') return false;
  const listScreen = listScreenFor(p);
  if (v === 'del') {
    await removePatient(p);
    ui.toast('削除しました');
  } else {
    M.moveToPast(p);
    await savePatient(p);
    ui.toast('過去の一覧に移しました');
  }
  backTo(listScreen);
  return true;
}

// タスクが動いたあとの流れ
export async function afterChange(p) {
  const r = M.progress(p);
  if (!r) return false;
  if (r === 'toInpatient') {
    const v = await ui.choose('入院の手続きがすべて終わりました', '入院患者の画面に移しますか？', [
      { v: 'go', label: '入院患者に移す', tone: 'btn' },
      { v: 'later', label: 'まだ', tone: 'btn2' },
    ]);
    if (v !== 'go') return false;
    M.moveToInpatient(p);
    await savePatient(p);
    ui.toast(p.ward === 'ER' || !p.ward ? '入院患者に移しました。「編集」から病棟と病室を入れてください' : '入院患者に移しました');
    go('inPatient', { id: p.id }, { replace: true });
    return true;
  }
  if (r === 'toFollowup') {
    const n = p.tasks.filter(M.isOpen).length;
    const v = await ui.choose('帰宅の準備が終わりました', `終わっていないタスク（${n}件）を帰宅後フォローに移しますか？`, [
      { v: 'go', label: '帰宅後フォローに移す', tone: 'btn' },
      { v: 'later', label: 'まだ', tone: 'btn2' },
    ]);
    if (v !== 'go') return false;
    M.moveToFollowup(p);
    await savePatient(p);
    ui.toast('帰宅後フォローに移しました（期限は3日後。変えられます）');
    go('followup', {}, { replace: true });
    return true;
  }
  if (r === 'askPast') {
    const title = p.location === 'followup' ? 'フォローがすべて終わりました' : 'タスクがすべて終わりました';
    return askPast(p, title);
  }
  return false;
}

async function editDate(initial) {
  return ui.custom(`<div class="sheet-title">日付を選ぶ</div>
    <input id="sheet-date" type="date" value="${esc(initial || ymd())}">
    <div class="grid2"><button class="btn3" data-act="sheetCancel">やめる</button><button class="btn" data-act="dateOk">決定</button></div>`);
}

async function taskSheet(p, { title = 'タスクを追加', withDate = false, defaultDate = '' } = {}) {
  const sug = state.meta.history.tasks || [];
  const html = `<div class="sheet-title">${esc(title)}</div>
    <label class="lbl" for="sheet-input">タスクの名前</label>
    <input id="sheet-input" type="text" autocomplete="off" placeholder="例：喀痰培養の提出">
    ${sug.length ? `<div class="chips-row">${sug.slice(0, 12).map((s) => `<button class="pill" data-act="sheetSuggest" data-v="${esc(s)}">${esc(s)}</button>`).join('')}</div>` : ''}
    <div class="lbl">段階</div>
    <div class="seg" data-pick="steps"><button class="on" data-act="pick" data-v="2">未 → 済</button><button data-act="pick" data-v="3">オーダー → 結果 → 確認</button></div>
    ${withDate ? `<label class="lbl" for="sheet-date">日付（予定・期限）</label><input id="sheet-date" type="date" value="${esc(defaultDate)}">` : ''}
    <div class="err" id="sheet-err"></div>
    <div class="grid2"><button class="btn3" data-act="sheetCancel">やめる</button><button class="btn" data-act="taskOk">追加する</button></div>`;
  return ui.custom(html);
}

function groupFor(p) {
  if (p.location === 'followup') return 'followup';
  if (p.location === 'inpatient') return 'inpatient';
  return 'er';
}

// ---- ID を表示（郵便ポスト方式） ----
let revealTimer = null;

export async function showIdSheet(p) {
  if (!p.encId) {
    ui.toast('この患者の ID は保存されていません');
    return;
  }
  if (!state.meta.idKeys) {
    ui.toast('合言葉が設定されていません（設定から設定できます）');
    return;
  }
  ui.sheet(`<div class="sheet-title">${esc(p.code)}　${esc(p.nickname)} の ID</div>
    <label class="lbl" for="pass-input">合言葉を入れると ID を表示します</label>
    <div class="row-gap"><input id="pass-input" type="password" autocomplete="off" autocapitalize="off" spellcheck="false"><button class="btn small-btn" data-act="revealGo" data-pid="${p.id}">表示</button></div>
    <div class="err" id="reveal-err"></div>
    <div id="reveal-out"></div>
    <div class="muted tiny">合言葉を5回続けて間違えると、保存した ID はすべて消えます。</div>
    <button class="btn3" data-act="sheetCancel">閉じる</button>`, {
    onClose: () => { clearInterval(revealTimer); revealTimer = null; },
  });
}

export const patientActions = {
  back() { back(); },

  openPatient(ds) {
    const p = findPatient(ds.id || ds.pid);
    if (p) openPatient(p);
  },

  // タップすると選択肢が出て、状態を選ぶ
  async tapTask(ds) {
    const p = P(ds);
    const t = T(p, ds);
    if (!t) return;
    const states = M.stateChoices(t).map(([k, l]) => ({ v: `s:${k}`, label: l, tone: k === t.state ? 'btn' : 'btn2' }));
    const more = [{ v: 'rename', label: '名前を変える', tone: 'btn3' }];
    if (p.location !== 'er' || t.dueDate) more.push({ v: 'date', label: t.dueDate ? `日付を変える（${md(t.dueDate)}）` : '日付を付ける', tone: 'btn3' });
    more.push({ v: 'delete', label: '削除する', tone: 'danger' });
    const v = await ui.choose(t.label, `今：${M.stateInfo(t).text}`, [...states, ...more]);
    if (!v) return;
    if (v.startsWith('s:')) {
      const s = v.slice(2);
      if (s === t.state) return;
      M.setState(t, s);
      if (t.kind === 'ic' && s === 'done') p.lastICDate = ymd();
      await savePatient(p);
      render();
      if (M.progress(p)) {
        await afterChange(p);
        return;
      }
      ui.toast(`${t.label}：${M.stateInfo(t).text}`);
      return;
    }
    if (v === 'rename') {
      const name = await ui.promptText({ title: '名前を変える', value: t.label });
      if (!name) return;
      t.label = name;
    }
    if (v === 'date') {
      const d = await editDate(t.dueDate);
      if (d === null) return;
      t.dueDate = d || null;
    }
    if (v === 'delete') {
      const ok = await ui.choose('このタスクを削除しますか？', esc(t.label), [{ v: 'yes', label: '削除する', tone: 'danger' }]);
      if (ok !== 'yes') return;
      p.tasks = p.tasks.filter((x) => x !== t);
    }
    await savePatient(p);
    render();
    if (v === 'delete') await afterChange(p);
  },

  lpTask(ds) {
    return patientActions.tapTask(ds);
  },

  async addSame(ds) {
    const p = P(ds);
    const tpl = state.meta.templates.er;
    const kind = await ui.choose('同じ種類を追加', 'どの種類を増やしますか？', tpl.map((x, i) => ({ v: String(i), label: x.label })));
    if (kind === null) return;
    const base = tpl[Number(kind)];
    const name = await ui.promptText({ title: `${base.label}を追加`, label: '名前（例：CT、MRI、整形外科）', placeholder: '何の検査・どこへのコンサルトか' });
    if (name === null) return;
    const label = name ? `${base.label}（${name}）` : base.label;
    p.tasks.push(M.newTask({ label, steps: base.steps, kind: base.kind, group: 'er' }));
    await savePatient(p);
    render();
  },

  async addTask(ds) {
    const p = P(ds);
    const withDate = p.location !== 'er';
    const def = p.location === 'followup' ? addDays(ymd(), 3) : '';
    const r = await taskSheet(p, { withDate, defaultDate: def, title: ds.dated ? '日付つきの予定を追加' : 'タスクを追加' });
    if (!r) return;
    p.tasks.push(M.newTask({ label: r.label, steps: r.steps, kind: 'free', group: groupFor(p), dueDate: r.dueDate || (p.location === 'followup' ? def : null) }));
    await remember('tasks', r.label);
    await savePatient(p);
    render();
  },

  taskOk() {
    const label = ($('#sheet-input').value || '').trim();
    if (!label) {
      $('#sheet-err').textContent = '名前を入れてください';
      return;
    }
    const on = $('.seg[data-pick="steps"] .on');
    const dateEl = $('#sheet-date');
    ui.resolveSheet({ label, steps: on ? Number(on.dataset.v) : 2, dueDate: dateEl ? dateEl.value : '' });
  },

  dateOk() {
    ui.resolveSheet($('#sheet-date').value || '');
  },

  // 同じグループのボタンの中で 1 つを選ぶ（再描画しない）
  pick(ds, el) {
    const g = el.closest('[data-pick]');
    if (!g) return;
    g.querySelectorAll('[data-v]').forEach((b) => b.classList.toggle('on', b === el));
    g.dispatchEvent(new CustomEvent('picked', { bubbles: true, detail: { group: g.dataset.pick, value: ds.v } }));
  },

  async editCode(ds) {
    const p = P(ds);
    const v = await ui.choose('CODE', '', Object.entries(M.CODE_STATUS).map(([k, l]) => ({ v: k, label: l, tone: k === p.codeStatus ? 'btn' : 'btn2' })));
    if (!v) return;
    p.codeStatus = v;
    await savePatient(p);
    render();
  },

  async editPatient(ds) {
    const p = P(ds);
    const ages = M.AGE_BANDS.map((b) => `<button class="${b === p.ageBand ? 'on' : ''}" data-act="pick" data-v="${b}">${M.ageButton(b)}</button>`).join('');
    const r = await ui.custom(`<div class="sheet-title">${esc(p.code)} を編集</div>
      <label class="lbl" for="e-nick">あだ名</label><input id="e-nick" type="text" value="${esc(p.nickname)}" autocomplete="off">
      <div class="lbl">年代</div><div class="seg wrap6" data-pick="age">${ages}</div>
      <div class="lbl">性別</div><div class="seg" data-pick="sex"><button class="${p.sex === 'M' ? 'on' : ''}" data-act="pick" data-v="M">男性</button><button class="${p.sex === 'F' ? 'on' : ''}" data-act="pick" data-v="F">女性</button></div>
      <div class="lbl">病棟・病室</div>${wardRoomFields('e', p.ward || M.parseBed(p.bed).ward, p.room || M.parseBed(p.bed).room)}
      <label class="lbl" for="e-dx">病名</label><input id="e-dx" type="text" value="${esc(p.disease)}" autocomplete="off">
      ${p.admitDate ? `<label class="lbl" for="e-adm">入院日</label><input id="e-adm" type="date" value="${esc(p.admitDate)}">` : ''}
      <div class="grid2"><button class="btn3" data-act="sheetCancel">やめる</button><button class="btn" data-act="editOk">保存</button></div>
      <button class="danger" data-act="sheetChoose" data-v="__delete">この患者を削除</button>`, { });
    if (!r) return;
    if (r === '__delete') {
      const ok = await ui.choose('この患者を削除しますか？', `${esc(p.code)} ${esc(p.nickname)}。元に戻せません。`, [{ v: 'yes', label: '削除する', tone: 'danger' }]);
      if (ok !== 'yes') return;
      const ls = listScreenFor(p);
      await removePatient(p);
      ui.toast('削除しました');
      backTo(ls);
      return;
    }
    Object.assign(p, r);
    await remember('diseases', p.disease);
    await savePatient(p);
    render();
  },

  editOk() {
    const val = (id) => ($(id) ? $(id).value.trim() : undefined);
    const nick = val('#e-nick');
    if (!nick) return;
    const age = $('.seg[data-pick="age"] .on');
    const sex = $('.seg[data-pick="sex"] .on');
    const ward = $('#e-ward').value;
    const room = $('#e-room').value.trim();
    const out = { nickname: nick, ward, room, bed: M.bedLabel(ward, room), disease: val('#e-dx') };
    if (age) out.ageBand = age.dataset.v;
    if (sex) out.sex = sex.dataset.v;
    if ($('#e-adm') && $('#e-adm').value) out.admitDate = $('#e-adm').value;
    ui.resolveSheet(out);
  },

  async labHistory(ds) {
    const p = P(ds);
    const it = state.meta.labItems.find((x) => x.id === ds.item);
    if (!p || !it) return;
    const rows = historyOf(p, it.id)
      .map((l) => `<div class="kv"><span>${mdw(l.date)}${l.draw > 1 ? `　${l.draw}回目` : ''}</span><span class="${l.flag === 'H' ? 'hi' : l.flag === 'L' ? 'lo' : ''}">${esc(l.value)} ${esc(l.flag)}</span></div>`)
      .join('');
    ui.sheet(`<div class="sheet-title">${esc(it.abbr)}${it.unit ? `<span class="muted small">　${esc(it.unit)}</span>` : ''}</div><div class="list">${rows}</div>
      <button class="btn3" data-act="sheetCancel">閉じる</button>`);
  },

  openLabImport(ds) {
    go('labImport', { id: ds.pid });
  },

  // ---- デバイス ----
  async addDevice(ds) {
    const p = P(ds);
    const r = await ui.custom(`<div class="sheet-title">デバイスを追加</div>
      <div class="seg wrap3" data-pick="dev">${M.DEVICE_TYPES.map((d, i) => `<button class="${i === 0 ? 'on' : ''}" data-act="pick" data-v="${esc(d)}">${esc(d)}</button>`).join('')}</div>
      <label class="lbl" for="sheet-date">入れた日</label><input id="sheet-date" type="date" value="${ymd()}">
      <div class="grid2"><button class="btn3" data-act="sheetCancel">やめる</button><button class="btn" data-act="deviceOk">追加する</button></div>`);
    if (!r) return;
    p.devices = p.devices || [];
    p.devices.push({ id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()), type: r.type, insertedDate: r.date, removedDate: null });
    await savePatient(p);
    render();
  },

  deviceOk() {
    const on = $('.seg[data-pick="dev"] .on');
    ui.resolveSheet({ type: on ? on.dataset.v : M.DEVICE_TYPES[0], date: $('#sheet-date').value || ymd() });
  },

  async removeDevice(ds) {
    const p = P(ds);
    const d = (p.devices || []).find((x) => x.id === ds.did);
    if (!d) return;
    const prev = d.removedDate;
    d.removedDate = ymd();
    await savePatient(p);
    render();
    ui.toast(`${d.type}を抜去にしました`, async () => {
      d.removedDate = prev;
      await savePatient(p);
      render();
    });
  },

  async lpDevice(ds) {
    const p = P(ds);
    const d = (p.devices || []).find((x) => x.id === ds.did);
    if (!d) return;
    const opts = [{ v: 'in', label: `入れた日を変える（${md(d.insertedDate)}）` }];
    if (d.removedDate) opts.push({ v: 'out', label: `抜いた日を変える（${md(d.removedDate)}）` }, { v: 'undo', label: '抜去を取り消す' });
    opts.push({ v: 'del', label: '削除する', tone: 'danger' });
    const v = await ui.choose(d.type, '', opts);
    if (!v) return;
    if (v === 'in' || v === 'out') {
      const nd = await editDate(v === 'in' ? d.insertedDate : d.removedDate);
      if (!nd) return;
      if (v === 'in') d.insertedDate = nd; else d.removedDate = nd;
    }
    if (v === 'undo') d.removedDate = null;
    if (v === 'del') p.devices = p.devices.filter((x) => x !== d);
    await savePatient(p);
    render();
  },

  // ---- 終わり方 ----
  async erEnd(ds) {
    const p = P(ds);
    const e = M.ER_ENDINGS[ds.type];
    let dept = '';
    if (ds.type === 'admit_other') {
      dept = await ui.promptText({ title: '他科に入院', label: '入院する科（空欄でも可）', placeholder: '例：脳外科' });
      if (dept === null) return;
    } else {
      const ok = await ui.choose(`${e.label}にしますか？`, e.list ? `「${M.GROUP_TITLES[e.list]}」のリストを追加します。` : '', [{ v: 'yes', label: `${e.label}にする`, tone: 'btn' }]);
      if (ok !== 'yes') return;
    }
    M.applyEnding(p, ds.type, state.meta.templates, dept);
    await savePatient(p);
    render();
    await afterChange(p);
  },

  async inEnd(ds) {
    const p = P(ds);
    const v = await ui.choose('終わり方を選ぶ', '', Object.entries(M.IN_ENDINGS).map(([k, e]) => ({ v: k, label: e.label })));
    if (!v) return;
    M.applyEnding(p, v, state.meta.templates);
    await savePatient(p);
    render();
    await afterChange(p);
  },

  async cancelEnding(ds) {
    const p = P(ds);
    const ok = await ui.choose('終わり方を取り消しますか？', '追加したリストのうち、まだ済んでいないものは消えます。', [{ v: 'yes', label: '取り消す', tone: 'btn' }]);
    if (ok !== 'yes') return;
    M.cancelEnding(p);
    await savePatient(p);
    render();
  },

  async homeDone(ds) {
    const p = P(ds);
    const n = p.tasks.filter(M.isOpen).length;
    if (!n) {
      await askPast(p, '帰宅しました');
      return;
    }
    const v = await ui.choose('帰宅の処理を終える', `終わっていないタスク（${n}件）を帰宅後フォローに移します。`, [{ v: 'go', label: '帰宅後フォローに移す', tone: 'btn' }]);
    if (v !== 'go') return;
    M.moveToFollowup(p);
    await savePatient(p);
    ui.toast('帰宅後フォローに移しました（期限は3日後。変えられます）');
    go('followup', {}, { replace: true });
  },

  async endFollow(ds) {
    const p = P(ds);
    await askPast(p, 'フォローを終える');
  },

  async deletePast(ds) {
    const p = P(ds);
    const ok = await ui.choose('この記録を削除しますか？', `${esc(p.code)} ${esc(p.nickname)}。元に戻せません。`, [{ v: 'yes', label: '削除する', tone: 'danger' }]);
    if (ok !== 'yes') return;
    await removePatient(p);
    ui.toast('削除しました');
    backTo('past');
  },

  // ---- ID ----
  revealId(ds) {
    const p = P(ds);
    if (p) showIdSheet(p);
  },

  async revealGo(ds) {
    const p = P(ds);
    const inp = $('#pass-input');
    const err = $('#reveal-err');
    const out = $('#reveal-out');
    if (!inp || !p) return;
    const pass = inp.value;
    if (!pass) { err.textContent = '合言葉を入れてください'; return; }
    err.textContent = '確認しています…';
    const sec = state.meta.security;
    let id;
    try {
      const key = await openPrivate(state.meta.idKeys, pass);
      id = await decryptId(key, p.encId);
    } catch (e) {
      inp.value = '';
      sec.passFails = (sec.passFails || 0) + 1;
      await saveMeta('security');
      if (sec.passFails >= 5) {
        await wipeIds();
        ui.closeSheet();
        ui.toast('合言葉を5回間違えたため、保存した ID をすべて消しました');
        render();
        return;
      }
      err.textContent = `合言葉が違います（あと ${5 - sec.passFails} 回間違えると ID がすべて消えます）`;
      return;
    }
    sec.passFails = 0;
    await saveMeta('security');
    inp.value = '';
    err.textContent = '';
    let left = 30;
    out.innerHTML = `<div class="idbox"><div class="muted small">ID</div><div class="idnum">${esc(id.slice(0, 4))} ${esc(id.slice(4))}</div></div><div class="warn-a right" id="reveal-timer">あと ${left} 秒で消えます</div>`;
    clearInterval(revealTimer);
    revealTimer = setInterval(() => {
      left -= 1;
      const tm = $('#reveal-timer');
      if (left <= 0 || !tm) {
        clearInterval(revealTimer);
        revealTimer = null;
        if (tm) ui.closeSheet();
        return;
      }
      tm.textContent = `あと ${left} 秒で消えます`;
    }, 1000);
  },

  async idLookup() {
    const code = await ui.promptText({ title: '識別番号から ID を調べる', label: '識別番号（4文字）', placeholder: '例：7K3F' });
    if (!code) return;
    const c = code.normalize('NFKC').toUpperCase().replace(/\s/g, '');
    const p = state.patients.find((x) => x.code === c);
    if (!p) {
      ui.toast(`${c} の患者は見つかりません`);
      return;
    }
    showIdSheet(p);
  },
};

export { listScreenFor, patientScreenFor, current };
