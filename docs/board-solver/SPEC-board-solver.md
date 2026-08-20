# 배치 솔버 (Board Solver) — 개발 명세서

> 대상 저장소: `heohoeny-glitch/damage-calculator`
> 목적: 기존 데미지 계산기에 **보드 배치 최적화 + 경로 표시** 탭을 추가한다.
> 작성일: 2026-08-19

---

## 0. 이 문서를 읽는 Claude Code에게

이 프로젝트는 **AI 추론이 아니라 완전탐색**으로 답을 낸다.
"좋아 보이는 배치"를 생성하는 게 아니라, 도달 가능한 모든 배치를 열거하고 결정론적 규칙으로 점수를 매겨 정렬한다.
휴리스틱을 넣고 싶어지면 먼저 §5의 탐색 공간 크기를 확인할 것. 대부분의 경우 완전탐색이 그냥 된다.

**작업 순서 권장**: §7 모듈을 `rules → movegen → evaluate → solver → render` 순으로 만들고,
각 단계마다 §9의 픽스처(심연의 동굴 1‑3)로 검증한다.

---

## 1. 현재 상태

### 1.1 기존 사이트 구성

| 탭 | 기능 |
|---|---|
| Damage Calculator | ATK/DEF, 리더 버프, 펫 버프, 재능 선택 → 최종 데미지 |
| Trait Finder | 공격/방어/유틸 재능 필터 |
| EXP Table | 성급·승급별 레벨업 필요 경험치 |

영웅 DB를 비동기로 로드한다 (UI에 `Loading heroes…` 표시).
**이 DB를 그대로 재사용한다. 새로 만들지 않는다.**

### 1.2 추가할 것

4번째 탭 **Board Solver**.

- 6×6 격자에 지형·아군·적 배치 입력
- 도달 가능한 모든 배치 열거
- 각 배치의 딜/처치/피격 계산
- 상위 N개를 **드래그 경로 화살표 + 순번**과 함께 표시

---

## 2. 게임 규칙 (검증 완료)

출처: Friends and Dragons Wiki (Combat Basics) + 실제 플레이 영상 프레임 분석.

### 2.1 턴 구조

1. 제한시간 동안 배치 (스테이지별로 다름, 예: `5 + 15.5초`)
2. 시간 종료 → 아군 공격 일괄 처리
3. 적 이동 → 적 공격
4. 턴 카운터 +1

### 2.2 이동

- 플레이어는 영웅을 **드래그**해서 옮긴다.
- 드래그 중 아군 칸에 진입하면 **서로 자리가 스왑**된다 (십자 + 대각선 모두).
- 몬스터나 지형에 막히면 스왑 불가.
- **경로가 결과를 바꾼다.** 같은 도착지라도 경유한 아군이 다르면 최종 배치가 다르다.
- `Tumble`(로그) 재능은 몬스터와 스왑, `Push` 재능은 몬스터를 밀어낸다. 둘 다 대각선 불가.
- **대각선 끼어들기 금지 (2026-08-20 플레이어 확인)**: 대각 이동 경로의 양옆 두 칸이
  모두 막혀 있으면(불가 지형 또는 적이 대각으로 배치) 그 사이로 대각 이동할 수 없다.
  예: C2·B3이 벽이면 C3→B2 불가. 아군은 봉쇄로 치지 않는다(스왑 가능).
  **미확정**: 한쪽만 막힌 경우에도 불가인지 — 현재는 허용으로 구현 (`movegen.js`의 TODO).

> **✅ 확정 (2026-08-20 재정정, 플레이어 확인)**
> 드래그는 **턴당 1회**(연속 제스처 1번)다 — 위키의 "한 명만 직접 이동"이 맞았다.
> 대신 그 한 번의 드래그 안에서 **경로 스텝 수는 제한시간 내 무제한**이다.
> ("횟수 제한 없음"의 첫 해석(여러 번 드래그)은 오해였다.)
> 탐색: `movegen.js`는 (드래그 영웅 위치, 팀 배치) 상태 공간 BFS — 같은 상태의 최단
> 경로만 유지하므로 스텝 상한 없이도 탐색이 유한하다. §10.1 참조.

### 2.3 공격 순서

- **마지막으로 움직인 순서**대로 공격한다 (이전 라운드 이력 포함).
- 직접 드래그한 영웅이 **항상 먼저**.
- 안 움직인 영웅은 팀 편성 순서대로.
- 몬스터는 **이동력이 높은 순**, 동률이면 매 턴 랜덤.

> 공격 순서는 `Finishing Blow`, `Princess` 버프 발동 여부를 바꾼다. 무시하면 안 된다.

### 2.4 공격 유형

| 유형 | 판정 |
|---|---|
| Melee | 인접 1칸. 십자 또는 8방향 |
| Ranged | 패턴 방향의 **첫 번째** 적만 |
| Magic | 패턴 방향의 **모든** 적 (관통) |

