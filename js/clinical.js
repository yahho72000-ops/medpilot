// 薬と培養：患者ページに出す部品と、タップしたときの操作

import { esc, ymd, md, mdw, addDays, $ } from './util.js';
import { state, findPatient, savePatient, saveMeta } from './store.js';
import * as K from './meds.js';
import * as ui from './ui.js';
import { go, render } from './router.js';
import { afterChange } from './actions.js';
import { chip } from './screens/common.js';

const P = (ds) => findPatient(ds.pid);
const MED = (p, ds) => p && (p.meds || []).find((m) => m.id === ds.mid);
const CUL = (p, ds) => p && (p.cultures || []).find((c) => c.id === ds.cid);
const hhmm = (ms) => { const d = new Date(ms); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
const nowHHMM = () => hhmm(Date.now());
const atOf = (date, time) => new Date(`${date}T${time || '09:00'}`).getTime();
const dot = (cat) => `<span class="mdot" style="background:${(K.MED_CATS[cat] || K.MED_CATS.other).color}"></span>`;

// ---- 患者ページの部品 ----
export function medsBlock(p, { readonly = false } = {}) {
  const meds = p.meds || [];
  const today = ymd();
  const act = (m) => (readonly ? '' : `data-act="tapMed" data-pid="${p.id}" data-mid="${m.id}"`);
  const row = (m) => {
    const s = K.medStatus(m, today, p.weight);
    if (s.flow) {
      // 流量の薬：上に量（γ など）、下に mL/h と何日目
      const sub = [s.flow.ml, `${s.day}日目`].filter(Boolean).join(' ・ ');
      return `<div class="kv mrow" ${act(m)}><span>${dot(m.cat)}${esc(m.name)}</span><span class="mdose"><span class="mdose-main">${esc(s.flow.dose)}</span><span class="muted tiny ${s.flow.needWeight ? 'warn-a' : ''}">${esc(sub)}</span></span></div>`;
    }
    return `<div class="kv mrow" ${act(m)}><span>${dot(m.cat)}${esc(m.name)}</span><span>${chip(s.text, s.tone)}</span></div>`;
  };
  const sorted = meds.slice().sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));
  const active = sorted.filter((m) => !K.medEnded(m, today));
  const ended = sorted.filter((m) => K.medEnded(m, today)).reverse();
  const abx = K.abxText(p, today);
  const head = abx ? `<div class="abx-total">${esc(abx)}</div>` : '';
  const endedBox = ended.length
    ? `<details class="ended"><summary class="muted small">終わった薬（${ended.length}）</summary>${ended.map(row).join('')}</details>`
    : '';
  if (!meds.length) return '<div class="muted small">まだありません</div>';
  return `${head}${active.map(row).join('') || '<div class="muted small">今使っている薬はありません</div>'}${endedBox}`;
}

export function culturesBlock(p, { readonly = false } = {}) {
  const list = (p.cultures || []).slice().sort((a, b) => (a.submitted < b.submitted ? 1 : a.submitted > b.submitted ? -1 : 0));
  if (!list.length) return '<div class="muted small">まだありません</div>';
  return list
    .map((c) => {
      const s = K.cultureStatus(c);
      const res = K.cultureResultLine(c);
      return `<div class="crow" ${readonly ? `data-act="showCulture" data-pid="${p.id}" data-cid="${c.id}"` : `data-act="tapCulture" data-pid="${p.id}" data-cid="${c.id}"`}>
        <div class="row-between"><span>${esc(K.cultureTitle(c))}<span class="muted small">　${md(c.submitted)} 提出</span></span>${chip(s.text, s.tone)}</div>
        ${res ? `<div class="muted small cres">${esc(res)}</div>` : ''}
      </div>`;
    })
    .join('');
}

// 今日のタスクに出す行（培養の確認日・薬の最終日）
export function clinicalTodayRows(p) {
  const t = K.todayClinical(p);
  const rows = [];
  for (const c of t.cultures) {
    const s = K.cultureStatus(c);
    rows.push(`<div class="trow" data-act="tapCulture" data-pid="${p.id}" data-cid="${c.id}"><div class="tlabel">${esc(K.cultureTitle(c))} 確認<span class="muted small">　${md(c.submitted)} 提出</span></div><div class="tstate">${chip(s.text, 'r')}</div></div>`);
  }
  for (const m of t.meds) {
    rows.push(`<div class="trow" data-act="tapMed" data-pid="${p.id}" data-mid="${m.id}"><div class="tlabel">${dot(m.cat)}${esc(K.medFinalLabel(m))}</div><div class="tstate">${chip(K.medFinal(m) === 'final' ? '最終日' : '予定超え', 'r')}</div></div>`);
  }
  return rows.join('');
}

