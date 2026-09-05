// Klondike solvability check. Reuses logic.js's own newGame/draw/move/
// legalDestinations as the search's step function — never reimplements the
// rules separately — so a found solution is a real, mechanical proof: the
// exact same move sequence replayed in the live (hidden-info) game produces
// the same result, since draws/moves never depend on knowing anything not
// already fixed by the deck order. This is what backs the daily challenge's
// "always has a winning solution" guarantee (server.js's ensureDailySeed
// tries candidate seeds against solve() until one comes back solvable).
//
// The deal is treated as fully known up front (all cards' identities are
// already fixed by the seed) rather than genuinely hidden — a solution found
// this way is sometimes called "Thoughtful Solitaire" solvability. With
// draw-1 and unlimited stock recycling (this app's rules), most deals are
// solvable under this model.
//
// Search is greedy best-first (a bucket priority queue, not plain DFS) over
// a "cards home, then cards revealed" score — this matters a lot more than
// it sounds: plain depth-first backtracking tends to sink the entire time
// budget into one deep unproductive branch before ever trying an
// alternative, where best-first always expands whichever *reachable* state
// looks most promising next, regardless of how it was reached. It also gives
// a real proof of unsolvability (not just "gave up"): if the frontier empties
// out before the budget runs out, every reachable state was visited and none
// of them won.

import {
  newGame, draw, move, legalDestinations, SUITS,
} from './logic.js';

function cloneCard(c) {
  return { rank: c.rank, suit: c.suit, faceUp: c.faceUp };
}
function cloneState(state) {
  return {
    phase: state.phase,
    mode: state.mode,
    seed: state.seed,
    tableau: state.tableau.map((col) => col.map(cloneCard)),
    foundations: { ...state.foundations },
    stock: state.stock.map(cloneCard),
    waste: state.waste.map(cloneCard),
    moves: state.moves,
    cardsHome: state.cardsHome,
    won: state.won,
  };
}

// Canonical string encoding of the full board — the visited-set this keys
// is what makes an emptied frontier a real proof of unsolvability, and what
// stops unlimited stock recycling from being explored forever.
function stateKey(state) {
  const t = state.tableau
    .map((col) => col.map((c) => (c.faceUp ? `${c.rank}${c.suit}` : '?')).join(','))
    .join('|');
  const f = SUITS.map((s) => state.foundations[s]).join(',');
  const st = state.stock.map((c) => `${c.rank}${c.suit}`).join(',');
  const w = state.waste.map((c) => `${c.rank}${c.suit}`).join(',');
  return `${t}#${f}#${st}#${w}`;
}

function candidateMoves(state) {
  const moves = [];

  if (state.waste.length) {
    const src = { pile: 'waste' };
    let dests;
    try { dests = legalDestinations(state, src); } catch { dests = []; }
    for (const dest of dests) moves.push({ src, dest });
  }

  state.tableau.forEach((col, ci) => {
    for (let i = 0; i < col.length; i++) {
      if (!col[i].faceUp) continue;
      const src = { pile: 'tableau', col: ci, index: i };
      let dests;
      try { dests = legalDestinations(state, src); } catch { continue; }
      for (const dest of dests) {
        if (dest.pile === 'tableau' && dest.col === ci) continue;
        moves.push({ src, dest });
      }
    }
  });

  SUITS.forEach((suit) => {
    if (!state.foundations[suit]) return;
    const src = { pile: 'foundation', suit };
    let dests;
    try { dests = legalDestinations(state, src); } catch { dests = []; }
    for (const dest of dests) {
      if (dest.pile === 'tableau') moves.push({ src, dest });
    }
  });

  return moves;
}

// Higher is more promising. Cards home dominates; cards revealed (face-up)
// is the tiebreaker among states with the same foundation progress.
const MAX_SCORE = 52 * 1000 + 52 * 10;
function heuristic(state) {
  let faceUp = 0;
  for (const col of state.tableau) {
    for (const c of col) if (c.faceUp) faceUp += 1;
  }
  return state.cardsHome * 1000 + faceUp * 10;
}

// A bucket queue: scores are small bounded integers (0..MAX_SCORE), so this
// is a plain array of stacks indexed by score, O(1) amortized push/pop —
// much cheaper than a general heap at this scale, and simple to get right.
class BucketQueue {
  constructor(maxScore) {
    this.buckets = new Array(maxScore + 1);
    this.top = -1;
    this.size = 0;
  }
  push(score, item) {
    (this.buckets[score] ??= []).push(item);
    if (score > this.top) this.top = score;
    this.size += 1;
  }
  pop() {
    while (this.top >= 0 && (!this.buckets[this.top] || this.buckets[this.top].length === 0)) this.top -= 1;
    if (this.top < 0) return undefined;
    this.size -= 1;
    return this.buckets[this.top].pop();
  }
}

// Core search, taking an already-built state rather than a seed — exported
// separately so tests can hand-build tiny scenarios (same technique used in
// logic.test.js) instead of only ever solving full 52-card deals.
export async function solveState(initial, { maxStates = 500000, maxMs = 8000, yieldEvery = 1000 } = {}) {
  const start = Date.now();
  const visited = new Set([stateKey(initial)]);
  const queue = new BucketQueue(MAX_SCORE);
  queue.push(heuristic(initial), initial);
  let explored = 0;

  while (queue.size > 0) {
    if (explored >= maxStates || Date.now() - start > maxMs) {
      return {
        solvable: false, statesExplored: explored, elapsedMs: Date.now() - start, timedOut: true,
      };
    }

    const state = queue.pop();
    explored += 1;
    if (state.cardsHome === 52) {
      return {
        solvable: true, statesExplored: explored, elapsedMs: Date.now() - start, timedOut: false,
      };
    }
    if (explored % yieldEvery === 0) await new Promise((resolve) => { setImmediate(resolve); });

    for (const { src, dest } of candidateMoves(state)) {
      const next = cloneState(state);
      try { move(next, src, dest); } catch { continue; }
      const key = stateKey(next);
      if (visited.has(key)) continue;
      visited.add(key);
      queue.push(heuristic(next), next);
    }

    if (state.stock.length > 0 || state.waste.length > 0) {
      const next = cloneState(state);
      draw(next);
      const key = stateKey(next);
      if (!visited.has(key)) {
        visited.add(key);
        queue.push(heuristic(next), next);
      }
    }
  }

  // Frontier exhausted before the budget ran out — every reachable state was
  // visited and none of them won. This is a real proof of unsolvability, not
  // a shrug — distinguished from a budget timeout via `timedOut: false`.
  return {
    solvable: false, statesExplored: explored, elapsedMs: Date.now() - start, timedOut: false,
  };
}

export async function solve(seed, options = {}) {
  return solveState(newGame(seed, 'solver'), options);
}
