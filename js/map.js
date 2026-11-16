// Everything map-specific: MapLibre GL on OpenFreeMap vector tiles (free, no API key).
//
// Layer order, bottom to top:
//   basemap fills and roads
//   → neighbourhood shading (prices, crime, sweet spots), conservation areas, boroughs, Tube lines, ward fills/outlines, catchments   (inserted before the basemap's first label layer)
//   → basemap labels: street, place and station names        (so names stay readable over shaded areas)
//   → stations, schools, shops, then our own text labels
//
// The panel talks to this module only through the object returned by createMap().

import { css, ofVar, POI_VAR, poiSvg, schoolPopup, shopPopup, shopTip, subareaHtml, saleHtml, crimeSubHtml, crimePointHtml, consHtml, consLine, rightmoveAreaUrl } from './format.js';

const STYLES = {
  light: 'https://tiles.openfreemap.org/styles/positron',
  dark: 'https://tiles.openfreemap.org/styles/dark',
};
const MILE = 1609.344;
const LABEL_ZOOM = 11.5;
const FONT = ['Noto Sans Regular'];
const FONT_BOLD = ['Noto Sans Bold'];

const isDark = () => document.documentElement.dataset.theme === 'dark'
  || (document.documentElement.dataset.theme !== 'light' && matchMedia('(prefers-color-scheme: dark)').matches);
const radiusFor = pu => 4 + Math.sqrt(pu) / 3.2;
const lngLat = ([lat, lon]) => [lon, lat];
const fc = features => ({ type: 'FeatureCollection', features });
const point = (ll, properties) => ({ type: 'Feature', properties, geometry: { type: 'Point', coordinates: lngLat(ll) } });

// A circle of `metres` around [lat, lon], as a closed ring of [lon, lat] points.
function circleRing([lat, lon], metres, steps = 72) {
  const dLat = metres / 111320, dLon = metres / (111320 * Math.cos(lat * Math.PI / 180));
  const ring = [];
  for (let k = 0; k <= steps; k++) { const t = 2 * Math.PI * k / steps; ring.push([lon + dLon * Math.cos(t), lat + dLat * Math.sin(t)]); }
  return ring;
}

// Shop icon: the group's glyph on a coloured disc with a thin edge, drawn at 2× for sharp screens.
async function poiImage(g, fill, edge) {
  const px = 2, size = 22 * px, c = document.createElement('canvas');
  c.width = c.height = size;
  const img = new Image();
  img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(poiSvg(g, edge));
  await img.decode();
  const ctx = c.getContext('2d'), h = size / 2;
  ctx.beginPath(); ctx.arc(h, h, 9.5 * px, 0, 2 * Math.PI);
  ctx.fillStyle = fill; ctx.fill(); ctx.lineWidth = 1.5 * px; ctx.strokeStyle = edge; ctx.stroke();
  const gs = 12 * px; ctx.drawImage(img, h - gs / 2, h - gs / 2, gs, gs);
  return { image: ctx.getImageData(0, 0, size, size), opts: { pixelRatio: px } };
}