// 一覧に出す培養の印
export function cultureChip(p) {
  const open = K.openCultures(p);
  if (!open.length) return '';
  const due = open.filter((c) => K.cultureDue(c)).length;
  return due ? chip(`培養 確認${due}`, 'r') : chip(`培養待ち ${open.length}`, 'a');
}

// ---- 薬の操作 ----
function medSheetHtml() {
  const favs = state.meta.favMeds || [];
  const byCat = (cat) => favs.filter((f) => f.cat === cat).map((f) => `<button class="pill" data-act="medFav" data-v="${esc(f.name)}">${esc(f.name)}</button>`).join('');
  const favRows = Object.keys(K.MED_CATS).map((c) => byCat(c)).filter(Boolean).map((h) => `<div class="chips-row">${h}</div>`).join('');
  const cats = Object.entries(K.MED_CATS).map(([k, c], i) => `<button class="${i === 0 ? 'on' : ''}" data-act="pick" data-v="${k}">${c.label}</button>`).join('');
  return `<div class="sheet-title">薬を追加</div>
    <label class="lbl" for="md-name">薬の名前（量は記録しません）</label>
    <input id="md-name" type="text" autocomplete="off" placeholder="例：CTRX" data-autofocus="no">
    ${favRows ? `<div class="lbl">よく使う薬</div>${favRows}` : ''}
    <div class="lbl">種類</div><div class="seg" data-pick="mcat">${cats}</div>
    <label class="lbl" for="md-start">開始日（この日が1日目）</label><input id="md-start" type="date" value="${ymd()}">
    <div id="md-plan-box"><label class="lbl" for="md-plan">予定日数（なくても可）</label>
      <div class="row-gap"><input id="md-plan" type="text" inputmode="numeric" autocomplete="off" placeholder="例：7"><div class="chips-row nowrap">${[5, 7, 10, 14].map((n) => `<button class="pill" data-act="medPlan" data-v="${n}">${n}</button>`).join('')}</div></div></div>
    <div id="md-flow-box" class="hidden">
      <div class="lbl">組成</div>
      <div id="md-conc-fixed" class="conc-fixed"></div>
      <div id="md-conc-edit" class="hidden stack">
        <div class="conc-grid"><input id="md-amt" type="text" inputmode="decimal" autocomplete="off" placeholder="薬の量" aria-label="薬の量"><select id="md-amtu" aria-label="量の単位">${['mg', 'µg', 'U', '単位'].map((u) => `<option>${u}</option>`).join('')}</select><span class="muted">／</span><input id="md-vol" type="text" inputmode="decimal" autocomplete="off" placeholder="全量" aria-label="全量"><span class="muted">mL</span></div>
        <label class="lbl" for="md-unit">表示の単位</label><select id="md-unit">${UNIT_OPTS.map((u) => `<option>${u}</option>`).join('')}</select>
      </div>
      <div id="md-weight-box" class="hidden"><label class="lbl" for="md-weight">体重（kg）　γ の計算に使います</label><input id="md-weight" type="text" inputmode="decimal" autocomplete="off" placeholder="例：62"></div>
      <label class="lbl" for="md-ml">最初の流量（mL/h）</label><input id="md-ml" type="text" inputmode="decimal" autocomplete="off" placeholder="例：3">
      <div id="md-calc" class="calc"></div>
      <label class="lbl" for="md-time">始めた時刻</label><input id="md-time" type="time" value="${nowHHMM()}">
    </div>
    <div class="err" id="md-err"></div>
    <div class="grid2"><button class="btn3" data-act="sheetCancel">やめる</button><button class="btn" data-act="medOk">追加する</button></div>`;
}

const UNIT_OPTS = ['γ', 'mg/h', 'µg/h', 'U/h', '単位/h'];
let sheetP = null; // 薬の小窓を開いている患者

const num = (v) => { const t = String(v ?? '').normalize('NFKC').trim(); return t !== '' && Number.isFinite(Number(t)) ? Number(t) : null; };
const weightIn = (id) => num($(id) && $(id).value) || (sheetP && sheetP.weight) || null;

