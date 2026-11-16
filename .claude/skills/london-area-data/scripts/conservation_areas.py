#!/usr/bin/env python3
"""Conservation areas for every area, from the national dataset on planning.data.gov.uk.

Two steps, so a new area needs no download:

    python3 conservation_areas.py --refresh    # download England's file (~60 MB) and rewrite the regional extract
    python3 conservation_areas.py              # preview: which conservation areas touch each area
    python3 conservation_areas.py --write      # save the files below

Files:
    data/geo/conservation_region.json  every conservation area in London and the commuter belt (the kept source,
                                       about 1,600 areas; not loaded by the site). --refresh rewrites it.
    data/geo/conservation.json         the ones that touch an area's neighbourhoods (data/geo/subareas.json),
                                       with the ids of the areas they touch; this is what the map shows
    data/areas.csv                     conservation_count, conservation_sales_pct (share of the area's sold
                                       homes in data/sales.csv that are inside a conservation area)

If a new area lies outside the region box (REGION below), widen it and run --refresh.
"""
import argparse, csv, io, json, sys, urllib.request
from collections import defaultdict
from pathlib import Path

UA = {"User-Agent": "london-2028-area-map/1.0 (github.com/sosergio/london-2028)"}
NATIONAL = "https://files.planning.data.gov.uk/dataset/conservation-area.geojson"
COUNCILS = "https://www.planning.data.gov.uk/entity.json?dataset=local-authority&limit=500&field=entity&field=name"
REGION = (-0.65, 51.25, 0.40, 51.82)          # lon/lat box: Greater London plus Woking, St Albans, Brentwood
REGION_FILE, SITE_FILE = Path("data/geo/conservation_region.json"), Path("data/geo/conservation.json")


def tidy(name):
    """'ENFIELD TOWN' -> 'Enfield Town'; 'The Oval Conservation Area' -> 'The Oval'."""
    n = " ".join((name or "").split())
    if n.isupper():
        n = " ".join(w if len(w) <= 2 and w not in ("OF", "ST") else w.capitalize() for w in n.split()).replace("Of ", "of ")
    for suffix in (" Conservation Area", " conservation area", " CA"):
        n = n.removesuffix(suffix)
    return n.strip()


def get(url):
    return urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=300).read()


def points(c):
    if isinstance(c[0], (int, float)):
        yield c
    else:
        for x in c:
            yield from points(x)


def rnd(c, n=5):
    return [round(c[0], n), round(c[1], n)] if isinstance(c[0], (int, float)) else [rnd(x, n) for x in c]


def rings_of(g):
    """Outer rings and holes as (outer, [holes]) per polygon."""
    polys = [g["coordinates"]] if g["type"] == "Polygon" else g["coordinates"]
    return [(p[0], p[1:]) for p in polys]


def inside(pt, ring):
    x, y = pt; ok = False
    for (x1, y1), (x2, y2) in zip(ring, ring[1:] + ring[:1]):
        if (y1 > y) != (y2 > y) and x < (x2 - x1) * (y - y1) / (y2 - y1) + x1:
            ok = not ok
    return ok


def in_geom(pt, polys):
    return any(inside(pt, o) and not any(inside(pt, h) for h in hs) for o, hs in polys)


def bbox(pts):
    xs = [p[0] for p in pts]; ys = [p[1] for p in pts]
    return min(xs), min(ys), max(xs), max(ys)


def overlap(a, b):
    return a[0] <= b[2] and b[0] <= a[2] and a[1] <= b[3] and b[1] <= a[3]


