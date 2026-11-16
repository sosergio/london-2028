#!/usr/bin/env python3
"""Audit every area in data/ for missing or suspicious data.

Usage (from the repo root):
    python3 .claude/skills/london-area-data/scripts/audit_areas.py            # all areas
    python3 .claude/skills/london-area-data/scripts/audit_areas.py ce wk      # some areas

Prints one block per area with OK / MISSING / CHECK lines, then a summary.
Exit code 1 if anything is MISSING, so it can also gate a commit.
Standard library only.
"""
import csv, json, math, sys
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path.cwd()
DATA = ROOT / "data"

# Dimensions and the areas.csv columns that hold them. Keep in sync with SKILL.md.
AREA_DIMENSIONS = {
    "core": ["rank", "name", "sub", "lat", "lon", "why", "rightmove_id"],
    "estimates": ["rent", "commute", "family", "lifestyle", "green"],
    "census": ["msoas", "residents", "people_per_km2", "density_min", "density_max",
               "pct_whiteBritish", "pct_whiteOther", "pct_asian", "pct_black", "pct_mixed", "pct_other"],
    "crime": ["crime_total", "crime_anti-social-behaviour", "crime_burglary", "crime_robbery",
              "crime_vehicle-crime", "crime_violent-crime", "crime_shoplifting",
              "crime_rate", "crime_rate_burglary", "crime_rate_violent", "crime_rate_asb", "crime_rate_period"],
    "prices": ["postcode_sectors", "price_flat", "price_terraced", "price_semi", "price_sales", "price_period"],
    "rents": ["rent_2bed", "rent_3bed", "rent_source"],
}
SCHOOL_REQUIRED = ["area_id", "name", "short_name", "phase", "faith", "ages", "pupils", "ofsted",
                   "ofsted_colour", "lat", "lon", "catchment_text", "source_url"]
SHOP_GROUPS = ["up", "bake", "cult", "gym", "disc"]
MIN_SHOPS = 15          # fewer usually means the Nominatim fallback missed places
MAX_SCHOOL_KM = 3.5     # a school further than this from the area centre is probably misplaced


def read_csv(name):
    with open(DATA / name, newline="", encoding="utf-8") as f:
        return list(csv.DictReader(f))


def km(a, b):
    (la1, lo1), (la2, lo2) = a, b
    p = math.pi / 180
    h = math.sin((la2 - la1) * p / 2) ** 2 + math.cos(la1 * p) * math.cos(la2 * p) * math.sin((lo2 - lo1) * p / 2) ** 2
    return 12742 * math.asin(math.sqrt(h))


def num(v):
    try:
        return float(str(v).replace(",", ""))
    except (TypeError, ValueError):
        return None


