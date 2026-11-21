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

// Rightmove search for an exact area: the same "Draw a search" link Rightmove builds itself,
// USERDEFINEDAREA^{"polylines":"<Google encoded polyline>"}. ring: [[lon, lat], ...], closed.
function encodePolyline(ring) {
  let out = '', pLat = 0, pLon = 0;
  for (const [lon, lat] of ring) {
    const la = Math.round(lat * 1e5), lo = Math.round(lon * 1e5);
    for (let d of [la - pLat, lo - pLon]) {
      d = d < 0 ? ~(d << 1) : d << 1;
      while (d >= 0x20) { out += String.fromCharCode((0x20 | (d & 0x1f)) + 63); d >>= 5; }
      out += String.fromCharCode(d + 63);
    }
    pLat = la; pLon = lo;
  }
  return out;
}
// Same filters as the area links: 3+ bedrooms, houses, garden; rents up to £4,500 a month.
export function rightmoveAreaUrl(ring, rent) {
  const loc = 'USERDEFINEDAREA^' + JSON.stringify({ polylines: encodePolyline(ring) });
  return `https://www.rightmove.co.uk/${rent ? 'property-to-rent' : 'property-for-sale'}/map.html?locationIdentifier=${encodeURIComponent(loc)}`
    + '&minBedrooms=3&propertyTypes=detached%2Csemi-detached%2Cterraced&mustHave=garden&viewType=MAP'
    + (rent ? '&maxPrice=4500&channel=RENT' : '&channel=BUY');
}

const ext = (href, text) => href ? `<a href="${esc(href)}" target="_blank" rel="noopener">${text}</a>` : '';

// Share of pupils eligible for free school meals (low-income families), January 2026 school census.
export const FSM_ENGLAND = 25;
export const fsmText = v => v.toFixed(1).replace(/\.0$/, '') + '%';

