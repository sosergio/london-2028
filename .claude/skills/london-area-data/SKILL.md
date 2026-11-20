---
name: london-area-data
description: Collect, refresh and audit the data behind the London 2028 area map (data/areas.csv, schools.csv, shops.csv, geo/wards.json) - schools with Ofsted and pupil numbers, shops and places, Census ethnicity and density, police.uk crime, ward outlines, Land Registry sale prices and rents. Use this whenever the user wants to add a new area or neighbourhood to investigate, check that every area has complete data, fill gaps, refresh numbers, or add a new kind of data (a "dimension") to all areas - even if they just say "look into Forest Gate", "is the data complete?", "add house prices" or "redo the shops for Beckenham".
---

# London area data

The site compares shortlisted London areas for a family move in September 2028. Every area must carry the same set of facts so the cards and the map can be compared like for like. This skill is the method for collecting those facts, so that a new area gets exactly what the existing ones have and gaps are easy to find.

All paths below are relative to the repo root. Scripts use only the Python standard library.

## The dimensions

| # | Dimension | Where it lives | How |
|---|---|---|---|
| 1 | Core: id, rank, name, sub, centre, why, Rightmove id | `areas.csv` | by hand, see "Adding an area" |
| 2 | Ward outlines | `data/geo/wards.json` | ONS boundaries |
| 3 | Census: residents, density, ethnicity | `areas.csv` (`msoas`, `residents`, `people_per_km2`, `density_*`, `pct_*`) | Nomis API |
| 4 | Crime: 12 months within 1 mile, and per 1,000 residents by neighbourhood | `areas.csv` (`crime_*`, `crime_rate*`), `crime_subareas.csv`, `crime_points.csv` | police.uk API, `scripts/crime_subareas.py` |
| 5 | Schools: all mixed state primaries and secondaries in the wards, any Ofsted rating | `schools.csv` (+ single-sex ones in `excluded.json`) | `scripts/schools_gias.py` (GIAS + Ofsted), council admissions for catchment |
| 6 | Shops and places, 5 groups | `shops.csv` | OpenStreetMap (Overpass, Nominatim fallback) |
| 7 | Sale prices: area medians, every sale, sub-area price levels | `areas.csv` (`postcode_sectors`, `price_*`, `price_level`), `sales.csv`, `subareas.csv`, `geo/subareas.json` | Land Registry: `scripts/property_prices.py --write`, then `scripts/price_subareas.py` |
| 7b | Conservation areas: outlines, count and share of sold homes inside | `geo/conservation_region.json` (kept source), `geo/conservation.json`, `areas.csv` (`conservation_count`, `conservation_sales_pct`) | planning.data.gov.uk, `scripts/conservation_areas.py --write` (after prices) |
| 7c | New developments: schemes being built, selling or just sold | `developments.csv`, `geo/developments.json` | GLA Planning London Datahub + Land Registry new builds, `scripts/new_developments.py --write` (after prices) |
| 8 | Rents for 2 and 3 bedrooms | `areas.csv` (`rent_2bed`, `rent_3bed`, `rent_source`) | ONS + asking-rent spot check |
| 9 | Estimates: rent band, commute, time to family, lifestyle, green | `areas.csv` (`rent`, `commute`, `family`, `lifestyle`, `green`) | judgement, written as ranges |

`references/sources.md` has the exact endpoints, queries and pitfalls for each one. Read the section for a dimension before collecting it; don't work from memory, because the APIs have quirks (coordinate order, rate limits, timeouts) that cost time when rediscovered.

## Always start with the audit

```
python3 .claude/skills/london-area-data/scripts/audit_areas.py          # all areas
python3 .claude/skills/london-area-data/scripts/audit_areas.py fg ce    # just these
```

It prints, per area, `OK`, `MISSING` (a dimension or required field is empty) or `CHECK` (present but suspicious: few shops, an empty shop group, a school far from the centre, ethnicity not summing to 100). Show the user the MISSING and CHECK lines before collecting anything, and agree what to fill. Run it again at the end; it is the definition of "done".

## Adding an area

