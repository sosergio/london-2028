// "Compare areas": a sortable table of every area, opened in a dialog over the map.
// Each column says which direction is better; cells are tinted by how good they are within the column,
// so the strongest and weakest areas stand out without relying on colour alone.

import { fmt, esc, money } from './format.js';

// "~25–30 min" → 27.5, "£2,900–3,600" → 3250, "~45 min by car" → 45. NaN when there is no number.
const mid = s => {
  if (/doorstep|walking distance/i.test(s ?? '')) return 0;
  const n = String(s ?? '').replace(/,/g, '').match(/\d+(\.\d+)?/g);
  return n ? n.slice(0, 2).reduce((a, b) => a + +b, 0) / Math.min(n.length, 2) : NaN;
};
const RATING = { Excellent: 4, 'Very good': 3, Good: 2, Fair: 1, Poor: 0 };

const median = v => { if (!v.length) return NaN; const s = [...v].sort((a, b) => a - b), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

function areaRows(DATA) {
  const { areas, schools, shops } = DATA;
  return areas.map(a => {
    const ss = schools.filter(s => s.a === a.id);
    const rated = ss.filter(s => s.ok !== 'N');
    const secs = ss.filter(s => s.p !== 'P').map(s => s.pu);
    const ps = shops.filter(p => p.a === a.id);
    return {
      id: a.id, rank: a.rank, name: a.name,
      schools: ss.length,
      goodPct: rated.length ? Math.round(100 * rated.filter(s => s.ok === 'O' || s.ok === 'G').length / rated.length) : NaN,
      outstanding: ss.filter(s => s.ok === 'O').length,
      below: ss.filter(s => s.ok === 'W').length,
      fsm: median(ss.map(s => s.fsm).filter(v => v !== null)),
      small: ss.filter(s => s.pu < 400).length,
      smallestSec: secs.length ? Math.min(...secs) : NaN,
      commute: a.commute, commuteN: mid(a.commute),
      family: a.family, familyN: mid(a.family),
      priceLevel: +a.priceLevel || NaN,
      flat: +a.price.flat || NaN, terraced: +a.price.terraced || NaN, semi: +a.price.semi || NaN,
      rent: a.rent, rentN: mid(a.rent),
      crime: +a.crimeRate.all || NaN, violent: +a.crimeRate.violent || NaN, burglary: +a.crimeRate.burglary || NaN,
      cons: a.consPct === null || a.consPct === '' ? NaN : +a.consPct,
      density: a.dens,
      green: a.green, greenN: RATING[a.green] ?? NaN,
      life: a.life, lifeN: RATING[a.life] ?? NaN,
      grocers: ps.filter(p => p.g === 'up').length, bakeries: ps.filter(p => p.g === 'bake').length,
    };
  });
}

// key: sort value; show: cell text; better: 'low' | 'high' | null (no shading).
const GROUPS = [
  ['Schools', [
    { key: 'schools', label: 'Schools', better: null, title: 'Mixed state schools in the area (more for bigger areas)' },
    { key: 'goodPct', label: 'Good or better', better: 'high', show: r => isNaN(r.goodPct) ? '–' : r.goodPct + '%', title: 'Share of rated schools that are Outstanding/Exceptional or Good' },
    { key: 'outstanding', label: 'Outstanding', better: 'high' },
    { key: 'below', label: 'Below good', better: 'low' },
    { key: 'fsm', label: 'Free school meals', better: 'low', show: r => isNaN(r.fsm) ? '–' : Math.round(r.fsm) + '%', title: 'Median share of pupils eligible for free school meals (low-income families) across the area\'s schools. England: 25%' },
    { key: 'small', label: 'Under 400 pupils', better: 'high' },
    { key: 'smallestSec', label: 'Smallest secondary', better: 'low', show: r => isNaN(r.smallestSec) ? '–' : fmt(r.smallestSec) },
  ]],
  ['Getting about', [
    { key: 'commuteN', label: 'To Moorgate', better: 'low', show: r => esc(r.commute) },
    { key: 'familyN', label: 'To family', better: 'low', show: r => esc(r.family), title: 'Public transport unless marked "by car"' },
  ]],
  ['Housing', [
    { key: 'priceLevel', label: 'Price level', better: 'low', show: r => isNaN(r.priceLevel) ? '–' : r.priceLevel, title: '100 = typical for the shortlist, adjusted for property type' },
    { key: 'flat', label: 'Flat', better: 'low', show: r => money(r.flat), title: 'Median sold price, last 2 years' },
    { key: 'terraced', label: 'Terraced', better: 'low', show: r => money(r.terraced), title: 'Median sold price, last 2 years' },
    { key: 'semi', label: 'Semi', better: 'low', show: r => money(r.semi), title: 'Median sold price, last 2 years' },
    { key: 'rentN', label: 'Rent, 3-bed', better: 'low', show: r => esc(r.rent), title: 'Estimate, per month' },
  ]],
  ['Neighbourhood', [
    { key: 'crime', label: 'Crime /1k', better: 'low', show: r => isNaN(r.crime) ? '–' : Math.round(r.crime), title: 'Crimes a year per 1,000 residents across the area, shoplifting left out (police.uk)' },
    { key: 'violent', label: 'Violence /1k', better: 'low', show: r => isNaN(r.violent) ? '–' : Math.round(r.violent), title: 'Violent crime and robbery a year per 1,000 residents' },
    { key: 'burglary', label: 'Burglary /1k', better: 'low', show: r => isNaN(r.burglary) ? '–' : r.burglary.toFixed(1), title: 'Burglaries a year per 1,000 residents' },
    { key: 'cons', label: 'Conservation', better: null, show: r => isNaN(r.cons) ? '–' : r.cons + '%', title: 'Share of homes sold in the last 2 years that are inside a conservation area: protected character, but more planning limits' },
    { key: 'density', label: 'People/km²', better: 'low', show: r => fmt(r.density) },
    { key: 'greenN', label: 'Green', better: 'high', show: r => esc(r.green) },
    { key: 'lifeN', label: 'Lifestyle', better: 'high', show: r => esc(r.life) },
    { key: 'grocers', label: 'Upmarket grocers', better: 'high' },
    { key: 'bakeries', label: 'Bakeries, delis', better: 'high' },
  ]],
];
const COLS = GROUPS.flatMap(([, cols]) => cols);

export function createCompare(DATA, { onPick }) {
  const dlg = document.getElementById('compare');
  const rows = areaRows(DATA);
  let sort = { key: 'rank', dir: 1 };

  // 0 = worst in the column, 1 = best; null when the column is not shaded or the value is missing.
  const range = Object.fromEntries(COLS.map(c => {
    const v = rows.map(r => r[c.key]).filter(x => !isNaN(x));
    return [c.key, [Math.min(...v), Math.max(...v)]];
  }));
  const score = (c, v) => {
    if (!c.better || isNaN(v)) return null;
    const [lo, hi] = range[c.key]; if (hi === lo) return null;
    const t = (v - lo) / (hi - lo);
    return c.better === 'high' ? t : 1 - t;
  };

  function draw() {
    const sorted = [...rows].sort((a, b) => {
      const x = a[sort.key], y = b[sort.key];
      if (isNaN(x) && isNaN(y)) return a.rank - b.rank;
      if (isNaN(x)) return 1; if (isNaN(y)) return -1;   // missing values always last
      return (x - y) * sort.dir || a.rank - b.rank;
    });
    const th = (key, label, title, better, cls = '') => {
      const on = sort.key === key;
      const hint = better === 'low' ? '<small>lower is better</small>' : better === 'high' ? '<small>higher is better</small>' : '';
      return `<th scope="col" class="${cls}" aria-sort="${on ? (sort.dir > 0 ? 'ascending' : 'descending') : 'none'}"${title ? ` title="${esc(title)}"` : ''}>
        <button type="button" data-sort="${key}">${label}<span class="sort" aria-hidden="true">${on ? (sort.dir > 0 ? '▲' : '▼') : ''}</span>${hint}</button></th>`;
    };
    dlg.querySelector('table').innerHTML = `
      <thead>
        <tr><th class="area-col grp" rowspan="2" scope="col"><button type="button" data-sort="rank">Area<span class="sort" aria-hidden="true">${sort.key === 'rank' ? (sort.dir > 0 ? '▲' : '▼') : ''}</span><small>by rank</small></button></th>
          ${GROUPS.map(([g, cols]) => `<th class="grp" colspan="${cols.length}" scope="colgroup">${g}</th>`).join('')}</tr>
        <tr>${COLS.map(c => th(c.key, c.label, c.title, c.better)).join('')}</tr>
      </thead>
      <tbody>${sorted.map(r => `<tr data-id="${r.id}" tabindex="0">
        <th scope="row" class="area-col"><span class="rank">${r.rank}</span> ${esc(r.name)}</th>
        ${COLS.map(c => {
          const s = score(c, r[c.key]);
          const style = s === null ? '' : ` style="--s:${s.toFixed(2)}"`;
          return `<td${style}${s === null ? '' : ' class="shade"'}>${c.show ? c.show(r) : (isNaN(r[c.key]) ? '–' : fmt(r[c.key]))}</td>`;
        }).join('')}</tr>`).join('')}
      </tbody>`;
  }

  dlg.addEventListener('click', e => {
    const b = e.target.closest('button[data-sort]');
    if (b) {
      const k = b.dataset.sort;
      const col = COLS.find(c => c.key === k);
      // First click puts the better end on top.
      sort = sort.key === k ? { key: k, dir: -sort.dir } : { key: k, dir: col?.better === 'high' ? -1 : 1 };
      draw(); dlg.querySelector(`button[data-sort="${k}"]`)?.focus();
      return;
    }
    const tr = e.target.closest('tbody tr');
    if (tr) { dlg.close(); onPick(tr.dataset.id); return; }
    if (e.target === dlg) dlg.close(); // click on the backdrop
  });
  dlg.addEventListener('keydown', e => {
    const tr = e.target.closest?.('tbody tr');
    if (tr && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); dlg.close(); onPick(tr.dataset.id); }
  });
  dlg.querySelector('.dlg-close').addEventListener('click', () => dlg.close());
  document.getElementById('open-compare').addEventListener('click', () => { draw(); dlg.showModal(); });
}
