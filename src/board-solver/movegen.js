// Drag enumeration.
// A drag moves one hero along an 8-direction path; entering an ally's cell
// swaps the two. Monsters and non-walkable terrain block (Tumble/Push not
// modelled yet).
// Game rule (player-confirmed 2026-08-20): ONE drag per turn, but the path
// length is unlimited within the time limit. So the search is a BFS over
// (dragged-hero cell, team configuration) states — path length needs no
// artificial cap because each distinct state is visited once, with its
// shortest path (which is also what the objective prefers).

import { ALL8, isWalkable } from './board.js';

const key = (r, c) => r * 16 + c;

// positions: { [unitId]: {r, c} } — heroes only; monster cells are static
// blockers passed via `blocked`.
// Returns [{ path: [{r,c}...], swaps, positions }], one entry per distinct
// reached (cell, configuration) state, shortest path first.
export function enumerateDrags(board, positions, heroIds, heroId, blocked, maxSteps = Infinity, maxResults = Infinity) {
  const results = [];
  const cfgKey = cfg => heroIds.map(id => key(cfg[id].r, cfg[id].c)).join(',');
  const clone = cfg => {
    const out = {};
    for (const id of heroIds) out[id] = { ...cfg[id] };
    return out;
  };

  // A cell that seals a diagonal gap: impassable terrain or a monster.
  // Allies do not seal (the drag can swap past them).
  const seals = (r, c) => !isWalkable(board, r, c) || blocked.has(key(r, c));

  const startCfg = clone(positions);
  const start = startCfg[heroId];
  const seen = new Set([key(start.r, start.c) + '#' + cfgKey(startCfg)]);
  let frontier = [{ cfg: startCfg, path: [{ ...start }], swaps: [false] }];

  for (let depth = 0; depth < maxSteps && frontier.length; depth++) {
    const next = [];
    for (const node of frontier) {
      const cur = node.cfg[heroId];
      const occupant = new Map();
      for (const id of heroIds) {
        const p = node.cfg[id];
        occupant.set(key(p.r, p.c), id);
      }
      for (const [dr, dc] of ALL8) {
        const r = cur.r + dr;
        const c = cur.c + dc;
        if (!isWalkable(board, r, c)) continue;
        const cell = key(r, c);
        if (blocked.has(cell)) continue; // monster
        // No squeezing between two diagonally-arranged blockers
        // (player-confirmed): a diagonal step is illegal when BOTH flanking
        // cells are sealed. TODO verify in game whether a single sealed
        // flank also blocks; flip `&&` to `||` if so.
        if (dr !== 0 && dc !== 0 && seals(cur.r + dr, cur.c) && seals(cur.r, cur.c + dc)) continue;

        const other = occupant.get(cell) ?? null; // ally to swap with
        const cfg = clone(node.cfg);
        if (other) cfg[other] = { r: cur.r, c: cur.c };
        cfg[heroId] = { r, c };

        const k = cell + '#' + cfgKey(cfg);
        if (seen.has(k)) continue;
        seen.add(k);

        const rec = {
          cfg,
          path: [...node.path, { r, c }],
          swaps: [...node.swaps, other !== null],
        };
        results.push({ path: rec.path, swaps: rec.swaps, positions: clone(cfg) });
        if (results.length >= maxResults) return results;
        next.push(rec);
      }
    }
    frontier = next;
  }
  return results;
}

// Attack order: the hero moved last attacks first (spec 2.3); heroes that
// were not dragged follow in team order. Passive swaps do not count as
// "moved" (assumption — verify in game).
export function attackOrderOf(drags, teamOrder) {
  const order = [];
  for (let i = drags.length - 1; i >= 0; i--) {
    if (!order.includes(drags[i].heroId)) order.push(drags[i].heroId);
  }
  for (const id of teamOrder) {
    if (!order.includes(id)) order.push(id);
  }
  return order;
}

// Enumerate distinct turn states.
// Game rule: one drag per turn (maxDrags stays a parameter for
// experimentation, but 1 is the real rule). Steps are unlimited — the BFS
// state dedup in enumerateDrags bounds the search, and maxStates is the
// safety cap. Dedup key = final hero placement + attack order; the first
// (shortest) occurrence wins, matching the objective's tie-break.
// Returns { states: [{drags, positions, attackOrder, steps}], truncated }.
export function enumerateTurns(board, units, { maxDrags = 1, maxSteps = Infinity, maxStates = 30000 } = {}) {
  const heroes = units.filter(u => u.side === 'hero' && u.hp > 0);
  const heroIds = heroes.map(u => u.id);
  const blocked = new Set(
    units.filter(u => u.side === 'monster' && u.hp > 0).map(u => key(u.r, u.c)),
  );
  const basePositions = {};
  for (const h of heroes) basePositions[h.id] = { r: h.r, c: h.c };

  const stateKey = (positions, attackOrder) =>
    heroIds.map(id => `${id}:${positions[id].r},${positions[id].c}`).join('|') +
    '#' + attackOrder.join(',');

  const seen = new Set();
  const states = [];
  let truncated = false;

  const baseState = {
    drags: [],
    positions: basePositions,
    attackOrder: attackOrderOf([], heroIds),
    steps: 0,
  };
  seen.add(stateKey(baseState.positions, baseState.attackOrder));
  states.push(baseState);

  let frontier = [baseState];
  for (let depth = 0; depth < maxDrags && !truncated; depth++) {
    const next = [];
    for (const state of frontier) {
      if (truncated) break;
      for (const heroId of heroIds) {
        const drags = enumerateDrags(
          board, state.positions, heroIds, heroId, blocked,
          maxSteps, Math.max(0, maxStates - states.length));
        for (const d of drags) {
          const newDrags = [...state.drags, { heroId, path: d.path, swaps: d.swaps }];
          const attackOrder = attackOrderOf(newDrags, heroIds);
          const k = stateKey(d.positions, attackOrder);
          if (seen.has(k)) continue;
          seen.add(k);
          const s = {
            drags: newDrags,
            positions: d.positions,
            attackOrder,
            steps: state.steps + (d.path.length - 1),
          };
          states.push(s);
          next.push(s);
          if (states.length >= maxStates) { truncated = true; break; }
        }
        if (truncated) break;
      }
    }
    frontier = next;
  }

  return { states, truncated };
}
