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
      // Per 1,000 residents a year, over all of the area's neighbourhoods (police.uk street-level crime).
      crimeRate: { all: r.crime_rate, violent: r.crime_rate_violent, burglary: r.crime_rate_burglary, asb: r.crime_rate_asb },
      crimePeriod: r.crime_rate_period || '',
      // Conservation areas touching the area's neighbourhoods, and the share of its sold homes inside one.
      consCount: r.conservation_count ?? null, consPct: r.conservation_sales_pct ?? null,
    };
  });

  const schools = schoolsCsv.map((r, i) => ({
    i, a: r.area_id, n: r.name, short: r.short_name || r.name, p: r.phase, f: r.faith, ages: String(r.ages),
    pu: r.pupils, of: r.ofsted, ok: r.ofsted_colour, ofd: r.ofsted_detail || '', ofu: r.ofsted_url || '',
    ll: [r.lat, r.lon], cat: (r.catchment_miles === null || r.catchment_miles === '') ? null : r.catchment_miles,
    catText: r.catchment_text || '', src: r.source_url || '', note: r.note || '',
    fsm: r.fsm_pct === null || r.fsm_pct === '' || r.fsm_pct === undefined ? null : +r.fsm_pct,
  }));

  const shops = shopsCsv.map((r, i) => ({ i, a: r.area_id, n: String(r.name), g: r.group, kind: r.type || '', ll: [r.lat, r.lon] }));

  // Area guides: optional, listed in data/guides/index.json ({"guides": {"<area id>": "<path>"}}).
  const guides = {};
  try {
    const idx = await getJSON('data/guides/index.json');
    await Promise.all(Object.entries(idx.guides || {}).map(async ([id, path]) => { guides[id] = await getJSON(path); }));
  } catch (e) { console.warn('No area guides loaded', e); }

  let devs = [];
  try { devs = await loadDevelopments(); } catch (e) { console.warn('No new developments loaded', e); }

  let crimeSubs = null;
  try { crimeSubs = await loadCrimeSubs(); } catch (e) { console.warn('No crime by neighbourhood loaded', e); }

  return {
    areas, schools, shops, guides, crimeSubs, devs, excluded: extra.excluded,
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

// ---------- new developments ----------
// GLA Planning London Datahub schemes and Land Registry new-build sales (scripts/new_developments.py).
// The table (about 90 kB) loads with the page for the area cards; the map points and outlines on first use.
export const DEV_STATUS = ['Selling', 'Being built', 'Sold', 'Finished', 'Approved'];
export async function loadDevelopments() {
  const rows = await getCSV('data/developments.csv');
  // Empty CSV cells arrive as null: text fields become '' so the popup can treat them as strings.
  const TEXT = ['address', 'buildings', 'status', 'beds', 'first_sale', 'last_sale', 'started', 'finished', 'approved',
    'planning_ref', 'other_refs', 'council', 'planning_url', 'postcode', 'description'];
  return rows.map(r => {
    const d = { ...r, id: String(r.id), name: String(r.name || r.address || 'Unnamed scheme') };
    TEXT.forEach(k => { d[k] = r[k] === null || r[k] === undefined ? '' : String(r[k]); });
    return d;
  });
}
let devGeoP = null;
export const loadDevelopmentShapes = () => devGeoP || (devGeoP = getJSON('data/geo/developments.json').catch(e => { devGeoP = null; throw e; }));

// ---------- conservation areas ----------
// planning.data.gov.uk, only the ones touching an area (about 900 kB): loaded when the layer is first switched on.
// Properties: name, ref, council, designated (year), url (council appraisal or page), areas ("be,ed").
let consP = null;
export const loadConservation = () => consP || (consP = getJSON('data/geo/conservation.json').catch(e => { consP = null; throw e; }));

// ---------- crime by neighbourhood ----------
// police.uk street-level crime, 12 months, placed in the same Census neighbourhoods (LSOAs) as the sold prices.
// "all" leaves out shoplifting, which piles onto shopping streets and says little about living there.
export const CRIME_GROUPS = ['asb', 'violent', 'burglary', 'vehicle', 'shoplifting', 'other'];
export const CRIME_KINDS = { all: 'All crime except shoplifting', violent: 'Violence and robbery', burglary: 'Burglary', asb: 'Anti-social behaviour' };
const kindCount = (r, k) => k === 'all' ? r.total - r.shoplifting : r[k];
// Bands are multiples of the shortlist's typical (median) neighbourhood rate for that kind of crime.
export const CRIME_MULT = [0.5, 0.75, 1, 1.5, 2.5];

// Small (about 150 kB): loaded with the page so the area cards can name their quietest and busiest neighbourhoods.
export async function loadCrimeSubs() {
  const [crimeCsv, subCsv] = await Promise.all([getCSV('data/crime_subareas.csv'), getCSV('data/subareas.csv')]);
  const names = Object.fromEntries(subCsv.map(r => [r.id, r.name]));
  const levels = Object.fromEntries(subCsv.map(r => [r.id, r.level === '' ? null : r.level]));
  const rows = crimeCsv.filter(r => r.residents > 0).map(r => {
    const rate = {};
    for (const k of Object.keys(CRIME_KINDS)) rate[k] = 1000 * kindCount(r, k) / r.residents;
    return { ...r, name: names[r.id] || r.id, top: r.top_streets || '', rate, level: levels[r.id] ?? null };
  });
  const med = arr => { const s = [...arr].sort((a, b) => a - b), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
  const typical = Object.fromEntries(Object.keys(CRIME_KINDS).map(k => [k, med(rows.map(r => r.rate[k]))]));
  const cuts = Object.fromEntries(Object.keys(CRIME_KINDS).map(k => [k, CRIME_MULT.map(m => m * typical[k])]));
  return { rows, typical, cuts, band: (k, v) => cuts[k].filter(c => v >= c).length };
}

// Neighbourhood outlines, fetched once and shared by the crime and sweet-spot layers.
let shapes = null;
export const subareaShapes = () => (shapes ||= getJSON('data/geo/subareas.json'));

// The map layer: outlines (shared with the price layer) and the "on or near" points. Loaded on first use.
export async function loadCrime(subs) {
  const [geo, pts] = await Promise.all([subareaShapes(), getCSV('data/crime_points.csv')]);
  const byId = Object.fromEntries(subs.rows.map(r => [r.id, r]));
  const subareas = geo.features.filter(f => byId[f.properties.id]).map(f => {
    const r = byId[f.properties.id];
    return { ...f, properties: { id: r.id, area: r.area_id, name: r.name, residents: r.residents, top: r.top,
      ...Object.fromEntries(CRIME_GROUPS.map(g => [g, r[g]])), total: r.total,
      ...Object.fromEntries(Object.keys(CRIME_KINDS).flatMap(k => [['r_' + k, r.rate[k]], ['b_' + k, subs.band(k, r.rate[k])]])) } };
  });
  const points = pts.map(p => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [p.lon, p.lat] },
    properties: { street: String(p.street), total: p.n, all: p.n - p.shoplifting, ...Object.fromEntries(CRIME_GROUPS.map(g => [g, p[g]])) } }));
  return { subareas, points };
}
