// Board: tile definitions, A1 <-> [r,c] conversion, walkability.
// Coordinates: columns A.. (left to right), rows 1.. (top to bottom).
// Internally rows/cols are 0-indexed: A1 = {r:0, c:0}.
// Board size varies by dungeon; anything up to 12x12 is supported.

export const TILE = {
  GROUND: 'ground',
  RUBBLE: 'rubble',
  WALL: 'wall',
  WATER: 'water',
  LAVA: 'lava',
};

export const CARDINALS = [[-1, 0], [1, 0], [0, -1], [0, 1]];
export const DIAGONALS = [[-1, -1], [-1, 1], [1, -1], [1, 1]];
export const ALL8 = [...CARDINALS, ...DIAGONALS];

const COL_LETTERS = 'ABCDEFGHIJKL';

export function parsePos(pos) {
  const c = COL_LETTERS.indexOf(pos[0].toUpperCase());
  const r = parseInt(pos.slice(1), 10) - 1;
  if (c < 0 || Number.isNaN(r)) throw new Error(`bad position: ${pos}`);
  return { r, c };
}

export function toPos(r, c) {
  return `${COL_LETTERS[c]}${r + 1}`;
}

// rows: array of arrays of TILE values, row 0 = top.
export function makeBoard(rows) {
  const height = rows.length;
  const width = rows[0].length;
  for (const row of rows) {
    if (row.length !== width) throw new Error('ragged board');
    for (const t of row) {
      if (!Object.values(TILE).includes(t)) throw new Error(`bad tile: ${t}`);
    }
  }
  return { width, height, tiles: rows };
}

export function inBounds(board, r, c) {
  return r >= 0 && r < board.height && c >= 0 && c < board.width;
}

export function tileAt(board, r, c) {
  return board.tiles[r][c];
}

// A unit can stand on / be dragged through this tile.
// Water and lava are enterable (with penalties handled elsewhere);
// rubble and wall are not.
export function isWalkable(board, r, c) {
  if (!inBounds(board, r, c)) return false;
  const t = tileAt(board, r, c);
  return t === TILE.GROUND || t === TILE.WATER || t === TILE.LAVA;
}

// Does this tile stop ranged/magic projectiles?
// Assumption (spec 2.5): only walls block attacks; rubble blocks movement
// but lets attacks through. Revisit if in-game evidence contradicts.
export function blocksProjectile(board, r, c) {
  return tileAt(board, r, c) === TILE.WALL;
}

export function isCardinalDir(dr, dc) {
  return dr === 0 || dc === 0;
}
