#!/usr/bin/env python3
"""Add (or refresh) areas from a small JSON spec: wards, Census, crime, shops and the Rightmove id.

Usage (from the repo root):
    python3 .claude/skills/london-area-data/scripts/add_area.py spec.json            # preview
    python3 .claude/skills/london-area-data/scripts/add_area.py spec.json --write    # save

spec.json: a list of areas, e.g.
  [{"id": "ly", "rank": 14, "name": "Leytonstone", "sub": "E11 · Waltham Forest",
    "lat": 51.5684, "lon": 0.0083,                       # centre: high street or station
    "wards": [["Waltham Forest", "Leytonstone"], ["Waltham Forest", "Cann Hall"]],
    "rightmove": "Leytonstone, East London",             # typeahead text; the first REGION match is used
    "rent": "...", "commute": "...", "family": "...", "lifestyle": "...", "green": "...", "why": "..."}]
Estimate fields (rent ... why) are optional and copied as given; anything missing stays empty for the audit.

What it collects (see references/sources.md for the sources and pitfalls):
  wards      ONS WD_DEC_2025_UK_BGC outlines → data/geo/wards.json ([lat, lon], largest ring, 4 dp)
  msoas      2021 MSOAs covering the wards: a grid of points inside the wards is reverse-geocoded with
             postcodes.io; MSOAs holding at least 15% of the points are kept (at most 3)
  census     Nomis TS021 (NM_2041_1) ethnicity and TS006 (NM_2026_1) density; area density =
             total residents / total area (area of each MSOA = residents / its density)
  crime      police.uk street crime within 1 mile of the centre, the same 12 months as the other areas
             (CRIME_MONTHS below)
  shops      OpenStreetMap via Overpass, 2 km around the centre, the five groups → data/shops.csv
             (rows for these areas are replaced)
  rightmove  locationIdentifier from Rightmove's location typeahead
Standard library only.
"""
import argparse, csv, json, math, sys, time, urllib.parse, urllib.request
from collections import Counter
from pathlib import Path

DATA = Path.cwd() / "data"
UA = {"User-Agent": "london-2028-area-map (github.com/sosergio/london-2028)"}
WARDS_URL = "https://services1.arcgis.com/ESMARspQHYMw9BZ9/ArcGIS/rest/services/WD_DEC_2025_UK_BGC/FeatureServer/0/query"
OVERPASS = ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter"]
CRIME_MONTHS = [f"{y}-{m:02d}" for y, m in [(2025, 10), (2025, 11), (2025, 12)] + [(2026, m) for m in range(1, 10)]]  # Oct 2025-Sep 2026
CRIME_KEYS = ["anti-social-behaviour", "burglary", "robbery", "vehicle-crime", "violent-crime", "shoplifting"]
UP_BRANDS = ("waitrose", "marks & spencer", "m&s", "planet organic", "whole foods", "as nature intended")
DISC_BRANDS = ("aldi", "lidl", "iceland")


def get(url, data=None, headers=None, tries=4, raw=False):
    for i in range(tries):
        try:
            req = urllib.request.Request(url, data=data, headers={**UA, **(headers or {})})
            with urllib.request.urlopen(req, timeout=180) as r:
                body = r.read().decode("utf-8")
                return body if raw else json.loads(body)
        except Exception as e:
            if i == tries - 1:
                raise
            time.sleep(3 * (i + 1))


def inside(pt, ring):
    y, x = pt
    hit = False
    for (y1, x1), (y2, x2) in zip(ring, ring[1:] + ring[:1]):
        if (y1 > y) != (y2 > y) and x < (x2 - x1) * (y - y1) / (y2 - y1) + x1:
            hit = not hit
    return hit


def ring_area(ring):
    return abs(sum(a[1] * b[0] - b[1] * a[0] for a, b in zip(ring, ring[1:] + ring[:1]))) / 2


# ---------- wards ----------
def fetch_wards(wards):
    out = []
    for lad, name in wards:
        sql = lambda v: v.replace("'", "''")      # St Ann's, King's Park
        q = {"where": f"LAD25NM='{sql(lad)}' AND WD25NM='{sql(name)}'", "outFields": "WD25NM", "outSR": 4326, "f": "geojson"}
        fs = get(WARDS_URL + "?" + urllib.parse.urlencode(q))["features"]
        if not fs:
            sys.exit(f"ward not found: {lad} / {name}")
        g = fs[0]["geometry"]
        rings = [g["coordinates"][0]] if g["type"] == "Polygon" else [p[0] for p in g["coordinates"]]
        ring = max(rings, key=ring_area)
        out.append([name, [[round(lat, 4), round(lon, 4)] for lon, lat in ring]])
    return out


