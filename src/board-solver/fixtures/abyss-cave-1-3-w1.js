// Test fixture: 심연의 동굴 1-3, wave 1 (spec 9).
// Monster stats are measured in-game (inspector screenshots, 2026-08-19).
// Heroes were identified from the board screenshot by portrait matching.
//
// Open assumptions (marked TODO):
// - ascension tiers of Squall/Serelune/Aquatic Agil/Radomyr (only Elysia's
//   4th-ascension frame is confirmed); asc3 (max in DB for the others) is used
// - no leader designated (leader multiplier 1)
// - shamans use the same melee-cross attack as the others; their Heal
//   talent is not modelled

import { makeBoard, TILE } from '../board.js';
import { makeUnit, adaptHero, findHeroInDb } from '../units.js';

const G = TILE.GROUND, W = TILE.WALL;

export function buildBoard() {
  return makeBoard([
    [W, W, G, G, W, W], // 1: ogre C1, troll D1
    [W, G, G, G, G, W], // 2: Squall B2, Serelune E2
    [G, G, G, G, G, G], // 3: shaman A3, shaman F3
    [G, G, G, G, G, G], // 4
    [W, G, G, G, G, W], // 5: Elysia B5, Aquatic Agil E5
    [W, W, G, G, W, W], // 6: Radomyr C6
  ]);
}

function monster(props) {
  return makeUnit({
    side: 'monster',
    color: 'red',
    attack: { kind: 'melee', dirs: 'cross' },
    ai: 'charge',
    ...props,
  });
}

export function buildUnits(heroesDb) {
  const hero = (name, opts) => adaptHero(findHeroInDb(heroesDb, name), opts);
  return [
    // team order = spec slot order H1..H5
    hero('Squall', { id: 'H1', pos: 'B2', tier: 'asc3' }),               // TODO tier
    hero('Serelune', { id: 'H2', pos: 'E2', tier: 'asc3', petSkill: 8 }), // TODO tier
    hero('Elysia', { id: 'H3', pos: 'B5', tier: 'asc4', petSkill: 25 }),  // asc4 frame confirmed
    hero('Aquatic Agil', { id: 'H4', pos: 'E5', tier: 'asc3' }),          // TODO tier
    hero('Radomyr', { id: 'H5', pos: 'C6', tier: 'asc3', petSkill: 8 }),  // TODO tier

    // classes/traits cross-checked against the wiki monster DB (monsters.json):
    // the inspector's fist icons are Mighty Blow, not generic attack talents,
    // and Troll's type is troll (33% DEF regen/turn), not goblinoid.
    monster({ id: 'troll', name: '트롤', pos: 'D1', atk: 32, hp: 114, def: 114, moveRange: 2, monsterClasses: ['troll'], traits: ['Mighty Blow', 'Mighty Blow'] }),
    monster({ id: 'ogre', name: '오거', pos: 'C1', atk: 18, hp: 89, def: 89, moveRange: 3, monsterClasses: ['goblinoid'], traits: ['Mighty Blow'] }),
    monster({ id: 'shaman-a', name: '오크 샤먼', pos: 'A3', atk: 5, hp: 69, def: 69, moveRange: 3, monsterClasses: ['goblinoid'], traits: ['Healer'] }),
    monster({ id: 'shaman-f', name: '오크 샤먼', pos: 'F3', atk: 5, hp: 69, def: 69, moveRange: 3, monsterClasses: ['goblinoid'], traits: ['Healer'] }),
  ];
}

export function buildFixture(heroesDb) {
  return { board: buildBoard(), units: buildUnits(heroesDb) };
}
