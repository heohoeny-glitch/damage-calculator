// Board Solver tab UI: board editor, team/monster setup, solve, results.

import { makeBoard, parsePos, toPos, TILE } from './board.js';
import { makeUnit, adaptHero, estimateMonsterStat } from './units.js';
import { solve } from './solver.js';
import { drawBoard, drawPaths } from './render.js';
import { buildFixture } from './fixtures/abyss-cave-1-3-w1.js';
import { defaultRect, classifyCells, matchHeroes, matchCells, cellRect, refineRect } from './vision.js';

const $ = id => document.getElementById(id);

const TIER_LABELS = { basic: 'Basic', asc: 'Asc 1', asc2: 'Asc 2', asc3: 'Asc 3', asc4: 'Asc 4' };
const TERRAIN_LABELS = { ground: '바닥', wall: '벽', rubble: '잔해', water: '물', lava: '용암' };

const GRADES = ['일반', '엘리트', '선봉장'];
const GRADE_PREFIX = { '일반': '', '엘리트': '엘·', '선봉장': '선·' };

const state = {
  tiles: Array.from({ length: 6 }, () => Array(6).fill(TILE.GROUND)),
  team: [],      // {id:'H1', db, tier, pos|null}
  monsters: [],  // {id:'M1', name, grade, classes[], traits[], atk, hp, moveRange, kind, dirs, pos|null}
  brush: null,   // {type:'terrain', tile}|{type:'place', unitId}|{type:'erase'}
  heroData: [],
  monsterData: [],
  pendingMonsterDb: null, // monsters.json entry selected in the search box
  results: null,
  selected: -1,
  monsterSeq: 0,
};

function board() {
  return makeBoard(state.tiles.map(row => [...row]));
}

const rows = () => state.tiles.length;
const cols = () => state.tiles[0].length;

// Dungeons come in different grid sizes: rebuild the tile array preserving
// the overlapping region; units that fall outside are unplaced.
function resizeBoard(nr, nc) {
  const old = state.tiles;
  state.tiles = Array.from({ length: nr }, (_, r) =>
    Array.from({ length: nc }, (_, c) => old[r]?.[c] ?? TILE.GROUND));
  for (const u of [...state.team, ...state.monsters]) {
    if (!u.pos) continue;
    const { r, c } = parsePos(u.pos);
    if (r >= nr || c >= nc) u.pos = null;
  }
  if (shot.img) {
    shot.rect.h = shot.rect.w * (nr / nc); // cells are square in-game
    drawShot();
  }
  clearResults();
  redraw();
}

function syncSizeInputs() {
  $('bsCols').value = cols();
  $('bsRows').value = rows();
}

function placedUnits() {
  const units = [];
  for (const t of state.team) {
    if (!t.pos) continue;
    const overrides = {};
    if (t.atk != null) overrides.atk = t.atk;
    if (t.hp != null) overrides.hp = t.hp;
    units.push(adaptHero(t.db, { id: t.id, pos: t.pos, tier: t.tier, overrides }));
  }
  for (const m of state.monsters) {
    if (!m.pos) continue;
    units.push(makeUnit({
      id: m.id, side: 'monster',
      name: `${GRADE_PREFIX[m.grade] ?? ''}${m.name}`,
      pos: m.pos, color: m.color,
      atk: m.atk, hp: m.hp, def: m.def ?? 0, moveRange: m.moveRange, ai: 'charge',
      monsterClasses: [...m.classes],
      attack: { kind: m.kind, dirs: m.dirs },
      traits: [...m.traits],
    }));
  }
  return units;
}

function unitEntryAt(pos) {
  const all = [...state.team, ...state.monsters];
  return all.find(u => u.pos === pos) ?? null;
}

// ---- board editing ----

function onCellClick(r, c) {
  const pos = `${String.fromCharCode(65 + c)}${r + 1}`;
  const b = state.brush;
  if (!b) return;
  if (b.type === 'terrain') {
    const existing = unitEntryAt(pos);
    // units can stand on water/lava, but not in walls or rubble
    if (existing && (b.tile === TILE.WALL || b.tile === TILE.RUBBLE)) existing.pos = null;
    state.tiles[r][c] = b.tile;
  } else if (b.type === 'erase') {
    const existing = unitEntryAt(pos);
    if (existing) existing.pos = null;
    else state.tiles[r][c] = TILE.GROUND;
  } else if (b.type === 'place') {
    if (state.tiles[r][c] === TILE.WALL || state.tiles[r][c] === TILE.RUBBLE) return;
    const target = [...state.team, ...state.monsters].find(u => u.id === b.unitId);
    if (!target) return;
    const existing = unitEntryAt(pos);
    if (existing && existing !== target) existing.pos = null;
    target.pos = pos;
    state.brush = null; // one placement per click on "배치"
  }
  clearResults();
  redraw();
}

