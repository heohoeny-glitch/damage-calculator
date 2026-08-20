// Regression tests on the measured fixture (spec 9: 심연의 동굴 1-3, wave 1).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { buildFixture } from '../fixtures/abyss-cave-1-3-w1.js';
import { resolveTargets, attackProfile } from '../rules.js';
import { computeAttack } from '../damage.js';
import { cloneUnits } from '../units.js';
import { parsePos } from '../board.js';
import { solve, compareResults } from '../solver.js';

const heroesDb = JSON.parse(
  readFileSync(new URL('../../../heroes.json', import.meta.url), 'utf8'),
);

function fixture() {
  return buildFixture(heroesDb);
}

function moveTo(units, id, pos) {
  const u = units.find(x => x.id === id);
  const { r, c } = parsePos(pos);
  u.r = r;
  u.c = c;
  return u;
}

test('fixture: builds 5 heroes and 4 monsters from the DB', () => {
  const { units } = fixture();
  assert.equal(units.filter(u => u.side === 'hero').length, 5);
  assert.equal(units.filter(u => u.side === 'monster').length, 4);
  const elysia = units.find(u => u.id === 'H3');
  assert.equal(elysia.heroClass, 'Monk');
  assert.equal(elysia.atk, 2266); // asc4 confirmed by frame shape
  assert.equal(elysia.hpMax, 5734);
});

test('fixture: all hero attacks get x1.5 against the all-red wave (spec 9.4)', () => {
  const { board, units } = fixture();
  // Put Serelune under the ogre: C2 -> ray north hits ogre at C1
  const serelune = moveTo(cloneUnits(units), 'H2', 'C2');
  const working = cloneUnits(units);
  moveTo(working, 'H2', 'C2');
  const hits = resolveTargets(board, working, working.find(u => u.id === 'H2'));
  const ogreHit = hits.find(h => h.target.id === 'ogre');
  assert.ok(ogreHit);
  const r = computeAttack(working.find(u => u.id === 'H2'), ogreHit, { kind: 'ranged' });
  // min roll = atk * (1 + traits) * 1.5; verify the 1.5 is present by
  // recomputing without color advantage
  const atk = working.find(u => u.id === 'H2').atk;
  assert.ok(Math.abs(r.min / (atk * (1 + r.traitSum)) - 1.5) < 1e-9);
  assert.equal(r.killProb, 1);
});

test('fixture: vertical magic ray from column C hits the ogre through empty cells', () => {
  const { board, units } = fixture();
  const working = cloneUnits(units);
  moveTo(working, 'H1', 'C4'); // Squall (Healer: magic cross)
  const squall = working.find(u => u.id === 'H1');
  const hits = resolveTargets(board, working, squall);
  assert.ok(hits.some(h => h.target.id === 'ogre'));
  // troll is in column D: a C-column ray must not hit it
  assert.ok(!hits.some(h => h.target.id === 'troll'));
});

test('fixture: goblinoid +25% is active in the initial (full-health) state (spec 9.4)', () => {
  const { board, units } = fixture();
  const working = cloneUnits(units);
  moveTo(working, 'H5', 'B3'); // Radomyr next to shaman A3
  const shaman = working.find(u => u.id === 'shaman-a');
  const hits = resolveTargets(board, working, shaman);
  const radomyrHit = hits.find(h => h.target.id === 'H5');
  assert.ok(radomyrHit);
  const r = computeAttack(shaman, radomyrHit, { kind: 'melee' });
  // 5 atk * 1.25 goblinoid = 6.25 min (no active attack talents, no parry)
  assert.ok(Math.abs(r.min - 6.25) < 1e-9);
});

test('solver: fixture run returns ranked placements with kills', () => {
  const { board, units } = fixture();
  const t0 = Date.now();
  const { top, stats } = solve(board, units, {
    maxDrags: 1, maxSteps: 4, topN: 5, maxStates: 10000, timeBudgetMs: 30000,
  });
  const elapsed = Date.now() - t0;

  assert.equal(top.length, 5);
  for (let i = 1; i < top.length; i++) {
    assert.ok(compareResults(top[i - 1], top[i]) <= 0, 'results are sorted');
  }
  // max-level heroes one-shot a level-4 wave: the best single drag kills
  assert.ok(top[0].score.kills >= 1, `expected kills, got ${JSON.stringify(top[0].score)}`);
  assert.ok(top[0].drags.length <= 1);
  // among full clears the shortest drag ranks first
  const clears = top.filter(r => r.score.fullClear);
  for (let i = 1; i < clears.length; i++) {
    assert.ok(clears[i - 1].score.steps <= clears[i].score.steps);
  }
  assert.ok(stats.statesEvaluated > 100);
  assert.ok(elapsed < 30000, `too slow: ${elapsed}ms`);
});

test('solver: two drags dominate or match one drag', () => {
  const { board, units } = fixture();
  const one = solve(board, units, { maxDrags: 1, maxSteps: 3, maxStates: 5000 });
  const two = solve(board, units, { maxDrags: 2, maxSteps: 3, maxStates: 5000 });
  assert.ok(two.top[0].score.kills >= one.top[0].score.kills);
});

test('fixture: every hero class resolves to an attack profile', () => {
  const { units } = fixture();
  for (const u of units) {
    const p = attackProfile(u);
    assert.ok(['melee', 'ranged', 'magic'].includes(p.kind));
  }
});