def refresh(cache):
    f = Path(cache) / "conservation-area.geojson"
    if not f.exists():
        print("downloading", NATIONAL)
        f.write_bytes(get(NATIONAL))
    councils = {str(e["entity"]): e["name"] for e in json.loads(get(COUNCILS))["entities"]}
    keep = []
    for ft in json.loads(f.read_text())["features"]:
        g = ft.get("geometry")
        if not g:
            continue
        x0, y0, x1, y1 = bbox(list(points(g["coordinates"])))
        if not overlap((x0, y0, x1, y1), REGION):
            continue
        p = ft["properties"]
        keep.append({"type": "Feature", "properties": {
            "name": tidy(p.get("name")), "ref": p.get("reference") or "",
            "council": councils.get(str(p.get("organisation-entity")), ""),
            "designated": (p.get("start-date") or "")[:4], "url": p.get("documentation-url") or ""},
            "geometry": {"type": g["type"], "coordinates": rnd(g["coordinates"])}})
    # Some councils also send unnamed pieces that lie inside one of their named areas: drop those.
    named = [(rings_of(k["geometry"]), k["properties"]["council"]) for k in keep if k["properties"]["name"]]
    def centre(k):
        pts = list(points(k["geometry"]["coordinates"])); return sum(p[0] for p in pts) / len(pts), sum(p[1] for p in pts) / len(pts)
    keep = [k for k in keep if k["properties"]["name"]
            or not any(c == k["properties"]["council"] and in_geom(centre(k), polys) for polys, c in named)]
    for k in keep:
        k["properties"]["name"] = k["properties"]["name"] or "Unnamed conservation area"
    keep.sort(key=lambda k: (k["properties"]["council"], k["properties"]["name"]))
    REGION_FILE.write_text(json.dumps({"type": "FeatureCollection", "source": NATIONAL, "features": keep}, separators=(",", ":")))
    print(f"wrote {REGION_FILE}: {len(keep)} conservation areas")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--refresh", action="store_true", help="download the national file and rewrite the regional extract")
    ap.add_argument("--cache", default="/tmp/conservation-cache")
    ap.add_argument("--write", action="store_true")
    a = ap.parse_args()
    if a.refresh:
        Path(a.cache).mkdir(parents=True, exist_ok=True)
        refresh(a.cache)

    cas = json.loads(REGION_FILE.read_text())["features"]
    area_of = {r["id"]: r["area_id"] for r in csv.DictReader(open("data/subareas.csv", encoding="utf-8"))}
    subs = [(area_of[f["properties"]["id"]], rings_of(f["geometry"]))
            for f in json.load(open("data/geo/subareas.json"))["features"] if f["properties"]["id"] in area_of]
    subs = [(aid, polys, bbox([p for o, _ in polys for p in o])) for aid, polys in subs]

    # A conservation area belongs to an area if it overlaps one of the area's neighbourhoods:
    # a vertex of one lies inside the other (enough for real boundaries, which share no long straight edges).
    out, by_area = [], defaultdict(list)
    for ft in cas:
        polys = rings_of(ft["geometry"]); pts = [p for o, _ in polys for p in o]; bb = bbox(pts)
        hit = set()
        for aid, sp, sbb in subs:
            if aid in hit or not overlap(bb, sbb):
                continue
            if any(in_geom(p, sp) for p in pts[::3]) or any(in_geom(p, polys) for o, _ in sp for p in o[::3]):
                hit.add(aid)
        if hit:
            ids = sorted(hit)
            out.append({**ft, "properties": {**ft["properties"], "areas": ",".join(ids)}})
            for i in ids:
                by_area[i].append(ft["properties"]["name"])

    # Share of sold homes inside a conservation area: a rough stand-in for the share of homes.
    site = [(rings_of(f["geometry"]), bbox([p for o, _ in rings_of(f["geometry"]) for p in o])) for f in out]
    sold, in_ca = defaultdict(int), defaultdict(int)
    for s in csv.DictReader(open("data/sales.csv", encoding="utf-8")):
        pt = (float(s["lon"]), float(s["lat"])); sold[s["area_id"]] += 1
        if any(bb[0] <= pt[0] <= bb[2] and bb[1] <= pt[1] <= bb[3] and in_geom(pt, polys) for polys, bb in site):
            in_ca[s["area_id"]] += 1

    raw = open("data/areas.csv", encoding="utf-8", newline="").read()
    eol = "\r\n" if "\r\n" in raw else "\n"
    ar = list(csv.DictReader(io.StringIO(raw)))
    for r in ar:
        i = r["id"]
        r["conservation_count"] = len(by_area[i])
        r["conservation_sales_pct"] = round(100 * in_ca[i] / sold[i]) if sold[i] else ""
        print(f"{i}: {len(by_area[i]):2d} conservation areas, {r['conservation_sales_pct']}% of sales inside · "
              + "; ".join(sorted(by_area[i]))[:110])
    print(len(out), "conservation areas touch the shortlist")
    if not a.write:
        return
    SITE_FILE.write_text(json.dumps({"type": "FeatureCollection", "features": out}, separators=(",", ":")))
    cols = list(ar[0])                          # new columns, if any, end up at the end
    with open("data/areas.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=cols, lineterminator=eol); w.writeheader(); w.writerows(ar)
    print(f"wrote {SITE_FILE} ({SITE_FILE.stat().st_size // 1024} KB), areas.csv conservation_*")


if __name__ == "__main__":
    sys.exit(main())
