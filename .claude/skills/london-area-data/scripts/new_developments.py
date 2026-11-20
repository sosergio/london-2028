#!/usr/bin/env python3
"""New-build developments in and around every area: being built, selling, or just sold.

    python3 new_developments.py                 # preview, all areas
    python3 new_developments.py le bo           # preview, some areas
    python3 new_developments.py --write         # save the files below (always all areas)

Two free sources, no key:
  1. GLA Planning London Datahub (planningdata.london.gov.uk, Elasticsearch "api-guest", header
     X-API-AllowRequest): approved schemes of MIN_HOMES+ homes whose centre is inside one of the area's
     neighbourhoods (data/geo/subareas.json), that finished since SINCE, are being built, or were approved
     since SINCE_APPROVED and not started. Homes by tenure and bedrooms, start and finish dates, outline.
     London only: areas outside London (Woking, St Albans, Brentwood, Loughton) get Land Registry only.
  2. HM Land Registry Price Paid: standard new-build sales since SINCE in the area's postcode sectors,
     grouped into buildings (the building name in the address, or street + sector when there is none)
     and placed at their postcode. A building within MATCH_M of a scheme is joined to it; buildings left
     over with MIN_SALES+ sales become developments of their own.

Status: Selling (a new-build sale in the last SELLING_DAYS of the Land Registry data), Sold (sales, none
lately), Being built, Finished (no sales: usually rented or affordable homes), Approved (not started).
Sales under SHARED_MAX are counted as probable shared-ownership shares and kept out of the price range.

Writes data/developments.csv and data/geo/developments.json (points, plus outlines from the Datahub).
"""
import argparse, csv, json, re, statistics, sys, urllib.request
from collections import defaultdict
from datetime import date, datetime, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from property_prices import districts_for, http, locate, SPARQL, inside  # noqa: E402

DATAHUB = "https://planningdata.london.gov.uk/api-guest/applications/_search"
HUB_HEADERS = {"Content-Type": "application/json", "X-API-AllowRequest": "be2rmRnt&"}
MIN_HOMES, MIN_SALES, MATCH_M, SELLING_DAYS, SHARED_MAX = 20, 5, 150, 180, 250_000
SINCE, SINCE_APPROVED, SINCE_STARTED = "2023-01-01", "2022-01-01", "2020-01-01"
OUT_CSV, OUT_GEO = Path("data/developments.csv"), Path("data/geo/developments.json")
TENURE = {"market_for_sale": "sale", "market_rent": "rent", "build_to_rent": "rent", "london_shared_ownership": "shared",
          "shared_ownership": "shared", "discount_market_sale": "shared", "london_affordable_rent": "affordable rent",
          "affordable_rent": "affordable rent", "social_rent": "social rent", "london_living_rent": "affordable rent",
          "discount_market_rent": "affordable rent", "starter_homes": "shared", "self_build_and_custom_build": "sale"}


def d(s):
    """'26/10/2021' or '2021-10-26' -> date."""
    if not s:
        return None
    for f in ("%d/%m/%Y", "%Y-%m-%d"):
        try:
            return datetime.strptime(s[:10], f).date()
        except ValueError:
            pass
    return None


def metres(a, b):
    import math
    return 6371000 * math.hypot(math.radians(b[0] - a[0]), math.radians(b[1] - a[1]) * math.cos(math.radians(a[0])))


def title(s):
    s = " ".join((s or "").split())
    return s.title().replace("'S ", "'s ") if s.isupper() else s


# ---------- 1. planning schemes ----------
def hub(box):
    s, w, n, e = box
    q = {"size": 1000, "_source": ["lpa_app_no", "lpa_name", "site_name", "site_number", "street_name", "locality", "postcode", "description", "status",
                                   "decision_date", "actual_commencement_date", "actual_completion_date", "centroid",
                                   "wgs84_polygon", "url_planning_app", "application_details.residential_details"],
         "query": {"bool": {"filter": [
             {"geo_bounding_box": {"centroid": {"top_left": {"lat": n, "lon": w}, "bottom_right": {"lat": s, "lon": e}}}},
             {"range": {"application_details.residential_details.total_no_proposed_residential_units": {"gte": MIN_HOMES}}},
             {"terms": {"status.raw": ["Completed", "Commenced", "Approved"]}}]}}}
    body = json.dumps(q).encode()
    res = json.loads(urllib.request.urlopen(urllib.request.Request(DATAHUB, data=body, headers=HUB_HEADERS), timeout=120).read())
    return [h["_source"] for h in res["hits"]["hits"]]