**클래스별 패턴**

| 클래스 | 유형 | 패턴 | 역할 |
|---|---|---|---|
| Knight | Melee | 십자 | Defender |
| Guardian | Melee | 십자 | Defender |
| Barbarian | Melee | 8방향 | Defender |
| Assassin | Melee | 십자 | Attacker |
| Rogue | Melee | 8방향 | Attacker |
| Monk | Melee | 8방향 | Attacker |
| Pirate | Melee 또는 Ranged | 8방향 또는 십자 | Attacker |
| Paladin | Melee | 십자 | Support (지원: 8방향 근접) |
| Druid | Melee | 십자 | Support (지원: 십자 원거리) |
| Princess | Melee | 8방향 | Support (지원: 십자 관통) |
| Archer | Ranged | 십자 | Attacker |
| Hunter | Ranged | 십자 | Attacker |
| Ranger | Ranged | 8방향 | Attacker |
| Mage | Magic | 십자 | Attacker |
| Witch | Magic | 십자 | Attacker |
| Elementalist | Magic | 8방향 | Attacker |
| Healer | Magic | 십자 | Support (지원: 십자 원거리) |

> **⚠️ 표 미비 (2026-08-20 발견)**: `heroes.json`에는 위 표에 없는 클래스가 존재한다 —
> **Javelineer, Warrior, Gladiator, Bard, Warlock** (등). 픽스처의 Aquatic Agil(Javelineer),
> Radomyr(Warrior)가 여기 해당하므로 위키에서 패턴을 보강해야 한다.
> `rules.js`의 클래스→패턴 매핑은 미지 클래스에 대해 명시적 에러를 내게 만들 것 (조용한 기본값 금지).

### 2.5 지형

| 타일 | 효과 |
|---|---|
| Ground | 통과 가능 |
| Rubble | 이동 불가, 일부 공격은 통과 |
| Wall | 이동·공격 모두 차단 |
| Water | `Water Walker` 없으면 공격 불가, 매 턴 육지로 1칸 자동 이동 |
| Lava | 매 턴 HP 25% · DEF 50% 손실, 공격 불가, 육지로 자동 이동 |

`Flying`, `Ethereal` 몬스터는 Rubble/Water/Lava 무시.

### 2.6 몬스터 클래스 특성

| 클래스 | 특성 |
|---|---|
| Beast | 근접 **-50%** |
| Skeleton | 원거리 **-50%** |
| Clockwork | 마법 **-50%** |
| Dragon / Lizard | 대각선 **-50%** |
| Insect | 십자 **-50%** |
| Goblinoid | 풀피일 때 공격력 **+25%** |
| Demon | 매 턴 아케인 실드 |
| Ghost | 공격당 **1 데미지**만 |
| Golem | 모든 디버프 면역 |
| Celestial | 턴 시작 시 DEF의 100% 회복 |
| Undead / Construct / Elemental | 흡혈·독·출혈 등 면역 (범위 상이) |

### 2.7 몬스터 AI

| AI | 행동 | 구현 |
|---|---|---|
| Charge | 최소 이동으로 공격. **공격 가능 위치가 여럿이면 랜덤** (2026-08-20 확인) | ✅ |
| Unpredictable | 무작위 이동, 항상 공격 시도 | ✅ |
| Evade | 최대 거리 유지하며 원거리 공격 | ✅ |
| Assassin | **HP 최저** 대상 우선 | ✅ |
| Supporter | 최대한 많은 아군 지원 위치로 이동 | ✅ |
| Tactician | **최대한 많은 적** 타격 위치로 이동 | ✅ |

**확정 (2026-08-20)**: 몬스터는 **대각선 이동 불가** (십자만). 동률 선택은 랜덤 —
시뮬레이션은 시드 주입식 RNG로 재현 가능하게 처리 (`simulateMonsterTurn({seed})`).
추가 구현: **Flying**(잔해/물/용암 통과, 착지는 불가), **Lumbering**(이동 전에 공격),
**Healer**(인접 8방향 부상 아군에게 DEF 20% 회복 — 회복 시 공격 생략 가정).

---

## 3. 데미지 수식

### 3.1 공격

```
D = ATK_base
  × Leader
  × (1 + Σ 활성 재능)
  × ColorAdv
  × HeroBonus
```

- `Σ 재능`: 일반 0.25, 종족 특효 0.5. **발동 조건 만족한 것만** 합산
  (예: `Sniper`는 대상이 2칸 이상일 때만)
- `ColorAdv`: 유리 상성 1.5, 그 외 1.0
- `HeroBonus`: **Uniform(1.00, 1.25)** ← 난수

**상성**: `청 → 적 → 녹 → 청`, `광 ↔ 암`

