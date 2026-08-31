import test from 'node:test';
import assert from 'node:assert/strict';
import { newGame, placeFleet, fire, isSunk, SIZE } from '../../games/battleship/logic.js';

// A valid, non-overlapping fleet (lengths 4,3,3,2) for reuse across tests.
function validFleet(rowOffset = 0) {
  return [
    [[rowOffset, 0], [rowOffset, 1], [rowOffset, 2], [rowOffset, 3]], // length 4
    [[rowOffset + 2, 0], [rowOffset + 2, 1], [rowOffset + 2, 2]], // length 3
    [[rowOffset + 4, 0], [rowOffset + 4, 1], [rowOffset + 4, 2]], // length 3
    [[rowOffset + 6, 0], [rowOffset + 6, 1]], // length 2
  ];
}

test('a fresh game starts in the placing phase with no ships set', () => {
  const game = newGame(['A', 'B']);
  assert.equal(game.phase, 'placing');
  assert.ok(game.players.every((p) => p.ships === null && p.ready === false));
});

test('placing a fleet with the wrong ship-length set is rejected', () => {
  const game = newGame();
  assert.throws(() => placeFleet(game, 0, [[[0, 0], [0, 1]]]), /ship lengths/i);
});

test('a non-straight-line ship is rejected', () => {
  const game = newGame();
  const bent = [[0, 0], [0, 1], [1, 1], [1, 2]]; // length 4 but not a line
  assert.throws(() => placeFleet(game, 0, [bent, ...validFleet(2).slice(1)]), /straight/i);
});

test('a non-contiguous ship is rejected', () => {
  const game = newGame();
  const gapped = [[0, 0], [0, 1], [0, 3], [0, 4]]; // length 4, has a gap at col 2
  assert.throws(() => placeFleet(game, 0, [gapped, ...validFleet(2).slice(1)]), /contiguous/i);
});

test('overlapping ships are rejected', () => {
  const game = newGame();
  const fleet = validFleet(0);
  fleet[1] = [[0, 0], [0, 1], [0, 2]]; // overlaps the length-4 ship at (0,0)-(0,2)
  assert.throws(() => placeFleet(game, 0, fleet), /overlap/i);
});

test('out-of-bounds placement is rejected', () => {
  const game = newGame();
  const fleet = validFleet(0);
  fleet[3] = [[0, SIZE - 1], [0, SIZE]]; // one cell off the board
  assert.throws(() => placeFleet(game, 0, fleet), /bounds/i);
});

test('the game moves to playing only once both players are ready', () => {
  const game = newGame();
  placeFleet(game, 0, validFleet(0));
  assert.equal(game.phase, 'placing');
  assert.equal(game.players[0].ready, true);
  placeFleet(game, 1, validFleet(0));
  assert.equal(game.phase, 'playing');
  assert.equal(game.currentPlayer, 0);
});

test('firing before both fleets are placed is rejected', () => {
  const game = newGame();
  placeFleet(game, 0, validFleet(0));
  assert.throws(() => fire(game, 0, 0, 0), /playing phase/i);
});

test('a miss records correctly and passes the turn', () => {
  const game = newGame();
  placeFleet(game, 0, validFleet(0));
  placeFleet(game, 1, validFleet(0));
  const result = fire(game, 0, 7, 7); // nowhere near player 1's fleet (rows 0-7 but col 7 unused)
  assert.equal(result.hit, false);
  assert.equal(result.sunkShip, null);
  assert.equal(game.currentPlayer, 1);
  assert.equal(game.shotsAt[1].length, 1);
  assert.equal(game.shotsAt[1][0].hit, false);
});

test('a hit records correctly without sinking the ship', () => {
  const game = newGame();
  placeFleet(game, 0, validFleet(0));
  placeFleet(game, 1, validFleet(0));
  const result = fire(game, 0, 0, 0); // player 1's 4-length ship starts at (0,0)
  assert.equal(result.hit, true);
  assert.equal(result.sunkShip, null); // only 1 of 4 cells hit
  assert.equal(game.currentPlayer, 1); // turn still passes on a hit (no bonus turn)
});

test('firing at the same cell twice is rejected', () => {
  const game = newGame();
  placeFleet(game, 0, validFleet(0));
  placeFleet(game, 1, validFleet(0));
  fire(game, 0, 0, 0);
  game.currentPlayer = 0; // force it back so this test isolates the duplicate-cell check, not turn order
  assert.throws(() => fire(game, 0, 0, 0), /already fired/i);
});

test('sinking a ship reports it, without ending the game if others remain', () => {
  const game = newGame();
  placeFleet(game, 0, validFleet(0));
  placeFleet(game, 1, validFleet(0)); // player 1's destroyer (length 2) is at (6,0),(6,1)
  const forcedFire = (seat, r, c) => { game.currentPlayer = seat; return fire(game, seat, r, c); };
  forcedFire(0, 6, 0);
  const result = forcedFire(0, 6, 1);
  assert.equal(result.hit, true);
  assert.ok(result.sunkShip);
  assert.equal(game.phase, 'playing'); // three ships still afloat
});

test('sinking every ship finishes the game and sets the winner', () => {
  const game = newGame();
  placeFleet(game, 0, validFleet(0));
  placeFleet(game, 1, validFleet(0));
  const forcedFire = (seat, r, c) => { game.currentPlayer = seat; return fire(game, seat, r, c); };
  const allCells = validFleet(0).flat();
  let result;
  for (const [r, c] of allCells) {
    result = forcedFire(0, r, c);
  }
  assert.equal(game.phase, 'finished');
  assert.equal(game.winner, 0);
  assert.ok(result.sunkShip); // the last shot sank the final ship
});

test('isSunk is false until every one of a ship\'s cells has been hit', () => {
  const ship = { cells: [[0, 0], [0, 1], [0, 2]] };
  assert.equal(isSunk(ship, [{ row: 0, col: 0, hit: true }, { row: 0, col: 1, hit: true }]), false);
  assert.equal(isSunk(ship, [
    { row: 0, col: 0, hit: true }, { row: 0, col: 1, hit: true }, { row: 0, col: 2, hit: true },
  ]), true);
});