function redraw() {
  const svg = $('bsBoard');
  drawBoard(svg, board(), safePlacedUnits(), { onCellClick });
  if (state.results && state.selected >= 0) {
    drawPaths(svg, state.results.top[state.selected].drags);
  }
  renderAfterBoard();
  renderTeamList();
  renderMonsterList();
  renderPalette();
  renderResults();
}

// Second grid below the path: the placement AFTER the drag finishes,
// with expected kills dimmed and crossed out.
function renderAfterBoard() {
  const wrap = $('bsAfterWrap');
  if (!(state.results && state.selected >= 0)) {
    wrap.style.display = 'none';
    return;
  }
  const r = state.results.top[state.selected];
  const units = safePlacedUnits();
  for (const [id, pos] of Object.entries(r.positions)) {
    const u = units.find(x => x.id === id);
    if (u) {
      const p = parsePos(pos);
      u.r = p.r;
      u.c = p.c;
    }
  }
  const svg = $('bsBoardAfter');
  drawBoard(svg, board(), units);
  const killed = new Set(r.targets.filter(t => t.expectedKill).map(t => t.id));
  const SVG_NS = 'http://www.w3.org/2000/svg';
  for (const g of svg.querySelectorAll('.bs-unit')) {
    if (!killed.has(g.dataset.id)) continue;
    g.style.opacity = 0.35;
    const rect = g.querySelector('rect');
    const x = Number(rect.getAttribute('x')) + Number(rect.getAttribute('width')) / 2;
    const y = Number(rect.getAttribute('y')) + Number(rect.getAttribute('height')) / 2;
    const cross = document.createElementNS(SVG_NS, 'text');
    cross.setAttribute('x', x);
    cross.setAttribute('y', y + 8);
    cross.setAttribute('class', 'bs-kill-x');
    cross.textContent = '✕';
    svg.appendChild(cross);
  }
  $('bsAfterLabel').textContent = `(#${state.selected + 1} 적용, ✕ = 예상 처치)`;
  wrap.style.display = 'block';
}

function safePlacedUnits() {
  try { return placedUnits(); }
  catch (err) { setStatus(`유닛 오류: ${err.message}`); return []; }
}

// ---- palette ----

function renderPalette() {
  const wrap = $('bsPalette');
  wrap.innerHTML = '';
  for (const tile of Object.values(TILE)) {
    wrap.appendChild(paletteBtn(
      TERRAIN_LABELS[tile], `bs-swatch-${tile}`,
      state.brush?.type === 'terrain' && state.brush.tile === tile,
      () => { state.brush = { type: 'terrain', tile }; renderPalette(); },
    ));
  }
  wrap.appendChild(paletteBtn('지우개', '', state.brush?.type === 'erase',
    () => { state.brush = { type: 'erase' }; renderPalette(); }));
}

function paletteBtn(label, swatchClass, active, onClick) {
  const btn = document.createElement('button');
  btn.className = `bs-palette-btn${active ? ' active' : ''}`;
  if (swatchClass) {
    const sw = document.createElement('span');
    sw.className = `bs-swatch ${swatchClass}`;
    btn.appendChild(sw);
  }
  btn.appendChild(document.createTextNode(label));
  btn.addEventListener('click', onClick);
  return btn;
}

// ---- team setup ----

function tiersOf(db) {
  return Object.entries(db.stats ?? {})
    .filter(([, v]) => v && v.attack)
    .map(([k]) => k);
}

function addHero(db) {
  if (state.team.length >= 6) { setStatus('팀은 최대 6명입니다.'); return; }
  // 같은 영웅을 중복으로 데려갈 수 있다
  const tiers = tiersOf(db);
  state.team.push({
    id: `H${state.team.length + 1}`,
    db,
    tier: tiers[tiers.length - 1] ?? 'basic',
    atk: null, // null = use the tier's DB stat
    hp: null,
    pos: null,
  });
  clearResults();
  redraw();
}

function tierStats(t) {
  const s = t.db.stats?.[t.tier];
  return {
    atk: s?.attack?.total ?? s?.attack ?? 0,
    hp: s?.health?.total ?? s?.health ?? 0,
  };
}

