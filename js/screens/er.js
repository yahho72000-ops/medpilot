// 救急外来：一覧・患者ページ・登録

import { esc, ymd, mdw, md, $ } from '../util.js';
import { state, findPatient, savePatient, existingCodes, remember } from '../store.js';
import * as M from '../model.js';
import { go, backTo, current } from '../router.js';
import { encryptId, randomCode } from '../crypto.js';
import { header, chip, demo, codeText, patientCard, taskRow, taskChip, remainChip, labGrid, devicesBlock, sec, emptyState, missingChip, nick, pageTabs, profileCard, miniHead } from './common.js';
import { setPage } from './inpatient.js';
import * as ui from '../ui.js';
import { wardRoomFields } from '../actions.js';
import { medsBlock, culturesBlock, clinicalTodayRows, cultureChip } from '../clinical.js';
import { nutritionBlock, memoRow } from '../nutriUI.js';
import { summaryBlock, summaryButton, applyDraftToNew, draftProfile } from './summary.js';
import { listTabs, todoView, viewActions } from './todo.js';

// ---- 一覧 ----
export const erListScreen = {
  render(params = {}) {
    const list = M.sortEr(state.patients.filter((p) => p.location === 'er'));
    const cards = list
      .map((p) => {
        const er = p.tasks.filter((t) => t.group === 'er' && M.isDueNow(t));
        const extra = p.tasks.filter((t) => t.group !== 'er' && M.isOpen(t));
        const tag = p.ending ? `<span class="tag">${esc(M.endingLabel(p))}</span>` : '';
        return `<button class="card pcard-list" data-act="openPatient" data-id="${p.id}">
          <div class="row-between"><div class="nameline">${nameLineHtml(p)}</div>${remainChip(p)}</div>
          <div class="row-gap wrap">${missingChip(p)}${tag}<span class="muted small">${esc([demo(p), codeText(p)].filter(Boolean).join(' ・ '))}</span></div>
          <div class="chips-row">${er.map(taskChip).join('')}${extra.map(taskChip).join('')}${cultureChip(p)}</div>
        </button>`;
      })
      .join('');
    const todo = params.view === 'todo' && list.length;
    return `${header(`救急外来　${list.length}人`, 'メニュー')}
      ${list.length ? listTabs(params.view, M.remainingCount(list)) : ''}
      <div class="ppage">
      ${todo
        ? todoView(list, (p) => `${p.visitDate.slice(5).replace('-', '/')} 来院`)
        : `${list.length ? '<div class="muted small">並び：タスクが多い順</div>' : ''}
      ${cards || emptyState('救急外来の患者はいません')}
      ${list.length ? '<div class="muted small">赤＝まだ　黄＝待ち　グレー＝済・なし</div>' : ''}`}
      </div>
      ${todo ? '' : `<div class="bottom-space"></div>
      <div class="fixed-bottom grid2 two-btn"><button class="btn" data-act="quickRegister">すぐ登録</button><button class="btn2 solid" data-act="goRegister" data-to="er">＋ 詳しく登録</button></div>`}`;
  },
  actions: {
    ...viewActions,
    goRegister(ds) { go('register', { to: ds.to }); },
    // あだ名とブース番号だけで登録して、すぐタスクを始める（空でも可）
    async quickRegister() {
      const r = await ui.custom(`<div class="sheet-title">すぐ登録</div>
        <div class="muted small">ID・年代・性別などは、あとで患者ページの「編集」から入れられます。空のままでも登録できます。</div>
        <label class="lbl" for="q-nick">あだ名</label><input id="q-nick" type="text" autocomplete="off" placeholder="本名を連想させない名前に">
        <label class="lbl" for="q-room">ブース番号</label><input id="q-room" type="text" inputmode="numeric" pattern="[0-9]*" maxlength="4" autocomplete="off" placeholder="例：3">
        <div class="grid2"><button class="btn3" data-act="sheetCancel">やめる</button><button class="btn" data-act="quickOk">登録する</button></div>`);
      if (!r) return;
      const p = M.newPatient({ code: randomCode(existingCodes()), nickname: r.nickname, ward: 'ER', room: r.room, location: 'er' }, state.meta.templates);
      await savePatient(p);
      ui.toast(`登録しました（${p.code}）。ID などはあとで「編集」から`);
      go('erPatient', { id: p.id });
    },
    quickOk() {
      ui.resolveSheet({ nickname: $('#q-nick').value.trim(), room: $('#q-room').value.normalize('NFKC').replace(/\D/g, '').slice(0, 4) });
    },
  },
};

