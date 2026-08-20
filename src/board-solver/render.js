// SVG board renderer: grid, units, drag-path arrows (spec 8).

import { parsePos } from './board.js';

const CELL = 56;
const GAP = 4;
const RAIL = 22;
const STEP = CELL + GAP;

const TILE_FILL = {
  ground: '#2e4d63',
  rubble: '#5a5248',
  wall: '#1c7a5c',
  water: '#1f5f8f',
  lava: '#8f3a1f',
};

const PATH_COLORS = ['#ffd166', '#06d6a0', '#ef476f', '#118ab2', '#f78c6b', '#c792ea'];

const SVG_NS = 'http://www.w3.org/2000/svg';

function el(name, attrs = {}, text = null) {
  const node = document.createElementNS(SVG_NS, name);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  if (text != null) node.textContent = text;
  return node;
}

function cellCenter(r, c) {
  return { x: RAIL + c * STEP + CELL / 2, y: RAIL + r * STEP + CELL / 2 };
}

export function boardPixelSize(board) {
  return {
    width: RAIL + board.width * STEP - GAP + 2,
    height: RAIL + board.height * STEP - GAP + 2,
  };
}

// Draws the full board into `svg` (cleared first).
// opts.onCellClick(r, c) — editor hook.
export function drawBoard(svg, board, units, opts = {}) {
  const { width, height } = boardPixelSize(board);
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.innerHTML = '';

  // arrowhead marker
  const defs = el('defs');
  for (let i = 0; i < PATH_COLORS.length; i++) {
    const marker = el('marker', {
      id: `bs-arrow-${i}`, viewBox: '0 0 10 10', refX: 8, refY: 5,
      markerWidth: 5, markerHeight: 5, orient: 'auto-start-reverse',
    });
    marker.appendChild(el('path', { d: 'M 0 0 L 10 5 L 0 10 z', fill: PATH_COLORS[i] }));
    defs.appendChild(marker);
  }
  svg.appendChild(defs);

  // coordinate rails
  for (let c = 0; c < board.width; c++) {
    const { x } = cellCenter(0, c);
    svg.appendChild(el('text', { x, y: RAIL - 8, class: 'bs-rail' }, String.fromCharCode(65 + c)));
  }
  for (let r = 0; r < board.height; r++) {
    const { y } = cellCenter(r, 0);
    svg.appendChild(el('text', { x: RAIL - 10, y: y + 4, class: 'bs-rail' }, String(r + 1)));
  }

  // tiles
  const tileLayer = el('g');
  for (let r = 0; r < board.height; r++) {
    for (let c = 0; c < board.width; c++) {
      const tile = board.tiles[r][c];
      const rect = el('rect', {
        x: RAIL + c * STEP, y: RAIL + r * STEP,
        width: CELL, height: CELL, rx: 6,
        fill: TILE_FILL[tile] ?? '#333',
        class: `bs-tile bs-tile-${tile}`,
        'data-r': r, 'data-c': c,
      });
      if (opts.onCellClick) {
        rect.style.cursor = 'pointer';
        rect.addEventListener('click', () => opts.onCellClick(r, c));
      }
      tileLayer.appendChild(rect);
    }
  }
  svg.appendChild(tileLayer);

  // units
  const unitLayer = el('g');
  for (const u of units) {
    if (u.hp <= 0) continue;
    const { x, y } = cellCenter(u.r, u.c);
    const isHero = u.side === 'hero';
    const g = el('g', { class: 'bs-unit', 'data-id': u.id });
    g.appendChild(el('rect', {
      x: x - CELL / 2 + 4, y: y - CELL / 2 + 4,
      width: CELL - 8, height: CELL - 8, rx: 5,
      fill: isHero ? '#173355' : '#4a1614',
      stroke: isHero ? '#4d94ff' : '#e2503f',
      'stroke-width': 1.5,
    }));
    g.appendChild(el('text', { x, y: y - 2, class: 'bs-unit-name' },
      (u.name ?? u.id).slice(0, 6)));
    g.appendChild(el('text', { x, y: y + 12, class: 'bs-unit-stat' },
      `${Math.round(u.atk)}/${Math.round(u.hp)}`));
    if (opts.onCellClick) {
      g.style.cursor = 'pointer';
      g.addEventListener('click', () => opts.onCellClick(u.r, u.c));
    }
    unitLayer.appendChild(g);
  }
  svg.appendChild(unitLayer);

  // overlay layer for paths (kept last so arrows sit on top)
  svg.appendChild(el('g', { class: 'bs-path-layer' }));
}

