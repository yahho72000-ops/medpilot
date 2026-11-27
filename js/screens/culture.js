// 培養の報告書の読み込み（AI アプリの答えを貼り付け）と確認

import { esc, $, $$ } from '../util.js';
import { state, findPatient, savePatient } from '../store.js';
import { back, go } from '../router.js';
import { header, emptyState } from './common.js';
import * as K from '../meds.js';
import * as ui from '../ui.js';
import { afterChange } from '../actions.js';

const find = (id, cid) => {
  const p = findPatient(id);
  const c = p && (p.cultures || []).find((x) => x.id === cid);
  return { p, c };
};

export const cultureImportScreen = {
  render({ id, cid }) {
    const { p, c } = find(id, cid);
    if (!p || !c) return `${header('培養の読み込み', '戻る')}${emptyState('培養が見つかりません')}`;
    const draft = state.cultureDraft && state.cultureDraft.cid === c.id ? state.cultureDraft.text : '';
    const step = (n, title, body) => `<div class="card step"><div class="step-hd"><span class="num">${n}</span><span class="step-title">${title}</span></div>${body}</div>`;
    return `${header('培養の読み込み', p.code)}
      <div class="muted">${esc(K.cultureTitle(c))}（提出 ${esc(c.submitted)}）</div>
      ${step(1, '指示文をコピー', `<div class="mono box">${esc(K.CULTURE_PROMPT.split('\n').slice(0, 2).join('\n'))}\n…</div><button class="btn" data-act="copyCulturePrompt">指示文をコピー</button>`)}
      ${step(2, 'AIアプリで写真と一緒に送る', '<div>Claude や ChatGPT を開いて指示文を貼り付け、報告書の画面を撮影して送ります。途中報告（グラム染色だけ）でも使えます。</div><div class="warn-a small">患者情報は写さない ・ 履歴に残らないモードがおすすめ</div>')}
      ${step(3, 'AIの答えをコピーして貼り付け', `<textarea id="cu-text" class="mono" rows="8" placeholder="MEDPILOT-CULTURE v1&#10;検体|血液&#10;グラム|GNR&#10;菌|1|Escherichia coli|&#10;感受性|1|ABPC|>16|R">${esc(draft)}</textarea>
        <button class="btn2" data-act="pasteCulture">クリップボードから貼り付け</button>
        <div class="err" id="cu-err"></div>`)}
      <button class="btn" data-act="parseCulture" data-pid="${p.id}" data-cid="${c.id}">読み込んで確認へ</button>`;
  },
  actions: {
    async copyCulturePrompt() {
      try {
        await navigator.clipboard.writeText(K.CULTURE_PROMPT);
        ui.toast('指示文をコピーしました');
      } catch (e) {
        ui.sheet(`<div class="sheet-title">指示文</div><div class="muted small">自動でコピーできませんでした。下の文を長押しで選んでコピーしてください。</div><textarea class="mono" rows="12" readonly data-autofocus="no">${esc(K.CULTURE_PROMPT)}</textarea><button class="btn3" data-act="sheetCancel">閉じる</button>`);
      }
    },
    async pasteCulture() {
      try {
        $('#cu-text').value = await navigator.clipboard.readText();
      } catch (e) {
        ui.toast('自動で貼り付けできませんでした。枠を長押しして「ペースト」してください');
      }
    },
    parseCulture(ds) {
      const text = $('#cu-text').value;
      const r = K.parseCultureText(text);
      if (!r.organisms.length && !r.gram && !r.negative) {
        $('#cu-err').textContent = '読み取れる行がありませんでした。AI の答えをそのまま貼り付けてください。';
        return;
      }
      state.cultureDraft = { cid: ds.cid, text, result: r };
      go('cultureConfirm', { id: ds.pid, cid: ds.cid });
    },
  },
};

const sirSeg = (oi, si, sir) => `<div class="seg mini-seg" data-pick="sir-${oi}-${si}">${['S', 'I', 'R', ''].map((f) => `<button class="${f === sir ? 'on' : ''}" data-act="pick" data-v="${f}">${f || '－'}</button>`).join('')}</div>`;

