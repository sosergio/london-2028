# Sources and recipes, by dimension

How each dimension in `data/` was collected, with the pitfalls found along the way. If an endpoint has changed, fix it here as well as in the data, so the next run starts from what works.

Contents: 1 Wards · 2 Census · 3 Crime · 4 Schools · 5 Shops · 6 Sale prices · 7 Rents · 8 Estimates

---

## 1. Ward outlines → `data/geo/wards.json`

- Source: ONS Open Geography Portal, ward boundaries December 2025, generalised clipped (`WD_DEC_2025_UK_BGC`), on the ONS ArcGIS feature service. Search the portal for "Wards December 2025 Boundaries UK BGC" to get the current FeatureServer URL.
- Query by name and borough code, `outSR=4326`, `f=geojson`. Ward names repeat across boroughs, so always filter by the borough (LAD) code too.
- Store as `{"<area id>": [["Ward name", [[lat, lon], ...]], ...]}`: **lat, lon** order (the reverse of GeoJSON), one outer ring per ward, rounded to 5 decimals to keep the file small. For a multipart ward keep the largest ring.

## 2. Census 2021 → `msoas`, `residents`, `people_per_km2`, `density_min`, `density_max`, `pct_*`

- Source: Nomis API (`https://www.nomisweb.co.uk/api/v01/dataset/...`), no key needed for these volumes.
  - Ethnicity: TS021, dataset `NM_2041_1`.
  - Population density: TS006, dataset `NM_2026_1` (gives residents and area per MSOA).
- Geography: MSOA 2021 codes (`E02...`). `msoas` stores the readable names (`Haringey 034`); look up codes from names with the ONS MSOA 2021 names lookup or Nomis' geography search.
- Pick the 2-3 MSOAs that best overlap the area's wards.
- `people_per_km2` = total residents ÷ total area across the MSOAs (**not** the average of the MSOA densities). `density_min`/`density_max` are the lowest and highest single-MSOA densities.
- Ethnicity: map TS021's top-level groups to `pct_whiteBritish`, `pct_whiteOther` (all other White), `pct_asian`, `pct_black`, `pct_mixed`, `pct_other`; percentages of the combined residents, 1 decimal, summing to about 100 (the audit checks this).

## 3. Crime → `crime_total`, `crime_<category>`

- Source: police.uk API, `https://data.police.uk/api/crimes-street/all-crime?lat=<lat>&lng=<lon>&date=YYYY-MM`. The point query uses a **1-mile radius**, which is what the site describes. Use the area centre (`lat`, `lon`).
- One request per month for the same 12 months for every area (currently Oct 2025–Sep 2026). Check `https://data.police.uk/api/crimes-street-dates` for the latest month available.
- A month with more than 10,000 crimes returns HTTP 503; it does not happen at 1 mile in these areas, but if it does, split the area with `poly=` queries.
- Rate limit: about 15 requests/second; sleep briefly between calls.
- Sum `category` counts across the months. Store `crime_total` and the six categories the panel uses: `anti-social-behaviour`, `burglary`, `robbery`, `vehicle-crime`, `violent-crime`, `shoplifting`.

### Crime by neighbourhood → `crime_subareas.csv`, `crime_points.csv`, `crime_rate*`

- `https://data.police.uk/api/crimes-street/all-crime?date=YYYY-MM&poly=lat,lon:lat,lon:...` (GET; poly is **lat,lon**). One request per area per month with the bounding box of the area's sub-areas; filter to the sub-areas yourself. More than 10,000 crimes returns HTTP 503: split the box. Dedupe by crime `id` (boxes of neighbouring areas overlap).
- Available months: `https://data.police.uk/api/crimes-street-dates`. Data lags about two months.
- `location.street.name` is "On or near X"; the point is the centre of an anonymised "snap point", not the crime's address. No postcodes, no LSOA in the API (the bulk downloads have LSOA, but point-in-polygon against our own outlines is simpler).
- Residents per LSOA: Nomis TS001 `NM_2021_1`, `geography=<LSOA codes, up to ~100 per call>&c2021_restype_3=0&measures=20100`.

