// Multi-turn planner tests on the measured fixture.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { buildFixture } from '../fixtures/abyss-cave-1-3-w1.js';
import { plan } from '../planner.js';

const heroesDb = JSON.parse(
  readFileSync(new URL('../../../heroes.json', import.meta.url), 'utf8'),
);

test('planner: easy wave clears in one turn', () => {
  const { board, units } = buildFixture(heroesDb);
  const result = plan(board, units, { maxTurns: 3, firstTurnStates: 10000, timeBudgetMs: 30000 });
  assert.equal(result.cleared, true);
  assert.equal(result.turnsUsed, 1);
  assert.equal(result.plan.length, 1);
  assert.equal(result.plan[0].kills.length, 4);
});

test('planner: bulky monsters force a multi-turn plan that still clears', () => {
  const { board, units } = buildFixture(heroesDb);
  // ~150x HP (~51k total): one turn's expected damage (~18k) cannot clear
  for (const u of units) {
    if (u.side === 'monster') {
      u.hp *= 150;
      u.hpMax *= 150;
    }
  }
  const result = plan(board, units, {
    maxTurns: 4, beamWidth: 16, candidatesPerState: 8,
    firstTurnStates: 8000, laterTurnStates: 3000, timeBudgetMs: 60000,
  });
  assert.equal(result.cleared, true, `not cleared: ${JSON.stringify(result.remainingMonsters)}`);
  assert.ok(result.turnsUsed >= 2, `expected >=2 turns, got ${result.turnsUsed}`);
  assert.equal(result.plan.length, result.turnsUsed);
  // every monster dies somewhere in the plan
  const totalKills = result.plan.flatMap(t => t.kills).length;
  assert.equal(totalKills, 4);
  // each turn has at most one drag and consistent board snapshots
  for (const t of result.plan) {
    assert.ok(t.unitsStart.length > 0);
    if (t.drag) assert.ok(t.drag.path.length >= 2);
  }
  // heroes survived (fixture monsters are weak attackers even at 50x HP)
  assert.ok(result.heroHpFinal > 0);
});
