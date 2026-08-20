// Turn evaluation: hero attacks (in order), then a monster response
// simulation to estimate incoming damage.

import { isWalkable, CARDINALS } from './board.js';
import { cloneUnits, heroesOf, monstersOf } from './units.js';
import { attackProfile, resolveTargets } from './rules.js';
import { computeAttack } from './damage.js';

// Applies expected damage sequentially so later attackers see updated HP
// (kills remove blockers, Blitz/Resilient conditions shift, etc.).
// Returns totals plus per-target detail.
export function evaluateHeroTurn(board, units, attackOrder, { leader = 1 } = {}) {
  const perTarget = new Map(); // id -> {hpStart, expected, min, max, killProb}
  let totalExpected = 0, totalMin = 0, totalMax = 0;
  const unmodeled = new Set();

  for (const heroId of attackOrder) {
    const hero = units.find(u => u.id === heroId);
    if (!hero || hero.hp <= 0) continue;
    const profile = attackProfile(hero);
    for (const ctx of resolveTargets(board, units, hero)) {
      const result = computeAttack(hero, ctx, { kind: profile.kind, leader });
      result.unmodeled.forEach(t => unmodeled.add(t));

      const t = ctx.target;
      let agg = perTarget.get(t.id);
      if (!agg) {
        agg = { id: t.id, name: t.name, hpStart: t.hp, expected: 0, min: 0, max: 0, missProb: 1 };
        perTarget.set(t.id, agg);
      }
      agg.expected += result.expected;
      agg.min += result.min;
      agg.max += result.max;
      // P(target survives all hits) ~ product of per-hit survival.
      // Approximation: treats hits as independent kill chances against the
      // target's HP at the time of each hit.
      agg.missProb *= (1 - result.killProb);

      totalExpected += result.expected;
      totalMin += result.min;
      totalMax += result.max;
      t.hp = Math.max(0, t.hp - result.expected);
    }
  }

  const targets = [...perTarget.values()].map(t => ({
    ...t,
    killProb: 1 - t.missProb,
    expectedKill: t.expected >= t.hpStart,
    guaranteedKill: t.min >= t.hpStart,
    possibleKill: t.max >= t.hpStart,
  }));

  return {
    totalExpected, totalMin, totalMax,
    targets,
    kills: targets.filter(t => t.expectedKill).map(t => t.id),
    guaranteedKills: targets.filter(t => t.guaranteedKill).map(t => t.id),
    unmodeled: [...unmodeled],
  };
}

const cellKey = (r, c) => r * 16 + c;

// BFS over walkable, unoccupied cells; returns Map cellKey -> moves.
function reachableCells(board, units, mover, maxMoves) {
  const occupied = new Set(
    units.filter(u => u.hp > 0 && u !== mover).map(u => cellKey(u.r, u.c)),
  );
  const dist = new Map([[cellKey(mover.r, mover.c), 0]]);
  let frontier = [{ r: mover.r, c: mover.c }];
  for (let step = 1; step <= maxMoves; step++) {
    const next = [];
    for (const { r, c } of frontier) {
      for (const [dr, dc] of CARDINALS) {
        const nr = r + dr, nc = c + dc;
        const k = cellKey(nr, nc);
        if (dist.has(k) || !isWalkable(board, nr, nc) || occupied.has(k)) continue;
        dist.set(k, step);
        next.push({ r: nr, c: nc });
      }
    }
    frontier = next;
  }
  return dist;
}

// Monster response (spec 6.3), Charge AI only for now.
// - order: higher moveRange first; ties keep array order (game randomizes —
//   run alternative seeds later if it matters)
// - Charge: reach an attacking cell with the fewest moves; if impossible,
//   step toward the nearest hero
// - Taunt (Warrior): chargers must attack a taunting hero if one is alive
// Mutates `units` (hero HP). Returns incoming damage estimate.
export function simulateMonsterTurn(board, units) {
  const monsters = [...monstersOf(units)].sort((a, b) => b.moveRange - a.moveRange);
  let incomingExpected = 0, incomingMax = 0;
  const perHero = new Map();
  const moves = [];

  for (const m of monsters) {
    if (m.hp <= 0) continue;
    const taunters = heroesOf(units).filter(h => h.traits.includes('Taunt'));
    const validTarget = u => taunters.length === 0 || taunters.includes(u);

    const reach = reachableCells(board, units, m, m.moveRange);
    let best = null; // {r, c, moves}
    for (const [k, mv] of reach) {
      const r = Math.floor(k / 16), c = k % 16;
      const probe = { ...m, r, c };
      const hits = resolveTargets(board, units, probe).filter(t => validTarget(t.target));
      if (hits.length === 0) continue;
      if (!best || mv < best.moves) best = { r, c, moves: mv };
    }
    if (!best) {
      // cannot attack: close distance to the nearest (taunting) hero
      const goals = heroesOf(units).filter(validTarget);
      let bestCell = null, bestScore = Infinity;
      for (const [k, mv] of reach) {
        const r = Math.floor(k / 16), c = k % 16;
        for (const h of goals) {
          const d = Math.abs(h.r - r) + Math.abs(h.c - c);
          const score = d * 100 + mv;
          if (score < bestScore) { bestScore = score; bestCell = { r, c, moves: mv }; }
        }
      }
      best = bestCell ?? { r: m.r, c: m.c, moves: 0 };
    }
    if (best.r !== m.r || best.c !== m.c) moves.push({ id: m.id, from: { r: m.r, c: m.c }, to: { r: best.r, c: best.c } });
    m.r = best.r;
    m.c = best.c;

    const profile = attackProfile(m);
    for (const ctx of resolveTargets(board, units, m)) {
      if (!validTarget(ctx.target)) continue;
      const result = computeAttack(m, ctx, { kind: profile.kind, leader: 1 });
      const h = ctx.target;
      incomingExpected += result.expected;
      incomingMax += result.max;
      perHero.set(h.id, (perHero.get(h.id) ?? 0) + result.expected);
      h.hp = Math.max(0, h.hp - result.expected);
    }
  }

  return {
    incomingExpected,
    incomingMax,
    perHero: Object.fromEntries(perHero),
    heroDeaths: units.filter(u => u.side === 'hero' && u.hp <= 0).map(u => u.id),
    monsterMoves: moves,
  };
}

// Full evaluation of one placement: hero turn, then monster response.
export function evaluatePlacement(board, unitsStart, state, { leader = 1 } = {}) {
  const units = cloneUnits(unitsStart);
  for (const [id, p] of Object.entries(state.positions)) {
    const u = units.find(x => x.id === id);
    u.r = p.r;
    u.c = p.c;
  }
  const heroTurn = evaluateHeroTurn(board, units, state.attackOrder, { leader });
  const monsterTurn = simulateMonsterTurn(board, units);
  return { heroTurn, monsterTurn, unitsAfter: units };
}
