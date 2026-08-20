// Multi-turn planner: beam search over full game turns.
// One turn = our drag + hero attacks, then the monster response
// (move + attack). The objective is CLEARING, not per-turn damage:
//   1. clear the board in the fewest turns
//   2. among equal turns, keep the most hero HP
//   3. then the fewest total drag steps
// Uses expected damage as a deterministic proxy (same as the 1-turn solver);
// wave spawns are not modelled — the plan covers the current wave.

import { toPos } from './board.js';
import { cloneUnits } from './units.js';
import { enumerateTurns } from './movegen.js';
import { evaluateHeroTurn, simulateMonsterTurn } from './evaluate.js';

const aliveMonsters = units => units.filter(u => u.side === 'monster' && u.hp > 0);
const aliveHeroes = units => units.filter(u => u.side === 'hero' && u.hp > 0);
const monsterHp = units => aliveMonsters(units).reduce((s, u) => s + u.hp, 0);
const heroHp = units => aliveHeroes(units).reduce((s, u) => s + u.hp, 0);

const stateKey = units => units
  .filter(u => u.hp > 0)
  .map(u => `${u.id}:${u.r},${u.c},${Math.round(u.hp)}`)
  .join('|');

// smaller = better
function beamScore(state) {
  const u = state.units;
  return aliveMonsters(u).length * 1e9 +
    monsterHp(u) * 1e3 -
    heroHp(u) / 1e3 +
    state.steps;
}

function applyPositions(units, positions) {
  for (const [id, p] of Object.entries(positions)) {
    const u = units.find(x => x.id === id);
    u.r = p.r;
    u.c = p.c;
  }
}

export function plan(board, unitsStart, opts = {}) {
  const {
    maxTurns = 3,
    beamWidth = 24,
    candidatesPerState = 10,
    firstTurnStates = 40000,
    laterTurnStates = 5000,
    leader = 1,
    timeBudgetMs = 30000,
  } = opts;
  const t0 = Date.now();
  let timedOut = false;

  let beam = [{ units: cloneUnits(unitsStart), history: [], steps: 0 }];
  let solutions = [];
  let statesEvaluated = 0;

  for (let turn = 0; turn < maxTurns && beam.length && !solutions.length; turn++) {
    const children = [];
    const seen = new Set();

    for (const state of beam) {
      if (Date.now() - t0 > timeBudgetMs) { timedOut = true; break; }
      const maxStates = turn === 0 ? firstTurnStates : laterTurnStates;
      const { states } = enumerateTurns(board, state.units, { maxDrags: 1, maxStates });

      // evaluate the hero turn for every candidate drag
      const evals = [];
      for (const cand of states) {
        const units = cloneUnits(state.units);
        applyPositions(units, cand.positions);
        const hero = evaluateHeroTurn(board, units, cand.attackOrder, { leader });
        statesEvaluated++;
        evals.push({ cand, units, hero });
      }
      // candidate ranking: kills desc -> remaining monster HP asc -> steps asc
      evals.sort((a, b) =>
        (aliveMonsters(a.units).length - aliveMonsters(b.units).length) ||
        (monsterHp(a.units) - monsterHp(b.units)) ||
        (a.cand.steps - b.cand.steps));

      for (const e of evals.slice(0, candidatesPerState)) {
        const record = {
          turn: turn + 1,
          unitsStart: cloneUnits(state.units),
          drag: e.cand.drags[0]
            ? {
              heroId: e.cand.drags[0].heroId,
              path: e.cand.drags[0].path.map(p => toPos(p.r, p.c)),
              swaps: e.cand.drags[0].swaps,
            }
            : null,
          attackOrder: e.cand.attackOrder,
          steps: e.cand.steps,
          kills: e.hero.targets.filter(t => t.expectedKill).map(t => t.name),
          totalExpected: e.hero.totalExpected,
          incoming: 0,
          unmodeled: e.hero.unmodeled,
        };
        const child = {
          units: e.units,
          history: [...state.history, record],
          steps: state.steps + e.cand.steps,
        };

        if (aliveMonsters(e.units).length === 0) {
          solutions.push(child); // cleared before the monsters move
          continue;
        }
        const mon = simulateMonsterTurn(board, e.units);
        record.incoming = mon.incomingExpected;
        if (aliveHeroes(e.units).length === 0) continue; // wiped: dead end

        const k = stateKey(e.units);
        if (seen.has(k)) continue;
        seen.add(k);
        children.push(child);
      }
    }
    if (timedOut) break;
    if (solutions.length) break; // this depth is the minimal turn count
    children.sort((a, b) => beamScore(a) - beamScore(b));
    beam = children.slice(0, beamWidth);
  }

  // best outcome: a clear (fewest turns is guaranteed by construction;
  // tie-break hero HP desc, then steps asc), else the best surviving state
  let best;
  let cleared = false;
  if (solutions.length) {
    solutions.sort((a, b) => (heroHp(b.units) - heroHp(a.units)) || (a.steps - b.steps));
    best = solutions[0];
    cleared = true;
  } else {
    beam.sort((a, b) => beamScore(a) - beamScore(b));
    best = beam[0] ?? null;
  }

  return {
    cleared,
    turnsUsed: best ? best.history.length : 0,
    plan: best ? best.history : [],
    unitsFinal: best ? best.units : null,
    remainingMonsters: best ? aliveMonsters(best.units).map(u => ({ name: u.name, hp: Math.round(u.hp) })) : [],
    heroHpFinal: best ? Math.round(heroHp(best.units)) : 0,
    stats: { statesEvaluated, timedOut, elapsedMs: Date.now() - t0 },
  };
}
