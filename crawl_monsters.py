#!/usr/bin/env python3
"""Crawl the Friends and Dragons wiki 'Monsters' page into monsters.json.

The wiki table lists, per monster: name, reference level/ATK/HP (highest
level available -- actual stage stats differ, so these are defaults only),
monster type (class), AI, speed (move range), attack kind, attack
directions, support pattern and the full trait list with descriptions.

Also writes monster_traits.json: {trait name: description} collected from
every trait template on the page.
"""

import json
import re
import urllib.request

API = ("https://friends-and-dragons.fandom.com/api.php"
       "?action=parse&page=Monsters&prop=wikitext&format=json")
TYPES_API = ("https://friends-and-dragons.fandom.com/api.php"
             "?action=parse&page=Monster%20Types&prop=wikitext&format=json")

# Korean display names (game is localized; the wiki is English).
# CONFIRMED_KR: names verified in-game. Everything else is composed from
# WORD_KR as a best-effort guess (marked name_kr_auto) — corrections welcome.
CONFIRMED_KR = {
    "Troll": "트롤",
    "Ogre": "오거",
    "Orc Shaman": "오크 샤먼",
    "Goblin": "고블린",
    "Orc Mage": "오크 메이지",
    "Winter Knight": "겨울 기사",
}

WORD_KR = {
    "Abomination": "어보미네이션", "Acid": "애시드", "Acidling": "애시들링",
    "Almiraj": "알미라지", "Alpha": "알파", "Ancient": "고대", "Animus": "애니머스",
    "Ankylos": "안킬로스", "Ant": "개미", "Arcane": "아케인", "Archbutcher": "대도살자",
    "Archdevil": "대악마", "Archer": "아처", "Archfiend": "대악귀", "Archon": "아콘",
    "Assassin": "암살자", "Avenger": "복수자", "Bad": "나쁜", "Ballasta": "발라스타",
    "Banshee": "밴시", "Bat": "박쥐", "Beetle": "딱정벌레", "Berserker": "버서커",
    "Black": "검은", "Blackfire": "흑염", "Blackguard": "블랙가드", "Blizzard": "블리자드",
    "Blood": "피", "Bloom": "꽃", "Blue": "파란", "Boom": "붐", "Boss": "보스",
    "Bot": "봇", "Bouncer": "바운서", "Bowler": "볼러", "Bright": "빛나는",
    "Brood": "브루드", "Brutalizer": "브루탈라이저", "Brutalodon": "브루탈로돈",
    "Brute": "브루트", "Buff": "버프", "Burner": "버너", "Butcher": "도살자",
    "Captain": "대장", "Celestial": "천상", "Centaur": "켄타우로스", "Centimane": "센티메인",
    "Cherub": "케루브", "Chicken": "닭", "Chomper": "촘퍼", "Cinder": "신더",
    "Clay": "점토", "Cloud": "구름", "Coatl": "코아틀", "Colossus": "콜로서스",
    "Crab": "게", "Crawler": "크롤러", "Crippling": "크리플링", "Crone": "크론",
    "Crystallian": "크리스탈리안", "Cultist": "광신도", "Cyclone": "사이클론",
    "Cyclops": "사이클롭스", "Dark": "어둠", "Deep": "심연", "Demon": "악마",
    "Demonic": "악마의", "Devil": "데빌", "Devourer": "포식자", "Dodo": "도도",
    "Dragon": "드래곤", "Dread": "공포", "Dreadnought": "드레드노트", "Dreamer": "몽상가",
    "Dryad": "드라이어드", "Dummy": "더미", "Dust": "먼지", "Dweller": "거주자",
    "Earth": "대지", "Egg": "알", "Elder": "엘더", "Elemental": "엘리멘탈",
    "Elf": "엘프", "Erupting": "분출하는", "Eyes": "눈", "Faceless": "페이스리스",
    "Faerie": "페어리", "Fallen": "타락한", "Fiend": "핀드", "Fire": "화염",
    "Fireburst": "파이어버스트", "Firecraker": "폭죽", "Flare": "플레어", "Flesh": "살점",
    "Fly": "파리", "Forest": "숲", "Freezer": "프리저", "Freezing": "빙결",
    "Frost": "서리", "Frostfire": "서리불꽃", "Gargoyle": "가고일", "Ghost": "유령",
    "Giant": "자이언트", "Goblin": "고블린", "Golem": "골렘", "Goo": "구",
    "Great": "그레이트", "Green": "초록", "Grotesque": "그로테스크", "Guard": "경비병",
    "Guardian": "수호자", "Harpy": "하피", "Harvester": "수확자", "Heavy": "헤비",
    "Height": "하이트", "Herald": "전령", "Hog": "멧돼지", "Horned": "뿔달린",
    "Hound": "사냥개", "Houndcaller": "하운드콜러", "Howler": "하울러", "Hunter": "헌터",
    "II": "II", "Ice": "아이스", "Imp": "임프", "Infernal": "인페르날",
    "Ironclad": "철갑", "Ivy": "담쟁이", "Javelineer": "투창병", "Jelly": "젤리",
    "Jurassic": "쥬라기", "Keg": "술통", "King": "킹", "Knight": "기사",
    "Lantern": "랜턴", "Lasher": "래셔", "Leshen": "레셴", "Lich": "리치",
    "Living": "리빙", "Lizard": "리자드", "Locust": "메뚜기", "Lord": "로드",
    "Lost": "잃어버린", "Mage": "메이지", "Maggot": "구더기", "Major": "메이저",
    "Mana": "마나", "Mandragora": "만드라고라", "Manticore": "만티코어", "Mantis": "사마귀",
    "Marmo": "마르모", "Matriarch": "여족장", "Mephit": "메피트", "Merfolk": "머포크",
    "Mhulhu": "물루", "Mini": "미니", "Minotaur": "미노타우로스", "Mk.": "Mk.",
    "Moth": "나방", "Mummified": "미라화된", "Mummy": "미라", "Myrmidon": "미르미돈",
    "Naga": "나가", "Needler": "니들러", "Newt": "도롱뇽", "Nian": "니안",
    "Ninja": "닌자", "Nix": "닉스", "Nymph": "님프", "Ochre": "오커",
    "Ogre": "오거", "One": "원", "Ooze": "우즈", "Orc": "오크",
    "Pasthur": "파스투르", "Patriarch": "족장", "Phoenix": "피닉스", "Pixie": "픽시",
    "Plague": "역병", "Poison": "독", "Primal": "프라이멀", "Primordial": "태초의",
    "Providence": "프로비던스", "Pudding": "푸딩", "Queen": "퀸", "Radiant": "빛나는",
    "Raptor": "랩터", "Rat": "쥐", "Reaper": "리퍼", "Red": "붉은",
    "Ripjaw": "립죠", "Roach": "바퀴벌레", "Rocket": "로켓", "Ronin": "로닌",
    "Rose": "장미", "Sage": "현자", "Sapling": "묘목", "Scarab": "스카라브",
    "Scorpion": "전갈", "Scourgeling": "스커지링", "Sea": "바다", "Seer": "예언자",
    "Sensei": "센세이", "Sentry": "센트리", "Servobot": "서보봇", "Shaman": "샤먼",
    "Shellbreaker": "셸브레이커", "Shrine": "사당", "Shrubbery": "덤불", "Sidhe": "시드",
    "Silverback": "실버백", "Siren": "세이렌", "Skeletal": "해골", "Skull": "스컬",
    "Slime": "슬라임", "Snatcher": "스내처", "Spellbinder": "스펠바인더",
    "Spelleater": "스펠이터", "Sphinx": "스핑크스", "Spider": "거미", "Spirit": "정령",
    "Star-Stone": "스타스톤", "Stinger": "스팅어", "Stinghag": "스팅해그", "Stone": "돌",
    "Sulfuron": "설퍼론", "Suspicious": "수상한", "T-Rex": "티렉스", "Tearshot": "티어샷",
    "Templar": "템플러", "Thane": "테인", "Tiger": "호랑이", "Toad": "두꺼비",
    "Totem": "토템", "Toxic": "맹독", "Training": "훈련용", "Trapper": "트래퍼",
    "Treant": "트렌트", "Trickster": "트릭스터", "Troll": "트롤", "Tyrant": "폭군",
    "Undying": "불사의", "Ungol": "운골", "Unshackled": "해방된", "Ursa": "우르사",
    "Vampire": "뱀파이어", "Village": "마을", "Vine": "덩굴", "Voice": "목소리",
    "Void": "공허", "War": "전쟁", "Warchief": "워치프", "Warlord": "워로드",
    "Warrior": "전사", "Warshaman": "워샤먼", "Watcher": "감시자", "Weaver": "위버",
    "Whelp": "웰프", "Whisper": "속삭임", "Widow": "위도우", "Wild": "와일드",
    "Winter": "겨울", "Wisp": "위습", "Witch": "마녀", "Withering": "위더링",
    "Worker": "일꾼", "Wraith": "레이스", "Wyrmkin": "윔킨", "Yeti": "예티",
    "Zombie": "좀비",
    # Monster Types page additions
    "Brawler": "브롤러", "Centipede": "지네", "Elementalist": "엘리멘탈리스트",
    "Hive": "하이브", "Mother": "마더", "Kobra": "코브라", "Sand": "모래",
    "Rotten": "썩은", "Tree": "나무", "Tentacle": "촉수", "Water": "물",
}


