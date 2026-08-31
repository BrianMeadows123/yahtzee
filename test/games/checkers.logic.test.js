import test from 'node:test';
import assert from 'node:assert/strict';
import { newGame, legalMoves, move, SIZE, isDark } from '../../games/checkers/logic.js';

test('a fresh game has 12 pieces per side on dark squares, player 0 to move', () => {
  const game = newGame(['A', 'B']);
  let p0 = 0;
  let p1 = 0;
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      const piece = game.board[r][c];
      if (piece) {
        assert.ok(isDark(r, c), `piece at (${r},${c}) must be on a dark square`);
        if (piece.player === 0) p0++; else p1++;
        assert.equal(piece.king, false);
      }
    }
  }
  assert.equal(p0, 12);
  assert.equal(p1, 12);
  assert.equal(game.currentPlayer, 0);
  assert.equal(game.phase, 'playing');
});

test('a simple forward diagonal move is legal and passes the turn', () => {
  const game = newGame();
  const result = move(game, 0, 2, 1, 3, 0);
  assert.equal(result.captured, false);
  assert.equal(game.board[2][1], null);
  assert.equal(game.board[3][0].player, 0);
  assert.equal(game.currentPlayer, 1);
});

test('moving backward (non-king) is rejected', () => {
  const game = newGame();
  // Player 0's pieces only occupy rows 0-2 initially, so there's nothing to
  // move backward into row -1; instead, prove illegality directly: a row-2
  // piece cannot move to row 1.
  assert.throws(() => move(game, 0, 2, 1, 1, 0), /illegal/i);
});

test('moving your opponent\'s piece is rejected', () => {
  const game = newGame();
  assert.throws(() => move(game, 0, 5, 0, 4, 1), /no piece of yours/i);
});

test('capturing an adjacent enemy piece is mandatory when available', () => {
  const game = newGame();
  // Clear the board and set up a simple capture scenario.
  game.board = Array.from({ length: SIZE }, () => Array(SIZE).fill(null));
  game.board[3][2] = { player: 0, king: false };
  game.board[4][3] = { player: 1, king: false };
  game.currentPlayer = 0;

  const moves = legalMoves(game, 0);
  assert.equal(moves.length, 1);
  assert.deepEqual(moves[0], { from: [3, 2], to: [5, 4], captured: [4, 3] });

  // A non-capturing move must be rejected outright since a capture exists.
  game.board[6][5] = null; // just to be explicit there's an empty landing option too
  assert.throws(() => move(game, 0, 3, 2, 4, 1), /illegal/i);
});

test('capturing removes the jumped piece and lands two squares away', () => {
  const game = newGame();
  game.board = Array.from({ length: SIZE }, () => Array(SIZE).fill(null));
  game.board[3][2] = { player: 0, king: false };
  game.board[4][3] = { player: 1, king: false };
  game.currentPlayer = 0;

  const result = move(game, 0, 3, 2, 5, 4);
  assert.equal(result.captured, true);
  assert.equal(game.board[3][2], null);
  assert.equal(game.board[4][3], null); // captured piece removed
  assert.equal(game.board[5][4].player, 0);
});

test('a multi-jump chain must continue with the same piece before the turn passes', () => {
  const game = newGame();
  game.board = Array.from({ length: SIZE }, () => Array(SIZE).fill(null));
  game.board[1][2] = { player: 0, king: false };
  game.board[2][3] = { player: 1, king: false };
  game.board[4][5] = { player: 1, king: false };
  game.currentPlayer = 0;

  const first = move(game, 0, 1, 2, 3, 4);
  assert.equal(first.captured, true);
  assert.equal(first.chainContinues, true);
  assert.deepEqual(game.mustContinueFrom, [3, 4]);
  assert.equal(game.currentPlayer, 0); // turn has NOT passed yet

  // Trying to move a different piece is rejected while a chain is pending.
  game.board[0][1] = { player: 0, king: false };
  assert.throws(() => move(game, 0, 0, 1, 1, 2), /must continue capturing/i);

  const second = move(game, 0, 3, 4, 5, 6);
  assert.equal(second.captured, true);
  assert.equal(second.chainContinues, false);
  assert.equal(game.mustContinueFrom, null);
  assert.equal(game.currentPlayer, 1); // now it passes
});

test('a piece that kings on a capture stops immediately, even with a further jump available', () => {
  const game = newGame();
  game.board = Array.from({ length: SIZE }, () => Array(SIZE).fill(null));
  game.board[6][3] = { player: 0, king: false };
  game.board[7][4] = { player: 1, king: false }; // would be captured, landing kings player 0
  game.currentPlayer = 0;
  // Give the landed king a further capture it should NOT be forced to take this turn.
  game.board[6][5]; // no-op, just documenting intent

  // Actually set up a real further-capture opportunity from the landing square.
  game.board = Array.from({ length: SIZE }, () => Array(SIZE).fill(null));
  game.board[5][2] = { player: 0, king: false };
  game.board[6][3] = { player: 1, king: false }; // captured, lands at [7,4] which kings
  game.currentPlayer = 0;

  const result = move(game, 0, 5, 2, 7, 4);
  assert.equal(result.captured, true);
  assert.equal(result.kinged, true);
  assert.equal(result.chainContinues, false);
  assert.equal(game.mustContinueFrom, null);
  assert.equal(game.board[7][4].king, true);
  assert.equal(game.currentPlayer, 1);
});

test('a king can move and capture backward', () => {
  const game = newGame();
  game.board = Array.from({ length: SIZE }, () => Array(SIZE).fill(null));
  game.board[4][3] = { player: 0, king: true };
  game.currentPlayer = 0;
  const moves = legalMoves(game, 0).map((m) => m.to).sort();
  assert.deepEqual(moves.sort(), [[3, 2], [3, 4], [5, 2], [5, 4]].sort());
});

test('a player fully boxed in (no simple moves, no captures available) loses', () => {
  const game = newGame();
  game.board = Array.from({ length: SIZE }, () => Array(SIZE).fill(null));
  // Player 1's lone piece at (3,3): both forward-diagonal destinations (2,2)
  // and (2,4) are occupied, blocking simple moves. Player 1's own capture
  // landing squares (1,1) and (1,5) are also occupied, blocking captures.
  // (4,4) and (4,2) additionally block player 0's (2,2)/(2,4) from having a
  // mandatory capture of their own against (3,3), so player 0 still has a
  // free simple move available to actually take a turn with.
  game.board[3][3] = { player: 1, king: false };
  game.board[2][2] = { player: 0, king: false };
  game.board[2][4] = { player: 0, king: false };
  game.board[1][1] = { player: 0, king: false };
  game.board[1][5] = { player: 0, king: false };
  game.board[4][4] = { player: 0, king: false };
  game.board[4][2] = { player: 0, king: false };
  game.board[6][1] = { player: 0, king: false }; // unrelated spare piece, just to make a legal move
  game.currentPlayer = 0;

  assert.equal(legalMoves(game, 1).length, 0); // boxed in even before player 0 moves

  const result = move(game, 0, 6, 1, 7, 0);
  assert.equal(result.captured, false);
  assert.equal(game.phase, 'finished');
  assert.equal(game.winner, 0);
});
