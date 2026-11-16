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
| 4 | Crime, 12 months within 1 mile | `areas.csv` (`crime_*`) | police.uk API |
| 5 | Schools: all mixed state primaries and secondaries in the wards, any Ofsted rating | `schools.csv` (+ single-sex ones in `excluded.json`) | `scripts/schools_gias.py` (GIAS + Ofsted), council admissions for catchment |
| 6 | Shops and places, 5 groups | `shops.csv` | OpenStreetMap (Overpass, Nominatim fallback) |
| 7 | Sale prices: area medians, every sale, sub-area price levels | `areas.csv` (`postcode_sectors`, `price_*`, `price_level`), `sales.csv`, `subareas.csv`, `geo/subareas.json` | Land Registry: `scripts/property_prices.py --write`, then `scripts/price_subareas.py` |
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
4. Collect dimensions 2-8. `scripts/add_area.py spec.json` does wards, MSOAs, Census, crime, shops and the Rightmove id in one go from a small JSON spec (see its docstring; preview first, then `--write`). Then `scripts/schools_gias.py ... <ids> --write`, `scripts/property_prices.py <ids> --write` and `scripts/price_subareas.py`. If an area has no secondary inside its wards, add the nearest popular ones just outside and say so in `note`.
5. Write the `why` text and the estimates (dimension 9) last, once the numbers are in, so the text reflects them.
6. Run the audit, then open the site locally (`python3 -m http.server`, http://localhost:8000) and check the area's card, outline, schools and shops.

## Filling gaps or refreshing

Work dimension by dimension across all areas, not area by area: one method and one time period per dimension keeps the areas comparable. When refreshing a dimension, refresh it for every area, and update the period in the text (for crime, the "Oct 2025–Sep 2026" line in `js/panel.js`; for prices, `price_period`).

## Property prices and rents

Sale prices come from HM Land Registry Price Paid Data, which records every sale but **not the number of bedrooms**. Use property type as the proxy and say so wherever the figures are shown: flats are mostly 1-2 bed, terraced and semi-detached houses mostly 2-4 bed.

```
python3 .claude/skills/london-area-data/scripts/property_prices.py ce            # preview
python3 .claude/skills/london-area-data/scripts/property_prices.py ce fg --write # save to areas.csv
```

The script works out the area's postcode sectors from its ward outlines (or uses `postcode_sectors` if already filled), then takes median standard-sale prices for the last 24 months. Show the user the preview first; if a sector clearly belongs to the next neighbourhood, rerun with `--sectors "N8 8,N8 9"` and save. Medians from fewer than 10 sales are flagged as rough.

`--write` also saves every sale (street and postcode, no house numbers) to `data/sales.csv`. Then run `scripts/price_subareas.py` to rebuild the sub-area dataset behind the map's "Price level by neighbourhood" layer: one row per ONS LSOA (about 650 homes) with medians by type and a mix-adjusted **price level** (100 = typical for the shortlist), plus `price_level` per area. Always rerun it after adding or refreshing an area, because the level is relative to all areas' sales.

Rents: see `references/sources.md`, "Rents". There is no free official source at neighbourhood level, so record where each figure came from in `rent_source`.

## Area guides (highlights with photos)

A guide is a short, photographic "best of" for one area: up to 10 places that genuinely make it attractive to live there (parks, beautiful streets, historic buildings, walks, leisure), shown as numbered markers on the map and in a photo dialog. Quality beats quantity: 7 strong entries are better than 10 with filler.

1. **Research first.** Use council park pages, conservation-area appraisals, Historic England / London Gardens Trust records and Wikipedia to pick the places, within about 5 km of the area centre. Write only facts two sources agree on; leave out disputed dates and claims.
2. **Photos.** `scripts/guide_photos.py sheet` builds a numbered contact sheet of large landscape photos from Wikimedia Commons (which includes Geograph). Look at every sheet and choose only photos that are sharp, well lit and clearly show the place; if none is good, try other search words or drop the highlight. Never use maps, signs, interiors, gravestones or grey snapshots. Then `guide_photos.py fetch` saves them at 1400 px with credits.
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
