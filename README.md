# London 2028: areas and schools map

A static map of shortlisted London areas and their mixed state schools, for a September 2028 move. Open `index.html` through any web server (GitHub Pages serves it as is).

## Editing the data

All data is in `data/`. Edit a file, commit, and the page shows the change on the next load. No build step.

| File | What it holds |
|---|---|
| `data/areas.csv` | One row per area: rank, rent, commute, notes, Census 2021 residents, density and ethnicity, and 12 months of police.uk crime within 1 mile of the centre |
| `data/schools.csv` | One row per school: area, phase (P primary, S secondary, A all-through), faith (Catholic, CofE, None), pupils, Ofsted (colour: O outstanding, G good, W needs attention, N not rated), location, catchment distance in miles if known |
| `data/shops.csv` | Shops and places from OpenStreetMap. `group` is one of: up (Waitrose, M&S, organic), bake (bakeries, delis, butchers), cult (cinemas, theatres, books), gym, disc (Aldi, Lidl, Iceland) |
| `data/excluded.json` | Boys-only or girls-only schools left out |
| `data/geo/` | Ward outlines per area (ONS, Dec 2025), borough borders, Tube lines and stations |

The `area_id` in schools.csv and shops.csv must match an `id` in areas.csv, and the same id must exist in `data/geo/wards.json` for the area outline.

## Sources

Get Information about Schools (DfE), Ofsted, Census 2021 via Nomis (TS006 density, TS021 ethnicity), police.uk, OpenStreetMap, ONS boundaries. Basemap: OpenStreetMap and CARTO. Rents and journey times are estimates.

## Next step

See `INSTRUCTIONS.md` for the plan to move the map from Leaflet to Google Maps.
