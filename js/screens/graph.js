// 経過グラフ：上に薬の横棒（昇圧薬・鎮静薬は流量の線）、下に検査値の折れ線 2 つ。日付の目盛りはそろえる

import { esc, ymd, addDays, diffDays, parseYmd, md } from '../util.js';
import { state, findPatient, saveMeta } from '../store.js';
import { render, current } from '../router.js';
import { header, emptyState } from './common.js';
import * as K from '../meds.js';
import { num } from '../labs.js';

const W = 360;
const L = 66; // 左の名前の幅
const R = 10;
const PW = W - L - R;
const CAT_ORDER = { abx: 0, vaso: 1, sed: 2, drip: 3, other: 4 };
const PERIODS = [['1w', '1週間'], ['2w', '2週間'], ['all', '全期間']];

function range(p, period) {
  const end = p.location === 'past' && p.endedAt ? p.endedAt : ymd();
  if (period === '2w') return { start: addDays(end, -13), end };
  if (period === 'all') {
    const ds = [p.admitDate, p.visitDate, ...(p.meds || []).map((m) => m.start), ...(p.labs || []).map((l) => l.date), ...(p.cultures || []).map((c) => c.submitted)].filter(Boolean);
    let start = ds.reduce((a, b) => (b < a ? b : a), end);
    if (diffDays(end, start) < 6) start = addDays(end, -6);
    return { start, end };
  }
  return { start: addDays(end, -6), end };
}

function scale(start, end) {
  const n = diffDays(end, start) + 1;
  const dayW = PW / n;
  const startMs = parseYmd(start).getTime();
  const clampX = (x) => Math.max(L, Math.min(L + PW, x));
  return {
    n,
    dayW,
    xDay: (d) => L + (diffDays(d, start) + 0.5) * dayW,
    x0: (d) => clampX(L + diffDays(d, start) * dayW),
    x1: (d) => clampX(L + (diffDays(d, start) + 1) * dayW),
    xMs: (ms) => clampX(L + ((ms - startMs) / 86400000) * dayW),
    endMs: parseYmd(end).getTime() + 86400000,
    startMs,
  };
}

const short = (s, n = 7) => (String(s).length > n ? `${String(s).slice(0, n - 1)}…` : String(s));
const f1 = (v) => Math.round(v * 10) / 10;

function axis(sc, start, end, y) {
  const step = sc.n <= 14 ? 1 : Math.ceil(sc.n / 10);
  let out = `<line x1="${L}" y1="${y}" x2="${L + PW}" y2="${y}" class="g-line"/>`;
  for (let i = 0; i < sc.n; i += step) {
    const d = addDays(start, i);
    const dt = parseYmd(d);
    const label = i === 0 || dt.getDate() === 1 ? md(d) : String(dt.getDate());
    out += `<text x="${f1(sc.xDay(d))}" y="${y + 12}" class="g-ax" text-anchor="middle">${label}</text>`;
  }
  const today = ymd();
  if (today >= start && today <= end) out += `<text x="${f1(sc.xDay(today))}" y="${y + 23}" class="g-ax" text-anchor="middle">今日</text>`;
  return out;
}

