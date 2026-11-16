// Side panel: filters, area cards, school list and notes. No map library code here;
// the map is driven through the small API returned by createMap().

import { state, poiOn, saveState, savePoi, isVisible } from './state.js';
import { ETH_KEYS, loadPrices, PRICE_BANDS, loadCrime, CRIME_KINDS } from './data.js';
import { fmt, esc, css, ofKey, ofVar, phaseName, faithName, rightmoveUrl, commuteUrl, POI_VAR, poiSvg, money, crimePeriod } from './format.js';

const ETH = { whiteBritish: ['White British', '#7f9c8f'], whiteOther: ['Other White', '#b9cbbf'], asian: ['Asian', '#d6a84a'],
  black: ['Black', '#8a6bb8'], mixed: ['Mixed', '#e08aa0'], other: ['Other', '#9aa3a0'] };

const onActivate = (el, fn) => {
  el.addEventListener('click', fn);
  el.addEventListener('keydown', e => { if (e.target === el && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); fn(e); } });
};

export function createPanel(DATA, map, { openGuide } = {}) {
  const { areas, schools, shops, areaById } = DATA;
  const maxDens = Math.max(...areas.map(a => a.dens));
  const { crimeSubs } = DATA;
  const maxRate = Math.max(...areas.map(a => +a.crimeRate.all || 0));
  // Each area's quietest and busiest neighbourhoods (with enough residents for a rate to mean something).
  const subsByArea = {}; (crimeSubs?.rows || []).filter(r => r.residents >= 1000).forEach(r => (subsByArea[r.area_id] ||= []).push(r));
  const firstStreet = r => String(r.top).split(' (')[0];
  // The middle of the shortlist for each kind of crime, so a card can say whether its area is high or low.
  const midOf = k => { const v = areas.map(a => +a.crimeRate[k]).filter(x => x > 0).sort((x, y) => x - y), m = v.length >> 1; return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2; };
  const mid = Object.fromEntries(['all', 'violent', 'burglary', 'asb'].map(k => [k, midOf(k)]));
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
      ${crimeHtml(a)}
      <div class="amen">${shopCounts(a.id)}</div>
      ${a.priceLevel ? `<div class="stat-row"><span>Price level</span><div class="bar" title="100 = typical for the shortlist"><i style="width:${(a.priceLevel / maxLevel * 100).toFixed(0)}%;background:var(--price-4)"></i></div><b>${a.priceLevel}</b></div>
      <div class="amen">Median sold, ${esc(a.pricePeriod)}: flat ${money(a.price.flat)} · terraced ${money(a.price.terraced)} · semi ${money(a.price.semi)} (${fmt(a.priceSales)} sales; 100 = typical for the shortlist)</div>` : ''}
    </div>`;
  }

  function crimeHtml(a) {
    const r = a.crimeRate;
    if (!r.all) return `<div class="stat-row"><span>Crime, 12 mo</span><div class="amen">${fmt(a.crimeTotal)} within 1 mile of the centre</div><b></b></div>`;
    const subs = [...(subsByArea[a.id] || [])].sort((x, y) => x.rate.all - y.rate.all);
    const lo = subs[0], hi = subs.at(-1);
    return `<div class="stat-row"><span>Crime</span><div class="bar" title="Crimes a year per 1,000 residents, shoplifting left out"><i style="width:${(r.all / maxRate * 100).toFixed(0)}%;background:var(--crime-3)"></i></div><b>${Math.round(r.all)}/1k</b></div>
      <div class="amen">A year per 1,000 residents, shoplifting left out: ${Math.round(r.all)} in all (middle of the shortlist ${Math.round(mid.all)}) · ${Math.round(r.violent)} violence &amp; robbery (${Math.round(mid.violent)}) · ${r.burglary.toFixed(1)} burglary (${mid.burglary.toFixed(1)}) · ${Math.round(r.asb)} anti-social (${Math.round(mid.asb)})</div>
      ${lo && hi && lo !== hi ? `<div class="amen">Quietest: ${esc(lo.name)} (${Math.round(lo.rate.all)}) · busiest: ${esc(hi.name)} (${Math.round(hi.rate.all)}${hi.top ? `, mostly near ${esc(firstStreet(hi))}` : ''})</div>` : ''}
      <div class="amen muted">${fmt(a.crimeTotal)} crimes within 1 mile of the centre · police.uk, ${esc(crimePeriod(a.crimePeriod))}</div>`;
  }

  // ---------- area cards ----------
  const areasEl = document.getElementById('areas');
  // Cards start collapsed to their title. The name selects the area (zoom + filter, and opens it);
  // the chevron only opens or closes the details, so several areas can be compared side by side.
  const setOpen = (el, open) => {
    el.querySelector('.area-toggle').setAttribute('aria-expanded', String(open));
    el.querySelector('.area-body').hidden = !open;
  };
  areas.forEach(a => {
    const el = document.createElement('div');
    el.className = 'area'; el.dataset.id = a.id;
    el.innerHTML = `<div class="area-head">
        <button type="button" class="area-pick" title="Show on the map"><span class="rank">${a.rank}</span><span><span class="area-name">${esc(a.name)}</span><br><span class="area-sub">${esc(a.sub)}</span></span></button>
        <button type="button" class="area-toggle" aria-expanded="false" aria-controls="area-body-${a.id}" aria-label="Details for ${esc(a.name)}"><span class="chev" aria-hidden="true"></span></button>
      </div>
      <div class="area-body" id="area-body-${a.id}" hidden>
        <p class="why">${esc(a.why)}</p>
        <div class="facts"><div><span>Rent, 3-bed</span><b>${esc(a.rent)}</b></div><div><span>To Moorgate</span><b>${esc(a.commute)}</b></div><div><span>To family</span><b>${esc(a.family)}</b></div>
        <div><span>Lifestyle</span><b>${esc(a.life)}</b></div><div><span>Green</span><b>${esc(a.green)}</b></div><div></div></div>
        ${statsHtml(a)}
        <div class="links"><a class="rm" href="${esc(rightmoveUrl(a))}" target="_blank" rel="noopener">Rightmove map: houses to rent ↗</a>
        <a class="rm" href="${esc(commuteUrl(a.ll))}" target="_blank" rel="noopener">Commute from here ↗</a></div>
        ${DATA.guides?.[a.id] ? `<button type="button" class="guide-btn" data-guide="${a.id}">Area guide: ${DATA.guides[a.id].items.length} highlights, with photos</button>` : ''}
      </div>`;
    el.querySelector('.area-toggle').addEventListener('click', () => {
      setOpen(el, el.querySelector('.area-toggle').getAttribute('aria-expanded') !== 'true'); syncExpandAll();
    });
    el.querySelector('.area-pick').addEventListener('click', () => pickArea(a.id, true));
    el.querySelector('.guide-btn')?.addEventListener('click', () => openGuide?.(a.id));
    areasEl.appendChild(el);
  });
  // Select an area: zoom to it, filter the school list and open its card. With toggle, picking the
  // selected area again clears the selection.
  function pickArea(id, toggle = false) {
    state.area = toggle && state.area === id ? null : id;
    const el = areasEl.querySelector(`.area[data-id="${id}"]`);
    if (state.area) { setOpen(el, true); if (!toggle) el.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }
    syncExpandAll();
    render();
    if (state.area) map.selectArea(id); else map.fitAll();
  }
  const expandAll = document.getElementById('expand-all');
  function syncExpandAll() {
    const all = [...areasEl.querySelectorAll('.area-toggle')].every(b => b.getAttribute('aria-expanded') === 'true');
    expandAll.textContent = all ? 'Collapse all' : 'Expand all';
    expandAll.setAttribute('aria-expanded', String(all));
  }
  expandAll.addEventListener('click', () => {
    const open = expandAll.getAttribute('aria-expanded') !== 'true';
    areasEl.querySelectorAll('.area').forEach(el => setOpen(el, open));
    syncExpandAll();
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
  // Prices and crime both colour the neighbourhoods, so only one is shown at a time.
  priceEl.addEventListener('change', () => {
    state.price = priceEl.checked;
    if (state.price && state.crime) { state.crime = false; crimeEl.checked = false; applyCrime(); }
    saveState(); applyPrices();
  });

  // Crime by neighbourhood: same pattern, with a choice of what kind of crime to show.
  const crimeEl = document.getElementById('showcrime'), crimeLegend = document.getElementById('crime-legend');
  const crimeSeg = document.querySelectorAll('#crimeseg button');
  let crime = null;
  if (!crimeSubs) crimeEl.closest('.fsec').hidden = true;
  else document.getElementById('crime-period').textContent = crimePeriod(areas[0].crimePeriod);
  function crimeLegendText() {
    const k = state.crimeKind, c = crimeSubs.cuts[k], f = v => v < 10 ? v.toFixed(1).replace(/\.0$/, '') : Math.round(v);
    document.getElementById('crime-ticks').innerHTML = ['<' + f(c[0]), ...c.slice(0, -1).map((v, i) => `${f(v)}–${f(c[i + 1])}`), f(c.at(-1)) + '+']
      .map(t => `<span>${t}</span>`).join('');
    document.getElementById('crime-typical').textContent = `typical ${f(crimeSubs.typical[k])}`;
    crimeSeg.forEach(b => b.setAttribute('aria-pressed', String(b.dataset.k === k)));
    crimeEl.closest('.fsec').querySelector('#crimeseg').title = CRIME_KINDS[k];
  }
  async function applyCrime() {
    crimeLegend.hidden = !state.crime;
    if (!crimeSubs) return;
    crimeLegendText();
    if (state.crime && !crime) {
      crimeEl.disabled = true;
      try { crime = await loadCrime(crimeSubs); } catch (err) { console.error(err); state.crime = false; crimeEl.checked = false; crimeLegend.hidden = true; }
      crimeEl.disabled = false;
    }
    map.setCrime(state.crime && crime ? { data: crime, kind: state.crimeKind, typical: crimeSubs.typical, period: crimePeriod(areas[0].crimePeriod) } : null);
  }
  crimeEl.checked = state.crime;
  crimeEl.addEventListener('change', () => {
    state.crime = crimeEl.checked;
    if (state.crime && state.price) { state.price = false; priceEl.checked = false; applyPrices(); }
    saveState(); applyCrime();
  });
  crimeSeg.forEach(b => b.addEventListener('click', () => { state.crimeKind = b.dataset.k; saveState(); applyCrime(); }));
  if (state.price && state.crime) state.crime = false;
  if (state.price) applyPrices();
  if (state.crime) applyCrime(); else if (crimeSubs) crimeLegendText();

  const linesEl = document.getElementById('showlines');
  linesEl.checked = state.lines; map.setLines(state.lines);
  linesEl.addEventListener('change', () => { state.lines = linesEl.checked; saveState(); map.setLines(state.lines); });

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
      savePoi(); applyShops();
    });
  });

  // ---------- group switches ----------
  // Each section of the floating box has a switch: off hides the whole group on the map and folds the
  // section, but keeps the choices inside it for when it is switched back on.
  document.querySelectorAll('.fsec').forEach(sec => {
    const sw = sec.querySelector('.fhead input'), body = sec.querySelector('.fbody');
    const sync = () => { body.hidden = !sw.checked; };
    sw.addEventListener('change', sync);
    sec.syncBody = sync;
  });
  const guidesSw = document.getElementById('sw-guides');
  guidesSw.checked = state.guides; map.setGuides(state.guides);
  guidesSw.addEventListener('change', () => { state.guides = guidesSw.checked; saveState(); map.setGuides(state.guides); });
  document.getElementById('guide-list').innerHTML = Object.entries(DATA.guides || {})
    .map(([id, g]) => `<button type="button" class="linkbtn" data-guide="${id}">${esc(g.title)} (${g.items.length})</button>`).join(' · ') || 'none yet';
  const schoolsSw = document.getElementById('sw-schools'), shopsSw = document.getElementById('sw-shops');
  schoolsSw.checked = state.schools; shopsSw.checked = state.shops;
  schoolsSw.addEventListener('change', () => { state.schools = schoolsSw.checked; render(); });
  const applyShops = () => map.setPoi(state.shops ? poiOn : {});
  shopsSw.addEventListener('change', () => {
    state.shops = shopsSw.checked;
    // Switching the group back on with nothing selected would show nothing: select every kind instead.
    if (state.shops && !Object.values(poiOn).some(Boolean)) {
      Object.keys(poiOn).forEach(k => poiOn[k] = true);
      document.querySelectorAll('#poiseg button').forEach(b => b.setAttribute('aria-pressed', 'true'));
      savePoi();
    }
    saveState(); applyShops();
  });
  document.querySelectorAll('.fsec').forEach(sec => sec.syncBody());

  // ---------- school list + map ----------
  const listEl = document.getElementById('list');
  function render() {
    const shown = schools.filter(isVisible).sort((x, y) => x.pu - y.pu);
    map.render(state.schools ? shown : [], { area: state.area, cat: state.cat });

    document.getElementById('list-title').textContent =
      (state.area ? areaById[state.area].name + ': ' : '') + shown.length + ' schools, smallest first' + (state.schools ? '' : ' (hidden on the map)');
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

  applyShops();
  render();
  return { render, pickArea };
}
