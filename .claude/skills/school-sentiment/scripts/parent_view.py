#!/usr/bin/env python3
"""Ofsted Parent View results for every school in data/schools.csv, into data/school_views.csv.

    python3 parent_view.py                  # preview, all schools
    python3 parent_view.py 145313 100734    # just these URNs
    python3 parent_view.py --write          # save (keeps the research columns already in the file)

Reads the public results page for each school (https://parentview.ofsted.gov.uk/parent-view-results/urn/<URN>),
which opens on the latest school year. Results are published only for a year with at least 10 answers, and
parents answer mostly around an inspection, so the script steps back up to BACK years to the most recent
year that has results; pv_year and pv_date say which. One request every 1.5 s; pages cached in --cache.

Columns written (percentages are "strongly agree" + "agree", or "yes" for recommend):
    pv_year, pv_n, pv_date, pv_happy, pv_safe, pv_behave, pv_bully_ok, pv_bully_n, pv_send_ok, pv_send_n,
    pv_recommend
bully_ok and send_ok come only from the parents whose child was bullied / has SEND, so their own n is shown.
Standard library only.
"""
import argparse, csv, html, io, re, sys, time, urllib.request
from pathlib import Path

UA = {"User-Agent": "london-2028-area-map/1.0 (github.com/sosergio/london-2028)"}
BASE = "https://parentview.ofsted.gov.uk"
MIN = 10
BACK = 4   # years before the latest one: back to 2022/23 from 2026/27
DATA = Path("data")
OUT = DATA / "school_views.csv"
PV_COLS = ["pv_year", "pv_n", "pv_date", "pv_happy", "pv_safe", "pv_behave", "pv_bully_ok", "pv_bully_n",
           "pv_send_ok", "pv_send_n", "pv_recommend"]
# Filled by hand / web research (see SKILL.md); the script never touches them.
RESEARCH_COLS = ["sentiment", "summary", "reviews", "forums", "ask", "sources", "checked"]
COLS = ["urn", "name"] + PV_COLS + RESEARCH_COLS
QUESTIONS = {1: "pv_happy", 2: "pv_safe", 3: "pv_behave", 4: "pv_bully_ok", 5: "pv_send_ok"}


def fetch(url, cache, name):
    f = Path(cache) / name
    if f.exists():
        return f.read_text(encoding="utf-8")
    for i in range(3):
        try:
            time.sleep(1.5)
            body = urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60).read().decode("utf-8", "replace")
            f.write_text(body, encoding="utf-8")
            return body
        except Exception as e:
            if i == 2:
                print("  failed", url, e)
                return ""
            time.sleep(5)


def text_of(page):
    t = re.sub(r"<script.*?</script>|<style.*?</style>", " ", page, flags=re.S)
    return re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", t)))


def blocks(t):
    """Each question on the page -> (question text, {answer: %}, n, date). Questions are found by their wording,
    because the questionnaire changed (in 2025 the numbering and the bullying question were redone)."""
    out = []
    # One chunk per question, so a question with "no results available" can't borrow the next one's figures.
    chunks = re.split(r"View results as text|not received enough survey responses\.", t)
    for m in filter(None, (re.search(r"\b\d{1,2}\. (.+?) Figures based on (\d+) responses up to (\d\d/\d\d/\d{4})", c) for c in chunks)):
        body = m[1]
        first = re.search(r"(Strongly agree|Yes|My child has not been bullied|Positive) \d+%", body)
        if not first:
            continue
        q, answers = body[:first.start()].strip(), dict((a.strip(), int(v)) for a, v in re.findall(r"([A-Za-z' ]+?) (\d+)%", body[first.start():]))
        out.append((q, answers, int(m[2]), "-".join(reversed(m[3].split("/")))))
    return out


KEYS = [("pv_happy", r"is happy"), ("pv_safe", r"feels safe"), ("pv_behave", r"well behaved"),
        ("pv_bully_ok", r"bullied"), ("pv_send_ok", r"SEND|Special Educational Needs"), ("pv_recommend", r"recommend")]