### Conservation areas → `geo/conservation_region.json`, `geo/conservation.json`, `conservation_*`

- National file: `https://files.planning.data.gov.uk/dataset/conservation-area.geojson` (~60 MB, ~9,800 areas, rebuilt daily). Properties: `name`, `reference`, `organisation-entity`, `start-date` (designation date, often blank), `documentation-url` (appraisal PDF or council page, ~75% filled). `[lon, lat]`.
- Council names: `https://www.planning.data.gov.uk/entity.json?dataset=local-authority&limit=500&field=entity&field=name`, matched on `organisation-entity`.
- Quirks: some councils (Bromley, Bexley, Sutton) also send unnamed pieces, mostly inside a named area: the script drops those and calls the rest "Unnamed conservation area". Some names are ALL CAPS (Enfield) or end in "Conservation Area": tidied. Coverage depends on each council's upload; the site notes say the council's appraisal is the authority, including for Article 4 directions (a separate dataset, `article-4-direction-area`, not used yet).

## 4. Schools → `schools.csv`, `excluded.json`

Scope: state-funded **mixed** primaries, secondaries and all-through schools in or very near the area's wards (the audit flags anything over 3.5 km from the centre). Independent schools are out. Single-sex schools go in `excluded.json` with "(boys)" / "(girls)" when the name does not say.

