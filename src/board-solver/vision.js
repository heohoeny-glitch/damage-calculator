// Screenshot recognition (spec 12): given a battle screenshot and the 6x6
// grid rectangle, classify every cell (wall / ground / hero / monster) and
// identify heroes by template-matching against the team's portraits.
// Pure Canvas pixel work — no server, no ML.

// Default grid guess, tuned on 1080x2340 captures: the board spans ~94% of
// the width and its VERTICAL CENTER sits at ~55.1% of the screen regardless
// of row count (verified on a 6-row and an 8-row stage). Cells are square,
// so rect height follows the row/col ratio. refineRect + manual handles
// correct the rest.
export function defaultRect(imgW, imgH, cols = 6, rows = 6) {
  const w = imgW * 0.945;
  const h = w * (rows / cols);
  return { x: imgW * 0.028, y: imgH * 0.5513 - h / 2, w, h };
}

export function cellRect(rect, r, c, cols = 6, rows = 6) {
  const w = rect.w / cols, h = rect.h / rows;
  return { x: rect.x + c * w, y: rect.y + r * h, w, h };
}

function hsv(r, g, b) {
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const v = max / 255;
  const s = max === 0 ? 0 : (max - min) / max;
  let h = 0;
  if (max !== min) {
    if (max === r) h = 60 * (((g - b) / (max - min)) % 6);
    else if (max === g) h = 60 * ((b - r) / (max - min) + 2);
    else h = 60 * ((r - g) / (max - min) + 4);
  }
  return { h: (h + 360) % 360, s, v };
}

const isGreen = p => p.h >= 95 && p.h <= 175 && p.s > 0.3 && p.v > 0.2;
const isRed = p => (p.h <= 18 || p.h >= 345) && p.s > 0.5 && p.v > 0.35;
// hero frames are bright saturated blue; the stone floor is also bluish but
// much darker and duller — keep this strict or empty tiles read as heroes
const isBlue = p => p.h >= 195 && p.h <= 250 && p.s > 0.5 && p.v > 0.55;
// hero HP bars are bright lime green — a different hue band than the
// teal-green crystal walls. Frame colors vary with hero grade (blue, pink,
// gold...), so the HP bar is the frame-independent hero signal.
const isHpGreen = p => p.h >= 70 && p.h <= 140 && p.s > 0.45 && p.v > 0.5;

// Color fractions over a region; `ring` restricts to the outer band of the
// cell where unit frames live (portraits in the middle can be any color —
// green orc skin must not read as a wall).
function fractions(ctx, x, y, w, h, ring = 0) {
  const data = ctx.getImageData(Math.round(x), Math.round(y), Math.max(1, Math.round(w)), Math.max(1, Math.round(h)));
  const { width, height } = data;
  const inX0 = width * ring, inX1 = width * (1 - ring);
  const inY0 = height * ring, inY1 = height * (1 - ring);
  let green = 0, red = 0, blue = 0, hp = 0, n = 0;
  for (let py = 0; py < height; py += 2) {
    for (let px = 0; px < width; px += 2) {
      if (ring > 0 && px > inX0 && px < inX1 && py > inY0 && py < inY1) continue;
      const i = (py * width + px) * 4;
      const p = hsv(data.data[i], data.data[i + 1], data.data[i + 2]);
      if (isGreen(p)) green++;
      if (isRed(p)) red++;
      if (isBlue(p)) blue++;
      if (isHpGreen(p)) hp++;
      n++;
    }
  }
  return { green: green / n, red: red / n, blue: blue / n, hp: hp / n };
}

