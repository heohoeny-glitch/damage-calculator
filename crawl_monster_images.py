#!/usr/bin/env python3
"""Download monster icons referenced by monsters.json into images/monsters/.

Same-origin copies let the Board Solver's screenshot recognition template-
match monster cells on a canvas (hotlinking fandom is CORS/403-hostile).
Skips files that already exist; safe to re-run after re-crawling.
"""

import json
import os
import time
import urllib.parse
import urllib.request

API = "https://friends-and-dragons.fandom.com/api.php"
OUT = "images/monsters"
HEADERS = {"User-Agent": "Mozilla/5.0 (damage-calculator crawler)"}


def api_image_urls(filenames):
    urls = {}
    for i in range(0, len(filenames), 50):
        batch = filenames[i:i + 50]
        titles = "|".join(f"File:{n}" for n in batch)
        q = urllib.parse.urlencode({
            "action": "query", "titles": titles,
            "prop": "imageinfo", "iiprop": "url", "format": "json",
        })
        req = urllib.request.Request(f"{API}?{q}", headers=HEADERS)
        with urllib.request.urlopen(req) as resp:
            pages = json.load(resp)["query"]["pages"]
        for page in pages.values():
            info = page.get("imageinfo")
            if info:
                name = page["title"].removeprefix("File:")
                urls[name] = info[0]["url"]
        time.sleep(0.3)
    return urls


def main():
    os.makedirs(OUT, exist_ok=True)
    monsters = json.load(open("monsters.json", encoding="utf-8"))
    names = sorted({m["image"] for m in monsters if m.get("image")})
    todo = [n for n in names if not os.path.exists(os.path.join(OUT, n))]
    print(f"images referenced: {len(names)}, to download: {len(todo)}")
    if not todo:
        return
    urls = api_image_urls(todo)
    missing = [n for n in todo if n not in urls]
    for i, name in enumerate(todo):
        url = urls.get(name)
        if not url:
            continue
        req = urllib.request.Request(url, headers=HEADERS)
        with urllib.request.urlopen(req) as resp:
            data = resp.read()
        with open(os.path.join(OUT, name), "wb") as f:
            f.write(data)
        if (i + 1) % 25 == 0:
            print(f"{i + 1}/{len(todo)}")
        time.sleep(0.15)
    print(f"done. missing on wiki: {missing if missing else '없음'}")


if __name__ == "__main__":
    main()
