// 検査値の読み込み（AI アプリの答えを貼り付け）と確認

import { esc, ymdJa, uuid, $, $$ } from '../util.js';
import { state, findPatient, savePatient, saveMeta } from '../store.js';
import { back, go } from '../router.js';
import { header, emptyState } from './common.js';
import { LAB_PROMPT, parseLabText, groupImport, matchItem } from '../labs.js';
import * as ui from '../ui.js';

export const labImportScreen = {
  render({ id }) {
    const p = findPatient(id);
    if (!p) return `${header('検査値の読み込み', '戻る')}${emptyState('患者が見つかりません')}`;
    const preview = LAB_PROMPT.split('\n').slice(0, 2).join('\n');
    const draft = state.labDraft && state.labDraft.patientId === p.id ? state.labDraft.text : '';
    const step = (n, title, body) => `<div class="card step"><div class="step-hd"><span class="num">${n}</span><span class="step-title">${title}</span></div>${body}</div>`;
    return `${header('検査値の読み込み', p.code)}
      ${step(1, '指示文をコピー', `<div class="mono box">${esc(preview)}\n…</div><button class="btn" data-act="copyPrompt">指示文をコピー</button>`)}
      ${step(2, 'AIアプリで写真と一緒に送る', '<div>Claude や ChatGPT を開いて指示文を貼り付け、検査値の画面を撮影して送ります。</div><div class="warn-a small">患者情報は写さない ・ 履歴に残らないモードがおすすめ</div>')}
      ${step(3, 'AIの答えをコピー', '<div>答えを長押しして「コピー」を選びます。</div>')}
      ${step(4, 'ここに貼り付け', `<textarea id="lab-text" class="mono" rows="7" placeholder="MEDPILOT-LAB v1&#10;2026-11-27|白血球数|98|H&#10;…">${esc(draft)}</textarea>
        <button class="btn2" data-act="pasteClip">クリップボードから貼り付け</button>
        <div class="err" id="lab-err"></div>`)}
      <button class="btn" data-act="parseLab" data-pid="${p.id}">読み込んで確認へ</button>`;
  },
  actions: {
    async copyPrompt() {
      try {
        await navigator.clipboard.writeText(LAB_PROMPT);
        ui.toast('指示文をコピーしました');
      } catch (e) {
        ui.sheet(`<div class="sheet-title">指示文</div><div class="muted small">自動でコピーできませんでした。下の文を長押しで選んでコピーしてください。</div><textarea class="mono" rows="10" readonly data-autofocus="no">${esc(LAB_PROMPT)}</textarea><button class="btn3" data-act="sheetCancel">閉じる</button>`);
      }
    },
    async pasteClip() {
      try {
        const t = await navigator.clipboard.readText();
        $('#lab-text').value = t;
      } catch (e) {
        ui.toast('自動で貼り付けできませんでした。枠を長押しして「ペースト」してください');
      }
    },
    parseLab(ds) {
      const p = findPatient(ds.pid);
      const text = $('#lab-text').value;
      const { rows } = parseLabText(text);
      if (!rows.length) {
        $('#lab-err').textContent = '読み取れる行がありませんでした。AI の答えをそのまま貼り付けてください。';
        return;
      }
      state.labDraft = { patientId: p.id, text, groups: groupImport(rows, state.meta.labItems, p) };
      go('labConfirm', { id: p.id });
    },
  },
};

function flagSeg(g, i, flag) {
  return `<div class="seg mini-seg" data-pick="flag-${g}-${i}">${['', 'H', 'L'].map((f) => `<button class="${f === flag ? 'on' : ''}" data-act="pick" data-v="${f}">${f || '－'}</button>`).join('')}</div>`;
}

