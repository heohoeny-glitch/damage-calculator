#!/usr/bin/env python3
"""Crawl Friends & Dragons wiki for hero availability (exclusive/limited) info."""

import json
import re
import time
import urllib.request
import urllib.parse

API_BASE = "https://friends-and-dragons.fandom.com/api.php"
OUTPUT_PATH = "/Users/itswappdev/Desktop/Claude/damage-calculator/hero_availability.json"
DELAY = 0.2


def api_get(params):
    """Make a GET request to the wiki API and return parsed JSON."""
    url = API_BASE + "?" + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, headers={"User-Agent": "FnDHeroCrawler/1.0"})
    with urllib.request.urlopen(req) as resp:
        return json.loads(resp.read().decode("utf-8"))


def fetch_hero_list():
    """Fetch all hero page titles from Category:Heroes, handling pagination."""
    heroes = []
    params = {
        "action": "query",
        "list": "categorymembers",
        "cmtitle": "Category:Heroes",
        "cmlimit": 500,
        "format": "json",
    }
    while True:
        data = api_get(params)
        for member in data["query"]["categorymembers"]:
            if member["ns"] == 0:
                heroes.append(member["title"])
        cont = data.get("continue")
        if cont and "cmcontinue" in cont:
            params["cmcontinue"] = cont["cmcontinue"]
            time.sleep(DELAY)
        else:
            break
    return sorted(heroes)


def fetch_availability(hero_name):
    """Fetch a hero's wikitext and extract availability from the Basics section."""
    params = {
        "action": "parse",
        "page": hero_name,
        "format": "json",
        "prop": "wikitext",
    }
    data = api_get(params)

    if "error" in data:
        print(f"  WARNING: could not fetch page for '{hero_name}': {data['error'].get('info', 'unknown error')}")
        return None

    wikitext = data["parse"]["wikitext"]["*"]

    # Find the Basics section
    lines = wikitext.split("\n")
    in_basics = False
    for line in lines:
        stripped = line.strip()
        if re.search(r"==\s*Basics\s*==", stripped, re.IGNORECASE):
            in_basics = True
            continue
        if in_basics:
            # Stop at Color line
            if re.search(r"'''Color\s*:", stripped):
                break
            # Check for exclusive/limited pattern
            match = re.search(r"'''(.+?exclusive)'''", stripped, re.IGNORECASE)
            if not match:
                match = re.search(r"'''(.+?limited)'''", stripped, re.IGNORECASE)
            if match:
                return match.group(1).strip()
    return None


def main():
    print("Fetching hero list from Category:Heroes...")
    heroes = fetch_hero_list()
    print(f"Found {len(heroes)} hero pages (ns:0).\n")

    availability = {}
    for i, hero in enumerate(heroes, 1):
        print(f"[{i}/{len(heroes)}] {hero}...", end=" ", flush=True)
        avail = fetch_availability(hero)
        availability[hero] = avail
        print(avail if avail else "(permanent)")
        time.sleep(DELAY)

    # Save results
    with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
        json.dump(availability, f, indent=2, ensure_ascii=False)
    print(f"\nSaved to {OUTPUT_PATH}")

    # Summary
    exclusive_heroes = {k: v for k, v in availability.items() if v is not None}
    permanent_heroes = {k: v for k, v in availability.items() if v is None}
    print(f"\n=== Summary ===")
    print(f"Total heroes: {len(availability)}")
    print(f"Permanent (standard pool): {len(permanent_heroes)}")
    print(f"Exclusive/limited: {len(exclusive_heroes)}")

    if exclusive_heroes:
        # Group by event type
        event_types = {}
        for hero, avail in exclusive_heroes.items():
            event_types.setdefault(avail, []).append(hero)
        print(f"\nEvent types ({len(event_types)}):")
        for event, heroes_list in sorted(event_types.items()):
            print(f"  {event}: {', '.join(heroes_list)}")


if __name__ == "__main__":
    main()