def address(s):
    parts = [title(s.get(k) or "") for k in ("site_name", "site_number", "street_name", "locality")]
    out = []
    for p in parts:
        if p and p.lower() not in " ".join(out).lower() and p.lower() != "street record":
            out.append(p)
    return ", ".join(out + ([s["postcode"]] if s.get("postcode") else []))[:120]


def site_label(s):
    """A readable name: the site name if it is one ('The Score Centre'), else number + street ('60 Grove Road')."""
    raw = s.get("site_name") or ""
    quoted = re.search(r"[‘'\"“]([^’'\"”]{4,40})[’'\"”]", raw)
    if quoted:                                   # "Site known as ‘Hackney Wick Central’ comprising ..."
        return title(quoted.group(1))
    name = re.sub(r"^(and|&)\s+|[()]", "", title(raw)).strip(" ,")
    if name.lower() == "street record":
        name = ""
    weak = (not re.search(r"[A-Za-z]{4,}", name) or name.lower() in ("street record",)
            or re.match(r"(land|site|unit|block|and|plot|former)\b", name, re.I) or len(name) > 45)
    street = title(s.get("street_name") or "")
    if weak and street:
        num = (s.get("site_number") or "") if re.match(r"^[\d\-–a-zA-Z ]{1,10}$", s.get("site_number") or "") else ""
        name = f"{num} {street}".strip() if num else (street if not name or len(name) > 45 else f"{name}, {street}"[:60])
    name = re.sub(r"[ ,]+(London\b.*|[A-Z]{1,2}\d[A-Z\d]? ?\d[A-Z]{2})$", "", name, flags=re.I).strip(" ,")
    return name[:60]


def scheme(s):
    rd = (s.get("application_details") or {}).get("residential_details") or {}
    homes = rd.get("total_no_proposed_residential_units") or 0
    ten = defaultdict(int)
    for k, v in rd.items():
        m = re.match(r"total_no_proposed_residential_units_(.+)", k)
        if m and v:
            ten[TENURE.get(m.group(1), "other")] += v
    beds = defaultdict(int)
    for u in rd.get("residential_units") or []:
        if u.get("change_type") == "Gain" and u.get("no_bedrooms"):
            beds[min(int(u["no_bedrooms"]), 4)] += 1
    started, done = d(s.get("actual_commencement_date")), d(s.get("actual_completion_date"))
    st = s.get("status")
    if st == "Completed" and not (done and done >= d(SINCE)):
        return None
    if st == "Commenced" and not (started and started >= d(SINCE_STARTED)):
        return None                     # started long ago and never marked finished: usually a stale record
    if st == "Approved" and not (d(s.get("decision_date")) and d(s.get("decision_date")) >= d(SINCE_APPROVED)):
        return None
    c = s.get("centroid") or {}
    if not c:
        return None
    poly = s.get("wgs84_polygon") or None
    return {"ref": s.get("lpa_app_no") or "", "council": s.get("lpa_name") or "",
            "site": site_label(s), "address": address(s), "postcode": s.get("postcode") or "",
            "desc": " ".join((s.get("description") or "").split())[:260], "homes": int(homes),
            "tenure": dict(ten), "beds": dict(beds), "planning_status": st,
            "started": started.isoformat() if started else "", "finished": done.isoformat() if done else "",
            "approved": (d(s.get("decision_date")) or "") and d(s.get("decision_date")).isoformat(),
            "url": s.get("url_planning_app") or "", "ll": (float(c["lat"]), float(c["lon"])),
            "poly": poly if isinstance(poly, dict) and poly.get("coordinates") else None, "buildings": defaultdict(list)}


def dedupe(schemes):
    """Variations and phases re-submit the same site: merge applications within 60 m into the largest one,
    which keeps its homes and tenure; the status is the most active of the group, dates span the group."""
    rank = {"Commenced": 0, "Completed": 1, "Approved": 2}
    out = []
    for s in sorted(schemes, key=lambda s: -s["homes"]):
        o = next((o for o in out if metres(s["ll"], o["ll"]) < 60), None)
        if not o:
            out.append(s); continue
        if rank[s["planning_status"]] < rank[o["planning_status"]]:
            o["planning_status"] = s["planning_status"]
        o["started"] = min(x for x in (o["started"], s["started"]) if x) if (o["started"] or s["started"]) else ""
        o["finished"] = max(o["finished"], s["finished"])
        o["refs"] = o.get("refs", [o["ref"]]) + [s["ref"]]
    return out


# ---------- 2. Land Registry new-build sales ----------
_nb = {}


