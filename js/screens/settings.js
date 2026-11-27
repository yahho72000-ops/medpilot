// 設定・ひな形の編集・検査項目

import { esc, $ } from '../util.js';
import { state, saveMeta, setDemo, clearDemo, wipeAll } from '../store.js';
import * as M from '../model.js';
import { go, render, current } from '../router.js';
import { header, sec } from './common.js';
import { LAB_PROMPT } from '../labs.js';
import { changePass, createIdKeys } from '../crypto.js';
import { seedDemo } from '../demo.js';
import * as ui from '../ui.js';
import * as N from '../notify.js';
import * as K from '../meds.js';
import * as F from '../nutrition.js';
import { backupDays } from '../backup.js';
import { TASK_NAME_NOTE } from '../actions.js';

export const APP_VERSION = '0.6.0';

const seg = (act, cur, opts) =>
  `<div class="seg">${opts.map(([v, l]) => `<button class="${v === cur ? 'on' : ''}" data-act="${act}" data-v="${v}">${l}</button>`).join('')}</div>`;

export function applyLook() {
  const s = state.meta.settings;
  document.documentElement.dataset.theme = s.theme || 'dark';
  document.documentElement.dataset.font = s.font || 'm';
  const dark = s.theme === 'dark' || (s.theme === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', dark ? '#0f0f10' : '#f5f5f7');
}

export const settingsScreen = {
  render() {
    const s = state.meta.settings;
    const row = (act, label, right = '›', data = '') => `<button class="kv btnrow" data-act="${act}" ${data}><span>${label}</span><span class="muted">${right}</span></button>`;
    return `${header('設定', 'メニュー')}
      ${sec('表示')}
      <div class="card stack">
        <div class="lbl">背景</div>${seg('setTheme', s.theme, [['dark', '黒'], ['light', '白'], ['auto', '自動']])}
        <div class="lbl">文字の大きさ</div>${seg('setFont', s.font, [['s', '小'], ['m', '中'], ['l', '大']])}
      </div>
      ${sec('セキュリティ')}
      <div class="card kvlist">
        ${row('changePin', 'PIN を変える')}
        ${row('changePassphrase', state.meta.idKeys ? '合言葉を変える' : '合言葉を設定する')}
        ${row('lockNow', '今すぐロック')}
      </div>
      ${sec('バックアップ')}
      <div class="card stack">
        <div class="muted small">データはこの iPhone の中だけにあります。合言葉で暗号化したファイルに書き出して、「ファイル」→「この iPhone 内」に保存しておくと、アイコンを消してしまったときや機種変更のときに戻せます。</div>
        <div>${backupDays() === null ? '<span class="warn-a">まだバックアップしていません</span>' : `最後のバックアップ：${backupDays() === 0 ? '今日' : `${backupDays()}日前`}`}</div>
        <button class="btn" data-act="exportBackup">バックアップを書き出す</button>
        <button class="btn3" data-act="restoreBackup">バックアップから戻す</button>
        <div class="muted tiny">戻すと、今のデータは全部置き換わります。戻すには、バックアップを作ったときの合言葉が必要です。</div>
      </div>
      ${sec('通知')}
      <div class="card kvlist">
        ${row('goNotify', '通知（ntfy）', s.notify.topic ? (s.notify.on ? 'オン ›' : 'オフ ›') : '未設定 ›')}
      </div>
      ${sec('薬')}
      <div class="card kvlist">${row('goFavMeds', 'よく使う薬（種類・組成・単位）')}${row('goNutri', '栄養（商品・食事の形態・治療食）')}</div>
      ${sec('ひな形')}
      <div class="card kvlist">${Object.entries(M.TEMPLATE_NAMES).map(([k, l]) => row('editTpl', l, '›', `data-k="${k}"`)).join('')}</div>
      ${sec('検査値')}
      <div class="card kvlist">
        ${row('goLabItems', '検査項目（略称・単位・カルテでの名前）')}
        ${row('showPrompt', 'AI への指示文（検査値）')}
        ${row('showCulturePrompt', 'AI への指示文（培養）')}
      </div>
      ${sec('デモモード')}
      <div class="card stack">
        <div class="muted small">架空の患者で操作を試せます。本物のデータとは完全に分かれています。</div>
        ${seg('setDemoMode', s.demo ? 'on' : 'off', [['off', 'オフ'], ['on', 'オン']])}
        ${s.demo ? '<button class="btn3" data-act="resetDemo">デモの患者を作り直す</button>' : ''}
      </div>
      ${sec('データ')}
      <div class="card stack">
        <div class="muted small">データはこの iPhone の中だけに保存されています。ホーム画面のアイコンを削除するとデータも消えます。</div>
        <button class="danger" data-act="wipeEverything">すべてのデータを消す</button>
      </div>
      <div class="muted small center">MedPilot ${APP_VERSION}</div>`;
  },
  actions: {
    async setTheme(ds) { state.meta.settings.theme = ds.v; await saveMeta('settings'); applyLook(); render(); },
    async setFont(ds) { state.meta.settings.font = ds.v; await saveMeta('settings'); applyLook(); render(); },
    changePin() { go('setup', { step: 'oldpin', mode: 'change' }); },
    async changePassphrase() {
      const has = !!state.meta.idKeys;
      const r = await ui.custom(`<div class="sheet-title">${has ? '合言葉を変える' : '合言葉を設定する'}</div>
        ${has ? '<label class="lbl" for="pp-old">今の合言葉</label><input id="pp-old" type="password" autocomplete="off">' : ''}
        <label class="lbl" for="pp-new">新しい合言葉（10文字以上）</label><input id="pp-new" type="password" autocomplete="off">
        <label class="lbl" for="pp-new2">もう一度</label><input id="pp-new2" type="password" autocomplete="off">
        <div class="warn-a small">忘れると、保存した ID は誰も取り出せなくなります。</div>
        <div class="err" id="pp-err"></div>
        <div class="grid2"><button class="btn3" data-act="sheetCancel">やめる</button><button class="btn" data-act="passOk">決定</button></div>`);
      if (r) ui.toast(has ? '合言葉を変えました' : '合言葉を設定しました');
    },
    async passOk() {
      const err = $('#pp-err');
      const nw = $('#pp-new').value;
      if (nw.length < 10) return void (err.textContent = '10文字以上にしてください');
      if (nw !== $('#pp-new2').value) return void (err.textContent = '2回入れた合言葉が一致しません');
      err.textContent = '処理しています…';
      try {
        if (state.meta.idKeys) {
          state.meta.idKeys = await changePass(state.meta.idKeys, $('#pp-old').value, nw);
        } else {
          state.meta.idKeys = await createIdKeys(nw);
        }
      } catch (e) {
        err.textContent = '今の合言葉が違います';
        return;
      }
      await saveMeta('idKeys');
      ui.resolveSheet(true);
    },
    editTpl(ds) { go('tplEdit', { k: ds.k }); },
    goLabItems() { go('labItems'); },
    showPrompt() {
      ui.sheet(`<div class="sheet-title">AI への指示文</div><textarea class="mono" rows="12" readonly data-autofocus="no">${esc(LAB_PROMPT)}</textarea>
        <div class="grid2"><button class="btn3" data-act="sheetCancel">閉じる</button><button class="btn" data-act="copyPromptS">コピー</button></div>`);
    },
    async copyPromptS() {
      try { await navigator.clipboard.writeText(LAB_PROMPT); ui.toast('コピーしました'); } catch (e) { ui.toast('長押しで選んでコピーしてください'); }
    },
    showCulturePrompt() {
      ui.sheet(`<div class="sheet-title">AI への指示文（培養）</div><textarea class="mono" rows="14" readonly data-autofocus="no">${esc(K.CULTURE_PROMPT)}</textarea>
        <div class="grid2"><button class="btn3" data-act="sheetCancel">閉じる</button><button class="btn" data-act="copyCulturePromptS">コピー</button></div>`);
    },
    async copyCulturePromptS() {
      try { await navigator.clipboard.writeText(K.CULTURE_PROMPT); ui.toast('コピーしました'); } catch (e) { ui.toast('長押しで選んでコピーしてください'); }
    },
    goNotify() { go('notifySettings'); },
    goFavMeds() { go('favMeds'); },
    goNutri() { go('nutriSettings'); },
    async setDemoMode(ds) {
      const on = ds.v === 'on';
      if (on === !!state.meta.settings.demo) return;
      await setDemo(on);
      if (on && !state.patients.length) await seedDemo();
      ui.toast(on ? 'デモモードにしました（架空の患者）' : 'デモモードを終えました');
      go('menu', {}, { reset: true });
    },
    async resetDemo() {
      const ok = await ui.choose('デモの患者を作り直しますか？', 'デモで入れた内容は消えます。', [{ v: 'yes', label: '作り直す', tone: 'btn' }]);
      if (ok !== 'yes') return;
      await clearDemo();
      await seedDemo();
      ui.toast('作り直しました');
      render();
    },
    async wipeEverything() {
      const t = await ui.promptText({ title: 'すべてのデータを消す', label: '確認のため「削除」と入力してください。元に戻せません。' });
      if (t !== '削除') return;
      await N.cancelEverything();
      await wipeAll();
    },
  },
};

// ---- ひな形の編集 ----
export const tplEditScreen = {
  render({ k }) {
    const list = state.meta.templates[k] || [];
    const isEr = k === 'er';
    const rows = list
      .map((x, i) => {
        const label = isEr ? x.label : x;
        const steps = isEr
          ? `<div class="seg mini-seg">${[2, 3].map((n) => `<button class="${x.steps === n ? 'on' : ''}" data-act="tplSteps" data-i="${i}" data-n="${n}">${n}段階</button>`).join('')}</div>`
          : '';
        return `<div class="tpl-row"><span class="tpl-label">${esc(label)}</span>${steps}
          <button class="mini" data-act="tplUp" data-i="${i}" ${i === 0 ? 'disabled' : ''} aria-label="上へ">▲</button>
          <button class="mini" data-act="tplRename" data-i="${i}">名前</button>
          <button class="mini danger-tx" data-act="tplDel" data-i="${i}">削除</button></div>`;
      })
      .join('');
    return `${header(M.TEMPLATE_NAMES[k], '設定')}
      <div class="muted small">ここで変えた内容は、これから追加する患者に使われます。</div>
      <div class="card tpl-list">${rows || '<div class="muted small">項目がありません</div>'}</div>
      <button class="btn2" data-act="tplAdd">＋ 項目を追加</button>
      <button class="btn3" data-act="tplReset">最初の状態に戻す</button>`;
  },
  actions: {
    async tplSteps(ds) { const k = cur(); state.meta.templates[k][ds.i].steps = Number(ds.n); await saveTpl(); },
    async tplUp(ds) {
      const a = state.meta.templates[cur()];
      const i = Number(ds.i);
      [a[i - 1], a[i]] = [a[i], a[i - 1]];
      await saveTpl();
    },
    async tplRename(ds) {
      const k = cur();
      const a = state.meta.templates[k];
      const i = Number(ds.i);
      const old = k === 'er' ? a[i].label : a[i];
      const t = await ui.promptText({ title: '名前を変える', value: old });
      if (!t) return;
      if (k === 'er') a[i].label = t; else a[i] = t;
      await saveTpl();
    },
    async tplDel(ds) {
      const a = state.meta.templates[cur()];
      a.splice(Number(ds.i), 1);
      await saveTpl();
    },
    async tplAdd() {
      const k = cur();
      const t = await ui.promptText({ title: '項目を追加', placeholder: '例：尿検査' });
      if (!t) return;
      if (k === 'er') state.meta.templates.er.push({ label: t, kind: 'free', steps: 3 });
      else state.meta.templates[k].push(t);
      await saveTpl();
    },
    async tplReset() {
      const k = cur();
      const ok = await ui.choose('最初の状態に戻しますか？', '', [{ v: 'yes', label: '戻す', tone: 'btn' }]);
      if (ok !== 'yes') return;
      state.meta.templates[k] = JSON.parse(JSON.stringify(M.DEFAULT_TEMPLATES[k]));
      await saveTpl();
    },
  },
};

const cur = () => current().params.k;
async function saveTpl() { await saveMeta('templates'); render(); }

// ---- 検査項目 ----
export const labItemsScreen = {
  render() {
    const items = [...state.meta.labItems].sort((a, b) => a.order - b.order);
    const rows = items
      .map((it) => `<button class="kv btnrow" data-act="editItem" data-id="${it.id}"><span><span class="bold">${esc(it.abbr)}</span><span class="muted small">　${esc(it.unit)}</span></span><span class="muted small ell">${esc(it.aliases.join('、'))}</span></button>`)
      .join('');
    return `${header('検査項目', '設定')}
      <div class="muted small">AI の答えの「項目名」がカルテでの名前と一致すると、略称に振り分けます。</div>
      <div class="card kvlist">${rows}</div>
      <button class="btn2" data-act="addItem">＋ 項目を追加</button>`;
  },
  actions: {
    async editItem(ds) {
      const it = state.meta.labItems.find((x) => x.id === ds.id);
      const r = await itemSheet(it);
      if (!r) return;
      if (r === '__delete') {
        state.meta.labItems = state.meta.labItems.filter((x) => x !== it);
      } else Object.assign(it, r);
      await saveMeta('labItems');
      render();
    },
    async addItem() {
      const r = await itemSheet(null);
      if (!r || r === '__delete') return;
      state.meta.labItems.push({ id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()), order: state.meta.labItems.length, ...r });
      await saveMeta('labItems');
      render();
    },
    itemOk() {
      const abbr = $('#it-abbr').value.trim();
      if (!abbr) return;
      ui.resolveSheet({
        abbr,
        unit: $('#it-unit').value.trim(),
        aliases: $('#it-alias').value.split(/[,、，]/).map((s) => s.trim()).filter(Boolean),
      });
    },
  },
};

