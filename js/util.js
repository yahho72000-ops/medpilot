// 小さな共通部品（文字のエスケープ、日付、ID など）

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);
}

export function uuid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

// ---- 日付（"YYYY-MM-DD" の文字列で扱う） ----
const z = (n) => String(n).padStart(2, '0');

export function ymd(d = new Date()) {
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`;
}

export function parseYmd(s) {
  const [y, m, d] = String(s).split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(s, n) {
  const d = parseYmd(s);
  d.setDate(d.getDate() + n);
  return ymd(d);
}

// a - b の日数
export function diffDays(a, b) {
  return Math.round((parseYmd(a) - parseYmd(b)) / 86400000);
}

// 毎朝 6 時で切り替わる「今日」
export const RESET_HOUR = 6;
export function dayKey(now = new Date()) {
  const d = new Date(now.getTime() - RESET_HOUR * 3600000);
  return ymd(d);
}

const WD = ['日', '月', '火', '水', '木', '金', '土'];
export function md(s) {
  if (!s) return '';
  const d = parseYmd(s);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}
export function mdw(s) {
  if (!s) return '';
  const d = parseYmd(s);
  return `${d.getMonth() + 1}/${d.getDate()}（${WD[d.getDay()]}）`;
}
export function ymdJa(s) {
  if (!s) return '';
  const d = parseYmd(s);
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}（${WD[d.getDay()]}）`;
}
export function todayJa() {
  const d = new Date();
  return `${d.getMonth() + 1}月${d.getDate()}日（${WD[d.getDay()]}）`;
}

// 文字の比較用（半角カナ→全角、大文字化、空白除去）
export function norm(s) {
  return String(s ?? '').normalize('NFKC').toUpperCase().replace(/[\s　]/g, '');
}

export function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
