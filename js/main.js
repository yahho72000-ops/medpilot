// MedPilot の起動、画面の登録、タップ・長押しの受け付け、自動ロック

import { state, init, onPatientsChanged } from './store.js';
import { register, go, actionFor, current } from './router.js';
import * as ui from './ui.js';
import { patientActions } from './actions.js';
import { menuScreen } from './screens/menu.js';
import { erListScreen, erPatientScreen, registerScreen } from './screens/er.js';
import { inListScreen, inPatientScreen } from './screens/inpatient.js';
import { labImportScreen, labConfirmScreen } from './screens/lab.js';
import { followupScreen, pastScreen, pastViewScreen } from './screens/followup.js';
import { settingsScreen, tplEditScreen, labItemsScreen, notifySettingsScreen, favMedsScreen, applyLook } from './screens/settings.js';
import { lockScreen, setupScreen, lock } from './screens/lock.js';
import { graphScreen } from './screens/graph.js';
import { cultureImportScreen, cultureConfirmScreen } from './screens/culture.js';
import { clinicalActions } from './clinical.js';
import { changedSoon, changedNow, startNotify, flush } from './notify.js';

const LOCK_AFTER_MS = 5 * 60 * 1000;

register({
  _global: { actions: { ...ui.sheetActions, ...patientActions, ...clinicalActions, lockNow: () => lock(), openGraph: (ds) => go('graph', { id: ds.pid }) } },
  menu: menuScreen,
  erList: erListScreen,
  erPatient: erPatientScreen,
  register: registerScreen,
  inList: inListScreen,
  inPatient: inPatientScreen,
  labImport: labImportScreen,
  labConfirm: labConfirmScreen,
  followup: followupScreen,
  past: pastScreen,
  pastView: pastViewScreen,
  settings: settingsScreen,
  tplEdit: tplEditScreen,
  labItems: labItemsScreen,
  notifySettings: notifySettingsScreen,
  favMeds: favMedsScreen,
  graph: graphScreen,
  cultureImport: cultureImportScreen,
  cultureConfirm: cultureConfirmScreen,
  lock: lockScreen,
  setup: setupScreen,
});

// ---- タップと長押し ----
let lpTimer = null;
let lpFired = false;
let lpStart = null;

function run(name, el, ev) {
  const fn = actionFor(name);
  if (!fn) return;
  Promise.resolve()
    .then(() => fn(el.dataset, el, ev))
    .catch((err) => {
      console.error(err);
      ui.toast(`うまくいきませんでした：${err.message}`);
    });
}

document.addEventListener('pointerdown', (e) => {
  state.lastActive = Date.now();
  const el = e.target.closest('[data-lp]');
  if (!el) return;
  lpFired = false;
  lpStart = { x: e.clientX, y: e.clientY };
  clearTimeout(lpTimer);
  lpTimer = setTimeout(() => {
    lpTimer = null;
    lpFired = true;
    run(el.dataset.lp, el, e);
  }, 500);
});
document.addEventListener('pointermove', (e) => {
  if (lpTimer && lpStart && (Math.abs(e.clientX - lpStart.x) > 10 || Math.abs(e.clientY - lpStart.y) > 10)) {
    clearTimeout(lpTimer);
    lpTimer = null;
  }
});
for (const t of ['pointerup', 'pointercancel']) {
  document.addEventListener(t, () => {
    clearTimeout(lpTimer);
    lpTimer = null;
  });
}
document.addEventListener('contextmenu', (e) => {
  if (e.target.closest('[data-lp]')) e.preventDefault();
});
document.addEventListener('click', (e) => {
  if (lpFired) {
    lpFired = false;
    e.preventDefault();
    e.stopPropagation();
    return;
  }
  const el = e.target.closest('[data-act]');
  if (!el) return;
  if (el.dataset.act === 'sheetBackdrop' && e.target !== el) return;
  if (el.disabled) return;
  e.preventDefault();
  run(el.dataset.act, el, e);
}, true);
// 病室の欄は数字だけ（最大4桁）
document.addEventListener('input', (e) => {
  const t = e.target;
  if (t && t.id && /-room$/.test(t.id)) {
    const v = t.value.normalize('NFKC').replace(/\D/g, '').slice(0, 4);
    if (v !== t.value) t.value = v;
  }
});
document.addEventListener('keydown', (e) => {
  state.lastActive = Date.now();
  if (e.key === 'Enter' && e.target.id === 'sheet-input' && e.target.tagName === 'INPUT') {
    e.preventDefault();
    run('sheetOk', e.target, e);
  }
  if (e.key === 'Enter' && e.target.id === 'pass-input') {
    e.preventDefault();
    const btn = document.querySelector('[data-act="revealGo"]');
    if (btn) run('revealGo', btn, e);
  }
});

// ---- 自動ロックと、切り替え時に画面を隠す ----
function needLock() {
  return state.unlocked && Date.now() - state.lastActive > LOCK_AFTER_MS;
}
setInterval(() => {
  if (needLock()) lock();
}, 10000);
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    document.body.classList.add('private');
    changedNow();
  } else {
    if (needLock()) lock();
    document.body.classList.remove('private');
    flush();
  }
});
window.addEventListener('pagehide', () => document.body.classList.add('private'));
window.addEventListener('pageshow', () => {
  if (needLock()) lock();
  document.body.classList.remove('private');
});
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => applyLook());

// ---- オフラインで動くための仕組み（Service Worker） ----
function registerSW() {
  if (!('serviceWorker' in navigator)) return;
  const local = /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
  if (local && !new URLSearchParams(location.search).has('sw')) return;
  let reloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloaded) return;
    reloaded = true;
    location.reload();
  });
  navigator.serviceWorker.register('sw.js').catch((e) => console.warn('SW', e));
}

// ---- 起動 ----
async function boot() {
  try {
    await init();
  } catch (e) {
    document.getElementById('app').innerHTML = `<div class="empty">データベースを開けませんでした：${e.message}</div>`;
    return;
  }
  applyLook();
  // 患者のデータが変わったら、朝のまとめを作り直す（数秒まとめてから）
  onPatientsChanged(changedSoon);
  startNotify();
  if (!state.meta.security.pin) go('setup', { step: 'welcome' }, { reset: true });
  else go('lock', {}, { reset: true });
  registerSW();
}

boot();

// 開発中の確認用（手元のサーバーで開いたときだけ）
if (/^(localhost|127\.0\.0\.1)$/.test(location.hostname)) window.__medpilot = { state, current };
