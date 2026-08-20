// Attack patterns, target resolution, line of sight, color advantage.

import { ALL8, CARDINALS, DIAGONALS, blocksProjectile, inBounds, isCardinalDir } from './board.js';
import { unitAt } from './units.js';

// Class -> attack profile (spec 2.4).
// `provisional: true` marks classes missing from the verified wiki table;
// their patterns are best guesses from the fixture screenshots and must be
// confirmed against the wiki.
export const CLASS_PATTERNS = {
  Knight: { kind: 'melee', dirs: 'cross' },
  Guardian: { kind: 'melee', dirs: 'cross' },
  Barbarian: { kind: 'melee', dirs: 'all8' },
  Assassin: { kind: 'melee', dirs: 'cross' },
  Rogue: { kind: 'melee', dirs: 'all8' },
  Monk: { kind: 'melee', dirs: 'all8' },
  Paladin: { kind: 'melee', dirs: 'cross' },
  Druid: { kind: 'melee', dirs: 'cross' },
  Princess: { kind: 'melee', dirs: 'all8' },
  Archer: { kind: 'ranged', dirs: 'cross' },
  Hunter: { kind: 'ranged', dirs: 'cross' },
  Ranger: { kind: 'ranged', dirs: 'all8' },
  Mage: { kind: 'magic', dirs: 'cross' },
  Witch: { kind: 'magic', dirs: 'cross' },
  Elementalist: { kind: 'magic', dirs: 'all8' },
  Healer: { kind: 'magic', dirs: 'cross' },
  // Not in the verified table (spec 2.4 warning):
  Javelineer: { kind: 'ranged', dirs: 'cross', provisional: true },
  Warrior: { kind: 'melee', dirs: 'cross', provisional: true },
  Gladiator: { kind: 'melee', dirs: 'all8', provisional: true },
  Bard: { kind: 'magic', dirs: 'cross', provisional: true },
  Warlock: { kind: 'magic', dirs: 'cross', provisional: true },
  Pirate: { kind: 'ranged', dirs: 'cross', provisional: true }, // wiki: "melee or ranged"
};

export function attackProfile(unit) {
  if (unit.attack) return unit.attack; // explicit override (all monsters)
  const p = CLASS_PATTERNS[unit.heroClass];
  if (!p) throw new Error(`no attack pattern for class '${unit.heroClass}' (unit ${unit.id})`);
  return p;
}

// blue -> red -> green -> blue, light <-> dark. Advantage = x1.5, else x1.
const BEATS = { blue: 'red', red: 'green', green: 'blue', light: 'dark', dark: 'light' };

export function colorMultiplier(attColor, defColor) {
  return BEATS[attColor] === defColor ? 1.5 : 1;
}

function dirsFor(profile) {
  return profile.dirs === 'all8' ? ALL8 : CARDINALS;
}

// Number of 'Ballistic' traits = number of allies a ranged shot can pass over.
function ballisticCount(unit) {
  return unit.traits.filter(t => t === 'Ballistic').length;
}

// Returns the list of targets this unit's attack would hit right now:
// [{ target, dr, dc, dirType, distance, emptyBetween, isNearest }]
// Assumptions (documented in spec):
// - melee hits every enemy adjacent along its pattern directions
// - ranged stops at the first unit in a ray; an ally blocks the shot
//   unless the attacker has Ballistic (one pass per Ballistic trait)
// - magic pierces all units and hits every enemy in the ray
// - only walls block rays; rubble/water/lava do not
export function resolveTargets(board, units, attacker) {
  const profile = attackProfile(attacker);
  const enemySide = attacker.side === 'hero' ? 'monster' : 'hero';
  const out = [];

  for (const [dr, dc] of dirsFor(profile)) {
    const dirType = isCardinalDir(dr, dc) ? 'cardinal' : 'diagonal';

    if (profile.kind === 'melee') {
      const r = attacker.r + dr;
      const c = attacker.c + dc;
      if (!inBounds(board, r, c)) continue;
      const u = unitAt(units, r, c);
      if (u && u.side === enemySide) {
        out.push({ target: u, dr, dc, dirType, distance: 1, emptyBetween: 0, isNearest: true });
      }
      continue;
    }

    // ranged / magic: walk the ray
    let passesLeft = profile.kind === 'ranged' ? ballisticCount(attacker) : Infinity;
    let emptyBetween = 0;
    let firstInRay = true;
    for (let step = 1; ; step++) {
      const r = attacker.r + dr * step;
      const c = attacker.c + dc * step;
      if (!inBounds(board, r, c) || blocksProjectile(board, r, c)) break;
      const u = unitAt(units, r, c);
      if (!u) {
        emptyBetween++;
        continue;
      }
      if (u.side === enemySide) {
        out.push({ target: u, dr, dc, dirType, distance: step, emptyBetween, isNearest: firstInRay });
        firstInRay = false;
        if (profile.kind === 'ranged') break; // first enemy only
        // magic pierces: keep walking
      } else {
        // ally in the way
        if (profile.kind === 'ranged') {
          if (passesLeft > 0) { passesLeft--; continue; }
          break;
        }
        // magic passes allies
      }
    }
  }
  return out;
}

export { CARDINALS, DIAGONALS, ALL8 };
