// はじめての設定（PIN・合言葉）、ロック画面、PIN の変更

import { esc, $ } from '../util.js';
import { state, saveMeta, wipeAll } from '../store.js';
import { go, render, getStack, setStack, current } from '../router.js';
import { hashPin, verifyPin, createIdKeys } from '../crypto.js';
import * as ui from '../ui.js';
import { scheduleMorning, flush, cancelEverything } from '../notify.js';

const PIN_LEN = 6;
let buf = '';
let firstPin = '';
let msg = '';
let busy = false;
let savedStack = null;

function keypad() {
  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', '⌫'];
  // 指が触れた瞬間に反応させる（data-down。クリックを待たない）
  return `<div class="keypad">${keys.map((k) => (k ? `<button class="key" data-down="key" data-k="${k}" aria-label="${k === '⌫' ? '1文字消す' : k}">${k}</button>` : '<span></span>')).join('')}</div>`;
}

function dots() {
  let s = '<div class="dots" aria-label="入力した桁数">';
  for (let i = 0; i < PIN_LEN; i++) s += `<span class="dot ${i < buf.length ? 'on' : ''}"></span>`;
  return s + '</div>';
}

function pinPage(title, sub) {
  return `<div class="pinpage"><div class="brand big-brand">MedPilot</div><div class="pin-title">${esc(title)}</div>${sub ? `<div class="muted small center">${esc(sub)}</div>` : ''}${dots()}<div class="err center">${esc(msg)}</div>${keypad()}</div>`;
}

export function lock() {
  if (!state.unlocked && getStack().length && getStack()[getStack().length - 1].name === 'lock') return;
  state.unlocked = false;
  const st = getStack();
  savedStack = st.length && st[st.length - 1].name !== 'lock' && st[st.length - 1].name !== 'setup' ? st : savedStack;
  buf = '';
  msg = '';
  ui.closeSheet();
  go('lock', {}, { reset: true });
}

function unlock() {
  state.unlocked = true;
  state.lastActive = Date.now();
  const s = savedStack;
  savedStack = null;
  setStack(s && s.length ? s : [{ name: 'menu', params: {} }]);
  // 通知：送れていなかったものを送り、朝のまとめを最新にする
  flush();
  scheduleMorning().catch(() => {});
}

// ---- ロック画面 ----
export const lockScreen = {
  render() {
    const fails = state.meta.security.pinFails || 0;
    const sub = fails ? `あと ${10 - fails} 回間違えると、すべてのデータが消えます` : '';
    return pinPage('PIN を入力', sub);
  },
  actions: {
    async key(ds) {
      if (busy) return;
      if (!press(ds.k)) return;
      busy = true;
      const sec = state.meta.security;
      const ok = await verifyPin(buf, sec.pin);
      buf = '';
      busy = false;
      if (ok) {
        sec.pinFails = 0;
        await saveMeta('security');
        msg = '';
        unlock();
        return;
      }
      sec.pinFails = (sec.pinFails || 0) + 1;
      await saveMeta('security');
      if (sec.pinFails >= 10) {
        await cancelEverything();
        await wipeAll();
        return;
      }
      msg = 'PIN が違います';
      render();
    },
  },
};

// 画面全体を描き直さず、点とメッセージだけ変える（押した感じを速くする）
function updateDots() {
  const dots = document.querySelectorAll('.dots .dot');
  if (dots.length !== PIN_LEN) { render(); return; }
  dots.forEach((d, i) => d.classList.toggle('on', i < buf.length));
  const err = document.querySelector('.pinpage .err');
  if (err) err.textContent = msg;
}

// 1 文字入力。6 桁そろったら true
function press(k) {
  if (k === '⌫') buf = buf.slice(0, -1);
  else if (buf.length < PIN_LEN) buf += k;
  msg = '';
  updateDots();
  return buf.length >= PIN_LEN;
}

