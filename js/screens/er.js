// 救急外来：一覧・患者ページ・登録

import { esc, ymd, mdw, md, $ } from '../util.js';
import { state, findPatient, savePatient, existingCodes, remember } from '../store.js';
import * as M from '../model.js';
import { go } from '../router.js';
import { encryptId, randomCode } from '../crypto.js';
import { header, chip, demo, codeText, patientCard, taskRow, taskChip, remainChip, labGrid, devicesBlock, sec, emptyState } from './common.js';
import * as ui from '../ui.js';

// ---- 一覧 ----
export const erListScreen = {
  render() {
    const list = M.sortEr(state.patients.filter((p) => p.location === 'er'));
    const cards = list
      .map((p) => {
        const er = p.tasks.filter((t) => t.group === 'er' && M.isDueNow(t));
        const extra = p.tasks.filter((t) => t.group !== 'er' && M.isOpen(t));
        const tag = p.ending ? `<span class="tag">${esc(M.endingLabel(p))}</span>` : '';
        return `<button class="card pcard-list" data-act="openPatient" data-id="${p.id}">
          <div class="row-between"><div class="nameline">${nameLineHtml(p)}</div>${remainChip(p)}</div>
          <div class="row-gap wrap">${tag}<span class="muted small">${esc(demo(p))} ・ ${esc(codeText(p))}</span></div>
          <div class="chips-row">${er.map(taskChip).join('')}${extra.map(taskChip).join('')}</div>
        </button>`;
      })
      .join('');
    return `${header(`救急外来　${list.length}人`, 'メニュー')}
      ${list.length ? '<div class="muted small">並び：タスクが多い順</div>' : ''}
      ${cards || emptyState('救急外来の患者はいません')}
      ${list.length ? '<div class="muted small">赤＝まだ　黄＝待ち　グレー＝済・なし</div>' : ''}
      <div class="bottom-space"></div>
      <button class="btn fixed-bottom" data-act="goRegister" data-to="er">＋ 患者を登録</button>`;
  },
  actions: {
    goRegister(ds) { go('register', { to: ds.to }); },
  },
};

function nameLineHtml(p) {
  return `<span class="code">${esc(p.code)}</span><span class="muted">${p.bed ? `　${esc(p.bed)}` : ''}　${esc(p.nickname)}</span>`;
}

// ---- 患者ページ ----
export const erPatientScreen = {
  render({ id }) {
    const p = findPatient(id);
    if (!p || p.location !== 'er') return `${header('患者', '救急外来')}${emptyState('この患者は救急外来にいません')}`;
    const erTasks = p.tasks.filter((t) => t.group === 'er');
    const listGroup = p.ending && (M.ER_ENDINGS[p.ending.type] || {}).list;
    const listTasks = listGroup ? p.tasks.filter((t) => t.group === listGroup) : [];
    const endingBox = p.ending
      ? `<div class="card ending"><div class="row-between"><div><span class="tag">${esc(M.endingLabel(p))}</span><span class="muted small">　${md(p.ending.at)}</span></div><button class="mini" data-act="cancelEnding" data-pid="${p.id}">取り消す</button></div>
          ${p.ending.type === 'home' ? `<button class="btn2" data-act="homeDone" data-pid="${p.id}">帰宅の処理を終える（残りは帰宅後フォローへ）</button>` : ''}
          ${p.ending.type === 'admit_other' ? '<div class="muted small">結果確認が終わったら、過去の一覧に移せます。</div>' : ''}</div>`
      : '';
    const endingButtons = p.ending
      ? ''
      : `${sec('終わり方')}<div class="grid3">${Object.entries(M.ER_ENDINGS).map(([k, e]) => `<button class="btn3" data-act="erEnd" data-pid="${p.id}" data-type="${k}">${esc(e.label)}</button>`).join('')}</div>`;
    return `${header('患者', '救急外来')}
      ${patientCard(p, `${demo(p)} ・ ${md(p.visitDate)} 来院`)}
      ${endingBox}
      ${listTasks.length ? `${sec(M.GROUP_TITLES[listGroup])}<div class="tlist">${listTasks.map((t) => taskRow(p, t)).join('')}</div>` : ''}
      ${sec('検査・説明')}
      <div class="tlist">${erTasks.map((t) => taskRow(p, t)).join('')}</div>
      <div class="muted small">タップで次の段階へ ・ 長押しで「なし／1つ戻す／名前を変える／削除」</div>
      <div class="grid2"><button class="btn2" data-act="addSame" data-pid="${p.id}">＋ 同じ種類を追加</button><button class="btn2" data-act="addTask" data-pid="${p.id}">＋ タスクを追加</button></div>
      ${sec('検査値')}
      ${labGrid(p)}
      <button class="btn2" data-act="openLabImport" data-pid="${p.id}">検査値を読み込む</button>
      ${sec('デバイス', `<button class="mini" data-act="addDevice" data-pid="${p.id}">＋ 追加</button>`)}
      <div class="kvlist">${devicesBlock(p)}</div>
      ${endingButtons}`;
  },
};

