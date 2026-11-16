# Build brief: London 2028 schools and areas map (GitHub Pages)

This file is the brief for Claude Code. Read it fully before changing anything.

## 1. Goal

A public, static website on GitHub Pages (`https://sosergio.github.io/london-2028/`) that helps one family choose where to live in London from September 2028. It shows the shortlisted areas, all their mixed state schools (any Ofsted rating) and local amenities on an interactive map. The family cares most about:

1. School quality and size: smaller schools are better, and Ofsted rating matters.
2. Neighbourhood lifestyle: independent shops, green space, low crime, not too crowded.
3. Commute to Moorgate (City of London).
4. Closeness to family in Wanstead (E11).

The site must stay static: plain HTML, CSS and JS, data in CSV and JSON files, no server and no database. A small build step is fine only if it runs in a GitHub Action. A no-build setup is preferred.

## 2. What exists today

- `index.html` was first a prototype built with Leaflet; its features below are the functional spec. Open the site through a local server, for example `python3 -m http.server` and then http://localhost:8000.
- The prototype used a CARTO / OpenStreetMap basemap, which now needs an API key. The site uses **MapLibre GL + OpenFreeMap** instead (see section 4). The Leaflet prototype is in the git history.
- All data is in `data/` (see section 3). The prototype loads it at runtime with `fetch` and PapaParse.

### Features to keep (all present in the prototype)

- **Side panel and map:** the map fills the left and a scrolling side panel sits on the right. On phones they stack, map on top.
- **Filters float on the map** in a collapsible box (top right), folded by default on phones. It has sections for Schools, Shops and places, Highlights, Transport, Conservation areas, Sweet spots, Sold prices and Crime, each with an on/off switch that hides the whole group on the map and folds the section while keeping the choices inside it.
- **Filters:**
  - Phase: All, Primary or Secondary. All-through schools always show.
  - Faith: All, Catholic, CofE or None.
  - Ofsted: four independent toggles, Outstanding (O), Good (G), Below good (W), Not rated (N), all on by default.
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
- **Area cards in the side panel**, in rank order, collapsed to rank, name and sub-title with a chevron to open the details ("Expand all" / "Collapse all" above the list). Clicking the name selects the area and opens its card. Each card shows:
  - rank, name, sub-title and the "why" text;
  - rent, commute, time to family, lifestyle and green;
  - the residents line;
  - a density bar with the min–max range and the London average of 5,598 per km²;
  - an ethnicity stacked bar;
  - a crime bar: crimes a year per 1,000 residents (shoplifting left out), with violence, burglary and anti-social rates against the middle of the shortlist, the quietest and busiest neighbourhood, and the 1-mile count;
  - shop counts;
  - a Rightmove link.
- **Compare areas** (button under the intro): a dialog with a sortable table, one row per area, columns grouped as Schools (count, % Good or better, Outstanding, below good, under 400 pupils, smallest secondary), Getting about (Moorgate, family), Housing (price level, median flat / terraced / semi, rent) and Neighbourhood (crime, violence and burglary per 1,000 residents, share of sold homes in a conservation area (not shaded: it is a trade-off), density, green, lifestyle, grocers, bakeries). Each heading says which direction is better; cells are tinted green from worst to best within the column; clicking a row selects that area. Code in `js/compare.js`.
- **Area guides** (Gidea Park so far): numbered highlight markers on the map (switch "Highlights" in the filter box) and a photo guide dialog opened from the area card, a marker or the filter box; each highlight has a photo with its credit, a short description, a tip, "Show on the map" and a Google Maps link. Data in `data/guides/`; code in `js/guide.js`.
- **Picking an area card:**
  - zooms to its wards and filters the school list to it;
  - clicking the same card again clears the selection.
- **Rightmove link:** opens the map view with these settings: `locationIdentifier=<rightmove_id>`, `minBedrooms=3`, `maxPrice=4500`, `propertyTypes=detached,semi-detached,terraced`, `mustHave=garden`, `channel=RENT`, `viewType=MAP`.
- **School list:** sorted smallest first. Clicking a row flies to the school and opens its popup.
- **Shops and places layer:**
  - Small icons on discs coloured by group (basket, bread, book, dumbbell, tag), with five toggle buttons showing the same icons. The toggles are independent multi-select, not radio buttons.
  - Groups: `up` (Waitrose, M&S, organic), `bake` (bakeries, delis, butchers), `cult` (cinemas, theatres, books), `gym` (gyms, pools, lidos), `disc` (Aldi, Lidl, Iceland).
  - Default on: `up` and `bake`.
  - Popup: name, group, type, and Google Maps / Street View links.
