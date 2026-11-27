// メニュー（アプリを開いて最初の画面）

import { esc, todayJa } from '../util.js';
import { state } from '../store.js';
import * as M from '../model.js';
import { go } from '../router.js';
import { backupDays } from '../backup.js';

function counts() {
  const ps = state.patients;
  const inp = ps.filter((p) => p.location === 'inpatient');
  const fol = ps.filter((p) => p.location === 'followup');
  const today = M.today();
  const er = ps.filter((p) => p.location === 'er');
  return {
    er: er.length,
    inp: inp.length,
    erLeft: M.remainingCount(er),
    inLeft: M.remainingCount(inp),
    fol: fol.length,
    past: ps.filter((p) => p.location === 'past').length,
    ic: inp.filter(M.icWarn).length,
    dev: inp.reduce((n, p) => n + M.activeDevices(p).filter(M.deviceWarn).length, 0),
    due: fol.reduce((n, p) => n + p.tasks.filter((t) => M.isOpen(t) && t.dueDate && t.dueDate <= today).length, 0),
  };
}

const standalone = () => window.navigator.standalone === true || window.matchMedia('(display-mode: standalone)').matches;

export const menuScreen = {
  render() {
    const c = counts();
    const alerts = [];
    if (c.ic) alerts.push(`家族IC 7日超 ${c.ic}人`);
    if (c.dev) alerts.push(`デバイス 14日超 ${c.dev}件`);
    if (c.due) alerts.push(`フォロー期限 ${c.due}件`);
    const alertBox = alerts.length
      ? `<div class="alert"><div class="alert-title">要注意 ${c.ic + c.dev + c.due}件</div><div class="alert-text">${esc(alerts.join(' ・ '))}</div></div>`
      : '';
    // バックアップ：7日たったら（またはまだなら）赤で知らせる
    const bd = backupDays();
    const hasData = !state.demo && state.patients.length > 0;
    const backupBox = bd === null
      ? (hasData ? '<button class="alert alert-btn" data-act="goBackup"><div class="alert-title">まだバックアップしていません</div><div class="alert-text">設定 → バックアップ から書き出せます</div></button>' : '')
      : bd >= 7
        ? `<button class="alert alert-btn" data-act="goBackup"><div class="alert-title">最後のバックアップ：${bd}日前</div><div class="alert-text">設定 → バックアップ から書き出せます</div></button>`
        : `<div class="muted small">最後のバックアップ：${bd === 0 ? '今日' : `${bd}日前`}</div>`;
    const install = standalone()
      ? ''
      : '<div class="hint">ホーム画面に追加すると、アプリとして使えます（Safari の共有ボタン →「ホーム画面に追加」）。</div>';
    const tile = (act, label, num, unit, note = '', sub = '') => `<button class="tile" ${act ? `data-act="${act}"` : 'disabled'}>
        <span class="tile-label">${label}</span>
        ${num !== null ? `<span class="tile-num">${num}<span class="tile-unit">${unit}</span></span>` : `<span class="muted small">${note}</span>`}
        ${sub}
      </button>`;
    // 残りの TODO の数（全部終わったら「おつかれさま！」）
    const left = (n, people) => (people ? `<span class="tile-sub ${n ? 'left' : 'done'}">${n ? `残り ${n}` : 'おつかれさま！'}</span>` : '');
    return `<div class="brand-hdr"><div class="brand">MedPilot</div><div class="muted">${todayJa()}</div></div>
      ${alertBox}${install}
      <div class="tiles">
        ${tile('goEr', '救急外来', c.er, '人', '', left(c.erLeft, c.er))}
        ${tile('goIn', '入院患者', c.inp, '人', '', left(c.inLeft, c.inp))}
        ${tile('goFollow', '帰宅後フォロー', c.fol, '人')}
        ${tile('goHandoff', '申し送り', c.er + c.inp, '人')}
        ${tile('goPast', '過去の一覧', c.past, '人')}
        ${tile('goSettings', '設定', null, '', '色・PIN・ひな形')}
      </div>
      ${backupBox}
      <div class="center"><button class="btn2 wide-auto" data-act="lockNow">ロックする</button></div>`;
  },
  actions: {
    goEr() { go('erList'); },
    goIn() { go('inList'); },
    goFollow() { go('followup'); },
    goPast() { go('past'); },
    goHandoff() { go('handoff', { tab: 'er' }); },
    goSettings() { go('settings'); },
    goBackup() { go('settings'); },
  },
};
