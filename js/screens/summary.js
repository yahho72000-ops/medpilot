// まとめカルテの読み込み（病院の AI の答えを iPhone の文字読み取りでコピーして貼る）と確認
// あわせて：病院の AI のテンプレート（まとめ・検査値・培養）の表示とコピー、2枚目の「経過のまとめ」欄

import { esc, md, ymd, $, $$ } from '../util.js';
import { state, findPatient, savePatient } from '../store.js';
import { back, go, render } from '../router.js';
import { header, emptyState, sec } from './common.js';
import * as S from '../summary.js';
import * as M from '../model.js';
import * as K from '../meds.js';
import { labPrompt } from '../labs.js';
import * as ui from '../ui.js';
import { afterChange, TASK_NAME_NOTE } from '../actions.js';

const keyOf = (id) => id || 'new';
const draftFor = (id) => (state.summaryDraft && state.summaryDraft.key === keyOf(id) ? state.summaryDraft : null);
const step = (n, title, body) => `<div class="card step"><div class="step-hd"><span class="num">${n}</span><span class="step-title">${title}</span></div>${body}</div>`;

// ---- 病院の AI のテンプレート ----
export const TEMPLATES = {
  summary: { title: 'まとめカルテ', tag: 'MedPilot まとめ', text: () => S.summaryPrompt(state.meta) },
  lab: { title: '検査値', tag: 'MedPilot 検査', text: () => labPrompt(state.meta.labItems) },
  culture: { title: '培養', tag: 'MedPilot 培養', text: () => K.CULTURE_PROMPT },
};

// 読み込みの画面の 1・2 番目（病院の AI → iPhone で読み取る）
export function hospitalSteps(kind, what) {
  const t = TEMPLATES[kind];
  return `${step(1, '病院の AI でテンプレートを使う', `<div>病院の AI でテンプレート「${esc(t.tag)}」を選び、その下に${esc(what)}の文章を貼って送ります。</div><button class="btn2" data-act="showTemplate" data-k="${kind}">テンプレートの文を見る・コピー</button>`)}
    ${step(2, 'AI の答えを iPhone で読み取る', `<div>iPhone のカメラを PC の画面に向けて、右下の文字のマーク（テキスト認識表示）を押します。答えの部分（【${esc(t.tag)}】から【おわり】まで）を選んで「コピー」。</div>
      <div class="muted small">写真は撮らなくて大丈夫です。撮ったときは、貼ったあと写真を消してください。</div>
      <div class="warn-a small">テンプレートの文やカルテの部分までは選ばないでください。</div>`)}`;
}

// 貼り足す（今の文の最後に足す）
export async function pasteAppend(sel) {
  const ta = $(sel);
  try {
    const t = await navigator.clipboard.readText();
    if (!t) return void ui.toast('コピーした文がありません');
    ta.value = ta.value.trim() ? `${ta.value.replace(/\s*$/, '')}\n${t}` : t;
    ta.dispatchEvent(new Event('input'));
    ui.toast('貼り足しました');
  } catch (e) {
    ui.toast('自動で貼り付けできませんでした。枠の最後を長押しして「ペースト」してください');
  }
}

// ---- 読み込み ----
function statusHtml(text) {
  if (!text.trim()) return '';
  const r = S.parseSummaryText(text, { favMeds: state.meta.favMeds });
  const found = r.found.map((k) => S.FOUND_LABELS[k]).join('・');
  return `<div class="small">読めた見出し：${found ? esc(found) : '<span class="warn-a">まだありません</span>'}</div>
    <div class="small ${r.complete ? 'muted' : 'warn-a'}">【おわり】：${r.complete ? 'あり（最後まで読めています）' : 'まだ読めていません（続きがあれば貼り足してください）'}</div>`;
}