function renderTeamList() {
  const wrap = $('bsTeamList');
  wrap.innerHTML = '';
  state.team.forEach((t, i) => {
    const row = document.createElement('div');
    row.className = 'bs-unit-row';

    const img = document.createElement('img');
    img.src = `images/portraits/${t.db.name} Portrait.webp`;
    img.onerror = () => { img.style.display = 'none'; };
    row.appendChild(img);

    const name = document.createElement('span');
    name.className = 'bs-unit-label';
    name.textContent = `${t.id} ${t.db.name_kr ?? t.db.name}`;
    row.appendChild(name);

    const tierSel = document.createElement('select');
    for (const tier of tiersOf(t.db)) {
      const opt = document.createElement('option');
      opt.value = tier;
      opt.textContent = TIER_LABELS[tier] ?? tier;
      if (tier === t.tier) opt.selected = true;
      tierSel.appendChild(opt);
    }
    tierSel.addEventListener('change', () => {
      t.tier = tierSel.value;
      t.atk = null; // tier change resets manual stats to the new tier's values
      t.hp = null;
      clearResults();
      redraw();
    });
    row.appendChild(tierSel);

    // editable ATK/HP (default: the selected tier's DB stats)
    const defaults = tierStats(t);
    for (const key of ['atk', 'hp']) {
      const input = document.createElement('input');
      input.type = 'number';
      input.min = '1';
      input.className = 'bs-stat-input';
      input.title = key === 'atk' ? '공격력' : '체력';
      input.value = t[key] ?? defaults[key];
      input.addEventListener('change', () => {
        const v = Number(input.value);
        t[key] = v > 0 ? v : null;
        if (t[key] == null) input.value = tierStats(t)[key];
        clearResults();
        redraw();
      });
      row.appendChild(input);
    }

    const place = document.createElement('button');
    place.className = 'bs-mini-btn' + (state.brush?.type === 'place' && state.brush.unitId === t.id ? ' active' : '');
    place.textContent = t.pos ? t.pos : '배치';
    place.addEventListener('click', () => { state.brush = { type: 'place', unitId: t.id }; redraw(); });
    row.appendChild(place);

    const del = document.createElement('button');
    del.className = 'bs-mini-btn bs-danger';
    del.textContent = '✕';
    del.addEventListener('click', () => {
      state.team.splice(i, 1);
      state.team.forEach((h, j) => { h.id = `H${j + 1}`; });
      clearResults();
      redraw();
    });
    row.appendChild(del);

    wrap.appendChild(row);
  });
}

function initHeroSearch() {
  const input = $('bsHeroSearch');
  const dropdown = $('bsHeroDropdown');
  input.addEventListener('input', () => {
    const q = input.value.trim().toLowerCase();
    dropdown.innerHTML = '';
    if (!q) { dropdown.style.display = 'none'; return; }
    const hits = state.heroData.filter(h =>
      h.name.toLowerCase().includes(q) || (h.name_kr && h.name_kr.includes(q)),
    ).slice(0, 8);
    for (const h of hits) {
      const item = document.createElement('div');
      item.className = 'bs-dropdown-item';
      item.textContent = `${h.name}${h.name_kr ? ` (${h.name_kr})` : ''} — ${h.class} ${h.color}`;
      item.addEventListener('click', () => {
        addHero(h);
        input.value = '';
        dropdown.style.display = 'none';
      });
      dropdown.appendChild(item);
    }
    dropdown.style.display = hits.length ? 'block' : 'none';
  });
}

// ---- monster setup ----

function addMonster() {
  state.monsterSeq++;
  // Dropdown selection wins; otherwise resolve the typed name against the
  // DB so a hand-typed "오크 메이지" still gets its icon/talents linked.
  let db = state.pendingMonsterDb;
  if (!db) {
    const typed = $('bsMonName').value.trim().toLowerCase();
    db = state.monsterData.find(m =>
      m.name_kr?.toLowerCase() === typed || m.name.toLowerCase() === typed) ?? null;
  }
  state.monsters.push({
    id: `M${state.monsterSeq}`,
    name: $('bsMonName').value.trim() || `몬스터${state.monsterSeq}`,
    dbName: db?.name ?? null,
    grade: $('bsMonGrade').value,
    color: $('bsMonColor').value,
    atk: Number($('bsMonAtk').value) || 10,
    hp: Number($('bsMonHp').value) || 100,
    // DEF is not part of the damage formula (spec 3); in-game it mirrors HP
    def: Number($('bsMonHp').value) || 100,
    moveRange: Number($('bsMonMove').value) || 2,
    kind: $('bsMonKind').value,
    dirs: $('bsMonDirs').value,
    // DB monster: classes + talents from monsters.json.
    // Manual monster: goblinoid checkbox + N generic attack talents.
    classes: db ? [...db.classes] : ($('bsMonGob').checked ? ['goblinoid'] : []),
    traits: db ? [...db.traits]
      : Array.from({ length: Number($('bsMonAtkTraits').value) || 0 }, () => 'Attack'),
    pos: null,
  });
  const m = state.monsters[state.monsters.length - 1];
  state.pendingMonsterDb = null;
  state.brush = { type: 'place', unitId: m.id };
  clearResults();
  redraw();
}

