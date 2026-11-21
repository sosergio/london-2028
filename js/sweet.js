// "Sweet spots": neighbourhoods that are at once affordable, safe and close to good schools, and
// optionally below a limit for child poverty, social housing and free school meals.
// Each test has a slider; the map shades the neighbourhoods that pass all of them, and hovering
// any neighbourhood shows which tests it passes or misses. A slider at its top end ("Any") is no limit.

import { state, saveState } from './state.js';
import { subareaShapes, loadDeprivation, loadTenure } from './data.js';
import { esc, fmt, fsmText, FSM_ENGLAND } from './format.js';

// Optional tests start at "Any" (their max), so they change nothing until moved.
const ANY = { kids: 70, social: 70, fsm: 60 };
export const SWEET_DEFAULT = { price: 100, crime: 75, pri: 0.6, sec: 1.5, faith: true, ...ANY };
const lim = (k, f) => v => +v >= ANY[k] ? 'Any' : f(v);
const SLIDERS = [
  { key: 'price', label: 'Price level up to', min: 60, max: 160, step: 5, show: v => `${v}`, note: '100 = typical for the shortlist' },
  { key: 'crime', label: 'Crime up to', min: 20, max: 200, step: 5, show: v => `${v}`, note: 'a year per 1,000 residents, no shoplifting; typical {typ}' },
  { key: 'pri', label: 'Good primary within', min: 0.2, max: 2, step: 0.1, show: v => `${(+v).toFixed(1)} km` },
  { key: 'sec', label: 'Good secondary within', min: 0.5, max: 4, step: 0.25, show: v => `${(+v).toFixed(2).replace(/0$/, '')} km` },
  { key: 'fsm', label: 'Those schools: free meals under', min: 10, max: ANY.fsm, step: 5, show: lim('fsm', v => `${v}%`), note: `share of pupils; England ${FSM_ENGLAND}%. Applies to the two school tests` },
  { key: 'kids', label: 'Child poverty up to', min: 10, max: ANY.kids, step: 5, show: lim('kids', v => `${v}%`), note: 'children in low-income families, IoD 2025; England typical 30%' },
  { key: 'social', label: 'Social housing up to', min: 5, max: ANY.social, step: 5, show: lim('social', v => `${v}%`), note: 'households social rented, Census 2021; London 23%' },
];
const OFSTED = { O: 'Outstanding', G: 'Good' };

