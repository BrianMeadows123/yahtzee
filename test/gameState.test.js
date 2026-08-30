import test from 'node:test';
import assert from 'node:assert/strict';
import {
  newGame, roll, toggleHold, getScoreOptions, scoreCategory, rollDie,
} from '../game/gameState.js';

function forceDice(game, dice) {
  game.dice = [...dice];
}

test('rollDie stays within 1..6', () => {
  for (let i = 0; i < 200; i++) {
    const d = rollDie();
    assert.ok(d >= 1 && d <= 6);
  }
});

test('a full turn: roll, hold, reroll, score, then turn advances to other player', () => {
  const game = newGame(['A', 'B']);
  roll(game);
  assert.equal(game.rollsRemaining, 2);
  assert.equal(game.turnStarted, true);

  forceDice(game, [5, 5, 5, 2, 3]);
  toggleHold(game, 0);
  toggleHold(game, 1);
  toggleHold(game, 2);
  roll(game); // held dice (5,5,5) must survive this roll
  assert.equal(game.dice[0], 5);
  assert.equal(game.dice[1], 5);
  assert.equal(game.dice[2], 5);
  assert.equal(game.rollsRemaining, 1);

  forceDice(game, [5, 5, 5, 4, 4]); // full house
  const options = getScoreOptions(game);
  assert.equal(options.fullHouse.score, 25);

  scoreCategory(game, 'fullHouse');
  assert.equal(game.players[0].scorecard.fullHouse, 25);
  assert.equal(game.currentPlayer, 1); // turn passed to player B
  assert.equal(game.rollsRemaining, 3);
  assert.equal(game.turnStarted, false);
});

test('cannot roll more than 3 times per turn', () => {
  const game = newGame();
  roll(game); roll(game); roll(game);
  assert.equal(game.rollsRemaining, 0);
  assert.throws(() => roll(game), /No rolls remaining/);
});

test('cannot hold before rolling, or after rolls exhausted', () => {
  const game = newGame();
  assert.throws(() => toggleHold(game, 0), /Roll before holding/);
  roll(game); roll(game); roll(game);
  assert.throws(() => toggleHold(game, 0), /No rolls remaining/);
});

test('joker rule: second yahtzee forces the matching upper box when open', () => {
  const game = newGame();
  roll(game);
  forceDice(game, [4, 4, 4, 4, 4]);
  scoreCategory(game, 'yahtzee'); // player A scores 50 in yahtzee box, turn -> B
  assert.equal(game.players[0].scorecard.yahtzee, 50);

  // Skip player B's turn quickly (score chance) to get back to player A.
  roll(game);
  forceDice(game, [1, 1, 1, 1, 1]);
  scoreCategory(game, 'chance');
  assert.equal(game.currentPlayer, 0);

  // Player A rolls another yahtzee of fours; "fours" box is still open -> forced.
  roll(game);
  forceDice(game, [4, 4, 4, 4, 4]);
  const options = getScoreOptions(game);
  assert.deepEqual(Object.keys(options), ['fours']);
  assert.equal(options.fours.forced, true);
  assert.equal(options.fours.score, 20);

  scoreCategory(game, 'fours');
  assert.equal(game.players[0].scorecard.fours, 20);
  assert.equal(game.players[0].scorecard.yahtzeeBonusCount, 1);
});

test('joker rule: once matching upper box is filled, lower section boxes score full joker value', () => {
  const game = newGame();
  roll(game);
  forceDice(game, [3, 3, 3, 3, 3]);
  scoreCategory(game, 'yahtzee');

  // Player B turn, skip.
  roll(game);
  forceDice(game, [1, 2, 3, 4, 5]);
  scoreCategory(game, 'largeStraight');

  // Player A fills 'threes' box normally (not a yahtzee this time).
  roll(game);
  forceDice(game, [3, 1, 2, 6, 6]);
  scoreCategory(game, 'threes'); // scores 3

  // Player B turn again, skip.
  roll(game);
  forceDice(game, [2, 2, 2, 2, 2]);
  scoreCategory(game, 'chance'); // 10

  // Player A rolls a third yahtzee of threes; 'threes' box now filled, so free choice with joker scoring.
  roll(game);
  forceDice(game, [3, 3, 3, 3, 3]);
  const options = getScoreOptions(game);
  assert.equal(options.threes, undefined); // already filled, not offered
  assert.equal(options.fullHouse.score, 25);
  assert.equal(options.smallStraight.score, 30);
  assert.equal(options.largeStraight.score, 40); // still open on player A's own scorecard

  scoreCategory(game, 'fullHouse');
  assert.equal(game.players[0].scorecard.fullHouse, 25);
  assert.equal(game.players[0].scorecard.yahtzeeBonusCount, 1);
});

test('game finishes and computes a winner once both scorecards are complete', () => {
  const game = newGame(['A', 'B']);
  const categories = [
    'ones', 'twos', 'threes', 'fours', 'fives', 'sixes', 'threeOfAKind',
    'fourOfAKind', 'fullHouse', 'smallStraight', 'largeStraight', 'yahtzee', 'chance',
  ];
  for (const cat of categories) {
    roll(game); forceDice(game, [1, 1, 1, 1, 1]); scoreCategory(game, cat); // A
    roll(game); forceDice(game, [2, 2, 2, 2, 2]); scoreCategory(game, cat); // B
  }
  assert.equal(game.phase, 'finished');
  assert.ok(game.winner === 0 || game.winner === 1 || game.winner === null);
});
