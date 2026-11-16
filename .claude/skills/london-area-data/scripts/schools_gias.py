#!/usr/bin/env python3
"""Find every open, mixed, state-funded mainstream school inside each area's wards.

Usage (from the repo root):
    python3 .claude/skills/london-area-data/scripts/schools_gias.py GIAS.csv OFSTED.csv           # report
    python3 .claude/skills/london-area-data/scripts/schools_gias.py GIAS.csv OFSTED.csv --write   # append
    python3 .claude/skills/london-area-data/scripts/schools_gias.py GIAS.csv OFSTED.csv ce fg      # some areas

Inputs (download first, see references/sources.md "Schools"):
    GIAS.csv    DfE "all establishment data" (edubasealldataYYYYMMDD.csv, latin-1)
    OFSTED.csv  Ofsted "Management information - state-funded schools - latest inspections as at ..." CSV

What it does:
  * Keeps schools that are open, mixed, state-funded (LA maintained, academies, free schools), not special
    schools or PRUs, phase primary / secondary / all-through / middle, starting at age 11 or under.
  * Locates each by postcode with postcodes.io and keeps those inside one of the area's ward outlines.
  * Ofsted rating: a report card (Nov 2025 onwards) is summarised by its most common grade; an older graded
    inspection gives Outstanding / Good / Requires improvement / Inadequate. Colours: O, G, W (anything below
    good, any "needs attention" or "urgent improvement", or a category of concern), N (not inspected).
  * Prints, per area, schools missing from data/schools.csv and single-sex schools missing from
    excluded.json. With --write, appends them (catchment left blank for a human to fill) and adds a `urn`
    column, filled for existing rows whose URLs contain the URN.
Standard library only.
"""
import argparse, csv, json, re, sys, time, urllib.request
from collections import Counter, defaultdict
from pathlib import Path

DATA = Path.cwd() / "data"
UA = {"User-Agent": "london-2028-area-map (github.com/sosergio/london-2028)", "Content-Type": "application/json"}
STATE_GROUPS = {"Local authority maintained schools", "Academies", "Free Schools"}
PHASES = {"Primary": "P", "Middle deemed primary": "P", "Secondary": "S", "Middle deemed secondary": "S", "All-through": "A"}
TYPE_SHORT = {"Academy converter": "Academy", "Academy sponsor led": "Academy", "Free schools": "Free school",
              "Community school": "Community", "Voluntary aided school": "Voluntary aided",
              "Voluntary controlled school": "Voluntary controlled", "Foundation school": "Foundation"}
OEIF = {"1": ("Outstanding", "O"), "2": ("Good", "G"), "3": ("Requires improvement", "W"), "4": ("Inadequate", "W")}
CARD_ORDER = ["Exceptional", "Strong standard", "Expected standard", "Needs attention", "Urgent improvement"]
CARD_AREAS = ["Inclusion", "Curriculum and teaching", "Achievement", "Attendance and behaviour",
              "Personal development and wellbeing", "Early years (where applicable)",
              "Post-16 provision (where applicable)", "Leadership and governance"]


def inside(pt, ring):
    y, x = pt
    hit = False
    for (y1, x1), (y2, x2) in zip(ring, ring[1:] + ring[:1]):
        if (y1 > y) != (y2 > y) and x < (x2 - x1) * (y - y1) / (y2 - y1) + x1:
            hit = not hit
    return hit


def locate(postcodes):
    out = {}
    pcs = sorted({p for p in postcodes if p})
    for i in range(0, len(pcs), 100):
        body = json.dumps({"postcodes": pcs[i:i + 100]}).encode()
        for attempt in range(3):
            try:
                with urllib.request.urlopen(urllib.request.Request("https://api.postcodes.io/postcodes", body, UA), timeout=60) as r:
                    res = json.load(r)["result"]
                break
            except Exception:
                if attempt == 2:
                    raise
                time.sleep(2)
        for item in res:
            if item["result"]:
                out[item["query"]] = (item["result"]["latitude"], item["result"]["longitude"])
    return out