def main(only):
    areas = read_csv("areas.csv")
    schools = read_csv("schools.csv")
    shops = read_csv("shops.csv")
    wards = json.loads((DATA / "geo" / "wards.json").read_text(encoding="utf-8"))
    excluded = json.loads((DATA / "excluded.json").read_text(encoding="utf-8")).get("excluded")
    cols = set(areas[0].keys()) if areas else set()
    ids = [a["id"] for a in areas]

    problems = Counter()
    out = []

    def line(level, msg):
        out.append(f"  {level:<8}{msg}")
        problems[level] += level != "OK"

    # Cross-file checks
    out.append("Files")
    for name, rows in (("schools.csv", schools), ("shops.csv", shops)):
        stray = sorted({r["area_id"] for r in rows} - set(ids))
        line("MISSING" if stray else "OK", f"{name}: area_id values not in areas.csv: {stray}" if stray else f"{name}: all area_id values match areas.csv")
    stray = sorted(set(wards) - set(ids))
    if stray:
        line("CHECK", f"wards.json has ids not in areas.csv: {stray}")
    line("OK" if isinstance(excluded, list) else "MISSING", "excluded.json has an 'excluded' list")
    if len(set(ids)) != len(ids):
        line("MISSING", f"duplicate area ids: {[i for i, n in Counter(ids).items() if n > 1]}")
    ranks = sorted(int(num(a["rank"]) or 0) for a in areas)
    if ranks != list(range(1, len(areas) + 1)):
        line("CHECK", f"ranks are not 1..{len(areas)}: {ranks}")

    by_area_schools = defaultdict(list)
    for s in schools:
        by_area_schools[s["area_id"]].append(s)
    by_area_shops = defaultdict(list)
    for p in shops:
        by_area_shops[p["area_id"]].append(p)

    for a in areas:
        if only and a["id"] not in only:
            continue
        out.append(f"\n{a['id']}  {a.get('rank', '?')}. {a.get('name', '?')}")
        centre = (num(a.get("lat")), num(a.get("lon")))

        for dim, fields in AREA_DIMENSIONS.items():
            absent = [f for f in fields if f not in cols]
            empty = [f for f in fields if f in cols and not str(a.get(f, "")).strip()]
            if len(absent) == len(fields):
                line("MISSING", f"{dim}: not collected yet (no columns in areas.csv)")
            elif absent or empty:
                line("MISSING", f"{dim}: empty {empty + absent}")
            else:
                line("OK", dim)
        if "census" in AREA_DIMENSIONS and all(f in cols for f in AREA_DIMENSIONS["census"][5:]):
            total = sum(num(a[f]) or 0 for f in AREA_DIMENSIONS["census"][5:])
            if total and not 98 <= total <= 102:
                line("CHECK", f"ethnicity percentages add up to {total:.1f}")
        if num(a.get("density_min")) and num(a.get("density_max")) and num(a.get("people_per_km2")):
            if not num(a["density_min"]) <= num(a["people_per_km2"]) <= num(a["density_max"]):
                line("CHECK", "people_per_km2 is outside density_min..density_max")

        rings = wards.get(a["id"]) or []
        line("OK" if rings else "MISSING", f"ward outlines: {len(rings)} wards" if rings else "ward outlines: none in wards.json")

        ss = by_area_schools.get(a["id"], [])
        phases = Counter(s["phase"] for s in ss)
        prim = phases["P"] + phases["A"]
        sec = phases["S"] + phases["A"]
        msg = f"schools: {len(ss)} ({phases['P']} primary, {phases['S']} secondary, {phases['A']} all-through)"
        line("OK" if prim and sec else "MISSING", msg + ("" if prim and sec else " - needs at least one primary and one secondary"))
        for s in ss:
            gaps = [f for f in SCHOOL_REQUIRED if not str(s.get(f, "")).strip()]
            if gaps:
                line("MISSING", f"school '{s['name']}': empty {gaps}")
            if s["phase"] not in ("P", "S", "A") or s["faith"] not in ("Catholic", "CofE", "None") or s["ofsted_colour"] not in ("O", "G", "W", "N"):
                line("CHECK", f"school '{s['name']}': unexpected phase/faith/ofsted_colour {s['phase']}/{s['faith']}/{s['ofsted_colour']}")
            ll = (num(s["lat"]), num(s["lon"]))
            if None not in ll and None not in centre and km(ll, centre) > MAX_SCHOOL_KM:
                line("CHECK", f"school '{s['name']}' is {km(ll, centre):.1f} km from the area centre")
            if s.get("catchment_miles", "").strip() and num(s["catchment_miles"]) is None:
                line("CHECK", f"school '{s['name']}': catchment_miles is not a number")
        cats = sum(1 for s in ss if str(s.get("catchment_miles", "")).strip())
        if ss and not cats:
            line("CHECK", "no catchment distances (fine if the council does not publish them)")

        ps = by_area_shops.get(a["id"], [])
        g = Counter(p["group"] for p in ps)
        zero = [k for k in SHOP_GROUPS if not g[k]]
        summary = ", ".join(f"{k} {g[k]}" for k in SHOP_GROUPS)
        if not ps:
            line("MISSING", "shops: none")
        elif len(ps) < MIN_SHOPS or zero:
            line("CHECK", f"shops: {len(ps)} ({summary}) - low or empty groups, re-query OSM")
        else:
            line("OK", f"shops: {len(ps)} ({summary})")

    print("\n".join(out))
    print(f"\nSummary: {problems['MISSING']} missing, {problems['CHECK']} to check")
    return 1 if problems["MISSING"] else 0


if __name__ == "__main__":
    sys.exit(main(set(sys.argv[1:])))