function medRows(p, sc, start, end, y0) {
  const meds = (p.meds || [])
    .filter((m) => m.start <= end && (m.end || end) >= start)
    .sort((a, b) => (CAT_ORDER[a.cat] ?? 9) - (CAT_ORDER[b.cat] ?? 9) || (a.start < b.start ? -1 : 1));
  let y = y0;
  let out = '';
  const nowMs = Date.now();
  for (const m of meds) {
    const color = (K.MED_CATS[m.cat] || K.MED_CATS.other).color;
    if (K.isFlow(m)) {
      const h = 30;
      const base = y + h + 4;
      const rates = (m.rates || []).slice().sort((a, b) => a.at - b.at);
      // γ などに直せるときは直した値、直せないとき（体重なしなど）は mL/h で描く
      let vals = rates.map((r) => K.rateDose(m, r, p.weight));
      let unit = m.unit;
      let fmt = (v) => K.fmtDose(m, v);
      if (vals.some((v) => v === null)) {
        vals = rates.map((r) => (r.ml !== undefined ? r.ml : r.value));
        unit = rates.some((r) => r.ml !== undefined) ? 'mL/h' : m.unit;
        fmt = (v) => K.fmtNum(v);
      }
      const max = Math.max(...vals, 0) || 1;
      const yv = (v) => base - (v / max) * h;
      out += `<text x="0" y="${y + 14}" class="g-name">${esc(short(m.name))}</text><text x="0" y="${y + 27}" class="g-unit">${esc(unit)}</text>`;
      out += `<line x1="${L}" y1="${base}" x2="${L + PW}" y2="${base}" class="g-line"/>`;
      if (rates.length) {
        const stopMs = m.end ? Math.min(parseYmd(m.end).getTime() + 86400000, sc.endMs) : Math.min(nowMs, sc.endMs);
        let d = '';
        let labels = '';
        for (let i = 0; i < rates.length; i++) {
          const r = rates[i];
          const val = vals[i];
          const a = r.at;
          const b = i + 1 < rates.length ? rates[i + 1].at : stopMs;
          if (!(val > 0) || b <= sc.startMs || a >= sc.endMs || b <= a) continue;
          const xa = sc.xMs(a);
          const xb = sc.xMs(b);
          const yy = f1(yv(val));
          d += `M${f1(xa)} ${base} V${yy} H${f1(xb)} V${base} `;
          // 幅のある区間だけ、真ん中に数字を出す
          if (xb - xa >= 20) {
            labels += `<text x="${f1((xa + xb) / 2)}" y="${f1(Math.max(y + 8, yy - 3))}" class="g-val" text-anchor="middle" style="fill:${color}">${esc(fmt(val))}</text>`;
          }
        }
        out += `<path d="${d}" style="fill:${color};fill-opacity:.22;stroke:${color};stroke-width:1.4"/>${labels}`;
      } else {
        out += `<text x="${L + 4}" y="${base - 6}" class="g-ax">流量の記録なし</text>`;
      }
      y = base + 8;
    } else {
      const xa = sc.x0(m.start < start ? start : m.start);
      const last = m.end && m.end < end ? m.end : end;
      const xb = sc.x1(last);
      out += `<text x="0" y="${y + 12}" class="g-name">${esc(short(m.name))}</text>`;
      out += `<rect x="${f1(xa)}" y="${y + 2}" width="${f1(Math.max(2, xb - xa))}" height="13" rx="3" style="fill:${color}"/>`;
      const k = K.medDay(m, last);
      if (xb - xa > 34) out += `<text x="${f1(xb - 4)}" y="${y + 12}" class="g-bar" text-anchor="end">${k}日</text>`;
      y += 20;
    }
  }
  if (!meds.length) {
    out += `<text x="${L}" y="${y + 12}" class="g-ax">この期間の薬の記録はありません</text>`;
    y += 20;
  }
  return { svg: out, y };
}

function cultureMarks(p, sc, start, end, y) {
  let out = '';
  for (const c of p.cultures || []) {
    if (c.submitted >= start && c.submitted <= end) {
      const x = f1(sc.xDay(c.submitted));
      out += `<path d="M${x} ${y} l-4 7 h8 z" class="g-cul"/>`;
    }
    const res = c.sensAt || c.prelimAt || (c.stage === 'negative' ? c.doneAt : null);
    if (res && res >= start && res <= end) out += `<circle cx="${f1(sc.xDay(res))}" cy="${y + 4}" r="3.2" class="g-cul-res"/>`;
  }
  return out;
}

function labPanel(p, item, sc, start, end) {
  const H = 120;
  const top = 14;
  const bottom = H - 8;
  const pts = (p.labs || [])
    .filter((l) => l.itemId === item.id && l.date >= start && l.date <= end && num(l.value) !== null)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.draw - b.draw))
    .map((l) => ({ ...l, v: num(l.value), x: sc.xDay(l.date) + (l.draw - 1) * Math.min(10, sc.dayW * 0.3) }));
  let svg = `<line x1="${L}" y1="${bottom}" x2="${L + PW}" y2="${bottom}" class="g-line"/>`;
  if (!pts.length) {
    svg += `<text x="${L + 4}" y="${H / 2 + 4}" class="g-ax">この期間の記録はありません</text>`;
    return `<svg viewBox="0 0 ${W} ${H}" class="graph" role="img" aria-label="${esc(item.abbr)} の経過">${svg}</svg>`;
  }
  let lo = Math.min(...pts.map((x) => x.v));
  let hi = Math.max(...pts.map((x) => x.v));
  if (hi === lo) { hi += 1; lo -= 1; }
  const pad = (hi - lo) * 0.12;
  lo -= pad; hi += pad;
  const yv = (v) => bottom - ((v - lo) / (hi - lo)) * (bottom - top);
  svg += `<polyline points="${pts.map((x) => `${f1(x.x)},${f1(yv(x.v))}`).join(' ')}" class="g-lab"/>`;
  const many = pts.length > 9;
  const maxI = pts.findIndex((x) => x.v === Math.max(...pts.map((q) => q.v)));
  const minI = pts.findIndex((x) => x.v === Math.min(...pts.map((q) => q.v)));
  pts.forEach((x, i) => {
    const cls = x.flag === 'H' ? 'g-pt-h' : x.flag === 'L' ? 'g-pt-l' : 'g-pt';
    svg += `<circle cx="${f1(x.x)}" cy="${f1(yv(x.v))}" r="3.4" class="${cls}"/>`;
    if (!many || i === pts.length - 1 || i === maxI || i === minI) {
      svg += `<text x="${f1(x.x)}" y="${f1(yv(x.v) - 6)}" class="g-val ${x.flag === 'H' ? 'g-hi' : x.flag === 'L' ? 'g-lo' : ''}" text-anchor="middle">${esc(x.value)}</text>`;
    }
  });
  return `<svg viewBox="0 0 ${W} ${H}" class="graph" role="img" aria-label="${esc(item.abbr)} の経過">${svg}</svg>`;
}