export function createMap(container, DATA, { onReady, onGuide } = {}) {
  const { schools, shops, areas, areaById, geo } = DATA;
  const map = new maplibregl.Map({
    container, style: isDark() ? STYLES.dark : STYLES.light,
    center: [-0.1, 51.55], zoom: 9,
    minZoom: 8, maxZoom: 19, attributionControl: { compact: true },
  });
  map.addControl(new maplibregl.NavigationControl({ visualizePitch: false }), 'top-left');
  map.addControl(new maplibregl.ScaleControl({ unit: 'imperial' }), 'bottom-left');

  // "Open this view on Rightmove": the part of the map you can see (not the part under the filter box),
  // a touch larger, as a drawn-area search. Links (not buttons) so they can be opened in a new tab or copied.
  const rmBox = document.createElement('div');
  rmBox.className = 'maplibregl-ctrl rm-view';
  rmBox.innerHTML = `<span class="rm-view-label">This view on Rightmove</span>
    <a id="rm-view-rent" target="_blank" rel="noopener">To rent ↗</a><a id="rm-view-sale" target="_blank" rel="noopener">For sale ↗</a>`;
  map.addControl({ onAdd: () => rmBox, onRemove: () => rmBox.remove() }, 'bottom-left');
  const RM_MIN_ZOOM = 10.5;
  function updateRightmove() {
    const w = container.clientWidth, h = container.clientHeight;
    const box = document.getElementById('filters');
    const right = w >= 700 && box?.open ? w - box.offsetWidth - 20 : w;
    // Corners of the visible map, 5% further out on each side.
    const mx = right * 0.05, my = h * 0.05;
    const ring = [[-mx, -my], [right + mx, -my], [right + mx, h + my], [-mx, h + my]].map(p => map.unproject(p).toArray());
    ring.push(ring[0]);
    const ok = map.getZoom() >= RM_MIN_ZOOM;
    rmBox.classList.toggle('off', !ok);
    rmBox.title = ok ? '3+ bedrooms, houses with a garden (rent up to £4,500 a month), inside the area you can see' : 'Zoom in to search this view on Rightmove';
    [['rm-view-rent', true], ['rm-view-sale', false]].forEach(([id, rent]) => {
      const a = rmBox.querySelector('#' + id);
      if (ok) a.href = rightmoveAreaUrl(ring, rent); else a.removeAttribute('href');
    });
  }
  map.on('moveend', updateRightmove);
  map.on('load', updateRightmove);
  document.getElementById('filters')?.addEventListener('toggle', updateRightmove);
  map.touchPitch.disable(); map.dragRotate.disable(); map.touchZoomRotate.disableRotation();

  // What is currently shown; kept so the layers can be rebuilt after a style change.
  let view = { shown: [], area: null, cat: true, poiOn: {}, prices: null, crime: null, sweet: null, lines: true, guides: true };
  let ready = false, styleGen = 0;
  const popup = new maplibregl.Popup({ maxWidth: '290px', focusAfterOpen: false });
  const tip = new maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 10, className: 'hover-tip' });

  // ---------- GeoJSON builders ----------
  // Crime: colour each neighbourhood by the chosen kind of crime; size each street point by its count of it.
  function crimeFeatures() {
    const c = view.crime;
    if (!c) return { subs: fc([]), points: fc([]) };
    return {
      subs: fc(c.data.subareas.map(f => ({ ...f, properties: { ...f.properties, band: f.properties['b_' + c.kind] } }))),
      points: fc(c.data.points.filter(f => f.properties[c.kind] > 0).map(f => ({ ...f, properties: { ...f.properties, c: f.properties[c.kind] } }))),
    };
  }
  function schoolFeatures() {
    return fc(view.shown.map(s => {
      const r = radiusFor(s.pu), w = s.p === 'P' ? 1.5 : 3;
      // Leaflet strokes straddle the edge; MapLibre strokes sit outside it. Shrink by half the stroke to match.
      return point(s.ll, { i: s.i, short: s.short, p: s.p, col: css(ofVar(s.ok)), r: r - w / 2, w, ring: r + 4 - 1, lo: (r + 4) / 11 });
    }));
  }
  function catchmentFeatures() {
    if (!view.cat) return fc([]);
    return fc(view.shown.filter(s => s.cat).map(s => ({
      type: 'Feature', properties: { col: css(ofVar(s.ok)) },
      geometry: { type: 'Polygon', coordinates: [circleRing(s.ll, s.cat * MILE)] },
    })));
  }
  function wardFeatures() {
    const polys = [], names = [], tops = [];
    areas.forEach(a => {
      const sel = view.area === a.id;
      const pts = [];
      (geo.wards[a.id] || []).forEach(([wardName, ring]) => {
        const coords = ring.map(lngLat);
        if (coords.length && (coords[0][0] !== coords.at(-1)[0] || coords[0][1] !== coords.at(-1)[1])) coords.push(coords[0]);
        polys.push({ type: 'Feature', properties: { sel }, geometry: { type: 'Polygon', coordinates: [coords] } });
        pts.push(...ring);
        if (sel) names.push(point([ring.reduce((t, p) => t + p[0], 0) / ring.length, ring.reduce((t, p) => t + p[1], 0) / ring.length], { name: wardName }));
      });
      // Area label at the top-centre of its wards.
      const top = pts.length ? [Math.max(...pts.map(p => p[0])), (Math.min(...pts.map(p => p[1])) + Math.max(...pts.map(p => p[1]))) / 2] : a.ll;
      tops.push(point(top, { label: `${a.rank}. ${a.name}`, sel }));
    });
    return { polys: fc(polys), names: fc(names), tops: fc(tops) };
  }
  // Area-guide highlights: numbered markers for every area that has a guide.
  const guideItems = Object.entries(DATA.guides || {}).flatMap(([area, g]) => g.items.map(it => ({ ...it, area })));
  function guideFeatures() {
    return fc(guideItems.map(it => point([it.lat, it.lon], { area: it.area, id: it.id, n: String(it.n), name: it.name })));
  }
  function shopFeatures() {
    return fc(shops.filter(p => view.poiOn[p.g]).map(p => point(p.ll, { i: p.i, g: p.g })));
  }

  // ---------- sources and layers (run on every style load) ----------
  function addOverlays() {
    const firstLabel = map.getStyle().layers.find(l => l.type === 'symbol')?.id;
    const fg = css('--fg'), panel = css('--panel'), bg = css('--bg'), muted = css('--muted'), accent = css('--accent'), border = css('--border');

    // Make street names a touch stronger than the muted default: they matter when house hunting.
    map.getStyle().layers.forEach(l => {
      if (l.type === 'symbol' && /highway.name|highway_name|road.name|street/.test(l.id)) {
        try { map.setPaintProperty(l.id, 'text-color', fg); map.setPaintProperty(l.id, 'text-halo-color', bg); map.setPaintProperty(l.id, 'text-halo-width', 1.4); } catch (e) {}
      }
    });

    // Icons load asynchronously (SVG → canvas); the shop layer fills in once they are ready.
    const gen = ++styleGen;
    Promise.all(Object.entries(POI_VAR).map(([g, v]) => poiImage(g, css(v), panel).then(d => [g, d]))).then(list => {
      if (gen !== styleGen) return; // the style changed meanwhile
      list.forEach(([g, d]) => { if (map.hasImage('poi-' + g)) map.updateImage('poi-' + g, d.image); else map.addImage('poi-' + g, d.image, d.opts); });
      map.getSource('shops')?.setData(shopFeatures());
    }).catch(err => console.error('shop icons', err));

    const wards = wardFeatures();
    // The Northern line is black: lighten it in dark mode so it stays visible.
    const tube = fc(geo.tubeLines.features.map(f => ({ ...f, properties: { ...f.properties,
      c: isDark() && f.properties.n === 'Northern' ? '#c8ceca' : f.properties.c,
      emph: f.properties.n === 'Northern' || f.properties.n === 'Central' } })));
    const stations = fc(geo.stations.map(([n, lat, lon]) => point([lat, lon], { label: n === 'Moorgate' ? 'Moorgate (office)' : n, big: n === 'Moorgate' })));

    map.addSource('subareas', { type: 'geojson', data: view.prices?.subareas || fc([]) });
    map.addSource('sales', { type: 'geojson', data: view.prices?.sales || fc([]) });
    const crime = crimeFeatures();
    map.addSource('crime-subs', { type: 'geojson', data: crime.subs });
    map.addSource('crime-points', { type: 'geojson', data: crime.points });
    map.addSource('sweet', { type: 'geojson', data: fc(view.sweet?.features || []) });
    map.addSource('cons', { type: 'geojson', data: view.cons || fc([]) });
    map.addSource('boroughs', { type: 'geojson', data: geo.boroughs });
    map.addSource('tube', { type: 'geojson', data: tube });
    map.addSource('wards', { type: 'geojson', data: wards.polys });
    map.addSource('ward-names', { type: 'geojson', data: wards.names });
    map.addSource('area-labels', { type: 'geojson', data: wards.tops });
    map.addSource('catchments', { type: 'geojson', data: catchmentFeatures() });
    map.addSource('stations', { type: 'geojson', data: stations });
    map.addSource('schools', { type: 'geojson', data: schoolFeatures() });
    map.addSource('shops', { type: 'geojson', data: shopFeatures() });
    map.addSource('guide', { type: 'geojson', data: guideFeatures() });

    // Below the basemap labels. Sold-price sub-areas go lowest, so wards and catchments draw over them.
    const ramp = [0, 1, 2, 3, 4, 5].flatMap(b => [b, css('--price-' + b)]);
    map.addLayer({ id: 'price-fill', type: 'fill', source: 'subareas', filter: ['>=', ['get', 'band'], 0],
      paint: { 'fill-color': ['match', ['get', 'band'], ...ramp, 'rgba(0,0,0,0)'],
        'fill-opacity': ['interpolate', ['linear'], ['zoom'], 12, 0.62, 16, 0.32] } }, firstLabel);
    map.addLayer({ id: 'price-line', type: 'line', source: 'subareas',
      paint: { 'line-color': ['case', ['>=', ['get', 'band'], 0], panel, muted], 'line-width': ['case', ['>=', ['get', 'band'], 0], 0.8, 0.6],
        'line-opacity': ['case', ['>=', ['get', 'band'], 0], 0.9, 0.6] } }, firstLabel);
    const cramp = [0, 1, 2, 3, 4, 5].flatMap(b => [b, css('--crime-' + b)]);
    map.addLayer({ id: 'crime-fill', type: 'fill', source: 'crime-subs',
      paint: { 'fill-color': ['match', ['get', 'band'], ...cramp, 'rgba(0,0,0,0)'],
        'fill-opacity': ['interpolate', ['linear'], ['zoom'], 11, 0.55, 13, 0.42, 15, 0.2] } }, firstLabel);
    map.addLayer({ id: 'crime-line', type: 'line', source: 'crime-subs', paint: { 'line-color': panel, 'line-width': 0.8, 'line-opacity': 0.9 } }, firstLabel);
    // Sweet spots: passing neighbourhoods in the accent colour with a firm outline; the rest only a faint wash.
    map.addLayer({ id: 'sweet-fill', type: 'fill', source: 'sweet',
      paint: { 'fill-color': ['case', ['get', 'pass'], accent, muted],
        'fill-opacity': ['interpolate', ['linear'], ['zoom'], 11, ['case', ['get', 'pass'], 0.55, 0.08], 15, ['case', ['get', 'pass'], 0.28, 0.06]] } }, firstLabel);
    map.addLayer({ id: 'sweet-line', type: 'line', source: 'sweet',
      paint: { 'line-color': ['case', ['get', 'pass'], accent, muted], 'line-width': ['case', ['get', 'pass'], 1.6, 0.5],
        'line-opacity': ['case', ['get', 'pass'], 1, 0.5] } }, firstLabel);
    // Conservation areas: an outline that sits on top of whichever neighbourhood shading is on.
    map.addLayer({ id: 'cons-fill', type: 'fill', source: 'cons',
      paint: { 'fill-color': css('--cons-fill'), 'fill-opacity': ['interpolate', ['linear'], ['zoom'], 11, 0.3, 15, 0.14] } }, firstLabel);
    map.addLayer({ id: 'cons-line', type: 'line', source: 'cons', layout: { 'line-join': 'round' },
      paint: { 'line-color': css('--cons'), 'line-width': ['interpolate', ['linear'], ['zoom'], 11, 1, 15, 2.2] } }, firstLabel);
    map.addLayer({ id: 'boroughs', type: 'line', source: 'boroughs', paint: { 'line-color': border, 'line-width': 1, 'line-dasharray': [2, 3] } }, firstLabel);
    map.addLayer({ id: 'tube', type: 'line', source: 'tube', layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: { 'line-color': ['get', 'c'],
        'line-width': ['interpolate', ['linear'], ['zoom'], 9, ['case', ['get', 'emph'], 2.2, 1.4], 14, ['case', ['get', 'emph'], 4, 3]],
        'line-opacity': ['case', ['get', 'emph'], 0.95, 0.8] } }, firstLabel);
    map.addLayer({ id: 'ward-fill', type: 'fill', source: 'wards', paint: { 'fill-color': accent, 'fill-opacity': ['case', ['get', 'sel'], 0.12, 0.05] } }, firstLabel);
    map.addLayer({ id: 'ward-line', type: 'line', source: 'wards', filter: ['!', ['get', 'sel']], paint: { 'line-color': accent, 'line-width': 1.2, 'line-dasharray': [4, 3] } }, firstLabel);
    map.addLayer({ id: 'ward-line-sel', type: 'line', source: 'wards', filter: ['get', 'sel'], paint: { 'line-color': accent, 'line-width': 2.5 } }, firstLabel);
    map.addLayer({ id: 'catchment-fill', type: 'fill', source: 'catchments', paint: { 'fill-color': ['get', 'col'], 'fill-opacity': 0.06 } }, firstLabel);
    map.addLayer({ id: 'catchment-line', type: 'line', source: 'catchments', paint: { 'line-color': ['get', 'col'], 'line-width': 1.5, 'line-dasharray': [3, 3] } }, firstLabel);

    // Above the basemap labels
    map.addLayer({ id: 'stations', type: 'circle', source: 'stations', filter: ['!', ['get', 'big']], minzoom: 10.5,
      paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 10.5, 2, 14, 4], 'circle-color': panel, 'circle-stroke-color': fg, 'circle-stroke-width': 1 } });
    map.addLayer({ id: 'moorgate', type: 'circle', source: 'stations', filter: ['get', 'big'],
      paint: { 'circle-radius': 5, 'circle-color': panel, 'circle-stroke-color': fg, 'circle-stroke-width': 2 } });
    map.addLayer({ id: 'sales', type: 'circle', source: 'sales', minzoom: 14,
      paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 14, 2.5, 17, 5], 'circle-color': ['match', ['get', 'band'], ...ramp, muted],
        'circle-stroke-color': panel, 'circle-stroke-width': 1 } });
    // "On or near" points: area grows with the count, so a busy junction reads bigger than a quiet close.
    map.addLayer({ id: 'crime-points', type: 'circle', source: 'crime-points', minzoom: 14,
      paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 14, ['min', 14, ['+', 2, ['*', 1.1, ['sqrt', ['get', 'c']]]]], 17, ['min', 22, ['+', 3, ['*', 1.8, ['sqrt', ['get', 'c']]]]]],
        'circle-color': css('--crime-4'), 'circle-opacity': 0.75, 'circle-stroke-color': panel, 'circle-stroke-width': 1 } });
    map.addLayer({ id: 'school-ring', type: 'circle', source: 'schools', filter: ['==', ['get', 'p'], 'A'],
      paint: { 'circle-radius': ['get', 'ring'], 'circle-opacity': 0, 'circle-stroke-color': ['get', 'col'], 'circle-stroke-width': 2 } });
    map.addLayer({ id: 'schools', type: 'circle', source: 'schools',
      paint: { 'circle-radius': ['get', 'r'], 'circle-color': ['get', 'col'], 'circle-opacity': ['case', ['==', ['get', 'p'], 'P'], 0.8, 0.18],
        'circle-stroke-color': ['get', 'col'], 'circle-stroke-width': ['get', 'w'] } });
    map.addLayer({ id: 'shops', type: 'symbol', source: 'shops',
      layout: { 'icon-image': ['concat', 'poi-', ['get', 'g']], 'icon-allow-overlap': true, 'icon-ignore-placement': true,
        'icon-size': ['interpolate', ['linear'], ['zoom'], 10, 0.55, 13, 0.8, 15, 1] } });
    map.addLayer({ id: 'guide-dot', type: 'circle', source: 'guide',
      paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 9, 7, 14, 11], 'circle-color': fg, 'circle-stroke-color': panel, 'circle-stroke-width': 2 } });
    map.addLayer({ id: 'guide-num', type: 'symbol', source: 'guide',
      layout: { 'text-field': ['get', 'n'], 'text-font': FONT_BOLD, 'text-size': ['interpolate', ['linear'], ['zoom'], 9, 9, 14, 12], 'text-allow-overlap': true, 'text-ignore-placement': true },
      paint: { 'text-color': panel } });
    map.addLayer({ id: 'guide-label', type: 'symbol', source: 'guide', minzoom: 12.5,
      layout: { 'text-field': ['get', 'name'], 'text-font': FONT_BOLD, 'text-size': 12, 'text-anchor': 'left', 'text-offset': [1.3, 0], 'text-max-width': 12 },
      paint: { 'text-color': fg, 'text-halo-color': bg, 'text-halo-width': 2 } });
    map.addLayer({ id: 'station-labels', type: 'symbol', source: 'stations', filter: ['!', ['get', 'big']], minzoom: 12,
      layout: { 'text-field': ['get', 'label'], 'text-font': FONT_BOLD, 'text-size': 11, 'text-anchor': 'left', 'text-offset': [0.6, 0] },
      paint: { 'text-color': muted, 'text-halo-color': bg, 'text-halo-width': 1.5 } });
    map.addLayer({ id: 'moorgate-label', type: 'symbol', source: 'stations', filter: ['get', 'big'],
      layout: { 'text-field': ['get', 'label'], 'text-font': FONT_BOLD, 'text-size': 12, 'text-anchor': 'left', 'text-offset': [0.8, 0], 'text-allow-overlap': true },
      paint: { 'text-color': fg, 'text-halo-color': bg, 'text-halo-width': 2 } });
    map.addLayer({ id: 'school-labels', type: 'symbol', source: 'schools', minzoom: LABEL_ZOOM,
      layout: { 'text-field': ['get', 'short'], 'text-font': FONT_BOLD, 'text-size': 11, 'text-variable-anchor': ['left'], 'text-radial-offset': ['get', 'lo'],
        'text-allow-overlap': true, 'text-max-width': 14 },
      paint: { 'text-color': fg, 'text-halo-color': panel, 'text-halo-width': 2 } });
    map.addLayer({ id: 'ward-names', type: 'symbol', source: 'ward-names',
      layout: { 'text-field': ['get', 'name'], 'text-font': FONT, 'text-size': 10, 'text-allow-overlap': true },
      paint: { 'text-color': muted, 'text-halo-color': bg, 'text-halo-width': 1.5 } });
    map.addLayer({ id: 'area-labels', type: 'symbol', source: 'area-labels',
      layout: { 'text-field': ['get', 'label'], 'text-font': FONT_BOLD, 'text-size': 13, 'text-anchor': 'bottom', 'text-offset': [0, -0.3], 'text-allow-overlap': true },
      paint: { 'text-color': accent, 'text-halo-color': bg, 'text-halo-width': 2 } });
  }

  // Tube, Overground, DLR and Elizabeth line, with their stations; Moorgate stays visible either way.
  function applyGuides() {
    ['guide-dot', 'guide-num', 'guide-label'].forEach(id => map.getLayer(id) && map.setLayoutProperty(id, 'visibility', view.guides ? 'visible' : 'none'));
  }
  function applyLines() {
    ['tube', 'stations', 'station-labels'].forEach(id => map.getLayer(id) && map.setLayoutProperty(id, 'visibility', view.lines ? 'visible' : 'none'));
  }

  function refresh() {
    if (!ready) return;
    applyLines();
    const wards = wardFeatures();
    map.getSource('wards').setData(wards.polys);
    map.getSource('ward-names').setData(wards.names);
    map.getSource('area-labels').setData(wards.tops);
    map.getSource('catchments').setData(catchmentFeatures());
    map.getSource('schools').setData(schoolFeatures());
    map.getSource('shops').setData(shopFeatures());
    map.getSource('subareas').setData(view.prices?.subareas || fc([]));
    map.getSource('sales').setData(view.prices?.sales || fc([]));
    const crime = crimeFeatures();
    map.getSource('crime-subs').setData(crime.subs);
    map.getSource('crime-points').setData(crime.points);
    map.getSource('sweet').setData(fc(view.sweet?.features || []));
    map.getSource('cons').setData(view.cons || fc([]));
  }

  // OpenFreeMap styles reference a few sprite icons that are not in their sprite sheet; fill them with a blank.
  map.on('styleimagemissing', e => { if (!e.id.startsWith('poi-') && !map.hasImage(e.id)) map.addImage(e.id, { width: 1, height: 1, data: new Uint8Array(4) }); });

  let fitted = false;
  map.on('style.load', () => {
    addOverlays(); applyLines(); applyGuides(); ready = true;
    if (!fitted) { fitted = true; map.fitBounds(boundsOf(schools.map(s => s.ll)), { padding: padding(), duration: 0 }); }
    if (onReady) { onReady(); onReady = null; }
  });

  // ---------- interaction ----------
  const schoolByI = new Map(schools.map(s => [s.i, s]));
  const shopByI = new Map(shops.map(p => [p.i, p]));
  const hitLayers = () => ['guide-dot', 'schools', 'school-ring', 'shops', 'sales', 'crime-points', 'tube', 'price-fill', 'price-line', 'crime-fill', 'crime-line', 'sweet-fill', 'sweet-line', 'cons-fill', 'cons-line']
    .filter(id => map.getLayer(id) && map.getLayoutProperty(id, 'visibility') !== 'none');
  const SCHOOL_LAYERS = new Set(['schools', 'school-ring']);
  // Most specific thing under the pointer: school, then shop, then a single sale, then the sub-area.
  function pick(point) {
    // A few pixels of slack so thin lines and small dots are easy to hit.
    const box = [[point.x - 4, point.y - 4], [point.x + 4, point.y + 4]];
    const hits = map.queryRenderedFeatures(box, { layers: hitLayers() });
    return hits.find(f => f.layer.id === 'guide-dot') || hits.find(f => SCHOOL_LAYERS.has(f.layer.id)) || hits.find(f => f.layer.id === 'shops')
      || hits.find(f => f.layer.id === 'sales') || hits.find(f => f.layer.id === 'crime-points') || hits.find(f => f.layer.id === 'tube')
      || hits.find(f => f.layer.id === 'price-fill' || f.layer.id === 'price-line')
      || hits.find(f => f.layer.id === 'crime-fill' || f.layer.id === 'crime-line')
      || hits.find(f => f.layer.id === 'sweet-fill' || f.layer.id === 'sweet-line')
      || hits.find(f => CONS.has(f.layer.id));
  }
  const CONS = new Set(['cons-fill', 'cons-line']);
  // A neighbourhood tip also says when the pointer is inside a conservation area.
  function consUnder(point) {
    if (!view.cons) return null;
    return map.queryRenderedFeatures([point.x, point.y], { layers: ['cons-fill'] })[0] || null;
  }

  const CRIME_SUB = new Set(['crime-fill', 'crime-line']), SUB = new Set(['price-fill', 'price-line', 'crime-fill', 'crime-line', 'sweet-fill', 'sweet-line']);
  // Popup or hover text for anything that is not a school, shop or guide dot.
  function otherHtml(f, e) {
    const c = view.crime;
    if (f.layer.id === 'sales') return saleHtml(f.properties);
    if (f.layer.id === 'crime-points') return crimePointHtml(f.properties);
    if (CONS.has(f.layer.id)) return consHtml(f.properties);
    if (f.layer.id === 'sweet-fill' || f.layer.id === 'sweet-line') return withCons(view.sweet.html(f.properties), e);
    if (CRIME_SUB.has(f.layer.id)) return withCons(crimeSubHtml(f.properties, c.kind, c.typical[c.kind], c.period), e);
    return withCons(subareaHtml(f.properties), e);
  }
  function withCons(html, e) {
    const ca = e && consUnder(e.point);
    return ca ? html.replace(/<\/div>\s*$/, consLine(ca.properties) + '</div>') : html;
  }
  const pointOf = (f, e) => f.geometry.type === 'Point' ? f.geometry.coordinates : e.lngLat;

  function openSchool(s) { popup.setLngLat(lngLat(s.ll)).setHTML(schoolPopup(s, areaById[s.a])).addTo(map); }

  map.on('click', e => {
    if (!ready) return;
    const f = pick(e.point); if (!f) return;
    tip.remove();
    if (f.layer.id === 'guide-dot') { if (onGuide) onGuide(f.properties.area, f.properties.id); return; }
    if (SCHOOL_LAYERS.has(f.layer.id)) openSchool(schoolByI.get(f.properties.i));
    else if (f.layer.id === 'shops') { const p = shopByI.get(f.properties.i); popup.setLngLat(lngLat(p.ll)).setHTML(shopPopup(p)).addTo(map); }
    else if (f.layer.id === 'tube') return;
    else popup.setLngLat(pointOf(f, e)).setHTML(otherHtml(f, e)).addTo(map);
  });
  map.on('mousemove', e => {
    if (!ready) return;
    const f = pick(e.point);
    const sub = f && (SUB.has(f.layer.id) || CONS.has(f.layer.id));
    map.getCanvas().style.cursor = f && !sub ? 'pointer' : '';
    if (!f || SCHOOL_LAYERS.has(f.layer.id)) { tip.remove(); return; }
    if (f.layer.id === 'guide-dot') { tip.setLngLat(f.geometry.coordinates).setHTML(`<div class="tip">${f.properties.name}<br><span>Highlight · click for the guide</span></div>`).addTo(map); return; }
    if (f.layer.id === 'shops') { const p = shopByI.get(f.properties.i); tip.setLngLat(lngLat(p.ll)).setHTML(shopTip(p)).addTo(map); }
    else if (f.layer.id === 'tube') tip.setLngLat(e.lngLat).setHTML(`<div class="tip"><i class="line-key" style="background:${f.properties.c}"></i>${f.properties.n}</div>`).addTo(map);
    else tip.setLngLat(pointOf(f, e)).setHTML(otherHtml(f, e)).addTo(map);
  });
  map.getCanvas().addEventListener('mouseleave', () => tip.remove());

  // Theme change: swap the basemap style; overlays are rebuilt on style.load with the new colours.
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    ready = false; popup.remove(); tip.remove();
    map.setStyle(isDark() ? STYLES.dark : STYLES.light, { diff: false });
  });

  function boundsOf(lls) {
    const b = new maplibregl.LngLatBounds();
    lls.forEach(ll => b.extend(lngLat(ll)));
    return b;
  }
  // Keep fitted views clear of the floating filter box (top right) when it is open on a wide screen.
  const padding = () => {
    const base = container.clientWidth < 500 ? 24 : 50;
    const box = document.getElementById('filters');
    const wide = container.clientWidth >= 700 && box?.open;
    return { top: base, bottom: base, left: base, right: wide ? box.offsetWidth + 30 : base };
  };

  return {
    render(shown, { area, cat }) { view = { ...view, shown, area, cat }; refresh(); },
    setPoi(poiOn) { view = { ...view, poiOn: { ...poiOn } }; refresh(); },
    setGuides(on) { view = { ...view, guides: on }; if (!on) tip.remove(); if (ready) applyGuides(); },
    // Fly to a guide highlight and label it with a small photo popup.
    showHighlight(area, it) {
      map.flyTo({ center: [it.lon, it.lat], zoom: Math.max(map.getZoom(), 15), duration: 700 });
      popup.setLngLat([it.lon, it.lat]).setHTML(`<div class="pop hl-pop"><img src="${it.photo}" alt="" width="${it.w}" height="${it.h}">
        <h3>${it.n}. ${it.name}</h3><button type="button" class="linkbtn" data-guide="${area}" data-item="${it.id}">Back to the guide</button></div>`).addTo(map);
    },
    setLines(on) { view = { ...view, lines: on }; if (!on) tip.remove(); if (ready) applyLines(); },
    setPrices(prices) { view = { ...view, prices }; if (!prices) tip.remove(); refresh(); },
    // crime: null, or { data: loadCrime() result, kind, typical, period }
    setCrime(crime) { view = { ...view, crime }; tip.remove(); refresh(); },
    // sweet: null, or { features (with properties.pass), html(properties) for hover and click }
    setSweet(sweet) { view = { ...view, sweet }; if (!sweet) tip.remove(); if (ready) map.getSource('sweet').setData(fc(sweet?.features || [])); },
    // cons: null, or the conservation-area FeatureCollection
    setConservation(cons) { view = { ...view, cons }; if (!cons) tip.remove(); if (ready) map.getSource('cons').setData(cons || fc([])); },
    fitAll() { popup.remove(); map.fitBounds(boundsOf(schools.map(s => s.ll)), { padding: padding(), duration: 600 }); },
    selectArea(id) {
      popup.remove();
      const pts = (geo.wards[id] || []).flatMap(w => w[1]);
      if (pts.length) map.fitBounds(boundsOf(pts), { padding: padding(), duration: 600 });
      else map.flyTo({ center: lngLat(areaById[id].ll), zoom: 13.5, duration: 600 });
    },
    focusSchool(s) {
      map.flyTo({ center: lngLat(s.ll), zoom: Math.max(map.getZoom(), 14), duration: 600 });
      openSchool(s);
    },
    resize() { map.resize(); },
  };
}