def rating(o):
    """(ofsted, colour, detail) from one row of the Ofsted latest-inspections file."""
    if not o:
        return "Not yet inspected", "N", ""
    concern = (o.get("Category of concern") or o.get("Latest OEIF category of concern") or "").strip()
    concern = {"SM": "special measures", "SWK": "serious weaknesses", "RSI": "requires significant improvement"}.get(
        concern, "" if concern.lower() in ("", "null", "none", "no", "not applicable") else concern)
    grades = [o.get(a, "").strip() for a in CARD_AREAS]
    grades = [g for g in grades if g in CARD_ORDER]
    date = (o.get("Inspection start date") or "").strip()
    if grades:
        c = Counter(grades)
        head = max(CARD_ORDER, key=lambda g: (c[g], -CARD_ORDER.index(g)))  # most common; ties go to the better grade
        low = any(g in ("Needs attention", "Urgent improvement") for g in grades)
        colour = "W" if low or concern else "O" if head == "Exceptional" else "G"
        detail = f"Report card {date}: " + ", ".join(f"{c[g]} {g.lower()}" for g in CARD_ORDER if c[g])
        if low:
            head = "Urgent improvement" if "Urgent improvement" in grades else "Needs attention"
        return head, colour, detail + (f"; {concern}" if concern else "")
    oe = (o.get("Latest OEIF overall effectiveness") or "").strip()
    d = (o.get("Inspection start date of latest OEIF graded inspection") or "").strip()
    ung = (o.get("Ungraded inspection overall outcome") or "").strip()
    ung = "" if ung.lower() in ("null", "not applicable") else ung
    later = f"; later ungraded visit: {ung}" if ung else ""
    if oe in OEIF:
        text, colour = OEIF[oe]
        detail = d + later
    elif oe == "Not judged":
        # Graded inspections from Sept 2024 to Oct 2025 gave no overall grade, only the sub-judgements.
        subs = [o.get(k, "").strip() for k in ("Latest OEIF quality of education", "Latest OEIF behaviour and attitudes",
                                              "Latest OEIF personal development", "Latest OEIF effectiveness of leadership and management")]
        subs = [s for s in subs if s in OEIF]
        if not subs:
            return "See report", "N", d
        worst = max(subs)
        common = Counter(subs).most_common(1)[0][0]
        text, colour = OEIF[worst if worst in ("3", "4") else common]
        detail = f"{d}, no overall grade: " + ", ".join(f"{subs.count(k)} {OEIF[k][0].lower()}" for k in "1234" if k in subs) + later
    elif ung:
        # Only a short (ungraded) visit is in the file: its wording carries the grade it kept.
        if "remains Outstanding" in ung:
            text, colour = "Outstanding", "O"
        elif "remains Good" in ung:
            text, colour = "Good", "G"
        else:
            text, colour = "See report", "N"
        detail = "Ungraded visit " + (o.get("Date of latest ungraded inspection") or "").strip() + f": {ung}"
    else:
        return "Not yet inspected", "N", ""
    if concern:
        colour, detail = "W", detail + f"; {concern}"
    return text, colour, detail


def short_name(n):
    s = re.sub(r"\bC(?:hurch)? ?of ?E(?:ngland)?\b", "CofE", n)
    s = re.sub(r"\s+(School|Academy)$", "", s)
    s = re.sub(r"\s+(Primary|Junior|Infant)( and Nursery)?$", r" \1", s)
    return s.strip()