- **Start with `scripts/schools_gias.py`**: it lists every open, mixed, state-funded mainstream school inside the area's wards that is not yet in `schools.csv` (any Ofsted rating: the site shows weak schools too, so the user can see them), and single-sex ones missing from `excluded.json`. `--write` appends them with Ofsted filled in and catchment left for you. Inputs:
  - GIAS: `https://ea-edubase-api-prod.azurewebsites.net/edubase/downloads/public/edubasealldataYYYYMMDD.csv` (today's date; latin-1). It has no Ofsted ratings.
  - Ofsted: the newest "Management information - state-funded schools - latest inspections as at ..." CSV, listed by `https://www.gov.uk/api/content/government/statistical-data-sets/monthly-management-information-ofsteds-school-inspections-outcomes` (`details.attachments`).
  - Ofsted pitfalls the script handles: graded inspections from Sept 2024 to Oct 2025 say "Not judged" overall (use the four sub-judgements); report cards (Nov 2025 on) have eight area grades and no headline; schools last graded before 2019 only show the later ungraded outcome ("School remains Good").
  - Schools just outside the wards but popular with the area (the original list was radius-based) can stay; the audit flags those over 3.5 km away.
- **GIAS** (DfE Get Information about Schools): the daily "all establishment data" CSV download, or the establishment pages (`https://www.get-information-schools.service.gov.uk/Establishments/Establishment/Details/<URN>`). Gives URN, phase, gender, religious character, age range, pupil numbers, coordinates (easting/northing, convert to lat/lon) and status. Keep only open schools.
- Columns:
  - `phase`: P, S or A (all-through, e.g. 4-16 or 3-18).
  - `faith`: Catholic, CofE or None (other faiths: use None and say so in `note`).
  - `ages`: type and age range, e.g. "Academy, 11–18".
  - `pupils`: GIAS number on roll; say in the notes if a newer figure came from SchoolDash or WhatSchool.
  - `short_name`: what a parent would call it; used for map labels.
- **Ofsted** (`https://reports.ofsted.gov.uk/provider/...`): since September 2024 there are no new single-word grades, and report cards since 2025 use Exceptional / Strong / Expected / Needs attention.
  - `ofsted`: the latest headline (last grade, or the report card's overall wording).
  - `ofsted_colour`: O = outstanding or exceptional, G = good / expected / strong, W = needs attention or requires improvement / inadequate, N = not yet inspected.
  - `ofsted_detail`: date and whether a later short visit kept the grade.
- **Catchment**: only from council "last distance offered" / allocation tables for the normal round (Reception, Year 7). Store miles in `catchment_miles` and the plain-English line plus year in `catchment_text`. If none is published, leave `catchment_miles` blank and write what is known (priority postcodes, faith criteria, "ask X admissions") in `catchment_text`.
- `source_url`: the page the catchment or main facts came from.
- **Where councils publish last distances** (checked Nov 2026; use a browser User-Agent with curl, and `pypdf` from a scratch `--target` folder to read PDFs):
  - Haringey: HTML table, community primaries 2022-2026: `haringey.gov.uk/.../cutoff-distance-school-last-child-offered-place/primary-schools-distance-school-last-child-offered-place-national-offer-day` (a secondary twin page exists); Year 7 PDF `sites/default/files/2026-03/secondary_transfer_2026_how_offers_were_made.pdf`. "N/A" = no cut-off. Faith (VA) schools are not listed.
  - Islington: HTML tables for primary and secondary, three years: `islington.gov.uk/.../school-admissions-information/cut-off-distance-maps`. "Not applicable" = every applicant offered.
  - Lewisham: community primaries `lewisham.gov.uk/-/media/services/education/schools/admissions/grid-for-reception-2026.pdf` (metres, 7th number on each row); community secondaries on the "last year's number of applications and appeals" page. Faith schools and academies: ask the school.
  - Greenwich: the secondary booklet (`royalgreenwich.gov.uk/sites/default/files/2026-02/secondary school booklet 26 27.pdf`) gives "Last offer on distance (km)" for the previous year on each school's page.
  - Southwark: community primaries only, `services.southwark.gov.uk/assets/attach/127374/Allocation-of-community-school-places-by-criteria-Sept-2025.pdf` (metres; "all applicants offered" is common). No secondary distances; academies publish their own, if at all.
  - Barnet: "How primary school places were allocated on 16 April <year>" PDFs, but the site serves a bot challenge to scripts: download in a browser and read the file.
- Write the year and stage into `catchment_text` ("Haringey, Reception, offer day April 2026") and point `source_url` at the table. Where there is no cut-off, say why in `catchment_text` (every applicant offered; faith school with its own criteria; academy that does not publish) and leave `catchment_miles` blank, so no circle is drawn.

## 5. Shops and places → `shops.csv`

Within about 2 km of the area centre. Columns: `area_id, name, group, type, lat, lon`; `type` is the OSM tag value in words ("supermarket", "bakery", "swimming pool").

| group | What | OSM |
|---|---|---|
| `up` | Waitrose, M&S Food, organic grocers | `shop=supermarket`/`convenience` with brand Waitrose, M&S / Marks & Spencer, Planet Organic, Whole Foods; `shop=organic` or `organic=only`. Bakery chains such as Gail's go in `bake` |
| `bake` | bakeries, delis, butchers, fishmongers, cheese | `shop=bakery`, `shop=deli`, `shop=butcher`, `shop=seafood`, `shop=cheese` |
| `cult` | cinemas, theatres, bookshops | `amenity=cinema`, `amenity=theatre`, `shop=books` |
| `gym` | gyms, pools, lidos | `leisure=fitness_centre`, `leisure=sports_centre` with swimming, `leisure=swimming_pool` with `access=yes`/public, lidos |
| `disc` | Aldi, Lidl, Iceland | `brand` = Aldi, Lidl, Iceland |

- **Overpass API** (`https://overpass-api.de/api/interpreter`, mirror `https://overpass.kumi.systems/api/interpreter`): one query per area using `around:2000,<lat>,<lon>` over `nwr` with the tags above and `out center;`. It is often overloaded (429/504); retry with backoff or switch mirror.
- **Nominatim fallback** (`https://nominatim.openstreetmap.org/search?q=<brand or type> near <area>&format=jsonv2`): 1 request per second, a descriptive User-Agent, and it misses places, which is why the audit flags areas with under 15 shops or an empty group. Prefer re-running Overpass over topping up by hand.
- Remove duplicates (same name within ~50 m) and chains that don't fit the group.

## 6. Sale prices → `postcode_sectors`, `price_*`, `price_level`, `sales.csv`, `subareas.csv`, `geo/subareas.json`

Run `scripts/property_prices.py` (see SKILL.md). What it does, in case it needs fixing:

- **Postcode sectors** ("N8 9"): a grid of points inside the area's wards is reverse-geocoded with postcodes.io (`POST https://api.postcodes.io/postcodes` with `geolocations`, up to 100 per call, free, no key). Sectors with under 5% of the points are dropped.
- **Sales**: Land Registry SPARQL endpoint `https://landregistry.data.gov.uk/landregistry/query`, `Accept: text/csv`.
  - Filtering on postcode prefixes across the whole register times out (HTTP 503 after minutes). Query per **council district** instead (`lrcommon:district "HARINGEY"`, about 1-2 s and ~4,000 rows for 2 years) and filter sectors in Python. Districts come from `https://api.postcodes.io/outcodes/<outcode>` (`admin_district`, upper-cased).
  - Only `lrppi:standardPricePaidTransaction` (category A): category B includes repossessions and company bulk sales, which skew medians.
  - Property types: `flat-maisonette`, `terraced`, `semi-detached`, `detached`.
- **No bedrooms in Price Paid.** For a closer "2-3 bed" figure, the EPC register (`https://epc.opendatacommunities.org/`, free with registration, gives an API key) has `number-habitable-rooms` and floor area per address; joining it to Price Paid by address gives £ per m² and room counts. Only worth it if the type medians are not enough.
- Price Paid runs about 1-2 months behind; very recent months are incomplete.
- **Sub-areas** (`scripts/price_subareas.py`): each sale's LSOA comes from postcodes.io (`codes.lsoa21`); outlines from the ONS FeatureServer `LSOA_2021_EW_BFE_V10_RUC/FeatureServer/3` (layer 3, not 0), queried by `LSOA21CD IN (...)` with `maxAllowableOffset=0.00003` (~3 m) to keep the file under 1 MB. Postcode sectors have no free official outlines, which is why LSOAs are used; each is named by its main sector and street. Price level = 100 × median of (sale price ÷ shortlist median for that property type); under 8 sales → no level. Bands 80/95/110/130/160 are duplicated in `js/data.js` (`PRICE_BANDS`).

## 7. Rents → `rent_2bed`, `rent_3bed`, `rent_source`

No free official source gives rents by bedroom at neighbourhood level, so combine:

- **ONS Price Index of Private Rents (PIPR)**: monthly average rent by local authority and bedroom count (free download from ons.gov.uk, search "Price index of private rents"). Official, but borough-wide: Crouch End and Tottenham share Haringey's figure.
- **Asking rents** for the neighbourhood itself: the area's Rightmove map link (the card's link, with the bedroom filter changed to 2 and then 3). Rightmove has no API and its terms forbid scraping, so ask the user to read off a typical range, or use PropertyData (`propertydata.co.uk`, paid API, asking rents by postcode sector and bedrooms) if the user has a key.
- Store monthly £ as plain numbers (`2400`), and in `rent_source` say what they are, e.g. `ONS PIPR Haringey Sep 2026` or `Rightmove asking, Nov 2026, 14 listings`. Use the same source for every area where possible.
- The older `rent` column is the estimated 3-bed house range shown on the card; keep it until the panel shows the new columns.

## 8. Estimates → `rent`, `commute`, `family`, `lifestyle`, `green`

- `commute`: door-to-door to Moorgate in the morning peak, as `~25–30 min`. Check with Google Maps or TfL Journey Planner from the area centre; the card's "Commute from here" link opens that query.
- `family`: time to the family's area, by public transport unless marked "by car". Write only the time, never the address.
- `lifestyle`, `green`: one of Excellent / Very good / Good / Fair, judged from the shops data, high street, parks and open space within walking distance. Explain anything unusual in `why`.
