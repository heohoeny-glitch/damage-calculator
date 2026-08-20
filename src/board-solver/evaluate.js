// Turn evaluation: hero attacks (in order), then a monster response
// simulation to estimate incoming damage.

import { isWalkable, inBounds, tileAt, TILE, CARDINALS } from './board.js';
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

// deterministic seedable RNG (game rolls dice; we make them reproducible)
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pick = (rng, arr) => arr[Math.floor(rng() * arr.length)];

// BFS over walkable, unoccupied cells; returns Map cellKey -> moves.
// Monsters move in cardinal steps only (player-confirmed 2026-08-20).
// Flying units may cross rubble/water/lava (walls still block).
function reachableCells(board, units, mover, maxMoves) {
  const flying = mover.traits.includes('Flying');
  const passable = (r, c) =>
    isWalkable(board, r, c) ||
    (flying && inBounds(board, r, c) && tileAt(board, r, c) !== TILE.WALL);
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
        if (dist.has(k) || !passable(nr, nc) || occupied.has(k)) continue;
        dist.set(k, step);
        next.push({ r: nr, c: nc });
      }
    }
    frontier = next;
  }
  return dist;
}

const chebyshev = (a, b) => Math.max(Math.abs(a.r - b.r), Math.abs(a.c - b.c));

// Destination choice per monster AI (spec 2.7). Ties are random
// (player-confirmed for Charge; assumed for the rest).
function chooseDestination(board, units, m, rng) {
  const ai = (m.ai ?? 'charge').toLowerCase();
  const heroes = heroesOf(units);
  const taunters = heroes.filter(h => h.traits.includes('Taunt'));
  const validTarget = u => taunters.length === 0 || taunters.includes(u);

  const origR = m.r, origC = m.c;
  const cells = [...reachableCells(board, units, m, m.moveRange)]
    .map(([k, mv]) => ({ r: Math.floor(k / 16), c: k % 16, mv }))
    // Flying passes over rubble/water/lava but cannot land there
    .filter(({ r, c }) => isWalkable(board, r, c))
    .map(({ r, c, mv }) => {
      // move the monster for real while probing, so its own body at the old
      // cell does not block its ray (then restore)
      m.r = r;
      m.c = c;
      const hits = resolveTargets(board, units, m).filter(t => validTarget(t.target));
      return { r, c, mv, hits };
    });
  m.r = origR;
  m.c = origC;
  const attackCells = cells.filter(x => x.hits.length > 0);
  const byMin = (arr, f) => {
    const best = Math.min(...arr.map(f));
    return arr.filter(x => f(x) === best);
  };
  const byMax = (arr, f) => {
    const best = Math.max(...arr.map(f));
    return arr.filter(x => f(x) === best);
  };
  const nearestHeroDist = cell =>
    Math.min(...heroes.map(h => Math.abs(h.r - cell.r) + Math.abs(h.c - cell.c)));

  // Taunt overrides AI: if the monster can attack a taunter, it must
  if (taunters.length && attackCells.length) {
    return pick(rng, byMin(attackCells, x => x.mv));
  }

  if (attackCells.length) {
    switch (ai) {
      case 'charge':
        return pick(rng, byMin(attackCells, x => x.mv));
      case 'assassin': {
        // prefers the lowest-HP hero it can hit
        const minHp = Math.min(...attackCells.flatMap(x => x.hits.map(t => t.target.hp)));
        const onWeakest = attackCells.filter(x => x.hits.some(t => t.target.hp === minHp));
        return pick(rng, byMin(onWeakest, x => x.mv));
      }
      case 'evade':
        // attack while keeping the greatest distance
        return pick(rng, byMax(attackCells, x => nearestHeroDist(x)));
      case 'tactician':
        // hit as many heroes as possible
        return pick(rng, byMin(byMax(attackCells, x => x.hits.length), x => x.mv));
      case 'unpredictable':
        return pick(rng, attackCells); // random, but always attacks if it can
      case 'supporter':
        break; // positioning is about allies, handled below
      default:
        return pick(rng, byMin(attackCells, x => x.mv));
    }
  }

  if (ai === 'supporter') {
    // stand where the support action covers the most allies
    const allies = monstersOf(units).filter(u => u !== m);
    const cover = cell => allies.filter(a => chebyshev(a, cell) === 1).length;
    const best = byMax(cells, cover);
    return pick(rng, byMin(best, x => x.mv));
  }
  if (ai === 'evade' && cells.length) {
    return pick(rng, byMax(cells, x => nearestHeroDist(x)));
  }
  if (ai === 'unpredictable' && cells.length) {
    return pick(rng, cells);
  }
  // default approach: close the distance to the nearest (taunting) hero
  const goals = (taunters.length ? taunters : heroes);
  if (!cells.length || !goals.length) return { r: m.r, c: m.c, mv: 0 };
  const toGoal = cell => Math.min(...goals.map(h => Math.abs(h.r - cell.r) + Math.abs(h.c - cell.c)));
  return pick(rng, byMin(byMin(cells, toGoal), x => x.mv));
}

// Support action: Healer heals allies 20% of their defense (wiki). Assumed
// 8-direction range and that healing replaces attacking that turn.
function tryHeal(units, m) {
  if (!m.traits.includes('Healer')) return false;
  const wounded = monstersOf(units).filter(u => u !== m && u.hp < u.hpMax && chebyshev(u, m) === 1);
  if (!wounded.length) return false;
  for (const ally of wounded) {
    ally.hp = Math.min(ally.hpMax, ally.hp + 0.2 * (ally.def || ally.hpMax));
  }
  return true;
}

// Monster response (spec 6.3): move order = higher moveRange first (ties
// randomized), each monster moves per its AI and then attacks (Lumbering
// attacks before moving). Mutates `units`. Returns incoming damage estimate.
export function simulateMonsterTurn(board, units, { seed = 12345 } = {}) {
  const rng = mulberry32(seed);
  const monsters = [...monstersOf(units)]
    .map(m => ({ m, key: m.moveRange + rng() * 0.5 })) // random tie-break
    .sort((a, b) => b.key - a.key)
    .map(x => x.m);
  let incomingExpected = 0, incomingMax = 0;
  const perHero = new Map();
  const moves = [];

  const attackNow = m => {
    const taunters = heroesOf(units).filter(h => h.traits.includes('Taunt'));
    const validTarget = u => taunters.length === 0 || taunters.includes(u);
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
  };

  for (const m of monsters) {
    if (m.hp <= 0) continue;
    const lumbering = m.traits.includes('Lumbering');
    if (lumbering) attackNow(m); // attacks before moving

    const dest = chooseDestination(board, units, m, rng);
    if (dest.r !== m.r || dest.c !== m.c) {
      moves.push({ id: m.id, from: { r: m.r, c: m.c }, to: { r: dest.r, c: dest.c } });
      m.r = dest.r;
      m.c = dest.c;
    }
    if (!lumbering && !tryHeal(units, m)) attackNow(m);
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