// 小窓の中身から、組成・単位を読む（よく使う薬に組成があればそれを使う）
function flowDraft() {
  const name = $('#md-name').value.trim();
  const cat = pickedCat();
  const f = K.findFav(state.meta.favMeds, name);
  if (f && f.amount && f.cat === cat) return { unit: f.unit, conc: { amount: f.amount, amountUnit: f.amountUnit, volume: f.volume }, perDay: !!f.perDay, fixed: true };
  const amt = num($('#md-amt').value);
  const vol = num($('#md-vol').value);
  return { unit: $('#md-unit').value, conc: amt && vol ? { amount: amt, amountUnit: $('#md-amtu').value, volume: vol } : null, perDay: false, fixed: false };
}

function refreshMedSheet() {
  const cat = pickedCat();
  const flow = !!(K.MED_CATS[cat] || {}).flow;
  $('#md-flow-box').classList.toggle('hidden', !flow);
  $('#md-plan-box').classList.toggle('hidden', flow);
  if (!flow) return;
  const d = flowDraft();
  const m = { unit: d.unit, conc: d.conc, perDay: d.perDay };
  $('#md-conc-fixed').classList.toggle('hidden', !d.fixed);
  $('#md-conc-edit').classList.toggle('hidden', d.fixed);
  if (d.fixed) $('#md-conc-fixed').textContent = `${K.concText(m)}　表示：${d.unit}`;
  const needW = K.isGamma(m) && !(sheetP && sheetP.weight);
  $('#md-weight-box').classList.toggle('hidden', !needW);
  const ml = num($('#md-ml').value);
  $('#md-calc').textContent = ml !== null ? K.formulaText(m, ml, weightIn('#md-weight')) : '';
}

function syncMedSheet(cat) {
  if (!K.findFav(state.meta.favMeds, $('#md-name').value.trim()) && K.MED_CATS[cat] && K.MED_CATS[cat].flow) $('#md-unit').value = K.MED_CATS[cat].unit;
  refreshMedSheet();
}

function pickSeg(group, value) {
  const g = $(`.seg[data-pick="${group}"]`);
  if (!g) return;
  g.querySelectorAll('[data-v]').forEach((b) => b.classList.toggle('on', b.dataset.v === value));
}

const pickedCat = () => { const b = $('.seg[data-pick="mcat"] .on'); return b ? b.dataset.v : 'other'; };

// 組成のない（0.3.0 で作った）流量の薬は、よく使う薬の組成を使えるようにする
function adoptConc(m) {
  if (K.hasConc(m)) return;
  const f = K.findFav(state.meta.favMeds, m.name);
  if (f && f.amount) {
    m.conc = { amount: f.amount, amountUnit: f.amountUnit, volume: f.volume };
    m.unit = f.unit;
    if (f.perDay) m.perDay = true;
  }
}

let rateMed = null;
function refreshRate() {
  const m = rateMed;
  const ml = num($('#rt-ml').value);
  $('#rt-calc').textContent = ml !== null ? K.formulaText(m, ml, weightIn('#rt-weight')) : '';
  const dose = num($('#rt-dose') && $('#rt-dose').value);
  const r = $('#rt-rev');
  if (!r) return;
  const back = dose !== null ? K.mlFromDose(m, dose, weightIn('#rt-weight')) : null;
  r.innerHTML = back !== null
    ? `${esc(K.fmtDose(m, dose))}${esc(m.unit)} にするには <b>${esc(K.fmtNum(Math.round(back * 10) / 10))}mL/h</b>　<button class="mini" data-act="useRev" data-v="${Math.round(back * 10) / 10}">この流量を入れる</button>`
    : (dose !== null && K.isGamma(m) ? '体重を入れると計算できます' : '');
}