- **Sold prices layer** (off by default, remembered): neighbourhoods (ONS LSOAs) shaded by a mix-adjusted price level, 100 = typical for the shortlist, in a one-hue plum ramp with a legend; hover or click for medians by type; each sale shows as a dot from zoom 14. Area cards show median flat / terraced / semi prices and the area's price level.
- **Sweet spots** (button "Find sweet spots" under the intro, or the filter section; off by default, sliders remembered): neighbourhoods that pass four tests at once, each on a slider: price level up to 100, crime up to 75 per 1,000 residents (shoplifting left out), a Good or Outstanding primary within 0.6 km and secondary within 1.5 km (straight line from the middle of the neighbourhood), with "Count faith schools". Passing neighbourhoods are filled in the accent colour; hover any neighbourhood for ✓/✗ on each test with the nearest schools. The section lists how many pass in each area (click to select the area). Only one of Sweet spots, Sold prices and Crime is on at a time. Code in `js/sweet.js`.
- **This view on Rightmove** (bottom left of the map, from zoom 10.5): "To rent" and "For sale" links that search exactly the visible map (minus the part under the open filter box), 5% larger on each side, as a Rightmove drawn-area search (`USERDEFINEDAREA^{"polylines":…}`, a Google encoded polyline), with the same filters as the area links (3+ bed houses with a garden; rent up to £4,500). Links update after every pan or zoom. Code in `js/map.js` and `rightmoveAreaUrl` in `js/format.js`.
- **Conservation areas** (off by default, remembered; works alongside every other layer): conservation-area outlines in ochre (`--cons`, `--cons-fill`) with a light fill, loaded on first use from `data/geo/conservation.json`; hover or click for the name, council, year designated and a link to the council appraisal; a neighbourhood tip (prices, crime, sweet spots) adds "In a conservation area: …" when the pointer is inside one. The card has a Conservation bar: share of the area's sold homes (last 2 years) inside one, and how many touch its neighbourhoods. Code in `js/map.js` (`cons-*` layers) and `js/panel.js`.
- **Crime layer** (off by default, remembered; switching it on turns the price layer off, as both shade the neighbourhoods): neighbourhoods shaded by crimes a year per 1,000 residents, for All (except shoplifting), Violence (incl. robbery), Burglary or Anti-social behaviour, in a one-hue red ramp whose bands are multiples (½, ¾, 1, 1.5, 2.5) of the typical shortlist neighbourhood; hover for the breakdown and the streets with most reports; from zoom 14 the police.uk "on or near" points show as dots sized by count. Code in `js/map.js` (`crime-*` layers) and `js/panel.js`.
- **Context layers:**
  - Tube, Overground, DLR and Elizabeth lines in their colours, with the Northern and Central lines emphasised (Northern drawn light grey in dark mode). Hover a line for its name.
  - All 429 Tube, Overground, DLR and Elizabeth line stations (TfL API, Nov 2026); labels from zoom 12. Moorgate highlighted as "Moorgate (office)".
  - A "Transport" toggle in the floating filters shows or hides lines and stations (remembered); Moorgate always shows.
  - Borough borders, faint.
- **Other:**
  - Light and dark mode via `prefers-color-scheme`.
  - The "How to read this" notes at the bottom of the panel.
  - The list of excluded single-sex schools.

## 3. Data files

All CSV files have a header row and are UTF-8. Ids must match across files.

