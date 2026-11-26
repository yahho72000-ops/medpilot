// データの読み書きとアプリ全体の状態

import { openDB, get, getAll, put, del, deleteDB } from './db.js';
import { DEFAULT_TEMPLATES } from './model.js';
import { defaultLabItems } from './labs.js';

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
};

const DEFAULT_SETTINGS = { theme: 'dark', font: 'm', inpatientSort: 'days', demo: false };
const META_KEYS = ['security', 'settings', 'templates', 'labItems', 'history', 'idKeys'];

const clone = (x) => JSON.parse(JSON.stringify(x));

export async function init() {
  state.mainDb = await openDB(MAIN_DB);
  for (const k of META_KEYS) state.meta[k] = await get(state.mainDb, 'meta', k);
  state.meta.settings = { ...DEFAULT_SETTINGS, ...(state.meta.settings || {}) };
  if (!state.meta.templates) state.meta.templates = clone(DEFAULT_TEMPLATES);
  if (!state.meta.labItems) state.meta.labItems = defaultLabItems();
  if (!state.meta.history) state.meta.history = { diseases: [], tasks: [] };
  if (!state.meta.security) state.meta.security = { pin: null, pinFails: 0, passFails: 0 };
  await openData(!!state.meta.settings.demo);
}

async function openData(demo) {
  if (state.dataDb && state.dataDb !== state.mainDb) state.dataDb.close();
  state.demo = demo;
  state.dataDb = demo ? await openDB(DEMO_DB) : state.mainDb;
  state.patients = await getAll(state.dataDb, 'patients');
}

export async function saveMeta(key) {
  await put(state.mainDb, 'meta', state.meta[key], key);
}

export async function setDemo(on) {
  state.meta.settings.demo = !!on;
  await saveMeta('settings');
  await openData(!!on);
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
}

export async function removePatient(p) {
  state.patients = state.patients.filter((x) => x.id !== p.id);
  await del(state.dataDb, 'patients', p.id);
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
