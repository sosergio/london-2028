# Build brief: London 2028 schools and areas map (GitHub Pages)

This file is the brief for Claude Code. Read it fully before changing anything.

## 1. Goal

A public, static website on GitHub Pages (`https://sosergio.github.io/london-2028/`) that helps one family choose where to live in London from September 2028. It shows 12 shortlisted areas, their mixed state schools and local amenities on an interactive map. The family cares most about:

1. School quality and size: smaller schools are better, and Ofsted rating matters.
2. Neighbourhood lifestyle: independent shops, green space, low crime, not too crowded.
3. Commute to Moorgate (City of London).
4. Closeness to family in Wanstead (E11).

The site must stay static: plain HTML, CSS and JS, data in CSV and JSON files, no server and no database. A small build step is fine only if it runs in a GitHub Action. A no-build setup is preferred.

## 2. What exists today

- `index.html` is a **working prototype** built with Leaflet. Open it through a local server to see it working, for example `python3 -m http.server` and then http://localhost:8000. Treat it as the functional spec: keep every feature it has unless this brief says otherwise.
- The prototype uses a CARTO / OpenStreetMap basemap. The owner wants **Google Maps** instead (see section 4).
- All data is in `data/` (see section 3). The prototype loads it at runtime with `fetch` and PapaParse.

### Features to keep (all present in the prototype)

- **Side panel and map:** the map fills the left and a scrolling side panel sits on the right. On phones they stack, map on top.
- **Filters:**
  - Phase: All, Primary or Secondary. All-through schools always show.
  - Faith: All, Catholic, CofE or None.
  - Maximum pupils: a slider from 200 to 1,800.
  - Show catchment circles.
  - Filter settings are remembered in `localStorage`, wrapped in try/catch.
- **School markers:**
  - A circle whose radius grows with the square root of pupils.
  - Colour by Ofsted, set in `ofsted_colour`: O = outstanding (green), G = good / expected / strong (blue), W = needs attention (orange), N = not yet rated (grey).
  - Secondary = ring, primary = filled dot, all-through = double ring.
  - School short-name labels appear only when zoomed in (prototype threshold: zoom 11.5 or more).
  - Popup contents:
    - name, phase, faith and ages;
    - pupils;
    - Ofsted rating, with detail and a link to the report;
    - catchment text and source link;
    - Google Maps and Street View links.
- **Catchment circles:** dashed circles at `catchment_miles` around a school, where that value is known.
- **Area outlines:**
  - Each area is drawn as the council wards in `data/geo/wards.json`.
  - Selected area: solid outline. Others: dashed.
  - The area label sits at the top of the outline, for example "11. Woking".
  - Ward names show when the area is selected.
- **Area cards in the side panel**, in rank order, each showing:
  - rank, name, sub-title and the "why" text;
  - rent, commute, time to family, lifestyle and green;
  - the residents line;
  - a density bar with the min–max range and the London average of 5,598 per km²;
  - an ethnicity stacked bar;
  - a crime bar with violent, burglary and robbery counts;
  - shop counts;
  - a Rightmove link.
- **Picking an area card:**
  - zooms to its wards and filters the school list to it;
  - clicking the same card again clears the selection.
- **Rightmove link:** opens the map view with these settings: `locationIdentifier=<rightmove_id>`, `minBedrooms=3`, `maxPrice=4500`, `propertyTypes=detached,semi-detached,terraced`, `mustHave=garden`, `channel=RENT`, `viewType=MAP`.
- **School list:** sorted smallest first. Clicking a row flies to the school and opens its popup.
- **Shops and places layer:**
  - Small diamonds, coloured by group, with five toggle buttons. The toggles are independent multi-select, not radio buttons.
  - Groups: `up` (Waitrose, M&S, organic), `bake` (bakeries, delis, butchers), `cult` (cinemas, theatres, books), `gym` (gyms, pools, lidos), `disc` (Aldi, Lidl, Iceland).
  - Default on: `up` and `bake`.
  - Popup: name, group, type, and Google Maps / Street View links.
- **Context layers:**
  - Tube lines, with the Northern and Central lines emphasised.
  - Stations, with Moorgate highlighted as "Moorgate (office)".
  - Borough borders, faint.
- **Other:**
  - Light and dark mode via `prefers-color-scheme`.
  - The "How to read this" notes at the bottom of the panel.
  - The list of excluded single-sex schools.

## 3. Data files

All CSV files have a header row and are UTF-8. Ids must match across files.

| File | Rows | Key columns |
|---|---|---|
| `data/areas.csv` | 12 | `id` (ef, ro, ce, bl, fb, wa, wt, be, bh, ed, wk, sa), `rank`, `name`, `sub`, `lat`, `lon`, `rent`, `commute`, `family`, `lifestyle`, `green`, `rightmove_id` (e.g. `REGION^1474`), `why`, `msoas`, `residents`, `people_per_km2`, `density_min`, `density_max`, `pct_whiteBritish`…`pct_other`, `crime_total`, `crime_<category>` |
| `data/schools.csv` | 92 | `area_id`, `name`, `short_name`, `phase` (P / S / A), `faith` (Catholic / CofE / None), `ages`, `pupils`, `ofsted`, `ofsted_colour` (O / G / W / N), `ofsted_detail`, `ofsted_url`, `lat`, `lon`, `catchment_miles` (blank if unknown), `catchment_text`, `source_url`, `note` |
| `data/shops.csv` | ~380 | `area_id`, `name`, `group` (up / bake / cult / gym / disc), `type` (OSM tag), `lat`, `lon` |
| `data/excluded.json` | | `{ "excluded": [names of single-sex schools left out] }` |
| `data/geo/wards.json` | | `{ "<area id>": [ ["Ward name", [[lat, lon], ...]], ... ] }`, with one ring per ward and coordinates as **lat, lon** |
| `data/geo/boroughs.json` | | GeoJSON FeatureCollection of local authority borders, with `properties.n` = name. GeoJSON order, **lon, lat** |
| `data/geo/tube-lines.json` | | GeoJSON lines with `properties.n` (line name) and `properties.c` (colour) |
| `data/geo/stations.json` | | `[["Name", lat, lon], ...]` |