function itemSheet(it) {
  return ui.custom(`<div class="sheet-title">${it ? '検査項目を編集' : '検査項目を追加'}</div>
    <label class="lbl" for="it-abbr">略称</label><input id="it-abbr" type="text" value="${esc(it ? it.abbr : '')}" autocomplete="off">
    <label class="lbl" for="it-unit">単位</label><input id="it-unit" type="text" value="${esc(it ? it.unit : '')}" autocomplete="off">
    <label class="lbl" for="it-alias">カルテでの名前（「、」で区切る）</label><input id="it-alias" type="text" value="${esc(it ? it.aliases.join('、') : '')}" autocomplete="off">
    <div class="grid2"><button class="btn3" data-act="sheetCancel">やめる</button><button class="btn" data-act="itemOk">保存</button></div>
    ${it ? '<button class="danger" data-act="sheetChoose" data-v="__delete">この項目を削除（記録した値は表示されなくなります）</button>' : ''}`);
}

// ---- 通知の設定 ----
const MIN_OPTS = [[0, 'なし'], [30, '30分'], [60, '60分'], [90, '90分']];

export const notifySettingsScreen = {
  render() {
    const n = state.meta.settings.notify;
    const topicBox = n.topic
      ? `<div class="card stack">
          <div class="lbl">受け取り先（トピック名）</div>
          <div class="mono box topic">${esc(n.topic)}</div>
          <div class="grid2"><button class="btn2" data-act="copyTopic">コピー</button><button class="btn" data-act="testNotify">テスト通知を送る</button></div>
          <div class="muted small">iPhone の ntfy アプリで購読してください：<br>① 上の「コピー」を押す<br>② ntfy アプリを開いて「＋」を押す<br>③ トピック名に貼り付けて「購読」（サーバーは ntfy.sh のまま）</div>
          <button class="btn3" data-act="remakeTopic">受け取り先を作り直す</button>
        </div>`
      : `<div class="card stack"><div class="muted small">まず、このアプリ専用の受け取り先を作ります。推測されにくいランダムな名前になります。</div><button class="btn" data-act="makeTopic">受け取り先を作る</button></div>`;
    const timers = Object.entries(N.TIMER_KINDS)
      .map(([k, label]) => `<div class="lbl">${esc(label)}</div><div class="seg">${MIN_OPTS.map(([m, l]) => `<button class="${Number(n.timers[k] || 0) === m ? 'on' : ''}" data-act="setTimerDef" data-k="${k}" data-v="${m}">${l}</button>`).join('')}</div>`)
      .join('');
    const pend = N.pendingCount();
    return `${header('通知', '設定')}
      <div class="card stack">
        <div class="muted small">MedPilot から外に出るのは通知だけです。中身は識別番号・タスク名・薬やデバイスの名前・検体だけで、あだ名・ベッド・年代・性別・病名・ID は出しません。</div>
        <div class="warn-a small">${esc(TASK_NAME_NOTE)}</div>
      </div>
      ${sec('受け取り先')}${topicBox}
      ${sec('通知')}
      <div class="card stack">${seg('setNotifyOn', n.on ? 'on' : 'off', [['on', 'オン'], ['off', 'オフ']])}
        ${state.demo ? '<div class="warn-a small">デモモードの間は通知を送りません。</div>' : ''}</div>
      ${sec('朝のまとめ')}
      <div class="card stack">
        ${seg('setMorning', n.morning ? 'on' : 'off', [['on', '送る'], ['off', '送らない']])}
        <label class="lbl" for="nt-time">時刻</label><input id="nt-time" type="time" value="${esc(n.morningTime)}">
        <div class="muted small">回診の人数・今日の予定・IC 7日超・デバイス 14日超をお知らせします。アプリで何か変えるたびに中身を新しくします。予約できるのは3日先までなので、3日以上アプリを開かないと止まります。</div>
      </div>
      ${sec('タイマー（オーダー済・依頼済にしたとき）')}
      <div class="card stack">${timers}
        <div class="lbl">まだ確認していなければ、もう一度</div>${seg('setAgain', String(n.again || 0), [['0', 'しない'], ['30', '30分後']])}
        <div class="muted small">その場で時間を変えたり、やめたりもできます。確認済にすると通知は取り消されます。</div>
      </div>
      ${pend ? `${sec('送れていない通知')}<div class="card stack"><div class="muted small">${pend}件。電波が戻ったら自動で送ります。</div><button class="btn2" data-act="flushNow">今すぐ送る</button></div>` : ''}`;
  },
  mount() {
    const t = document.getElementById('nt-time');
    if (t) t.addEventListener('change', async () => {
      if (!/^\d{2}:\d{2}$/.test(t.value)) return;
      state.meta.settings.notify.morningTime = t.value;
      await saveNotify();
      ui.toast(`朝のまとめ：${t.value}`);
    });
  },
  actions: {
    async makeTopic() {
      state.meta.settings.notify.topic = N.newTopic();
      await saveNotify();
      render();
      ui.toast('受け取り先を作りました。ntfy アプリで購読してください');
    },
    async remakeTopic() {
      const ok = await ui.choose('受け取り先を作り直しますか？', '今の受け取り先への予約は取り消します。ntfy アプリで新しい受け取り先を購読し直す必要があります。', [{ v: 'yes', label: '作り直す', tone: 'btn' }]);
      if (ok !== 'yes') return;
      await N.cancelEverything();
      state.meta.settings.notify.topic = N.newTopic();
      await saveNotify();
      render();
    },
    async copyTopic() {
      try { await navigator.clipboard.writeText(state.meta.settings.notify.topic); ui.toast('コピーしました'); } catch (e) { ui.toast('長押しで選んでコピーしてください'); }
    },
    async testNotify() {
      try {
        await N.sendTest();
        ui.toast('送りました。iPhone に届いたか確かめてください');
      } catch (e) {
        ui.toast(`送れませんでした。電波を確かめてください（${e.message}）`);
      }
    },
    async setNotifyOn(ds) {
      state.meta.settings.notify.on = ds.v === 'on';
      if (ds.v !== 'on') await N.cancelAllMorning();
      await saveNotify();
      render();
    },
    async setMorning(ds) {
      state.meta.settings.notify.morning = ds.v === 'on';
      await saveNotify();
      render();
    },
    async setTimerDef(ds) {
      state.meta.settings.notify.timers[ds.k] = Number(ds.v);
      await saveMeta('settings');
      render();
    },
    async setAgain(ds) {
      state.meta.settings.notify.again = Number(ds.v);
      await saveMeta('settings');
      render();
    },
    async flushNow() {
      await N.flush();
      render();
      ui.toast(N.pendingCount() ? 'まだ送れませんでした' : '送りました');
    },
  },
};

