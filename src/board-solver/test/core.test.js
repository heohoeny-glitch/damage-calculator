import test from 'node:test';
import assert from 'node:assert/strict';

import { makeBoard, parsePos, toPos, isWalkable, TILE } from '../board.js';
import { makeUnit } from '../units.js';
import { colorMultiplier, resolveTargets } from '../rules.js';
import { attackTraitState, defenseReductionCount } from '../traits.js';
import { computeAttack, killProbability } from '../damage.js';
import { enumerateDrags, attackOrderOf, enumerateTurns } from '../movegen.js';
import { simulateMonsterTurn } from '../evaluate.js';

const G = TILE.GROUND, W = TILE.WALL;
const flat = () => makeBoard(Array.from({ length: 6 }, () => Array(6).fill(G)));

const heroDefaults = { side: 'hero', color: 'blue', atk: 100, hp: 1000 };
const monsterDefaults = {
  side: 'monster', color: 'red', atk: 10, hp: 100,
  attack: { kind: 'melee', dirs: 'cross' }, monsterClasses: ['goblinoid'],
};

test('board: position conversion round-trips', () => {
  assert.deepEqual(parsePos('A1'), { r: 0, c: 0 });
  assert.deepEqual(parsePos('F6'), { r: 5, c: 5 });
  assert.equal(toPos(2, 3), 'D3');
  assert.equal(toPos(parsePos('C4').r, parsePos('C4').c), 'C4');
});

test('board: walls are not walkable', () => {
  const b = makeBoard([[G, W], [G, G]].map(row => [...row, G, G, G, G]).concat(
    Array.from({ length: 4 }, () => Array(6).fill(G))));
  assert.equal(isWalkable(b, 0, 0), true);
  assert.equal(isWalkable(b, 0, 1), false);
  assert.equal(isWalkable(b, -1, 0), false);
});

test('rules: color advantage is blue->red->green->blue at x1.5', () => {
  assert.equal(colorMultiplier('blue', 'red'), 1.5);
  assert.equal(colorMultiplier('red', 'green'), 1.5);
  assert.equal(colorMultiplier('green', 'blue'), 1.5);
  assert.equal(colorMultiplier('red', 'blue'), 1);
  assert.equal(colorMultiplier('light', 'dark'), 1.5);
  assert.equal(colorMultiplier('dark', 'light'), 1.5);
});

test('rules: melee hits every adjacent enemy in pattern, cross only', () => {
  const units = [
    makeUnit({ ...heroDefaults, id: 'K', pos: 'C3', heroClass: 'Knight' }),
    makeUnit({ ...monsterDefaults, id: 'm1', pos: 'C2' }), // north
    makeUnit({ ...monsterDefaults, id: 'm2', pos: 'D3' }), // east
    makeUnit({ ...monsterDefaults, id: 'm3', pos: 'D4' }), // diagonal: not hit
  ];
  const hits = resolveTargets(flat(), units, units[0]).map(t => t.target.id).sort();
  assert.deepEqual(hits, ['m1', 'm2']);
});

test('rules: ranged stops at first unit; Ballistic shoots over allies', () => {
  const units = [
    makeUnit({ ...heroDefaults, id: 'A', pos: 'A1', heroClass: 'Archer' }),
    makeUnit({ ...heroDefaults, id: 'ally', pos: 'A3', heroClass: 'Knight' }),
    makeUnit({ ...monsterDefaults, id: 'm', pos: 'A5' }),
  ];
  assert.equal(resolveTargets(flat(), units, units[0]).length, 0); // ally blocks

  units[0].traits = ['Ballistic'];
  const hits = resolveTargets(flat(), units, units[0]);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].target.id, 'm');
});

test('rules: magic pierces allies and hits all enemies in the ray', () => {
  const units = [
    makeUnit({ ...heroDefaults, id: 'M', pos: 'A1', heroClass: 'Mage' }),
    makeUnit({ ...heroDefaults, id: 'ally', pos: 'A2', heroClass: 'Knight' }),
    makeUnit({ ...monsterDefaults, id: 'm1', pos: 'A3' }),
    makeUnit({ ...monsterDefaults, id: 'm2', pos: 'A5' }),
  ];
  const hits = resolveTargets(flat(), units, units[0]);
  assert.deepEqual(hits.map(t => t.target.id).sort(), ['m1', 'm2']);
  const far = hits.find(t => t.target.id === 'm2');
  assert.equal(far.isNearest, false);
  assert.equal(far.emptyBetween, 1); // only A4 is empty in the ray
});