function rateSheet(p, m) {
  rateMed = m;
  sheetP = p;
  const cur = K.curRate(m);
  if (!K.hasConc(m)) {
    // 組成がない薬は、量をそのまま入れる（0.3.0 と同じ）
    return ui.custom(`<div class="sheet-title">${esc(m.name)} の流量（${esc(m.unit)}）</div>
      <label class="lbl" for="rt-val">流量</label><input id="rt-val" type="text" inputmode="decimal" autocomplete="off" value="${esc(cur && cur.value !== undefined ? K.fmtNum(cur.value) : '')}">
      <div class="ward-room"><input id="rt-date" type="date" value="${ymd()}" aria-label="日付"><input id="rt-time" type="time" value="${nowHHMM()}" aria-label="時刻"></div>
      <div class="err" id="rt-err"></div>
      <div class="grid2"><button class="btn3" data-act="sheetCancel">やめる</button><button class="btn" data-act="rateOk">記録する</button></div>`);
  }
  const needW = K.isGamma(m) && !p.weight;
  const pr = ui.custom(`<div class="sheet-title">${esc(m.name)} の流量</div>
    <div class="conc-fixed">組成：${esc(K.concText(m))}</div>
    ${needW ? '<label class="lbl" for="rt-weight">体重（kg）　γ の計算に使います</label><input id="rt-weight" type="text" inputmode="decimal" autocomplete="off" placeholder="例：62">' : ''}
    <label class="lbl" for="rt-ml">流量（mL/h）　止めたときは 0</label><input id="rt-ml" type="text" inputmode="decimal" autocomplete="off" value="${esc(cur && cur.ml !== undefined ? K.fmtNum(cur.ml) : '')}">
    <div id="rt-calc" class="calc"></div>
    <details class="rev"><summary>${esc(m.unit)} から mL/h を計算する</summary>
      <div class="row-gap"><input id="rt-dose" type="text" inputmode="decimal" autocomplete="off" placeholder="${K.isGamma(m) ? '例：0.1' : '例：5'}" data-autofocus="no"><span class="muted">${esc(m.unit)}</span></div>
      <div id="rt-rev" class="muted small"></div>
    </details>
    <label class="lbl" for="rt-time">時刻</label>
    <div class="ward-room"><input id="rt-date" type="date" value="${ymd()}" aria-label="日付"><input id="rt-time" type="time" value="${nowHHMM()}" aria-label="時刻"></div>
    <div class="err" id="rt-err"></div>
    <div class="grid2"><button class="btn3" data-act="sheetCancel">やめる</button><button class="btn" data-act="rateOk">記録する</button></div>`);
  for (const id of ['#rt-ml', '#rt-dose', '#rt-weight']) if ($(id)) $(id).addEventListener('input', refreshRate);
  refreshRate();
  return pr;
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
  await afterChange(p);
}