const km = (a, b) => {
  const p = Math.PI / 180;
  const h = Math.sin((b[0] - a[0]) * p / 2) ** 2 + Math.cos(a[0] * p) * Math.cos(b[0] * p) * Math.sin((b[1] - a[1]) * p / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
};

export function createSweet(DATA, map, { onPickArea }) {
  const { crimeSubs, schools, areaById } = DATA;
  const section = document.getElementById('sweet-sec');
  if (!crimeSubs) { section.hidden = true; document.getElementById('open-sweet').hidden = true; return; }
  const sw = document.getElementById('showsweet'), body = document.getElementById('sweet-body');
  const faithEl = document.getElementById('sweet-faith'), resultEl = document.getElementById('sweet-result');
  const crit = { ...SWEET_DEFAULT, ...(state.sweetCrit || {}) };
  const isAny = k => +crit[k] >= ANY[k];

  // ---------- controls ----------
  document.getElementById('sweet-sliders').innerHTML = SLIDERS.map(s => `
    <label class="slider"><span class="slider-head"><span>${s.label}</span><b id="sweet-v-${s.key}"></b></span>
      <input type="range" data-k="${s.key}" min="${s.min}" max="${s.max}" step="${s.step}" value="${crit[s.key]}" aria-label="${s.label}">
      ${s.note ? `<span class="hint">${s.note.replace('{typ}', Math.round(crimeSubs.typical.all))}</span>` : ''}</label>`).join('');
  const sliders = [...document.querySelectorAll('#sweet-sliders input')];
  const showValues = () => SLIDERS.forEach(s => { document.getElementById('sweet-v-' + s.key).textContent = s.show(crit[s.key]); });
  faithEl.checked = crit.faith;

  // ---------- data: each neighbourhood's nearest Good or Outstanding primary and secondary ----------
  let base = null, social = null;
  async function build() {
    const [geo, dep] = await Promise.all([subareaShapes(), loadDeprivation()]);
    const kids = Object.fromEntries(dep.map(f => [f.properties.id, f.properties.idaciPct]));
    const byId = Object.fromEntries(crimeSubs.rows.map(r => [r.id, r]));
    const good = schools.filter(s => s.ok === 'O' || s.ok === 'G');
    // Good schools of a phase by distance (the sliders go up to 4 km), so the faith and free-meals
    // options just pick the first one that qualifies.
    const byDist = (ll, phase) => good.filter(s => s.p === phase || s.p === 'A')
      .map(s => ({ s, d: km(ll, s.ll) })).filter(x => x.d <= 4.5).sort((a, b) => a.d - b.d);
    base = geo.features.filter(f => byId[f.properties.id]).map(f => {
      const r = byId[f.properties.id], ring = f.geometry.coordinates[0];
      const ll = [ring.reduce((a, p) => a + p[1], 0) / ring.length, ring.reduce((a, p) => a + p[0], 0) / ring.length];
      const k = kids[r.id];
      return { f, r, kids: k === '' || k === undefined ? null : +k, near: { P: byDist(ll, 'P'), S: byDist(ll, 'S') } };
    });
  }
  // Social housing share per neighbourhood, from its Output Areas (households-weighted). 2 MB, so only
  // loaded once that slider is moved off "Any".
  async function loadSocial() {
    const t = await loadTenure(), hh = {}, sr = {};
    for (const { properties: p } of t.features) { hh[p.sub] = (hh[p.sub] || 0) + p.hh; sr[p.sub] = (sr[p.sub] || 0) + p.hh * p.social / 100; }
    social = Object.fromEntries(Object.keys(hh).map(k => [k, 100 * sr[k] / hh[k]]));
  }

  function evaluate() {
    const fsmOk = s => isAny('fsm') || (s.fsm !== null && s.fsm !== undefined && s.fsm < crit.fsm);
    const pick = list => list.find(({ s }) => (crit.faith || s.f === 'None') && fsmOk(s)) || null;
    return base.map(({ f, r, kids, near }) => {
      const p = pick(near.P), s = pick(near.S), soc = social ? social[r.id] ?? null : null;
      const ok = { price: r.level !== null && r.level <= crit.price, crime: r.rate.all <= crit.crime,
        pri: !!p && p.d <= crit.pri, sec: !!s && s.d <= crit.sec,
        kids: isAny('kids') || (kids !== null && kids <= crit.kids),
        social: isAny('social') || (soc !== null && soc <= crit.social) };
      const sch = (x, k) => x ? { [k + 'n']: x.s.short, [k + 'o']: x.s.ok, [k + 'u']: x.s.pu, [k + 'd']: x.d, [k + 'f']: x.s.fsm } : {};
      return { type: 'Feature', geometry: f.geometry, properties: { id: r.id, area: r.area_id, name: r.name,
        level: r.level, crime: r.rate.all, kids, social: soc, ...sch(p, 'p'), ...sch(s, 's'),
        okPrice: ok.price, okCrime: ok.crime, okPri: ok.pri, okSec: ok.sec, okKids: ok.kids, okSocial: ok.social,
        pass: Object.values(ok).every(Boolean) } };
    });
  }

  // Hover / click text: one line per test, ticked or crossed (not colour alone).
  function html(p) {
    const line = (ok, text, lim) => `<li class="${ok ? 'y' : 'n'}"><span aria-hidden="true">${ok ? '✓' : '✗'}</span> ${text} <span class="muted">(${lim})</span></li>`;
    const meals = k => p[k + 'f'] === null || p[k + 'f'] === undefined ? '' : `, ${fsmText(+p[k + 'f'])} free meals`;
    const school = (k, what) => p[k + 'n'] ? `${what}: ${esc(p[k + 'n'])}, ${OFSTED[p[k + 'o']]}, ${fmt(p[k + 'u'])} pupils${meals(k)}, ${(+p[k + 'd']).toFixed(1)} km` : `No Good ${what.toLowerCase()} on the shortlist${isAny('fsm') ? '' : ' under the free-meals limit'}`;
    const pctOf = v => v === null || v === undefined ? '–' : Math.round(v) + '%';
    const opt = (k, okKey, text) => isAny(k) ? '' : line(p[okKey], text, `up to ${crit[k]}%`);
    return `<div class="pop"><h3>${esc(p.name)}</h3><p>${p.pass ? '<b>Sweet spot</b>: passes every test' : 'Misses at least one test'} <span class="muted">· ${esc(areaById[p.area]?.name || '')}</span></p>
      <ul class="checks">
        ${line(p.okPrice, p.level === null || p.level === undefined || p.level === '' ? 'Too few sales for a price level' : `Price level ${p.level}`, `up to ${crit.price}`)}
        ${line(p.okCrime, `Crime ${Math.round(p.crime)} per 1,000`, `up to ${crit.crime}`)}
        ${line(p.okPri, school('p', 'Primary'), `within ${(+crit.pri).toFixed(1)} km`)}
        ${line(p.okSec, school('s', 'Secondary'), `within ${SLIDERS[3].show(crit.sec)}${isAny('fsm') ? '' : `, free meals under ${crit.fsm}%`}`)}
        ${opt('kids', 'okKids', `Child poverty ${pctOf(p.kids)}`)}
        ${opt('social', 'okSocial', `Social housing ${pctOf(p.social)}`)}
      </ul><p class="meta">Distances are straight lines from the middle of the neighbourhood, not catchments.</p></div>`;
  }

  function summary(features) {
    const pass = features.filter(f => f.properties.pass);
    const by = {}; pass.forEach(f => by[f.properties.area] = (by[f.properties.area] || 0) + 1);
    const list = Object.entries(by).sort((a, b) => b[1] - a[1] || areaById[a[0]].rank - areaById[b[0]].rank)
      .map(([id, n]) => `<button type="button" class="linkbtn" data-area="${id}">${esc(areaById[id].name)} (${n})</button>`).join(' · ');
    resultEl.innerHTML = pass.length
      ? `<b>${pass.length}</b> of ${features.length} neighbourhoods pass, in: ${list}`
      : `No neighbourhood passes every test. Loosen a slider.`;
  }

  async function apply() {
    body.hidden = !state.sweet;
    showValues();
    if (!state.sweet) { map.setSweet(null); return; }
    const needSocial = !isAny('social') && !social;
    if (!base || needSocial) {
      sw.disabled = true;
      try { if (!base) await build(); if (needSocial) await loadSocial(); } catch (err) { console.error(err); state.sweet = false; sw.checked = false; body.hidden = true; }
      sw.disabled = false;
      if (!base || !state.sweet) return;
    }
    const features = evaluate();
    summary(features);
    map.setSweet({ features, html });
  }
  const save = () => { state.sweetCrit = { ...crit }; saveState(); };

  sliders.forEach(el => el.addEventListener('input', () => {
    crit[el.dataset.k] = +el.value; showValues();
    if (!base || !state.sweet) return;
    if (!isAny('social') && !social) { apply(); return; }
    const f = evaluate(); summary(f); map.setSweet({ features: f, html });
  }));
  sliders.forEach(el => el.addEventListener('change', save));
  faithEl.addEventListener('change', () => { crit.faith = faithEl.checked; save(); apply(); });
  document.getElementById('sweet-reset').addEventListener('click', () => {
    Object.assign(crit, SWEET_DEFAULT);
    sliders.forEach(el => { el.value = crit[el.dataset.k]; }); faithEl.checked = crit.faith;
    save(); apply();
  });
  resultEl.addEventListener('click', e => { const b = e.target.closest('[data-area]'); if (b) onPickArea(b.dataset.area); });

  // Prices, crime and sweet spots all shade the neighbourhoods: only one at a time.
  sw.checked = state.sweet;
  sw.addEventListener('change', () => {
    state.sweet = sw.checked; saveState();
    if (state.sweet) document.dispatchEvent(new CustomEvent('nbhd-layer', { detail: 'sweet' }));
    apply();
  });
  document.addEventListener('nbhd-layer', e => {
    if (e.detail !== 'sweet' && state.sweet) { state.sweet = false; sw.checked = false; saveState(); apply(); }
  });
  if (state.sweet) document.dispatchEvent(new CustomEvent('nbhd-layer', { detail: 'sweet' }));
  apply();

  // Header shortcut: open the filter box at this section with the layer on, and show every area.
  document.getElementById('open-sweet').addEventListener('click', () => {
    document.getElementById('filters').open = true;
    if (!state.sweet) { sw.checked = true; sw.dispatchEvent(new Event('change')); }
    map.fitAll();
    section.scrollIntoView({ block: 'start', behavior: 'smooth' });
  });
}