def kr_name(name):
    """Best-effort Korean name. Returns (kr, confirmed)."""
    if name in CONFIRMED_KR:
        return CONFIRMED_KR[name], True
    work = name.replace("The ", "")
    if " of " in work:  # "Voice of Winter" -> "겨울의 목소리"
        a, b = work.split(" of ", 1)
        return f"{kr_name(b)[0]}의 {kr_name(a)[0]}", False
    return " ".join(WORD_KR.get(w, w) for w in work.split()), False


def fetch_wikitext(url=API):
    req = urllib.request.Request(url, headers={"User-Agent": "damage-calculator-crawler"})
    with urllib.request.urlopen(req) as resp:
        return json.load(resp)["parse"]["wikitext"]["*"]


def parse_talent_list(cell):
    """'Venom x 2, Flying' -> ['Venom', 'Venom', 'Flying']"""
    out = []
    for part in cell.split(","):
        part = part.strip()
        if not part:
            continue
        m = re.match(r"(.+?)\s*[xX]\s*(\d+)$", part)
        if m:
            out.extend([m.group(1).strip()] * int(m.group(2)))
        else:
            out.append(part)
    return out


# The main Monsters table is incomplete; the Monster Types page lists more
# (name + talents per type section, no stats). Merge those in.
def parse_types_page(known_names):
    wikitext = fetch_wikitext(TYPES_API)
    extra = []
    for sec_m in re.finditer(r"===\s*([^=]+?)\s*===(.*?)(?====|\Z)", wikitext, re.S):
        section, body = sec_m.group(1), sec_m.group(2)
        cls = section.strip().lower()
        cls = cls[:-1] if cls.endswith("s") and cls != "cyclops" else cls
        for table in re.findall(r"\{\|.*?\|\}", body, re.S):
            for row in re.split(r"\n\|-", table)[1:]:
                lines = [l.lstrip("|").strip() for l in row.strip().splitlines()
                         if l.startswith("|") and not l.startswith("|}")]
                if len(lines) < 2 or not lines[0] or lines[0].startswith("+"):
                    continue
                name = re.sub(r"\[\[|\]\]", "", lines[0]).strip()
                if not name or name in known_names:
                    continue
                kr, confirmed = kr_name(name)
                extra.append({
                    "name": name,
                    "name_kr": kr,
                    "name_kr_auto": not confirmed,
                    "image": None,
                    "refLevel": None,
                    "classes": [cls],
                    "refAtk": None,
                    "refHp": None,
                    "ai": None,
                    "moveRange": None,
                    "attackKind": None,
                    "attackDirs": None,
                    "support": [],
                    "traits": parse_talent_list(lines[1]),
                })
                known_names.add(name)
    return extra