// Snap the user-placed grid onto the board: tile gaps are dark seams, so
// the correct grid minimizes brightness along the internal grid lines.
// This anchors both axes sharply (HP-bar-based scoring had a wide plateau
// in x and converged a few pixels off, which flipped template matching).
export function refineRect(ctx, rect, cols = 6, rows = 6) {
  const canvas = ctx.canvas;

  function lineBrightness(cand) {
    let sum = 0, n = 0;
    const sample = (x, y, w, h) => {
      x = Math.max(0, Math.round(x));
      y = Math.max(0, Math.round(y));
      w = Math.min(Math.round(w), canvas.width - x);
      h = Math.min(Math.round(h), canvas.height - y);
      if (w < 1 || h < 1) { sum += 255 * 50; n += 50; return; } // off-canvas: bad
      const d = ctx.getImageData(x, y, w, h).data;
      for (let i = 0; i < d.length; i += 16) { // stride 4 px
        sum += Math.max(d[i], d[i + 1], d[i + 2]);
        n++;
      }
    };
    for (let i = 1; i < cols; i++) {
      sample(cand.x + (cand.w / cols) * i - 1.5, cand.y, 3, cand.h);
    }
    for (let i = 1; i < rows; i++) {
      sample(cand.x, cand.y + (cand.h / rows) * i - 1.5, cand.w, 3);
    }
    return sum / n;
  }

  let best = { ...rect };
  const sweep = (axis, range, step) => {
    const cell = axis === 'y' ? best.h / rows : best.w / cols;
    let top = { ...best }, topScore = Infinity;
    for (let d = -range; d <= range + 1e-9; d += step) {
      const cand = { ...best, [axis]: best[axis] + d * cell };
      const s = lineBrightness(cand);
      if (s < topScore) { topScore = s; top = cand; }
    }
    best = top;
  };
  sweep('y', 0.35, 0.05);
  sweep('x', 0.35, 0.05);
  sweep('y', 0.06, 0.015); // fine passes
  sweep('x', 0.06, 0.015);
  return best;
}

// -> rows x cols array of { type: 'wall'|'ground'|'hero'|'monster', ... }
export function classifyCells(ctx, rect, cols = 6, rows = 6) {
  const out = [];
  for (let r = 0; r < rows; r++) {
    const row = [];
    for (let c = 0; c < cols; c++) {
      const cr = cellRect(rect, r, c, cols, rows);
      // frame band: outer 26% ring, slightly inset to skip tile gaps
      const inset = 0.05;
      const ring = fractions(ctx,
        cr.x + cr.w * inset, cr.y + cr.h * inset,
        cr.w * (1 - 2 * inset), cr.h * (1 - 2 * inset), 0.26);
      const full = fractions(ctx, cr.x, cr.y, cr.w, cr.h);
      // HP-bar strip only (buff badges sit below it — keep them out)
      const band = fractions(ctx,
        cr.x + cr.w * 0.12, cr.y + cr.h * 0.58,
        cr.w * 0.76, cr.h * 0.20);

      // Side is decided by HP-bar color: heroes have lime-green bars,
      // enemies red bars. Frame colors are NOT reliable — enemies can have
      // blue frames and heroes pink/gold ones (Black Castle 2-5H evidence).
      // Frame color is only a fallback for a slightly misaligned grid.
      let type = 'ground';
      const bar = 0.05;
      // walls first: crystal highlights can leak into the HP-bar hue band.
      // Sparse crystal clusters barely clear ~0.25, so keep thresholds low;
      // units are caught earlier only when a bar is present, and bare floor
      // has almost no saturated green.
      if (ring.green > 0.24 && full.green > 0.24) type = 'wall';
      else if (band.hp > bar && band.hp >= band.red) type = 'hero';
      else if (band.red > bar) type = 'monster';
      else if (ring.blue > 0.08 && ring.blue > ring.red) type = 'hero';
      else if (ring.red > 0.08) type = 'monster';
      else if (full.green > 0.28) type = 'wall';
      row.push({ type, ring, band, green: full.green });
    }
    out.push(row);
  }
  return out;
}

// Downscaled RGB signature of a region, for template matching.
const SIG = 16;
function signature(ctx, x, y, w, h) {
  const off = new OffscreenCanvas(SIG, SIG);
  const octx = off.getContext('2d');
  octx.drawImage(ctx.canvas, x, y, w, h, 0, 0, SIG, SIG);
  return octx.getImageData(0, 0, SIG, SIG).data;
}

function signatureOfImage(img) {
  const off = new OffscreenCanvas(SIG, SIG);
  const octx = off.getContext('2d');
  // portraits are square head shots; use the middle 84%
  const m = 0.08;
  octx.drawImage(img, img.width * m, img.height * m, img.width * (1 - 2 * m), img.height * (1 - 2 * m), 0, 0, SIG, SIG);
  return octx.getImageData(0, 0, SIG, SIG).data;
}

function distance(a, b) {
  let d = 0;
  for (let i = 0; i < a.length; i += 4) {
    d += Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]);
  }
  return d / (a.length / 4);
}