export const summaryImportScreen = {
  render({ id = '' }) {
    const p = id ? findPatient(id) : null;
    if (id && !p) return `${header('まとめカルテ', '戻る')}${emptyState('患者が見つかりません')}`;
    const d = draftFor(id);
    const text = d ? d.text : '';
    return `${header('まとめカルテの読み込み', p ? p.code : '入院患者')}
      ${p ? '' : '<div class="card muted small">まとめカルテから、入院患者を新しく登録します。</div>'}
      ${hospitalSteps('summary', 'まとめカルテ')}
      ${step(3, 'ここに貼る', `<div class="muted small">答えが長いときは、スクロールして何回かに分けて貼り足せます（重なっても大丈夫です）。</div>
        <textarea id="sm-text" class="mono" rows="10" placeholder="【MedPilot まとめ】&#10;【プロフィール】&#10;年齢：82&#10;…&#10;【おわり】">${esc(text)}</textarea>
        <div class="grid2"><button class="btn2" data-act="smPaste">クリップボードから貼り足す</button><button class="btn3" data-act="smClear">全部消す</button></div>
        <div id="sm-status" class="stack">${statusHtml(text)}</div>
        <div class="err" id="sm-err"></div>`)}
      <button class="btn" data-act="smParse" data-pid="${id}">読み込んで確認へ</button>`;
  },
  mount(app, { id = '' }) {
    const ta = $('#sm-text');
    let timer = null;
    ta.addEventListener('input', () => {
      state.summaryDraft = { key: keyOf(id), text: ta.value };
      clearTimeout(timer);
      timer = setTimeout(() => { const el = $('#sm-status'); if (el) el.innerHTML = statusHtml(ta.value); }, 300);
    });
  },
  actions: {
    smPaste() { return pasteAppend('#sm-text'); },
    smClear() {
      const ta = $('#sm-text');
      const before = ta.value;
      if (!before) return;
      ta.value = '';
      ta.dispatchEvent(new Event('input'));
      ui.toast('消しました', () => { const t = $('#sm-text'); if (t) { t.value = before; t.dispatchEvent(new Event('input')); } });
    },
    smParse(ds) {
      const id = ds.pid || '';
      const text = $('#sm-text').value;
      const r = S.parseSummaryText(text, { favMeds: state.meta.favMeds });
      if (!r.count) {
        $('#sm-err').textContent = '読み取れる行がありませんでした。【MedPilot まとめ】から【おわり】までを貼ってください。';
        return;
      }
      const p = id ? findPatient(id) : M.newPatient({ code: '', location: 'inpatient', ...r.profile }, state.meta.templates);
      const items = S.buildItems(r, p, state.meta);
      state.summaryDraft = { key: keyOf(id), text, result: r, items, course: S.courseText(r) };
      go('summaryConfirm', { id });
    },
  },
};

// ---- 確認 ----
function profileLine(pf) {
  return [
    pf.ageBand ? M.ageLabel(pf.ageBand) : '',
    pf.sex ? M.SEX[pf.sex] : '',
    pf.weight ? `${K.fmtNum(pf.weight)}kg` : '',
    pf.admitDate ? `入院 ${md(pf.admitDate)}` : '',
    pf.disease || '',
    pf.codeStatus ? M.CODE_STATUS[pf.codeStatus] : '',
  ].filter(Boolean).join(' ・ ');
}

const ckRow = (it) => `<label class="ck-row ${it.off ? 'off' : ''}"><input type="checkbox" data-iid="${it.id}" ${it.on ? 'checked' : ''} ${it.off ? 'disabled' : ''}><span class="ck-body"><span>${esc(it.text)}</span>${it.note ? `<span class="muted small">${esc(it.note)}</span>` : ''}</span></label>`;

export const summaryConfirmScreen = {
  render({ id = '' }) {
    const d = draftFor(id);
    const p = id ? findPatient(id) : null;
    if (!d || !d.items || (id && !p)) return `${header('まとめカルテの確認', '戻る')}${emptyState('読み込んだ内容がありません')}`;
    const r = d.result;
    const isNew = !id;
    const bySec = (s) => d.items.filter((it) => it.sec === s);
    const block = (s, extra = '') => {
      const list = bySec(s);
      if (!list.length) return '';
      return `${sec(S.SECTION_TITLES[s])}${extra}<div class="card ck-list">${list.map(ckRow).join('')}</div>`;
    };
    const course = d.course
      ? `${sec('経過のまとめ')}<div class="card stack">
          <label class="ck-row"><input type="checkbox" id="sm-course-on" checked><span class="ck-body"><span>2枚目の「経過のまとめ」に入れる</span>${p && p.summaryText ? '<span class="muted small">今のまとめは置き換わります</span>' : ''}</span></label>
          <textarea id="sm-course" rows="10">${esc(d.course)}</textarea>
          <div class="muted small">ここで直せます。</div></div>`
      : '';
    const skipped = r.skipped.length
      ? `<details class="card rev"><summary>読めなかった行（${r.skipped.length}）</summary><div class="mono small">${esc(r.skipped.slice(0, 40).join('\n'))}</div></details>`
      : '';
    return `${header('まとめカルテの確認', p ? p.code : '戻る')}
      <div class="card stack small">
        <div>読み取った内容です。入れないものはチェックを外してください。${isNew ? '次の画面で、あだ名・病棟・病室・ID を入れて登録します。' : '保存するまで、何も変わりません。'}</div>
        <div class="muted">AI と iPhone の読み取りは間違えることがあります。数字と日付はカルテと見比べてください。</div>
        ${r.complete ? '' : '<div class="warn-a">最後の【おわり】が読めていません。続きがあるときは「戻って貼り足す」から足してください。</div>'}
      </div>
      ${isNew ? `${sec('プロフィール')}<div class="card small">${esc(profileLine(r.profile)) || '<span class="muted">読み取れませんでした</span>'}<div class="muted small">登録の画面に入れておきます（直せます）。</div></div>` : block('profile')}
      ${block('problems')}
      ${course}
      ${block('meds')}
      ${block('cultures')}
      ${block('devices')}
      ${block('nutrition')}
      ${block('ic')}
      ${block('plans', `<div class="warn-a small">${esc(TASK_NAME_NOTE)}</div>`)}
      ${skipped}
      <div class="grid2"><button class="btn2" data-act="back">戻って貼り足す</button>${isNew ? '<button class="btn" data-act="smNext">次へ：登録する</button>' : `<button class="btn" data-act="smSave" data-pid="${p.id}">保存する</button>`}</div>`;
  },
  actions: {
    async smSave(ds) {
      const d = draftFor(ds.pid);
      const p = findPatient(ds.pid);
      if (!d || !p) return;
      const { picked, course } = readPicks();
      const n = S.applyItems(p, d.items, picked, { course });
      await savePatient(p);
      state.summaryDraft = null;
      ui.toast(n ? `まとめカルテから ${n}件 入れました` : '入れるものがありませんでした');
      back(2);
      await afterChange(p);
    },
    smNext() {
      const d = draftFor('');
      if (!d) return;
      Object.assign(d, readPicks());
      go('register', { to: 'in', summary: 1 });
    },
  },
};