def split_cells(row):
    """Split a table row on '||' at template depth 0."""
    cells, depth, cur = [], 0, []
    i = 0
    while i < len(row):
        two = row[i:i + 2]
        if two == "{{":
            depth += 1
            cur.append(two)
            i += 2
        elif two == "}}":
            depth -= 1
            cur.append(two)
            i += 2
        elif two == "||" and depth == 0:
            cells.append("".join(cur))
            cur = []
            i += 2
        else:
            cur.append(row[i])
            i += 1
    cells.append("".join(cur))
    return cells


def parse_traits(cell):
    """Extract [(name, desc, pic)] from {{Trait | Name=... | ForcePic=...}}."""
    out = []
    for m in re.finditer(r"\{\{Trait\s*\|(.*?)\}\}", cell, re.S):
        body = m.group(1)
        name_m = re.search(r"Name\s*=\s*([^|]*)", body, re.S)
        pic_m = re.search(r"ForcePic\s*=\s*([^|]*)", body, re.S)
        if not name_m:
            continue
        raw = name_m.group(1).strip()
        if ":" in raw:
            name, desc = raw.split(":", 1)
        else:
            name, desc = raw, ""
        out.append((name.strip(), desc.strip(), (pic_m.group(1).strip() if pic_m else "")))
    return out


