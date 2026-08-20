// Unit factory and adapter for the existing heroes.json DB.
// The DB is read-only: adaptHero() maps its fields onto the solver's
// Unit shape without modifying the source objects.

import { parsePos } from './board.js';

export function makeUnit(props) {
  const u = {
    id: props.id,
    side: props.side,                 // 'hero' | 'monster'
    name: props.name ?? props.id,
    r: props.r,
    c: props.c,
    color: props.color ?? null,       // 'red'|'blue'|'green'|'light'|'dark'
    species: props.species ?? null,   // lowercase, e.g. 'elf', 'beastfolk'
    monsterClasses: props.monsterClasses ?? [],
    atk: props.atk,
    hp: props.hp,
    hpMax: props.hpMax ?? props.hp,
    def: props.def ?? 0,
    heroClass: props.heroClass ?? null,
    traits: props.traits ?? [],
    isLeader: props.isLeader ?? false,
    petSkill: props.petSkill ?? null,
    moveRange: props.moveRange ?? 0,
    ai: props.ai ?? null,
    size: props.size ?? 1,
    // Monsters carry their pattern explicitly; heroes derive it from class.
    attack: props.attack ?? null,     // {kind:'melee'|'ranged'|'magic', dirs:'cross'|'all8'}
  };
  if (props.pos) {
    const { r, c } = parsePos(props.pos);
    u.r = r;
    u.c = c;
  }
  if (u.r == null || u.c == null) throw new Error(`unit ${u.id} has no position`);
  if (!['hero', 'monster'].includes(u.side)) throw new Error(`unit ${u.id}: bad side`);
  if (!(u.atk >= 0) || !(u.hp > 0)) throw new Error(`unit ${u.id}: bad stats`);
  return u;
}

// dbEntry: one element of heroes.json.
// tier: 'basic' | 'asc' | 'asc2' | 'asc3' | 'asc4' (stat + talent tier).
// Talents: basic tier uses `basic` only; any ascension tier adds `ascension`.
// Merge talents are only included when includeMerge is set (merge level data
// is not in the DB, so the caller must know).
export function adaptHero(dbEntry, { id, pos, tier = 'basic', isLeader = false, includeMerge = false, petSkill = null, overrides = {} }) {
  const stats = dbEntry.stats?.[tier];
  if (!stats || !stats.attack) {
    throw new Error(`hero ${dbEntry.name}: no stats for tier '${tier}'`);
  }
  const traits = tier === 'basic'
    ? [...(dbEntry.basic ?? [])]
    : [...(dbEntry.basic ?? []), ...(dbEntry.ascension ?? [])];
  if (includeMerge) traits.push(...(dbEntry.merge ?? []));

  return makeUnit({
    id: id ?? dbEntry.name,
    side: 'hero',
    name: dbEntry.name,
    pos,
    color: (dbEntry.color ?? '').toLowerCase() || null,
    species: (dbEntry.species ?? '').toLowerCase() || null,
    atk: stats.attack.total ?? stats.attack,
    hp: stats.health.total ?? stats.health,
    heroClass: dbEntry.class,
    traits,
    isLeader,
    petSkill,
    ...overrides,
  });
}

export function cloneUnits(units) {
  return units.map(u => ({ ...u, traits: [...u.traits], monsterClasses: [...u.monsterClasses] }));
}

export function unitAt(units, r, c) {
  return units.find(u => u.hp > 0 && u.r === r && u.c === c) ?? null;
}

export function heroesOf(units) {
  return units.filter(u => u.side === 'hero' && u.hp > 0);
}

export function monstersOf(units) {
  return units.filter(u => u.side === 'monster' && u.hp > 0);
}

// Monster stats scale linearly with level: stat(L) = c * (L + 8.15).
// Derived from four in-game level-4 measurements vs the wiki's level-100
// table (Troll/Ogre/Orc Shaman/Goblin all fit x = 8.0~8.19; HP matches
// exactly, ATK within +-1). Treat results as estimates, not gospel.
const LEVEL_OFFSET = 8.15;

export function estimateMonsterStat(refStat, level, refLevel = 100) {
  return Math.round(refStat * (level + LEVEL_OFFSET) / (refLevel + LEVEL_OFFSET));
}

export function findHeroInDb(heroesDb, name) {
  const hit = heroesDb.find(h => h.name === name || h.name_kr === name);
  if (!hit) throw new Error(`hero not found in DB: ${name}`);
  return hit;
}
