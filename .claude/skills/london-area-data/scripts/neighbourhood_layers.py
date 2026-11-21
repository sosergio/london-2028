#!/usr/bin/env python3
"""Deprivation (English Indices of Deprivation 2025) and social housing (Census 2021) for every area.

    python3 neighbourhood_layers.py            # preview: per-area summary
    python3 neighbourhood_layers.py --write    # save the files below

Works on the neighbourhoods already in data/subareas.csv (2021 LSOAs, made by price_subareas.py), so run
that first for a new area.

Files:
    data/subareas.csv           imd_decile, income_decile, idaci_decile (1 = most deprived 10% in England),
                                income_pct (share of people in income-deprived households),
                                idaci_pct (share of children 0-15 in income-deprived families)
    data/geo/tenure.json        Census 2021 Output Areas (about 130 households each) inside those
                                neighbourhoods, with households and the share social rented, council,
                                housing association, private rented and owned
    data/areas.csv              social_rent_pct (households), idaci_pct (children), both across the area's
                                neighbourhoods

Sources (all Open Government Licence):
    IMD    https://www.gov.uk/government/statistics/english-indices-of-deprivation-2025 (File 7 CSV)
    Tenure Nomis NM_2072_1 (TS054), Output Area level
    OAs    ONS OA_2021_EW_BGC_V2_RUC (generalised, clipped; has LSOA21CD)
Standard library only. Downloads are cached in --cache.
"""
import argparse, csv, io, json, sys, time, urllib.parse, urllib.request
from collections import defaultdict
from pathlib import Path

UA = {"User-Agent": "london-2028-area-map/1.0 (github.com/sosergio/london-2028)"}
IMD_URL = ("https://assets.publishing.service.gov.uk/media/691ded56d140bbbaa59a2a7d/"
           "File_7_IoD2025_All_Ranks_Scores_Deciles_Population_Denominators.csv")
OA_LAYER = "https://services1.arcgis.com/ESMARspQHYMw9BZ9/ArcGIS/rest/services/OA_2021_EW_BGC_V2_RUC/FeatureServer/0/query"
NOMIS = "https://www.nomisweb.co.uk/api/v01/dataset/NM_2072_1.data.csv"
TENURE = {"0": "hh", "1001": "owned", "1003": "social", "4": "council", "5": "ha", "1004": "private"}
DATA = Path("data")


def get(url, data=None, tries=3):
    for i in range(tries):
        try:
            return urllib.request.urlopen(urllib.request.Request(url, data, UA), timeout=120).read()
        except Exception:
            if i == tries - 1:
                raise
            time.sleep(3)


def cached(cache, name, fetch):
    f = Path(cache) / name
    if not f.exists():
        f.write_bytes(fetch())
    return f.read_bytes()


def col(row, start):
    return next(v for k, v in row.items() if k.startswith(start))