function nameLineHtml(p) {
  return `<span class="code">${esc(p.code)}</span><span class="muted">${p.bed ? `　${esc(p.bed)}` : ''}　${nick(p)}</span>`;
}

// ---- 患者ページ ----
export const erPatientScreen = {
  render(params) {
    const { id } = params;
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
    const page = Number(params.page) === 2 ? 2 : 1;
    if (page === 1) {
      return `${header('患者', '救急外来')}
      ${pageTabs(1)}
      <div class="ppage">
      ${profileCard(p)}
      ${memoRow(p)}
      ${endingBox}
      ${listTasks.length ? `${sec(M.GROUP_TITLES[listGroup])}<div class="tlist">${listTasks.map((t) => taskRow(p, t)).join('')}</div>` : ''}
      ${sec('検査・説明')}
      <div class="tlist">${clinicalTodayRows(p)}${erTasks.map((t) => taskRow(p, t)).join('')}</div>
      <div class="muted small">タップすると、状態を選んだり名前を変えたりできます</div>
      <div class="grid2"><button class="btn2" data-act="addSame" data-pid="${p.id}">＋ 同じ種類を追加</button><button class="btn2" data-act="addTask" data-pid="${p.id}">＋ タスクを追加</button></div>
      ${endingButtons}
      <div class="muted small center">左右にスワイプで「詳細」へ</div>
      </div>`;
    }
    return `${header('患者', '救急外来')}
      ${pageTabs(2)}
      <div class="ppage">
      ${miniHead(p)}
      ${summaryButton(p)}
      ${summaryBlock(p)}
      ${sec('検査値')}
      ${labGrid(p)}
      <div class="grid2"><button class="btn2" data-act="openLabImport" data-pid="${p.id}">検査値を読み込む</button><button class="btn2" data-act="openGraph" data-pid="${p.id}">経過グラフ</button></div>
      ${sec('薬', `<button class="mini" data-act="addMed" data-pid="${p.id}">＋ 追加</button>`)}
      <div class="card kvlist">${medsBlock(p)}</div>
      ${sec('培養', `<button class="mini" data-act="addCulture" data-pid="${p.id}">＋ 追加</button>`)}
      <div class="card clist">${culturesBlock(p)}</div>
      ${sec('栄養')}
      <div class="card kvlist">${nutritionBlock(p)}</div>
      ${sec('デバイス', `<button class="mini" data-act="addDevice" data-pid="${p.id}">＋ 追加</button>`)}
      <div class="card kvlist">${devicesBlock(p)}</div>
      </div>`;
  },
  actions: {
    setPage(ds) { setPage(Number(ds.v)); },
    swipeNext() { setPage(2); },
    swipePrev() { setPage(1); },
  },
};

