import test from 'node:test';
import assert from 'node:assert/strict';
import { newGame } from '../../games/solitaire/logic.js';
import { solveState, solve } from '../../games/solitaire/solver.js';

function card(rank, suit, faceUp = true) {
  return { rank, suit, faceUp };
}

test('a near-complete, trivially-winnable state is confirmed solvable', async () => {
  const state = newGame('seed');
  state.foundations = {
    S: 13, H: 13, D: 13, C: 11,
  };
  state.cardsHome = 50;
  state.tableau = [[], [], [], [], [], [], []];
  state.stock = [];
  // waste's last element is the accessible top — 12C must come out before 13C
  state.waste = [card(13, 'C'), card(12, 'C')];

  const result = await solveState(state, { maxStates: 10000, maxMs: 2000 });
  assert.equal(result.solvable, true);
  assert.equal(result.timedOut, false);
});

test('a permanently-stuck Ace (face-down, alone, nothing above it) is proven unsolvable', async () => {
  // A stuck Ace is the cleanest way to hand-build a genuinely-unwinnable
  // small state: tableau stacking only ever goes strictly downward in rank,
  // so nothing can ever legally land on top of an Ace — unlike a stuck
  // higher card, which (initial attempt at this test discovered) can be
  // covered by a card pulled back off an *already-complete* foundation
  // elsewhere and later re-exposed via the normal reveal-on-removal
  // mechanic. Foundations must all start at 0 here too, for the same
  // reason — a complete foundation is itself a source of "free" cards via
  // that same legal backward move.
  const state = newGame('seed');
  state.foundations = {
    S: 0, H: 0, D: 0, C: 0,
  };
  state.cardsHome = 0;
  state.tableau = [[card(1, 'S', false)], [], [], [], [], [], []];
  state.stock = [];
  state.waste = [];

  const result = await solveState(state, { maxStates: 10000, maxMs: 2000 });
  assert.equal(result.solvable, false);
  assert.equal(result.timedOut, false); // proven unsolvable, not just out of budget
  assert.equal(result.statesExplored, 1); // no move is even possible from this state
});

test('a won state (already 52 home) is solvable in zero extra steps', async () => {
  const state = newGame('seed');
  state.foundations = {
    S: 13, H: 13, D: 13, C: 13,
  };
  state.cardsHome = 52;
  state.tableau = [[], [], [], [], [], [], []];
  state.stock = [];
  state.waste = [];

  const result = await solveState(state, { maxStates: 100, maxMs: 1000 });
  assert.equal(result.solvable, true);
  assert.equal(result.statesExplored, 1);
});

test('an exhausted budget is reported as timed out, not a proof of unsolvability', async () => {
  // A real, large deal that needs more than a handful of states to resolve
  // either way — starving it of both states and time should report
  // inconclusive (timedOut: true), never a false "solvable: false" claim.
  const result = await solve('budget-test-seed-unlikely-to-be-trivial', { maxStates: 3, maxMs: 100000 });
  assert.equal(result.timedOut, true);
  assert.equal(result.solvable, false);
});

test('solve() on a real seed matches solveState() on that seed\'s dealt game', async () => {
  const seed = '2026-01-01';
  const viaSolve = await solve(seed, { maxStates: 50000, maxMs: 5000 });
  const viaSolveState = await solveState(newGame(seed, 'solver'), { maxStates: 50000, maxMs: 5000 });
  assert.equal(viaSolve.solvable, viaSolveState.solvable);
});