export const clinicalActions = {
  async addMed(ds) {
    const p = P(ds);
    sheetP = p;
    const pr = ui.custom(medSheetHtml());
    $('.seg[data-pick="mcat"]').addEventListener('picked', (e) => syncMedSheet(e.detail.value));
    for (const id of ['#md-name', '#md-amt', '#md-vol', '#md-ml', '#md-weight']) $(id).addEventListener('input', refreshMedSheet);
    for (const id of ['#md-amtu', '#md-unit']) $(id).addEventListener('change', refreshMedSheet);
    const r = await pr;
    if (!r) return;
    if (r.weight) p.weight = r.weight;
    const m = K.newMed(r);
    p.meds = [...(p.meds || []), m];
    // 一度入れた薬は「よく使う薬」に登録（流量の薬は組成も）
    const favs = state.meta.favMeds || (state.meta.favMeds = []);
    if (!K.findFav(favs, r.name)) {
      const f = { name: r.name, cat: r.cat, unit: r.unit || '' };
      if (r.conc) Object.assign(f, r.conc);
      favs.push(f);
    }
    await saveMeta('favMeds');
    await done(p, `${m.name} を追加しました`);
  },

  medFav(ds) {
    const f = K.findFav(state.meta.favMeds, ds.v);
    $('#md-name').value = ds.v;
    if (!f) return;
    pickSeg('mcat', f.cat);
    if (K.MED_CATS[f.cat] && K.MED_CATS[f.cat].flow && f.unit) $('#md-unit').value = f.unit;
    refreshMedSheet();
  },

  useRev(ds) {
    $('#rt-ml').value = ds.v;
    refreshRate();
  },

  medPlan(ds) {
    $('#md-plan').value = ds.v;
  },

  medOk() {
    const name = $('#md-name').value.trim();
    const err = $('#md-err');
    if (!name) return void (err.textContent = '薬の名前を入れてください');
    const cat = pickedCat();
    const start = $('#md-start').value || ymd();
    const flow = !!K.MED_CATS[cat].flow;
    const out = { name, cat, start, planDays: null, unit: '', ml: null, rateAt: null };
    if (flow) {
      const d = flowDraft();
      if (!d.conc) return void (err.textContent = '組成（薬の量と全量 mL）を入れてください');
      const mlT = $('#md-ml').value.normalize('NFKC').trim();
      if (mlT && num(mlT) === null) return void (err.textContent = '流量は数字（mL/h）で入れてください');
      const w = num($('#md-weight').value);
      if ($('#md-weight').value.trim() && !(w > 0)) return void (err.textContent = '体重は数字（kg）で入れてください');
      Object.assign(out, { unit: d.unit, conc: d.conc, perDay: d.perDay, ml: num(mlT), rateAt: atOf(start, $('#md-time').value), weight: w });
    } else {
      const plan = $('#md-plan').value.normalize('NFKC').trim();
      if (plan && !/^\d{1,3}$/.test(plan)) return void (err.textContent = '予定日数は数字で入れてください');
      out.planDays = plan ? Number(plan) : null;
    }
    ui.resolveSheet(out);
  },

  async tapMed(ds) {
    const p = P(ds);
    const m = MED(p, ds);
    if (!m) return;
    const flow = K.isFlow(m);
    const ended = K.medEnded(m);
    const opts = [];
    if (!ended && !m.end) {
      if (flow) opts.push({ v: 'rate', label: '流量を変える', tone: 'btn' });
      opts.push({ v: 'endToday', label: flow ? '終了にする（今やめた）' : '終了にする（今日が最後）', tone: flow ? 'btn2' : 'btn' });
      opts.push({ v: 'endDate', label: '終了日を選ぶ' });
      if (!flow) opts.push({ v: 'plan', label: m.planDays ? `予定日数を変える（${m.planDays}日）` : '予定日数を入れる' });
    } else {
      opts.push({ v: 'reopen', label: '終了を取り消す（続ける）' }, { v: 'endDate', label: `終了日を変える（${md(m.end)}）` });
    }
    if (flow && (m.rates || []).length) opts.push({ v: 'rates', label: `流量の記録（${m.rates.length}件）` });
    opts.push({ v: 'start', label: `開始日を変える（${md(m.start)}）`, tone: 'btn3' }, { v: 'rename', label: '名前を変える', tone: 'btn3' }, { v: 'del', label: '削除する', tone: 'danger' });
    const s = K.medStatus(m, ymd(), p.weight);
    const conc = K.concText(m);
    const v = await ui.choose(`${m.name}（${(K.MED_CATS[m.cat] || K.MED_CATS.other).label}）`, `今：${esc(s.text)}${conc ? `<br><span class="small">組成：${esc(conc)}</span>` : ''}`, opts);
    if (!v) return;
    if (v === 'rate') {
      adoptConc(m);
      const r = await rateSheet(p, m);
      if (!r) return;
      if (r.weight) p.weight = r.weight;
      delete r.weight;
      m.rates.push(r);
      m.rates.sort((a, b) => a.at - b.at);
      const f = K.flowNow(m, p.weight, r.at);
      return done(p, `${m.name}：${f.dose}${f.ml && !f.needWeight ? `（${f.ml}）` : ''}`);
    }
    if (v === 'endToday') {
      K.endMed(m, ymd());
      return done(p, `${m.name} を終了にしました`);
    }
    if (v === 'endDate') {
      const d = await pickDate(`${m.name} の終了日（最後に使った日）`, m.end || ymd());
      if (!d) return;
      if (d < m.start) return ui.toast('終了日は開始日より後にしてください');
      if (m.end) m.end = d; else K.endMed(m, d);
      return done(p);
    }
    if (v === 'reopen') {
      K.reopenMed(m);
      return done(p, `${m.name} を続けるにしました`);
    }
    if (v === 'plan') {
      const t = await ui.promptText({ title: '予定日数', label: '何日間の予定か（空にすると予定なし）', value: m.planDays ? String(m.planDays) : '', inputmode: 'numeric', suggestions: ['5', '7', '10', '14'] });
      if (t === null) return;
      const n = t.normalize('NFKC').trim();
      if (n && !/^\d{1,3}$/.test(n)) return ui.toast('数字で入れてください');
      m.planDays = n ? Number(n) : null;
      return done(p);
    }
    if (v === 'rates') {
      const list = m.rates.slice().reverse();
      const lab = (x) => {
        if (x.ml === undefined) return `${K.fmtNum(x.value)}${m.unit}`;
        const d = K.rateDose(m, x, p.weight);
        return `${K.fmtNum(x.ml)}mL/h${d !== null ? `（${K.doseText(m, d)}）` : ''}`;
      };
      const r = await ui.choose(`${m.name} の流量の記録`, 'タップすると、その記録を消せます', list.map((x, i) => ({ v: String(m.rates.length - 1 - i), label: `${mdw(ymd(new Date(x.at)))} ${hhmm(x.at)}　${lab(x)}`, tone: 'btn2' })));
      if (r === null) return;
      const x = m.rates[Number(r)];
      const ok = await ui.choose('この記録を消しますか？', `${hhmm(x.at)}　${esc(lab(x))}`, [{ v: 'yes', label: '消す', tone: 'danger' }]);
      if (ok !== 'yes') return;
      m.rates.splice(Number(r), 1);
      return done(p);
    }
    if (v === 'start') {
      const d = await pickDate(`${m.name} の開始日`, m.start);
      if (!d) return;
      if (m.end && d > m.end) return ui.toast('開始日は終了日より前にしてください');
      m.start = d;
      return done(p);
    }
    if (v === 'rename') {
      const t = await ui.promptText({ title: '名前を変える', value: m.name });
      if (!t) return;
      m.name = t;
      return done(p);
    }
    if (v === 'del') {
      const ok = await ui.choose(`${m.name} を削除しますか？`, '記録ごと消えます。', [{ v: 'yes', label: '削除する', tone: 'danger' }]);
      if (ok !== 'yes') return;
      p.meds = p.meds.filter((x) => x !== m);
      return done(p, '削除しました');
    }
  },

  rateOk() {
    const at = atOf($('#rt-date').value || ymd(), $('#rt-time').value || nowHHMM());
    if ($('#rt-val')) {
      const v = num($('#rt-val').value);
      if (v === null) return void ($('#rt-err').textContent = '流量を数字で入れてください（止めたときは 0）');
      return void ui.resolveSheet({ at, value: v });
    }
    const ml = num($('#rt-ml').value);
    if (ml === null || ml < 0) return void ($('#rt-err').textContent = '流量を数字（mL/h）で入れてください（止めたときは 0）');
    const wEl = $('#rt-weight');
    const w = wEl ? num(wEl.value) : null;
    if (wEl && wEl.value.trim() && !(w > 0)) return void ($('#rt-err').textContent = '体重は数字（kg）で入れてください');
    ui.resolveSheet({ at, ml, weight: w });
  },

  // ---- 培養の操作 ----
  async addCulture(ds) {
    const p = P(ds);
    const specs = K.SPECIMENS.map((s, i) => `<button class="${i === 0 ? 'on' : ''}" data-act="pick" data-v="${esc(s)}">${esc(s)}</button>`).join('');
    const pr = ui.custom(`<div class="sheet-title">培養を追加</div>
      <div class="lbl">検体</div><div class="seg wrap3" data-pick="spec">${specs}</div>
      <input id="cu-other" type="text" class="hidden" autocomplete="off" placeholder="検体の名前（例：関節液）" data-autofocus="no">
      <div id="cu-sets-box"><div class="lbl">セット数</div><div class="seg" data-pick="sets">${[1, 2, 3].map((n) => `<button class="${n === 2 ? 'on' : ''}" data-act="pick" data-v="${n}">${n}セット</button>`).join('')}</div></div>
      <label class="lbl" for="cu-date">提出日</label><input id="cu-date" type="date" value="${ymd()}">
      <div class="muted small">提出日から${K.CULTURE_DUE_DAYS}日後に「確認」が今日のタスクに出ます。結果が出ていなければ先送りできます。</div>
      <div class="grid2"><button class="btn3" data-act="sheetCancel">やめる</button><button class="btn" data-act="cultureOk">追加する</button></div>`);
    $('.seg[data-pick="spec"]').addEventListener('picked', (e) => {
      $('#cu-sets-box').classList.toggle('hidden', e.detail.value !== '血液');
      $('#cu-other').classList.toggle('hidden', e.detail.value !== 'その他');
    });
    const r = await pr;
    if (!r) return;
    const c = K.newCulture(r);
    p.cultures = [...(p.cultures || []), c];
    await done(p, `${K.cultureTitle(c)} を追加しました（確認 ${md(c.due)}）`);
  },

  cultureOk() {
    const s = $('.seg[data-pick="spec"] .on');
    let specimen = s ? s.dataset.v : 'その他';
    if (specimen === 'その他' && $('#cu-other').value.trim()) specimen = $('#cu-other').value.trim();
    const sets = $('.seg[data-pick="sets"] .on');
    ui.resolveSheet({ specimen, sets: specimen === '血液' && sets ? Number(sets.dataset.v) : null, submitted: $('#cu-date').value || ymd() });
  },

  async tapCulture(ds) {
    const p = P(ds);
    const c = CUL(p, ds);
    if (!c) return;
    const open = K.cultureOpen(c);
    const opts = [];
    const hasResult = c.gram || (c.organisms || []).length;
    if (hasResult) opts.push({ v: 'show', label: '結果を見る' });
    if (open) {
      opts.push({ v: 'import', label: '報告書を読み込む（AI アプリから貼り付け）', tone: 'btn' });
      opts.push({ v: 'prelim', label: '途中報告を手で入れる（グラム染色・菌名）' });
      opts.push({ v: 'sens', label: '感受性を手で入れる' });
      if (c.stage !== 'submitted') opts.push({ v: 'done', label: '確認済にする' });
      opts.push({ v: 'neg', label: '陰性にする' });
      opts.push({ v: 'defer', label: `先送り（明日 ${md(addDays(ymd(), 1))} に確認）` });
      opts.push({ v: 'due', label: c.due ? `確認日を選ぶ（今 ${md(c.due)}）` : '確認日を選ぶ', tone: 'btn3' });
    } else {
      opts.push({ v: 'reopen', label: '確認待ちに戻す' });
    }
    opts.push({ v: 'date', label: `提出日を変える（${md(c.submitted)}）`, tone: 'btn3' }, { v: 'del', label: '削除する', tone: 'danger' });
    const v = await ui.choose(K.cultureTitle(c), `今：${esc(K.cultureStatus(c).text)}`, opts);
    if (!v) return;
    if (v === 'show') return showCultureSheet(p, c);
    if (v === 'import') { go('cultureImport', { id: p.id, cid: c.id }); return; }
    if (v === 'prelim') {
      const r = await prelimSheet(c);
      if (!r) return;
      c.gram = r.gram;
      if (r.org) {
        const o = (c.organisms || [])[0];
        if (o) o.name = r.org; else c.organisms = [{ no: '1', name: r.org, amount: '', sens: [] }];
      }
      if (r.positiveSets !== undefined) c.positiveSets = r.positiveSets;
      if (c.stage === 'submitted') K.setCultureStage(c, 'prelim');
      return done(p, `途中報告を記録しました（次の確認 ${md(c.due)}）`);
    }
    if (v === 'sens') {
      const r = await sensSheet(c);
      if (!r) return;
      const o = (c.organisms || [])[0];
      if (o) { o.name = r.org || o.name; o.sens = r.sens; } else c.organisms = [{ no: '1', name: r.org || '?', amount: '', sens: r.sens }];
      K.setCultureStage(c, 'sens');
      return done(p, '感受性を記録しました');
    }
    if (v === 'done') { K.setCultureStage(c, 'done'); return done(p, '確認済にしました'); }
    if (v === 'neg') { K.setCultureStage(c, 'negative'); return done(p, '陰性にしました'); }
    if (v === 'defer') { K.deferCulture(c, addDays(ymd(), 1)); return done(p, `明日（${md(c.due)}）に先送りしました`); }
    if (v === 'due') {
      const d = await pickDate('確認日', c.due || ymd());
      if (!d) return;
      K.deferCulture(c, d);
      return done(p, `確認日：${md(d)}`);
    }
    if (v === 'reopen') {
      c.stage = (c.organisms || []).some((o) => (o.sens || []).length) ? 'sens' : (c.organisms || []).length || c.gram ? 'prelim' : 'submitted';
      c.doneAt = null;
      c.due = ymd();
      return done(p);
    }
    if (v === 'date') {
      const d = await pickDate('提出日', c.submitted);
      if (!d) return;
      c.submitted = d;
      if (c.stage === 'submitted') c.due = addDays(d, K.CULTURE_DUE_DAYS);
      return done(p);
    }
    if (v === 'del') {
      const ok = await ui.choose(`${K.cultureTitle(c)} を削除しますか？`, '結果ごと消えます。', [{ v: 'yes', label: '削除する', tone: 'danger' }]);
      if (ok !== 'yes') return;
      p.cultures = p.cultures.filter((x) => x !== c);
      return done(p, '削除しました');
    }
  },

  showCulture(ds) {
    const p = P(ds);
    const c = CUL(p, ds);
    if (c) showCultureSheet(p, c);
  },

  prelimOk() {
    const out = { gram: $('#pr-gram').value.trim(), org: $('#pr-org').value.trim() };
    const ps = $('.seg[data-pick="pos"] .on');
    if (ps) out.positiveSets = ps.dataset.v === '' ? null : Number(ps.dataset.v);
    ui.resolveSheet(out);
  },

  sensOk() {
    const sens = [];
    for (const raw of $('#se-text').value.split(/\r?\n/)) {
      const line = raw.normalize('NFKC').trim();
      if (!line) continue;
      const m = line.match(/^(.+?)[\s:：|]+(?:(\S+)[\s|]+)?([SIR])$/i);
      if (m) sens.push({ drug: m[1].trim(), mic: m[2] || '', sir: m[3].toUpperCase() });
      else sens.push({ drug: line, mic: '', sir: '' });
    }
    if (!sens.length) return void ($('#se-err').textContent = '1行に1つずつ入れてください');
    ui.resolveSheet({ org: $('#se-org').value.trim(), sens });
  },
};