test('rules: walls block rays', () => {
  const rows = Array.from({ length: 6 }, () => Array(6).fill(G));
  rows[2][0] = W; // A3
  const board = makeBoard(rows);
  const units = [
    makeUnit({ ...heroDefaults, id: 'M', pos: 'A1', heroClass: 'Mage' }),
    makeUnit({ ...monsterDefaults, id: 'm', pos: 'A5' }),
  ];
  assert.equal(resolveTargets(board, units, units[0]).length, 0);
});

test('traits: Sniper needs 2 empty squares; Blitz needs full health', () => {
  const attacker = makeUnit({ ...heroDefaults, id: 'A', pos: 'A1', heroClass: 'Archer', traits: ['Sniper', 'Blitz'] });
  const defender = makeUnit({ ...monsterDefaults, id: 'm', pos: 'A4' });
  const ctxNear = { attacker, defender, kind: 'ranged', dirType: 'cardinal', distance: 1, emptyBetween: 0, isNearest: true };
  const ctxFar = { ...ctxNear, distance: 3, emptyBetween: 2 };

  assert.equal(attackTraitState(attacker, ctxNear).sum, 0.25); // Blitz only
  assert.equal(attackTraitState(attacker, ctxFar).sum, 0.5);   // Blitz + Sniper

  attacker.hp = attacker.hpMax - 1;
  assert.equal(attackTraitState(attacker, ctxFar).sum, 0.25);  // Sniper only
});

test('traits: parries count per matching condition', () => {
  const defender = makeUnit({
    ...heroDefaults, id: 'D', pos: 'A1', heroClass: 'Knight',
    traits: ['Cardinal Parry', 'Cardinal Parry', 'Magic Parry'],
  });
  const base = { defender, attacker: null, kind: 'melee', dirType: 'cardinal' };
  assert.equal(defenseReductionCount(defender, base), 2);
  assert.equal(defenseReductionCount(defender, { ...base, dirType: 'diagonal' }), 0);
  assert.equal(defenseReductionCount(defender, { ...base, kind: 'magic' }), 3);
});

test('damage: goblinoid +25% applies only at full health', () => {
  const troll = makeUnit({ ...monsterDefaults, id: 'troll', pos: 'C3', atk: 32, hp: 114, traits: ['Attack', 'Attack'] });
  const squall = makeUnit({ ...heroDefaults, id: 'H1', pos: 'C4', heroClass: 'Healer', species: 'beastfolk', atk: 546, hp: 2054 });
  const ctx = { target: squall, dirType: 'cardinal', distance: 1, emptyBetween: 0, isNearest: true };

  // 32 * (1 + 0.5 attack talents) * 1.25 goblinoid = 60; * E[HeroBonus]=1.125
  const full = computeAttack(troll, ctx, { kind: 'melee' });
  assert.ok(Math.abs(full.min - 60) < 1e-9);
  assert.ok(Math.abs(full.expected - 67.5) < 1e-9);
  assert.ok(Math.abs(full.max - 75) < 1e-9);

  troll.hp = 100; // no longer full health
  const hurt = computeAttack(troll, ctx, { kind: 'melee' });
  assert.ok(Math.abs(hurt.min - 48) < 1e-9);
});

