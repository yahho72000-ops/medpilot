// データの読み書きとアプリ全体の状態

import { openDB, get, getAll, put, del, deleteDB } from './db.js';
import { DEFAULT_TEMPLATES, migrateResulted } from './model.js';
import { defaultLabItems } from './labs.js';
import { defaultFavMeds, upgradeFavMeds } from './meds.js';
import { defaultFavFeeds, DEFAULT_DIET_FORMS, DEFAULT_DIET_TYPES } from './nutrition.js';

export const MAIN_DB = 'medpilot';
export const DEMO_DB = 'medpilot-demo';

export const state = {
  mainDb: null,
  dataDb: null,
  demo: false,
  unlocked: false,
  lastActive: Date.now(),
  meta: {},
  patients: [],
  labDraft: null,
  summaryDraft: null,
};

// 通知（ntfy）の設定。timers はタイマーの最初の時間（分、0 はなし）
export const DEFAULT_NOTIFY = {
  on: true,
  topic: '',
  morning: true,
  morningTime: '06:00',
  timers: { lab: 60, image: 30, ecg: 0, consult: 60, free: 0 },
  again: 30,
};
const DEFAULT_SETTINGS = { theme: 'dark', font: 'm', inpatientSort: 'days', demo: false, graphItems: ['WBC', 'CRP'] };
const META_KEYS = ['security', 'settings', 'templates', 'labItems', 'history', 'idKeys', 'favMeds', 'notifyQueue', 'notifyState', 'favFeeds', 'diet', 'backupInfo'];

const clone = (x) => JSON.parse(JSON.stringify(x));

// 保存してあるひな形に、あとから増えた項目を1回だけ足す（消した人にはもう足さない）
export function upgradeTemplates(tpl, settings) {
  const done = settings.upgrades || (settings.upgrades = []);
  let changed = false;
  if (!done.includes('admitXp')) {
    const list = tpl.admit || (tpl.admit = []);
    if (!list.some((x) => /Xp|X線|レントゲン/.test(x))) {
      const i = list.findIndex((x) => /採血/.test(x));
      list.splice(i >= 0 ? i + 1 : list.length, 0, '翌日以降のXpオーダー');
    }
    done.push('admitXp');
    changed = true;
  }
  return changed;
}

export async function init() {
  state.mainDb = await openDB(MAIN_DB);
  for (const k of META_KEYS) state.meta[k] = await get(state.mainDb, 'meta', k);
  state.meta.settings = { ...DEFAULT_SETTINGS, ...(state.meta.settings || {}) };
  const n = state.meta.settings.notify || {};
  state.meta.settings.notify = { ...DEFAULT_NOTIFY, ...n, timers: { ...DEFAULT_NOTIFY.timers, ...(n.timers || {}) } };
  if (!state.meta.templates) state.meta.templates = clone(DEFAULT_TEMPLATES);
  else if (upgradeTemplates(state.meta.templates, state.meta.settings)) { await saveMeta('templates'); await saveMeta('settings'); }
  if (!state.meta.labItems) {
    // 検査項目は ID で検査値とつながるので、最初に作ったものをすぐ保存する
    state.meta.labItems = defaultLabItems();
    await saveMeta('labItems');
  }
  if (!state.meta.history) state.meta.history = { diseases: [], tasks: [] };
  if (!state.meta.security) state.meta.security = { pin: null, pinFails: 0, passFails: 0 };
  if (!state.meta.favMeds) state.meta.favMeds = defaultFavMeds();
  else if (upgradeFavMeds(state.meta.favMeds)) await saveMeta('favMeds');
  if (!state.meta.favFeeds) state.meta.favFeeds = defaultFavFeeds();
  if (!state.meta.diet) state.meta.diet = { forms: [...DEFAULT_DIET_FORMS], types: [...DEFAULT_DIET_TYPES] };
  if (!state.meta.backupInfo) state.meta.backupInfo = { lastAt: null };
  if (!state.meta.notifyQueue) state.meta.notifyQueue = [];
  if (!state.meta.notifyState) state.meta.notifyState = { morning: {} };
  await openData(!!state.meta.settings.demo);
}

// 患者のデータが変わったときに呼ぶ（朝のまとめの作り直しに使う）
const changeHooks = [];
export const onPatientsChanged = (fn) => changeHooks.push(fn);
function changed() {
  for (const fn of changeHooks) {
    try { fn(); } catch (e) { console.warn(e); }
  }
}

async function openData(demo) {
  if (state.dataDb && state.dataDb !== state.mainDb) state.dataDb.close();
  state.demo = demo;
  state.dataDb = demo ? await openDB(DEMO_DB) : state.mainDb;
  state.patients = await getAll(state.dataDb, 'patients');
  // 0.9.0：「結果あり（確認待ち）」をなくしたので、残っていたものはオーダー済に直して保存
  for (const p of state.patients) if (migrateResulted(p)) await put(state.dataDb, 'patients', p);
}

export async function saveMeta(key) {
  await put(state.mainDb, 'meta', state.meta[key], key);
}

export async function setDemo(on) {
  state.meta.settings.demo = !!on;
  await saveMeta('settings');
  await openData(!!on);
  changed();
}

export async function clearDemo() {
  const db = await openDB(DEMO_DB);
  const all = await getAll(db, 'patients');
  for (const p of all) await del(db, 'patients', p.id);
  db.close();
  if (state.demo) state.patients = [];
}

export const findPatient = (id) => state.patients.find((p) => p.id === id);

export async function savePatient(p) {
  p.updatedAt = Date.now();
  if (!state.patients.includes(p)) state.patients.push(p);
  await put(state.dataDb, 'patients', p);
  changed();
}

export async function removePatient(p) {
  state.patients = state.patients.filter((x) => x.id !== p.id);
  await del(state.dataDb, 'patients', p.id);
  changed();
}

export function existingCodes() {
  return new Set(state.patients.map((p) => p.code));
}

// 入力したものを次から候補に出す
export async function remember(kind, text) {
  const t = String(text || '').trim();
  if (!t) return;
  const h = state.meta.history;
  h[kind] = [t, ...(h[kind] || []).filter((x) => x !== t)].slice(0, 30);
  await saveMeta('history');
}

// 合言葉を 5 回続けて間違えたとき：保存した ID をすべて消す（本番・デモとも）
export async function wipeIds() {
  for (const name of [MAIN_DB, DEMO_DB]) {
    const db = name === MAIN_DB ? state.mainDb : await openDB(DEMO_DB);
    const all = await getAll(db, 'patients');
    for (const p of all) {
      if (p.encId) {
        p.encId = null;
        await put(db, 'patients', p);
      }
    }
    if (name !== MAIN_DB && db !== state.dataDb) db.close();
  }
  for (const p of state.patients) p.encId = null;
  state.meta.idKeys = null;
  await saveMeta('idKeys');
  state.meta.security.passFails = 0;
  await saveMeta('security');
}

// PIN を 10 回間違えたとき、または設定から：すべてのデータを消す
export async function wipeAll() {
  try { if (state.dataDb && state.dataDb !== state.mainDb) state.dataDb.close(); } catch (e) { /* noop */ }
  try { state.mainDb && state.mainDb.close(); } catch (e) { /* noop */ }
  await deleteDB(DEMO_DB);
  await deleteDB(MAIN_DB);
  try { localStorage.clear(); sessionStorage.clear(); } catch (e) { /* noop */ }
  location.reload();
}
