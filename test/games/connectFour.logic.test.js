import test from 'node:test';
import assert from 'node:assert/strict';
import { newGame, dropPiece, ROWS, COLS } from '../../games/connectFour/logic.js';

function dropMany(game, columns) {
  for (const col of columns) dropPiece(game, col);
  return game;
}

// Drops into `col` while forcing whose turn it is, so win-line fixtures can
// be built directly instead of fighting normal turn alternation.
function forceDrop(game, col, player) {
  game.currentPlayer = player;
  dropPiece(game, col);
}

test('a fresh game has an empty board and player 0 goes first', () => {
  const game = newGame(['A', 'B']);
  assert.equal(game.board.length, ROWS);
  assert.equal(game.board[0].length, COLS);
  assert.ok(game.board.every((row) => row.every((cell) => cell === null)));
  assert.equal(game.currentPlayer, 0);
  assert.equal(game.phase, 'playing');
});

test('a piece falls to the lowest open row in its column', () => {
  const game = newGame();
  dropPiece(game, 3);
  assert.equal(game.board[ROWS - 1][3], 0); // bottom row
  dropPiece(game, 3); // player 1 now
  assert.equal(game.board[ROWS - 2][3], 1); // stacks on top
});

test('turn alternates after a non-winning move', () => {
  const game = newGame();
  dropPiece(game, 0);
  assert.equal(game.currentPlayer, 1);
  dropPiece(game, 1);
  assert.equal(game.currentPlayer, 0);
});

test('a full column rejects further drops', () => {
  const game = newGame();
  for (let i = 0; i < ROWS; i++) dropPiece(game, 0); // fills column 0 (alternating players)
  assert.throws(() => dropPiece(game, 0), /full/i);
});

test('dropping outside the board is rejected', () => {
  const game = newGame();
  assert.throws(() => dropPiece(game, -1), /invalid column/i);
  assert.throws(() => dropPiece(game, COLS), /invalid column/i);
});

test('horizontal four-in-a-row wins', () => {
  // Player 0 plays columns 0-3 on the bottom row; player 1 plays elsewhere (column 6) between turns.
  const game = dropMany(newGame(), [0, 6, 1, 6, 2, 6]);
  assert.equal(game.phase, 'playing');
  dropPiece(game, 3); // player 0 completes 0-1-2-3 on the bottom row
  assert.equal(game.phase, 'finished');
  assert.equal(game.winner, 0);
  assert.equal(game.winningCells.length, 4);
});

test('vertical four-in-a-row wins', () => {
  const game = dropMany(newGame(), [0, 1, 0, 1, 0, 1]);
  assert.equal(game.phase, 'playing');
  dropPiece(game, 0); // player 0's 4th piece stacked in column 0
  assert.equal(game.phase, 'finished');
  assert.equal(game.winner, 0);
});

test('a rising diagonal (/) four-in-a-row wins', () => {
  const g = newGame();
  // Target: player 0 occupies (5,0), (4,1), (3,2), (2,3) — a rising diagonal.
  forceDrop(g, 0, 0); // (5,0) = 0
  forceDrop(g, 1, 1); forceDrop(g, 1, 0); // (5,1)=1, (4,1)=0
  forceDrop(g, 2, 1); forceDrop(g, 2, 1); forceDrop(g, 2, 0); // (5,2)=1, (4,2)=1, (3,2)=0
  forceDrop(g, 3, 1); forceDrop(g, 3, 1); forceDrop(g, 3, 1); forceDrop(g, 3, 0); // (5,3)=1,(4,3)=1,(3,3)=1,(2,3)=0
  assert.equal(g.phase, 'finished');
  assert.equal(g.winner, 0);
  const cells = new Set(g.winningCells.map(([r, c]) => `${r},${c}`));
  assert.ok(['5,0', '4,1', '3,2', '2,3'].every((k) => cells.has(k)));
});

test('a falling diagonal (\\) four-in-a-row wins', () => {
  const g = newGame();
  // Target: player 0 at (2,0), (3,1), (4,2), (5,3)
  forceDrop(g, 3, 0); // (5,3) = 0
  forceDrop(g, 2, 1); forceDrop(g, 2, 0); // (5,2)=1, (4,2)=0
  forceDrop(g, 1, 1); forceDrop(g, 1, 1); forceDrop(g, 1, 0); // (5,1)=1,(4,1)=1,(3,1)=0
  forceDrop(g, 0, 1); forceDrop(g, 0, 1); forceDrop(g, 0, 1); forceDrop(g, 0, 0); // (5,0)=1,(4,0)=1,(3,0)=1,(2,0)=0
  assert.equal(g.phase, 'finished');
  assert.equal(g.winner, 0);
});

test('a full board with no winner is a draw', () => {
  const g = newGame();
  // A column-block fill pattern brute-force-verified (see dev notes) to
  // contain no 4-in-a-row in any direction: per column c, bottom-to-top,
  // the sequence is [c%2, c%2, (c+1)%2, (c+1)%2, c%2, c%2].
  for (let col = 0; col < COLS; col++) {
    const sequence = [col % 2, col % 2, (col + 1) % 2, (col + 1) % 2, col % 2, col % 2];
    for (const player of sequence) forceDrop(g, col, player);
  }
  assert.equal(g.phase, 'finished');
  assert.equal(g.winner, null);
});

test('moves after the game is finished are rejected', () => {
  const g = newGame();
  forceDrop(g, 0, 0); forceDrop(g, 1, 0); forceDrop(g, 2, 0); forceDrop(g, 3, 0); // horizontal win
  assert.equal(g.phase, 'finished');
  assert.throws(() => dropPiece(g, 4), /finished/i);
});