def num(cell):
    m = re.search(r"\d+", cell.replace(",", ""))
    return int(m.group()) if m else None


ATTACK_KINDS = {"melee": "melee", "ranged": "ranged", "magic": "magic"}
DIRS = {"4Direction": "cross", "8Direction": "all8", "4": "cross", "8": "all8"}


def parse_row(row):
    cells = [c.strip() for c in split_cells(row.strip().lstrip("|"))]
    if len(cells) < 11:
        return None
    name_m = re.search(r"\]\]\s*(.+)$", cells[0]) or re.search(r"^([^\[]+)$", cells[0])
    if not name_m:
        return None
    name = name_m.group(1).strip()
    if not name:
        return None
    img_m = re.search(r"File:([^|\]]+)", cells[0])

    classes = [t[0].lower() for t in parse_traits(cells[2])]
    ai = next((t[0] for t in parse_traits(cells[5])), None)
    kind = next((ATTACK_KINDS.get(t[0].lower()) for t in parse_traits(cells[7])), None)
    dir_pics = [t[2] or t[0] for t in parse_traits(cells[8])]
    dirs = next((DIRS[p] for p in dir_pics if p in DIRS), None)
    support = [t[0] for t in parse_traits(cells[9])]
    traits = [t[0] for t in parse_traits(cells[10])]

    kr, confirmed = kr_name(name)
    return {
        "name": name,
        "name_kr": kr,
        "name_kr_auto": not confirmed,  # auto-generated guess, not verified in-game
        "image": img_m.group(1).strip() if img_m else None,
        "refLevel": num(cells[1]),
        "classes": classes,
        "refAtk": num(cells[3]),
        "refHp": num(cells[4]),
        "ai": ai,
        "moveRange": num(cells[6]),
        "attackKind": kind,
        "attackDirs": dirs,
        "support": support,
        "traits": traits,
    }


def main():
    wikitext = fetch_wikitext()

    trait_descs = {}
    for name, desc, _pic in parse_traits(wikitext):
        if desc and name not in trait_descs:
            trait_descs[name] = desc

    monsters = []
    for table in re.findall(r"\{\|.*?\|\}", wikitext, re.S):
        rows = re.split(r"\n\|-", table)
        for row in rows[1:]:  # skip header
            row = row.strip()
            if not row or row.startswith("!") or row.startswith("}"):
                continue
            row = row.removesuffix("|}").strip()
            parsed = parse_row(row)
            if parsed and parsed["refAtk"] is not None:
                monsters.append(parsed)

    extra = parse_types_page({m["name"] for m in monsters})
    monsters.extend(extra)
    print(f"merged from Monster Types page: {len(extra)}")

    monsters.sort(key=lambda m: m["name"])
    with open("monsters.json", "w", encoding="utf-8") as f:
        json.dump(monsters, f, ensure_ascii=False, indent=1)
    with open("monster_traits.json", "w", encoding="utf-8") as f:
        json.dump(dict(sorted(trait_descs.items())), f, ensure_ascii=False, indent=1)
    print(f"monsters: {len(monsters)}, trait descriptions: {len(trait_descs)}")


if __name__ == "__main__":
    main()
