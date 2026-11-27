// 栄養：患者ページの部品と操作（経腸栄養・点滴の栄養・経口摂取・絶食・摂取量）、申し送りメモ

import { esc, ymd, md, mdw, dayKey, $ } from './util.js';
import { state, findPatient, savePatient, saveMeta } from './store.js';
import * as F from './nutrition.js';
import * as ui from './ui.js';
import { render } from './router.js';
import { chip } from './screens/common.js';

const P = (ds) => findPatient(ds.pid);
const FEED = (p, ds) => p && (p.feeds || []).find((f) => f.id === ds.fid);
const z = (n) => String(n).padStart(2, '0');
const hhmm = (ms) => { const d = new Date(ms); return `${z(d.getHours())}:${z(d.getMinutes())}`; };
const atOf = (date, time) => new Date(`${date}T${time || '09:00'}`).getTime();
const num = (v) => { const t = String(v ?? '').normalize('NFKC').trim(); return t !== '' && Number.isFinite(Number(t)) ? Number(t) : null; };
const dot = (route) => `<span class="mdot" style="background:${F.ROUTES[route].color}"></span>`;
const r1 = (v) => Math.round(Number(v) * 10) / 10;

// ---- 患者ページの部品 ----
export function nutritionBlock(p, { readonly = false } = {}) {
  const feeds = (p.feeds || []).slice().sort((a, b) => (a.start < b.start ? -1 : 1));
  const today = ymd();
  const act = (f) => (readonly ? '' : `data-act="tapFeed" data-pid="${p.id}" data-fid="${f.id}"`);
  const row = (f) => {
    const s = F.feedStatus(f, today);
    return `<div class="kv mrow" ${act(f)}><span>${dot(f.route)}${esc(f.name)}<br><span class="muted tiny">${esc(F.ROUTES[f.route].label)} ・ ${esc(F.feedSpec(f))}</span></span><span class="mdose"><span class="mdose-main">${esc(s.main)}</span><span class="muted tiny">${esc(s.sub)}</span></span></div>`;
  };
  const active = feeds.filter((f) => !F.feedEnded(f, today));
  const ended = feeds.filter((f) => F.feedEnded(f, today)).reverse();
  const tot = F.totalsText(F.totals(p));
  const o = F.oralNow(p);
  const it = F.intakeToday(p);
  const oralRow = o
    ? `<div class="kv mrow" ${readonly ? '' : `data-act="setOral" data-pid="${p.id}"`}><span>${o.npo ? `絶食<br><span class="muted tiny">${F.npoDay(p)}日目（${md(ymd(new Date(o.at)))}〜）</span>` : `${esc(F.oralText(o))}<br><span class="muted tiny">経口摂取 ・ ${md(ymd(new Date(o.at)))}〜</span>`}</span>
        <span>${o.npo ? chip('絶食', 'a') : readonly ? '' : `<button class="chip ${it === null ? 'r' : 'g'}" data-act="setIntake" data-pid="${p.id}">${it === null ? '今日 未記録' : `今日 ${it}割`}</button>`}</span></div>`
    : '';
  const endedBox = ended.length ? `<details class="ended"><summary class="muted small">終わった栄養（${ended.length}）</summary>${ended.map(row).join('')}</details>` : '';
  const body = `${tot ? `<div class="abx-total">${esc(tot)}</div>` : ''}${active.map(row).join('')}${oralRow}${endedBox}`;
  const empty = !feeds.length && !o;
  const buttons = readonly
    ? ''
    : `<div class="grid3 nbtns"><button class="btn3" data-act="addFeed" data-pid="${p.id}" data-route="en">＋ 経腸</button><button class="btn3" data-act="addFeed" data-pid="${p.id}" data-route="pn">＋ 点滴</button><button class="btn3" data-act="setOral" data-pid="${p.id}">経口・絶食</button></div>`;
  return `${empty ? '<div class="muted small">まだありません</div>' : body}${buttons}`;
}

