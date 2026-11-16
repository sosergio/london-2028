// Formatting, outbound links and popup HTML. Shared by the map and the panel.

export const fmt = n => Number(n).toLocaleString('en-GB');
export const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const css = name => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

export const phaseName = p => p === 'P' ? 'Primary' : p === 'A' ? 'All-through' : 'Secondary';
export const faithName = f => f === 'None' ? 'No faith' : f;
export const ofKey = o => o === 'Outstanding' || o === 'Exceptional' ? 'o'
  : o === 'Good' || o === 'Expected standard' || o === 'Strong standard' ? 'g' : 'n';
export const ofVar = k => k === 'O' ? '--of-o' : k === 'G' ? '--of-g' : k === 'W' ? '--of-w' : '--of-n';

export const POI_VAR = { up: '--poi-up', bake: '--poi-bake', cult: '--poi-cult', gym: '--poi-gym', disc: '--poi-disc' };
export const POI_LABEL = { up: 'Upmarket grocer', bake: 'Bakery / deli', cult: 'Culture', gym: 'Gym / pool', disc: 'Discount supermarket' };

export const gmUrl = q => 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(q);
export const svUrl = ([lat, lon]) => `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${lat},${lon}`;
export const commuteUrl = ([lat, lon]) =>
  `https://www.google.com/maps/dir/?api=1&origin=${lat},${lon}&destination=${encodeURIComponent('Moorgate Station, London')}&travelmode=transit`;
export const rightmoveUrl = a => 'https://www.rightmove.co.uk/property-to-rent/map.html?locationIdentifier=' + encodeURIComponent(a.rightmoveId)
  + '&minBedrooms=3&maxPrice=4500&propertyTypes=detached%2Csemi-detached%2Cterraced&mustHave=garden&channel=RENT&viewType=MAP';

const ext = (href, text) => href ? `<a href="${esc(href)}" target="_blank" rel="noopener">${text}</a>` : '';

export function schoolPopup(s, area) {
  return `<div class="pop"><h3>${esc(s.n)}</h3>
    <p class="meta">${phaseName(s.p)} · ${esc(faithName(s.f))} · ${esc(s.ages)}</p>
    <p><span class="big">${fmt(s.pu)}</span> pupils${s.note ? ` · ${esc(s.note)}` : ''}</p>
    <p><strong>Ofsted:</strong> <span class="of of-${ofKey(s.of)}">${esc(s.of)}</span> <span class="meta">${esc(s.ofd)}</span>${s.ofu ? ' · ' + ext(s.ofu, 'Report') : ''}</p>
    <p><strong>Catchment:</strong> ${esc(s.catText)}</p>
    <p>${esc(area.name)}${s.src ? ' · ' + ext(s.src, 'Source') : ''}</p>
    <p>${ext(gmUrl(s.n + ', ' + area.sub.split(' · ')[0]), 'Google Maps ↗')} · ${ext(svUrl(s.ll), 'Street View ↗')}</p></div>`;
}

export function shopPopup(p) {
  return `<div class="pop"><h3>${esc(p.n)}</h3>
    <p class="meta">${POI_LABEL[p.g] || esc(p.g)}${p.kind ? ' · ' + esc(p.kind) : ''}</p>
    <p>${ext(gmUrl(p.ll.join(',')), 'Google Maps ↗')} · ${ext(svUrl(p.ll), 'Street View ↗')}</p></div>`;
}

export function shopTip(p) {
  return `<div class="tip">${esc(p.n)}<br><span>${POI_LABEL[p.g] || esc(p.g)}${p.kind ? ' · ' + esc(p.kind) : ''}</span></div>`;
}

// Shop and place icons (24×24 line glyphs, after Lucide, ISC licence). Used on the map and in the toggles.
export const POI_ICON = {
  up: '<path d="m15 11-1 9"/><path d="m19 11-4-7"/><path d="M2 11h20"/><path d="m3.5 11 1.6 7.4a2 2 0 0 0 2 1.6h9.8a2 2 0 0 0 2-1.6l1.7-7.4"/><path d="M4.5 15.5h15"/><path d="m5 11 4-7"/><path d="m9 11 1 9"/>',
  bake: '<path d="M4 11a4 4 0 0 1 2-7h12a4 4 0 0 1 2 7v8a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1z"/><path d="M9 8v4"/><path d="M15 8v4"/>',
  cult: '<path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>',
  gym: '<path d="M14.4 14.4 9.6 9.6"/><path d="M18.657 21.485a2 2 0 1 1-2.829-2.828l-1.767 1.768a2 2 0 1 1-2.829-2.829l6.364-6.364a2 2 0 1 1 2.829 2.829l-1.768 1.767a2 2 0 1 1 2.828 2.829z"/><path d="m21.5 21.5-1.4-1.4"/><path d="M3.9 3.9 2.5 2.5"/><path d="M6.404 12.768a2 2 0 1 1-2.829-2.829l1.768-1.767a2 2 0 1 1-2.828-2.829l2.828-2.828a2 2 0 1 1 2.829 2.828l1.767-1.768a2 2 0 1 1 2.829 2.829z"/>',
  disc: '<path d="M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42z"/><circle cx="7.5" cy="7.5" r="1.2" fill="currentColor"/>',
};
export const poiSvg = (g, colour) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="${colour}" color="${colour}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">${POI_ICON[g]}</svg>`;

// ---------- sold prices ----------
export const money = v => v === null || v === undefined || v === '' ? '–'
  : v >= 995000 ? '£' + (v / 1e6).toFixed(v >= 9.95e6 ? 1 : 2).replace(/\.?0+$/, '') + 'm' : '£' + Math.round(v / 1000) + 'k';
const TYPE_NAME = { flat: 'Flat', terraced: 'Terraced house', semi: 'Semi-detached', detached: 'Detached' };
const levelText = l => l === null || l === undefined || l === '' ? 'too few sales for a price level'
  : `price level <b>${l}</b> <span class="muted">(100 = typical for the shortlist)</span>`;

export function subareaHtml(p) {
  const meds = ['flat', 'terraced', 'semi', 'detached'].filter(k => p[k] !== null && p[k] !== '' && p[k] !== undefined)
    .map(k => `${k === 'semi' ? 'semi' : k} ${money(p[k])}`).join(' · ');
  return `<div class="pop"><h3>${esc(p.name)}</h3><p>${levelText(p.level)}</p>
    <p class="meta">Median sold: ${meds || '–'}</p><p class="meta">${fmt(p.sales)} sales, last 2 years · HM Land Registry</p></div>`;
}

export function saleHtml(p) {
  return `<div class="pop"><h3>${money(p.price)} <span class="muted">· ${TYPE_NAME[p.type] || esc(p.type)}</span></h3>
    <p>${esc(p.street)}${p.street ? ', ' : ''}${esc(p.pc)}</p><p class="meta">Sold ${esc(p.date)} · HM Land Registry</p></div>`;
}