Watch the coordinate order: `wards.json` and `stations.json` are lat, lon, but the GeoJSON files are lon, lat.

### Where the data came from (for future refreshes)

- **Schools:**
  - Pupil numbers, phase, faith and URN: DfE *Get Information about Schools* (GIAS).
  - Ofsted: reports.ofsted.gov.uk. New report cards since 2025 use "Exceptional / Strong / Expected / Needs attention" instead of single grades.
  - Catchment: council "last distance offered" tables, only where councils publish them (Redbridge, Haringey, Barnet).
- **Census 2021 via the Nomis API** (www.nomisweb.co.uk), for the MSOAs listed in `msoas`:
  - Ethnicity: TS021 = `NM_2041_1`.
  - Density: TS006 = `NM_2026_1`.
  - The density for an area is total population divided by total area, not an average of the MSOA densities.
- **Crime:** data.police.uk street-level crimes within 1 mile of the area centre (`lat`, `lon`), Oct 2025 to Sep 2026.
- **Shops:**
  - OpenStreetMap, within about 2 km of the centre.
  - The Overpass API was unreliable, so some areas were filled from Nominatim search instead, which may miss places.
- **Ward outlines:** ONS boundaries, December 2025 (`WD_DEC_2025_UK_BGC` on the ONS ArcGIS service).
- **Rents and journey times:** estimates.

## 4. Switch the map to Google Maps

Use the **Maps JavaScript API**, loaded with the official dynamic loader (`importLibrary`). Plan:

1. **API key:**
   - The owner creates a Google Cloud project, enables *Maps JavaScript API* and creates an API key.
   - Restrict the key to HTTP referrers `https://sosergio.github.io/*` and `http://localhost:*/*`, and to the Maps JavaScript API only.
   - The key will be visible in the page source. That is normal for browser keys; the restrictions are what protect it.
   - Put the key in one place, for example `config.js`.
   - Usage for one family stays within Google's free monthly allowance, but billing must be enabled on the project.
2. **Map ID:** create one in Google Cloud (Map Management) for vector maps. It is needed for `AdvancedMarkerElement` and for cloud styling. Use a calm, muted style so school colours stand out. Support dark mode, either with a second map ID or `colorScheme`.
3. **Replace each Leaflet piece with its Google equivalent:**

| Leaflet piece (prototype) | Google Maps equivalent |
|---|---|
| `L.circleMarker` for schools | `AdvancedMarkerElement` with a small HTML/SVG circle as `content` (keeps ring / dot / double-ring styles), or `google.maps.Circle` with pixel radius emulation. Advanced markers are preferred. |
| permanent tooltips (school labels) | label inside the marker content, hidden below the zoom threshold with a `zoom_changed` listener |
| `bindPopup` | one shared `InfoWindow` |
| `L.circle` catchment (metres) | `google.maps.Circle` with `radius` in metres (miles × 1609.344) |
| `L.polygon` ward outlines | `google.maps.Polygon` (dashed strokes need `icons` on a `Polyline`: draw a dashed polyline over an unstroked polygon) |
| area labels | `AdvancedMarkerElement` with text content |
| `L.geoJSON` borough borders and tube lines | `map.data.addGeoJson()` with a style function, or skip the borough borders, because Google's basemap already shows them |
| shop diamonds | `AdvancedMarkerElement` with a rotated square. There are ~380, which is fine; add `@googlemaps/markerclusterer` only if it gets slow |
| `flyToBounds` | `map.fitBounds(bounds, padding)` |
| stations | probably drop them, because Google shows transit. Keep Moorgate as a highlighted marker. Consider the `TransitLayer` toggle |

4. **Keep the data files and the side panel logic unchanged.** Only the map layer should change. A good structure:
   - `js/data.js`: loads and parses the files.
   - `js/map-google.js`: everything map-specific.
   - `js/panel.js`: filters, area cards and the list.
   - Keep the shared state object.
5. **Nice extras Google makes easy (optional):**
   - Street View pegman.
   - A "commute from here" link: a Google Maps directions URL from the area centre to Moorgate station by transit.

## 5. Privacy rules (the repository is public)

- Do not add personal details: no names of family members, no home address or postcode, no employer, no income, no health information.
- Area texts must stay neutral, for example "good for a family with a primary and a secondary child".
- Do not commit API keys other than the referrer-restricted Maps browser key.

## 6. Deploy

- **GitHub Pages:** Settings → Pages → Deploy from a branch → `main` / root. `.nojekyll` is already present, so folders that start with `_` are served too.
- **If a build step is added** (e.g. Vite): deploy with the official `actions/deploy-pages` workflow, and set `base: '/london-2028/'`.
- **Paths:** all data paths must be relative (`data/areas.csv`), because the site lives under `/london-2028/`.

## 7. Done when

- The site loads at https://sosergio.github.io/london-2028/ on a Google basemap, with no console errors.
- Every feature in section 2 works on desktop and on a phone-width screen.
- Editing a row in `data/schools.csv` and pushing changes the map, with no other step.
- `README.md` explains how to edit the data and how to set the API key.
