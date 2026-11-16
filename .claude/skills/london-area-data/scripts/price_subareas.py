#!/usr/bin/env python3
"""Build the sub-area price dataset from data/sales.csv: how expensive each neighbourhood is.

Usage (from the repo root, after property_prices.py --write):
    python3 .claude/skills/london-area-data/scripts/price_subareas.py

Sub-areas are 2021 LSOAs (ONS Census neighbourhoods of about 1,500 people, ~650 homes), the smallest
unit with free official outlines; postcode sectors have none. Each is named after its main postcode sector
and street so it reads like a postcode sub-area ("N8 9 · Weston Park").

Price level (mix-adjusted, so a flat-heavy street is not "cheap" just for having flats):
    for each sale, ratio = price / median price of that property type across ALL areas' sales
    level = 100 × median ratio of the sales in the sub-area (100 = typical for the shortlist)
Sub-areas with fewer than MIN_SALES sales get no level (shown as "too few sales").

Writes:
    data/subareas.csv           area_id, id, name, lsoa_name, sales, median_flat, median_terraced, median_semi,
                                median_detached, level, band
    data/geo/subareas.json      GeoJSON outlines (lon, lat), properties.id = LSOA code
    data/areas.csv              adds price_level (same formula over the whole area)
Standard library only.
"""
import csv, json, statistics, sys, time, urllib.parse, urllib.request
from collections import Counter, defaultdict
from pathlib import Path

DATA = Path.cwd() / "data"
MIN_SALES = 8
BANDS = [80, 95, 110, 130, 160]  # band 0: <80, 1: 80-95, 2: 95-110, 3: 110-130, 4: 130-160, 5: 160+; keep in sync with js/map.js
LSOA_LAYER = "https://services1.arcgis.com/ESMARspQHYMw9BZ9/ArcGIS/rest/services/LSOA_2021_EW_BFE_V10_RUC/FeatureServer/3/query"
UA = {"User-Agent": "london-2028-area-map (github.com/sosergio/london-2028)"}


def fetch_outlines(codes):
    feats = []
    codes = sorted(codes)
    for i in range(0, len(codes), 50):
        q = urllib.parse.urlencode({
            "where": "LSOA21CD IN (%s)" % ",".join(f"'{c}'" for c in codes[i:i + 50]),
            "outFields": "LSOA21CD,LSOA21NM", "outSR": 4326, "f": "geojson",
            "geometryPrecision": 5, "maxAllowableOffset": 0.00003,  # about 3 m: sharp at street zoom, small file
        })
        for attempt in range(3):
            try:
                with urllib.request.urlopen(urllib.request.Request(f"{LSOA_LAYER}?{q}", headers=UA), timeout=120) as r:
                    feats += json.load(r)["features"]
                break
            except Exception:
                if attempt == 2:
                    raise
                time.sleep(3)
    return feats


def band(level):
    return sum(level >= b for b in BANDS)


def main():
    with open(DATA / "sales.csv", newline="", encoding="utf-8") as f:
        sales = [r for r in csv.DictReader(f) if r.get("lsoa")]
    if not sales:
        sys.exit("data/sales.csv is empty or has no lsoa column: run property_prices.py --write first")
    for s in sales:
        s["price"] = int(s["price"])

    base = {t: statistics.median([s["price"] for s in sales if s["type"] == t]) for t in {s["type"] for s in sales}}
    for s in sales:
        s["ratio"] = s["price"] / base[s["type"]]
    print("Shortlist medians by type: " + ", ".join(f"{t} £{v:,.0f}" for t, v in sorted(base.items())))

    # Each LSOA belongs to the area with most of its sales (sector lists of neighbouring areas can overlap).
    by_lsoa = defaultdict(list)
    seen = set()
    for s in sales:
        key = (s["date"], s["price"], s["postcode"], s["street"], s["type"])
        if key in seen:
            continue
        seen.add(key)
        by_lsoa[s["lsoa"]].append(s)

    outlines = {f["properties"]["LSOA21CD"]: f for f in fetch_outlines(by_lsoa)}
    rows, feats = [], []
    for code, ss in by_lsoa.items():
        if code not in outlines:
            continue
        area = Counter(s["area_id"] for s in ss).most_common(1)[0][0]
        sector = Counter(s["postcode"][:-2].strip() for s in ss).most_common(1)[0][0]
        street = Counter(s["street"] for s in ss if s["street"]).most_common(1)
        med = lambda t: (int(statistics.median(p)) if (p := [s["price"] for s in ss if s["type"] == t]) else "")
        level = round(100 * statistics.median([s["ratio"] for s in ss])) if len(ss) >= MIN_SALES else ""
        rows.append({
            "area_id": area, "id": code, "name": f"{sector} · {street[0][0]}" if street else sector,
            "lsoa_name": outlines[code]["properties"]["LSOA21NM"], "sales": len(ss),
            "median_flat": med("flat"), "median_terraced": med("terraced"), "median_semi": med("semi"),
            "median_detached": med("detached"), "level": level, "band": band(level) if level != "" else "",
        })
        f = outlines[code]
        feats.append({"type": "Feature", "properties": {"id": code}, "geometry": f["geometry"]})

    rows.sort(key=lambda r: (r["area_id"], r["id"]))
    cols = list(rows[0])
    with open(DATA / "subareas.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=cols, lineterminator="\n"); w.writeheader(); w.writerows(rows)
    (DATA / "geo" / "subareas.json").write_text(json.dumps({"type": "FeatureCollection", "features": feats}, separators=(",", ":")), encoding="utf-8")

    # Area-level price level, same formula.
    path = DATA / "areas.csv"
    with open(path, newline="", encoding="utf-8") as f:
        rd = csv.DictReader(f); fields = list(rd.fieldnames); areas = list(rd)
    if "price_level" not in fields:
        fields.append("price_level")
    for a in areas:
        rs = [s["ratio"] for s in sales if s["area_id"] == a["id"]]
        a["price_level"] = round(100 * statistics.median(rs)) if rs else ""
    with open(path, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=fields, lineterminator="\n"); w.writeheader()
        for a in areas:
            w.writerow({k: a.get(k, "") for k in fields})

    per_area = Counter(r["area_id"] for r in rows)
    print(f"{len(rows)} sub-areas ({sum(1 for r in rows if r['level'] != '')} with a price level); per area: {dict(per_area)}")
    print("Area price levels: " + ", ".join(f"{a['id']} {a['price_level']}" for a in sorted(areas, key=lambda a: -int(a['price_level'] or 0))))


if __name__ == "__main__":
    main()