function prelimSheet(c) {
  const o = (c.organisms || [])[0];
  const pos = c.sets
    ? `<div class="lbl">陽性のセット数</div><div class="seg" data-pick="pos"><button class="${c.positiveSets === null || c.positiveSets === undefined ? 'on' : ''}" data-act="pick" data-v="">未</button>${Array.from({ length: c.sets + 1 }, (_, i) => `<button class="${c.positiveSets === i ? 'on' : ''}" data-act="pick" data-v="${i}">${i}/${c.sets}</button>`).join('')}</div>`
    : '';
  return ui.custom(`<div class="sheet-title">${esc(K.cultureTitle(c))}：途中報告</div>
    <label class="lbl" for="pr-gram">グラム染色</label><input id="pr-gram" type="text" autocomplete="off" value="${esc(c.gram)}" placeholder="例：GNR">
    <label class="lbl" for="pr-org">菌名（わかれば）</label><input id="pr-org" type="text" autocomplete="off" value="${esc(o ? o.name : '')}" placeholder="例：E. coli" data-autofocus="no">
    ${pos}
    <div class="muted small">記録すると、次の確認（感受性）は${K.CULTURE_PRELIM_NEXT}日後になります。</div>
    <div class="grid2"><button class="btn3" data-act="sheetCancel">やめる</button><button class="btn" data-act="prelimOk">記録する</button></div>`);
}