async function saveNotify() {
  await saveMeta('settings');
  await N.scheduleMorning();
}

// ---- よく使う薬 ----
export const favMedsScreen = {
  render() {
    const favs = state.meta.favMeds || [];
    const rows = Object.entries(K.MED_CATS)
      .map(([cat, c]) => {
        const list = favs.map((f, i) => ({ f, i })).filter(({ f }) => f.cat === cat);
        if (!list.length) return '';
        return `${sec(c.label)}<div class="card kvlist">${list.map(({ f, i }) => `<button class="kv btnrow" data-act="editFav" data-i="${i}"><span><span class="mdot" style="background:${c.color}"></span>${esc(f.name)}</span><span class="muted small">${esc([f.amount ? `${K.fmtNum(f.amount)}${f.amountUnit}／${K.fmtNum(f.volume)}mL` : '', f.unit].filter(Boolean).join('　'))} ›</span></button>`).join('')}</div>`;
      })
      .join('');
    return `${header('よく使う薬', '設定')}
      <div class="muted small">薬を追加するときに、ここから選べます。新しい名前の薬を入れると自動でここに増えます。流量の薬は、ここの組成で mL/h から γ などを計算します。</div>
      ${rows || '<div class="muted small">まだありません</div>'}
      <button class="btn2" data-act="addFav">＋ 薬を追加</button>
      <button class="btn3" data-act="resetFav">最初の状態に戻す</button>`;
  },
  actions: {
    async editFav(ds) {
      const favs = state.meta.favMeds;
      const f = favs[Number(ds.i)];
      const r = await favSheet(f);
      if (!r) return;
      if (r === '__delete') favs.splice(Number(ds.i), 1);
      else Object.assign(f, r);
      await saveMeta('favMeds');
      render();
    },
    async addFav() {
      const r = await favSheet(null);
      if (!r || r === '__delete') return;
      state.meta.favMeds.push(r);
      await saveMeta('favMeds');
      render();
    },
    favOk() {
      const name = $('#fv-name').value.trim();
      const err = $('#fv-err');
      if (!name) return void (err.textContent = '名前を入れてください');
      const on = $('.seg[data-pick="fcat"] .on');
      const cat = on ? on.dataset.v : 'other';
      const out = { name, cat, unit: '' };
      if (K.MED_CATS[cat].flow) {
        const n = (v) => { const t = String(v).normalize('NFKC').trim(); return t && Number.isFinite(Number(t)) && Number(t) > 0 ? Number(t) : null; };
        const amount = n($('#fv-amt').value);
        const volume = n($('#fv-vol').value);
        if (!amount || !volume) return void (err.textContent = '組成（薬の量と全量 mL）を数字で入れてください');
        Object.assign(out, { unit: $('#fv-unit').value, amount, amountUnit: $('#fv-amtu').value, volume });
        if (K.concPerMl(out, out.unit) === null) return void (err.textContent = '量の単位と表示の単位が合いません（例：mg → γ・mg/h、U → U/h）');
        if ($('#fv-perday').checked) out.perDay = true;
      }
      ui.resolveSheet(out);
    },
    async resetFav() {
      const ok = await ui.choose('最初の状態に戻しますか？', '自分で足した薬は消えます（患者の記録は消えません）。', [{ v: 'yes', label: '戻す', tone: 'btn' }]);
      if (ok !== 'yes') return;
      state.meta.favMeds = K.defaultFavMeds();
      await saveMeta('favMeds');
      render();
    },
  },
};