// ---- 登録 ----
export const registerScreen = {
  render({ to = 'er', summary }) {
    const sug = (state.meta.history.diseases || []).slice(0, 10);
    // まとめカルテから登録するときは、読み取った値を最初から入れておく
    const pf = (summary && draftProfile()) || {};
    const on = (a, b) => (a === b ? 'class="on"' : '');
    const ages = M.AGE_BANDS.map((b) => `<button ${on(pf.ageBand, b)} data-act="pick" data-v="${b}">${M.ageButton(b)}</button>`).join('');
    const code0 = pf.codeStatus || 'unknown';
    const codes = Object.entries(M.CODE_STATUS).map(([k, l]) => `<button class="${k === code0 ? 'on' : ''}" data-act="pick" data-v="${k}">${l}</button>`).join('');
    return `${header('患者を登録', '戻る')}
      ${summary && draftProfile() ? '<div class="card small">まとめカルテから読み取った値を入れています。あだ名・病棟・病室・ID を入れて登録してください。</div>' : ''}
      <div class="field"><div class="lbl">登録先</div>
        <div class="seg" data-pick="to"><button class="${to === 'er' ? 'on' : ''}" data-act="pick" data-v="er">救急外来</button><button class="${to === 'in' ? 'on' : ''}" data-act="pick" data-v="in">入院患者</button></div></div>
      <div class="field ${to === 'in' ? '' : 'hidden'}" id="admit-field"><label class="lbl" for="r-admit">入院日</label><input id="r-admit" type="date" value="${pf.admitDate || ymd()}"></div>
      <div class="muted small">急いでいるときは空のままでも登録できます（あとで「編集」から入れられます）。</div>
      <div class="field"><label class="lbl" for="r-id1">患者ID（8桁）</label>
        <input id="r-id1" type="password" inputmode="numeric" autocomplete="off" maxlength="8" class="idinput">
        <label class="lbl" for="r-id2">もう一度入力</label>
        <input id="r-id2" type="password" inputmode="numeric" autocomplete="off" maxlength="8" class="idinput">
        <div class="muted small" id="id-note">IDは暗号化して保存します。見るときは合言葉が必要です。</div></div>
      <div class="field"><label class="lbl" for="r-nick">あだ名</label><input id="r-nick" type="text" autocomplete="off" placeholder="本名を連想させない名前に"></div>
      <div class="field"><div class="lbl">年代</div><div class="seg wrap6" data-pick="age">${ages}</div></div>
      <div class="field"><div class="lbl">性別</div><div class="seg" data-pick="sex"><button ${on(pf.sex, 'M')} data-act="pick" data-v="M">男性</button><button ${on(pf.sex, 'F')} data-act="pick" data-v="F">女性</button></div></div>
      <div class="field"><div class="lbl">病棟・病室（救急外来は ER ＋ブース番号）</div>${wardRoomFields('r', to === 'er' ? 'ER' : '', '')}</div>
      <div class="field"><label class="lbl" for="r-dx">病名</label><input id="r-dx" type="text" autocomplete="off" value="${esc(pf.disease || '')}">
        ${sug.length ? `<div class="chips-row">${sug.map((s) => `<button class="pill" data-act="fillDx" data-v="${esc(s)}">${esc(s)}</button>`).join('')}</div>` : ''}</div>
      <div class="field"><label class="lbl" for="r-wt">体重（kg）　γ の計算に使います</label><input id="r-wt" type="text" inputmode="decimal" autocomplete="off" placeholder="例：62" value="${pf.weight ? esc(String(pf.weight)) : ''}"></div>
      <div class="field"><div class="lbl">CODE</div><div class="seg" data-pick="code">${codes}</div></div>
      <div class="muted small">識別番号（例：7K3F）は登録すると自動で付きます。</div>
      <div class="err" id="reg-err"></div>
      <button class="btn" data-act="doRegister">登録する</button>`;
  },
  mount() {
    $('.seg[data-pick="to"]').addEventListener('picked', (e) => {
      const toIn = e.detail.value === 'in';
      $('#admit-field').classList.toggle('hidden', !toIn);
      const ward = $('#r-ward');
      if (toIn && ward.value === 'ER') ward.value = '';
      if (!toIn && !ward.value) ward.value = 'ER';
    });
    $('#r-room').addEventListener('input', (e) => { e.target.value = e.target.value.normalize('NFKC').replace(/\D/g, '').slice(0, 4); });
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
      const wt = $('#r-wt').value.normalize('NFKC').trim();
      if (wt && !(Number(wt) > 0 && Number(wt) < 400)) return void (err.textContent = '体重は数字（kg）で入れてください');
      if (id1 || id2) {
        if (!/^\d{8}$/.test(id1)) return void (err.textContent = '患者IDは8桁の数字で入れてください');
        if (id1 !== id2) return void (err.textContent = '2回入れたIDが一致しません');
        if (!state.meta.idKeys) return void (err.textContent = '合言葉が設定されていません。ID を空にして登録するか、設定から合言葉を作ってください');
      }
      err.textContent = '';
      el.disabled = true;
      try {
        const encId = id1 ? await encryptId(state.meta.idKeys, id1) : null;
        const p = M.newPatient({
          code: randomCode(existingCodes()),
          encId,
          nickname,
          ageBand,
          sex,
          ward: $('#r-ward').value,
          room: $('#r-room').value.trim(),
          disease: $('#r-dx').value.trim(),
          codeStatus: pick('code') || 'unknown',
          weight: wt ? Number(wt) : null,
          location: to === 'in' ? 'inpatient' : 'er',
          admitDate: $('#r-admit').value || ymd(),
        }, state.meta.templates);
        $('#r-id1').value = '';
        $('#r-id2').value = '';
        await savePatient(p);
        await remember('diseases', p.disease);
        if (current().params.summary && draftProfile()) {
          // まとめカルテで選んだもの（Problem List・薬・培養など）を入れる
          const n = applyDraftToNew(p);
          await savePatient(p);
          ui.toast(`登録しました（${p.code}）。まとめカルテから ${n}件 入れました`);
          backTo(to === 'in' ? 'inList' : 'erList');
          go(to === 'in' ? 'inPatient' : 'erPatient', { id: p.id });
          return;
        }
        ui.toast(`登録しました（${p.code}）`);
        go(to === 'in' ? 'inPatient' : 'erPatient', { id: p.id }, { replace: true });
      } catch (e) {
        el.disabled = false;
        err.textContent = `登録できませんでした：${e.message}`;
      }
    },
  },
};
