// Area guides: a small photographic guide to an area's highlights, opened in a dialog over the map.
// Data: data/guides/<area id>.json (see the london-area-data skill, "Area guides").

import { esc, gmUrl } from './format.js';

export const KIND_LABEL = { park: 'Park', street: 'Beautiful street', history: 'History', walk: 'Walk', leisure: 'Leisure' };

export function createGuide(DATA, { onShow }) {
  const dlg = document.getElementById('guide');
  const body = dlg.querySelector('.guide-body');
  let current = null;

  function open(areaId, itemId) {
    const g = DATA.guides[areaId]; if (!g) return;
    if (current !== areaId) {
      current = areaId;
      dlg.querySelector('#guide-title').textContent = `${g.title}: highlights`;
      body.innerHTML = `<p class="guide-intro">${esc(g.intro)}</p>
        <div class="guide-grid">${g.items.map(it => `
          <article class="hl" id="hl-${esc(it.id)}">
            <figure>
              <img src="${esc(it.photo)}" alt="${esc(it.name)}" width="${it.w}" height="${it.h}" loading="lazy" decoding="async">
              <span class="hl-n" aria-hidden="true">${it.n}</span>
            </figure>
            <div class="hl-text">
              <p class="hl-kind">${KIND_LABEL[it.kind] || esc(it.kind)} · ${it.km} km from the station</p>
              <h3>${esc(it.name)}</h3>
              <p>${esc(it.blurb)}</p>
              <p class="hl-tip">${esc(it.tip)}</p>
              <div class="hl-actions">
                <button type="button" class="linkbtn" data-show="${esc(it.id)}">Show on the map</button>
                <a href="${esc(gmUrl(it.lat + ',' + it.lon))}" target="_blank" rel="noopener">Google Maps ↗</a>
              </div>
              <p class="hl-credit">Photo: <a href="${esc(it.credit.source)}" target="_blank" rel="noopener">${esc(it.credit.author || 'Wikimedia Commons')}</a>,
                ${it.credit.license_url ? `<a href="${esc(it.credit.license_url)}" target="_blank" rel="noopener">${esc(it.credit.license)}</a>` : esc(it.credit.license)}, via Wikimedia Commons</p>
            </div>
          </article>`).join('')}</div>
        <p class="guide-foot">Updated ${esc(g.updated)}. Opening times change: check before you go.</p>`;
    }
    if (!dlg.open) dlg.showModal();
    const target = itemId && body.querySelector(`#hl-${CSS.escape(itemId)}`);
    if (target) { target.scrollIntoView({ block: 'start' }); target.classList.add('flash'); setTimeout(() => target.classList.remove('flash'), 1400); }
    else body.scrollTop = 0;
  }

  dlg.addEventListener('click', e => {
    const b = e.target.closest('button[data-show]');
    if (b) {
      const it = DATA.guides[current].items.find(x => x.id === b.dataset.show);
      dlg.close(); onShow(current, it); return;
    }
    if (e.target === dlg) dlg.close();
  });
  dlg.querySelector('.dlg-close').addEventListener('click', () => dlg.close());
  return { open };
}
