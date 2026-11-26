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

export const APP_VERSION = '0.2.1';

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
      ${sec('ひな形')}
      <div class="card kvlist">${Object.entries(M.TEMPLATE_NAMES).map(([k, l]) => row('editTpl', l, '›', `data-k="${k}"`)).join('')}</div>
      ${sec('検査値')}
      <div class="card kvlist">
        ${row('goLabItems', '検査項目（略称・単位・カルテでの名前）')}
        ${row('showPrompt', 'AI への指示文を見る・コピー')}
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