test('damage: blue hero gets x1.5 vs red monster; kill probability is sane', () => {
  const serelune = makeUnit({
    ...heroDefaults, id: 'H2', pos: 'C2', heroClass: 'Archer', species: 'elf',
    atk: 1300, hp: 2548, traits: ['Sniper', 'Blitz', 'Blitz'],
  });
  const ogre = makeUnit({ ...monsterDefaults, id: 'ogre', pos: 'C1', atk: 18, hp: 89 });
  const ctx = { target: ogre, dirType: 'cardinal', distance: 1, emptyBetween: 0, isNearest: true };

  const r = computeAttack(serelune, ctx, { kind: 'ranged' });
  // 1300 * (1 + 0.5 blitz) * 1.5 color = 2925 (sniper inactive at range 1)
  assert.ok(Math.abs(r.min - 2925) < 1e-9);
  assert.equal(r.killProb, 1); // massive overkill

  assert.equal(killProbability(100, 50), 1);   // det >= hp even at min roll
  assert.equal(killProbability(100, 130), 0);  // unreachable without parry
  const mid = killProbability(100, 110);       // needs HeroBonus >= 1.10
  assert.ok(mid > 0.55 && mid < 0.65);
});

test('units: monster level curve reproduces the measured level-4 stats', async () => {
  const { estimateMonsterStat } = await import('../units.js');
  // (wiki lv100 ref, measured lv4) pairs from the fixture inspectors
  const cases = [
    [290, 32], [1015, 114],  // troll atk/hp
    [151, 18], [790, 89],    // ogre
    [44, 5], [616, 69],      // orc shaman
    [77, 9], [180, 20],      // goblin
  ];
  for (const [ref, measured] of cases) {
    const est = estimateMonsterStat(ref, 4);
    assert.ok(Math.abs(est - measured) <= 1.5, `ref ${ref}: est ${est} vs measured ${measured}`);
  }
});

test('movegen: entering an ally cell swaps the two heroes', () => {
  const positions = { H1: { r: 2, c: 2 }, H2: { r: 2, c: 3 } };
  const drags = enumerateDrags(flat(), positions, ['H1', 'H2'], 'H1', new Set(), 1);
  const swap = drags.find(d => d.positions.H1.c === 3 && d.positions.H1.r === 2);
  assert.ok(swap);
  assert.deepEqual(swap.positions.H2, { r: 2, c: 2 }); // ally took H1's cell
});

test('movegen: no diagonal squeeze between two diagonal blockers', () => {
  // walls at B1 and A2 seal the A1<->B2 diagonal
  const rows = Array.from({ length: 6 }, () => Array(6).fill(G));
  rows[0][1] = W; // B1
  rows[1][0] = W; // A2
  const board = makeBoard(rows);
  const positions = { H1: { r: 0, c: 0 } }; // A1
  const drags = enumerateDrags(board, positions, ['H1'], 'H1', new Set(), 1);
  assert.ok(!drags.some(d => d.positions.H1.r === 1 && d.positions.H1.c === 1),
    'diagonal through a sealed corner must be illegal');

  // only ONE flank blocked -> diagonal is allowed (verify in game; see movegen)
  rows[1][0] = G; // reopen A2
  const board2 = makeBoard(rows.map(r => [...r]));
  const drags2 = enumerateDrags(board2, { H1: { r: 0, c: 0 } }, ['H1'], 'H1', new Set(), 1);
  assert.ok(drags2.some(d => d.positions.H1.r === 1 && d.positions.H1.c === 1));

  // monsters seal corners too
  const monsterBlocked = new Set([0 * 16 + 1, 1 * 16 + 0]); // B1, A2
  const flat6 = makeBoard(Array.from({ length: 6 }, () => Array(6).fill(G)));
  const drags3 = enumerateDrags(flat6, { H1: { r: 0, c: 0 } }, ['H1'], 'H1', monsterBlocked, 1);
  assert.ok(!drags3.some(d => d.positions.H1.r === 1 && d.positions.H1.c === 1));
});

test('movegen: monsters block drags', () => {
  const positions = { H1: { r: 2, c: 2 } };
  const blocked = new Set([1 * 16 + 2]); // monster at C2
  const drags = enumerateDrags(flat(), positions, ['H1'], 'H1', blocked, 1);
  assert.equal(drags.length, 7); // 8 neighbours minus the monster cell
  assert.ok(!drags.some(d => d.positions.H1.r === 1 && d.positions.H1.c === 2));
});