export const cultureConfirmScreen = {
  render({ id, cid }) {
    const { p, c } = find(id, cid);
    const d = state.cultureDraft;
    if (!p || !c || !d || d.cid !== cid) return `${header('培養の確認', '戻る')}${emptyState('読み込んだ内容がありません')}`;
    const r = d.result;
    const orgs = r.organisms
      .map((o, oi) => {
        const rows = o.sens
          .map((x, si) => `<div class="srow" data-o="${oi}" data-s="${si}"><span class="sdrug">${esc(x.drug)}${x.mic ? `<span class="muted tiny">　${esc(x.mic)}</span>` : ''}</span>${sirSeg(oi, si, x.sir)}<button class="mini" data-act="dropRow2" aria-label="この行を消す">×</button></div>`)
          .join('');
        return `<div class="card org" data-o="${oi}"><label class="lbl" for="org-${oi}">菌 ${oi + 1}</label><input id="org-${oi}" class="org-name" type="text" value="${esc(o.name)}" autocomplete="off">
          ${o.amount ? `<div class="muted small">菌量：${esc(o.amount)}</div>` : ''}
          ${rows ? `<div class="slist">${rows}</div>` : '<div class="muted small">感受性はまだありません（途中報告）</div>'}</div>`;
      })
      .join('');
    const pos = c.sets
      ? `<div class="lbl">陽性のセット数</div><div class="seg" data-pick="pos"><button class="${c.positiveSets === null || c.positiveSets === undefined ? 'on' : ''}" data-act="pick" data-v="">未</button>${Array.from({ length: c.sets + 1 }, (_, i) => `<button class="${c.positiveSets === i ? 'on' : ''}" data-act="pick" data-v="${i}">${i}/${c.sets}</button>`).join('')}</div>`
      : '';
    const specNote = r.specimen && r.specimen !== c.specimen ? `<div class="warn-a small">読み取った検体は「${esc(r.specimen)}」です。登録した検体（${esc(c.specimen)}）と合っているか確かめてください。</div>` : '';
    return `${header('培養の確認', p.code)}
      <div class="card muted small">AIの答えを読み込みました。間違いがないか確認してください。</div>
      <div class="card"><div class="bold">${esc(K.cultureTitle(c))}</div>${specNote}
        <label class="lbl" for="cu-gram">グラム染色</label><input id="cu-gram" type="text" value="${esc(r.gram || c.gram)}" autocomplete="off">
        ${pos}
        ${r.negative && !r.organisms.length ? '<div class="bold">陰性（菌は出ていません）</div>' : ''}
      </div>
      ${orgs}
      <div class="grid2"><button class="btn2" data-act="back">貼り直す</button><button class="btn" data-act="saveCulture" data-pid="${p.id}" data-cid="${c.id}">保存する</button></div>`;
  },
  actions: {
    dropRow2(ds, el) {
      const row = el.closest('.srow');
      row.classList.toggle('dropped');
      el.textContent = row.classList.contains('dropped') ? '戻' : '×';
    },
    async saveCulture(ds) {
      const { p, c } = find(ds.pid, ds.cid);
      const r = state.cultureDraft.result;
      const organisms = r.organisms.map((o, oi) => {
        const name = ($(`#org-${oi}`).value || '').trim() || o.name;
        const sens = [];
        for (const row of $$(`.srow[data-o="${oi}"]`)) {
          if (row.classList.contains('dropped')) continue;
          const x = o.sens[Number(row.dataset.s)];
          const on = row.querySelector('.seg .on');
          sens.push({ drug: x.drug, mic: x.mic, sir: on ? on.dataset.v : x.sir });
        }
        return { no: o.no, name, amount: o.amount, sens };
      });
      c.gram = $('#cu-gram').value.trim();
      const ps = $('.seg[data-pick="pos"] .on');
      if (ps) c.positiveSets = ps.dataset.v === '' ? null : Number(ps.dataset.v);
      let stage;
      if (!organisms.length && r.negative) {
        stage = 'negative';
      } else {
        c.organisms = organisms;
        stage = organisms.some((o) => o.sens.length) ? 'sens' : 'prelim';
      }
      K.setCultureStage(c, stage);
      await savePatient(p);
      state.cultureDraft = null;
      ui.toast(stage === 'negative' ? '陰性として保存しました' : stage === 'sens' ? '感受性を保存しました（確認待ち）' : `途中報告を保存しました（次の確認 ${c.due.slice(5).replace('-', '/')}）`);
      back(2);
      await afterChange(p);
    },
  },
};