function favSheet(f) {
  const cats = Object.entries(K.MED_CATS).map(([k, c]) => `<button class="${(f ? f.cat : 'abx') === k ? 'on' : ''}" data-act="pick" data-v="${k}">${c.label}</button>`).join('');
  const pr = ui.custom(`<div class="sheet-title">${f ? 'よく使う薬を編集' : 'よく使う薬を追加'}</div>
    <label class="lbl" for="fv-name">名前</label><input id="fv-name" type="text" value="${esc(f ? f.name : '')}" autocomplete="off">
    <div class="lbl">種類</div><div class="seg" data-pick="fcat">${cats}</div>
    <div id="fv-unit-box" class="stack ${f && K.MED_CATS[f.cat] && K.MED_CATS[f.cat].flow ? '' : 'hidden'}">
      <div class="lbl">組成（薬の量／全量）</div>
      <div class="conc-grid"><input id="fv-amt" type="text" inputmode="decimal" autocomplete="off" value="${esc(f && f.amount ? K.fmtNum(f.amount) : '')}" placeholder="薬の量" aria-label="薬の量"><select id="fv-amtu" aria-label="量の単位">${['mg', 'µg', 'U', '単位'].map((u) => `<option ${f && f.amountUnit === u ? 'selected' : ''}>${u}</option>`).join('')}</select><span class="muted">／</span><input id="fv-vol" type="text" inputmode="decimal" autocomplete="off" value="${esc(f && f.volume ? K.fmtNum(f.volume) : '')}" placeholder="全量" aria-label="全量"><span class="muted">mL</span></div>
      <label class="lbl" for="fv-unit">表示の単位</label><select id="fv-unit">${['γ', 'mg/h', 'µg/h', 'U/h', '単位/h'].map((u) => `<option ${f && f.unit === u ? 'selected' : ''}>${u}</option>`).join('')}</select>
      <label class="row-gap small"><input id="fv-perday" type="checkbox" ${f && f.perDay ? 'checked' : ''}> 1日量（/日）も出す（ヘパリンなど）</label>
      <div class="warn-a small">組成を変えると、これから追加する薬に使われます（今使っている薬の計算は変わりません）。</div>
    </div>
    <div class="err" id="fv-err"></div>
    <div class="grid2"><button class="btn3" data-act="sheetCancel">やめる</button><button class="btn" data-act="favOk">保存</button></div>
    ${f ? '<button class="danger" data-act="sheetChoose" data-v="__delete">よく使う薬から外す</button>' : ''}`);
  $('.seg[data-pick="fcat"]').addEventListener('picked', (e) => {
    const flow = !!K.MED_CATS[e.detail.value].flow;
    $('#fv-unit-box').classList.toggle('hidden', !flow);
    if (flow && !(f && f.unit)) $('#fv-unit').value = K.MED_CATS[e.detail.value].unit;
  });
  return pr;
}