def new_build_rows(district):
    if district not in _nb:
        q = f"""PREFIX lrppi: <http://landregistry.data.gov.uk/def/ppi/>
PREFIX lrcommon: <http://landregistry.data.gov.uk/def/common/>
SELECT ?pc ?paon ?saon ?street ?price ?date ?type WHERE {{
  ?addr lrcommon:district "{district}" ; lrcommon:postcode ?pc .
  OPTIONAL {{ ?addr lrcommon:paon ?paon }} OPTIONAL {{ ?addr lrcommon:saon ?saon }} OPTIONAL {{ ?addr lrcommon:street ?street }}
  ?tx lrppi:propertyAddress ?addr ; lrppi:pricePaid ?price ; lrppi:transactionDate ?date ; lrppi:propertyType ?type ;
      lrppi:newBuild true ; lrppi:transactionCategory lrppi:standardPricePaidTransaction .
  FILTER(?date >= "{SINCE}"^^<http://www.w3.org/2001/XMLSchema#date>)
}}"""
        import io, urllib.parse
        text = http(SPARQL, data=urllib.parse.urlencode({"query": q}).encode(), headers={"Accept": "text/csv"})
        _nb[district] = list(csv.DictReader(io.StringIO(text if isinstance(text, str) else text.decode())))
    return _nb[district]


def building_key(r):
    """('Pochard Heights', None) for named buildings; (None, 'Elder Close|E10 6') for numbered houses or flats."""
    paon = " ".join((r.get("paon") or "").split())
    name = re.split(r",\s*\d", paon)[0].strip(" ,")
    if re.search(r"[A-Za-z]{3,}", name) and not re.fullmatch(r"(FLAT|UNIT|BLOCK|APARTMENT)S?\s*\w*", name, re.I):
        return title(name), None
    return None, f"{title(r.get('street') or '')}|{r['pc'][:-2].strip()}"


