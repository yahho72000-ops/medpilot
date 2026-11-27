// バックアップ：合言葉で暗号化したファイルに書き出す／読み込んで全部置き換える
// 保存先は iPhone の中（「ファイル」→「この iPhone 内」）。機種変更のときは AirDrop で送る
// 入れるもの：患者全員（過去も）、ID（暗号化したまま）、設定・ひな形・検査項目・よく使う薬と栄養・食事の形態・通知の受け取り先
// 入れないもの：PIN、デモの患者、通知の送り待ち

import { esc, ymd, md, $ } from './util.js';
import { state, saveMeta, wipeIds } from './store.js';
import { getAll, replaceAll } from './db.js';
import { openPrivate, encryptWithPass, decryptWithPass } from './crypto.js';
import * as ui from './ui.js';
import { render } from './router.js';
import { cancelEverything } from './notify.js';

export const FORMAT = 'medpilot-backup';
const META_IN = ['settings', 'templates', 'labItems', 'history', 'idKeys', 'favMeds', 'favFeeds', 'diet'];

// 書き出す中身（暗号化する前）
export function makePayload(meta, patients, now = Date.now(), appVersion = '') {
  const m = {};
  for (const k of META_IN) if (meta[k] !== undefined && meta[k] !== null) m[k] = JSON.parse(JSON.stringify(meta[k]));
  if (m.settings) m.settings.demo = false;
  return { v: 1, app: appVersion, createdAt: now, meta: m, patients: JSON.parse(JSON.stringify(patients)) };
}

// ファイルの中身（外から見えるのは形式と作った日時だけ）
export async function sealBackup(payload, pass) {
  const box = await encryptWithPass(JSON.stringify(payload), pass);
  return JSON.stringify({ format: FORMAT, v: 1, createdAt: new Date(payload.createdAt).toISOString(), ...box });
}

export async function openBackup(text, pass) {
  let box;
  try { box = JSON.parse(text); } catch (e) { throw new Error('MedPilot のバックアップファイルではありません'); }
  if (!box || box.format !== FORMAT || !box.data) throw new Error('MedPilot のバックアップファイルではありません');
  let plain;
  try { plain = await decryptWithPass(box, pass); } catch (e) { throw new Error('合言葉が違います（またはファイルが壊れています）'); }
  const payload = JSON.parse(plain);
  if (!payload || !Array.isArray(payload.patients) || !payload.meta || !payload.meta.idKeys) throw new Error('バックアップの中身が読めませんでした');
  return payload;
}

export const backupDays = (now = Date.now()) => {
  const t = state.meta.backupInfo && state.meta.backupInfo.lastAt;
  return t ? Math.floor((now - t) / 86400000) : null;
};

// ---- 書き出し ----
let pendingFile = null;

async function exportFlow() {
  if (!state.meta.idKeys) {
    ui.toast('先に合言葉を設定してください（設定 → 合言葉を設定する）');
    return;
  }
  const pass = await ui.custom(`<div class="sheet-title">バックアップを書き出す</div>
    <div class="muted small">ファイルは合言葉で暗号化します。戻すときも同じ合言葉が必要です。</div>
    <label class="lbl" for="bk-pass">合言葉</label><input id="bk-pass" type="password" autocomplete="off" autocapitalize="off" spellcheck="false">
    <div class="muted tiny">合言葉を5回続けて間違えると、保存した ID はすべて消えます。</div>
    <div class="err" id="bk-err"></div>
    <div class="grid2"><button class="btn3" data-act="sheetCancel">やめる</button><button class="btn" data-act="backupPassOk">次へ</button></div>`);
  if (!pass) return;
  const sec = state.meta.security;
  try {
    await openPrivate(state.meta.idKeys, pass);
  } catch (e) {
    sec.passFails = (sec.passFails || 0) + 1;
    await saveMeta('security');
    if (sec.passFails >= 5) {
      await wipeIds();
      ui.toast('合言葉を5回間違えたため、保存した ID をすべて消しました');
      render();
      return;
    }
    ui.toast(`合言葉が違います（あと ${5 - sec.passFails} 回間違えると ID がすべて消えます）`);
    return;
  }
  sec.passFails = 0;
  await saveMeta('security');
  ui.sheet('<div class="sheet-title">バックアップを作っています…</div><div class="muted small">数秒かかります。</div>');
  const patients = await getAll(state.mainDb, 'patients');
  const { APP_VERSION } = await import('./screens/settings.js');
  const text = await sealBackup(makePayload(state.meta, patients, Date.now(), APP_VERSION), pass);
  const name = `MedPilot-${ymd()}.medpilot`;
  pendingFile = new File([text], name, { type: 'application/octet-stream' });
  const kb = Math.max(1, Math.round(text.length / 1024));
  ui.sheet(`<div class="sheet-title">バックアップができました</div>
    <div>${esc(name)}<span class="muted small">　患者 ${patients.length}人 ・ ${kb}KB</span></div>
    <div class="card stack small">
      <div>「保存する」を押したら、<b>「"ファイル"に保存」→「この iPhone 内」</b> を選んで保存してください。</div>
      <div>機種変更のときは、ここから <b>AirDrop</b> で新しい iPhone に送れます。</div>
      <div class="warn-a">iCloud Drive には保存しないでください（病院のルールを確かめるまで）。</div>
    </div>
    <button class="btn" data-act="backupShare">保存する</button>
    <button class="btn3" data-act="backupDownload">（うまくいかないとき）ダウンロードで保存</button>
    <div class="muted tiny">ダウンロードは、iPhone の設定によっては iCloud Drive の「ダウンロード」に入ります。その場合は「ファイル」アプリで「この iPhone 内」に移してください。</div>
    <button class="btn3" data-act="sheetCancel">閉じる</button>`);
}

