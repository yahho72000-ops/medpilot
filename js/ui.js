// 下から出る小窓（シート）、確認、入力、お知らせ（トースト）

import { esc, $ } from './util.js';

let sheetResolve = null;
let toastTimer = null;
let toastUndo = null;

export function sheet(html, { onClose } = {}) {
  closeSheet(null);
  const layer = $('#sheet-layer');
  layer.innerHTML = `<div class="backdrop" data-act="sheetBackdrop"><div class="sheet" role="dialog" aria-modal="true">${html}</div></div>`;
  sheetOnClose = onClose || null;
  const first = layer.querySelector('input:not([type=hidden]), textarea');
  if (first && first.dataset.autofocus !== 'no') setTimeout(() => first.focus(), 50);
}
let sheetOnClose = null;

export function closeSheet(value = null) {
  const layer = $('#sheet-layer');
  if (layer) layer.innerHTML = '';
  const r = sheetResolve;
  sheetResolve = null;
  const oc = sheetOnClose;
  sheetOnClose = null;
  if (oc) oc();
  if (r) r(value);
}

export const sheetOpen = () => !!$('#sheet-layer .sheet');

// 選択肢から選ぶ（options: [{v, label, tone}]）。閉じたら null
export function choose(title, text, options) {
  return new Promise((resolve) => {
    const btns = options
      .map((o) => `<button class="${o.tone || 'btn2'}" data-act="sheetChoose" data-v="${esc(o.v)}">${esc(o.label)}</button>`)
      .join('');
    sheet(`<div class="sheet-title">${esc(title)}</div>${text ? `<div class="muted">${text}</div>` : ''}<div class="stack">${btns}</div><button class="btn3" data-act="sheetCancel">やめる</button>`);
    sheetResolve = resolve;
  });
}

// 文字を入力してもらう。閉じたら null
export function promptText({ title, label = '', value = '', placeholder = '', multiline = false, suggestions = [], inputmode = '', note = '' }) {
  return new Promise((resolve) => {
    const field = multiline
      ? `<textarea id="sheet-input" rows="4" placeholder="${esc(placeholder)}">${esc(value)}</textarea>`
      : `<input id="sheet-input" type="text" value="${esc(value)}" placeholder="${esc(placeholder)}" autocomplete="off" ${inputmode ? `inputmode="${inputmode}"` : ''}>`;
    const sug = suggestions.length
      ? `<div class="chips-row">${suggestions.slice(0, 12).map((s) => `<button class="pill" data-act="sheetSuggest" data-v="${esc(s)}">${esc(s)}</button>`).join('')}</div>`
      : '';
    sheet(`<div class="sheet-title">${esc(title)}</div>${label ? `<label class="lbl" for="sheet-input">${esc(label)}</label>` : ''}${field}${sug}${note ? `<div class="warn-a small">${esc(note)}</div>` : ''}<div class="grid2"><button class="btn3" data-act="sheetCancel">やめる</button><button class="btn" data-act="sheetOk">決定</button></div>`);
    sheetResolve = resolve;
  });
}

// 自由な中身のシート。決定ボタンから resolveSheet(value) を呼ぶ
export function custom(html, opts) {
  return new Promise((resolve) => {
    sheet(html, opts);
    sheetResolve = resolve;
  });
}
export const resolveSheet = (v) => closeSheet(v);

export function toast(msg, undo, label = '元に戻す') {
  const layer = $('#toast-layer');
  toastUndo = undo || null;
  layer.innerHTML = `<div class="toast" role="status"><span>${esc(msg)}</span>${undo ? `<button data-act="toastUndo">${esc(label)}</button>` : ''}</div>`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    layer.innerHTML = '';
    toastUndo = null;
  }, undo ? 6000 : 2600);
}

export function runToastUndo() {
  const f = toastUndo;
  toastUndo = null;
  $('#toast-layer').innerHTML = '';
  if (f) f();
}

// シート共通の操作
export const sheetActions = {
  sheetBackdrop(ds, el, ev) {
    if (ev.target === el) closeSheet(null);
  },
  sheetCancel() {
    closeSheet(null);
  },
  sheetChoose(ds) {
    closeSheet(ds.v);
  },
  sheetOk() {
    const inp = $('#sheet-input');
    closeSheet(inp ? inp.value.trim() : '');
  },
  sheetSuggest(ds) {
    const inp = $('#sheet-input');
    if (inp) {
      inp.value = ds.v;
      inp.focus();
    }
  },
  toastUndo() {
    runToastUndo();
  },
};