# ---------- main ----------
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("areas", nargs="*")
    ap.add_argument("--write", action="store_true")
    a = ap.parse_args()
    areas = {r["id"]: r for r in csv.DictReader(open("data/areas.csv", encoding="utf-8"))}
    ids = list(areas) if a.write or not a.areas else a.areas
    sub_area = {r["id"]: r["area_id"] for r in csv.DictReader(open("data/subareas.csv", encoding="utf-8"))}
    rings = defaultdict(list)
    for f in json.load(open("data/geo/subareas.json"))["features"]:
        if f["properties"]["id"] in sub_area:
            rings[sub_area[f["properties"]["id"]]].append([(p[1], p[0]) for p in f["geometry"]["coordinates"][0]])  # [lat, lon]

    def in_area(aid, ll):
        return any(inside(ll, r) for r in rings[aid])

    out = []
    for aid in ids:
        if not rings[aid]:
            continue
        pts = [p for r in rings[aid] for p in r]
        box = (min(p[0] for p in pts), min(p[1] for p in pts), max(p[0] for p in pts), max(p[1] for p in pts))
        schemes = dedupe([s for s in (scheme(x) for x in hub(box)) if s and in_area(aid, s["ll"])])

        # Land Registry new-build sales in the area's sectors, grouped into buildings.
        sectors = [x.strip() for x in (areas[aid].get("postcode_sectors") or "").split(",") if x.strip()]
        rows = [r for dist in districts_for(sectors) for r in new_build_rows(dist)
                if any(r["pc"].startswith(sec + " ") or r["pc"][:-2].strip() == sec for sec in sectors)]
        where = locate(sorted({r["pc"] for r in rows}))
        groups = defaultdict(list)
        for r in rows:
            if r["pc"] in where and in_area(aid, where[r["pc"]][:2]):
                groups[building_key(r)].append(r)
        latest = max((d(r["date"]) for rs in groups.values() for r in rs), default=date.today())
        loose = []
        for (name, street), rs in groups.items():
            ll = statistics.median([where[r["pc"]][0] for r in rs]), statistics.median([where[r["pc"]][1] for r in rs])
            near = min(schemes, key=lambda s: metres(ll, s["ll"]), default=None)
            label = name or street.split("|")[0]
            if near and metres(ll, near["ll"]) <= MATCH_M:
                near["buildings"][label] += rs
            elif len(rs) >= MIN_SALES:
                loose.append({"ref": "", "council": "", "site": f"{label}, {rs[0]['pc'][:-2].strip()}" if street else label,
                              "postcode": rs[0]["pc"], "address": f"{label}, {rs[0]['pc']}", "desc": "", "homes": 0, "tenure": {}, "beds": {}, "planning_status": "",
                              "started": "", "finished": "", "approved": "", "url": "", "ll": ll, "poly": None,
                              "buildings": defaultdict(list, {label: rs})})

        for s in schemes + loose:
            sales = [r for rs in s["buildings"].values() for r in rs]
            full = sorted(int(r["price"]) for r in sales if int(r["price"]) >= SHARED_MAX)
            dates = sorted(d(r["date"]) for r in sales)
            if sales:
                status = "Selling" if dates[-1] >= latest - timedelta(days=SELLING_DAYS) else "Sold"
            else:
                status = {"Commenced": "Being built", "Completed": "Finished", "Approved": "Approved"}[s["planning_status"]]
            houses = sum(1 for r in sales if not r["type"].endswith("flat-maisonette"))
            names = sorted(s["buildings"], key=lambda k: -len(s["buildings"][k]))
            out.append({
                "area_id": aid, "name": names[0] if names and len(s["buildings"][names[0]]) >= 3 else (s["site"] or (names[0] if names else "")),
                "address": s.get("address", ""),
                "buildings": "; ".join(n for n in names if n)[:200], "status": status, "homes": s["homes"] or "",
                "for_sale": s["tenure"].get("sale", "") , "for_rent": s["tenure"].get("rent", ""),
                "shared": s["tenure"].get("shared", ""),
                "affordable_rent": (s["tenure"].get("affordable rent", 0) + s["tenure"].get("social rent", 0)) or "",
                "beds": " · ".join(f"{k}{'+' if k == 4 else ''} bed {v}" for k, v in sorted(s["beds"].items())),
                "sold": len(sales), "sold_houses": houses, "sold_shared": len(sales) - len(full),
                "first_sale": dates[0].isoformat() if dates else "", "last_sale": dates[-1].isoformat() if dates else "",
                "price_median": int(statistics.median(full)) if full else "", "price_min": full[0] if full else "",
                "price_max": full[-1] if full else "", "started": s["started"], "finished": s["finished"],
                "approved": s["approved"], "planning_ref": s["ref"], "other_refs": "; ".join(r for r in s.get("refs", [])[1:] if r), "council": s["council"], "planning_url": s["url"],
                "postcode": s["postcode"] or (sales[0]["pc"] if sales else ""), "description": s["desc"],
                "lat": round(s["ll"][0], 5), "lon": round(s["ll"][1], 5), "_poly": s["poly"]})
        mine = [o for o in out if o["area_id"] == aid]
        print(f"\n{aid} {areas[aid]['name']}: {len(schemes)} planning schemes, {len(loose)} Land Registry-only, "
              f"{sum(o['status'] == 'Selling' for o in mine)} selling")
        order = {"Selling": 0, "Being built": 1, "Sold": 2, "Finished": 3, "Approved": 4}
        for o in sorted(mine, key=lambda o: (order[o["status"]], -(o["homes"] or o["sold"]))):
            print(f"  {o['status']:11} {str(o['homes'] or '?'):>4} homes, {o['sold']:3} sold "
                  f"{('£' + format(o['price_median'], ',')) if o['price_median'] else '':>10}  {o['name'][:42]:42} {o['buildings'][:40]}")

    # "Selling" is judged against the newest new-build sale anywhere (the Land Registry's real cut-off), not per area.
    newest = max((o["last_sale"] for o in out if o["last_sale"]), default="")
    if newest:
        cut = (d(newest) - timedelta(days=SELLING_DAYS)).isoformat()
        for o in out:
            if o["sold"]:
                o["status"] = "Selling" if o["last_sale"] >= cut else "Sold"
        print(f"\nSelling = a new-build sale since {cut} (newest sale in the data {newest}): "
              f"{sum(o['status'] == 'Selling' for o in out)} developments")
    if not a.write:
        return
    for i, o in enumerate(out):
        o["id"] = f"{o['area_id']}-{i + 1}"
    cols = ["area_id", "id"] + [k for k in out[0] if k not in ("area_id", "id", "_poly")]
    with open(OUT_CSV, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=cols, extrasaction="ignore", lineterminator="\n"); w.writeheader(); w.writerows(out)
    feats = []
    for o in out:
        props = {k: o[k] for k in ("id", "area_id", "name", "status")}
        feats.append({"type": "Feature", "properties": props, "geometry": {"type": "Point", "coordinates": [o["lon"], o["lat"]]}})
        if o["_poly"]:
            g = o["_poly"]
            rnd = lambda c: [round(c[0], 5), round(c[1], 5)] if isinstance(c[0], (int, float)) else [rnd(x) for x in c]
            feats.append({"type": "Feature", "properties": {**props, "outline": True},
                          "geometry": {"type": g.get("type", "Polygon"), "coordinates": rnd(g["coordinates"])}})
    OUT_GEO.write_text(json.dumps({"type": "FeatureCollection", "features": feats}, separators=(",", ":")))
    print(f"\nwrote {OUT_CSV} ({len(out)} developments) and {OUT_GEO} ({OUT_GEO.stat().st_size // 1024} KB)")


if __name__ == "__main__":
    sys.exit(main())