export const labConfirmScreen = {
  render({ id }) {
    const p = findPatient(id);
    const d = state.labDraft;
    if (!p || !d || d.patientId !== p.id) return `${header('検査値の確認', '戻る')}${emptyState('読み込んだ内容がありません')}`;
    const items = state.meta.labItems;
    const newNames = new Map();
    const groups = d.groups
      .map((g, gi) => {
        const rows = g.entries
          .map((e, i) => {
            const it = e.itemId ? items.find((x) => x.id === e.itemId) : null;
            if (!it) newNames.set(e.name, true);
            const unknown = e.value === '?' || e.value === '';
            return `<div class="lrow-edit ${unknown ? 'need' : ''} ${it ? '' : 'newitem'}" data-g="${gi}" data-i="${i}">
              <div class="lname"><div class="abbr">${esc(it ? it.abbr : '新')}</div><div class="muted tiny">${esc(e.name)}</div></div>
              <input class="lval-in" type="text" inputmode="decimal" value="${esc(e.value)}" aria-label="${esc(e.name)} の値">
              ${flagSeg(gi, i, e.flag)}
              <button class="mini" data-act="dropRow" aria-label="この行を消す">×</button>
            </div>`;
          })
          .join('');
        return `<div class="card"><div class="row-between"><div class="bold">採血日 ${ymdJa(g.date)}</div><div class="muted">${g.draw}回目</div></div><div class="ledit">${rows}</div></div>`;
      })
      .join('');
    const newBox = newNames.size
      ? `<div class="card newbox"><div class="warn-a bold">新しい項目があります</div><div class="muted small">略称と単位を入れてください。次からは自動で振り分けます。</div>
        ${[...newNames.keys()].map((name, k) => `<div class="newrow" data-name="${esc(name)}"><div class="muted small">${esc(name)}</div><div class="grid2"><input class="new-abbr" type="text" value="${esc(name)}" placeholder="略称" aria-label="${esc(name)} の略称"><input class="new-unit" type="text" placeholder="単位" aria-label="${esc(name)} の単位"></div></div>`).join('')}</div>`
      : '';
    return `${header('検査値の確認', p.code)}
      <div class="card muted small">AIの答えを読み込みました。間違いがないか確認してください。値は直せます。</div>
      ${groups}${newBox}
      <div class="err" id="lc-err"></div>
      <div class="grid2"><button class="btn2" data-act="back">貼り直す</button><button class="btn" data-act="saveLab" data-pid="${p.id}">保存する</button></div>`;
  },
  actions: {
    dropRow(ds, el) {
      const row = el.closest('.lrow-edit');
      row.classList.toggle('dropped');
      el.textContent = row.classList.contains('dropped') ? '戻' : '×';
    },
    async saveLab(ds) {
      const p = findPatient(ds.pid);
      const d = state.labDraft;
      const items = state.meta.labItems;
      // 新しい項目を登録（同じ略称があれば、その項目の別名として覚える）
      const nameToItem = new Map();
      for (const row of $$('.newrow')) {
        const name = row.dataset.name;
        const abbr = row.querySelector('.new-abbr').value.trim() || name;
        const unit = row.querySelector('.new-unit').value.trim();
        let it = matchItem(abbr, items);
        if (it) {
          if (!it.aliases.includes(name)) it.aliases.push(name);
          if (unit && !it.unit) it.unit = unit;
        } else {
          it = { id: uuid(), abbr, unit, aliases: abbr === name ? [] : [name], order: items.length };
          items.push(it);
        }
        nameToItem.set(name, it);
      }
      let n = 0;
      for (const row of $$('.lrow-edit')) {
        if (row.classList.contains('dropped')) continue;
        const g = d.groups[Number(row.dataset.g)];
        const e = g.entries[Number(row.dataset.i)];
        const value = row.querySelector('.lval-in').value.trim();
        if (!value || value === '?') continue;
        const on = row.querySelector('.seg .on');
        const flag = on ? on.dataset.v : '';
        const it = e.itemId ? items.find((x) => x.id === e.itemId) : nameToItem.get(e.name);
        if (!it) continue;
        p.labs = p.labs || [];
        p.labs.push({ id: uuid(), date: g.date, draw: g.draw, itemId: it.id, value, flag, importedAt: Date.now() });
        n++;
      }
      if (!n) {
        $('#lc-err').textContent = '保存できる値がありません';
        return;
      }
      await saveMeta('labItems');
      await savePatient(p);
      state.labDraft = null;
      ui.toast(`${n}項目を保存しました`);
      back(2);
    },
  },
};
