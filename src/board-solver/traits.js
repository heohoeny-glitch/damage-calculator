// Trait activation rules.
// Values/conditions come from web_traits.json + trait_descriptions.json;
// only traits with a modelled combat effect appear here. Anything else is
// reported in `unmodeled` so results stay honest about what was ignored.

// ctx for attack traits:
// { attacker, defender, kind, dirType, distance, emptyBetween, isNearest }
export const ATTACK_TRAITS = {
  // generic monster attack talent (red fist icons in the inspector)
  'Attack': { value: 0.25, applies: () => true },

  'Sniper': {
    value: 0.25,
    // "+25% when attacking targets at least 2 empty squares away."
    // With magic, only the nearest target benefits.
    applies: ctx => ctx.emptyBetween >= 2 && (ctx.kind !== 'magic' || ctx.isNearest),
  },
  'Blitz': {
    value: 0.25,
    applies: ctx => ctx.attacker.hp >= ctx.attacker.hpMax,
  },
  'Rune of Sea': {
    value: 0.25,
    applies: ctx => ctx.defender.color === 'red',
  },
  'Slay Dragon': {
    value: 0.5,
    applies: ctx =>
      ctx.defender.species === 'dragon' ||
      ctx.defender.species === 'dragonborn' ||
      ctx.defender.monsterClasses.includes('dragon'),
  },
  // "25% bonus to attacks when it is required to kill the target."
  // Activation depends on the damage total, so damage.js handles it;
  // listed here only so it is not reported as unmodeled.
  'Finishing Blow': { value: 0.25, special: 'finishing-blow' },
  // "+10% chance to deal a Critical Attack (double damage)."
  'Critical Attack': { crit: 0.1 },
};

// ctx for defense traits:
// { defender, attacker, kind, dirType }
// Each active trait is one 20% reduction (a factor of 0.8, stacking
// multiplicatively — spec 3.2's exponent A).
export const DEFENSE_TRAITS = {
  'Cardinal Parry': { applies: ctx => ctx.dirType === 'cardinal' },
  'Diagonal Parry': { applies: ctx => ctx.dirType === 'diagonal' },
  'Magic Parry': { applies: ctx => ctx.kind === 'magic' },
  'Resilient': { applies: ctx => ctx.defender.hp < ctx.defender.hpMax * 0.5 },
  'Resolute': { applies: ctx => ctx.defender.hp >= ctx.defender.hpMax },
};

// Traits the engine handles outside the damage formula (targeting, AI) —
// these are NOT reported as unmodeled.
const HANDLED_ELSEWHERE = new Set(['Ballistic', 'Taunt']);

// Sums activation-checked attack bonuses.
// Returns { sum, critChance, finishingBlows, unmodeled }.
export function attackTraitState(attacker, ctx) {
  let sum = 0;
  let critChance = 0;
  let finishingBlows = 0;
  const unmodeled = [];
  for (const name of attacker.traits) {
    const def = ATTACK_TRAITS[name];
    if (!def) {
      // Everything not modelled is surfaced, so results stay honest.
      // Pure status resistances/immunities are silenced (no damage impact).
      if (!DEFENSE_TRAITS[name] && !HANDLED_ELSEWHERE.has(name) &&
          !/Resistance|Immunity/.test(name) && !unmodeled.includes(name)) {
        unmodeled.push(name);
      }
      continue;
    }
    if (def.special === 'finishing-blow') { finishingBlows++; continue; }
    if (def.crit) { critChance += def.crit; continue; }
    if (def.applies(ctx)) sum += def.value;
  }
  return { sum, critChance: Math.min(critChance, 1), finishingBlows, unmodeled };
}

// Number of active 20%-reduction effects on the defender (exponent A in 3.2).
export function defenseReductionCount(defender, ctx) {
  let count = 0;
  for (const name of defender.traits) {
    const def = DEFENSE_TRAITS[name];
    if (def && def.applies(ctx)) count++;
  }
  return count;
}