// ---- 登録 ----
export const registerScreen = {
  render({ to = 'er' }) {
    const sug = (state.meta.history.diseases || []).slice(0, 10);
    const ages = M.AGE_BANDS.map((b) => `<button data-act="pick" data-v="${b}">${M.ageButton(b)}</button>`).join('');
    const codes = Object.entries(M.CODE_STATUS).map(([k, l]) => `<button class="${k === 'unknown' ? 'on' : ''}" data-act="pick" data-v="${k}">${l}</button>`).join('');
    return `${header('患者を登録', '戻る')}
      <div class="field"><div class="lbl">登録先</div>
        <div class="seg" data-pick="to"><button class="${to === 'er' ? 'on' : ''}" data-act="pick" data-v="er">救急外来</button><button class="${to === 'in' ? 'on' : ''}" data-act="pick" data-v="in">入院患者</button></div></div>
      <div class="field ${to === 'in' ? '' : 'hidden'}" id="admit-field"><label class="lbl" for="r-admit">入院日</label><input id="r-admit" type="date" value="${ymd()}"></div>
      <div class="field"><label class="lbl" for="r-id1">患者ID（8桁）</label>
        <input id="r-id1" type="password" inputmode="numeric" autocomplete="off" maxlength="8" class="idinput">
        <label class="lbl" for="r-id2">もう一度入力</label>
        <input id="r-id2" type="password" inputmode="numeric" autocomplete="off" maxlength="8" class="idinput">
        <div class="muted small" id="id-note">IDは暗号化して保存します。見るときは合言葉が必要です。</div></div>
      <div class="field"><label class="lbl" for="r-nick">あだ名</label><input id="r-nick" type="text" autocomplete="off" placeholder="本名を連想させない名前に"></div>
      <div class="field"><div class="lbl">年代</div><div class="seg wrap6" data-pick="age">${ages}</div></div>
      <div class="field"><div class="lbl">性別</div><div class="seg" data-pick="sex"><button data-act="pick" data-v="M">男性</button><button data-act="pick" data-v="F">女性</button></div></div>
      <div class="field"><label class="lbl" for="r-bed">ベッド番号</label><input id="r-bed" type="text" autocomplete="off" placeholder="例：ER-3、5東-12"></div>
      <div class="field"><label class="lbl" for="r-dx">病名</label><input id="r-dx" type="text" autocomplete="off">
        ${sug.length ? `<div class="chips-row">${sug.map((s) => `<button class="pill" data-act="fillDx" data-v="${esc(s)}">${esc(s)}</button>`).join('')}</div>` : ''}</div>
      <div class="field"><div class="lbl">CODE</div><div class="seg" data-pick="code">${codes}</div></div>
      <div class="muted small">識別番号（例：7K3F）は登録すると自動で付きます。</div>
      <div class="err" id="reg-err"></div>
      <button class="btn" data-act="doRegister">登録する</button>`;
  },
  mount() {
    $('.seg[data-pick="to"]').addEventListener('picked', (e) => {
      $('#admit-field').classList.toggle('hidden', e.detail.value !== 'in');
    });
    const onlyDigits = (e) => { e.target.value = e.target.value.normalize('NFKC').replace(/\D/g, '').slice(0, 8); };
    $('#r-id1').addEventListener('input', onlyDigits);
    $('#r-id2').addEventListener('input', onlyDigits);
  },
  actions: {
    fillDx(ds) { $('#r-dx').value = ds.v; },
    async doRegister(ds, el) {
      const err = $('#reg-err');
      const pick = (g) => { const b = $(`.seg[data-pick="${g}"] .on`); return b ? b.dataset.v : ''; };
      const id1 = $('#r-id1').value.trim();
      const id2 = $('#r-id2').value.trim();
      const nickname = $('#r-nick').value.trim();
      const ageBand = pick('age');
      const sex = pick('sex');
      const to = pick('to') || 'er';
      if (!/^\d{8}$/.test(id1)) return void (err.textContent = '患者IDは8桁の数字で入れてください');
      if (id1 !== id2) return void (err.textContent = '2回入れたIDが一致しません');
      if (!nickname) return void (err.textContent = 'あだ名を入れてください');
      if (!ageBand) return void (err.textContent = '年代を選んでください');
      if (!sex) return void (err.textContent = '性別を選んでください');
      if (!state.meta.idKeys) return void (err.textContent = '合言葉が設定されていません。設定から合言葉を作ってください');
      err.textContent = '';
      el.disabled = true;
      try {
        const encId = await encryptId(state.meta.idKeys, id1);
        const p = M.newPatient({
          code: randomCode(existingCodes()),
          encId,
          nickname,
          ageBand,
          sex,
          bed: $('#r-bed').value.trim(),
          disease: $('#r-dx').value.trim(),
          codeStatus: pick('code') || 'unknown',
          location: to === 'in' ? 'inpatient' : 'er',
          admitDate: $('#r-admit').value || ymd(),
        }, state.meta.templates);
        $('#r-id1').value = '';
        $('#r-id2').value = '';
        await savePatient(p);
        await remember('diseases', p.disease);
        ui.toast(`登録しました（${p.code}）`);
        go(to === 'in' ? 'inPatient' : 'erPatient', { id: p.id }, { replace: true });
      } catch (e) {
        el.disabled = false;
        err.textContent = `登録できませんでした：${e.message}`;
      }
    },
  },
};
