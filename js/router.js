// 画面の切り替え（戻るボタン用に、開いた画面を積み重ねて覚える）

import { state } from './store.js';

const registry = {};
let stack = [];
let lastKey = '';

export function register(screens) {
  Object.assign(registry, screens);
}

export const current = () => stack[stack.length - 1];

export function go(name, params = {}, opts = {}) {
  if (opts.reset) stack = [];
  if (opts.replace) stack.pop();
  stack.push({ name, params });
  render();
}

export function back(n = 1) {
  for (let i = 0; i < n && stack.length > 1; i++) stack.pop();
  render();
}

// 指定した画面まで戻る（なければその画面を開く）
export function backTo(name, params) {
  const i = stack.map((s) => s.name).lastIndexOf(name);
  if (i >= 0) {
    stack = stack.slice(0, i + 1);
    if (params) stack[i].params = params;
    render();
  } else {
    go(name, params || {}, { replace: true });
  }
}

export const getStack = () => stack.slice();
export function setStack(s) {
  stack = s.length ? s : [{ name: 'menu', params: {} }];
  render();
}

export function actionFor(name) {
  const cur = current();
  const scr = cur && registry[cur.name];
  return (scr && scr.actions && scr.actions[name]) || (registry._global && registry._global.actions[name]);
}

export function render() {
  const cur = current();
  if (!cur) return;
  const scr = registry[cur.name];
  const app = document.getElementById('app');
  const key = `${cur.name}:${JSON.stringify(cur.params)}:${stack.length}`;
  const keepScroll = key === lastKey;
  const y = window.scrollY;
  const banner = state.demo && cur.name !== 'lock' && cur.name !== 'setup'
    ? '<div class="demo-banner">デモモード（架空の患者です）</div>'
    : '';
  app.innerHTML = banner + scr.render(cur.params || {});
  if (scr.mount) scr.mount(app, cur.params || {});
  window.scrollTo(0, keepScroll ? y : 0);
  lastKey = key;
}