async function markSaved() {
  state.meta.backupInfo = { lastAt: Date.now() };
  await saveMeta('backupInfo');
  pendingFile = null;
  ui.closeSheet();
  ui.toast('バックアップを保存しました');
  render();
}

// ---- 戻す ----
function pickFile() {
  return new Promise((resolve) => {
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.style.display = 'none';
    document.body.appendChild(inp);
    inp.addEventListener('change', () => {
      const f = inp.files && inp.files[0];
      inp.remove();
      resolve(f || null);
    });
    inp.click();
  });
}

async function restoreFlow() {
  const file = await pickFile();
  if (!file) return;
  const text = await file.text();
  let payload = null;
  let err = '';
  for (;;) {
    const pass = await ui.custom(`<div class="sheet-title">バックアップから戻す</div>
      <div class="muted small">${esc(file.name)}</div>
      <label class="lbl" for="rs-pass">バックアップを作ったときの合言葉</label><input id="rs-pass" type="password" autocomplete="off" autocapitalize="off" spellcheck="false">
      <div class="err" id="rs-err">${esc(err)}</div>
      <div class="grid2"><button class="btn3" data-act="sheetCancel">やめる</button><button class="btn" data-act="restorePassOk">次へ</button></div>`);
    if (!pass) return;
    ui.sheet('<div class="sheet-title">確認しています…</div><div class="muted small">数秒かかります。</div>');
    try {
      payload = await openBackup(text, pass);
      break;
    } catch (e) {
      ui.closeSheet();
      err = e.message;
      if (!/合言葉/.test(err)) { ui.toast(err); return; }
    }
  }
  const nowCount = (await getAll(state.mainDb, 'patients')).length;
  const ok = await ui.choose('このバックアップで置き換えますか？', `${md(ymd(new Date(payload.createdAt)))} に作ったバックアップ（患者 ${payload.patients.length}人）。<br><b>今のデータ（患者 ${nowCount}人）は全部置き換わり、元に戻せません。</b>`, [
    { v: 'yes', label: '置き換えて戻す', tone: 'danger' },
  ]);
  if (ok !== 'yes') return;
  ui.sheet('<div class="sheet-title">戻しています…</div>');
  // 前の受け取り先に予約した通知は取り消しておく
  const oldTopic = state.meta.settings.notify && state.meta.settings.notify.topic;
  const newTopic = payload.meta.settings && payload.meta.settings.notify && payload.meta.settings.notify.topic;
  if (oldTopic && oldTopic !== newTopic) await cancelEverything();
  const settings = { ...(payload.meta.settings || {}), demo: false };
  const meta = { ...payload.meta, settings, notifyQueue: [], notifyState: { morning: {} }, backupInfo: { lastAt: payload.createdAt }, security: { ...state.meta.security, passFails: 0 } };
  await replaceAll(state.mainDb, { patients: payload.patients, meta });
  ui.closeSheet();
  ui.toast('バックアップから戻しました。読み込み直します…');
  setTimeout(() => location.reload(), 1200);
}

export const backupActions = {
  exportBackup() { return exportFlow(); },
  restoreBackup() { return restoreFlow(); },
  backupPassOk() {
    const v = $('#bk-pass').value;
    if (!v) return void ($('#bk-err').textContent = '合言葉を入れてください');
    $('#bk-pass').value = '';
    ui.resolveSheet(v);
  },
  restorePassOk() {
    const v = $('#rs-pass').value;
    if (!v) return void ($('#rs-err').textContent = '合言葉を入れてください');
    $('#rs-pass').value = '';
    ui.resolveSheet(v);
  },
  // 共有シート（「ファイル」に保存・AirDrop）。押した瞬間に呼ぶ必要がある
  async backupShare() {
    if (!pendingFile) return;
    if (navigator.canShare && navigator.canShare({ files: [pendingFile] })) {
      try {
        await navigator.share({ files: [pendingFile], title: pendingFile.name });
        await markSaved();
      } catch (e) {
        if (e && e.name === 'AbortError') ui.toast('保存をやめました（もう一度「保存する」を押せます）');
        else ui.toast(`保存できませんでした：${e.message}`);
      }
      return;
    }
    await backupActions.backupDownload();
  },
  async backupDownload() {
    if (!pendingFile) return;
    const url = URL.createObjectURL(pendingFile);
    const a = document.createElement('a');
    a.href = url;
    a.download = pendingFile.name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    await markSaved();
  },
};
