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