// ---- はじめての設定 / PIN の変更 ----
// step: welcome → pin1 → pin2 → pass → (menu)
// change: oldpin → pin1 → pin2
export const setupScreen = {
  render({ step = 'welcome', mode = 'setup' }) {
    if (step === 'welcome') {
      return `<div class="pinpage welcome"><div class="brand big-brand">MedPilot</div>
        <div class="card stack">
          <div class="bold">はじめに 2 つだけ設定します</div>
          <div>① <b>PIN（6桁）</b>：アプリを開くときに使います。10回間違えると、すべてのデータが消えます。</div>
          <div>② <b>合言葉（10文字以上）</b>：保存した患者 ID を見るときに使います。忘れると誰も ID を取り出せません。</div>
          <div class="muted small">データはこの iPhone の中だけに保存されます。</div>
        </div>
        <button class="btn" data-act="setupNext" data-to="pin1">はじめる</button></div>`;
    }
    if (step === 'oldpin') return pinPage('今の PIN を入力', '');
    if (step === 'pin1') return pinPage(mode === 'change' ? '新しい PIN を入力' : 'PIN を決める（6桁）', '');
    if (step === 'pin2') return pinPage('もう一度入力', '');
    if (step === 'pass') {
      return `<div class="pinpage welcome"><div class="brand big-brand">MedPilot</div>
        <div class="pin-title">合言葉を決める</div>
        <div class="card stack">
          <label class="lbl" for="pass1">合言葉（10文字以上）</label><input id="pass1" type="password" autocomplete="off" autocapitalize="off" spellcheck="false">
          <label class="lbl" for="pass2">もう一度</label><input id="pass2" type="password" autocomplete="off" autocapitalize="off" spellcheck="false">
          <div class="warn-a small">忘れると、保存した ID は誰も（作った人も）取り出せません。PIN とは別のものにしてください。</div>
          <div class="err" id="pass-err"></div>
        </div>
        <button class="btn" data-act="setupPass">設定する</button>
        <button class="btn3" data-act="skipPass">あとで設定する</button>
        ${mode === 'change' ? '' : '<div class="card stack"><div class="small">機種変更などで、前の iPhone のバックアップがあるときは、ここから戻せます（合言葉はバックアップのものになります）。</div><button class="btn2" data-act="restoreBackup">バックアップから戻す</button></div>'}</div>`;
    }
    return '';
  },
  actions: {
    setupNext(ds) {
      buf = '';
      msg = '';
      go('setup', { step: ds.to, mode: 'setup' }, { replace: true });
    },
    async key(ds) {
      if (busy) return;
      const { step, mode } = current().params;
      if (!press(ds.k)) return;
      const pin = buf;
      buf = '';
      if (step === 'oldpin') {
        busy = true;
        const ok = await verifyPin(pin, state.meta.security.pin);
        busy = false;
        if (!ok) { msg = 'PIN が違います'; render(); return; }
        go('setup', { step: 'pin1', mode }, { replace: true });
        return;
      }
      if (step === 'pin1') {
        firstPin = pin;
        go('setup', { step: 'pin2', mode }, { replace: true });
        return;
      }
      if (step === 'pin2') {
        if (pin !== firstPin) {
          firstPin = '';
          msg = '一致しませんでした。最初からやり直してください';
          go('setup', { step: 'pin1', mode }, { replace: true });
          return;
        }
        busy = true;
        state.meta.security.pin = await hashPin(pin);
        state.meta.security.pinFails = 0;
        await saveMeta('security');
        busy = false;
        firstPin = '';
        if (mode === 'change') {
          ui.toast('PIN を変えました');
          go('settings', {}, { replace: true });
          return;
        }
        state.unlocked = true;
        go('setup', { step: 'pass', mode }, { replace: true });
      }
    },
    async setupPass(ds, el) {
      const p1 = $('#pass1').value;
      const p2 = $('#pass2').value;
      const err = $('#pass-err');
      if (p1.length < 10) return void (err.textContent = '10文字以上にしてください');
      if (p1 !== p2) return void (err.textContent = '2回入れた合言葉が一致しません');
      el.disabled = true;
      err.textContent = '鍵を作っています（数秒かかります）…';
      try {
        state.meta.idKeys = await createIdKeys(p1);
        await saveMeta('idKeys');
      } catch (e) {
        el.disabled = false;
        err.textContent = `作れませんでした：${e.message}`;
        return;
      }
      finishSetup();
    },
    skipPass() {
      ui.toast('合言葉は設定からいつでも作れます。作るまでは ID を保存できません');
      finishSetup();
    },
  },
};

function finishSetup() {
  state.unlocked = true;
  state.lastActive = Date.now();
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  go('menu', {}, { reset: true });
}
