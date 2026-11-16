#!/usr/bin/env python3
"""Build an area guide from a spec: one contact sheet for the whole area, then the guide JSON.

Needs Pillow (see guide_photos.py for how to install it into a scratch folder).

Spec (JSON):
  {"area": "ce", "title": "Crouch End", "station": [51.58, -0.12], "updated": "November 2026", "intro": "...",
   "items": [{"id": "parkland-walk", "name": "Parkland Walk", "kind": "walk",
              "q": "Parkland Walk Crouch End",           # Commons search words, or "Category:<Commons category>"
              "geo": "Parkland Walk, London",           # Nominatim query (or "lat": .., "lon": ..)
              "blurb": "...", "tip": "..."}, ...]}

    python3 guide_build.py sheet spec.json <work_dir>
        → <work_dir>/<area>_sheet.jpg: one row per item (row label = item index), 4 candidates each (a-d)
    python3 guide_build.py build spec.json <work_dir> 0:a 1:c 3:b ...
        → picks: item index and candidate letter; items not listed are dropped. Writes
          data/guides/<area>/<id>.jpg (1200 px), data/guides/<area>.json and adds the area to data/guides/index.json.
"""
import io, json, math, re, sys, time, html, urllib.error, urllib.parse, urllib.request
from pathlib import Path

UA = {"User-Agent": "london-2028-area-map/1.0 (github.com/sosergio/london-2028; area guides)"}
API = "https://commons.wikimedia.org/w/api.php"


def get(url, tries=6):
    # Wikimedia rate-limits bursts (HTTP 429): back off and retry rather than fail the whole sheet.
    for i in range(tries):
        try:
            return urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=90).read()
        except urllib.error.HTTPError as e:
            if i == tries - 1 or e.code not in (429, 500, 502, 503, 504):
                raise
            time.sleep(int(e.headers.get("Retry-After") or 0) or 10 * (i + 1))
        except Exception:
            if i == tries - 1:
                raise
            time.sleep(3 * (i + 1))


def api(**p):
    p.update(format="json", formatversion=2)
    return json.loads(get(API + "?" + urllib.parse.urlencode(p)))


def candidates(q, n=4):
    # "Category:Name" lists that Commons category (more reliable for specific places); anything else is a text search.
    if q.startswith("Category:"):
        d = api(action="query", generator="categorymembers", gcmtitle=q, gcmtype="file", gcmlimit=50,
                prop="imageinfo", iiprop="url|size|extmetadata", iiurlwidth=360)
    else:
        d = api(action="query", generator="search", gsrnamespace=6, gsrsearch=q + " filetype:bitmap", gsrlimit=30,
                prop="imageinfo", iiprop="url|size|extmetadata", iiurlwidth=360)
    out = []
    for p in d.get("query", {}).get("pages", []):
        ii = p["imageinfo"][0]
        if ii["width"] < 1500 or ii["width"] < ii["height"] * 1.2:
            continue
        out.append({"title": p["title"], "thumb": ii["thumburl"], "w": ii["width"], "h": ii["height"],
                    "license": ii.get("extmetadata", {}).get("LicenseShortName", {}).get("value", "")})
    return out[:n]


def sheet(spec, work):
    from PIL import Image, ImageDraw
    W, H, items = 360, 240, spec["items"]
    img = Image.new("RGB", (W * 4 + 220, H * len(items)), "white")
    dr = ImageDraw.Draw(img)
    cand = {}
    for r, it in enumerate(items):
        cs = candidates(it["q"])
        cand[str(r)] = cs
        dr.text((8, r * H + 10), f"{r}. {it['name'][:26]}", fill="black")
        for c_i, c in enumerate(cs):
            try:
                t = Image.open(io.BytesIO(get(c["thumb"]))).convert("RGB"); t.thumbnail((W - 6, H - 6))
                img.paste(t, (220 + c_i * W + 3, r * H + 3))
            except Exception:
                pass
            time.sleep(0.6)
            x, y = 220 + c_i * W + 3, r * H + 3
            dr.rectangle([x, y, x + 26, y + 22], fill="black"); dr.text((x + 8, y + 5), "abcd"[c_i], fill="white")
        time.sleep(0.2)
    Path(work).mkdir(parents=True, exist_ok=True)
    img.save(f"{work}/{spec['area']}_sheet.jpg", quality=72)
    json.dump(cand, open(f"{work}/{spec['area']}_cand.json", "w"), indent=1)
    for r, cs in cand.items():
        print(r, items[int(r)]["name"], "|", " / ".join(f"{'abcd'[i]}: {c['title'][5:60]}" for i, c in enumerate(cs)) or "NO CANDIDATES")


