#!/usr/bin/env python3
"""Median sold prices per area from HM Land Registry Price Paid Data (free, no key).

Usage (from the repo root):
    python3 .claude/skills/london-area-data/scripts/property_prices.py ce            # print only
    python3 .claude/skills/london-area-data/scripts/property_prices.py ce wk --write # update data/areas.csv
    python3 .claude/skills/london-area-data/scripts/property_prices.py ce --sectors "N8 9,N8 8" --months 36

Steps:
1. Postcode sectors (e.g. "N8 9"): taken from the area's `postcode_sectors` column if filled, otherwise
   derived from its ward outlines in data/geo/wards.json by reverse-geocoding a grid of points inside the
   wards with postcodes.io (free, no key). Sectors covering under 5% of the sample points are dropped.
2. Sales: standard-price transactions (category A, so no repossessions or company bulk sales) in those
   sectors over the last N months (default 24), from the Land Registry SPARQL endpoint. The query runs per
   council district (found with postcodes.io) because prefix filters over the whole register time out.
3. Medians by type: flat (flat-maisonette), terraced, semi (semi-detached). Detached is printed but not
   stored. Price Paid has no bedroom count: treat flats as roughly 1-2 bed and terraced/semi as 2-4 bed.

Writes columns: postcode_sectors, price_flat, price_terraced, price_semi, price_sales, price_period.
Standard library only.
"""
import argparse, csv, io, json, statistics, sys, time, urllib.parse, urllib.request
from collections import Counter
from datetime import date
from pathlib import Path

DATA = Path.cwd() / "data"
SPARQL = "https://landregistry.data.gov.uk/landregistry/query"
POSTCODES_IO = "https://api.postcodes.io/postcodes"
UA = {"User-Agent": "london-2028-area-map (github.com/sosergio/london-2028)"}
PRICE_COLS = ["postcode_sectors", "price_flat", "price_terraced", "price_semi", "price_sales", "price_period"]
TYPES = {"flat-maisonette": "flat", "terraced": "terraced", "semi-detached": "semi", "detached": "detached"}


def http(url, data=None, headers=None, retries=3):
    for i in range(retries):
        try:
            req = urllib.request.Request(url, data=data, headers={**UA, **(headers or {})})
            with urllib.request.urlopen(req, timeout=120) as r:
                return r.read().decode("utf-8")
        except Exception as e:  # network hiccups are common on both services
            if i == retries - 1:
                raise
            time.sleep(2 * (i + 1))


def inside(pt, ring):
    """Ray casting; pt and ring are (lat, lon)."""
    y, x = pt
    hit = False
    for (y1, x1), (y2, x2) in zip(ring, ring[1:] + ring[:1]):
        if (y1 > y) != (y2 > y) and x < (x2 - x1) * (y - y1) / (y2 - y1) + x1:
            hit = not hit
    return hit


def derive_sectors(area_id, step=0.0025):
    rings = [ring for _, ring in json.loads((DATA / "geo" / "wards.json").read_text())[area_id]]
    pts = []
    for ring in rings:
        lats, lons = [p[0] for p in ring], [p[1] for p in ring]
        la = min(lats)
        while la <= max(lats):
            lo = min(lons)
            while lo <= max(lons):
                if inside((la, lo), ring):
                    pts.append((la, lo))
                lo += step * 1.6  # roughly square cells at London's latitude
            la += step
    sectors = Counter()
    for i in range(0, len(pts), 100):
        body = json.dumps({"geolocations": [{"latitude": la, "longitude": lo, "limit": 1, "radius": 200} for la, lo in pts[i:i + 100]]})
        res = json.loads(http(POSTCODES_IO, body.encode(), {"Content-Type": "application/json"}))["result"]
        for r in res:
            if r["result"]:
                pc = r["result"][0]["postcode"]
                sectors[pc[:-2].strip()] += 1
    total = sum(sectors.values()) or 1
    keep = sorted(s for s, n in sectors.items() if n / total >= 0.05)
    return keep, len(pts)


def districts_for(sectors):
    """Land Registry district names (upper-case council names) covering the sectors' outcodes."""
    out = set()
    for oc in sorted({s.split()[0] for s in sectors}):
        res = json.loads(http(f"https://api.postcodes.io/outcodes/{urllib.parse.quote(oc)}"))["result"]
        out.update(d.upper() for d in (res.get("admin_district") or []))
    return sorted(out)