# ---------- MSOAs and Census ----------
def msoas_for(ward_rings, step=0.002):
    pts = []
    for _, ring in ward_rings:
        lats, lons = [p[0] for p in ring], [p[1] for p in ring]
        la = min(lats)
        while la <= max(lats):
            lo = min(lons)
            while lo <= max(lons):
                if inside((la, lo), ring):
                    pts.append((la, lo))
                lo += step * 1.6
            la += step
    c, names = Counter(), {}
    for i in range(0, len(pts), 100):
        body = json.dumps({"geolocations": [{"latitude": a, "longitude": b, "limit": 1, "radius": 300} for a, b in pts[i:i + 100]]}).encode()
        for r in get("https://api.postcodes.io/postcodes", body, {"Content-Type": "application/json"})["result"]:
            if r["result"]:
                res = r["result"][0]
                code = res["codes"].get("msoa21") or res["codes"].get("msoa")
                c[code] += 1; names[code] = res["msoa"]
    total = sum(c.values()) or 1
    keep = [code for code, n in c.most_common(3) if n / total >= 0.15]
    return keep, [names[k] for k in keep]


def nomis(dataset, codes):
    url = f"https://www.nomisweb.co.uk/api/v01/dataset/{dataset}.data.csv?date=latest&measures=20100&geography={','.join(codes)}"
    return list(csv.DictReader(get(url, raw=True).splitlines()))


def census(codes):
    eth = nomis("NM_2041_1", codes)
    dens = nomis("NM_2026_1", codes)
    by = {c: {} for c in codes}
    for r in eth:
        by[r["GEOGRAPHY_CODE"]][r["C2021_ETH_20_CODE"]] = float(r["OBS_VALUE"])
    density = {r["GEOGRAPHY_CODE"]: float(r["OBS_VALUE"]) for r in dens if r["CELL_CODE"] == "0"}
    pop = {c: by[c]["0"] for c in codes}
    area = {c: pop[c] / density[c] for c in codes}
    P = sum(pop.values())
    tot = lambda code: sum(by[c].get(code, 0) for c in codes)
    white_british, white = tot("_13"), tot("1004")
    pct = lambda v: round(100 * v / P, 1)
    return {
        "residents": int(P), "people_per_km2": round(P / sum(area.values())),
        "density_min": round(min(density.values())), "density_max": round(max(density.values())),
        "pct_whiteBritish": pct(white_british), "pct_whiteOther": pct(white - white_british),
        "pct_asian": pct(tot("1001")), "pct_black": pct(tot("1002")), "pct_mixed": pct(tot("1003")), "pct_other": pct(tot("1005")),
    }


# ---------- crime ----------
def crime(lat, lon):
    c = Counter()
    for m in CRIME_MONTHS:
        for r in get(f"https://data.police.uk/api/crimes-street/all-crime?lat={lat}&lng={lon}&date={m}"):
            c[r["category"]] += 1
        time.sleep(0.2)
    out = {"crime_total": sum(c.values())}
    out.update({"crime_" + k: c[k] for k in CRIME_KEYS})
    return out


# ---------- shops ----------
def shops(aid, lat, lon):
    a = f"around:2000,{lat},{lon}"
    q = f"""[out:json][timeout:120];(
      nwr({a})["shop"~"^(supermarket|convenience|organic|health_food)$"];
      nwr({a})["shop"~"^(bakery|deli|butcher|seafood|cheese|pastry)$"];
      nwr({a})["amenity"~"^(cinema|theatre)$"];
      nwr({a})["shop"="books"];
      nwr({a})["leisure"~"^(fitness_centre|sports_centre|swimming_pool)$"];
    );out center tags;"""
    data = None
    for url in OVERPASS:
        try:
            data = get(url, urllib.parse.urlencode({"data": q}).encode())
            break
        except Exception as e:
            print(f"  overpass {url}: {e}", file=sys.stderr)
    if data is None:
        sys.exit("Overpass failed on every mirror; try again later")
    rows, seen = [], []
    for el in data["elements"]:
        t = el.get("tags", {})
        name = t.get("name") or t.get("brand")
        if not name:
            continue
        brand = (t.get("brand", "") + " " + name).lower()
        shop, amen, leis = t.get("shop", ""), t.get("amenity", ""), t.get("leisure", "")
        g = kind = None
        if shop in ("supermarket", "convenience") and any(b in brand for b in UP_BRANDS):
            g, kind = "up", shop
        elif shop in ("organic", "health_food") or (shop in ("supermarket", "convenience") and t.get("organic") == "only"):
            g, kind = "up", "organic"
        elif shop in ("supermarket", "convenience") and any(brand.startswith(b) or f" {b}" in brand for b in DISC_BRANDS):
            g, kind = "disc", shop
        elif shop in ("bakery", "deli", "butcher", "seafood", "cheese", "pastry"):
            g, kind = "bake", shop
        elif amen in ("cinema", "theatre") or shop == "books":
            g, kind = "cult", amen or "books"
        elif leis == "fitness_centre":
            g, kind = "gym", "fitness centre"
        elif leis == "swimming_pool" and t.get("access", "yes") in ("yes", "public", "customers", "permissive"):
            g, kind = "gym", "swimming pool"
        elif leis == "sports_centre" and ("swimming" in t.get("sport", "") or any(w in name.lower() for w in ("leisure", "pool", "lido"))):
            g, kind = "gym", "leisure centre"
        if not g:
            continue
        la = el.get("lat") or el.get("center", {}).get("lat")
        lo = el.get("lon") or el.get("center", {}).get("lon")
        # Same name within ~50 m is one place mapped twice (e.g. a node and a building).
        if any(n == name.lower() and abs(la - y) < 0.00045 and abs(lo - x) < 0.0007 for n, y, x in seen):
            continue
        seen.append((name.lower(), la, lo))
        rows.append({"area_id": aid, "name": name, "group": g, "type": kind.replace("_", " "), "lat": round(la, 5), "lon": round(lo, 5)})
    return rows