### 3.2 방어

```
Taken = D × 0.8^A × 0.5^B × SpeciesParry
```

- `A`: 20% 감소 효과 개수 (패리, Nature's Harmony 등) — **곱연산 누적**
- `B`: 50% 감소 효과 개수 (몬스터 클래스 특성 등)
- `SpeciesParry`: **Uniform(0.8, 1.0)** ← 난수

**종족별 패리 적용 조건**

| 종족 | 조건 |
|---|---|
| Human | 근접 피격 시 |
| Elf | 원거리 피격 시 |
| Dwarf | 마법 피격 시 |
| Orc | 풀피일 때 |
| Dragon | 같은 색 공격 |

> **⚠️ 표 미비**: `heroes.json`에는 **Beastfolk, Dragonborn** 종족도 존재한다 (픽스처의 Squall이 Beastfolk).
> Dragonborn ↔ Dragon 대응 여부와 Beastfolk 패리 조건을 위키에서 확인할 것.

### 3.3 난수 처리

`HeroBonus ~ U(1, 1.25)`, `SpeciesParry ~ U(0.8, 1.0)` — 독립.
실효 배수 `M = HeroBonus × SpeciesParry`는 두 균등분포의 곱.

**출력은 반드시 구간으로 낸다.**

```
최소   D × 1.00 × 0.8
기대   D × E[M]
최대   D × 1.25 × 1.00
처치확률  P(D × M ≥ 잔여HP)
```

몬테카를로 10,000회면 충분하다. 폐형식을 쓰고 싶으면 곱분포의 CDF를 직접 적분해도 된다.

---

## 4. 데이터 스키마

### 4.1 보드

```ts
type TileType = 'ground' | 'rubble' | 'wall' | 'water' | 'lava';

interface Board {
  width: number;    // 던전마다 다름 (3~12 지원, UI 기본 6)
  height: number;   // 던전마다 다름
  tiles: TileType[][];  // [row][col], row 0 = 최상단
}
```

좌표 표기: 열 `A~L`, 행 `1~12`. `A1` = 좌상단.
**칸수는 던전마다 다르다** (2026-08-20 확인) — UI 툴바에서 가로×세로를 입력하며,
스크린샷 인식 격자도 이 값을 따른다.

### 4.2 유닛

```ts
interface Unit {
  id: string;
  side: 'hero' | 'monster';
  pos: string;              // 'C3'
  name: string;

  color: 'red' | 'blue' | 'green' | 'light' | 'dark';
  species?: 'human' | 'elf' | 'dwarf' | 'orc' | 'dragon';
  monsterClasses?: string[];   // ['goblinoid']

  atk: number;
  hp: number;
  hpMax: number;
  def: number;

  heroClass?: string;       // 'ranger' — 아군만
  traits: string[];         // 재능 ID 배열
  isLeader?: boolean;
  petSkill?: number;        // HP 바 우측 회색 뱃지 = 펫 스킬 수치 (§10.2 확정)

  moveRange?: number;       // 몬스터만
  ai?: string;              // 몬스터만
  size?: 1 | 2;             // 보스 2×2
}
```

### 4.3 재능

기존 Trait Finder DB를 재사용한다. 솔버가 추가로 요구하는 필드:

```ts
interface Trait {
  id: string;
  name: string;
  kind: 'attack' | 'defense' | 'utility';
  value: number;                    // 0.25 / 0.5 / 0.2 ...
  condition?: TraitCondition;       // 발동 조건
}

type TraitCondition =
  | { type: 'minDistance'; tiles: number }        // Sniper
  | { type: 'targetBehind' }                      // Backstab
  | { type: 'fullHP' }
  | { type: 'targetSpecies'; species: string }
  | { type: 'targetClass'; cls: string }
  | { type: 'adjacentEnemies'; min: number };     // Whirlwind, Berserk
```

> **작업 필요**: 기존 DB에 `condition`이 없으면 추가해야 한다.
> 조건 없는 재능을 항상 발동으로 처리하면 데미지가 과대평가된다.

### 4.4 몬스터 DB — `monsters.json` (2026-08-20 추가)

위키 `Monsters` 페이지를 `crawl_monsters.py`로 크롤링한 252종:

```ts
interface MonsterDb {
  name: string;          // "Troll"
  name_kr?: string;      // "트롤" — KR_NAMES 수동 매핑, 점진 확장
  image: string;         // 위키 아이콘 파일명
  refLevel: number;      // 기준 레벨 (100) — 스탯은 참고값
  classes: string[];     // ['troll'] — 타입 (§2.6 감쇄/특성)
  refAtk: number; refHp: number;  // 기준 레벨 스탯. 실제 스테이지 값은 직접 입력
  ai: string;            // 'Charge' ...
  moveRange: number;
  attackKind: 'melee'|'ranged'|'magic';
  attackDirs: 'cross'|'all8';
  support: string[];     // 지원 패턴 (샤먼 '8' = 8방향 지원)
  traits: string[];      // 재능 이름 목록 ← 이 DB의 핵심
}
```

재능 설명은 `monster_traits.json` (216개, 이름 → 설명).

**레벨별 스탯 추정 공식 (2026-08-20 도출)**: 위키는 Lv.100 스탯만 제공하지만,
실측 Lv.4 데이터 4종과 대조하면 몬스터 스탯은 레벨에 선형이다:

```
stat(L) ≈ stat(100) × (L + 8.15) / 108.15
```

트롤/오거/샤먼/고블린 4종이 독립적으로 같은 오프셋(x = 8.0~8.19)을 가리키며,
HP는 4종 전부 정확히, ATK는 ±1 이내로 일치한다. `units.js:estimateMonsterStat()`.
UI에서 몬스터 레벨을 입력하면 자동 추정하되 **직접 수정 가능** (추정치임을 명시).

**몬스터 등급**: 일반 / 엘리트 / 선봉장 (인게임 관측, 위키 미문서화).
스탯 배수·추가 효과는 미확인이므로 UI에서 등급을 선택하되 표시용 메타데이터로만 취급한다.
효과가 확인되면 여기 기록하고 계산에 반영한다.

---

## 5. 탐색 공간

### 5.1 규모

```
유효칸 ≈ 28 (6×6 - 벽 8)
영웅 5기
경로 길이 상한 L = 8

영웅 1기당 단순경로   ≈ 10⁴ ~ 10⁵
5기 합계             ≈ 10⁵ ~ 10⁶
최종 배치로 dedup 후  ≈ 10³ 수준
```

**결론: 완전탐색 가능.** Web Worker에서 1초 내외.

> **주의 (2026-08-20 확정 반영)**: 드래그 횟수 무제한이 확정되면서 위 수치는 "드래그 1회" 기준이 됐다.
> 드래그 K회 조합은 공간이 지수적으로 커지므로, K = 1부터 반복 심화하며
> 배치 해시 dedup + 시간 예산(예: 2초)으로 끊는다. 같은 최종 배치에 도달하는
> 더 짧은 드래그 열이 있으면 항상 그쪽을 남긴다 (§6.4 목적함수 4번 기준과 일치).

### 5.2 최적화 포인트

1. **배치 해시로 dedup** — 서로 다른 경로가 같은 배치를 만드는 경우가 많다
2. **가지치기** — 어떤 적에게도 닿지 않는 배치는 조기 폐기
3. **점진적 심화** — `L = 4`부터 시작, 시간 여유 있으면 늘린다
4. **비트보드** — 36칸이므로 `BigInt` 또는 `Uint32Array` 2개로 점유 상태 표현 가능

---

## 6. 알고리즘

### 6.1 경로 열거

```
function enumerateDrags(board, units, heroId, maxLen):
    results = []
    start = units[heroId].pos
    dfs(path=[start], config=units.clone())

    function dfs(path, config):
        if path.length > 1:
            results.push({ path, config: config.clone() })
        if path.length > maxLen: return

        for each dir in 8방향:
            next = path.last + dir
            if not walkable(board, next): continue
            if occupiedByMonster(config, next):
                if hero has Tumble and dir is 십자: swap with monster
                else: continue
            if occupiedByAlly(config, next):
                swap(config, heroId, next)     # 자리바꿈
            else:
                move(config, heroId, next)
            dfs(path + [next], config)
            undo()
```

- `path`는 화면에 그릴 경로 그대로다. 렌더러가 이걸 받는다.
- 되돌아가는 경로도 유효하다 (스왑 순서가 바뀌므로). 단 같은 칸 3회 이상 방문은 컷.

### 6.2 아군 턴 평가

```
function evaluateHeroTurn(board, config, attackOrder):
    total = 0; kills = []
    for heroId in attackOrder:
        hero = config[heroId]
        targets = resolveTargets(board, config, hero)   # §2.4
        for t in targets:
            traits = activeTraits(hero, t, config)      # 조건 판정
            d = damage(hero, t, traits)                 # §3.1
            r = reduction(t, hero)                      # §3.2
            apply(t, d * r)
            if t.hp <= 0: kills.push(t.id)
    return { total, kills, config }
```

**공격 순서**: 드래그한 영웅 먼저, 나머지는 팀 편성 순서 (§2.3).

### 6.3 적 턴 시뮬레이션

```
function simulateMonsterTurn(board, config):
    order = monsters.sortBy(m => -m.moveRange)    # 동률은 랜덤
    for m in order:
        dest = aiMove(m, config)                  # §2.7 AI별 분기
        move(m, dest)
        for t in resolveTargets(board, config, m):
            apply(t, damage(m, t) * reduction(t, m))
    return incomingTotal, deaths
```

AI 동률 랜덤은 **여러 시드로 반복**해서 최악/기대값을 뽑는다.

### 6.4 목적함수

기본 정렬 기준 (사전식, 2026-08-20 개정):

1. **처치 수** 최대
2. **전멸이면**: **스텝 수 최소** 우선 (초과 딜은 무의미 — 같은 전멸이면 짧은 드래그가 낫다)
3. 전멸이 아니면: **총 딜** 최대 → **피격량** 최소 → **스텝 수** 최소

> 프리셋 3개를 제공한다: `딜 최대` / `생존 우선` / `균형`.
> 사용자가 가중치를 조절할 수 있게 슬라이더를 노출해도 좋다.

---

## 7. 모듈 구조

```
src/board-solver/
├── board.js       타일 정의, 좌표 변환(A1 ↔ [r,c]), 통행 판정
├── units.js       유닛 팩토리, 기존 hero DB 어댑터
├── rules.js       공격 패턴, 사거리, 시야 차단, 상성
├── traits.js      재능 조건 판정 (activeTraits)
├── damage.js      §3 수식, 난수 분포, 처치 확률
├── movegen.js     경로 열거 + 배치 dedup
├── evaluate.js    아군 턴 → 적 턴 시뮬
├── solver.js      탐색 오케스트레이션, 목적함수 정렬
├── solver.worker.js   Web Worker 래퍼
└── render.js      SVG 그리드 + 경로 화살표
```

### 7.1 의존 방향

```
render ← solver ← evaluate ← { movegen, damage } ← { rules, traits } ← { board, units }
```

역방향 import 금지. `damage.js`는 보드를 몰라야 한다.

---

## 8. 렌더링

### 8.1 그리드

- SVG 6×6. 타일 타입별 채색
- 유닛은 색상 테두리 + 이름 + `ATK/HP`
- 좌표 레일 (A~F / 1~6)

### 8.2 경로 화살표 ← 이번 작업의 핵심

```html
<defs>
  <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5"
          markerWidth="6" markerHeight="6" orient="auto-start-reverse">
    <path d="M 0 0 L 10 5 L 0 10 z"/>
  </marker>
</defs>

<polyline points="..." marker-end="url(#arrow)"
          stroke-linejoin="round" stroke-linecap="round"/>
```

**필수 요소**

| 요소 | 이유 |
|---|---|
| 경유 칸 **순번 뱃지** | 드래그 순서가 공격 순서를 결정한다 |
| 스왑 발생 지점 **양방향 아이콘** | 어느 아군과 바뀌는지 보여야 한다 |
| 곡선 오프셋 | 경로가 겹칠 때 구분 |
| 애니메이션 재생 버튼 | 실제 드래그 궤적 확인 |

`prefers-reduced-motion` 존중할 것.

### 8.3 결과 패널

상위 5개 배치를 카드로. 각 카드에:

- 처치 대상 목록
- 총 딜 (최소 / 기대 / 최대)
- 다음 턴 예상 피격량
- 드래그 스텝 수
- 클릭 시 보드에 경로 오버레이

---

## 9. 테스트 픽스처 — 심연의 동굴 1‑3, 웨이브 1

실측 데이터. 회귀 테스트 기준으로 쓴다.

### 9.1 보드

```
    A     B     C     D     E     F
1  wall  wall  오거  트롤  wall  wall
2  wall  H1    ·     ·     H2    wall
3  샤먼  ·     ·     ·     ·     샤먼
4  ·     ·     ·     ·     ·     ·
5  wall  H3    ·     ·     H4    wall
6  wall  wall  H5    ·     wall  wall
```

`wall` = 초록 수정 (이동·사격 차단), `·` = 일반 바닥

### 9.2 적

전원 **4레벨 · 적색 · 십자 근접 · Charge AI**

| 이름 | 위치 | ATK | HP | DEF | 이동 | 타입 | 재능 (위키 대조 확정) |
|---|---|---|---|---|---|---|---|
| 트롤 | D1 | 32 | 114 | 114 | 2 | **Troll** (턴 시작 DEF 33% 재생) | Mighty Blow ×2 |
| 오거 | C1 | 18 | 89 | 89 | 3 | Goblinoid | Mighty Blow |
| 오크 샤먼 | A3 | 5 | 69 | 69 | 3 | Goblinoid | Healer (아군 DEF 20% 회복, 지원 8방향) |
| 오크 샤먼 | F3 | 5 | 69 | 69 | 3 | Goblinoid | Healer |

> **정정 (2026-08-20)**: 인스펙터의 주먹 아이콘을 "공격 재능"으로 읽었던 것은 오독 —
> `monsters.json`(위키 크롤) 대조 결과 **Mighty Blow**다. 트롤의 타입도 Goblinoid가 아니라 **Troll**.

> 고블린 (ATK 9 / HP 20 / DEF 20 / 이동 3)은 웨이브 2~3 소속. 웨이브 1 보드에 없음.

### 9.3 아군

전원 **Lv.100 · 청색**. 적이 전원 적색이므로 **모든 공격에 ×1.5**.

**식별 완료 (2026-08-20, 초상 ↔ `images/portraits/` 템플릿 대조, 전원 high confidence)**

| 슬롯 | 위치 | 영웅 | 클래스 | 공격 유형 | 종족 | 성급 | 펫 스킬 |
|---|---|---|---|---|---|---|---|
| H1 | B2 | **Squall** 스퀄 | Healer | Magic 십자 | Beastfolk | 4성 | — |
| H2 | E2 | **Serelune** 세렐룬 | Archer | Ranged 십자 | Elf | 5성 | 8 |
| H3 | B5 | **Elysia** 엘리시아 | Monk | Melee **8방향** | Elf | 5성 | 25 |
| H4 | E5 | **Aquatic Agil** 아쿠아틱 아길 | Javelineer | (미확정 — §2.4에 없음) | Orc | 5성 | — |
| H5 | C6 | **Radomyr** 라도미르 | Warrior | (미확정 — §2.4에 없음) | Dwarf | 5성 | 8 |

> 초기 프레임 분석에서 H3를 "활"로 읽은 것은 오독이었다. Elysia는 몽크(근접 8방향)이며 이는 관측된 8방향 사거리 표시와 일치한다.

각 영웅의 재능·스탯은 `heroes.json`에서 그대로 가져온다 (예: Serelune basic = Sniper, Finishing Blow ×2, Cardinal Parry, Blitz, Initiative: Quick Attack).

**승급 단계 판독법** (플레이어 확인):
- 2단계 승급: 초상 사각형 위 표시가 **노란색**
- 3단계 승급: 초상 사각형 위 표시가 **핑크색**
- 4단계 승급: 표시 색이 아니라 **프레임 모양 자체가 다름** — 이 보드에서는 H3 Elysia(B5)가 4단계 프레임 → `stats.asc4` (ATK 2266 / HP 5734) 사용

HP 바 우측 회색 뱃지는 **펫 스킬 수치**다 (§10.2).
**남은 일**: H1·H2·H4·H5의 승급 단계 판독(뱃지 색 확대 확인), 리더 지정 확인, Lv.100과 DB 스탯 기준 레벨의 관계 확인.

### 9.4 이 픽스처로 검증할 것

- [ ] 위협 범위 계산이 벽을 정확히 우회하는가 (A3 샤먼이 A2 벽을 못 지나가는가)
- [ ] C1·D1이 인접하므로 세로 관통 사격이 둘 다 맞히는가
- [ ] Goblinoid 풀피 +25%가 초기 상태에서 적용되는가
- [ ] 샤먼 회복이 다음 턴 트롤 HP에 반영되는가
- [ ] 청→적 ×1.5가 모든 아군 공격에 붙는가

---

## 10. 미해결 사항

### 10.1 ✅ 해결 (재정정) — 드래그는 턴당 1회, 스텝은 무제한

플레이어 확인 (2026-08-20): 드래그는 **한 번**만 가능하다(위키가 옳았다). 그 드래그의
경로 길이(스텝)는 제한시간 내 무제한. "횟수 무제한"이라는 초기 답변은 스텝을 가리킨 것.

**구현**: `movegen.js`는 (드래그 영웅 셀, 팀 배치) 상태 BFS. 같은 상태는 최단 경로로
한 번만 방문하므로 스텝 상한이 필요 없다 (`maxSteps` 기본 Infinity, `maxStates` 안전 상한만).
UI에서 드래그 횟수/스텝 설정을 제거했다. `maxDrags` 파라미터는 실험용으로만 남아 있다.
리더 버프 입력은 팀 패널로 이동 (던전 입장 시 결정되는 값이므로).

### 10.2 ✅ 해결 — 카드 우측 회색 뱃지 = **펫 스킬 수치**

플레이어 확인 (2026-08-20): 해당 영웅의 **펫 스킬** 값이다. 뱃지가 없는 영웅은 펫이 없거나 스킬 수치가 없는 경우.
관측값 (픽스처 보드): 얼음 엘프(E2) 8 · 흑발 소녀(B5) 25 · 콧수염(C6) 8 · 멧돼지(B2)/초록 오크(E5) 없음.

`Unit.petSkill` 필드로 스키마에 반영했다 (§4.2). 기존 계산기의 Pet Buff 입력(스탯의 15% 펫 보너스와 별개인
펫 스킬 배수)과의 관계는 데미지 검증 시 확인한다.

### 10.3 ✅ 해결 — 기존 hero DB 스키마 (확인 완료)

`heroes.json` (배열, 342명) 실제 키:

| 솔버 필드 | DB 키 | 예시 |
|---|---|---|
| `name` | `name` / `name_kr` | `"Adana"` / `"아다나"` |
| `heroClass` | `class` | `"Assassin"` (대문자 시작) |
| `color` | `color` | `"Green"` |
| `species` | `species` | `"Human"` |
| `traits` | `basic` + `ascension` (+ `merge`), 합본 `all` | `["Shroud", "Finishing Blow", ...]` |
| `atk` / `hp` | `stats.basic\|asc\|asc2\|asc3\|asc4` 의 `attack`/`health` | `{ total, breakdown: "Base + Gear + Pet" }` |
| — | `stars` | 성급 |

재능 메타데이터는 `web_traits.json`(116개: `id`, `name`, `desc`, `pct`, `category`)과
`trait_descriptions.json`(206개 설명)에 있다. `units.js` 어댑터에서 소문자 변환 등 매핑만 하면 된다.
**기존 DB는 고치지 않는다.** §4.3의 `condition` 필드는 `web_traits.json`의 `desc`를 파싱해 별도 파일로 생성한다.

### 10.4 🟢 보스 2×2 처리

아이스 킹처럼 2×2를 차지하는 보스가 있다. 웨이브 1에는 없지만 스키마에 `size` 필드를 미리 넣어뒀다.
점유 판정과 타겟 판정에서 4칸을 모두 고려해야 한다.

---

## 11. 완료 기준

- [ ] 픽스처(§9)를 입력하면 상위 5개 배치가 나온다
- [ ] 각 배치에 드래그 경로가 **순번과 함께** 그려진다
- [ ] 딜이 최소/기대/최대 3값으로 나온다
- [ ] 처치 확률이 표시된다
- [ ] 다음 턴 예상 피격량이 표시된다
- [ ] 탐색이 Web Worker에서 돌아 UI가 멈추지 않는다
- [ ] 모바일 세로 화면에서 보드가 잘리지 않는다
- [ ] 기존 3개 탭이 그대로 동작한다

---

## 12. 최종 목표 — 스크린샷 업로드 인식 (2026-08-20 추가)

사용자의 궁극적 요구: **전투 스크린샷을 웹페이지에 업로드하면** 보드를 자동 인식해
솔버를 돌리고, 최종 배치와 드래그 경로를 그려준다.

### 12.1 제약 조건 (사용자 확정)

- 팀은 **최대 6명**. 전체 342명 대상 검색이 아니라, **사용자가 팀 6명의 이름을 미리 입력**한다.
  → 초상 매칭은 항상 "36칸 × 후보 6명"의 소규모 문제.

### 12.2 파이프라인 (전부 클라이언트 사이드, Canvas API)

1. **보드 영역 탐지** — 6×6 그리드 위치 추정 (색 경계 탐지) + 수동 보정 핸들 (기기 해상도 다양성 대응)
2. **셀 분류** — 프레임 색으로 판별: 파란 프레임 = 아군, 빨간 프레임 = 적, 초록 수정 = 벽, 그 외 = 바닥
3. **아군 식별** — 셀 이미지 ↔ 입력된 6명의 `images/portraits/*.webp` 템플릿 매칭
   (다운스케일 후 정규화 상관 또는 색 히스토그램. 후보가 6개뿐이라 정확도 높음)
4. **적 자동 배치 (2026-08-20 구현)** — 몬스터 종류를 목록에 추가해두면 인식 시
   각 적 칸을 `images/monsters/`의 아이콘(위키에서 248개 다운로드,
   `crawl_monster_images.py`)과 대조해 종류까지 자동 배정한다.
   2종 이상은 아이콘 매칭, 1종은 전 칸 복제, 미추가 시 적N 플레이스홀더.
   픽스처 검증: 트롤/오거/샤먼 3종 → 4칸 전부 정확 배정.
5. **확인 단계** — 인식 결과를 편집 가능한 보드로 보여주고, 사용자가 확정하면 솔버 실행
6. **결과** — §8.2 경로 화살표 + 순번으로 최적 드래그 표시

### 12.3 검증된 근거

이 문서의 픽스처 영웅 5명(§9.3)이 바로 이 방식(스크린샷 크롭 ↔ 초상 템플릿 대조)으로
식별됐다. 후보를 좁힌 상태의 초상 매칭은 신뢰도가 높다.

### 12.4 구현 순서

인식 기능은 **입력 수단**이므로 솔버 코어(§7) 완성 후에 붙인다.
보드 수동 입력 UI를 먼저 만들면 인식 실패 시 폴백으로도 쓰인다.

### 12.5 구현 완료 (2026-08-20) — `src/board-solver/vision.js`

픽스처 스크린샷(1080×2340) 자동 검증 결과 **벽 12/12 · 아군 5/5(신원 포함) · 적 4/4 전항 일치**.

- 셀 분류 (2026-08-20 개정): **아군/적 판정의 1순위 신호는 HP바 색**이다 —
  아군 = 라임색(h 70~140) 바, 적 = 빨간 바. **프레임 색은 신뢰할 수 없다**:
  Black Castle 2-5H에서 적이 파란 프레임, 아군이 핑크/금색 프레임으로 나와
  프레임 기반 판정이 정반대로 뒤집혔다 (`reference/black-castle-2-5H.jpg`).
  판정 순서: 벽(링 초록, 수정 하이라이트가 라임 대역에 새므로 최우선) → HP바 색 →
  프레임 색(격자 미세 오정렬 폴백). 바닥 돌타일은 채도·명도가 낮아(v≈0.43) 걸러진다.
- 몬스터 종류 대조: 프레임이 시그니처를 지배하므로 위치 기반만으로는 부족 —
  **팔레트 히스토그램(12 hue 빈 + 밝은 무채색 + 어두움)**을 주 신호로, 위치 시그니처를
  보조로 결합. 무채색 빈이 같은 색조의 아트를 톤으로 가른다 (오거의 초록 얼굴 vs
  샤먼의 회색 늑대 가죽; 겨울 기사의 흰색 계열).
- **격자 자동 스냅 (2026-08-20)**: 인식 실행 시 격자를 **타일 사이의 어두운 틈**에
  맞춰 자동 미세보정한다 (내부 격자선의 밝기 최소화, ±0.35칸 탐색 후 정밀 패스).
  HP바 기반 스코어는 x축 봉우리가 넓어 수 픽셀 어긋난 지점에 수렴했고, 그 오차만으로
  종류 대조가 뒤집혔다. 격자선 스냅 도입 후 시작 위치를 ±1/3칸 흔들어도
  두 스테이지 모두 전항 일치. 사용자는 격자를 대충만 놓으면 된다.
- 아군 식별: 셀 중앙부(프레임·HP바 제외) 16×16 시그니처 ↔ 팀 초상 중앙 84% 시그니처의
  RGB 평균절대차, 탐욕적 1:1 배정.
- 격자 위치: 기본값은 1080×2340 기준(가로 94.5%, 상단 33.2%) + 수동 핸들(모서리 크기/내부 이동).
- **한계**: ① 잔해/물/용암 타일 미인식 (벽/바닥만) ② 적은 위치만 — 종류는 몬스터 DB 검색으로
  사용자 지정 ③ 다른 해상도 기기는 격자 수동 보정 필요.

---

## 13. 멀티턴 클리어 플래너 (2026-08-20 구현) — `planner.js`

목적함수를 "이번 턴 딜"에서 **"클리어"**로 확장한 빔 서치.
한 턴 = 드래그 + 아군 공격 → 몬스터 이동·공격. 이를 최대 N턴 연쇄한다.

- 정렬: ① 최소 턴 클리어 ② 동률이면 아군 잔여 HP 최대 ③ 총 스텝 최소
- 턴마다: 후보 드래그 나열(1턴 솔버와 동일) → 상위 M개만 유지(후보 컷) →
  각각 몬스터 턴 시뮬 → (배치+HP) 해시로 dedup → 빔 폭 K개만 다음 턴으로
- 기본값: 빔 24 · 후보 10 · 첫 턴 4만/이후 턴 5천 상태 · 예산 30초
- 검증: 픽스처 몬스터 HP 150배(총 ~51k, 1턴 딜 ~18k) → **3턴 클리어 플랜**을
  ~2초에 발견. 마지막 턴은 "이동 없이 제자리 공격"까지 스스로 선택한다.
- UI: "멀티턴 클리어 플랜" 버튼 + 최대 턴 선택. 턴 카드 클릭 시 해당 턴의
  시작 배치(몬스터 이동 반영) + 드래그 경로, 아래에 "턴 종료 후" 보드.
- 한계: 웨이브 스폰 미모델(현재 웨이브 내 계획), 기대 데미지 기반 결정론 근사,
  몬스터 AI는 Charge만. 난수·동률 랜덤의 시드 반복은 후속 과제.

- Friends and Dragons Wiki — Combat Basics
  `https://friends-and-dragons.fandom.com/wiki/Combat_Basics`
- 기존 계산기
  `https://heohoeny-glitch.github.io/damage-calculator/`

## 부록 B. 함께 있는 파일

| 파일 | 용도 |
|---|---|
| `심연의동굴-1-3-보드맵.html` | 렌더러 베이스. 위협 범위 BFS 구현 포함 |
| `friends-and-dragons-분석.md` | 프레임 분석 원본, UI 해독 결과 |
