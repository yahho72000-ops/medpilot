// 通知（ntfy）：タスクのタイマーと朝のまとめ
// MedPilot から外に出る唯一のもの。中身は識別番号・タスク名・薬やデバイスの名前・検体だけ
// （あだ名・ベッド・年代・性別・病名・ID は出さない）

import { state, saveMeta } from './store.js';
import { ymd, addDays, parseYmd, diffDays, mdw } from './util.js';
import * as M from './model.js';
import { cultureOpen, cultureTitle, medFinal, medDay } from './meds.js';

export const SERVER = 'https://ntfy.sh';
const cfg = () => state.meta.settings.notify;

// 受け取り先（topic）：推測されにくいランダムな名前
export function newTopic() {
  const chars = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const b = crypto.getRandomValues(new Uint8Array(22));
  return `medpilot-${[...b].map((x) => chars[x % chars.length]).join('')}`;
}

export const canNotify = () => !!(cfg().on && cfg().topic && !state.demo);

// ---- 送る（電波がないときは覚えておいて、あとで送り直す） ----
let flushing = false;

async function saveQueue() {
  await saveMeta('notifyQueue');
}

function enqueue(op) {
  const q = state.meta.notifyQueue;
  // 同じ通知への古い指示は捨てる（新しいものだけ送る）
  state.meta.notifyQueue = q.filter((x) => !(x.seq === op.seq && x.topic === op.topic));
  state.meta.notifyQueue.push(op);
}

export async function publish({ seq, at = 0, title, message, priority = 3 }) {
  if (!canNotify()) return;
  enqueue({ kind: 'pub', topic: cfg().topic, seq, at, title, message, priority });
  await saveQueue();
  flush();
}

export async function cancel(seq, topic = cfg().topic) {
  if (!topic) return;
  enqueue({ kind: 'del', topic, seq });
  await saveQueue();
  flush();
}

