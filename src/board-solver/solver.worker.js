// Web Worker wrapper: keeps the search off the UI thread.
// Usage: new Worker('src/board-solver/solver.worker.js', { type: 'module' })
// postMessage({ board, units, opts, mode }) -> { ok, mode, result | error }
// mode: 'solve' (single turn, default) | 'plan' (multi-turn beam search)

import { solve } from './solver.js';
import { plan } from './planner.js';

self.onmessage = e => {
  const { board, units, opts, mode = 'solve' } = e.data;
  try {
    const result = mode === 'plan'
      ? plan(board, units, opts)
      : solve(board, units, opts);
    self.postMessage({ ok: true, mode, result });
  } catch (err) {
    self.postMessage({ ok: false, mode, error: String(err?.message ?? err) });
  }
};
