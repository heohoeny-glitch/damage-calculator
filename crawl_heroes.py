#!/usr/bin/env python3
"""Refresh heroes.json and hero_stats.json from the Friends and Dragons wiki.

Fetches each hero's page (one per hero already present in heroes.json) and
re-parses the {{Character}} template: per-tier attack/health stats with
breakdowns (basic, asc..asc4) and the basic/ascension/merge trait lists.
Identity fields (name_kr, class, color, species, stars, availability) are
kept from the existing data.

Heroes whose page is missing or unparsable keep their old data and are
listed at the end.
"""

import json
import re
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor

API = ("https://friends-and-dragons.fandom.com/api.php"
       "?action=parse&prop=wikitext&format=json&page=")

TIERS = ["basic", "asc", "asc2", "asc3", "asc4"]

STAT_RE = re.compile(r"(\d+)\s*<br\s*/?\s*>\s*\(([^)]+)\)")
TRAIT_RE = re.compile(r"\{\{Trait\|Name=([^|}]+)")


def fetch_wikitext(title):
    url = API + urllib.parse.quote(title)
    req = urllib.request.Request(url, headers={"User-Agent": "fnd-damage-calc/1.0"})
    with urllib.request.urlopen(req, timeout=30) as resp:
        data = json.load(resp)
    if "error" in data:
        return None
    return data["parse"]["wikitext"]["*"]


def parse_character_template(wikitext):
    """Return {field: value} from the {{Character ...}} template."""
    start = wikitext.find("{{Character")
    if start == -1:
        return None
    end = wikitext.find("\n}}", start)
    body = wikitext[start:end if end != -1 else None]

    fields = {}
    current = None
    for line in body.split("\n"):
        m = re.match(r"\|\s*([a-z0-9_]+)\s*=(.*)", line)
        if m:
            current = m.group(1)
            fields[current] = m.group(2).strip()
        elif current:
            fields[current] += "\n" + line
    return fields


def parse_stat(value):
    if not value:
        return None
    m = STAT_RE.search(value)
    if not m:
        return None
    return int(m.group(1)), m.group(2).strip()


def parse_traits(value):
    return [t.strip() for t in TRAIT_RE.findall(value or "")]


def crawl_hero(hero):
    """Return (hero_name, update_dict or None)."""
    try:
        wikitext = fetch_wikitext(hero["name"])
        fields = parse_character_template(wikitext) if wikitext else None
    except Exception:
        fields = None
    if not fields:
        return hero["name"], None

    stats = {}
    for tier in TIERS:
        attack = parse_stat(fields.get(f"{tier}_attack"))
        health = parse_stat(fields.get(f"{tier}_health"))
        if attack and health:
            stats[tier] = {
                "attack": attack[0], "attack_breakdown": attack[1],
                "health": health[0], "health_breakdown": health[1],
            }
    if "basic" not in stats:
        return hero["name"], None

    basic = parse_traits(fields.get("basic_traits"))
    ascension = [t for tier in TIERS[1:] for t in parse_traits(fields.get(f"{tier}_traits"))]
    merge = parse_traits(fields.get("merge_traits"))
    return hero["name"], {
        "basic": basic,
        "ascension": ascension,
        "merge": merge,
        "all": basic + ascension + merge,
        "stats": stats,
    }


def main():
    heroes = json.load(open("heroes.json"))

    with ThreadPoolExecutor(max_workers=8) as pool:
        results = dict(pool.map(crawl_hero, heroes))

    failed, gained_asc4, stat_changed = [], [], []
    for hero in heroes:
        update = results[hero["name"]]
        if update is None:
            failed.append(hero["name"])
            continue
        had_asc4 = bool(hero.get("stats", {}).get("asc4"))
        if hero.get("stats") != update["stats"]:
            stat_changed.append(hero["name"])
        if not had_asc4 and "asc4" in update["stats"]:
            gained_asc4.append(hero["name"])
        hero.update(update)

    hero_stats = {}
    for hero in heroes:
        entry = {}
        for tier in TIERS:
            s = hero["stats"].get(tier)
            if s:
                entry[f"{tier}_attack"] = {"total": s["attack"], "breakdown": s["attack_breakdown"]}
                entry[f"{tier}_health"] = {"total": s["health"], "breakdown": s["health_breakdown"]}
        hero_stats[hero["name"]] = entry

    json.dump(heroes, open("heroes.json", "w"), ensure_ascii=False, indent=2)
    json.dump(hero_stats, open("hero_stats.json", "w"), ensure_ascii=False, indent=2)

    asc4_count = sum(1 for h in heroes if "asc4" in h["stats"])
    print(f"{len(heroes)} heroes, {asc4_count} with asc4 (+{len(gained_asc4)} new)")
    print(f"stats changed: {len(stat_changed)}")
    if gained_asc4:
        print("gained asc4:", ", ".join(gained_asc4))
    if failed:
        print("FAILED (kept old data):", ", ".join(failed))


if __name__ == "__main__":
    main()