function initMonsterSearch() {
  const input = $('bsMonSearch');
  const dropdown = $('bsMonDropdown');
  input.addEventListener('input', () => {
    const q = input.value.trim().toLowerCase();
    state.pendingMonsterDb = null;
    dropdown.innerHTML = '';
    if (!q) { dropdown.style.display = 'none'; return; }
    const hits = state.monsterData.filter(m =>
      m.name.toLowerCase().includes(q) || (m.name_kr && m.name_kr.includes(q)),
    ).slice(0, 8);
    for (const m of hits) {
      const item = document.createElement('div');
      item.className = 'bs-dropdown-item';
      const cls = m.classes.length ? ` · ${m.classes.join(',')}` : '';
      const traits = m.traits.length ? ` · ${m.traits.join(', ')}` : '';
      // auto-generated Korean names are guesses — mark with ?
      const kr = m.name_kr ? ` (${m.name_kr}${m.name_kr_auto ? '?' : ''})` : '';
      item.textContent = `${m.name}${kr}${cls}${traits}`;
      item.addEventListener('click', () => {
        state.pendingMonsterDb = m;
        $('bsMonName').value = m.name_kr ?? m.name;
        if (m.moveRange != null) $('bsMonMove').value = m.moveRange;
        if (m.attackKind) $('bsMonKind').value = m.attackKind;
        if (m.attackDirs) $('bsMonDirs').value = m.attackDirs;
        $('bsMonGob').checked = m.classes.includes('goblinoid');
        input.value = m.name_kr ? `${m.name} (${m.name_kr})` : m.name;
        dropdown.style.display = 'none';
        applyMonsterLevel();
      });
      dropdown.appendChild(item);
    }
    dropdown.style.display = hits.length ? 'block' : 'none';
  });
  $('bsMonLevel').addEventListener('change', applyMonsterLevel);
}

// Fill ATK/HP from the DB monster + entered level (linear level curve,
// see estimateMonsterStat). No level -> the wiki's reference stats.
function applyMonsterLevel() {
  const m = state.pendingMonsterDb;
  if (!m || !m.refAtk) return;
  const level = Number($('bsMonLevel').value);
  if (level >= 1) {
    $('bsMonAtk').value = estimateMonsterStat(m.refAtk, level, m.refLevel);
    $('bsMonHp').value = estimateMonsterStat(m.refHp, level, m.refLevel);
    setStatus(`${m.name} Lv.${level} 추정 스탯 적용 (실측 기반 선형 공식, ±1 오차) · 재능 [${m.traits.join(', ') || '없음'}]`);
  } else {
    $('bsMonAtk').value = m.refAtk;
    $('bsMonHp').value = m.refHp;
    setStatus(`${m.name}: 재능 [${m.traits.join(', ') || '없음'}] · 레벨을 입력하면 스탯을 자동 추정합니다 (기준 Lv.${m.refLevel})`);
  }
}

function renderMonsterList() {
  const wrap = $('bsMonsterList');
  wrap.innerHTML = '';
  state.monsters.forEach((m, i) => {
    const row = document.createElement('div');
    row.className = 'bs-unit-row bs-monster-row';

    const name = document.createElement('span');
    name.className = 'bs-unit-label';
    const gradeTag = m.grade && m.grade !== '일반' ? `[${m.grade}] ` : '';
    name.textContent = `${gradeTag}${m.name} · ${m.atk}/${m.hp} · 이동${m.moveRange}` +
      (m.classes.length ? ` · ${m.classes.join(',')}` : '');
    if (m.traits.length) name.title = `재능: ${m.traits.join(', ')}`;
    row.appendChild(name);

    const place = document.createElement('button');
    place.className = 'bs-mini-btn' + (state.brush?.type === 'place' && state.brush.unitId === m.id ? ' active' : '');
    place.textContent = m.pos ? m.pos : '배치';
    place.addEventListener('click', () => { state.brush = { type: 'place', unitId: m.id }; redraw(); });
    row.appendChild(place);

    const del = document.createElement('button');
    del.className = 'bs-mini-btn bs-danger';
    del.textContent = '✕';
    del.addEventListener('click', () => { state.monsters.splice(i, 1); clearResults(); redraw(); });
    row.appendChild(del);

    wrap.appendChild(row);
  });
}

// ---- fixture ----