function itemSelect(p, i, chosen) {
  const items = [...state.meta.labItems].sort((a, b) => a.order - b.order);
  const has = new Set((p.labs || []).map((l) => l.itemId));
  const opt = (it) => `<option value="${esc(it.abbr)}" ${it === chosen ? 'selected' : ''}>${esc(it.abbr)}${it.unit ? `（${esc(it.unit)}）` : ''}${has.has(it.id) ? '' : '　記録なし'}</option>`;
  const withData = items.filter((it) => has.has(it.id));
  const without = items.filter((it) => !has.has(it.id));
  return `<select class="g-select" data-gi="${i}" aria-label="${i + 1}つ目の検査項目">${withData.map(opt).join('')}${without.length ? `<optgroup label="記録なし">${without.map(opt).join('')}</optgroup>` : ''}</select>`;
}

export const graphScreen = {
  render({ id, period = '1w' }) {
    const p = findPatient(id);
    if (!p) return `${header('経過グラフ', '戻る')}${emptyState('患者が見つかりません')}`;
    const { start, end } = range(p, period);
    const sc = scale(start, end);
    const seg = `<div class="seg">${PERIODS.map(([k, l]) => `<button class="${k === period ? 'on' : ''}" data-act="graphPeriod" data-v="${k}">${l}</button>`).join('')}</div>`;
    const meds = medRows(p, sc, start, end, 4);
    const axisY = meds.y + 4;
    const marks = cultureMarks(p, sc, start, end, axisY + 26);
    const topH = axisY + 40;
    const topSvg = `<svg viewBox="0 0 ${W} ${topH}" class="graph" role="img" aria-label="薬と培養の経過">${meds.svg}${axis(sc, start, end, axisY)}${marks}</svg>`;
    const items = state.meta.labItems;
    const chosen = (state.meta.settings.graphItems || ['WBC', 'CRP']).map((abbr) => items.find((it) => it.abbr === abbr) || null);
    const labs = [0, 1]
      .map((i) => {
        const it = chosen[i] || items[i];
        if (!it) return '';
        return `<div class="g-panel">${itemSelect(p, i, it)}${labPanel(p, it, sc, start, end)}</div>`;
      })
      .join('');
    const legend = Object.values(K.MED_CATS).map((c) => `<span><span class="mdot" style="background:${c.color}"></span>${c.label}</span>`).join('');
    return `${header('経過グラフ', p.code)}
      ${seg}
      <div class="muted small">${md(start)}〜${md(end)}</div>
      <div class="card g-card">${topSvg}
        <div class="g-legend">${legend}<span><span class="g-tri"></span>培養を出した日</span><span><span class="g-dot"></span>結果が出た日</span></div>
      </div>
      <div class="card g-card">${labs}<div class="g-legend"><span class="hi">● H（高い）</span><span class="lo">● L（低い）</span><span>項目は上の枠をタップして変えられます</span></div></div>`;
  },
  mount() {
    for (const sel of document.querySelectorAll('.g-select')) {
      sel.addEventListener('change', async () => {
        const arr = [...(state.meta.settings.graphItems || ['WBC', 'CRP'])];
        arr[Number(sel.dataset.gi)] = sel.value;
        state.meta.settings.graphItems = arr;
        await saveMeta('settings');
        render();
      });
    }
  },
  actions: {
    graphPeriod(ds) {
      current().params.period = ds.v;
      render();
    },
  },
};