// 申し送りメモ（1枚目に出す）
export function memoRow(p) {
  if (p.handoffMemo) return `<div class="memo" data-act="editMemo" data-pid="${p.id}"><span class="muted small">申し送りメモ</span><div class="memo-text">${esc(p.handoffMemo)}</div></div>`;
  return `<button class="btn3 memo-add" data-act="editMemo" data-pid="${p.id}">＋ 申し送りメモ</button>`;
}

// ---- 入力の小窓 ----
let sheetP = null;
let sheetRoute = 'en';

function feedSheetHtml(route) {
  const favs = (state.meta.favFeeds || []).filter((f) => f.route === route);
  return `<div class="sheet-title">${esc(F.ROUTES[route].label)}を追加</div>
    <label class="lbl" for="fd-name">商品名</label>
    <input id="fd-name" type="text" autocomplete="off" placeholder="${route === 'en' ? '例：ペプタメン AF' : '例：ビーフリード'}" data-autofocus="no">
    ${favs.length ? `<div class="chips-row">${favs.map((f) => `<button class="pill" data-act="feedFav" data-v="${esc(f.name)}">${esc(f.name)}</button>`).join('')}</div>` : ''}
    <div id="fd-spec" class="conc-fixed hidden"></div>
    <div id="fd-spec-edit" class="stack">
      <div class="lbl">1${F.ROUTES[route].unit}あたり</div>
      <div class="spec-grid"><input id="fd-ml" type="text" inputmode="decimal" autocomplete="off" placeholder="量" aria-label="量 mL"><span class="muted">mL</span><input id="fd-kcal" type="text" inputmode="decimal" autocomplete="off" placeholder="熱量" aria-label="熱量 kcal"><span class="muted">kcal</span></div>
      <div class="spec-grid"><input id="fd-pro" type="text" inputmode="decimal" autocomplete="off" placeholder="${route === 'pn' ? 'アミノ酸（なくても可）' : 'タンパク質（なくても可）'}" aria-label="タンパク質 g"><span class="muted">g</span></div>
    </div>
    <div class="lbl">入れ方</div>
    <div class="seg" data-pick="fmode"><button class="on" data-act="pick" data-v="cont">持続（mL/h）</button><button data-act="pick" data-v="bolus">単回（${F.ROUTES[route].unit} × 回数）</button></div>
    ${amountFields('fd', 'cont', null)}
    <div id="fd-calc" class="calc"></div>
    <label class="lbl" for="fd-date">始めた日時</label>
    <div class="ward-room"><input id="fd-date" type="date" value="${ymd()}" aria-label="日付"><input id="fd-time" type="time" value="${hhmm(Date.now())}" aria-label="時刻"></div>
    <div class="err" id="fd-err"></div>
    <div class="grid2"><button class="btn3" data-act="sheetCancel">やめる</button><button class="btn" data-act="feedOk">追加する</button></div>`;
}

// 速さ（持続）または パック数 × 回数（単回）の入力欄
function amountFields(prefix, mode, c) {
  const unit = F.ROUTES[sheetRoute].unit;
  return `<div id="${prefix}-cont" class="${mode === 'cont' ? '' : 'hidden'}"><label class="lbl" for="${prefix}-rate">速さ（mL/h）　24時間で計算します</label><input id="${prefix}-rate" type="text" inputmode="decimal" autocomplete="off" placeholder="例：40" value="${c && c.ml !== undefined && c.ml > 0 ? esc(r1(c.ml)) : ''}"></div>
    <div id="${prefix}-bolus" class="${mode === 'bolus' ? '' : 'hidden'}">
      <div class="lbl">1回の${unit}数 × 1日の回数</div>
      <div class="spec-grid"><input id="${prefix}-packs" type="text" inputmode="decimal" autocomplete="off" value="${c && c.packs ? esc(r1(c.packs)) : '1'}" aria-label="${unit}数"><span class="muted">${unit} ×</span><input id="${prefix}-times" type="text" inputmode="numeric" autocomplete="off" value="${c && c.times ? esc(c.times) : '3'}" aria-label="回数"><span class="muted">回/日</span></div>
      <div class="chips-row">${[0.5, 1, 2].map((n) => `<button class="pill" data-act="feedPacks" data-p="${prefix}" data-v="${n}">${n}${unit}</button>`).join('')}${[1, 2, 3, 4].map((n) => `<button class="pill" data-act="feedTimes" data-p="${prefix}" data-v="${n}">${n}回</button>`).join('')}</div>
    </div>`;
}