def geocode(it):
    if "lat" in it:
        return it["lat"], it["lon"]
    r = json.loads(get("https://nominatim.openstreetmap.org/search?" + urllib.parse.urlencode({"q": it["geo"], "format": "jsonv2", "limit": 1, "countrycodes": "gb"})))
    time.sleep(1.1)
    if not r:
        sys.exit(f"could not geocode {it['geo']!r}: add lat/lon to the spec")
    return round(float(r[0]["lat"]), 5), round(float(r[0]["lon"]), 5)


def km(a, b):
    p = math.pi / 180
    h = math.sin((b[0] - a[0]) * p / 2) ** 2 + math.cos(a[0] * p) * math.cos(b[0] * p) * math.sin((b[1] - a[1]) * p / 2) ** 2
    return round(12742 * math.asin(math.sqrt(h)), 1)


def build(spec, work, picks):
    from PIL import Image
    area = spec["area"]; cand = json.load(open(f"{work}/{area}_cand.json"))
    dest = Path("data/guides") / area; dest.mkdir(parents=True, exist_ok=True)
    out = []
    for n, pick in enumerate(picks, 1):
        r, letter = pick.split(":"); it = spec["items"][int(r)]; c = cand[r]["abcd".index(letter)]
        ii = api(action="query", titles=c["title"], prop="imageinfo", iiprop="url|extmetadata", iiurlwidth=1600)["query"]["pages"][0]["imageinfo"][0]
        im = Image.open(io.BytesIO(get(ii["thumburl"]))).convert("RGB")
        if im.width > 1200:
            im = im.resize((1200, round(im.height * 1200 / im.width)), Image.LANCZOS)
        im.save(dest / f"{it['id']}.jpg", quality=76, optimize=True, progressive=True)
        m = ii["extmetadata"]
        lat, lon = geocode(it)
        out.append({"id": it["id"], "n": n, "name": it["name"], "kind": it["kind"], "lat": lat, "lon": lon,
                    "km": km(spec["station"], (lat, lon)), "blurb": it["blurb"], "tip": it["tip"],
                    "photo": f"data/guides/{area}/{it['id']}.jpg", "w": im.width, "h": im.height,
                    "credit": {"author": re.sub(r"^user:", "", re.sub(r"\s+", " ", html.unescape(re.sub(r"<.*?>", "", m.get("Artist", {}).get("value", "")))).strip()),
                               "license": m.get("LicenseShortName", {}).get("value", ""),
                               "license_url": m.get("LicenseUrl", {}).get("value", ""), "source": ii["descriptionurl"]}})
        print(n, it["name"], f"{out[-1]['km']} km", "|", out[-1]["credit"]["author"], out[-1]["credit"]["license"])
    g = {"area_id": area, "title": spec["title"], "updated": spec.get("updated", ""), "intro": spec["intro"],
         "station_name": spec.get("station_name", "the station"), "items": out}
    Path(f"data/guides/{area}.json").write_text(json.dumps(g, ensure_ascii=False, indent=1), encoding="utf-8")
    idx_p = Path("data/guides/index.json")
    idx = json.loads(idx_p.read_text()) if idx_p.exists() else {"guides": {}}
    idx["guides"][area] = f"data/guides/{area}.json"
    idx_p.write_text(json.dumps(idx, indent=1), encoding="utf-8")


if __name__ == "__main__":
    if len(sys.argv) < 4:
        sys.exit(__doc__)
    spec = json.loads(Path(sys.argv[2]).read_text())
    if sys.argv[1] == "sheet":
        sheet(spec, sys.argv[3])
    elif sys.argv[1] == "build":
        build(spec, sys.argv[3], sys.argv[4:])
    else:
        sys.exit(__doc__)