// Draws drag paths onto the board's overlay layer.
// drags: [{ heroId, path: ['B5','C4',...], swaps: [false,...] }]
// Order badges: the i-th drag is labelled i+1 at its start cell; every
// waypoint gets a small step number; swap cells get a ⇄ marker.
export function drawPaths(svg, drags, { animate = false } = {}) {
  const layer = svg.querySelector('.bs-path-layer');
  if (!layer) return;
  layer.innerHTML = '';

  // Step badges on the same cell (revisits, crossing drags) rotate through
  // corners so earlier numbers stay visible.
  const BADGE_SPOTS = [[14, -14], [-14, 14], [-14, -14], [14, 14], [0, -21], [0, 21]];
  const badgeCount = new Map(); // cell pos -> badges placed so far

  drags.forEach((drag, di) => {
    const color = PATH_COLORS[di % PATH_COLORS.length];
    const pts = drag.path.map(pos => {
      const { r, c } = parsePos(pos);
      return cellCenter(r, c);
    });
    // slight per-drag offset so overlapping paths stay distinguishable
    const off = (di - (drags.length - 1) / 2) * 5;
    const ptStr = pts.map(p => `${p.x + off},${p.y + off}`).join(' ');

    const line = el('polyline', {
      points: ptStr, fill: 'none', stroke: color,
      'stroke-width': 3.5, 'stroke-linejoin': 'round', 'stroke-linecap': 'round',
      'marker-end': `url(#bs-arrow-${di % PATH_COLORS.length})`,
      opacity: 0.9,
    });
    layer.appendChild(line);

    // drag-order badge at start
    const s = pts[0];
    layer.appendChild(el('circle', { cx: s.x + off, cy: s.y + off, r: 10, fill: color }));
    layer.appendChild(el('text', {
      x: s.x + off, y: s.y + off + 4, class: 'bs-badge-big',
    }, String(di + 1)));

    // step numbers + swap markers along the way
    for (let i = 1; i < pts.length; i++) {
      const p = pts[i];
      const cell = drag.path[i];
      const n = badgeCount.get(cell) ?? 0;
      badgeCount.set(cell, n + 1);
      const [bx, by] = BADGE_SPOTS[n % BADGE_SPOTS.length];
      layer.appendChild(el('circle', {
        cx: p.x + off + bx, cy: p.y + off + by, r: 8,
        fill: '#0b1620', stroke: color, 'stroke-width': 1.5,
      }));
      layer.appendChild(el('text', {
        x: p.x + off + bx, y: p.y + off + by + 3.5, class: 'bs-badge', fill: color,
      }, String(i)));
      if (drag.swaps && drag.swaps[i]) {
        layer.appendChild(el('text', {
          x: p.x + off, y: p.y + off + 4, class: 'bs-swap',
        }, '⇄'));
      }
    }

    if (animate && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      const dot = el('circle', { r: 7, fill: color, opacity: 0.95 });
      layer.appendChild(dot);
      const total = line.getTotalLength();
      const t0 = performance.now();
      const durMs = 400 * (pts.length - 1) + 300;
      const tick = now => {
        const t = Math.min(1, (now - t0) / durMs);
        const p = line.getPointAtLength(total * t);
        dot.setAttribute('cx', p.x);
        dot.setAttribute('cy', p.y);
        if (t < 1) requestAnimationFrame(tick);
        else dot.remove();
      };
      requestAnimationFrame(tick);
    }
  });
}

export { PATH_COLORS };