function readPicks() {
  const picked = new Set($$('input[data-iid]').filter((x) => x.checked).map((x) => x.dataset.iid));
  const on = $('#sm-course-on');
  const course = on && on.checked ? $('#sm-course').value : null;
  return { picked, course };
}

// 登録の画面から：読み込んだものを新しい患者に入れる（入れた数を返す）
export function applyDraftToNew(p) {
  const d = draftFor('');
  if (!d || !d.items || !d.picked) return 0;
  const n = S.applyItems(p, d.items, d.picked, { course: d.course === undefined ? null : d.course });
  state.summaryDraft = null;
  return n;
}
export const draftProfile = () => { const d = draftFor(''); return d && d.result ? d.result.profile : null; };

// ---- 2枚目の「経過のまとめ」欄 ----
export function summaryBlock(p) {
  const body = p.summaryText
    ? `<div class="sum-text">${esc(p.summaryText)}</div>${p.summaryAt ? `<div class="muted tiny">${md(ymd(new Date(p.summaryAt)))} 更新</div>` : ''}`
    : '<div class="muted small">まだありません（上の「まとめカルテを読み込む」から入れられます）</div>';
  return `${sec('経過のまとめ', `<button class="mini" data-act="editSummary" data-pid="${p.id}">${p.summaryText ? '書き直す' : '＋ 書く'}</button>`)}<div class="card">${body}</div>`;
}
export const summaryButton = (p) => `<button class="btn2" data-act="openSummaryImport" data-pid="${p.id}">まとめカルテを読み込む</button>`;

export const summaryActions = {
  openSummaryImport(ds) { go('summaryImport', { id: ds.pid }); },
  async editSummary(ds) {
    const p = findPatient(ds.pid);
    if (!p) return;
    const v = await ui.custom(`<div class="sheet-title">経過のまとめ</div>
      <textarea id="sum-edit" rows="12">${esc(p.summaryText || '')}</textarea>
      <div class="grid2"><button class="btn3" data-act="sheetCancel">やめる</button><button class="btn" data-act="summaryOk">決定</button></div>`);
    if (v === null || v === undefined) return;
    const before = { t: p.summaryText, at: p.summaryAt };
    p.summaryText = v;
    p.summaryAt = v ? Date.now() : null;
    await savePatient(p);
    render();
    if (!v && before.t) ui.toast('経過のまとめを消しました', async () => { p.summaryText = before.t; p.summaryAt = before.at; await savePatient(p); render(); });
  },
  summaryOk() { ui.resolveSheet($('#sum-edit').value.trim()); },
  showTemplate(ds) {
    const t = TEMPLATES[ds.k];
    if (!t) return;
    ui.sheet(`<div class="sheet-title">病院の AI のテンプレート（${esc(t.title)}）</div>
      <div class="muted small">病院の AI に「${esc(t.tag)}」という名前でテンプレートとして一度登録してください。中に患者さんの情報は入っていません。</div>
      <textarea class="mono" rows="14" readonly data-autofocus="no">${esc(t.text())}</textarea>
      <div class="grid2"><button class="btn3" data-act="sheetCancel">閉じる</button><button class="btn" data-act="copyTemplate" data-k="${ds.k}">コピー</button></div>`);
  },
  async copyTemplate(ds) {
    const t = TEMPLATES[ds.k];
    try { await navigator.clipboard.writeText(t.text()); ui.toast('コピーしました'); } catch (e) { ui.toast('自動でコピーできませんでした。文を長押しで選んでコピーしてください'); }
  },
};
