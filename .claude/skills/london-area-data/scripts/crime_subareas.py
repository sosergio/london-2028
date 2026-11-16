#!/usr/bin/env python3
"""Street-level crime per sub-area (LSOA) for every area, from the police.uk API.

For each area it asks police.uk for every street-level crime inside the bounding box of the area's
sub-areas (data/geo/subareas.json), month by month, then keeps the crimes whose "on or near" point falls
inside one of that area's sub-areas. Residents per sub-area come from the Census (Nomis TS001), so the
map can show crimes per 1,000 residents.

    python3 crime_subareas.py                 # all areas, last 12 months police.uk has
    python3 crime_subareas.py --months 2025-10:2026-09
    python3 crime_subareas.py --write         # save the files below (otherwise only print a summary)

Writes:
    data/crime_subareas.csv  one row per sub-area: residents, crimes by group, top streets
    data/crime_points.csv    one row per police.uk location point: street, crimes by group
    data/areas.csv           crime_rate* columns (per 1,000 residents, over all of the area's sub-areas)

Responses are cached in the scratch folder given by --cache (default /tmp/police-cache), so a rerun is quick.
"""
import argparse, csv, io, json, sys, time, urllib.error, urllib.parse, urllib.request
from collections import Counter, defaultdict
from pathlib import Path

UA = {"User-Agent": "london-2028-area-map/1.0 (github.com/sosergio/london-2028)"}
# police.uk categories folded into the six groups the site shows.
GROUP = {"anti-social-behaviour": "asb", "violent-crime": "violent", "robbery": "violent", "burglary": "burglary",
         "vehicle-crime": "vehicle", "bicycle-theft": "vehicle", "shoplifting": "shoplifting"}
GROUPS = ["asb", "violent", "burglary", "vehicle", "shoplifting", "other"]


def get(url, tries=5):
    for i in range(tries):
        try:
            return urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=120).read()
        except urllib.error.HTTPError as e:
            if e.code == 503:          # police.uk: more than 10,000 crimes in the polygon
                raise
            if i == tries - 1 or e.code not in (429, 500, 502, 504):
                raise
            time.sleep(3 * (i + 1))
        except Exception:
            if i == tries - 1:
                raise
            time.sleep(3 * (i + 1))


def crimes(box, month, cache):
    s, w, n, e = box
    f = Path(cache) / f"{month}_{s:.4f}_{w:.4f}_{n:.4f}_{e:.4f}.json"
    if f.exists():
        return json.loads(f.read_text())
    poly = f"{s},{w}:{s},{e}:{n},{e}:{n},{w}"
    try:
        out = json.loads(get(f"https://data.police.uk/api/crimes-street/all-crime?date={month}&poly={poly}"))
    except urllib.error.HTTPError as err:
        if err.code != 503:
            raise
        mlat, mlon = (s + n) / 2, (w + e) / 2   # too many crimes: split the box in four
        out = [c for b in [(s, w, mlat, mlon), (s, mlon, mlat, e), (mlat, w, n, mlon), (mlat, mlon, n, e)]
               for c in crimes(b, month, cache)]
    f.write_text(json.dumps(out))
    time.sleep(0.15)
    return out


def inside(pt, ring):
    x, y = pt; ok = False
    for (x1, y1), (x2, y2) in zip(ring, ring[1:] + ring[:1]):
        if (y1 > y) != (y2 > y) and x < (x2 - x1) * (y - y1) / (y2 - y1) + x1:
            ok = not ok
    return ok