def parse(page):
    """-> dict of PV columns (empty dict if the page has no results), list of (url, year label) tabs."""
    tabs = re.findall(r'<a href="(/parent-view-results/survey/result/[^"#]+)#school-years"[^>]*>([^<]+)</a>', page)
    active = re.search(r'class="active-year"[^>]*>([^<]+)<', page)
    out = {}
    for q, ans, n, date in blocks(text_of(page)):
        key = next((k for k, pat in KEYS if re.search(pat, q) and k not in out), None)
        if not key:
            continue
        agree = ans.get("Strongly agree", 0) + ans.get("Agree", 0)
        if key == "pv_recommend":
            out[key] = ans.get("Yes", "")
        elif key == "pv_bully_ok":
            # Old questionnaire: "my child has not been bullied" is part of the base; keep only the bullied.
            notb = ans.get("My child has not been bullied", 0)
            share = (100 - notb) / 100
            out["pv_bully_n"] = round(n * share)
            out[key] = round(100 * agree / (100 - notb)) if notb < 100 else ""
        else:
            out[key] = agree
            if key == "pv_send_ok":
                out["pv_send_n"] = n
        if key == "pv_happy":
            out["pv_n"], out["pv_date"] = n, date
    if out.get("pv_bully_n") == 0:
        out["pv_bully_ok"] = ""
    if out:
        out["pv_year"] = active[1].strip() if active else (tabs[0][1].strip() if tabs else "")
    return out, [(url, label.strip()) for url, label in tabs]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("urns", nargs="*")
    ap.add_argument("--write", action="store_true")
    ap.add_argument("--cache", default="/tmp/parent-view-cache")
    a = ap.parse_args()
    Path(a.cache).mkdir(parents=True, exist_ok=True)

    schools = {}
    for r in csv.DictReader(io.StringIO((DATA / "schools.csv").read_text(encoding="utf-8"))):
        if r.get("urn"):
            schools.setdefault(r["urn"], r["name"])
    rows = {}
    if OUT.exists():
        rows = {r["urn"]: r for r in csv.DictReader(io.StringIO(OUT.read_text(encoding="utf-8")))}
    todo = a.urns or list(schools)

    for i, urn in enumerate(todo, 1):
        page = fetch(f"{BASE}/parent-view-results/urn/{urn}", a.cache, f"{urn}.html")
        pv, tabs = parse(page)
        # Parents answer mostly around an inspection, so recent years are often empty: step back a year at
        # a time (up to BACK years) to the most recent one with at least MIN answers.
        for url, label in tabs[1:1 + BACK]:
            if pv.get("pv_n", 0) >= MIN:
                break
            older, _ = parse(fetch(BASE + url, a.cache, f"{urn}_{url.rsplit('/', 1)[-1]}.html"))
            if older.get("pv_n", 0) >= MIN:
                pv = {**older, "pv_year": label}
        r = rows.setdefault(urn, {"urn": urn})
        r["name"] = schools.get(urn, r.get("name", ""))
        for c in PV_COLS:
            r[c] = pv.get(c, "")
        n = pv.get("pv_n")
        print(f"{i:>3}/{len(todo)} {urn} {r['name'][:40]:<40} "
              + (f"{pv['pv_year']:>7}  n={n:<4} recommend {pv.get('pv_recommend', '–')}%  behave {pv.get('pv_behave', '–')}%  "
                 f"bullying dealt with {pv.get('pv_bully_ok', '–')}% (n={pv.get('pv_bully_n', '–')})" if n else "no results"))

    if not a.write:
        return
    keep = [u for u in schools if u in rows] + [u for u in rows if u not in schools]
    with open(OUT, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=COLS, extrasaction="ignore", lineterminator="\n")
        w.writeheader()
        for u in keep:
            w.writerow({c: rows[u].get(c, "") for c in COLS})
    print(f"\nwrote {OUT} ({len(keep)} schools)")


if __name__ == "__main__":
    sys.exit(main())
