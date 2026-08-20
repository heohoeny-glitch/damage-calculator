// Web Worker wrapper: keeps the search off the UI thread.
// Usage: new Worker('src/board-solver/solver.worker.js', { type: 'module' })
// postMessage({ board, units, opts }) -> { ok, result | error }

import { solve } from './solver.js';

self.onmessage = e => {
  const { board, units, opts } = e.data;
  try {
    const result = solve(board, units, opts);
    self.postMessage({ ok: true, result });
  } catch (err) {
    self.postMessage({ ok: false, error: String(err?.message ?? err) });
  }
};