// portrait area of a unit tile: trim the frame and the HP-bar strip
function cellSignature(ctx, rect, r, c, cols, rows) {
  const cr = cellRect(rect, r, c, cols, rows);
  return signature(ctx,
    cr.x + cr.w * 0.20, cr.y + cr.h * 0.10,
    cr.w * 0.60, cr.h * 0.62);
}

// heroCells: [{r, c}]; candidates: [{id, img}] (img: loaded HTMLImageElement).
// Greedy one-to-one assignment by best match score.
// Returns [{r, c, candidateId, score}].
export function matchHeroes(ctx, rect, heroCells, candidates, cols = 6, rows = 6) {
  const cellSigs = heroCells.map(({ r, c }) => cellSignature(ctx, rect, r, c, cols, rows));
  const candSigs = candidates.map(c => signatureOfImage(c.img));

  const pairs = [];
  for (let i = 0; i < heroCells.length; i++) {
    for (let j = 0; j < candidates.length; j++) {
      pairs.push({ i, j, d: distance(cellSigs[i], candSigs[j]) });
    }
  }
  pairs.sort((a, b) => a.d - b.d);
  const usedCell = new Set(), usedCand = new Set(), out = [];
  for (const p of pairs) {
    if (usedCell.has(p.i) || usedCand.has(p.j)) continue;
    usedCell.add(p.i);
    usedCand.add(p.j);
    out.push({ ...heroCells[p.i], candidateId: candidates[p.j].id, score: p.d });
  }
  return out;
}

// Palette histogram: 12 hue bins + bright-grey/white + dark. Hue separates
// differently-coloured art (Orc Mage green vs Winter Knight ice); the two
// achromatic bins separate same-hue art by tone (Ogre's green face vs the
// Orc Shaman's grey wolf pelt).
function hueHistogram(source, sx, sy, sw, sh) {
  const off = new OffscreenCanvas(24, 24);
  const octx = off.getContext('2d');
  octx.drawImage(source, sx, sy, sw, sh, 0, 0, 24, 24);
  const d = octx.getImageData(0, 0, 24, 24).data;
  const hist = new Array(14).fill(0);
  let n = 0;
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i], g = d[i + 1], b = d[i + 2];
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    n++;
    if (max < 60) { hist[13]++; continue; }             // dark
    if ((max - min) / max < 0.25) { hist[12]++; continue; } // grey/white
    let h = 0;
    if (max === r) h = 60 * (((g - b) / (max - min)) % 6);
    else if (max === g) h = 60 * ((b - r) / (max - min) + 2);
    else h = 60 * ((r - g) / (max - min) + 4);
    hist[Math.floor(((h + 360) % 360) / 30)]++;
  }
  return hist.map(v => (n ? v / n : 0));
}

const histDistance = (a, b) => a.reduce((s, v, i) => s + Math.abs(v - b[i]), 0);

// Per-cell nearest template, reuse allowed — for monsters, where the same
// type occupies many cells. Score = hue-palette distance (dominant) +
// positional signature (tie-breaker for same-palette types).
// Returns [{r, c, templateId, score}].
export function matchCells(ctx, rect, cells, templates, cols = 6, rows = 6) {
  const m = 0.08;
  const tSigs = templates.map(t => ({
    sig: signatureOfImage(t.img),
    hist: hueHistogram(t.img,
      t.img.width * m, t.img.height * m,
      t.img.width * (1 - 2 * m), t.img.height * (1 - 2 * m)),
  }));
  return cells.map(({ r, c }) => {
    const cr = cellRect(rect, r, c, cols, rows);
    const sig = cellSignature(ctx, rect, r, c, cols, rows);
    // central crop: tolerant to slight grid offset (neighbouring crystal
    // green bleeding in flips Winter Knight cells to Orc Mage)
    const hist = hueHistogram(ctx.canvas,
      cr.x + cr.w * 0.26, cr.y + cr.h * 0.16, cr.w * 0.48, cr.h * 0.46);
    let best = null, bd = Infinity;
    tSigs.forEach((t, j) => {
      const d = histDistance(hist, t.hist) + distance(sig, t.sig) / 255;
      if (d < bd) { bd = d; best = templates[j].id; }
    });
    return { r, c, templateId: best, score: bd };
  });
}