const pickedMode = () => { const b = $('.seg[data-pick="fmode"] .on'); return b ? b.dataset.v : 'cont'; };

// 小窓の中身から商品の情報を読む（よく使う栄養にあればそれを使う）
function feedDraft() {
  const name = $('#fd-name').value.trim();
  const f = F.findFeedFav(state.meta.favFeeds, name);
  if (f && f.route === sheetRoute && f.packMl && f.packKcal) return { ...f, fixed: true };
  return { name, route: sheetRoute, packMl: num($('#fd-ml').value), packKcal: num($('#fd-kcal').value), protein: num($('#fd-pro').value), fixed: false };
}

function readAmount(prefix, mode) {
  if (mode === 'cont') return { ml: num($(`#${prefix}-rate`).value) };
  return { packs: num($(`#${prefix}-packs`).value), times: num($(`#${prefix}-times`).value) };
}

function calcText(spec, mode, amt) {
  if (!spec.packMl || !spec.packKcal) return '';
  const f = { ...spec, mode };
  const c = mode === 'cont' ? (amt.ml !== null ? { ml: amt.ml } : null) : (amt.packs !== null && amt.times !== null ? { packs: amt.packs, times: amt.times } : null);
  if (!c) return '';
  const kcal = F.kcalDay(f, c);
  const pr = F.proteinDay(f, c);
  const w = sheetP && Number(sheetP.weight) > 0 ? Number(sheetP.weight) : null;
  const head = mode === 'cont'
    ? `${r1(c.ml)}mL/h × 24時間 × ${r1(F.kcalPerMl(f))}kcal/mL`
    : `${r1(c.packs)}${F.ROUTES[spec.route].unit} × ${c.times}回 × ${r1(spec.packKcal)}kcal`;
  return `${head} ＝ ${Math.round(kcal)}kcal/日${w ? `（${r1(kcal / w)}kcal/kg）` : ''}${pr !== null ? ` ・ タンパク質 ${r1(pr)}g/日` : ''}`;
}

function refreshFeedSheet() {
  const d = feedDraft();
  $('#fd-spec').classList.toggle('hidden', !d.fixed);
  $('#fd-spec-edit').classList.toggle('hidden', d.fixed);
  if (d.fixed) $('#fd-spec').textContent = `1${F.ROUTES[d.route].unit} ${r1(d.packMl)}mL ・ ${r1(d.packKcal)}kcal（${r1(d.packKcal / d.packMl)}kcal/mL）${d.protein !== null && d.protein !== undefined ? ` ・ ${d.route === 'pn' ? 'アミノ酸' : 'タンパク質'} ${r1(d.protein)}g` : ''}`;
  const mode = pickedMode();
  $('#fd-cont').classList.toggle('hidden', mode !== 'cont');
  $('#fd-bolus').classList.toggle('hidden', mode !== 'bolus');
  $('#fd-calc').textContent = calcText(d, mode, readAmount('fd', mode));
}

let chFeed = null;
function refreshChangeSheet() {
  const f = chFeed;
  $('#ch-calc').textContent = calcText(f, f.mode, readAmount('ch', f.mode));
}

async function pickDate(title, initial) {
  return ui.custom(`<div class="sheet-title">${esc(title)}</div>
    <input id="sheet-date" type="date" value="${esc(initial || ymd())}">
    <div class="grid2"><button class="btn3" data-act="sheetCancel">やめる</button><button class="btn" data-act="dateOk">決定</button></div>`);
}

async function done(p, msg) {
  await savePatient(p);
  render();
  if (msg) ui.toast(msg);
}

