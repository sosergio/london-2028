// Side panel: filters, area cards, school list and notes. No map library code here;
// the map is driven through the small API returned by createMap().

import { state, poiOn, saveState, savePoi, isVisible } from './state.js';
import { ETH_KEYS, loadPrices, PRICE_BANDS } from './data.js';
import { fmt, esc, css, ofKey, ofVar, phaseName, faithName, rightmoveUrl, commuteUrl, POI_VAR, poiSvg, money } from './format.js';

const ETH = { whiteBritish: ['White British', '#7f9c8f'], whiteOther: ['Other White', '#b9cbbf'], asian: ['Asian', '#d6a84a'],
  black: ['Black', '#8a6bb8'], mixed: ['Mixed', '#e08aa0'], other: ['Other', '#9aa3a0'] };

const onActivate = (el, fn) => {
  el.addEventListener('click', fn);
  el.addEventListener('keydown', e => { if (e.target === el && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); fn(e); } });
};

export function createPanel(DATA, map) {
  const { areas, schools, shops, areaById } = DATA;
  const maxDens = Math.max(...areas.map(a => a.dens));
  const maxCrime = Math.max(...areas.map(a => a.crimeTotal));
  const maxLevel = Math.max(...areas.map(a => +a.priceLevel || 0));
  const shopsByArea = {}; shops.forEach(p => (shopsByArea[p.a] ||= []).push(p));

  function shopCounts(id) {
    const ps = shopsByArea[id] || [];
    const c = g => ps.filter(p => p.g === g).length;
    return ps.length ? `${c('up')} upmarket grocers · ${c('bake')} bakeries/delis/butchers · ${c('cult')} cinemas/theatres/bookshops`
      : 'Shops not loaded yet for this area';
  }

  function statsHtml(a) {
    const eb = ETH_KEYS.map(k => `<i style="width:${a.eth[k]}%;background:${ETH[k][1]}" title="${ETH[k][0]} ${a.eth[k]}%"></i>`).join('');
    return `<div class="stats">
      <div class="stat-row"><span>Residents</span><div class="amen">${fmt(a.pop)} in ${esc(a.msoas)} (Census 2021)</div><b></b></div>
      <div class="stat-row"><span>Density</span><div class="bar" title="People per km²"><i style="width:${(a.dens / maxDens * 100).toFixed(0)}%;background:var(--accent)"></i></div><b>${fmt(a.dens)}/km²</b></div>
      <div class="amen">People per km²: ${fmt(a.densMin)}–${fmt(a.densMax)} across these neighbourhoods; London average 5,598</div>
      <div class="stat-row"><span>Ethnicity</span><div class="bar" aria-label="Ethnic groups">${eb}</div><b>${a.eth.whiteBritish}% WB</b></div>
      <div class="stat-row"><span>Crime, 12 mo</span><div class="bar"><i style="width:${(a.crimeTotal / maxCrime * 100).toFixed(0)}%;background:var(--of-w)"></i></div><b>${fmt(a.crimeTotal)}</b></div>
      <div class="amen">Within 1 mile of the centre: ${fmt(a.crime['violent-crime'])} violent, ${fmt(a.crime.burglary)} burglaries, ${fmt(a.crime.robbery)} robberies (Oct 2025–Sep 2026)</div>
      <div class="amen">${shopCounts(a.id)}</div>
      ${a.priceLevel ? `<div class="stat-row"><span>Price level</span><div class="bar" title="100 = typical for the shortlist"><i style="width:${(a.priceLevel / maxLevel * 100).toFixed(0)}%;background:var(--price-4)"></i></div><b>${a.priceLevel}</b></div>
      <div class="amen">Median sold, ${esc(a.pricePeriod)}: flat ${money(a.price.flat)} · terraced ${money(a.price.terraced)} · semi ${money(a.price.semi)} (${fmt(a.priceSales)} sales; 100 = typical for the shortlist)</div>` : ''}
    </div>`;
  }

  // ---------- area cards ----------
  const areasEl = document.getElementById('areas');
  areas.forEach(a => {
    const el = document.createElement('div');
    el.className = 'area'; el.dataset.id = a.id; el.tabIndex = 0; el.setAttribute('role', 'button');
    el.innerHTML = `<div class="area-head"><span class="rank">${a.rank}</span><div><div class="area-name">${esc(a.name)}</div><div class="area-sub">${esc(a.sub)}</div></div></div>
      <p class="why">${esc(a.why)}</p>
      <div class="facts"><div><span>Rent, 3-bed</span><b>${esc(a.rent)}</b></div><div><span>To Moorgate</span><b>${esc(a.commute)}</b></div><div><span>To family</span><b>${esc(a.family)}</b></div>
      <div><span>Lifestyle</span><b>${esc(a.life)}</b></div><div><span>Green</span><b>${esc(a.green)}</b></div><div></div></div>
      ${statsHtml(a)}
      <div class="links"><a class="rm" href="${esc(rightmoveUrl(a))}" target="_blank" rel="noopener">Rightmove map: houses to rent ↗</a>
      <a class="rm" href="${esc(commuteUrl(a.ll))}" target="_blank" rel="noopener">Commute from here ↗</a></div>`;
    onActivate(el, e => {
      if (e.target.closest('a')) return;
      state.area = state.area === a.id ? null : a.id;
      render();
      if (state.area) map.selectArea(a.id); else map.fitAll();
    });
    areasEl.appendChild(el);
  });
  document.getElementById('excluded').textContent = DATA.excluded.join(', ');

  // ---------- filters ----------
  document.querySelectorAll('.seg[data-key]').forEach(group => {
    const key = group.dataset.key;
    group.querySelectorAll('button').forEach(b => {
      b.setAttribute('aria-pressed', String(b.dataset.v === state[key]));
      b.addEventListener('click', () => {
        state[key] = b.dataset.v;
        group.querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
        render();
      });
    });
  });
  // Ofsted: independent on/off toggles, so you can show only the good schools or only the weak ones.
  document.querySelectorAll('#ofseg button').forEach(b => {
    b.setAttribute('aria-pressed', String(!!state.of[b.dataset.o]));
    b.addEventListener('click', () => {
      state.of[b.dataset.o] = !state.of[b.dataset.o];
      b.setAttribute('aria-pressed', String(state.of[b.dataset.o]));
      render();
    });
  });
  // Sold prices: data loads on first use, then stays in memory.
  const priceEl = document.getElementById('showprice'), legendEl = document.getElementById('price-legend');
  document.getElementById('price-ticks').innerHTML = ['<' + PRICE_BANDS[0], ...PRICE_BANDS.slice(0, -1).map((b, i) => `${b}–${PRICE_BANDS[i + 1]}`), PRICE_BANDS.at(-1) + '+']
    .map(t => `<span>${t}</span>`).join('');
  let prices = null;
  async function applyPrices() {
    legendEl.hidden = !state.price;
    if (state.price && !prices) {
      priceEl.disabled = true;
      try { prices = await loadPrices(); } catch (err) { console.error(err); state.price = false; priceEl.checked = false; legendEl.hidden = true; }
      priceEl.disabled = false;
    }
    map.setPrices(state.price ? prices : null);
  }
  priceEl.checked = state.price;
  priceEl.addEventListener('change', () => { state.price = priceEl.checked; saveState(); applyPrices(); });
  if (state.price) applyPrices();

  const catEl = document.getElementById('showcat');
  catEl.checked = state.cat;
  catEl.addEventListener('change', () => { state.cat = catEl.checked; render(); });

  // Shop toggles: independent on/off buttons, not radio buttons. Icons match the map.
  const paintIcons = () => document.querySelectorAll('.ico[data-g]').forEach(i => {
    i.style.background = `var(${POI_VAR[i.dataset.g]})`; i.innerHTML = poiSvg(i.dataset.g, css('--panel'));
  });
  paintIcons();
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', paintIcons);
  // The floating filters start folded on phones, where they would cover most of the map.
  if (matchMedia('(max-width: 820px)').matches) document.getElementById('filters').open = false;
  document.querySelectorAll('#poiseg button').forEach(b => {
    b.setAttribute('aria-pressed', String(!!poiOn[b.dataset.c]));
    b.addEventListener('click', () => {
      poiOn[b.dataset.c] = !poiOn[b.dataset.c];
      b.setAttribute('aria-pressed', String(poiOn[b.dataset.c]));
      savePoi(); map.setPoi(poiOn);
    });
  });

  // ---------- school list + map ----------
  const listEl = document.getElementById('list');
  function render() {
    const shown = schools.filter(isVisible).sort((x, y) => x.pu - y.pu);
    map.render(shown, { area: state.area, cat: state.cat });

    document.getElementById('list-title').textContent =
      (state.area ? areaById[state.area].name + ': ' : '') + shown.length + ' schools shown, smallest first';
    listEl.innerHTML = shown.length ? '' : '<p class="empty">No school matches these filters. Turn on more Ofsted ratings or pick "All".</p>';
    shown.forEach(s => {
      const r = document.createElement('div');
      r.className = 'row'; r.tabIndex = 0; r.setAttribute('role', 'button');
      r.innerHTML = `<i class="dot" style="background:var(${ofVar(s.ok)})"></i><div>${esc(s.n)}<small>${s.p === 'A' ? 'All-through 4–16' : phaseName(s.p)} · ${esc(faithName(s.f))} · ${esc(areaById[s.a].name)}${s.cat ? ` · catchment ${s.cat.toFixed(2)} mi` : ''}</small></div><span class="of of-${ofKey(s.of)}">${esc(s.of)}</span><span class="pu">${fmt(s.pu)}</span>`;
      onActivate(r, () => map.focusSchool(s));
      listEl.appendChild(r);
    });
    document.querySelectorAll('.area').forEach(b => b.setAttribute('aria-current', String(b.dataset.id === state.area)));
    saveState();
  }

  map.setPoi(poiOn);
  render();
  return { render };
}