function loadFixture() {
  const { board: fb, units } = buildFixture(state.heroData);
  state.tiles = fb.tiles.map(row => [...row]);
  state.team = [];
  state.monsters = [];
  state.monsterSeq = 0;
  for (const u of units) {
    const pos = `${String.fromCharCode(65 + u.c)}${u.r + 1}`;
    if (u.side === 'hero') {
      const db = state.heroData.find(h => h.name === u.name);
      state.team.push({ id: u.id, db, tier: tierOfStats(db, u), pos });
    } else {
      state.monsterSeq++;
      state.monsters.push({
        id: u.id, name: u.name, grade: '일반', color: u.color,
        dbName: state.monsterData.find(md => md.name_kr === u.name)?.name ?? null,
        atk: u.atk, hp: u.hpMax, def: u.def,
        moveRange: u.moveRange, kind: u.attack.kind, dirs: u.attack.dirs,
        classes: [...u.monsterClasses], traits: [...u.traits],
        pos,
      });
    }
  }
  syncSizeInputs();
  clearResults();
  redraw();
  setStatus('픽스처 로드 완료: 심연의 동굴 1-3 웨이브 1');
}

function tierOfStats(db, unit) {
  for (const [tier, s] of Object.entries(db.stats ?? {})) {
    if (s && s.attack && (s.attack.total ?? s.attack) === unit.atk) return tier;
  }
  return 'basic';
}

// ---- solve ----

let worker = null;

function runSolve() {
  const units = safePlacedUnits();
  const heroes = units.filter(u => u.side === 'hero');
  const monsters = units.filter(u => u.side === 'monster');
  if (heroes.length === 0 || monsters.length === 0) {
    setStatus('영웅과 몬스터를 최소 1기씩 배치하세요.');
    return;
  }
  const opts = {
    maxDrags: 1,         // game rule: one drag per turn
    maxSteps: Infinity,  // path length unlimited (BFS state dedup bounds it)
    maxStates: 60000,
    topN: 5,
    leader: Number($('bsLeader').value) || 1,
    timeBudgetMs: 15000,
  };
  clearResults();
  setStatus('탐색 중…');
  $('bsSolveBtn').disabled = true;

  const payload = { board: board(), units, opts };
  const done = result => {
    $('bsSolveBtn').disabled = false;
    state.results = result;
    state.selected = result.top.length ? 0 : -1;
    const s = result.stats;
    setStatus(`배치 ${s.statesEvaluated.toLocaleString()}개 평가 · ${s.elapsedMs}ms` +
      `${s.truncated ? ' · 탐색 상한 도달' : ''}${s.timedOut ? ' · 시간 초과로 중단' : ''}`);
    redraw();
  };
  const fail = err => {
    $('bsSolveBtn').disabled = false;
    setStatus(`오류: ${err}`);
  };

  try {
    if (!worker) {
      worker = new Worker(new URL('./solver.worker.js', import.meta.url), { type: 'module' });
    }
    worker.onmessage = e => (e.data.ok ? done(e.data.result) : fail(e.data.error));
    worker.onerror = e => { worker = null; fail(e.message ?? 'worker error'); };
    worker.postMessage(payload);
  } catch {
    // no worker support: run on the main thread
    try { done(solve(payload.board, payload.units, payload.opts)); }
    catch (err) { fail(err.message); }
  }
}

function clearResults() {
  state.results = null;
  state.selected = -1;
}

// ---- results ----

function unitLabel(id) {
  const t = state.team.find(x => x.id === id);
  if (t) return `${id} ${t.db.name_kr ?? t.db.name}`;
  const m = state.monsters.find(x => x.id === id);
  return m ? m.name : id;
}

function renderResults() {
  const wrap = $('bsResults');
  wrap.innerHTML = '';
  if (!state.results) return;
  if (!state.results.top.length) {
    wrap.textContent = '결과 없음';
    return;
  }
  state.results.top.forEach((r, i) => {
    const card = document.createElement('div');
    card.className = `bs-result-card${i === state.selected ? ' selected' : ''}`;

    const title = document.createElement('div');
    title.className = 'bs-result-title';
    title.textContent = `#${i + 1} · ${r.score.fullClear ? '전멸' : `처치 ${r.score.kills}`} · 딜 ${Math.round(r.score.totalExpected).toLocaleString()} · 피격 ${Math.round(r.score.incoming)} · ${r.score.steps}스텝`;
    card.appendChild(title);

    const dmg = document.createElement('div');
    dmg.className = 'bs-result-line';
    dmg.textContent = `딜 범위 ${Math.round(r.score.totalMin).toLocaleString()} ~ ${Math.round(r.score.totalMax).toLocaleString()}`;
    card.appendChild(dmg);

    const kills = r.targets.filter(t => t.expectedKill);
    if (kills.length) {
      const line = document.createElement('div');
      line.className = 'bs-result-line';
      line.textContent = '처치: ' + kills.map(t => `${t.name} (${Math.round(t.killProb * 100)}%)`).join(', ');
      card.appendChild(line);
    }
    for (const d of r.drags) {
      const line = document.createElement('div');
      line.className = 'bs-result-line bs-drag-line';
      line.textContent = `드래그 ${unitLabel(d.heroId)}: ${d.path.join(' → ')}`;
      card.appendChild(line);
    }
    if (!r.drags.length) {
      const line = document.createElement('div');
      line.className = 'bs-result-line';
      line.textContent = '이동 없음 (현재 배치 그대로)';
      card.appendChild(line);
    }
    if (r.unmodeled.length) {
      const line = document.createElement('div');
      line.className = 'bs-result-line bs-warn';
      line.textContent = '미반영 재능: ' + r.unmodeled.join(', ');
      card.appendChild(line);
    }

    card.addEventListener('click', () => {
      state.selected = i;
      redraw();
    });
    wrap.appendChild(card);
  });

  const replay = document.createElement('button');
  replay.className = 'bs-mini-btn';
  replay.textContent = '▶ 경로 재생';
  replay.addEventListener('click', () => {
    if (state.selected >= 0) {
      drawPaths($('bsBoard'), state.results.top[state.selected].drags, { animate: true });
    }
  });
  wrap.appendChild(replay);
}