async function send(op) {
  if (op.kind === 'del') {
    const r = await fetch(`${SERVER}/${encodeURIComponent(op.topic)}/${encodeURIComponent(op.seq)}`, { method: 'DELETE', cache: 'no-store', referrerPolicy: 'no-referrer' });
    return r.status;
  }
  const body = { topic: op.topic, title: op.title, message: op.message, priority: op.priority, sequence_id: op.seq };
  if (op.at && op.at > Date.now() + 20000) body.delay = String(Math.floor(op.at / 1000));
  const r = await fetch(`${SERVER}/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    cache: 'no-store',
    referrerPolicy: 'no-referrer',
  });
  return r.status;
}

export async function flush() {
  if (flushing || !state.mainDb || !Array.isArray(state.meta.notifyQueue) || !state.meta.notifyQueue.length) return;
  flushing = true;
  try {
    while (state.meta.notifyQueue.length) {
      if (typeof navigator !== 'undefined' && navigator.onLine === false) break;
      const op = state.meta.notifyQueue[0];
      // 時間が過ぎた予約はやめる
      if (op.kind === 'pub' && op.at && op.at < Date.now() - 60000) {
        state.meta.notifyQueue.shift();
        continue;
      }
      let status;
      try {
        status = await send(op);
      } catch (e) {
        break; // 電波がない・つながらない → あとで
      }
      if (status === 429 || status >= 500) break; // 混んでいる → あとで
      state.meta.notifyQueue.shift(); // 送れた（または送っても意味のない指示）
    }
  } finally {
    flushing = false;
    await saveQueue();
  }
}

export const pendingCount = () => (state.meta.notifyQueue || []).length;

// すぐ届くテスト通知
export async function sendTest() {
  const op = { kind: 'pub', topic: cfg().topic, seq: `test-${Date.now()}`, at: 0, title: 'MedPilot テスト', message: '通知のテストです。届いていれば設定は完了です。', priority: 3 };
  const status = await send(op);
  if (status >= 400) throw new Error(`送れませんでした（${status}）`);
}

// ---- タスクのタイマー ----
export const TIMER_KINDS = { lab: '血液検査', image: '画像', ecg: '心電図', consult: 'コンサルト', free: 'そのほか（自由タスクなど）' };
export const timerKind = (t) => (['lab', 'image', 'ecg', 'consult'].includes(t.kind) ? t.kind : 'free');
export const defaultTimer = (t) => Number(cfg().timers[timerKind(t)] || 0);

const seqOf = (t) => `t-${t.id}`;

export async function setTaskTimer(p, t, minutes) {
  await clearTaskTimer(t);
  if (!minutes || !canNotify()) return false;
  const at = Date.now() + minutes * 60000;
  t.timer = { at, min: minutes };
  const what = t.kind === 'consult' ? '返事を確認' : '結果を確認';
  await publish({ seq: seqOf(t), at, title: 'MedPilot タイマー', message: `${p.code} ${t.label} ${what}（${minutes}分たちました）`, priority: 4 });
  const again = Number(cfg().again || 0);
  if (again) {
    await publish({ seq: `${seqOf(t)}-2`, at: at + again * 60000, title: 'MedPilot タイマー（2回目）', message: `${p.code} ${t.label} まだ確認していません`, priority: 4 });
  }
  return true;
}

export async function clearTaskTimer(t) {
  if (!t.timer) return;
  const topic = cfg().topic;
  t.timer = null;
  if (!topic) return;
  await cancel(seqOf(t), topic);
  await cancel(`${seqOf(t)}-2`, topic);
}

export async function clearPatientTimers(p) {
  for (const t of p.tasks || []) if (t.timer) await clearTaskTimer(t);
}

// ---- 朝のまとめ ----
function icDaysOn(p, day) {
  const base = p.lastICDate || p.admitDate;
  return base ? diffDays(day, base) : null;
}

export function buildMorning(patients, day) {
  const live = patients.filter((p) => p.location !== 'past');
  const inp = live.filter((p) => p.location === 'inpatient');
  const plan = [];
  for (const p of live) {
    for (const t of p.tasks || []) {
      if (!M.isOpen(t) || !t.dueDate || t.dueDate > day) continue;
      plan.push(`${p.code} ${t.label}${t.dueDate < day ? '（期限切れ）' : ''}`);
    }
    for (const c of p.cultures || []) {
      if (!cultureOpen(c) || !c.due || c.due > day) continue;
      plan.push(`${p.code} ${cultureTitle(c)} 確認${c.due < day ? '（日にちを過ぎています）' : ''}`);
    }
    for (const m of p.meds || []) {
      const f = medFinal(m, day);
      if (f === 'final') plan.push(`${p.code} ${m.name} 最終日`);
      if (f === 'over') plan.push(`${p.code} ${m.name} 予定日数を過ぎています（${medDay(m, day)}/${m.planDays}日目）`);
    }
  }
  const ic = inp.filter((p) => !p.ending && icDaysOn(p, day) !== null && icDaysOn(p, day) >= M.IC_WARN_DAYS).map((p) => p.code);
  const dev = [];
  for (const p of inp) {
    for (const d of p.devices || []) {
      if (d.removedDate) continue;
      const n = diffDays(day, d.insertedDate) + 1;
      if (n >= M.DEVICE_WARN_DAYS) dev.push(`${p.code} ${d.type}（${n}日目）`);
    }
  }
  const lines = [`回診 ${inp.length}人`];
  if (plan.length) lines.push('', `今日の予定（${plan.length}）`, ...plan.map((x) => `・${x}`));
  else lines.push('', '今日の予定なし');
  if (ic.length) lines.push('', `IC 7日超：${ic.join('、')}`);
  if (dev.length) lines.push('', `デバイス 14日超：${dev.join('、')}`);
  let message = lines.join('\n');
  // ntfy の上限（4KB）に収める
  const enc = new TextEncoder();
  while (enc.encode(message).length > 3800 && lines.length > 3) {
    lines.splice(lines.length - 2, 1);
    message = `${lines.join('\n')}\n…（続きは MedPilot で）`;
  }
  return { title: `MedPilot 朝のまとめ ${mdw(day)}`, message };
}

// 3日先までの朝のまとめを予約する。中身が変わったものだけ送り直す
export async function scheduleMorning(now = Date.now()) {
  if (state.demo || !cfg().topic) return;
  const c = cfg();
  const sent = state.meta.notifyState.morning || (state.meta.notifyState.morning = {});
  const wanted = new Map();
  if (c.on && c.morning) {
    const [hh, mm] = String(c.morningTime || '06:00').split(':').map(Number);
    for (let i = 0; i <= 3; i++) {
      const day = addDays(ymd(new Date(now)), i);
      const dt = parseYmd(day);
      dt.setHours(hh || 0, mm || 0, 0, 0);
      const at = dt.getTime();
      if (at <= now + 60000 || at > now + 3 * 86400000 - 600000) continue;
      wanted.set(`m-${day.replace(/-/g, '')}`, { at, ...buildMorning(state.patients, day) });
    }
  }
  let dirty = false;
  for (const [seq, msg] of wanted) {
    const key = JSON.stringify(msg);
    if (sent[seq] && sent[seq].key === key) continue;
    await publish({ seq, at: msg.at, title: msg.title, message: msg.message, priority: 3 });
    sent[seq] = { key, at: msg.at };
    dirty = true;
  }
  for (const seq of Object.keys(sent)) {
    if (wanted.has(seq)) continue;
    // まだ届いていない予約だけ取り消す（届いたものは消さない）
    if (sent[seq].at > now + 30000) await cancel(seq);
    delete sent[seq];
    dirty = true;
  }
  if (dirty) await saveMeta('notifyState');
}

// 朝のまとめの予約をすべて取り消す（受け取り先を作り直すとき・データを消すとき）
export async function cancelAllMorning() {
  const sent = state.meta.notifyState.morning || {};
  for (const seq of Object.keys(sent)) {
    if (sent[seq].at > Date.now()) await cancel(seq);
    delete sent[seq];
  }
  await saveMeta('notifyState');
}

// 予約しているものをできるだけ取り消してから（すべて消す前に）
export async function cancelEverything(timeoutMs = 2500) {
  const work = (async () => {
    if (!cfg().topic) return;
    for (const p of state.patients) await clearPatientTimers(p);
    await cancelAllMorning();
    await flush();
  })();
  await Promise.race([work, new Promise((r) => setTimeout(r, timeoutMs))]);
}

// ---- 動かし方 ----
let debounce = null;
export function changedSoon() {
  clearTimeout(debounce);
  debounce = setTimeout(() => {
    debounce = null;
    scheduleMorning().catch((e) => console.warn('ntfy', e));
  }, 4000);
}

// アプリを閉じる（裏に回る）ときは、待たずにすぐ送る
export function changedNow() {
  if (!debounce) return;
  clearTimeout(debounce);
  debounce = null;
  scheduleMorning().catch((e) => console.warn('ntfy', e));
}

export function startNotify() {
  window.addEventListener('online', () => flush());
  setInterval(() => {
    if (state.unlocked) scheduleMorning().catch(() => {});
    flush();
  }, 10 * 60 * 1000);
}
