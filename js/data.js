// Loads every data file and turns the rows into the shapes the map and panel use.
// Data files are never changed by the page; edit them and reload.

const getJSON = u => fetch(u).then(r => { if (!r.ok) throw new Error(`${u}: HTTP ${r.status}`); return r.json(); });
const getCSV = u => fetch(u)
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
    };
  });

  const schools = schoolsCsv.map((r, i) => ({
    i, a: r.area_id, n: r.name, short: r.short_name || r.name, p: r.phase, f: r.faith, ages: String(r.ages),
    pu: r.pupils, of: r.ofsted, ok: r.ofsted_colour, ofd: r.ofsted_detail || '', ofu: r.ofsted_url || '',
    ll: [r.lat, r.lon], cat: (r.catchment_miles === null || r.catchment_miles === '') ? null : r.catchment_miles,
    catText: r.catchment_text || '', src: r.source_url || '', note: r.note || '',
  }));

  const shops = shopsCsv.map((r, i) => ({ i, a: r.area_id, n: String(r.name), g: r.group, kind: r.type || '', ll: [r.lat, r.lon] }));

  return {
    areas, schools, shops, excluded: extra.excluded,
    areaById: Object.fromEntries(areas.map(a => [a.id, a])),
    geo: { boroughs, tubeLines, stations, wards },
  };
}