function setStatus(msg) {
  $('bsStatus').textContent = msg;
}

// ---- screenshot recognition (spec 12) ----

const shot = { img: null, rect: null, drag: null, cells: null };

async function loadShot(file) {
  if (!file) return;
  const img = new Image();
  img.src = URL.createObjectURL(file);
  await img.decode();
  shot.img = img;
  shot.cells = null;
  shot.rect = defaultRect(img.width, img.height, cols(), rows());
  $('bsShotWrap').style.display = 'block';
  $('bsRecognizeBtn').disabled = false;
  drawShot();
  setStatus('노란 격자를 보드 36칸에 맞춘 뒤 "인식 실행"을 누르세요.');
}

function drawShot() {
  const canvas = $('bsShotCanvas');
  canvas.width = shot.img.width;
  canvas.height = shot.img.height;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(shot.img, 0, 0);

  const r = shot.rect;
  const lw = Math.max(2, shot.img.width / 400);
  ctx.strokeStyle = 'rgba(255,209,102,0.95)';
  ctx.lineWidth = lw;
  for (let i = 0; i <= cols(); i++) {
    const x = r.x + (r.w / cols()) * i;
    ctx.beginPath(); ctx.moveTo(x, r.y); ctx.lineTo(x, r.y + r.h); ctx.stroke();
  }
  for (let i = 0; i <= rows(); i++) {
    const y = r.y + (r.h / rows()) * i;
    ctx.beginPath(); ctx.moveTo(r.x, y); ctx.lineTo(r.x + r.w, y); ctx.stroke();
  }
  // last recognition result as translucent tints — misalignment shows instantly
  if (shot.cells) {
    const tint = {
      hero: 'rgba(77,148,255,0.38)',
      monster: 'rgba(226,80,63,0.38)',
      wall: 'rgba(31,199,124,0.30)',
    };
    shot.cells.forEach((row, cr) => row.forEach((cell, cc) => {
      if (!tint[cell.type]) return;
      const box = cellRect(r, cr, cc, cols(), rows());
      ctx.fillStyle = tint[cell.type];
      ctx.fillRect(box.x, box.y, box.w, box.h);
    }));
  }

  ctx.fillStyle = '#ffd166';
  for (const [hx, hy] of [[r.x, r.y], [r.x + r.w, r.y + r.h]]) {
    ctx.beginPath();
    ctx.arc(hx, hy, lw * 5, 0, Math.PI * 2);
    ctx.fill();
  }
}

function shotCanvasPoint(e) {
  const canvas = $('bsShotCanvas');
  const b = canvas.getBoundingClientRect();
  return {
    x: (e.clientX - b.left) * (canvas.width / b.width),
    y: (e.clientY - b.top) * (canvas.height / b.height),
  };
}

function shotPointerDown(e) {
  if (!shot.img) return;
  const p = shotCanvasPoint(e);
  const r = shot.rect;
  const grab = shot.img.width * 0.05;
  const near = (x, y) => Math.hypot(p.x - x, p.y - y) < grab;
  if (near(r.x, r.y)) shot.drag = { mode: 'tl' };
  else if (near(r.x + r.w, r.y + r.h)) shot.drag = { mode: 'br' };
  else if (p.x > r.x && p.x < r.x + r.w && p.y > r.y && p.y < r.y + r.h) {
    shot.drag = { mode: 'move', dx: p.x - r.x, dy: p.y - r.y };
  } else return;
  shot.cells = null; // grid moved: old tints no longer line up
  e.preventDefault();
  $('bsShotCanvas').setPointerCapture(e.pointerId);
}