// ---- 栄養の設定（商品・食事の形態・治療食） ----
const r1 = (v) => Math.round(Number(v) * 10) / 10;

export const nutriSettingsScreen = {
  render() {
    const favs = state.meta.favFeeds || [];
    const diet = state.meta.diet || { forms: [], types: [] };
    const feedRows = Object.entries(F.ROUTES).map(([route, r]) => {
      const list = favs.map((f, i) => ({ f, i })).filter(({ f }) => f.route === route);
      return `${sec(r.label)}<div class="card kvlist">${list.map(({ f, i }) => `<button class="kv btnrow" data-act="editFeedFav" data-i="${i}"><span><span class="mdot" style="background:${r.color}"></span>${esc(f.name)}</span><span class="muted small">${r1(f.packMl)}mL ・ ${r1(f.packKcal)}kcal${f.protein !== null && f.protein !== undefined ? ` ・ ${r1(f.protein)}g` : ' ・ タンパク質 未'} ›</span></button>`).join('') || '<div class="muted small">まだありません</div>'}</div>
        <button class="btn3" data-act="addFeedFav" data-route="${route}">＋ ${r.label}の商品を追加</button>`;
    }).join('');
    const listEdit = (key, title, items) => `${sec(title)}<div class="card kvlist">${items.map((x, i) => `<div class="kv"><span>${esc(x)}</span><span>${i > 0 ? `<button class="mini" data-act="dietUp" data-k="${key}" data-i="${i}" aria-label="上へ">▲</button>` : ''}<button class="mini danger-tx" data-act="dietDel" data-k="${key}" data-i="${i}">削除</button></span></div>`).join('')}</div>
      <button class="btn3" data-act="dietAdd" data-k="${key}">＋ ${title}を追加</button>`;
    return `${header('栄養の設定', '設定')}
      <div class="muted small">商品は1パック（1袋）あたりの量・熱量・タンパク質（点滴はアミノ酸）です。タンパク質を入れた商品だけ、1日のタンパク質を計算します。</div>
      ${feedRows}
      ${listEdit('forms', '食事の形態', diet.forms)}
      ${listEdit('types', '治療食', diet.types)}`;
  },
  actions: {
    async editFeedFav(ds) {
      const favs = state.meta.favFeeds;
      const f = favs[Number(ds.i)];
      const r = await feedFavSheet(f, f.route);
      if (!r) return;
      if (r === '__delete') favs.splice(Number(ds.i), 1); else Object.assign(f, r);
      await saveMeta('favFeeds');
      render();
    },
    async addFeedFav(ds) {
      const r = await feedFavSheet(null, ds.route);
      if (!r || r === '__delete') return;
      state.meta.favFeeds.push(r);
      await saveMeta('favFeeds');
      render();
    },
    feedFavOk(ds) {
      const n = (id) => { const t = $(id).value.normalize('NFKC').trim(); return t && Number.isFinite(Number(t)) ? Number(t) : null; };
      const name = $('#ff-name').value.trim();
      const packMl = n('#ff-ml');
      const packKcal = n('#ff-kcal');
      if (!name || !(packMl > 0) || !(packKcal > 0)) return void ($('#ff-err').textContent = '名前・量（mL）・熱量（kcal）を入れてください');
      ui.resolveSheet({ name, route: ds.route, packMl, packKcal, protein: n('#ff-pro') });
    },
    async dietAdd(ds) {
      const t = await ui.promptText({ title: ds.k === 'forms' ? '食事の形態を追加' : '治療食を追加', placeholder: ds.k === 'forms' ? '例：全粥' : '例：心臓食' });
      if (!t) return;
      state.meta.diet[ds.k].push(t);
      await saveMeta('diet');
      render();
    },
    async dietDel(ds) {
      state.meta.diet[ds.k].splice(Number(ds.i), 1);
      await saveMeta('diet');
      render();
    },
    async dietUp(ds) {
      const a = state.meta.diet[ds.k];
      const i = Number(ds.i);
      [a[i - 1], a[i]] = [a[i], a[i - 1]];
      await saveMeta('diet');
      render();
    },
  },
};

