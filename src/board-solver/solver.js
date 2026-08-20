// Search orchestration: enumerate turn states, evaluate each, rank.

import { toPos } from './board.js';
import { enumerateTurns } from './movegen.js';
import { evaluatePlacement } from './evaluate.js';

// Lexicographic objective (spec 6.4):
// kills desc, then
//   full clear (every monster dies): steps asc — surplus damage is wasted,
//     so the shortest executable drag wins
//   partial clear: damage desc -> incoming asc -> steps asc
export function compareResults(a, b) {
  if (a.score.kills !== b.score.kills) return b.score.kills - a.score.kills;
  if (a.score.fullClear && b.score.fullClear) {
    if (a.score.steps !== b.score.steps) return a.score.steps - b.score.steps;
    if (a.score.incoming !== b.score.incoming) return a.score.incoming - b.score.incoming;
    return b.score.totalExpected - a.score.totalExpected;
  }
  if (a.score.totalExpected !== b.score.totalExpected) return b.score.totalExpected - a.score.totalExpected;
  if (a.score.incoming !== b.score.incoming) return a.score.incoming - b.score.incoming;
  return a.score.steps - b.score.steps;
}

// opts:
//   maxDrags, maxSteps, maxStates — search size (movegen)
//   topN         — number of ranked placements to return (default 5)
//   leader       — leader-skill multiplier applied to all hero attacks
//   timeBudgetMs — soft cap; evaluation stops early when exceeded
export function solve(board, units, opts = {}) {
  const {
    maxDrags = 1,        // game rule: one drag per turn
    maxSteps = Infinity, // steps are unlimited; BFS state dedup bounds this
    maxStates = 30000,
    topN = 5,
    leader = 1,
    timeBudgetMs = 10000,
  } = opts;

  const t0 = Date.now();
  const totalMonsters = units.filter(u => u.side === 'monster' && u.hp > 0).length;
  const { states, truncated } = enumerateTurns(board, units, { maxDrags, maxSteps, maxStates });

  const results = [];
  let evaluated = 0;
  let timedOut = false;
  for (const state of states) {
    if (Date.now() - t0 > timeBudgetMs) { timedOut = true; break; }
    const { heroTurn, monsterTurn } = evaluatePlacement(board, units, state, { leader });
    evaluated++;
    results.push({
      drags: state.drags.map(d => ({
        heroId: d.heroId,
        path: d.path.map(p => toPos(p.r, p.c)),
        swaps: d.swaps,
      })),
      positions: Object.fromEntries(
        Object.entries(state.positions).map(([id, p]) => [id, toPos(p.r, p.c)]),
      ),
      attackOrder: state.attackOrder,
      score: {
        kills: heroTurn.kills.length,
        fullClear: heroTurn.kills.length === totalMonsters,
        guaranteedKills: heroTurn.guaranteedKills.length,
        totalExpected: heroTurn.totalExpected,
        totalMin: heroTurn.totalMin,
        totalMax: heroTurn.totalMax,
        incoming: monsterTurn.incomingExpected,
        steps: state.steps,
      },
      targets: heroTurn.targets,
      perHeroIncoming: monsterTurn.perHero,
      unmodeled: heroTurn.unmodeled,
    });
  }

  results.sort(compareResults);
  return {
    top: results.slice(0, topN),
    stats: {
      statesEnumerated: states.length,
      statesEvaluated: evaluated,
      truncated,
      timedOut,
      elapsedMs: Date.now() - t0,
    },
  };
}