function shotPointerMove(e) {
  if (!shot.drag) return;
  const p = shotCanvasPoint(e);
  const r = shot.rect;
  const min = shot.img.width * 0.2;
  if (shot.drag.mode === 'tl') {
    const nx = Math.min(p.x, r.x + r.w - min);
    const ny = Math.min(p.y, r.y + r.h - min);
    r.w += r.x - nx; r.h += r.y - ny; r.x = nx; r.y = ny;
  } else if (shot.drag.mode === 'br') {
    r.w = Math.max(min, p.x - r.x);
    r.h = Math.max(min, p.y - r.y);
  } else {
    r.x = p.x - shot.drag.dx;
    r.y = p.y - shot.drag.dy;
  }
  drawShot();
}

async function loadImage(src) {
  if (!src) return null;
  try {
    const img = new Image();
    img.src = src;
    await img.decode();
    return img;
  } catch {
    return null;
  }
}

const loadPortraitImage = name => loadImage(`images/portraits/${name} Portrait.webp`);

// icon file for a monster list entry (downloaded by crawl_monster_images.py)
function monsterIconOf(entry) {
  const db = state.monsterData.find(m => m.name === entry.dbName);
  return db?.image ? `images/monsters/${db.image}` : null;
}

// Detected monster cells -> instances of the monsters the user has added.
// With icons available, each cell is matched to the closest added type;
// otherwise types are dealt out in reading order.
async function placeMonsters(ctx, monsterCells) {
  // no enemy cells detected: keep the user's list (just unplaced) — do not
  // wipe carefully entered types because the grid was misaligned
  if (monsterCells.length === 0) {
    state.monsters.forEach(m => { m.pos = null; });
    return { matchedByImage: false, templateCount: state.monsters.length };
  }
  // templates: one per distinct added type, first entry wins
  const templates = [];
  for (const m of state.monsters) {
    if (!templates.some(t => (t.dbName ?? t.name) === (m.dbName ?? m.name))) templates.push(m);
  }
  const instances = [];
  let seq = 0;
  const instantiate = (tpl, pos) => {
    seq++;
    instances.push(tpl
      ? { ...tpl, classes: [...tpl.classes], traits: [...tpl.traits], id: `M${seq}`, pos }
      : {
        id: `M${seq}`, name: `적${seq}`, grade: '일반', color: 'red',
        atk: 10, hp: 100, def: 100, moveRange: 2,
        kind: 'melee', dirs: 'cross', classes: [], traits: [], pos,
      });
  };

  let matchedByImage = false;
  let noIcon = [];
  if (templates.length >= 2) {
    const loaded = await Promise.all(templates.map(async t =>
      ({ id: t.id, tpl: t, img: await loadImage(monsterIconOf(t)) }),
    ));
    const withImg = loaded.filter(t => t.img);
    noIcon = loaded.filter(t => !t.img).map(t => t.tpl.name);
    if (withImg.length === templates.length) {
      const assigns = matchCells(ctx, shot.rect,
        monsterCells, withImg, cols(), rows());
      for (const a of assigns) {
        instantiate(withImg.find(t => t.id === a.templateId).tpl, toPos(a.r, a.c));
      }
      matchedByImage = true;
    }
  }
  if (!matchedByImage) {
    monsterCells.forEach(({ r, c }, i) => {
      instantiate(templates.length ? templates[i % templates.length] : null, toPos(r, c));
    });
  }
  state.monsters = instances;
  state.monsterSeq = seq;
  return { matchedByImage, templateCount: templates.length, noIcon };
}

async function recognizeShot() {
  try {
    await recognizeShotInner();
  } catch (err) {
    console.error(err);
    setStatus(`인식 오류: ${err.message ?? err} — 이 메시지를 캡처해 알려주세요.`);
  }
}

