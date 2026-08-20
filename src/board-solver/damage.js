// Damage formulas (spec 3) with the two random factors handled analytically:
//   HeroBonus   ~ U(1.00, 1.25)   on every attack
//   SpeciesParry ~ U(0.80, 1.00)  only when the defender's species condition holds
// Results are intervals { min, expected, max } plus a kill probability.

import { colorMultiplier } from './rules.js';
import { attackTraitState, defenseReductionCount } from './traits.js';

export const HERO_BONUS = { min: 1.0, max: 1.25, mean: 1.125 };
export const SPECIES_PARRY = { min: 0.8, max: 1.0, mean: 0.9 };

// Species parry conditions (spec 3.2). Beastfolk has no known parry.
export function speciesParryApplies(defender, ctx) {
  switch (defender.species) {
    case 'human': return ctx.kind === 'melee';
    case 'elf': return ctx.kind === 'ranged';
    case 'dwarf': return ctx.kind === 'magic';
    case 'orc': return defender.hp >= defender.hpMax;
    case 'dragon':
    case 'dragonborn': return ctx.attacker.color === defender.color;
    default: return false;
  }
}

// Monster-class 50% reductions (exponent B in spec 3.2).
function monsterClassReductionCount(defender, ctx) {
  let count = 0;
  for (const cls of defender.monsterClasses) {
    if (cls === 'beast' && ctx.kind === 'melee') count++;
    if ((cls === 'skeleton' || cls === 'skeletal') && ctx.kind === 'ranged') count++;
    if (cls === 'clockwork' && ctx.kind === 'magic') count++;
    if ((cls === 'dragon' || cls === 'lizard') && ctx.dirType === 'diagonal') count++;
    if (cls === 'insect' && ctx.dirType === 'cardinal') count++;
  }
  return count;
}

// Goblinoid: +25% attack while the attacker is at full health.
function attackerClassMultiplier(attacker) {
  if (attacker.monsterClasses.includes('goblinoid') && attacker.hp >= attacker.hpMax) {
    return 1.25;
  }
  return 1;
}

// P(HB * SP >= t), numerically integrating over HB when SP applies.
function survivalOfMultiplier(t, spApplies) {
  if (t <= (spApplies ? HERO_BONUS.min * SPECIES_PARRY.min : HERO_BONUS.min)) return 1;
  if (!spApplies) {
    if (t >= HERO_BONUS.max) return 0;
    return (HERO_BONUS.max - t) / (HERO_BONUS.max - HERO_BONUS.min);
  }
  if (t >= HERO_BONUS.max * SPECIES_PARRY.max) return 0;
  const STEPS = 400;
  const width = HERO_BONUS.max - HERO_BONUS.min;
  let acc = 0;
  for (let i = 0; i < STEPS; i++) {
    const hb = HERO_BONUS.min + width * ((i + 0.5) / STEPS);
    const need = t / hb; // SP must be >= need
    let p;
    if (need <= SPECIES_PARRY.min) p = 1;
    else if (need >= SPECIES_PARRY.max) p = 0;
    else p = (SPECIES_PARRY.max - need) / (SPECIES_PARRY.max - SPECIES_PARRY.min);
    acc += p;
  }
  return acc / STEPS;
}

// P(final damage >= hp) for deterministic part `det`.
export function killProbability(det, hp, { spApplies = false, critChance = 0 } = {}) {
  if (det <= 0) return 0;
  const q = t => survivalOfMultiplier(t, spApplies);
  const t = hp / det;
  return (1 - critChance) * q(t) + critChance * q(t / 2);
}

// One attacker-target interaction.
// ctx: { target, dirType, distance, emptyBetween, isNearest } from resolveTargets
// opts: { kind, leader }
// Returns { min, expected, max, killProb, traitSum, finishingBlowsUsed, unmodeled }.
export function computeAttack(attacker, ctx, { kind, leader = 1 } = {}) {
  const defender = ctx.target;
  const tctx = {
    attacker,
    defender,
    kind,
    dirType: ctx.dirType,
    distance: ctx.distance,
    emptyBetween: ctx.emptyBetween,
    isNearest: ctx.isNearest,
  };

  // Ghost: every hit deals exactly 1 damage.
  if (defender.monsterClasses.includes('ghost')) {
    return {
      min: 1, expected: 1, max: 1,
      killProb: defender.hp <= 1 ? 1 : 0,
      traitSum: 0, finishingBlowsUsed: 0, unmodeled: [],
    };
  }

  const { sum, critChance, finishingBlows, unmodeled } = attackTraitState(attacker, tctx);
  const colorMult = colorMultiplier(attacker.color, defender.color);
  const classMult = attackerClassMultiplier(attacker);
  const A = defenseReductionCount(defender, tctx);
  const B = monsterClassReductionCount(defender, tctx);
  const spApplies = speciesParryApplies(defender, tctx);
  const reduction = Math.pow(0.8, A) * Math.pow(0.5, B);

  const detFor = extra =>
    attacker.atk * leader * (1 + sum + extra) * colorMult * classMult * reduction;

  // Finishing Blow: "+25% when it is required to kill the target".
  // Use the smallest number of Finishing Blows whose expected damage kills;
  // if even all of them cannot kill (in expectation), none activate.
  const expectedOf = det =>
    det * HERO_BONUS.mean * (spApplies ? SPECIES_PARRY.mean : 1) * (1 + critChance);
  let fbUsed = 0;
  if (finishingBlows > 0 && expectedOf(detFor(0)) < defender.hp) {
    for (let k = 1; k <= finishingBlows; k++) {
      if (expectedOf(detFor(0.25 * k)) >= defender.hp) { fbUsed = k; break; }
    }
  }

  const det = detFor(0.25 * fbUsed);
  return {
    min: det * HERO_BONUS.min * (spApplies ? SPECIES_PARRY.min : 1),
    expected: expectedOf(det),
    max: det * HERO_BONUS.max, // crit excluded from max; see critChance
    killProb: killProbability(det, defender.hp, { spApplies, critChance }),
    critChance,
    traitSum: sum + 0.25 * fbUsed,
    finishingBlowsUsed: fbUsed,
    unmodeled,
  };
}