def faith_of(rc):
    rc = rc.strip()
    if "Catholic" in rc:
        return "Catholic", ""
    if "Church of England" in rc:
        return "CofE", ""
    if rc in ("", "None", "Does not apply"):
        return "None", ""
    return "None", f"{rc} faith school"


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("gias"); ap.add_argument("ofsted"); ap.add_argument("areas", nargs="*")
    ap.add_argument("--write", action="store_true")
    a = ap.parse_args()

    wards = json.loads((DATA / "geo" / "wards.json").read_text(encoding="utf-8"))
    with open(DATA / "schools.csv", newline="", encoding="utf-8") as f:
        rd = csv.DictReader(f); fields = list(rd.fieldnames); existing = list(rd)
    excluded_doc = json.loads((DATA / "excluded.json").read_text(encoding="utf-8"))
    excluded = excluded_doc["excluded"]
    have = set()
    for r in existing:
        # Prefer the URN in the Ofsted link; source_url sometimes points at a neighbouring school's page.
        urns = re.findall(r"\b(\d{6})\b", r.get("ofsted_url") or "") or re.findall(r"\b(\d{6})\b", r.get("source_url") or "")
        if urns and not r.get("urn"):
            r["urn"] = urns[-1]
        if r.get("urn"):
            have.add(r["urn"])
    norm = lambda s: re.sub(r"[^a-z]", "", s.lower().replace("st ", "saint ").replace("st. ", "saint "))
    have_names = {norm(r["name"]) for r in existing}
    excl_names = {norm(re.sub(r"\(.*?\)", "", x)) for x in excluded}

    with open(a.ofsted, newline="", encoding="utf-8-sig", errors="replace") as f:
        ofsted = {r["URN"]: r for r in csv.DictReader(f)}

    cands = []
    with open(a.gias, newline="", encoding="latin-1") as f:
        for r in csv.DictReader(f):
            if r["EstablishmentStatus (name)"] != "Open" or r["EstablishmentTypeGroup (name)"] not in STATE_GROUPS:
                continue
            t = r["TypeOfEstablishment (name)"]
            if "special" in t.lower() or "pupil referral" in t.lower() or r["PhaseOfEducation (name)"] not in PHASES:
                continue
            if (r["StatutoryLowAge"] or "99").isdigit() and int(r["StatutoryLowAge"] or 99) > 11:
                continue
            if r["Region (name)" if "Region (name)" in r else "GOR (name)"] not in ("London", "East of England", "South East"):
                continue
            cands.append(r)
    where = locate([r["Postcode"] for r in cands])

    areas = a.areas or list(wards)
    found = defaultdict(list); single = defaultdict(list)
    for r in cands:
        ll = where.get(r["Postcode"])
        if not ll:
            continue
        aid = next((k for k in areas if any(inside(ll, ring) for _, ring in wards.get(k, []))), None)
        if not aid:
            continue
        r["_ll"] = ll
        (found if r["Gender (name)"] == "Mixed" else single)[aid].append(r)

    new_rows, new_excl = [], []
    for aid in areas:
        add = [r for r in found[aid] if r["URN"] not in have and norm(r["EstablishmentName"]) not in have_names]
        sx = [r for r in single[aid] if norm(r["EstablishmentName"]) not in excl_names]
        print(f"\n{aid}: {len(found[aid])} mixed state schools in the wards, {len(add)} not in schools.csv, {len(sx)} single-sex not in excluded.json")
        for r in sorted(add, key=lambda r: r["EstablishmentName"]):
            ofs, col, det = rating(ofsted.get(r["URN"]))
            faith, fnote = faith_of(r["ReligiousCharacter (name)"])
            pupils = r["NumberOfPupils"] or (ofsted.get(r["URN"]) or {}).get("Total number of pupils", "")
            print(f"  + {r['EstablishmentName']} [{PHASES[r['PhaseOfEducation (name)']]}, {faith}, {pupils or '?'} pupils, {ofs} ({col})]")
            o = ofsted.get(r["URN"]) or {}
            new_rows.append({
                "area_id": aid, "name": r["EstablishmentName"], "short_name": short_name(r["EstablishmentName"]),
                "phase": PHASES[r["PhaseOfEducation (name)"]], "faith": faith,
                "ages": f"{TYPE_SHORT.get(r['TypeOfEstablishment (name)'], r['TypeOfEstablishment (name)'])}, {r['StatutoryLowAge']}–{r['StatutoryHighAge']}",
                "pupils": pupils, "ofsted": ofs, "ofsted_colour": col, "ofsted_detail": det,
                "ofsted_url": o.get("Web Link", "") or f"https://reports.ofsted.gov.uk/oxedu_providers/full/(urn)/{r['URN']}",
                "lat": round(r["_ll"][0], 6), "lon": round(r["_ll"][1], 6), "catchment_miles": "",
                "catchment_text": "Not checked yet: see the council's admissions pages",
                "source_url": f"https://www.get-information-schools.service.gov.uk/Establishments/Establishment/Details/{r['URN']}",
                "note": fnote, "urn": r["URN"],
            })
        for r in sx:
            label = r["EstablishmentName"] + ("" if re.search(r"boys|girls", r["EstablishmentName"], re.I) else f" ({r['Gender (name)'].lower()})")
            print(f"  x {label}")
            new_excl.append(label)

    if a.write and (new_rows or new_excl):
        if "urn" not in fields:
            fields.append("urn")
        with open(DATA / "schools.csv", "w", newline="", encoding="utf-8") as f:
            w = csv.DictWriter(f, fieldnames=fields, lineterminator="\n", extrasaction="ignore")
            w.writeheader()
            for r in existing + new_rows:
                w.writerow({k: r.get(k, "") for k in fields})
        excluded_doc["excluded"] = excluded + new_excl
        (DATA / "excluded.json").write_text(json.dumps(excluded_doc, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
        print(f"\nAppended {len(new_rows)} schools and {len(new_excl)} single-sex names.")


if __name__ == "__main__":
    sys.exit(main())