export const nutritionActions = {
  async addFeed(ds) {
    const p = P(ds);
    sheetP = p;
    sheetRoute = ds.route === 'pn' ? 'pn' : 'en';
    const pr = ui.custom(feedSheetHtml(sheetRoute));
    $('.seg[data-pick="fmode"]').addEventListener('picked', refreshFeedSheet);
    for (const id of ['#fd-name', '#fd-ml', '#fd-kcal', '#fd-pro', '#fd-rate', '#fd-packs', '#fd-times']) $(id).addEventListener('input', refreshFeedSheet);
    refreshFeedSheet();
    const r = await pr;
    if (!r) return;
    const f = F.newFeed(r);
    p.feeds = [...(p.feeds || []), f];
    const favs = state.meta.favFeeds || (state.meta.favFeeds = []);
    if (!F.findFeedFav(favs, r.name)) {
      favs.push({ name: r.name, route: r.route, packMl: r.packMl, packKcal: r.packKcal, protein: r.protein });
      await saveMeta('favFeeds');
    }
    await done(p, `${f.name} を追加しました（${Math.round(F.kcalDay(f, F.feedAt(f)))}kcal/日）`);
  },

  feedFav(ds) {
    $('#fd-name').value = ds.v;
    refreshFeedSheet();
  },
  feedPacks(ds) { $(`#${ds.p}-packs`).value = ds.v; (ds.p === 'fd' ? refreshFeedSheet : refreshChangeSheet)(); },
  feedTimes(ds) { $(`#${ds.p}-times`).value = ds.v; (ds.p === 'fd' ? refreshFeedSheet : refreshChangeSheet)(); },

  feedOk() {
    const err = $('#fd-err');
    const d = feedDraft();
    if (!d.name) return void (err.textContent = '商品名を入れてください');
    if (!(d.packMl > 0) || !(d.packKcal > 0)) return void (err.textContent = `1${F.ROUTES[sheetRoute].unit}あたりの量（mL）と熱量（kcal）を入れてください`);
    const mode = pickedMode();
    const a = readAmount('fd', mode);
    if (mode === 'cont' && !(a.ml >= 0 && a.ml !== null)) return void (err.textContent = '速さ（mL/h）を数字で入れてください');
    if (mode === 'bolus' && !(a.packs > 0 && a.times > 0)) return void (err.textContent = '数と回数を入れてください');
    const date = $('#fd-date').value || ymd();
    ui.resolveSheet({ route: sheetRoute, name: d.name, packMl: d.packMl, packKcal: d.packKcal, protein: d.protein ?? null, mode, start: date, at: atOf(date, $('#fd-time').value), ...a });
  },

  async tapFeed(ds) {
    const p = P(ds);
    const f = FEED(p, ds);
    if (!f) return;
    const ended = !!f.end;
    const opts = [];
    if (!ended) {
      opts.push({ v: 'change', label: f.mode === 'cont' ? '速さを変える' : '数・回数を変える', tone: 'btn' });
      opts.push({ v: 'endToday', label: '終了にする（今日まで）' }, { v: 'endDate', label: '終了日を選ぶ' });
    } else {
      opts.push({ v: 'reopen', label: '終了を取り消す（続ける）' }, { v: 'endDate', label: `終了日を変える（${md(f.end)}）` });
    }
    if ((f.changes || []).length) opts.push({ v: 'hist', label: `記録（${f.changes.length}件）` });
    opts.push({ v: 'start', label: `開始日を変える（${md(f.start)}）`, tone: 'btn3' }, { v: 'del', label: '削除する', tone: 'danger' });
    const s = F.feedStatus(f);
    const v = await ui.choose(f.name, `${esc(F.ROUTES[f.route].label)} ・ ${esc(F.feedSpec(f))}<br>今：${esc(s.main)}（${esc(s.sub)}）`, opts);
    if (!v) return;
    if (v === 'change') {
      chFeed = f;
      sheetP = p;
      sheetRoute = f.route;
      const cur = F.feedAt(f);
      const pr = ui.custom(`<div class="sheet-title">${esc(f.name)}：${f.mode === 'cont' ? '速さ' : '数・回数'}</div>
        ${amountFields('ch', f.mode, cur)}
        <div id="ch-calc" class="calc"></div>
        <label class="lbl" for="ch-time">変えた日時</label>
        <div class="ward-room"><input id="ch-date" type="date" value="${ymd()}" aria-label="日付"><input id="ch-time" type="time" value="${hhmm(Date.now())}" aria-label="時刻"></div>
        <div class="err" id="ch-err"></div>
        <div class="grid2"><button class="btn3" data-act="sheetCancel">やめる</button><button class="btn" data-act="feedChangeOk">記録する</button></div>`);
      for (const id of ['#ch-rate', '#ch-packs', '#ch-times']) $(id).addEventListener('input', refreshChangeSheet);
      refreshChangeSheet();
      const r = await pr;
      if (!r) return;
      f.changes.push(r);
      f.changes.sort((a, b) => a.at - b.at);
      return done(p, `${f.name}：${F.changeText(f, r)}（${Math.round(F.kcalDay(f, r))}kcal/日）`);
    }
    if (v === 'endToday') { F.endFeed(f, ymd()); return done(p, `${f.name} を終了にしました`); }
    if (v === 'endDate') {
      const d = await pickDate(`${f.name} の終了日（最後の日）`, f.end || ymd());
      if (!d) return;
      if (d < f.start) return ui.toast('終了日は開始日より後にしてください');
      if (f.end) f.end = d; else F.endFeed(f, d);
      return done(p);
    }
    if (v === 'reopen') { F.reopenFeed(f); return done(p, `${f.name} を続けるにしました`); }
    if (v === 'hist') {
      const list = f.changes.slice().reverse();
      const r = await ui.choose(`${f.name} の記録`, 'タップすると、その記録を消せます', list.map((c, i) => ({ v: String(f.changes.length - 1 - i), label: `${mdw(ymd(new Date(c.at)))} ${hhmm(c.at)}　${F.changeText(f, c)}`, tone: 'btn2' })));
      if (r === null) return;
      const ok = await ui.choose('この記録を消しますか？', '', [{ v: 'yes', label: '消す', tone: 'danger' }]);
      if (ok !== 'yes') return;
      f.changes.splice(Number(r), 1);
      return done(p);
    }
    if (v === 'start') {
      const d = await pickDate(`${f.name} の開始日`, f.start);
      if (!d) return;
      f.start = d;
      return done(p);
    }
    if (v === 'del') {
      const ok = await ui.choose(`${f.name} を削除しますか？`, '記録ごと消えます。', [{ v: 'yes', label: '削除する', tone: 'danger' }]);
      if (ok !== 'yes') return;
      p.feeds = p.feeds.filter((x) => x !== f);
      return done(p, '削除しました');
    }
  },

  feedChangeOk() {
    const f = chFeed;
    const a = readAmount('ch', f.mode);
    const err = $('#ch-err');
    if (f.mode === 'cont' && !(a.ml !== null && a.ml >= 0)) return void (err.textContent = '速さ（mL/h）を数字で入れてください（止めたときは 0）');
    if (f.mode === 'bolus' && !(a.packs !== null && a.times !== null)) return void (err.textContent = '数と回数を入れてください');
    ui.resolveSheet({ at: atOf($('#ch-date').value || ymd(), $('#ch-time').value), ...a });
  },

  // 経口摂取・絶食
  async setOral(ds) {
    const p = P(ds);
    const o = F.oralNow(p);
    const diet = state.meta.diet || { forms: [], types: [] };
    const forms = diet.forms.map((x) => `<button class="${o && !o.npo && o.form === x ? 'on' : ''}" data-act="pick" data-v="${esc(x)}">${esc(x)}</button>`).join('');
    const types = ['', ...diet.types].map((x) => `<button class="${(o && !o.npo ? o.diet || '' : '') === x ? 'on' : ''}" data-act="pick" data-v="${esc(x)}">${x ? esc(x) : 'なし'}</button>`).join('');
    const pr = ui.custom(`<div class="sheet-title">経口摂取・絶食</div>
      ${o ? `<div class="muted small">今：${esc(F.oralText(o))}（${md(ymd(new Date(o.at)))}〜）</div>` : ''}
      <div class="seg" data-pick="npo"><button class="${o && o.npo ? '' : 'on'}" data-act="pick" data-v="0">経口</button><button class="${o && o.npo ? 'on' : ''}" data-act="pick" data-v="1">絶食</button></div>
      <div id="or-box" class="${o && o.npo ? 'hidden' : ''} stack">
        <div class="lbl">形態</div><div class="seg wrap4" data-pick="form">${forms}</div>
        <div class="lbl">治療食</div><div class="seg wrap3" data-pick="diet">${types}</div>
      </div>
      <label class="lbl" for="or-date">いつから</label>
      <div class="ward-room"><input id="or-date" type="date" value="${ymd()}" aria-label="日付"><input id="or-time" type="time" value="${hhmm(Date.now())}" aria-label="時刻"></div>
      <div class="muted small">形態・治療食の選択肢は、設定 → 栄養 で増やせます。</div>
      <div class="err" id="or-err"></div>
      <div class="grid2"><button class="btn3" data-act="sheetCancel">やめる</button><button class="btn" data-act="oralOk">記録する</button></div>
      ${o ? '<button class="btn3" data-act="sheetChoose" data-v="__undo">最後の記録を取り消す</button>' : ''}`);
    $('.seg[data-pick="npo"]').addEventListener('picked', (e) => $('#or-box').classList.toggle('hidden', e.detail.value === '1'));
    const r = await pr;
    if (!r) return;
    if (r === '__undo') {
      p.oral.pop();
      return done(p, '最後の記録を取り消しました');
    }
    p.oral = [...(p.oral || []), r].sort((a, b) => a.at - b.at);
    return done(p, r.npo ? '絶食にしました' : `食事：${F.oralText(r)}`);
  },

  oralOk() {
    const nb = $('.seg[data-pick="npo"] .on');
    const npo = !!nb && nb.dataset.v === '1';
    const at = atOf($('#or-date').value || ymd(), $('#or-time').value);
    if (npo) return void ui.resolveSheet({ at, npo: true, form: '', diet: '' });
    const form = $('.seg[data-pick="form"] .on');
    if (!form) return void ($('#or-err').textContent = '形態を選んでください');
    const diet = $('.seg[data-pick="diet"] .on');
    ui.resolveSheet({ at, npo: false, form: form.dataset.v, diet: diet ? diet.dataset.v : '' });
  },

  async setIntake(ds) {
    const p = P(ds);
    const cur = F.intakeToday(p);
    const v = await ui.custom(`<div class="sheet-title">今日の食事の摂取量</div>
      <div class="seg wrap6">${Array.from({ length: 11 }, (_, i) => `<button class="${cur === i ? 'on' : ''}" data-act="sheetChoose" data-v="${i}">${i}割</button>`).join('')}</div>
      <button class="btn3" data-act="sheetChoose" data-v="__clear">未記録に戻す</button>
      <button class="btn3" data-act="sheetCancel">やめる</button>`);
    if (v === null) return;
    F.setIntake(p, v === '__clear' ? null : Number(v), dayKey());
    return done(p, v === '__clear' ? '未記録に戻しました' : `今日の摂取量：${v}割`);
  },

  // 申し送りメモ
  async editMemo(ds) {
    const p = P(ds);
    const t = await ui.promptText({ title: `${p.code} の申し送りメモ`, value: p.handoffMemo || '', multiline: true, placeholder: '例：夜間 MAP 65 未満なら NAD 増量', note: '空にして決定すると消えます。' });
    if (t === null) return;
    p.handoffMemo = t;
    return done(p, t ? '申し送りメモを保存しました' : '申し送りメモを消しました');
  },
};