1. **Agree the basics with the user**: the name, a two-letter `id` not already used (`ef`, `ro`, `ce`, ...), its `rank` (renumber the others if it slots in between), and the centre point (usually the high street or station).
2. **Wards** (dimension 2): pick the 2-6 council wards that make up the neighbourhood and add them to `wards.json`. Everything else is measured against these, so get the user to confirm the list.
3. **MSOAs** (dimension 3): the Census neighbourhoods that best overlap the wards, written like `Haringey 034, Haringey 022`.
4. Collect dimensions 2-8. `scripts/add_area.py spec.json` does wards, MSOAs, Census, crime, shops and the Rightmove id in one go from a small JSON spec (see its docstring; preview first, then `--write`). Then `scripts/schools_gias.py ... <ids> --write`, `scripts/property_prices.py <ids> --write`, `scripts/price_subareas.py`, then `scripts/crime_subareas.py --write` and `scripts/conservation_areas.py --write` (both need the new area's sub-areas; the second also uses `sales.csv`). If an area has no secondary inside its wards, add the nearest popular ones just outside with `schools_gias.py ... --nearby <id>:<URN>,<URN> --write` (it notes "Just outside the area's wards"). Ward names with an apostrophe (St Ann's) work in `add_area.py`.
5. Write the `why` text and the estimates (dimension 9) last, once the numbers are in, so the text reflects them.
6. Run the audit, then open the site locally (`python3 -m http.server`, http://localhost:8000) and check the area's card, outline, schools and shops.

## Filling gaps or refreshing

Work dimension by dimension across all areas, not area by area: one method and one time period per dimension keeps the areas comparable. When refreshing a dimension, refresh it for every area, and update the period in the text (for crime, `crime_rate_period` is written by `crime_subareas.py` and shown everywhere; refresh the 1-mile `crime_*` counts for the same months; for prices, `price_period`).

## Property prices and rents

Sale prices come from HM Land Registry Price Paid Data, which records every sale but **not the number of bedrooms**. Use property type as the proxy and say so wherever the figures are shown: flats are mostly 1-2 bed, terraced and semi-detached houses mostly 2-4 bed.

```
python3 .claude/skills/london-area-data/scripts/property_prices.py ce            # preview
python3 .claude/skills/london-area-data/scripts/property_prices.py ce fg --write # save to areas.csv
```

The script works out the area's postcode sectors from its ward outlines (or uses `postcode_sectors` if already filled), then takes median standard-sale prices for the last 24 months. Show the user the preview first; if a sector clearly belongs to the next neighbourhood, rerun with `--sectors "N8 8,N8 9"` and save. Medians from fewer than 10 sales are flagged as rough.

`--write` also saves every sale (street and postcode, no house numbers) to `data/sales.csv`. Then run `scripts/price_subareas.py` to rebuild the sub-area dataset behind the map's "Price level by neighbourhood" layer: one row per ONS LSOA (about 650 homes) with medians by type and a mix-adjusted **price level** (100 = typical for the shortlist), plus `price_level` per area. Always rerun it after adding or refreshing an area, because the level is relative to all areas' sales.

Rents: see `references/sources.md`, "Rents". There is no free official source at neighbourhood level, so record where each figure came from in `rent_source`.

## Crime by neighbourhood

```
python3 .claude/skills/london-area-data/scripts/crime_subareas.py --months 2025-10:2026-09 --cache <scratch>/police          # preview
python3 .claude/skills/london-area-data/scripts/crime_subareas.py --months 2025-10:2026-09 --cache <scratch>/police --write
```

It asks police.uk for every street-level crime in each area's sub-areas (the LSOAs in `subareas.csv`), month by month, places each crime in its sub-area by point-in-polygon, and divides by the sub-area's Census 2021 residents (Nomis TS001). It always redoes every area, so rates stay comparable. Writes `data/crime_subareas.csv` (per sub-area: residents, counts in six groups, top 3 streets), `data/crime_points.csv` (per police.uk "on or near" point) and the `crime_rate*` columns of `areas.csv`. "All" leaves out shoplifting, which piles onto shopping streets. Crime locations are anonymised to the nearest of a fixed set of points, so never present a point as an address.

## New developments

```
python3 .claude/skills/london-area-data/scripts/new_developments.py le bo     # preview some areas
python3 .claude/skills/london-area-data/scripts/new_developments.py --write   # rebuild for all areas
```

Joins approved schemes of 20+ homes from the GLA Planning London Datahub (inside the area's sub-areas; finished since 2023, started since 2020, approved since 2022) to Land Registry new-build sales since 2023 in the area's postcode sectors, grouped into buildings. Status: Selling (a sale in the last 6 months of Land Registry data), Sold, Being built, Finished (no sales: rented or affordable), Approved. Areas outside London have Land Registry buildings only. It needs `postcode_sectors`, so run it after `property_prices.py`; rerun it every few months, as it is the most time-sensitive dataset. Planning names are often addresses: the script prefers the Land Registry building name when a scheme has 3+ sales.

## Conservation areas

```
python3 .claude/skills/london-area-data/scripts/conservation_areas.py            # preview per area
python3 .claude/skills/london-area-data/scripts/conservation_areas.py --write    # save
python3 .claude/skills/london-area-data/scripts/conservation_areas.py --refresh --cache <scratch>/conservation --write   # new national data
```

`data/geo/conservation_region.json` is kept in the repo: every conservation area in London and the commuter belt, cut from the national file, with tidied names and council names. A new area inside that box needs no download: just run `--write`. If the area is outside the box, widen `REGION` in the script and run with `--refresh` (downloads ~60 MB). `--write` keeps the conservation areas that overlap an area's sub-areas (`geo/conservation.json`, with `areas` ids) and writes `conservation_count` and `conservation_sales_pct` (share of the area's sold homes in `sales.csv` that are inside one). Neighbouring councils sometimes designate the same name on each side of a border (two "Blackheath"s, two "Woodford Green"s): those are separate areas, not duplicates.

## Area guides (highlights with photos)

A guide is a short, photographic "best of" for one area: up to 10 places that genuinely make it attractive to live there (parks, beautiful streets, historic buildings, walks, leisure), shown as numbered markers on the map and in a photo dialog. Quality beats quantity: 7 strong entries are better than 10 with filler.

1. **Research first.** Use council park pages, conservation-area appraisals, Historic England / London Gardens Trust records and Wikipedia to pick the places, within about 5 km of the area centre. Write only facts two sources agree on; leave out disputed dates and claims.
2. **Photos.** For a whole area at once use `scripts/guide_build.py`: write a spec (places, Commons search words, coordinates, texts), run `sheet` to get one contact sheet with a row per place, look at it, then `build` with your picks (e.g. `0:a 3:c`); it downloads 1200 px photos with credits, geocodes and writes the guide. Search words often return the wrong place (other countries' mosques, castles, churches): check titles before choosing, and prefer `"q": "Category:<Commons category>"` for well-known places. Set `lat`/`lon` in the spec for anything Nominatim may not find by name. Single photos: `scripts/guide_photos.py sheet` builds a numbered contact sheet of large landscape photos from Wikimedia Commons (which includes Geograph). Look at every sheet and choose only photos that are sharp, well lit and clearly show the place; if none is good, try other search words or drop the highlight. Never use maps, signs, interiors, gravestones or grey snapshots. Then `guide_photos.py fetch` saves them at 1400 px with credits.
3. **Data.** `data/guides/<area id>.json`: `title`, `intro`, `updated`, and `items` with `id`, `n`, `name`, `kind` (park / street / history / walk / leisure), `lat`, `lon` (OpenStreetMap Nominatim), `km` from the main station, `blurb` (2 sentences), `tip` (1 practical sentence), `photo`, `w`, `h` and `credit` {`author`, `license`, `license_url`, `source`}. Add the area to `data/guides/index.json`. Every photo must keep its credit: the repository is public and the licences require it.

## Showing new data on the site

Adding columns to `areas.csv` changes nothing visible until the panel uses them. After collecting a new dimension for all areas, add it to the area card in `js/panel.js` (the `facts` grid or `statsHtml`), keep the wording short, and add a line to the "How to read this" notes in `index.html` saying where it comes from. Columns the panel does not use are harmless, so it is fine to collect first and display later.

## Rules that always apply

- **The repository is public.** Never write names of family members, a home address or postcode, an employer, income or health details into any file. Area texts stay neutral, e.g. "good for a family with a primary and a secondary child".
- **Keep the CSVs clean**: UTF-8, header row, one row per item, quotes only where a value contains a comma. Keep column order; append new columns at the end.
- **Coordinates**: `wards.json` and `stations.json` are `[lat, lon]`; GeoJSON files are `[lon, lat]`.
- **Mixed schools only**: single-sex schools go in `excluded.json`, not `schools.csv`.
- **Estimates are estimates**: rents bands, commute and family times are written as ranges with `~`, and the notes say so.
- Commit each dimension separately (e.g. "Add Land Registry prices for all areas") so a bad refresh is easy to revert.