test('movegen: unlimited steps stay bounded via state dedup', () => {
  // lone hero, empty board: every other cell reachable exactly once,
  // each via its shortest (Chebyshev) path
  const drags = enumerateDrags(flat(), { H1: { r: 0, c: 0 } }, ['H1'], 'H1', new Set(), Infinity);
  assert.equal(drags.length, 35);
  const far = drags.find(d => d.positions.H1.r === 5 && d.positions.H1.c === 5);
  assert.equal(far.path.length - 1, 5);

  // with allies, swap chains multiply states but stay within the
  // theoretical bound of distinct placements (36*35*34 for 3 units)
  const positions = { H1: { r: 0, c: 0 }, H2: { r: 0, c: 1 }, H3: { r: 1, c: 1 } };
  const withAllies = enumerateDrags(flat(), positions, ['H1', 'H2', 'H3'], 'H1', new Set(), Infinity);
  assert.ok(withAllies.length > 35);
  assert.ok(withAllies.length < 36 * 35 * 34);

  // maxResults caps the enumeration (solver safety limit)
  const capped = enumerateDrags(flat(), positions, ['H1', 'H2', 'H3'], 'H1', new Set(), Infinity, 500);
  assert.equal(capped.length, 500);
});

test('movegen: last-dragged hero attacks first', () => {
  const order = attackOrderOf(
    [{ heroId: 'A' }, { heroId: 'B' }],
    ['A', 'B', 'C'],
  );
  assert.deepEqual(order, ['B', 'A', 'C']);
});

test('movegen: turn enumeration dedups placements and includes the no-drag baseline', () => {
  const units = [
    makeUnit({ ...heroDefaults, id: 'H1', pos: 'C3', heroClass: 'Knight' }),
    makeUnit({ ...monsterDefaults, id: 'm', pos: 'A1' }),
  ];
  const { states, truncated } = enumerateTurns(flat(), units, { maxDrags: 1, maxSteps: 2 });
  assert.equal(truncated, false);
  assert.equal(states[0].drags.length, 0);
  const keys = states.map(s => `${s.positions.H1.r},${s.positions.H1.c}#${s.attackOrder}`);
  assert.equal(new Set(keys).size, keys.length);
});

test('board: non-6x6 dungeons work end to end (8x5 board)', () => {
  const b = makeBoard(Array.from({ length: 5 }, () => Array(8).fill(G)));
  assert.equal(toPos(4, 7), 'H5');
  assert.deepEqual(parsePos('H5'), { r: 4, c: 7 });

  const units = [
    makeUnit({ ...heroDefaults, id: 'H1', pos: 'G4', heroClass: 'Archer' }),
    makeUnit({ ...monsterDefaults, id: 'm', pos: 'G1' }),
  ];
  // ranged cross ray up column G hits the monster across the taller board
  const hits = resolveTargets(b, units, units[0]);
  assert.ok(hits.some(h => h.target.id === 'm'));

  const { states } = enumerateTurns(b, units, { maxDrags: 1, maxSteps: 2 });
  assert.ok(states.length > 8);
  // no enumerated position leaves the 8x5 bounds
  for (const s of states) {
    const p = s.positions.H1;
    assert.ok(p.r >= 0 && p.r < 5 && p.c >= 0 && p.c < 8);
  }
});

test('evaluate: charge AI cannot cut through walls', () => {
  const rows = Array.from({ length: 6 }, () => Array(6).fill(G));
  rows[0][1] = W; // B1: wall between monster A1 and hero C1
  const board = makeBoard(rows);
  const mk = range => [
    makeUnit({ ...monsterDefaults, id: 'm', pos: 'A1', moveRange: range }),
    makeUnit({ ...heroDefaults, id: 'H1', pos: 'C1', heroClass: 'Knight', hp: 1000 }),
  ];

  // range 1: cannot round the wall -> no attack
  let units = mk(1);
  let result = simulateMonsterTurn(board, units);
  assert.equal(result.incomingExpected, 0);

  // range 3: A1 -> A2 -> B2 -> C2, then attacks C1
  units = mk(3);
  result = simulateMonsterTurn(board, units);
  assert.ok(result.incomingExpected > 0);
  assert.ok(units[1].hp < 1000);
});
