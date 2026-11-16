#!/usr/bin/env python3
"""Find and fetch freely licensed photos for an area guide (Wikimedia Commons, which includes Geograph).

Needs Pillow. Install it into a scratch folder rather than the system:
    python3 -m pip install --target /tmp/pylib pillow   and run with   PYTHONPATH=/tmp/pylib

1. Contact sheet of candidates (large landscape images only), to LOOK at before choosing:
    python3 guide_photos.py sheet <key> "<search words>" <out_dir>
   → <out_dir>/sheet_<key>.jpg (numbered thumbnails) and cand_<key>.json (titles, licences)
2. Fetch the chosen ones, resized to 1400 px wide, and print their credits:
    python3 guide_photos.py fetch <out_dir> <area_id> <highlight_id>=<key>:<n> [...]
   → data/guides/<area_id>/<highlight_id>.jpg and <out_dir>/credits_<area_id>.json
"""
import io, json, re, sys, time, html, urllib.parse, urllib.request
from pathlib import Path

UA = {"User-Agent": "london-2028-area-map/1.0 (github.com/sosergio/london-2028; area guide photos)"}
API = "https://commons.wikimedia.org/w/api.php"


def api(**p):
    p.update(format="json", formatversion=2)
    return json.load(urllib.request.urlopen(urllib.request.Request(API + "?" + urllib.parse.urlencode(p), headers=UA), timeout=60))


def sheet(key, query, out):
    from PIL import Image, ImageDraw
    d = api(action="query", generator="search", gsrnamespace=6, gsrsearch=query + " filetype:bitmap", gsrlimit=40,
            prop="imageinfo", iiprop="url|size|extmetadata", iiurlwidth=420)
    cands = []
    for p in d.get("query", {}).get("pages", []):
        ii = p["imageinfo"][0]; m = ii.get("extmetadata", {})
        if ii["width"] < 1600 or ii["width"] < ii["height"] * 1.2:
            continue  # too small for a hero photo, or portrait
        cands.append({"title": p["title"], "w": ii["width"], "h": ii["height"], "thumb": ii["thumburl"],
                      "license": m.get("LicenseShortName", {}).get("value", ""),
                      "desc": re.sub("<.*?>", "", m.get("ImageDescription", {}).get("value", ""))[:160]})
    cands = cands[:12]
    W, H = 420, 280
    img = Image.new("RGB", (W * 4, H * max(1, (len(cands) + 3) // 4)), "white"); dr = ImageDraw.Draw(img)
    for i, c in enumerate(cands):
        try:
            t = Image.open(io.BytesIO(urllib.request.urlopen(urllib.request.Request(c["thumb"], headers=UA), timeout=60).read())).convert("RGB")
            t.thumbnail((W - 6, H - 6)); img.paste(t, ((i % 4) * W + 3, (i // 4) * H + 3))
        except Exception:
            pass
        dr.rectangle([(i % 4) * W + 3, (i // 4) * H + 3, (i % 4) * W + 40, (i // 4) * H + 30], fill="black")
        dr.text(((i % 4) * W + 10, (i // 4) * H + 8), str(i), fill="white")
        time.sleep(0.1)
    Path(out).mkdir(parents=True, exist_ok=True)
    img.save(f"{out}/sheet_{key}.jpg", quality=80)
    json.dump(cands, open(f"{out}/cand_{key}.json", "w"), indent=1)
    for i, c in enumerate(cands):
        print(i, c["title"], "|", c["license"], f"{c['w']}x{c['h']}")


def fetch(out, area, picks):
    from PIL import Image
    dest = Path("data/guides") / area; dest.mkdir(parents=True, exist_ok=True)
    credits = {}
    for pick in picks:
        hid, ref = pick.split("="); key, n = ref.split(":")
        c = json.load(open(f"{out}/cand_{key}.json"))[int(n)]
        ii = api(action="query", titles=c["title"], prop="imageinfo", iiprop="url|extmetadata", iiurlwidth=1600)["query"]["pages"][0]["imageinfo"][0]
        img = Image.open(io.BytesIO(urllib.request.urlopen(urllib.request.Request(ii["thumburl"], headers=UA), timeout=120).read())).convert("RGB")
        if img.width > 1400:
            img = img.resize((1400, round(img.height * 1400 / img.width)), Image.LANCZOS)
        img.save(dest / f"{hid}.jpg", quality=80, optimize=True, progressive=True)
        m = ii["extmetadata"]
        credits[hid] = {"author": re.sub(r"\s+", " ", html.unescape(re.sub(r"<.*?>", "", m.get("Artist", {}).get("value", "")))).strip(),
                        "license": m.get("LicenseShortName", {}).get("value", ""), "license_url": m.get("LicenseUrl", {}).get("value", ""),
                        "source": ii["descriptionurl"], "w": img.width, "h": img.height}
        print(hid, credits[hid]["author"], "|", credits[hid]["license"])
    json.dump(credits, open(f"{out}/credits_{area}.json", "w"), indent=1)


if __name__ == "__main__":
    if len(sys.argv) >= 5 and sys.argv[1] == "sheet":
        sheet(sys.argv[2], sys.argv[3], sys.argv[4])
    elif len(sys.argv) >= 5 and sys.argv[1] == "fetch":
        fetch(sys.argv[2], sys.argv[3], sys.argv[4:])
    else:
        sys.exit(__doc__)