def sales(sectors, since):
    # Filtering on postcode prefixes across the whole register times out (503), so query whole
    # council districts (about 1-2 s each) and keep the sectors' sales in Python.
    want = tuple(sectors)  # "N8 9" matches "N8 9RX"; the space after the outcode keeps N1 apart from N10
    out = []
    for district in districts_for(sectors):
        q = f"""PREFIX lrppi: <http://landregistry.data.gov.uk/def/ppi/>
PREFIX lrcommon: <http://landregistry.data.gov.uk/def/common/>
SELECT ?pc ?price ?type WHERE {{
  ?addr lrcommon:district "{district}" ; lrcommon:postcode ?pc .
  ?tx lrppi:propertyAddress ?addr ; lrppi:pricePaid ?price ; lrppi:transactionDate ?date ; lrppi:propertyType ?type ;
      lrppi:transactionCategory lrppi:standardPricePaidTransaction .
  FILTER(?date >= "{since}"^^<http://www.w3.org/2001/XMLSchema#date>)
}}"""
        text = http(SPARQL, urllib.parse.urlencode({"query": q}).encode(), {"Accept": "text/csv"})
        for row in csv.DictReader(io.StringIO(text)):
            t = TYPES.get(row["type"].rsplit("/", 1)[-1])
            if t and row["pc"].startswith(want):
                out.append((t, int(float(row["price"]))))
    return out


def months_ago(n):
    d = date.today()
    y, m = divmod(d.year * 12 + d.month - 1 - n, 12)
    return date(y, m + 1, 1)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("areas", nargs="+", help="area ids from data/areas.csv")
    ap.add_argument("--sectors", help='override sectors, comma separated, e.g. "N8 9,N8 8" (one area only)')
    ap.add_argument("--months", type=int, default=24)
    ap.add_argument("--write", action="store_true", help="write results into data/areas.csv")
    args = ap.parse_args()

    path = DATA / "areas.csv"
    with open(path, newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        fields, rows = list(reader.fieldnames), list(reader)
    byid = {r["id"]: r for r in rows}
    since = months_ago(args.months)
    period = f"{since:%b %Y}–{date.today():%b %Y}"

    for aid in args.areas:
        r = byid.get(aid)
        if not r:
            print(f"{aid}: not in areas.csv", file=sys.stderr); continue
        if args.sectors:
            sectors, note = [s.strip().upper() for s in args.sectors.split(",")], "given"
        elif (r.get("postcode_sectors") or "").strip():
            sectors, note = [s.strip() for s in r["postcode_sectors"].split(",")], "from areas.csv"
        else:
            sectors, n = derive_sectors(aid)
            note = f"derived from wards ({n} sample points)"
        tx = sales(sectors, since)
        med = {t: (int(statistics.median(p)), len(p)) for t in TYPES.values() if (p := [v for k, v in tx if k == t])}
        print(f"\n{aid} {r['name']}  sectors {', '.join(sectors)} ({note}), {period}, {len(tx)} sales")
        for t in TYPES.values():
            if t in med:
                print(f"  {t:<9} median £{med[t][0]:>10,}  ({med[t][1]} sales){'  ← few sales, treat as rough' if med[t][1] < 10 else ''}")
            else:
                print(f"  {t:<9} no sales")
        if args.write:
            r["postcode_sectors"] = ", ".join(sectors)
            r["price_flat"] = med.get("flat", ("",))[0]
            r["price_terraced"] = med.get("terraced", ("",))[0]
            r["price_semi"] = med.get("semi", ("",))[0]
            r["price_sales"] = len(tx)
            r["price_period"] = period

    if args.write:
        for c in PRICE_COLS:
            if c not in fields:
                fields.append(c)
        with open(path, "w", newline="", encoding="utf-8") as f:
            w = csv.DictWriter(f, fieldnames=fields, lineterminator="\n")
            w.writeheader()
            for r in rows:
                w.writerow({k: r.get(k, "") for k in fields})
        print(f"\nWrote {', '.join(PRICE_COLS)} to {path.relative_to(Path.cwd())}")


if __name__ == "__main__":
    main()