| File | Rows | Key columns |
|---|---|---|
| `data/areas.csv` | 20 | `id` (ef, ro, ce, bl, fb, wa, wt, be, bh, ed, wk, sa, fg, ly, hp, pg, ap, sn, gp, bw), `rank`, `name`, `sub`, `lat`, `lon`, `rent`, `commute`, `family`, `lifestyle`, `green`, `rightmove_id` (e.g. `REGION^1474`), `why`, `msoas`, `residents`, `people_per_km2`, `density_min`, `density_max`, `pct_whiteBritish`…`pct_other`, `crime_total`, `crime_<category>` |
| `data/schools.csv` | 92 | `area_id`, `name`, `short_name`, `phase` (P / S / A), `faith` (Catholic / CofE / None), `ages`, `pupils`, `ofsted`, `ofsted_colour` (O / G / W / N), `ofsted_detail`, `ofsted_url`, `lat`, `lon`, `catchment_miles` (blank if unknown), `catchment_text`, `source_url`, `note` |
| `data/shops.csv` | ~380 | `area_id`, `name`, `group` (up / bake / cult / gym / disc), `type` (OSM tag), `lat`, `lon` |
| `data/excluded.json` | | `{ "excluded": [names of single-sex schools left out] }` |
| `data/sales.csv` | ~14,000 | `area_id`, `date`, `price`, `type` (flat / terraced / semi / detached), `street`, `postcode`, `lat`, `lon`, `lsoa` (HM Land Registry, standard sales, 2 years; no house numbers) |
| `data/subareas.csv` | ~500 | `area_id`, `id` (LSOA 2021 code), `name`, `sales`, `median_<type>`, `level`, `band` (0-5) |
| `data/crime_subareas.csv` | ~700 | `area_id`, `id` (LSOA 2021), `residents` (Census 2021), `total`, `asb`, `violent` (incl. robbery), `burglary`, `vehicle` (incl. bikes), `shoplifting`, `other`, `top_streets` (police.uk, 12 months) |
| `data/geo/conservation.json` | ~200 | GeoJSON of the conservation areas that touch an area's neighbourhoods: `name`, `ref`, `council`, `designated` (year), `url` (appraisal or council page), `areas` (comma-separated area ids). Built from `conservation_region.json` |
| `data/geo/conservation_region.json` | ~1,550 | Every conservation area in London and the commuter belt (same properties, no `areas`); the kept source, not loaded by the site, so a new area needs no download |
| `data/crime_points.csv` | ~8,800 | `area_id`, `lsoa`, `lat`, `lon`, `street`, `n`, then the same six groups: one row per police.uk "on or near" point |
| `data/geo/subareas.json` | | GeoJSON LSOA outlines, `properties.id`, **lon, lat** |
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
- **Conservation areas:** planning.data.gov.uk `conservation-area` dataset (each council's designations, England, ~9,800), cut to the region and then to the areas (`conservation_areas.py` in the skill; also writes `conservation_count` and `conservation_sales_pct` in `areas.csv`).
- **Crime:** data.police.uk street-level crimes, Oct 2025 to Sep 2026: within 1 mile of the area centre (`crime_*` counts), and per neighbourhood (LSOA) inside each area's sub-areas, divided by Census 2021 residents (`crime_rate*`, `crime_subareas.csv`, `crime_points.csv`; script `crime_subareas.py` in the skill).
- **Shops:**
  - OpenStreetMap, within about 2 km of the centre.
  - The Overpass API was unreliable, so some areas were filled from Nominatim search instead, which may miss places.
- **Ward outlines:** ONS boundaries, December 2025 (`WD_DEC_2025_UK_BGC` on the ONS ArcGIS service).
- **Rents and journey times:** estimates.

## 4. Map library: MapLibre GL + OpenFreeMap

The prototype's CARTO basemap now needs an API key (every tile returns "API KEY REQUIRED"), and Google Maps needs a billed Cloud project. The site therefore uses:

- **MapLibre GL JS** 5.24.0 from cdnjs (`maplibregl` global), open source, no key.
- **OpenFreeMap** vector tiles and styles (`https://tiles.openfreemap.org/styles/positron` for light, `.../styles/dark` for dark). Free, no key, no usage limit. Attribution comes from the style.

Why it fits: the basemap is vector, so street names stay sharp at every zoom, and our area, catchment, borough and Tube layers are inserted **below the basemap's label layers** (`beforeId` = first `symbol` layer). Street names stay readable on top of shaded areas. Schools, shops and our own labels sit above everything.

| Prototype (Leaflet) | MapLibre |
|---|---|
| CARTO tiles | OpenFreeMap style; `setStyle` on theme change, then all sources and layers are added again on `style.load` |
| `L.circleMarker` schools | `circle` layer; radius `4 + √pupils / 3.2` px in feature properties; ring / dot / double ring via opacity, stroke and a second ring layer |
| permanent school labels | `symbol` layer with `minzoom: 11.5` |
| `bindPopup` | one shared `maplibregl.Popup` |
| `L.circle` catchments | 64-point polygon in metres (`catchment_miles` × 1609.344): `fill` + dashed `line` |
| `L.polygon` wards | `fill` + two `line` layers (solid for the selected area, dashed for others) |
| area and ward labels | `symbol` layers on point features |
| `L.geoJSON` boroughs and Tube | GeoJSON sources with `line` layers |
| shop diamonds | `symbol` layer with one canvas-drawn diamond image per group (`addImage`) |
| `flyToBounds` / `setView` | `fitBounds(bounds, { padding })` / `flyTo` |

Code layout (ES modules, no build):

- `js/data.js`: loads and parses the files.
- `js/state.js`: the shared state object and `localStorage`.
- `js/format.js`: number formatting, links and popup HTML.
- `js/map.js`: everything map-specific.
- `js/panel.js`: filters, area cards and the school list.
- `js/main.js`: wires them together.

Extras added: a scale bar in miles and a "Commute from here" Google Maps transit link from each area centre to Moorgate.

## 5. Privacy rules (the repository is public)

- Do not add personal details: no names of family members, no home address or postcode, no employer, no income, no health information.
- Area texts must stay neutral, for example "good for a family with a primary and a secondary child".
- Do not commit API keys. The map needs none.

## 6. Deploy

- **GitHub Pages:** Settings → Pages → Deploy from a branch → `main` / root. `.nojekyll` is already present, so folders that start with `_` are served too.
- **If a build step is added** (e.g. Vite): deploy with the official `actions/deploy-pages` workflow, and set `base: '/london-2028/'`.
- **Paths:** all data paths must be relative (`data/areas.csv`), because the site lives under `/london-2028/`.

## 7. Done when

- The site loads at https://sosergio.github.io/london-2028/ on the OpenFreeMap basemap, with no console errors.
- Every feature in section 2 works on desktop and on a phone-width screen.
- Editing a row in `data/schools.csv` and pushing changes the map, with no other step.
- `README.md` explains how to edit the data.