async function recognizeShotInner() {
  if (!shot.img) return;
  const canvas = $('bsShotCanvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(shot.img, 0, 0); // pixels only, no grid overlay

  // snap the grid onto the board before reading cells
  shot.rect = refineRect(ctx, shot.rect, cols(), rows());

  const cells = classifyCells(ctx, shot.rect, cols(), rows());

  // terrain (walls vs ground only — rubble/water/lava not recognized yet)
  state.tiles = cells.map(row =>
    row.map(cell => (cell.type === 'wall' ? TILE.WALL : TILE.GROUND)));

  state.team.forEach(t => { t.pos = null; });

  const heroCells = [];
  const monsterCells = [];
  cells.forEach((row, r) => row.forEach((cell, c) => {
    if (cell.type === 'monster') monsterCells.push({ r, c });
    else if (cell.type === 'hero') heroCells.push({ r, c });
  }));

  // monsters: instances of the user's added types (image-matched when
  // possible), or 적N placeholders when none were added
  const monsterResult = await placeMonsters(ctx, monsterCells);

  // hero identity: match against the entered team's portraits
  const assigned = [];
  if (heroCells.length && state.team.length) {
    const candidates = (await Promise.all(state.team.map(async t =>
      ({ id: t.id, img: await loadPortraitImage(t.db.name) }),
    ))).filter(c => c.img);
    for (const a of matchHeroes(ctx, shot.rect, heroCells, candidates, cols(), rows())) {
      const t = state.team.find(x => x.id === a.candidateId);
      t.pos = toPos(a.r, a.c);
      assigned.push(`${t.id} ${t.db.name_kr ?? t.db.name}→${t.pos}`);
    }
  }

  shot.cells = cells;
  drawShot(); // grid + classification tints
  clearResults();
  redraw();

  const wallCount = state.tiles.flat().filter(t => t === TILE.WALL).length;
  let msg = `인식 완료: 벽 ${wallCount} · 아군 ${heroCells.length}(매칭 ${assigned.length}) · 적 ${state.monsters.length}. `;
  if (assigned.length) msg += `배정: ${assigned.join(', ')}. `;
  if (heroCells.length === 0) msg += '아군 칸이 하나도 감지되지 않았습니다 — 이미지의 색 표시를 보고 노란 격자를 보드에 정확히 맞춘 뒤 다시 실행하세요. ';
  else if (heroCells.length > assigned.length) msg += `아군 ${heroCells.length - assigned.length}칸 미배정 — 팀에 영웅을 더 추가하고 다시 실행하세요. `;
  if (monsterCells.length) {
    if (monsterResult.templateCount === 0) msg += '적은 자리만 인식 — 몬스터 검색으로 종류를 추가한 뒤 다시 실행하면 자동 배치됩니다.';
    else if (monsterResult.matchedByImage) msg += '적 종류는 아이콘 대조로 자동 배정 — 목록에서 확인하세요.';
    else if (monsterResult.templateCount === 1) msg += '추가된 몬스터 1종을 모든 적 칸에 배치했습니다.';
    else msg += `적 종류를 순서대로 배치했습니다 (아이콘 없는 종류: ${monsterResult.noIcon.join(', ') || '?'}) — 목록에서 위치를 확인·수정하세요.`;
  } else {
    msg += '적 칸이 감지되지 않아 몬스터 목록은 그대로 두었습니다 — 격자 정렬을 확인하세요.';
  }
  setStatus(msg);
}

function initShotPanel() {
  $('bsShotFile').addEventListener('change', e => loadShot(e.target.files[0]));
  const canvas = $('bsShotCanvas');
  canvas.addEventListener('pointerdown', shotPointerDown);
  canvas.addEventListener('pointermove', shotPointerMove);
  canvas.addEventListener('pointerup', () => { shot.drag = null; });
  canvas.addEventListener('pointercancel', () => { shot.drag = null; });
  $('bsRecognizeBtn').addEventListener('click', recognizeShot);
}

// ---- init ----

async function init() {
  // Dev flag: the tab is hidden while the solver is under development.
  // Open the site with ?solver to show it (e.g. http://localhost:8000/?solver).
  if (new URLSearchParams(location.search).has('solver')) {
    $('bsTabBtn').style.display = '';
  }
  const [heroResp, monResp] = await Promise.all([
    fetch('heroes.json'),
    fetch('monsters.json'),
  ]);
  state.heroData = await heroResp.json();
  state.monsterData = monResp.ok ? await monResp.json() : [];
  initHeroSearch();
  initMonsterSearch();
  initShotPanel();
  window.__bsState = state; // test hooks
  window.__bsShot = shot;
  $('bsFixtureBtn').addEventListener('click', loadFixture);
  $('bsSolveBtn').addEventListener('click', runSolve);
  $('bsAddMonsterBtn').addEventListener('click', addMonster);
  const onSizeChange = () => {
    const nc = Math.min(12, Math.max(3, Number($('bsCols').value) || 6));
    const nr = Math.min(12, Math.max(3, Number($('bsRows').value) || 6));
    $('bsCols').value = nc;
    $('bsRows').value = nr;
    resizeBoard(nr, nc);
  };
  $('bsCols').addEventListener('change', onSizeChange);
  $('bsRows').addEventListener('change', onSizeChange);
  $('bsClearBtn').addEventListener('click', () => {
    state.tiles = Array.from({ length: rows() }, () => Array(cols()).fill(TILE.GROUND));
    state.team = [];
    state.monsters = [];
    state.monsterSeq = 0;
    clearResults();
    redraw();
    setStatus('');
  });
  syncSizeInputs();
  redraw();
}

init();
