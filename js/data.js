// Loads every data file and turns the rows into the shapes the map and panel use.
// Data files are never changed by the page; edit them and reload.

// cache: 'no-cache' revalidates with the server each time, so an edited CSV shows on the next load.
const getJSON = u => fetch(u, { cache: 'no-cache' }).then(r => { if (!r.ok) throw new Error(`${u}: HTTP ${r.status}`); return r.json(); });
const getCSV = u => fetch(u, { cache: 'no-cache' })
  .then(r => { if (!r.ok) throw new Error(`${u}: HTTP ${r.status}`); return r.text(); })
  .then(t => Papa.parse(t, { header: true, dynamicTyping: true, skipEmptyLines: true }).data);

export const ETH_KEYS = ['whiteBritish', 'whiteOther', 'asian', 'black', 'mixed', 'other'];
const CRIME_KEYS = ['anti-social-behaviour', 'burglary', 'robbery', 'vehicle-crime', 'violent-crime', 'shoplifting'];

export async function loadData() {
  const [areasCsv, schoolsCsv, shopsCsv, extra, boroughs, tubeLines, stations, wards] = await Promise.all([
    getCSV('data/areas.csv'), getCSV('data/schools.csv'), getCSV('data/shops.csv'), getJSON('data/excluded.json'),
    getJSON('data/geo/boroughs.json'), getJSON('data/geo/tube-lines.json'), getJSON('data/geo/stations.json'), getJSON('data/geo/wards.json'),
  ]);

  const areas = areasCsv.sort((x, y) => x.rank - y.rank).map(r => {
    const eth = {}; ETH_KEYS.forEach(k => eth[k] = r['pct_' + k]);
    const crime = {}; CRIME_KEYS.forEach(k => crime[k] = r['crime_' + k] || 0);
    return {
      id: r.id, rank: r.rank, name: r.name, sub: r.sub, ll: [r.lat, r.lon],
      rent: String(r.rent), commute: r.commute, family: r.family, life: r.lifestyle, green: r.green,
      rightmoveId: String(r.rightmove_id), why: r.why,
      msoas: r.msoas, pop: r.residents, dens: r.people_per_km2, densMin: r.density_min, densMax: r.density_max,
      eth, crimeTotal: r.crime_total, crime,
      price: { flat: r.price_flat, terraced: r.price_terraced, semi: r.price_semi }, priceLevel: r.price_level,
      priceSales: r.price_sales, pricePeriod: r.price_period || '',
    };
  });

  const schools = schoolsCsv.map((r, i) => ({
    i, a: r.area_id, n: r.name, short: r.short_name || r.name, p: r.phase, f: r.faith, ages: String(r.ages),
    pu: r.pupils, of: r.ofsted, ok: r.ofsted_colour, ofd: r.ofsted_detail || '', ofu: r.ofsted_url || '',
    ll: [r.lat, r.lon], cat: (r.catchment_miles === null || r.catchment_miles === '') ? null : r.catchment_miles,
    catText: r.catchment_text || '', src: r.source_url || '', note: r.note || '',
  }));

  const shops = shopsCsv.map((r, i) => ({ i, a: r.area_id, n: String(r.name), g: r.group, kind: r.type || '', ll: [r.lat, r.lon] }));

  // Area guides: optional, listed in data/guides/index.json ({"guides": {"<area id>": "<path>"}}).
  const guides = {};
  try {
    const idx = await getJSON('data/guides/index.json');
    await Promise.all(Object.entries(idx.guides || {}).map(async ([id, path]) => { guides[id] = await getJSON(path); }));
  } catch (e) { console.warn('No area guides loaded', e); }

  return {
    areas, schools, shops, guides, excluded: extra.excluded,
    areaById: Object.fromEntries(areas.map(a => [a.id, a])),
    geo: { boroughs, tubeLines, stations, wards },
  };
}

// Sold prices: loaded only when the price layer is first switched on (about 2 MB in all).
// Bands must match BANDS in .claude/skills/london-area-data/scripts/price_subareas.py.
export const PRICE_BANDS = [80, 95, 110, 130, 160];
export const priceBand = level => PRICE_BANDS.filter(b => level >= b).length;

export async function loadPrices() {
  const [subCsv, subGeo, salesCsv] = await Promise.all([
    getCSV('data/subareas.csv'), getJSON('data/geo/subareas.json'), getCSV('data/sales.csv'),
  ]);
  const byId = Object.fromEntries(subCsv.map(r => [r.id, r]));
  const subareas = {
    type: 'FeatureCollection',
    features: subGeo.features.filter(f => byId[f.properties.id]).map(f => {
      const r = byId[f.properties.id];
      return { ...f, properties: { id: r.id, area: r.area_id, name: r.name, sales: r.sales, level: r.level ?? null,
        band: r.band === null || r.band === '' ? -1 : r.band, flat: r.median_flat, terraced: r.median_terraced,
        semi: r.median_semi, detached: r.median_detached } };
    }),
  };
  // Each sale is coloured by the same price level, against the shortlist median for its type.
  const med = arr => { const s = [...arr].sort((a, b) => a - b), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
  const types = [...new Set(salesCsv.map(s => s.type))];
  const base = Object.fromEntries(types.map(t => [t, med(salesCsv.filter(s => s.type === t).map(s => s.price))]));
  const sales = {
    type: 'FeatureCollection',
    features: salesCsv.map(s => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [s.lon, s.lat] },
      properties: { price: s.price, type: s.type, date: String(s.date), street: s.street || '', pc: s.postcode,
        band: priceBand(100 * s.price / base[s.type]) } })),
  };
  return { subareas, sales };
}
