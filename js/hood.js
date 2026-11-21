// Neighbourhood layers: deprivation (IoD 2025, by neighbourhood), social housing (Census 2021, by Output
// Area) and road noise (Defra strategic noise maps, live tiles). Like prices, crime and sweet spots they
// shade the map, so switching one on turns the others off (the 'nbhd-layer' event).
import { state, saveState } from './state.js';
import { loadDeprivation, loadTenure } from './data.js';
import { esc, fmt } from './format.js';

// Deciles: 1 = most deprived 10% of neighbourhoods in England. Band 0 (least) to 5 (most deprived).
const decBand = d => !d ? -1 : d >= 9 ? 0 : d >= 7 ? 1 : d >= 5 ? 2 : d >= 3 ? 3 : d === 2 ? 4 : 5;
export const DEP_KINDS = {
  imd: { label: 'Overall', field: 'imd', title: 'Index of Multiple Deprivation: income, jobs, education, health, crime, housing and environment combined' },
  income: { label: 'Income', field: 'income', title: 'Share of people in income-deprived households' },
  idaci: { label: 'Children', field: 'idaci', title: 'Share of children (0-15) in income-deprived families' },
};
// England's typical (median) neighbourhood in IoD 2025.
const TYPICAL = { incomePct: 18, idaciPct: 30 };
// Social rented share of households: band edges.
export const SOCIAL_CUTS = [10, 20, 30, 45, 60];
const socialBand = v => SOCIAL_CUTS.filter(c => v >= c).length;
const pct = v => (v === null || v === '' || v === undefined) ? '–' : Math.round(v) + '%';

function depHtml(p, kind) {
  const line = (k, text) => `<p${k === kind ? ' class="hl"' : ''}>${text}</p>`;
  return `<div class="tip"><strong>${esc(p.name)}</strong>
    ${line('imd', `Overall deprivation: decile <strong>${p.imd || '–'}</strong> of 10`)}
    ${line('income', `Income-deprived people: <strong>${pct(p.incomePct)}</strong> <span>(decile ${p.income || '–'}; England typical ${TYPICAL.incomePct}%)</span>`)}
    ${line('idaci', `Children in low-income families: <strong>${pct(p.idaciPct)}</strong> <span>(decile ${p.idaci || '–'}; typical ${TYPICAL.idaciPct}%)</span>`)}
    <span>Decile 1 = most deprived 10% in England, 10 = least. IoD 2025.</span></div>`;
}

function socialHtml(p) {
  return `<div class="tip"><strong>${pct(p.social)} social rented</strong> <span>(council ${pct(p.council)}, housing association ${pct(p.ha)})</span>
    <p>Private rented ${pct(p.private)} · owned ${pct(p.owned)} · ${fmt(p.hh)} households</p>
    <span>Census 2021, one Output Area. London 23%, England 17%.</span></div>`;
}

export function createHood(map) {
  const els = {
    dep: document.getElementById('showdep'), social: document.getElementById('showsocial'), noise: document.getElementById('shownoise'),
  };
  const legends = { dep: document.getElementById('dep-legend'), social: document.getElementById('social-legend'), noise: document.getElementById('noise-legend') };
  const depSeg = document.querySelectorAll('#depseg button');
  let dep = null, tenure = null;

  async function apply() {
    for (const k in els) legends[k].hidden = !state[k];
    depSeg.forEach(b => b.setAttribute('aria-pressed', String(b.dataset.k === state.depKind)));
    map.setNoise(state.noise);
    try {
      if (state.dep) {
        dep ||= await loadDeprivation();
        const f = DEP_KINDS[state.depKind].field;
        map.setShade({ geo: { type: 'FeatureCollection', features: dep.map(x => ({ ...x, properties: { ...x.properties, b: decBand(+x.properties[f]) } })) },
          html: p => depHtml(p, state.depKind) });
      } else if (state.social) {
        tenure ||= await loadTenure();
        map.setShade({ geo: { type: 'FeatureCollection', features: tenure.features.map(x => ({ ...x, properties: { ...x.properties, b: socialBand(x.properties.social) } })) },
          html: socialHtml });
      } else map.setShade(null);
    } catch (err) {
      console.error(err); state.dep = state.social = false; els.dep.checked = els.social.checked = false; map.setShade(null);
    }
  }

  for (const k in els) {
    els[k].checked = state[k];
    els[k].addEventListener('change', () => {
      state[k] = els[k].checked;
      if (state[k]) document.dispatchEvent(new CustomEvent('nbhd-layer', { detail: k }));
      saveState(); apply();
    });
  }
  depSeg.forEach(b => {
    b.title = DEP_KINDS[b.dataset.k].title;
    b.addEventListener('click', () => { state.depKind = b.dataset.k; saveState(); apply(); });
  });
  document.addEventListener('nbhd-layer', e => {
    let changed = false;
    for (const k in els) if (e.detail !== k && state[k]) { state[k] = false; els[k].checked = false; changed = true; }
    if (changed) { saveState(); apply(); }
  });
  // Only one of them from a saved state.
  const on = Object.keys(els).find(k => state[k]);
  if (on) { for (const k in els) if (k !== on) { state[k] = false; els[k].checked = false; } document.dispatchEvent(new CustomEvent('nbhd-layer', { detail: on })); }
  apply();
}