def rnd(c):
    return [round(c[0], 5), round(c[1], 5)] if isinstance(c[0], (int, float)) else [rnd(x) for x in c]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--write", action="store_true")
    ap.add_argument("--cache", default="/tmp/neighbourhood-cache")
    a = ap.parse_args()
    Path(a.cache).mkdir(parents=True, exist_ok=True)

    raw = (DATA / "subareas.csv").read_text(encoding="utf-8")
    subs = list(csv.DictReader(io.StringIO(raw)))
    lsoas = [r["id"] for r in subs]
    area_of = {r["id"]: r["area_id"] for r in subs}

    # Deprivation, one row per LSOA.
    imd = {}
    text = cached(a.cache, "imd2025.csv", lambda: get(IMD_URL)).decode("utf-8-sig")
    for r in csv.DictReader(io.StringIO(text)):
        imd[r["LSOA code (2021)"]] = {
            "imd_decile": col(r, "Index of Multiple Deprivation (IMD) Decile"),
            "income_decile": col(r, "Income Decile"),
            "idaci_decile": col(r, "Income Deprivation Affecting Children Index (IDACI) Decile"),
            "income_pct": round(100 * float(col(r, "Income Score")), 1),
            "idaci_pct": round(100 * float(col(r, "Income Deprivation Affecting Children Index (IDACI) Score")), 1),
            "kids": int(float(col(r, "Dependent Children aged 0-15"))),
        }
    missing = [l for l in lsoas if l not in imd]
    if missing:
        print("no deprivation figures for", missing)

    # Output Area outlines, by LSOA, in batches.
    feats = []
    for i in range(0, len(lsoas), 40):
        batch = lsoas[i:i + 40]
        q = urllib.parse.urlencode({"where": "LSOA21CD IN (" + ",".join(f"'{l}'" for l in batch) + ")",
                                    "outFields": "OA21CD,LSOA21CD", "outSR": 4326, "geometryPrecision": 5,
                                    "f": "geojson"})
        gj = json.loads(cached(a.cache, f"oa_{i}.json", lambda: get(OA_LAYER, q.encode())))
        feats += gj["features"]
    oas = [f["properties"]["OA21CD"] for f in feats]
    print(len(feats), "output areas in", len(lsoas), "neighbourhoods")

    # Tenure for those OAs from Nomis.
    ten = defaultdict(dict)
    for i in range(0, len(oas), 400):
        q = urllib.parse.urlencode({"date": "latest", "geography": ",".join(oas[i:i + 400]),
                                    "c2021_tenure_9": ",".join(TENURE), "measures": 20100,
                                    "select": "geography_code,c2021_tenure_9,obs_value"})
        body = cached(a.cache, f"ts054_{i}.csv", lambda: get(NOMIS + "?" + q)).decode("utf-8")
        for r in csv.DictReader(io.StringIO(body)):
            ten[r["GEOGRAPHY_CODE"]][TENURE[r["C2021_TENURE_9"]]] = int(r["OBS_VALUE"])

    out, area_hh, area_social = [], defaultdict(int), defaultdict(int)
    for f in feats:
        oa, lsoa = f["properties"]["OA21CD"], f["properties"]["LSOA21CD"]
        t = ten.get(oa)
        if not t or not t.get("hh"):
            continue
        hh = t["hh"]; pct = lambda k: round(100 * t.get(k, 0) / hh, 1)
        out.append({"type": "Feature", "properties": {
            "id": oa, "sub": lsoa, "area": area_of[lsoa], "hh": hh, "social": pct("social"), "council": pct("council"),
            "ha": pct("ha"), "private": pct("private"), "owned": pct("owned")},
            "geometry": {"type": f["geometry"]["type"], "coordinates": rnd(f["geometry"]["coordinates"])}})
        area_hh[area_of[lsoa]] += hh; area_social[area_of[lsoa]] += t.get("social", 0)

    kids, kids_poor = defaultdict(int), defaultdict(float)
    for l in lsoas:
        if l in imd:
            kids[area_of[l]] += imd[l]["kids"]; kids_poor[area_of[l]] += imd[l]["kids"] * imd[l]["idaci_pct"] / 100

    areas_raw = (DATA / "areas.csv").read_text(encoding="utf-8")
    eol = "\r\n" if "\r\n" in areas_raw else "\n"
    ar = list(csv.DictReader(io.StringIO(areas_raw)))
    print("\narea  social-rented households  children in low-income families  median IMD decile")
    for r in ar:
        i = r["id"]
        r["social_rent_pct"] = round(100 * area_social[i] / area_hh[i]) if area_hh[i] else ""
        r["idaci_pct"] = round(100 * kids_poor[i] / kids[i]) if kids[i] else ""
        dec = sorted(int(imd[l]["imd_decile"]) for l in lsoas if area_of[l] == i and l in imd)
        print(f"{i}    {r['social_rent_pct']:>3}%   {r['idaci_pct']:>3}%   {dec[len(dec) // 2] if dec else '-'}")

    if not a.write:
        return
    cols = list(subs[0])
    for c in ("imd_decile", "income_decile", "idaci_decile", "income_pct", "idaci_pct"):
        if c not in cols:
            cols.append(c)
    for r in subs:
        r.update({k: v for k, v in imd.get(r["id"], {}).items() if k in cols})
    seol = "\r\n" if "\r\n" in raw else "\n"
    with open(DATA / "subareas.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=cols, lineterminator=seol); w.writeheader(); w.writerows(subs)
    (DATA / "geo" / "tenure.json").write_text(json.dumps({"type": "FeatureCollection", "features": out}, separators=(",", ":")))
    acols = list(ar[0])
    with open(DATA / "areas.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=acols, lineterminator=eol); w.writeheader(); w.writerows(ar)
    print(f"\nwrote subareas.csv, geo/tenure.json ({(DATA / 'geo' / 'tenure.json').stat().st_size // 1024} KB), areas.csv")


if __name__ == "__main__":
    sys.exit(main())