function feedFavSheet(f, route) {
  const r = F.ROUTES[route];
  return ui.custom(`<div class="sheet-title">${f ? `${esc(r.label)}の商品を編集` : `${esc(r.label)}の商品を追加`}</div>
    <label class="lbl" for="ff-name">名前</label><input id="ff-name" type="text" value="${esc(f ? f.name : '')}" autocomplete="off">
    <div class="lbl">1${r.unit}あたり</div>
    <div class="spec-grid"><input id="ff-ml" type="text" inputmode="decimal" value="${esc(f ? r1(f.packMl) : '')}" placeholder="量" aria-label="量 mL"><span class="muted">mL</span><input id="ff-kcal" type="text" inputmode="decimal" value="${esc(f ? r1(f.packKcal) : '')}" placeholder="熱量" aria-label="熱量 kcal"><span class="muted">kcal</span></div>
    <div class="spec-grid"><input id="ff-pro" type="text" inputmode="decimal" value="${esc(f && f.protein !== null && f.protein !== undefined ? r1(f.protein) : '')}" placeholder="${route === 'pn' ? 'アミノ酸（なくても可）' : 'タンパク質（なくても可）'}" aria-label="タンパク質 g"><span class="muted">g</span></div>
    <div class="err" id="ff-err"></div>
    <div class="grid2"><button class="btn3" data-act="sheetCancel">やめる</button><button class="btn" data-act="feedFavOk" data-route="${route}">保存</button></div>
    ${f ? '<button class="danger" data-act="sheetChoose" data-v="__delete">よく使う栄養から外す</button>' : ''}`);
}