// What parents say: Parent View figures (agree + strongly agree) and, where researched, the summary of
// review sites and forums. Small samples are flagged rather than hidden.
export const SENTIMENT = { positive: 'Mostly positive', mixed: 'Mixed', negative: 'Mostly negative', thin: 'Too little to judge' };
const has = v => v !== null && v !== undefined && v !== '';
function viewsHtml(v) {
  if (!v) return '';
  const few = n => +n < 20 ? ', few answers' : '';
  const bits = [];
  if (has(v.pv_recommend)) bits.push(`<strong>${v.pv_recommend}%</strong> would recommend`);
  if (has(v.pv_behave)) bits.push(`behaviour ${v.pv_behave}%`);
  if (has(v.pv_safe)) bits.push(`feel safe ${v.pv_safe}%`);
  if (has(v.pv_bully_ok)) bits.push(`bullying dealt with ${v.pv_bully_ok}% <span class="meta">(${v.pv_bully_n}${few(v.pv_bully_n)})</span>`);
  if (has(v.pv_send_ok)) bits.push(`SEND support ${v.pv_send_ok}% <span class="meta">(${v.pv_send_n}${few(v.pv_send_n)})</span>`);
  const date = has(v.pv_date) ? new Date(v.pv_date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '';
  const pv = has(v.pv_n) && +v.pv_n > 0
    ? `<p><strong>Ofsted Parent View</strong> <span class="meta">(${v.pv_n} answers${few(v.pv_n)}, to ${date})</span>: ${bits.join(' · ')}</p>`
    : '<p><strong>Ofsted Parent View:</strong> <span class="meta">no answers published</span></p>';
  if (!has(v.sentiment)) return pv;
  const src = String(v.sources || '').split(/\s+/).filter(Boolean).map((u, i) => ext(u, String(i + 1))).join(' ');
  const more = [has(v.reviews) && `<p><strong>Reviews:</strong> ${esc(v.reviews)}</p>`, has(v.forums) && `<p><strong>Forums:</strong> ${esc(v.forums)}</p>`,
    has(v.ask) && `<p><strong>Ask at the open evening:</strong> ${esc(v.ask)}</p>`,
    `<p class="meta">Checked ${esc(v.checked)}. Few, self-selected reviews: read as questions, not a verdict.${src ? ' Sources: ' + src : ''}</p>`].filter(Boolean).join('');
  return `<p><strong>Parents say:</strong> ${esc(SENTIMENT[v.sentiment] || v.sentiment)}. ${esc(v.summary)}</p>${pv}
    <details class="views"><summary>Reviews and forums</summary>${more}</details>`;
}

export function schoolPopup(s, area) {
  return `<div class="pop"><h3>${esc(s.n)}</h3>
    <p class="meta">${phaseName(s.p)} · ${esc(faithName(s.f))} · ${esc(s.ages)}</p>
    <p><span class="big">${fmt(s.pu)}</span> pupils${s.note ? ` · ${esc(s.note)}` : ''}</p>
    <p><strong>Ofsted:</strong> <span class="of of-${ofKey(s.of)}">${esc(s.of)}</span> <span class="meta">${esc(s.ofd)}</span>${s.ofu ? ' · ' + ext(s.ofu, 'Report') : ''}</p>
    ${s.fsm === null ? '' : `<p><strong>Free school meals:</strong> ${fsmText(s.fsm)} of pupils <span class="meta">(England ${FSM_ENGLAND}%)</span></p>`}
    ${viewsHtml(s.views)}
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

// ---------- crime ----------
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
// "2025-10:2026-09" → "Oct 2025–Sep 2026"
export const crimePeriod = p => String(p || '').split(':').map(d => { const [y, m] = d.split('-'); return `${MONTHS[+m - 1]} ${y}`; }).join('–');
export const GROUP_LABEL = { asb: 'anti-social', violent: 'violence & robbery', burglary: 'burglary', vehicle: 'vehicle & bike', shoplifting: 'shoplifting', other: 'other' };
export const KIND_SHORT = { all: 'crimes (excl. shoplifting)', violent: 'violent crimes and robberies', burglary: 'burglaries', asb: 'anti-social incidents' };
const groupsLine = p => Object.keys(GROUP_LABEL).filter(g => p[g] > 0).sort((a, b) => p[b] - p[a]).map(g => `${fmt(p[g])} ${GROUP_LABEL[g]}`).join(' · ');
const times = x => x >= 0.9 && x <= 1.1 ? 'about typical for the shortlist'
  : x < 0.9 ? `${Math.round((1 - x) * 100)}% below the shortlist typical` : `${x.toFixed(1)}× the shortlist typical`;

export function crimeSubHtml(p, kind, typical, period) {
  const r = p['r_' + kind];
  const top = String(p.top || '').split('; ').filter(Boolean).slice(0, 3).map(esc).join(', ');
  return `<div class="pop"><h3>${esc(p.name)}</h3>
    <p><b>${Math.round(r)}</b> ${KIND_SHORT[kind]} per 1,000 residents a year <span class="muted">(${times(r / typical)})</span></p>
    <p class="meta">${fmt(p.total)} in 12 months: ${groupsLine(p) || 'none'}</p>
    ${top ? `<p class="meta">Most reported on or near ${top}</p>` : ''}
    <p class="meta">${fmt(p.residents)} residents · police.uk, ${esc(period)}</p></div>`;
}

// New development hover / click text. d: a row of data/developments.csv.
const DEV_NOTE = {
  'Selling': 'new-build sales in the last 6 months', 'Sold': 'new-build sales, none in the last 6 months',
  'Being built': 'started, no sales recorded yet',
  'Finished': 'finished, but no new-build sales found: built to rent, affordable homes, or sales not registered yet',
  'Approved': 'approved, not started',
};
// About 250 m each way around a point, as a closed [lon, lat] ring.
const boxAround = d => { const dy = 0.00225, dx = 0.0036, la = +d.lat, lo = +d.lon;
  return [[lo - dx, la - dy], [lo + dx, la - dy], [lo + dx, la + dy], [lo - dx, la + dy], [lo - dx, la - dy]]; };
// The useful part of a planning description: from "erection of" / "redevelopment" / "construction of" on,
// skipping the legal preamble of variation applications. About 170 characters.
function planSummary(text) {
  const t = String(text || ''); if (!t) return '';
  const m = t.match(/(redevelopment|erection|construction|demolition|conversion|provision)\b.*/i);
  const s = (m ? m[0] : t).replace(/\s+/g, ' ');
  return s.length > 170 ? s.slice(0, 167).replace(/\s\S*$/, '') + '…' : s;
}
const shortDate = s => s ? new Date(s).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' }) : '';
export function devHtml(d) {
  const homes = d.homes ? `${fmt(d.homes)} homes` : '';
  const ten = [d.for_sale && `${fmt(d.for_sale)} for sale`, d.for_rent && `${fmt(d.for_rent)} to rent`,
    d.shared && `${fmt(d.shared)} shared ownership`, d.affordable_rent && `${fmt(d.affordable_rent)} affordable or social rent`].filter(Boolean).join(' · ');
  const sales = d.sold ? `<p><b>${fmt(d.sold)}</b> new-build sale${d.sold === 1 ? '' : 's'}, ${shortDate(d.first_sale)}–${shortDate(d.last_sale)}`
    + (d.price_median ? `: median ${money(d.price_median)} (${money(d.price_min)}–${money(d.price_max)})` : '')
    + (d.sold_shared ? `; ${fmt(d.sold_shared)} under £250k, probably shared-ownership shares` : '')
    + (d.sold_houses ? `; ${fmt(d.sold_houses)} houses` : '') + '</p>' : '';
  const dates = [d.approved && `approved ${shortDate(d.approved)}`, d.started && `started ${shortDate(d.started)}`, d.finished && `finished ${shortDate(d.finished)}`].filter(Boolean).join(' · ');
  const q = encodeURIComponent;
  const planning = d.planning_ref ? (d.planning_url && /^https?:/.test(d.planning_url)
    ? `<a href="${esc(d.planning_url)}" target="_blank" rel="noopener">Planning ${esc(d.planning_ref)}</a>`
    : `<a href="https://www.google.com/search?q=${q(`${d.council} planning ${d.planning_ref}`)}" target="_blank" rel="noopener">Planning ${esc(d.planning_ref)}</a>`) : '';
  const reviews = `<a href="https://www.google.com/search?q=${q(`"${d.buildings.split(';')[0] || d.name}" ${String(d.postcode).split(' ')[0]} HomeViews`)}" target="_blank" rel="noopener">Reviews</a>`;
  return `<div class="pop dev-pop"><h3>${esc(d.name)}</h3>
    <p><span class="dev-key" data-s="${esc(d.status)}" aria-hidden="true"></span><b>${esc(d.status)}</b> <span class="muted">· ${DEV_NOTE[d.status] || ''}</span></p>
    ${homes || ten ? `<p>${homes}${ten ? ` <span class="muted">(${ten})</span>` : ''}</p>` : ''}
    ${d.beds ? `<p class="meta">Planned: ${esc(d.beds)}</p>` : ''}
    ${planSummary(d.description) ? `<p class="meta">Plan: ${esc(planSummary(d.description))}</p>` : ''}
    ${sales}
    ${d.buildings && d.buildings !== d.name ? `<p class="meta">Buildings: ${esc(d.buildings)}</p>` : ''}
    ${d.address && d.address !== d.name ? `<p class="meta">${esc(d.address)}</p>` : ''}
    ${dates ? `<p class="meta">${dates}</p>` : ''}
    <p class="links">${[planning, reviews].filter(Boolean).join(' · ')}</p>
    <p class="links">Rightmove around it: <a href="${esc(rightmoveAreaUrl(boxAround(d), true))}" target="_blank" rel="noopener">to rent</a> ·
      <a href="${esc(rightmoveAreaUrl(boxAround(d), false))}" target="_blank" rel="noopener">for sale</a></p></div>`;
}

// Conservation area hover / click text.
export function consHtml(p) {
  const by = [p.council, p.designated && `designated ${p.designated}`].filter(Boolean).join(', ');
  return `<div class="pop"><h3>${esc(p.name)}</h3><p>Conservation area${by ? ` · ${esc(by)}` : ''}</p>
    ${/^https?:\/\//.test(p.url || '') ? `<p><a href="${esc(p.url)}" target="_blank" rel="noopener">Council appraisal or page</a></p>` : ''}
    <p class="meta">Extensions, lofts, windows, cladding and tree work need more permission here.</p></div>`;
}
// One line for a neighbourhood tip when the pointer is also inside a conservation area.
export const consLine = p => `<p class="meta cons-line"><i class="cons-key" aria-hidden="true"></i>In a conservation area: ${esc(p.name)}</p>`;

export function crimePointHtml(p) {
  return `<div class="pop"><h3>On or near ${esc(p.street)}</h3><p><b>${fmt(p.total)}</b> crime${p.total === 1 ? '' : 's'} in 12 months</p>
    <p class="meta">${groupsLine(p)}</p><p class="meta">police.uk places each crime at the nearest of a fixed set of points, not the exact address.</p></div>`;
}