def rightmove_id(text):
    q = urllib.parse.urlencode({"query": text, "limit": 10})
    for m in get(f"https://los.rightmove.co.uk/typeahead?{q}", headers={"User-Agent": "Mozilla/5.0"})["matches"]:
        if m["type"] == "REGION":
            return f"REGION^{m['id']}", m["displayName"]
    return "", ""


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("spec"); ap.add_argument("--write", action="store_true")
    ap.add_argument("--skip", default="", help="comma list of steps to skip: wards,census,crime,shops,rightmove")
    args = ap.parse_args()
    skip = set(filter(None, args.skip.split(",")))
    spec = json.loads(Path(args.spec).read_text())

    with open(DATA / "areas.csv", newline="", encoding="utf-8") as f:
        rd = csv.DictReader(f); fields = list(rd.fieldnames); areas = list(rd)
    wards = json.loads((DATA / "geo" / "wards.json").read_text(encoding="utf-8"))
    with open(DATA / "shops.csv", newline="", encoding="utf-8") as f:
        rd = csv.DictReader(f); shop_fields = list(rd.fieldnames); shop_rows = list(rd)
    byid = {a["id"]: a for a in areas}
    new_shops = {}

    for s in spec:
        aid = s["id"]
        row = byid.get(aid) or {k: "" for k in fields}
        if aid not in byid:
            areas.append(row); byid[aid] = row
        for k in ("id", "rank", "name", "sub", "lat", "lon", "rent", "commute", "family", "lifestyle", "green", "why"):
            if k in s:
                row[k] = s[k]
        print(f"\n{aid} {s['name']}")
        if "wards" not in skip:
            wards[aid] = fetch_wards(s["wards"])
            print(f"  wards: {', '.join(w[0] for w in wards[aid])}")
        if "census" not in skip:
            codes, names = msoas_for(wards[aid])
            row["msoas"] = ", ".join(names)
            row.update({k: v for k, v in census(codes).items()})
            print(f"  census: {row['msoas']}: {row['residents']} residents, {row['people_per_km2']}/km², {row['pct_whiteBritish']}% WB")
        if "crime" not in skip:
            row.update(crime(s["lat"], s["lon"]))
            print(f"  crime: {row['crime_total']} in 12 months ({row['crime_violent-crime']} violent)")
        if "shops" not in skip:
            new_shops[aid] = shops(aid, s["lat"], s["lon"])
            g = Counter(r["group"] for r in new_shops[aid])
            print(f"  shops: {len(new_shops[aid])} ({', '.join(f'{k} {g[k]}' for k in ('up', 'bake', 'cult', 'gym', 'disc'))})")
        if "rightmove" not in skip and s.get("rightmove"):
            row["rightmove_id"], shown = rightmove_id(s["rightmove"])
            print(f"  rightmove: {row['rightmove_id']} ({shown})")

    if args.write:
        areas.sort(key=lambda a: int(float(a["rank"] or 999)))
        with open(DATA / "areas.csv", "w", newline="", encoding="utf-8") as f:
            w = csv.DictWriter(f, fieldnames=fields, lineterminator="\n"); w.writeheader()
            for a in areas:
                w.writerow({k: a.get(k, "") for k in fields})
        (DATA / "geo" / "wards.json").write_text(json.dumps(wards, ensure_ascii=False), encoding="utf-8")
        if new_shops:
            kept = [r for r in shop_rows if r["area_id"] not in new_shops]
            eol = "\r\n" if b"\r\n" in (DATA / "shops.csv").read_bytes()[:500] else "\n"  # keep the file's line endings
            with open(DATA / "shops.csv", "w", newline="", encoding="utf-8") as f:
                w = csv.DictWriter(f, fieldnames=shop_fields, lineterminator=eol); w.writeheader()
                w.writerows(kept + [r for rows in new_shops.values() for r in rows])
        print("\nWritten. Next: schools_gias.py, property_prices.py --write, price_subareas.py, then the audit.")


if __name__ == "__main__":
    main()