def residents(codes):
    out = {}
    for i in range(0, len(codes), 100):
        q = urllib.parse.urlencode({"date": "latest", "geography": ",".join(codes[i:i + 100]), "c2021_restype_3": 0,
                                    "measures": 20100, "select": "geography_code,obs_value"})
        for r in csv.DictReader(io.StringIO(get("https://www.nomisweb.co.uk/api/v01/dataset/NM_2021_1.data.csv?" + q).decode())):
            out[r["GEOGRAPHY_CODE"]] = int(r["OBS_VALUE"])
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--months", help="YYYY-MM:YYYY-MM (default: the last 12 months police.uk has)")
    ap.add_argument("--cache", default="/tmp/police-cache")
    ap.add_argument("--write", action="store_true")
    a = ap.parse_args()
    Path(a.cache).mkdir(parents=True, exist_ok=True)

    dates = sorted(d["date"] for d in json.loads(get("https://data.police.uk/api/crimes-street-dates")))
    if a.months:
        lo, hi = a.months.split(":"); months = [d for d in dates if lo <= d <= hi]
    else:
        months = dates[-12:]
    print("months", months[0], "to", months[-1], f"({len(months)})")

    sub = list(csv.DictReader(open("data/subareas.csv", encoding="utf-8")))
    area_of = {r["id"]: r["area_id"] for r in sub}
    geo = {f["properties"]["id"]: f["geometry"]["coordinates"][0] for f in json.load(open("data/geo/subareas.json"))["features"]}
    by_area = defaultdict(list)
    for code, aid in area_of.items():
        by_area[aid].append(code)

    counts = defaultdict(Counter)             # lsoa -> group -> n
    streets = defaultdict(Counter)            # lsoa -> street -> n
    points = {}                               # (lat, lon) -> row
    seen = set()
    for aid, codes in by_area.items():
        rings = [(c, geo[c], min(p[0] for p in geo[c]), max(p[0] for p in geo[c]), min(p[1] for p in geo[c]), max(p[1] for p in geo[c])) for c in codes]
        box = (min(r[4] for r in rings) - 0.001, min(r[2] for r in rings) - 0.001, max(r[5] for r in rings) + 0.001, max(r[3] for r in rings) + 0.001)
        n_area = 0
        for m in months:
            for c in crimes(box, m, a.cache):
                if c["id"] in seen:
                    continue
                lat, lon = float(c["location"]["latitude"]), float(c["location"]["longitude"])
                hit = next((code for code, ring, x0, x1, y0, y1 in rings if x0 <= lon <= x1 and y0 <= lat <= y1 and inside((lon, lat), ring)), None)
                if not hit:
                    continue
                seen.add(c["id"]); n_area += 1
                g = GROUP.get(c["category"], "other")
                street = c["location"]["street"]["name"].removeprefix("On or near ").strip() or "Unnamed place"
                counts[hit][g] += 1; streets[hit][street] += 1
                p = points.setdefault((round(lat, 6), round(lon, 6)), {"area_id": aid, "lsoa": hit, "street": street, **{k: 0 for k in GROUPS}})
                p[g] += 1
        print(f"{aid}: {n_area} crimes in {len(codes)} sub-areas")

    pop = residents(sorted(area_of))
    rows = []
    for r in sub:
        c = counts[r["id"]]
        rows.append({"area_id": r["area_id"], "id": r["id"], "residents": pop.get(r["id"], ""), "total": sum(c.values()),
                     **{k: c[k] for k in GROUPS},
                     "top_streets": "; ".join(f"{s} ({n})" for s, n in streets[r["id"]].most_common(3))})

    # Area rates over all of the area's sub-areas. "All" leaves out shoplifting, which piles onto shopping streets.
    rates = {}
    for aid in by_area:
        rs = [r for r in rows if r["area_id"] == aid]; p = sum(r["residents"] or 0 for r in rs)
        tot = lambda *ks: sum(r[k] for r in rs for k in ks)
        per = lambda v: round(1000 * v / p, 1) if p else ""
        rates[aid] = {"crime_rate": per(tot("total") - tot("shoplifting")), "crime_rate_burglary": per(tot("burglary")),
                      "crime_rate_violent": per(tot("violent")), "crime_rate_asb": per(tot("asb")),
                      "crime_rate_period": f"{months[0]}:{months[-1]}"}
        print(aid, rates[aid])

    if not a.write:
        return
    with open("data/crime_subareas.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0])); w.writeheader(); w.writerows(rows)
    with open("data/crime_points.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f); w.writerow(["area_id", "lsoa", "lat", "lon", "street", "n", *GROUPS])
        for (lat, lon), p in sorted(points.items(), key=lambda kv: (kv[1]["area_id"], kv[1]["lsoa"])):
            w.writerow([p["area_id"], p["lsoa"], lat, lon, p["street"], sum(p[k] for k in GROUPS), *[p[k] for k in GROUPS]])
    raw = open("data/areas.csv", encoding="utf-8", newline="").read()
    eol = "\r\n" if "\r\n" in raw else "\n"
    ar = list(csv.DictReader(io.StringIO(raw)))
    cols = list(ar[0]) + [k for k in next(iter(rates.values())) if k not in ar[0]]
    for r in ar:
        r.update(rates.get(r["id"], {}))
    with open("data/areas.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=cols, lineterminator=eol); w.writeheader(); w.writerows(ar)
    print("wrote data/crime_subareas.csv, data/crime_points.csv, areas.csv crime_rate*")


if __name__ == "__main__":
    sys.exit(main())