function sensSheet(c) {
  const o = (c.organisms || [])[0];
  const text = o ? (o.sens || []).map((x) => `${x.drug}${x.mic ? ` ${x.mic}` : ''} ${x.sir}`.trim()).join('\n') : '';
  return ui.custom(`<div class="sheet-title">${esc(K.cultureTitle(c))}：感受性</div>
    <label class="lbl" for="se-org">菌名</label><input id="se-org" type="text" autocomplete="off" value="${esc(o ? o.name : '')}" placeholder="例：E. coli">
    <label class="lbl" for="se-text">1行に1つ：薬の名前と判定（S・I・R）</label>
    <textarea id="se-text" rows="7" placeholder="ABPC R&#10;CEZ R&#10;CTRX S" data-autofocus="no">${esc(text)}</textarea>
    <div class="muted small">報告書の写真があるときは「報告書を読み込む」のほうが楽です。</div>
    <div class="err" id="se-err"></div>
    <div class="grid2"><button class="btn3" data-act="sheetCancel">やめる</button><button class="btn" data-act="sensOk">記録する</button></div>`);
}

export function sensTable(o) {
  if (!(o.sens || []).length) return '<div class="muted small">感受性の記録はありません</div>';
  const rows = o.sens
    .map((x) => `<div class="kv"><span>${esc(x.drug)}</span><span>${x.mic ? `<span class="muted small">${esc(x.mic)}　</span>` : ''}${chip(x.sir || '－', x.sir === 'R' ? 'r' : x.sir === 'I' ? 'a' : 'g', x.sir === 'R' ? 'bold' : '')}</span></div>`)
    .join('');
  return `<div class="kvlist">${rows}</div>`;
}

function showCultureSheet(p, c) {
  const orgs = (c.organisms || [])
    .map((o) => `<div class="card"><div class="bold">${esc(o.name)}${o.amount ? `<span class="muted small">　${esc(o.amount)}</span>` : ''}</div>${sensTable(o)}</div>`)
    .join('');
  const pos = c.sets && c.positiveSets !== null && c.positiveSets !== undefined ? `<div>${c.positiveSets}/${c.sets}セット陽性</div>` : '';
  ui.sheet(`<div class="sheet-title">${esc(K.cultureTitle(c))}<span class="muted small">　${md(c.submitted)} 提出</span></div>
    <div>${chip(K.cultureStatus(c).text, K.cultureStatus(c).tone)}</div>
    ${pos}${c.gram ? `<div>グラム染色：${esc(c.gram)}</div>` : ''}
    ${orgs || (c.stage === 'negative' ? '<div>陰性（菌は出ていません）</div>' : '<div class="muted small">まだ結果はありません</div>')}
    <button class="btn3" data-act="sheetCancel">閉じる</button>`);
}
