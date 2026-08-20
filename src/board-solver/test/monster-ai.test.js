// Monster AI behaviors (spec 2.7) — all six types plus Flying/Lumbering/Healer.
import test from 'node:test';
import assert from 'node:assert/strict';

import { makeBoard, TILE } from '../board.js';
import { makeUnit } from '../units.js';
import { simulateMonsterTurn } from '../evaluate.js';

const G = TILE.GROUND, W = TILE.WALL, R = TILE.RUBBLE;
const flat = () => makeBoard(Array.from({ length: 6 }, () => Array(6).fill(G)));

const hero = (id, pos, hp = 1000) => makeUnit({
  id, side: 'hero', color: 'blue', heroClass: 'Knight', pos, atk: 100, hp,
});
const monster = props => makeUnit({
  side: 'monster', color: 'red', atk: 10, hp: 100,
  attack: { kind: 'melee', dirs: 'cross' }, ...props,
});

const at = (units, id) => {
  const u = units.find(x => x.id === id);
  return `${String.fromCharCode(65 + u.c)}${u.r + 1}`;
};

test('AI charge: random pick among equally-close attack cells', () => {
  const outcomes = new Set();
  for (let seed = 1; seed <= 8; seed++) {
    const units = [hero('H', 'D3'), monster({ id: 'm', pos: 'E5', ai: 'charge', moveRange: 3 })];
    simulateMonsterTurn(flat(), units, { seed });
    outcomes.add(at(units, 'm'));
    // it always ends adjacent-cardinal to the hero and attacks
    assert.ok(['D4', 'E3', 'D2', 'C3'].includes(at(units, 'm')));
    assert.ok(units[0].hp < 1000);
  }
  assert.ok(outcomes.size >= 2, `expected varied choices, got ${[...outcomes]}`);
});

test('AI assassin: goes for the lowest-HP hero', () => {
  const units = [
    hero('strong', 'B2', 1000),
    hero('weak', 'E5', 120),
    monster({ id: 'm', pos: 'D4', ai: 'assassin', moveRange: 2 }),
  ];
  const result = simulateMonsterTurn(flat(), units, { seed: 3 });
  assert.ok(result.perHero.weak > 0, 'assassin must hit the weak hero');
  assert.ok(!result.perHero.strong);
});

test('AI evade: attacks from the farthest possible cell', () => {
  const units = [
    hero('H', 'C3'),
    monster({ id: 'm', pos: 'C5', ai: 'evade', moveRange: 2, attack: { kind: 'ranged', dirs: 'cross' } }),
  ];
  const result = simulateMonsterTurn(flat(), units, { seed: 1 });
  // C4 (dist 1), C5 (dist 2), C6 (dist 3) can all shoot up column C -> picks C6
  assert.equal(at(units, 'm'), 'C6');
  assert.ok(result.incomingExpected > 0);
});

test('AI tactician: moves where it hits the most heroes', () => {
  const units = [
    hero('H1', 'C3'),
    hero('H2', 'D3'),
    monster({ id: 'm', pos: 'B5', ai: 'tactician', moveRange: 2, attack: { kind: 'magic', dirs: 'cross' } }),
  ];
  const result = simulateMonsterTurn(flat(), units, { seed: 1 });
  // from B3 a piercing row-3 ray hits both heroes; no other cell hits two
  assert.equal(at(units, 'm'), 'B3');
  assert.ok(result.perHero.H1 > 0 && result.perHero.H2 > 0);
});

test('Healer trait: heals wounded adjacent allies instead of attacking', () => {
  const units = [
    hero('H', 'C2'),
    monster({ id: 'troll', pos: 'D4', hp: 500, hpMax: 1000, def: 1000, moveRange: 0 }),
    monster({ id: 'shaman', pos: 'D5', ai: 'supporter', moveRange: 0, traits: ['Healer'] }),
  ];
  const troll = units[1];
  simulateMonsterTurn(flat(), units, { seed: 1 });
  assert.equal(troll.hp, 700); // +20% of def
});

test('Lumbering: attacks before moving, not after', () => {
  const units = [
    hero('H', 'C2', 1000),
    monster({ id: 'm', pos: 'C5', ai: 'charge', moveRange: 3, traits: ['Lumbering'] }),
  ];
  const result = simulateMonsterTurn(flat(), units, { seed: 1 });
  // out of range at turn start: no damage this turn, but it closed in
  assert.equal(result.incomingExpected, 0);
  assert.equal(at(units, 'm'), 'C3');
  assert.equal(units[0].hp, 1000);
});

test('Flying: crosses rubble it cannot land on', () => {
  const rows = Array.from({ length: 6 }, () => Array(6).fill(G));
  rows[2][2] = R; // C3 rubble between monster and hero
  const board = makeBoard(rows);
  const mk = traits => [
    hero('H', 'C1', 1000),
    monster({ id: 'm', pos: 'C5', ai: 'charge', moveRange: 3, traits }),
  ];
  let units = mk([]);
  let result = simulateMonsterTurn(board, units, { seed: 1 });
  assert.equal(result.incomingExpected, 0, 'grounded monster cannot get through in 3 moves');

  units = mk(['Flying']);
  result = simulateMonsterTurn(board, units, { seed: 1 });
  assert.ok(result.incomingExpected > 0, 'flying monster passes over the rubble and attacks');
  assert.equal(at(units, 'm'), 'C2');
});
